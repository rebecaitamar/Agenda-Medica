-- =====================================================================
-- Agenda Médica — esquema principal
-- Compatible con Supabase (PostgreSQL 15+). Las fechas/horas de los turnos
-- se guardan como timestamptz (instante absoluto, UTC). La zona horaria del
-- consultorio vive en clinic_settings.timezone y se usa para interpretar los
-- horarios de atención (hora local) y para mostrar fechas.
-- =====================================================================

-- ---------- Tipos ----------
create type public.appointment_status as enum (
  'pending_verification', -- reserva online retenida mientras el paciente verifica su correo
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'expired'               -- retención vencida sin verificar
);

create type public.exception_kind as enum ('block', 'vacation', 'holiday', 'pause');

create type public.notification_kind as enum (
  'verification_code', 'confirmation', 'reminder', 'rescheduled', 'cancelled'
);

create type public.job_status as enum (
  'pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped'
);

-- ---------- Profesional ----------
create table public.profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users (id) on delete set null,
  honorific       text not null default 'Dra.' check (char_length(honorific) <= 20),
  full_name       text check (char_length(full_name) <= 120),
  license_number  text check (char_length(license_number) <= 60),   -- matrícula
  bio             text check (char_length(bio) <= 1500),
  photo_url       text check (photo_url is null or photo_url ~ '^https://'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Configuración del consultorio (una sola fila en la v1).
create table public.clinic_settings (
  id                          boolean primary key default true check (id),
  profile_id                  uuid not null references public.profiles (id),
  app_name                    text not null default 'Agenda Médica' check (char_length(app_name) between 1 and 80),
  address_line                text check (char_length(address_line) <= 200),
  address_details             text check (char_length(address_details) <= 200),  -- piso, depto, timbre
  city                        text check (char_length(city) <= 120),
  maps_url                    text check (maps_url is null or maps_url ~ '^https://'),
  arrival_instructions        text check (char_length(arrival_instructions) <= 1500),
  public_hours_text           text check (char_length(public_hours_text) <= 600),
  show_public_hours           boolean not null default false,
  contact_phone               text check (char_length(contact_phone) <= 40),
  contact_whatsapp            text check (char_length(contact_whatsapp) <= 40),
  contact_email               text check (char_length(contact_email) <= 200),
  timezone                    text not null default 'America/Argentina/Buenos_Aires',
  phone_required              boolean not null default false,
  require_email_verification  boolean not null default true,
  allow_patient_cancel        boolean not null default true,
  allow_patient_reschedule    boolean not null default true,
  patient_change_min_hours    integer not null default 24 check (patient_change_min_hours between 0 and 720),
  reminder_hours_before       integer not null default 48 check (reminder_hours_before between 1 and 336),
  hold_minutes                integer not null default 15 check (hold_minutes between 5 and 60),
  cancellation_policy_text    text check (char_length(cancellation_policy_text) <= 1500),
  privacy_controller_name     text check (char_length(privacy_controller_name) <= 200),
  privacy_controller_contact  text check (char_length(privacy_controller_contact) <= 300),
  updated_at                  timestamptz not null default now()
);

-- Usuarios autorizados a entrar al panel (la médica; en el futuro, secretaría).
create table public.admin_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

-- ---------- Especialidades y disponibilidad ----------
create table public.specialties (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id),
  slug              text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name              text not null check (char_length(name) between 2 and 80),
  description       text check (char_length(description) <= 400),
  duration_minutes  integer not null check (duration_minutes between 5 and 240),
  buffer_minutes    integer not null default 0 check (buffer_minutes between 0 and 120),
  min_notice_hours  integer not null default 2 check (min_notice_hours between 0 and 720),
  max_advance_days  integer not null default 60 check (max_advance_days between 1 and 365),
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Franjas semanales en hora local del consultorio. Varias franjas por día
-- permiten modelar pausas fijas (ej.: 09:00–12:00 y 14:00–18:00).
create table public.availability_rules (
  id            uuid primary key default gen_random_uuid(),
  specialty_id  uuid not null references public.specialties (id) on delete cascade,
  weekday       smallint not null check (weekday between 1 and 7), -- ISO: 1 = lunes … 7 = domingo
  start_time    time not null,
  end_time      time not null,
  created_at    timestamptz not null default now(),
  check (end_time > start_time)
);
create index availability_rules_specialty_idx on public.availability_rules (specialty_id, weekday);

-- Bloqueos puntuales, vacaciones, feriados y pausas. specialty_id nulo = toda la agenda.
create table public.availability_exceptions (
  id            uuid primary key default gen_random_uuid(),
  specialty_id  uuid references public.specialties (id) on delete cascade,
  kind          public.exception_kind not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  reason        text check (char_length(reason) <= 200),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_exceptions_range_idx
  on public.availability_exceptions using gist (tstzrange(starts_at, ends_at, '[)'));

-- ---------- Pacientes y turnos ----------
-- Solo datos administrativos mínimos. Sin DNI, sin motivo de consulta, sin datos clínicos.
create table public.patients (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (char_length(full_name) between 2 and 120),
  -- Obligatorio en reservas online; puede faltar si la médica carga un turno tomado por teléfono.
  email       text check (email is null or (email = lower(email) and char_length(email) <= 254 and email like '%_@_%._%')),
  phone       text check (char_length(phone) <= 40),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Un mismo correo puede reservar para distintas personas (ej.: madre e hijos).
-- Sin correo no hay deduplicación: cada carga manual crea su registro.
create unique index patients_email_name_key on public.patients (email, lower(full_name));

create table public.appointments (
  id                      uuid primary key default gen_random_uuid(),
  specialty_id            uuid not null references public.specialties (id),
  patient_id              uuid not null references public.patients (id),
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null,
  buffer_minutes          integer not null default 0 check (buffer_minutes between 0 and 120),
  blocked_until           timestamptz not null,            -- ends_at + descanso: rango que ocupa en la agenda
  status                  public.appointment_status not null,
  source                  text not null check (source in ('online', 'admin')),
  hold_expires_at         timestamptz,
  verification_code_hash  text,
  verification_attempts   integer not null default 0,
  verification_sends      integer not null default 0,
  manage_token_salt       text not null,
  manage_token_hash       text not null unique,
  version                 integer not null default 1,      -- aumenta con cada reprogramación
  admin_note              text check (char_length(admin_note) <= 500),
  confirmed_at            timestamptz,
  cancelled_at            timestamptz,
  cancelled_by            text check (cancelled_by in ('patient', 'admin', 'system')),
  cancellation_reason     text check (char_length(cancellation_reason) <= 300),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (ends_at > starts_at),
  check (blocked_until >= ends_at),
  check (status <> 'pending_verification' or hold_expires_at is not null),
  -- Garantía final contra superposiciones y reservas simultáneas: dos turnos
  -- activos no pueden ocupar el mismo rango de tiempo, aunque sean de distinta
  -- especialidad (una sola profesional, un solo consultorio).
  constraint appointments_no_overlap exclude using gist (
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status in ('pending_verification', 'confirmed', 'completed', 'no_show'))
);
create index appointments_starts_at_idx on public.appointments (starts_at);
create index appointments_status_starts_idx on public.appointments (status, starts_at);
create index appointments_patient_idx on public.appointments (patient_id);
create index appointments_pending_hold_idx on public.appointments (hold_expires_at)
  where status = 'pending_verification';

-- ---------- Notificaciones ----------
create table public.notification_jobs (
  id                    uuid primary key default gen_random_uuid(),
  appointment_id        uuid not null references public.appointments (id) on delete cascade,
  kind                  public.notification_kind not null,
  -- Clave de idempotencia: impide crear dos veces la misma notificación
  -- (ej.: 'reminder:<turno>:v2') y se envía al proveedor como Idempotency-Key.
  idempotency_key       text not null unique,
  appointment_version   integer not null,
  run_at                timestamptz not null,
  status                public.job_status not null default 'pending',
  attempts              integer not null default 0,
  max_attempts          integer not null default 5 check (max_attempts between 1 and 20),
  last_error            text,
  locked_at             timestamptz,
  sent_at               timestamptz,
  provider_message_id   text,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index notification_jobs_due_idx on public.notification_jobs (run_at) where status in ('pending', 'processing');
create index notification_jobs_appointment_idx on public.notification_jobs (appointment_id);
create index notification_jobs_status_idx on public.notification_jobs (status, updated_at desc);

-- Un registro por intento de envío. No guarda el contenido del correo.
create table public.notification_logs (
  id                   bigint generated always as identity primary key,
  job_id               uuid not null references public.notification_jobs (id) on delete cascade,
  attempt              integer not null,
  outcome              text not null check (outcome in ('sent', 'failed', 'skipped', 'cancelled')),
  provider_message_id  text,
  error                text,
  created_at           timestamptz not null default now()
);
create index notification_logs_job_idx on public.notification_logs (job_id, created_at);

create table public.email_templates (
  kind        public.notification_kind primary key,
  subject     text not null check (char_length(subject) between 3 and 150),
  body        text not null check (char_length(body) between 1 and 4000),
  updated_at  timestamptz not null default now()
);

-- ---------- Auditoría ----------
create table public.audit_logs (
  id             bigint generated always as identity primary key,
  actor_type     text not null check (actor_type in ('admin', 'patient', 'system')),
  actor_user_id  uuid references auth.users (id) on delete set null,
  action         text not null,
  entity         text not null,
  entity_id      uuid,
  details        jsonb not null default '{}'::jsonb,   -- sin datos personales
  created_at     timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id, created_at desc);

-- ---------- Límite de solicitudes (formularios públicos) ----------
create table public.rate_limits (
  bucket        text not null,          -- hash, nunca la IP o el correo en claro
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger clinic_settings_touch before update on public.clinic_settings for each row execute function public.touch_updated_at();
create trigger specialties_touch before update on public.specialties for each row execute function public.touch_updated_at();
create trigger patients_touch before update on public.patients for each row execute function public.touch_updated_at();
create trigger appointments_touch before update on public.appointments for each row execute function public.touch_updated_at();
create trigger notification_jobs_touch before update on public.notification_jobs for each row execute function public.touch_updated_at();
create trigger email_templates_touch before update on public.email_templates for each row execute function public.touch_updated_at();
