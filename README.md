# Agenda Médica

Aplicación web de turnos para un consultorio de **Medicina Clínica y Dermatología**: los pacientes reservan online desde el celular, reciben confirmación y recordatorio por correo, y la médica administra su agenda desde un panel privado.

- **Área pública**: presentación de la profesional, elección de especialidad, calendario con disponibilidad real, reserva con verificación del correo, confirmación, enlace seguro para cancelar o cambiar el turno, política de privacidad.
- **Panel**: agenda diaria/semanal/mensual, turnos manuales y sobreturnos, reprogramación, cancelación, asistencia/ausencia, historial, horarios por especialidad, bloqueos y vacaciones, configuración, plantillas y registro de correos.
- **Correos**: confirmación inmediata, recordatorio 48 h antes, avisos de reprogramación y cancelación, con cola persistente, reintentos e idempotencia.

## Tecnología

| Capa | Elección |
|---|---|
| Aplicación | Next.js 16 (App Router) + React 19 + TypeScript |
| Interfaz | Tailwind CSS 4, componentes propios accesibles, Figtree + Source Serif 4 |
| Base de datos | PostgreSQL en Supabase, acceso solo desde el servidor (`postgres.js`) |
| Autenticación del panel | Supabase Auth (sesiones con cookies, recuperación de contraseña) |
| Correo | Resend (API HTTP con `Idempotency-Key`) |
| Tareas programadas | `pg_cron` + `pg_net` en Supabase → `/api/cron/notifications` cada 5 min |
| Hosting | Vercel |

### Decisiones de arquitectura

- **El navegador nunca toca la base.** Todas las tablas tienen RLS activado sin políticas y sin permisos para `anon`/`authenticated`; la clave pública de Supabase solo sirve para iniciar sesión.
- **Disponibilidad calculada en la base** (`available_slots`), siempre en hora de Buenos Aires, y **garantía final con una restricción de exclusión**: dos turnos activos no pueden superponerse aunque dos personas reserven al mismo milisegundo.
- **Notificaciones como cola en la base** (`notification_jobs`), creadas en la misma transacción que el turno; el procesador usa `FOR UPDATE SKIP LOCKED`, verifica que el turno siga vigente y registra cada intento.
- **Sin datos de salud**: no se piden DNI, motivo de consulta ni información clínica.

## Estructura

```
src/app/(public)/        páginas para pacientes
src/app/admin/           panel (login, agenda, turnos, horarios, bloqueos, correos, configuración)
src/app/api/             disponibilidad, reservas, gestión por enlace, tarea programada
src/lib/                 dominio: disponibilidad, reservas, notificaciones, seguridad, configuración
supabase/migrations/     esquema, motor de disponibilidad, seguridad y datos iniciales
supabase/setup/cron.sql  alta de la tarea programada en Supabase
scripts/                 migraciones y alta de la cuenta de la médica
tests/                   pruebas de integración y de punta a punta
docs/                    guías
```

## Documentación

- [Puesta en marcha en producción](docs/puesta-en-marcha.md): Supabase, Resend, Vercel, tarea programada, cuenta de la médica.
- [Cómo configurar la agenda](docs/configurar-agenda.md): guía para la médica.
- [Esquema de la base de datos](docs/base-de-datos.md)
- [Mantenimiento](docs/mantenimiento.md): copias de seguridad, controles, actualizaciones.
- [Pruebas ejecutadas](docs/pruebas.md)

## Variables de entorno

Detalle y ejemplos en [`.env.example`](.env.example).

| Variable | Dónde | Para qué |
|---|---|---|
| `DATABASE_URL` | Servidor | Conexión al pooler de Supabase (puerto 6543) |
| `DATABASE_POOL_MAX` | Servidor | Conexiones por instancia (5) |
| `NEXT_PUBLIC_SUPABASE_URL` | Público | URL del proyecto, para iniciar sesión en el panel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Público | Clave pública de Supabase (no da acceso a datos) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo tu computadora | Crear la cuenta de la médica con `npm run create-admin` |
| `APP_URL` | Servidor | URL pública para los enlaces de los correos |
| `APP_SECRET` | Servidor | Firma de enlaces de gestión y formularios (≥ 32 caracteres) |
| `CRON_SECRET` | Servidor + Supabase Vault | Protege el endpoint de la tarea programada |
| `RESEND_API_KEY` | Servidor | Envío de correos |
| `EMAIL_FROM` | Servidor | Remitente de un dominio verificado |
| `EMAIL_REPLY_TO` | Servidor | Opcional |

Ninguna clave privada llega al navegador.

## Desarrollo local

Requiere Node 22 y PostgreSQL 15+.

```bash
npm install
cp .env.example .env.local
# DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agenda_dev
npm run db:migrate -- --local-shim   # el shim recrea auth.users y los roles de Supabase (solo local)
npm run dev
```

Para entrar al panel en local hace falta un proyecto de Supabase (o usar las pruebas E2E, que incluyen un doble de prueba de Auth).

## Pruebas

```bash
npm test            # 34 pruebas de integración contra PostgreSQL real
npm run test:e2e    # compila, levanta la app y recorre los 18 escenarios con Chromium (celular y escritorio)
```

Las pruebas usan PostgreSQL local real con las migraciones reales. Solo dos servicios externos se reemplazan por dobles de prueba **dentro de `tests/`**: la API de Resend (para inspeccionar los correos sin enviarlos) y la API de Supabase Auth (para iniciar sesión sin un proyecto). La aplicación no contiene simulaciones: sin `RESEND_API_KEY`, cada correo queda registrado como fallido y visible en el panel.

## Pendiente de configuración externa

| Integración | Estado | Qué falta |
|---|---|---|
| Supabase (base + Auth) | No creado | Crear proyecto, migrar, configurar Auth y plantillas ([guía](docs/puesta-en-marcha.md#1-supabase-base-de-datos-y-autenticación)) |
| Resend | No creado | Cuenta, verificar dominio (DNS), API key |
| Vercel | No creado | Importar repo, variables de entorno, dominio |
| Tarea programada | No creada | Ejecutar `supabase/setup/cron.sql` con URL y secreto |
| Cuenta de la médica | No creada | `npm run create-admin -- --email ...` |
| Datos del consultorio | Vacíos a propósito | Nombre, matrícula, dirección, horarios: los carga la médica en el panel |
| Registro de la base (Ley 25.326) | Trámite | Inscripción ante la AAIP y revisión legal de `/privacidad` |
