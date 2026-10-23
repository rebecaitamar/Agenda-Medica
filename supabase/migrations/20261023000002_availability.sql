-- =====================================================================
-- Motor de disponibilidad
-- Los horarios se generan a partir de availability_rules (hora local del
-- consultorio) y se descartan los que chocan con bloqueos o turnos activos.
-- Se evalúa siempre en el servidor/base de datos; la interfaz solo muestra
-- el resultado.
-- =====================================================================

create or replace function public.clinic_timezone() returns text
language sql stable set search_path = public as $$
  select coalesce((select timezone from public.clinic_settings where id), 'America/Argentina/Buenos_Aires')
$$;

-- Devuelve los horarios reservables de una especialidad entre dos fechas locales.
--   p_ignore_appointment: permite reprogramar un turno sin que choque consigo mismo.
--   p_enforce_booking_window: false para el panel (la médica puede agendar sin
--     respetar anticipación mínima ni horizonte máximo).
create or replace function public.available_slots(
  p_specialty_id uuid,
  p_from date,
  p_to date,
  p_now timestamptz default now(),
  p_ignore_appointment uuid default null,
  p_enforce_booking_window boolean default true
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = public as $$
  with cfg as (
    select public.clinic_timezone() as tz
  ),
  s as (
    select sp.id, sp.duration_minutes, sp.buffer_minutes, sp.min_notice_hours, sp.max_advance_days
    from public.specialties sp
    where sp.id = p_specialty_id and sp.active
  ),
  days as (
    select d::date as day
    from generate_series(p_from::timestamp, least(p_to, p_from + 400)::timestamp, interval '1 day') d
  ),
  windows as (
    select ((dd.day + r.start_time) at time zone cfg.tz) as w_start,
           ((dd.day + r.end_time)   at time zone cfg.tz) as w_end
    from days dd
    cross join cfg
    join public.availability_rules r
      on r.specialty_id = p_specialty_id
     and r.weekday = extract(isodow from dd.day)
  ),
  slots as (
    select distinct g as st
    from windows w
    cross join s
    cross join lateral generate_series(
      w.w_start,
      w.w_end - make_interval(mins => s.duration_minutes),
      make_interval(mins => s.duration_minutes + s.buffer_minutes)
    ) g
  )
  select sl.st as starts_at, sl.st + make_interval(mins => s.duration_minutes) as ends_at
  from slots sl
  cross join s
  cross join cfg
  where sl.st > p_now
    and (
      not p_enforce_booking_window
      or (
        sl.st >= p_now + make_interval(hours => s.min_notice_hours)
        and (sl.st at time zone cfg.tz)::date <= (p_now at time zone cfg.tz)::date + s.max_advance_days
      )
    )
    and not exists (
      select 1 from public.availability_exceptions e
      where (e.specialty_id is null or e.specialty_id = s.id)
        and tstzrange(e.starts_at, e.ends_at, '[)')
            && tstzrange(sl.st, sl.st + make_interval(mins => s.duration_minutes), '[)')
    )
    and not exists (
      select 1 from public.appointments a
      where a.status in ('pending_verification', 'confirmed', 'completed', 'no_show')
        and not (a.status = 'pending_verification' and a.hold_expires_at <= p_now)
        and a.id is distinct from p_ignore_appointment
        and tstzrange(a.starts_at, a.blocked_until, '[)')
            && tstzrange(sl.st, sl.st + make_interval(mins => s.duration_minutes + s.buffer_minutes), '[)')
    )
  order by 1
$$;

-- Marca como vencidas las retenciones sin verificar. Se ejecuta antes de cada
-- reserva y periódicamente desde la tarea programada.
create or replace function public.expire_stale_holds() returns integer
language plpgsql set search_path = public as $$
declare n integer;
begin
  update public.appointments
     set status = 'expired', verification_code_hash = null
   where status = 'pending_verification' and hold_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Ventanas fijas para el límite de solicitudes.
create or replace function public.hit_rate_limit(p_bucket text, p_window_seconds integer)
returns integer
language sql set search_path = public as $$
  insert into public.rate_limits as r (bucket, window_start, hits)
  values (
    p_bucket,
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
    1
  )
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits
$$;
