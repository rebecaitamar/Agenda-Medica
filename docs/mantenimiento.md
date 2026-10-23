# Mantenimiento

## Copias de seguridad y recuperación

- **Supabase Pro**: copias diarias automáticas (*Database → Backups*), restaurables desde el panel. Para recuperar a un minuto exacto se puede contratar *Point in Time Recovery*.
- **Copia propia mensual** (recomendada también en Pro), desde una computadora con PostgreSQL instalado:
  ```bash
  pg_dump "$DATABASE_URL_DIRECTA" --no-owner --format=custom --file=agenda-$(date +%F).dump
  ```
  Usá la cadena de conexión **directa** (puerto 5432), no la del pooler. Guardá el archivo cifrado: contiene datos personales.
- **Restaurar** en un proyecto nuevo: ejecutar las migraciones no hace falta; `pg_restore --no-owner --dbname "$NUEVA_URL" agenda-AAAA-MM-DD.dump` y luego actualizar `DATABASE_URL` en Vercel.
- Probá una restauración al menos una vez antes del lanzamiento.

## Controles periódicos

| Frecuencia | Qué revisar |
|---|---|
| Semanal | Panel → Inicio → "Correos": que no haya fallidos acumulados |
| Mensual | `select status_code, created from net._http_response order by created desc limit 5;` (la tarea programada responde 200) |
| Mensual | Resend → Emails: tasa de entrega y rebotes |
| Mensual | Vercel → Logs: errores `[...] error inesperado` |
| Anual | Rotar `CRON_SECRET` (Vercel + `vault.update_secret` en Supabase) y las claves de Resend |

`APP_SECRET` no se rota salvo filtración: cambiarlo invalida los enlaces "Ver o modificar mi turno" ya enviados y los códigos de verificación en curso.

## Actualizaciones de la aplicación

1. Cambios de base de datos: agregar un archivo nuevo en `supabase/migrations/` (nunca editar los ya aplicados) y aplicarlo antes de desplegar.
2. Ejecutar las pruebas (`npm test` y `npm run test:e2e`) con PostgreSQL local.
3. Subir a GitHub: Vercel despliega solo. Si algo falla, *Deployments → Promote* el despliegue anterior.
4. Dependencias: `npm outdated` cada pocos meses; actualizar de a una y volver a correr las pruebas.

## Datos personales

- Pedidos de acceso, rectificación o supresión (Ley 25.326): los datos del paciente se editan desde el detalle del turno. Para suprimir a un paciente por completo, desde *SQL Editor*:
  ```sql
  -- Reemplazá el correo. Borra sus turnos, correos programados y registros asociados.
  with p as (select id from patients where email = 'paciente@ejemplo.com')
  delete from appointments where patient_id in (select id from p);
  delete from patients where email = 'paciente@ejemplo.com';
  ```
- Los registros técnicos de la aplicación no incluyen nombres, correos ni teléfonos; los límites de solicitudes guardan solo hashes.

## Tareas programadas

- La tarea `agenda-notificaciones` corre cada 5 minutos (ver `supabase/setup/cron.sql`). Para pausarla: `select cron.unschedule('agenda-notificaciones');`. Al reactivarla, los recordatorios atrasados más de 6 horas se omiten en lugar de enviarse tarde.
- La misma tarea libera las retenciones vencidas y limpia los contadores de límite de solicitudes de más de 2 días.
