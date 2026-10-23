-- =====================================================================
-- Tarea programada de recordatorios (ejecutar UNA vez en Supabase → SQL Editor,
-- después de publicar la aplicación en Vercel).
--
-- Cada 5 minutos, pg_cron llama al endpoint de la aplicación, que envía los
-- recordatorios vencidos y reintenta los correos fallidos. Vive en la base de
-- datos: sobrevive a reinicios, despliegues y no depende de ningún navegador.
--
-- Reemplazá los dos valores marcados antes de ejecutar:
--   <APP_URL>      ej.: https://turnos.tudominio.com.ar   (sin barra final)
--   <CRON_SECRET>  el mismo valor de la variable CRON_SECRET en Vercel
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- El secreto se guarda cifrado en Supabase Vault, no en el texto del cron.
select vault.create_secret('<CRON_SECRET>', 'agenda_cron_secret', 'Secreto para /api/cron/notifications');
select vault.create_secret('<APP_URL>', 'agenda_app_url', 'URL pública de Agenda Médica');

-- Si ya existía, se reemplaza.
select cron.unschedule('agenda-notificaciones') where exists (select 1 from cron.job where jobname = 'agenda-notificaciones');

select cron.schedule(
  'agenda-notificaciones',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'agenda_app_url') || '/api/cron/notifications',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'agenda_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Verificación: debería aparecer la tarea activa.
select jobid, jobname, schedule, active from cron.job where jobname = 'agenda-notificaciones';

-- Para revisar las últimas ejecuciones (respuesta HTTP 200 = correcto):
--   select status_code, content, created from net._http_response order by created desc limit 10;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
