# Puesta en marcha en producción

Orden recomendado: **Supabase → Resend → Vercel → tarea programada → cuenta de la médica → prueba completa**.
Tiempo estimado: 1 a 2 horas. Todo se puede hacer con los planes gratuitos para empezar.

> Antes de lanzar con pacientes reales, conviene el plan **Pro de Supabase** (copias de seguridad diarias con 7 días de retención y sin pausa por inactividad: los proyectos gratuitos se pausan tras una semana sin uso).

---

## 1. Supabase (base de datos y autenticación)

1. Creá un proyecto en <https://supabase.com/dashboard>. Región sugerida: **South America (São Paulo)**. Guardá la contraseña de la base en un gestor de contraseñas.
2. **Migraciones.** Opción A (sin instalar nada): en *SQL Editor* ejecutá, en orden, el contenido de cada archivo de `supabase/migrations/`.
   Opción B (desde tu computadora):
   ```bash
   cp .env.example .env.local        # completá DATABASE_URL
   npm install
   npm run db:migrate
   ```
   ⚠️ No uses `--local-shim` contra Supabase: es solo para PostgreSQL local.
3. Verificá en *Table Editor* que todas las tablas muestran **RLS enabled** y que no tienen políticas. Es intencional: solo el servidor accede a los datos.
4. **Datos de conexión** (*Project Settings*):
   - *Database → Connection string → Transaction pooler* (puerto **6543**) → `DATABASE_URL`.
   - *API* → `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`; clave `anon` / *publishable* → `NEXT_PUBLIC_SUPABASE_ANON_KEY`; clave `service_role` / *secret* → `SUPABASE_SERVICE_ROLE_KEY` (solo para el paso 5, no la cargues en Vercel).
5. **Autenticación** (*Authentication*):
   - *Sign In / Providers → Email*: dejá habilitado el ingreso con correo y **desactivá "Allow new users to sign up"**. Las cuentas del panel se crean solo con el script.
   - *URL Configuration*: `Site URL` = tu `APP_URL`; en *Redirect URLs* agregá `https://TU-DOMINIO/auth/confirm`.
   - *Emails → Templates*:
     - **Reset password**: cambiá el enlace por
       `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/admin/actualizar-clave`
     - **Invite user**: cambiá el enlace por
       `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/admin/actualizar-clave`
   - *Emails → SMTP Settings*: configurá Resend como SMTP (host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = una API key de Resend). El correo por defecto de Supabase tiene un límite muy bajo y no sirve para producción.

## 2. Resend (correos a pacientes)

1. Creá la cuenta en <https://resend.com> y agregá tu dominio en *Domains* (ej.: `tudominio.com.ar`).
2. Cargá en tu proveedor de DNS los registros que indica Resend (SPF/MX y DKIM; DMARC recomendado) y esperá el estado **Verified**. **No publiques la aplicación hasta que el dominio esté verificado**: sin eso, los correos van a spam o se rechazan.
3. En *API Keys* creá una clave con permiso **Sending access**, limitada a ese dominio → `RESEND_API_KEY`.
4. Definí el remitente → `EMAIL_FROM`, por ejemplo `Consultorio Dra. Pérez <turnos@tudominio.com.ar>`. Opcional: `EMAIL_REPLY_TO` con el correo que lee la médica.
5. Prueba rápida: una vez desplegado, hacé una reserva con tu propio correo y revisá en Resend → *Emails* que figure como *Delivered*.

## 3. Vercel (aplicación)

1. En <https://vercel.com/new> importá el repositorio de GitHub. Framework: Next.js (se detecta solo).
2. En *Settings → Environment Variables* (entorno **Production**) cargá todas las variables de `.env.example` **excepto** `SUPABASE_SERVICE_ROLE_KEY`:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | cadena del pooler (6543) |
   | `DATABASE_POOL_MAX` | `5` |
   | `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave pública |
   | `APP_URL` | `https://turnos.tudominio.com.ar` |
   | `APP_SECRET` | `openssl rand -base64 48` |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `RESEND_API_KEY` | clave de Resend |
   | `EMAIL_FROM` | remitente verificado |
   | `EMAIL_REPLY_TO` | opcional |

   Las variables `NEXT_PUBLIC_*` se fijan al compilar: si las cambiás, volvé a desplegar.
3. *Settings → Domains*: agregá tu dominio o subdominio. Vercel emite el certificado HTTPS automáticamente.
4. *Settings → Functions*: región **São Paulo (gru1)**, cerca de la base de datos.
5. Desplegá y abrí `https://TU-DOMINIO/privacidad` para confirmar que responde.

## 4. Tarea programada de recordatorios

Los recordatorios y reintentos los procesa el endpoint `/api/cron/notifications`, que se invoca cada 5 minutos desde la propia base de datos con `pg_cron` (incluido en Supabase, también en el plan gratuito). No se usa el cron de Vercel porque en el plan gratuito solo corre una vez por día.

1. En Supabase → *SQL Editor*, abrí `supabase/setup/cron.sql`, reemplazá `<APP_URL>` y `<CRON_SECRET>` y ejecutalo.
2. Verificá a los 5–10 minutos:
   ```sql
   select status_code, content, created from net._http_response order by created desc limit 5;
   ```
   Tiene que aparecer `200` y un JSON con `"ok":true`.

## 5. Cuenta de la médica

Desde tu computadora, con `.env.local` completo (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`):

```bash
npm run create-admin -- --email dra@tudominio.com.ar
```

Le llega una invitación para elegir su contraseña. Si preferís definirla vos:
`ADMIN_PASSWORD='una-clave-larga' npm run create-admin -- --email dra@... --password`.

Recomendado: en Supabase → *Authentication → Multi-Factor*, habilitar TOTP más adelante para la cuenta del panel.

## 6. Prueba completa antes de abrir a pacientes

1. Ingresar a `/admin`, completar **Configuración** y **Horarios** (ver `configurar-agenda.md`).
2. Revisar que la lista "Para terminar la puesta en marcha" del inicio del panel quede completa.
3. Reservar un turno con un correo propio desde el celular, recibir el código, la confirmación y probar el enlace "Ver o modificar mi turno".
4. Reservar otro turno para dentro de 2–3 días y confirmar que el recordatorio aparece *Programado* en **Correos** y llega a la hora indicada.
5. Cancelar desde el panel y verificar que llega el aviso y que el horario vuelve a estar libre.

## Obligaciones legales a revisar (no son técnicas)

- **Ley 25.326**: inscribir la base de datos de pacientes en el Registro Nacional de Bases de Datos de la AAIP y revisar el texto de `/privacidad` con asesoramiento legal.
- Completar en Configuración el **responsable de los datos** y el **contacto** para ejercer derechos.
- Los proveedores (Supabase, Vercel, Resend) almacenan datos fuera de Argentina: mencionarlo en la política de privacidad si así lo indica tu asesor.
