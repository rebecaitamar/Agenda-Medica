-- =====================================================================
-- Datos iniciales mínimos. No se cargan nombre, matrícula, dirección ni
-- horarios: la médica los completa desde el panel (Configuración).
-- Las duraciones son valores de partida editables.
-- =====================================================================

with p as (
  insert into public.profiles (honorific) values ('Dra.') returning id
),
c as (
  insert into public.clinic_settings (id, profile_id) select true, id from p returning profile_id
)
insert into public.specialties (profile_id, slug, name, description, duration_minutes, buffer_minutes, min_notice_hours, max_advance_days, sort_order)
select profile_id, 'medicina-clinica', 'Medicina Clínica', null, 30, 0, 2, 60, 1 from c
union all
select profile_id, 'dermatologia', 'Dermatología', null, 20, 0, 2, 60, 2 from c;

insert into public.email_templates (kind, subject, body) values
('verification_code', 'Tu código para confirmar el turno',
'Hola {{paciente}}:

Tu código de verificación es {{codigo}}. Ingresalo en la página de reserva para confirmar tu turno de {{especialidad}} del {{fecha}} a las {{hora}}.

El horario queda reservado durante {{minutos_retencion}} minutos. Si no solicitaste este turno, ignorá este correo.'),
('confirmation', 'Confirmación de turno médico',
'Hola {{paciente}}:

Tu turno quedó confirmado. Te esperamos en el consultorio.

{{indicaciones}}'),
('reminder', 'Recordatorio de tu turno médico',
'Hola {{paciente}}:

Te recordamos que tenés un turno de {{especialidad}} el {{fecha}} a las {{hora}}.

Si no podés asistir, avisanos con anticipación para liberar el horario.'),
('rescheduled', 'Tu turno médico fue reprogramado',
'Hola {{paciente}}:

Tu turno de {{especialidad}} fue reprogramado. El nuevo horario es el {{fecha}} a las {{hora}} (antes: {{fecha_anterior}} a las {{hora_anterior}}).'),
('cancelled', 'Tu turno médico fue cancelado',
'Hola {{paciente}}:

Tu turno de {{especialidad}} del {{fecha}} a las {{hora}} fue cancelado.

{{motivo}}

Si querés, podés solicitar un nuevo turno desde la web.');
