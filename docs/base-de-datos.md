# Esquema de la base de datos

PostgreSQL (Supabase). Migraciones en `supabase/migrations/`, en orden:

| Archivo | Contenido |
|---|---|
| `20261023000001_schema.sql` | Tipos, tablas, índices, restricciones y triggers |
| `20261023000002_availability.sql` | Motor de disponibilidad (`available_slots`), vencimiento de retenciones, límite de solicitudes |
| `20261023000003_security.sql` | Row Level Security en todas las tablas y revocación de permisos a `anon` / `authenticated` |
| `20261023000004_seed.sql` | Configuración inicial vacía, las dos especialidades y las plantillas de correo |

## Tablas

| Tabla | Para qué sirve | Claves y restricciones principales |
|---|---|---|
| `profiles` | Datos de la profesional (tratamiento, nombre, matrícula, presentación, foto) | `user_id` → `auth.users` |
| `clinic_settings` | Configuración del consultorio: nombre del sitio, dirección, contacto, zona horaria, políticas de reserva, cancelación, recordatorios y privacidad | Una sola fila (`id = true`) |
| `admin_users` | Usuarios de Supabase Auth autorizados a entrar al panel | PK `user_id` → `auth.users` |
| `specialties` | Medicina Clínica y Dermatología: duración, descanso, anticipación mínima, horizonte, activa | `slug` único, rangos validados con `check` |
| `availability_rules` | Franjas semanales en hora local (varias por día = pausas fijas) | `weekday` 1–7 (ISO), `end_time > start_time` |
| `availability_exceptions` | Bloqueos, pausas, feriados y vacaciones; `specialty_id` nulo = toda la agenda | Índice GiST sobre el rango |
| `patients` | Datos administrativos mínimos: nombre, correo, teléfono | Único por (`email`, `lower(full_name)`) |
| `appointments` | Turnos: especialidad, paciente, inicio/fin (`timestamptz`), estado, origen, versión | **Restricción de exclusión** `appointments_no_overlap`: dos turnos activos no pueden superponerse (incluye el descanso) |
| `notification_jobs` | Cola persistente de correos (confirmación, recordatorio, reprogramación, cancelación, código) | `idempotency_key` única; índice por `run_at` |
| `notification_logs` | Un registro por intento de envío, con resultado y error | → `notification_jobs` |
| `email_templates` | Asunto y texto editables de cada correo | PK `kind` |
| `audit_logs` | Historial de acciones (sin datos personales en `details`) | Índice por entidad |
| `rate_limits` | Contadores de solicitudes por ventana (claves con hash) | PK (`bucket`, `window_start`) |

## Estados de un turno

`pending_verification` → (código correcto) → `confirmed` → `completed` / `no_show`
`pending_verification` → (vence o se agotan los intentos) → `expired`
`confirmed` → `cancelled`

Ocupan la agenda: `pending_verification` (mientras no venza), `confirmed`, `completed`, `no_show`.

## Fechas y zona horaria

- `starts_at`, `ends_at`, `blocked_until` son `timestamptz` (instante absoluto en UTC).
- Los horarios de atención (`availability_rules`) se guardan en hora local y se interpretan con `clinic_settings.timezone` (`America/Argentina/Buenos_Aires`).
- `blocked_until = ends_at + descanso`: es el rango que bloquea la restricción de exclusión.

## Integridad ante reservas simultáneas

1. La reserva se hace en una transacción que vuelve a calcular la disponibilidad en el servidor.
2. Si dos transacciones pasan ese control a la vez, la restricción de exclusión hace que la segunda falle (`23P01`), y el paciente recibe "Ese horario ya no está disponible".
3. Las notificaciones se crean en la misma transacción que el turno.

## Seguridad

- RLS activado en todas las tablas, **sin políticas** para `anon`/`authenticated`: la API pública de Supabase no devuelve ni modifica nada.
- Se revocan además todos los privilegios a esos roles, también para objetos futuros.
- Solo el servidor de Next.js accede a los datos, con `DATABASE_URL`.
- Los enlaces de gestión se guardan como hash; los códigos de verificación, como HMAC.
