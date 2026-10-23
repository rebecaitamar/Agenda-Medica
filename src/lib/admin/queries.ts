import "server-only";
import { sql } from "../db";
import { getSlots } from "../availability";
import { emailConfigured } from "../email/provider";
import { addDays, endOfMonth, localDate, startOfMonth } from "../time";
import type { ClinicSettings, Profile, Specialty } from "../settings";

export type AgendaItem = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  source: string;
  patientName: string;
  specialtyId: string;
  specialtyName: string;
  specialtySort: number;
};

export const STATUS_LABEL: Record<string, string> = {
  pending_verification: "Esperando verificación",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Realizada",
  no_show: "Ausente",
  expired: "Vencido",
};

/** Turnos entre dos fechas locales (inclusive), en la zona del consultorio. */
export async function appointmentsBetween(from: string, to: string, tz: string, opts: { includeInactive?: boolean } = {}) {
  return sql<AgendaItem[]>`
    select a.id, a.starts_at, a.ends_at, a.status, a.source, p.full_name as patient_name,
           s.id as specialty_id, s.name as specialty_name, s.sort_order as specialty_sort
    from appointments a
    join patients p on p.id = a.patient_id
    join specialties s on s.id = a.specialty_id
    where a.starts_at >= (${from}::date::timestamp at time zone ${tz})
      and a.starts_at <  ((${to}::date + 1)::timestamp at time zone ${tz})
      and ${
        opts.includeInactive
          ? sql`a.status <> 'expired'`
          : sql`(a.status in ('confirmed', 'completed', 'no_show') or (a.status = 'pending_verification' and a.hold_expires_at > now()))`
      }
    order by a.starts_at`;
}

export async function dashboardData(tz: string, specialties: Specialty[]) {
  const today = localDate(new Date(), tz);
  const [todayItems, upcoming, byMonth, cancelled, notif, failed] = await Promise.all([
    appointmentsBetween(today, today, tz, { includeInactive: true }),
    sql<AgendaItem[]>`
      select a.id, a.starts_at, a.ends_at, a.status, a.source, p.full_name as patient_name,
             s.id as specialty_id, s.name as specialty_name, s.sort_order as specialty_sort
      from appointments a join patients p on p.id = a.patient_id join specialties s on s.id = a.specialty_id
      where a.status = 'confirmed'
        and a.starts_at >= ((${today}::date + 1)::timestamp at time zone ${tz})
        and a.starts_at <  ((${today}::date + 8)::timestamp at time zone ${tz})
      order by a.starts_at limit 30`,
    sql<{ specialtyId: string; total: number }[]>`
      select a.specialty_id, count(*)::int as total
      from appointments a
      where a.status in ('confirmed', 'completed', 'no_show')
        and a.starts_at >= (${startOfMonth(today)}::date::timestamp at time zone ${tz})
        and a.starts_at <  ((${endOfMonth(today)}::date + 1)::timestamp at time zone ${tz})
      group by a.specialty_id`,
    sql<(AgendaItem & { cancelledAt: Date; cancelledBy: string | null })[]>`
      select a.id, a.starts_at, a.ends_at, a.status, a.source, p.full_name as patient_name,
             s.id as specialty_id, s.name as specialty_name, s.sort_order as specialty_sort, a.cancelled_at, a.cancelled_by
      from appointments a join patients p on p.id = a.patient_id join specialties s on s.id = a.specialty_id
      where a.status = 'cancelled' and a.cancelled_at > now() - interval '14 days'
      order by a.cancelled_at desc limit 10`,
    sql<{ pending: number; failed: number; sent7: number }[]>`
      select count(*) filter (where status in ('pending', 'processing'))::int as pending,
             count(*) filter (where status = 'failed')::int as failed,
             count(*) filter (where status = 'sent' and sent_at > now() - interval '7 days')::int as sent7
      from notification_jobs`,
    sql<{ id: string; kind: string; lastError: string | null; updatedAt: Date; appointmentId: string; patientName: string }[]>`
      select j.id, j.kind, j.last_error, j.updated_at, j.appointment_id, p.full_name as patient_name
      from notification_jobs j join appointments a on a.id = j.appointment_id join patients p on p.id = a.patient_id
      where j.status = 'failed' order by j.updated_at desc limit 5`,
  ]);
  const freeToday = await Promise.all(
    specialties.filter((s) => s.active).map(async (s) => ({
      specialty: s,
      slots: await getSlots(s.id, today, today, { enforceBookingWindow: false }),
    })),
  );
  return { today, todayItems, upcoming, byMonth, cancelled, notif: notif[0], failed, freeToday };
}

