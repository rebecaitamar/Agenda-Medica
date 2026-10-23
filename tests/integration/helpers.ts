import { sql } from "@/lib/db";
import { addDays, isoWeekdayOf, localDate } from "@/lib/time";
import { MockResend } from "../support/mock-resend";

export const TZ = "America/Argentina/Buenos_Aires";
export const actor = { type: "admin" as const, userId: "00000000-0000-0000-0000-00000000a001" };

export async function startMail() {
  const mail = await new MockResend().start();
  process.env.RESEND_API_BASE_URL = `http://127.0.0.1:${mail.port}`;
  return mail;
}

export async function resetData() {
  await sql`truncate notification_logs, notification_jobs, audit_logs, appointments, patients, availability_exceptions, availability_rules, rate_limits restart identity cascade`;
  await sql`update clinic_settings set require_email_verification = true, phone_required = false, allow_patient_cancel = true,
            allow_patient_reschedule = true, patient_change_min_hours = 24, reminder_hours_before = 48, hold_minutes = 15,
            address_line = 'Av. Siempreviva 742', city = 'Rosario', timezone = ${TZ}`;
  await sql`update profiles set full_name = 'Ana Prueba', honorific = 'Dra.'`;
  await sql`update specialties set duration_minutes = case slug when 'medicina-clinica' then 30 else 20 end,
            buffer_minutes = 0, min_notice_hours = 2, max_advance_days = 60, active = true`;
  await sql`insert into auth.users (id, email) values (${actor.userId}, 'dra@example.test') on conflict do nothing`;
}

export async function specialty(slug: "medicina-clinica" | "dermatologia") {
  const [s] = await sql<{ id: string; slug: string }[]>`select id, slug from specialties where slug = ${slug}`;
  return s;
}

/** Un día hábil (lunes a viernes) al menos `minDays` días hacia adelante, en hora local. */
export function futureWeekday(minDays: number) {
  let d = addDays(localDate(new Date(), TZ), minDays);
  while (isoWeekdayOf(d) > 5) d = addDays(d, 1);
  return d;
}

/** Instante UTC de una hora local de Buenos Aires (UTC−3, sin horario de verano). */
export function at(day: string, hhmm: string) {
  return new Date(`${day}T${hhmm}:00-03:00`);
}

const NAMES = ["María José Prueba", "Juan Pérez", "Lucía Fernández", "Martín Gómez", "Sofía Núñez"];
export const patient = (n = 1) => ({
  fullName: NAMES[(n - 1) % NAMES.length],
  email: `paciente${n}@example.test`,
  phone: "+54 9 341 555-0000",
  acceptPrivacy: true,
});