export async function appointmentDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [a] = await sql<
    (AgendaItem & {
      patientId: string;
      patientEmail: string | null;
      patientPhone: string | null;
      adminNote: string | null;
      createdAt: Date;
      confirmedAt: Date | null;
      cancelledAt: Date | null;
      cancelledBy: string | null;
      cancellationReason: string | null;
      version: number;
      holdExpiresAt: Date | null;
      durationMinutes: number;
    })[]
  >`
    select a.id, a.starts_at, a.ends_at, a.status, a.source, a.admin_note, a.created_at, a.confirmed_at, a.cancelled_at,
           a.cancelled_by, a.cancellation_reason, a.version, a.hold_expires_at,
           p.id as patient_id, p.full_name as patient_name, p.email as patient_email, p.phone as patient_phone,
           s.id as specialty_id, s.name as specialty_name, s.sort_order as specialty_sort, s.duration_minutes
    from appointments a join patients p on p.id = a.patient_id join specialties s on s.id = a.specialty_id
    where a.id = ${id}`;
  if (!a) return null;
  const [jobs, history, otherVisits] = await Promise.all([
    sql<{ id: string; kind: string; status: string; runAt: Date; sentAt: Date | null; attempts: number; lastError: string | null }[]>`
      select id, kind, status, run_at, sent_at, attempts, last_error from notification_jobs
      where appointment_id = ${id} order by created_at`,
    sql<{ action: string; actorType: string; details: Record<string, unknown>; createdAt: Date }[]>`
      select action, actor_type, details, created_at from audit_logs
      where entity = 'appointment' and entity_id = ${id} order by created_at desc limit 50`,
    sql<{ id: string; startsAt: Date; status: string; specialtyName: string }[]>`
      select a.id, a.starts_at, a.status, s.name as specialty_name
      from appointments a join specialties s on s.id = a.specialty_id
      where a.patient_id = ${a.patientId} and a.id <> ${id} and a.status <> 'expired'
      order by a.starts_at desc limit 10`,
  ]);
  return { ...a, jobs, history, otherVisits };
}

export async function notificationList(filter: string | undefined) {
  const status = ["pending", "processing", "sent", "failed", "cancelled", "skipped"].includes(filter ?? "") ? filter : null;
  return sql<
    { id: string; kind: string; status: string; runAt: Date; sentAt: Date | null; attempts: number; maxAttempts: number; lastError: string | null; appointmentId: string; patientName: string; startsAt: Date; updatedAt: Date }[]
  >`
    select j.id, j.kind, j.status, j.run_at, j.sent_at, j.attempts, j.max_attempts, j.last_error, j.updated_at,
           j.appointment_id, p.full_name as patient_name, a.starts_at
    from notification_jobs j join appointments a on a.id = j.appointment_id join patients p on p.id = a.patient_id
    where ${status ? sql`j.status = ${status}::job_status` : sql`true`}
    order by j.updated_at desc
    limit 150`;
}

export async function exceptionsList() {
  return sql<{ id: string; kind: string; startsAt: Date; endsAt: Date; reason: string | null; specialtyName: string | null }[]>`
    select e.id, e.kind, e.starts_at, e.ends_at, e.reason, s.name as specialty_name
    from availability_exceptions e left join specialties s on s.id = e.specialty_id
    where e.ends_at > now() - interval '30 days'
    order by e.starts_at`;
}

/** Lista de pendientes para la puesta en marcha (no inventa datos: solo señala lo que falta). */
export async function setupChecklist(settings: ClinicSettings, profile: Profile, specialties: Specialty[]) {
  const [rules] = await sql<{ n: number }[]>`select count(*)::int as n from availability_rules`;
  const items = [
    { done: Boolean(profile.fullName), label: "Nombre de la profesional", href: "/admin/configuracion" },
    { done: Boolean(settings.addressLine), label: "Dirección del consultorio", href: "/admin/configuracion" },
    { done: Boolean(settings.contactPhone || settings.contactEmail || settings.contactWhatsapp), label: "Datos de contacto", href: "/admin/configuracion" },
    { done: rules.n > 0 && specialties.some((s) => s.active), label: "Horarios de atención", href: "/admin/horarios" },
    { done: emailConfigured(), label: "Servicio de correo (RESEND_API_KEY y EMAIL_FROM)", href: "/admin/correos" },
    { done: Boolean(process.env.CRON_SECRET), label: "Tarea programada de recordatorios (CRON_SECRET)", href: "/admin/correos" },
  ];
  return items;
}

export function weekRange(day: string) {
  const iso = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  const from = addDays(day, 1 - iso);
  return { from, to: addDays(from, 6) };
}
