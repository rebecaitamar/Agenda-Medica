import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, isPgError, PG_EXCLUSION_VIOLATION } from "../db";
import { audit, type Actor } from "../audit";
import { isSlotAvailable } from "../availability";
import { upsertPatient } from "../booking";
import { manageToken, manageTokenHash, randomToken } from "../crypto";
import { onCancelled, onConfirmed, onRescheduled } from "../notifications/schedule";
import { loadSiteConfig, type Specialty } from "../settings";
import { email as emailSchema, firstIssue, isoInstant, personName, phone } from "../validation";

export class AdminError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isPgError(e, PG_EXCLUSION_VIOLATION)) {
      throw new AdminError("Ese horario se superpone con otro turno. Elegí otro horario.", "startsAt");
    }
    throw e;
  }
}

async function specialtyById(id: string) {
  const [s] = await sql<Specialty[]>`select * from specialties where id = ${id}`;
  if (!s) throw new AdminError("Especialidad inexistente", "specialtyId");
  return s;
}

const createSchema = z.object({
  specialtyId: z.uuid({ error: "Elegí una especialidad" }),
  startsAt: isoInstant,
  fullName: personName,
  email: z.union([z.literal(""), emailSchema]).optional().default(""),
  phone: phone.optional().default(""),
  adminNote: z.string().max(500, "La nota administrativa admite hasta 500 caracteres").optional().default(""),
  allowOutsideRules: z.boolean().optional().default(false),
  notify: z.boolean().optional().default(true),
});

export async function createManualAppointment(input: unknown, actor: Actor) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const i = firstIssue(parsed.error);
    throw new AdminError(i.message, i.field);
  }
  const d = parsed.data;
  const { settings } = await loadSiteConfig();
  const spec = await specialtyById(d.specialtyId);
  if (d.startsAt.getTime() <= Date.now()) throw new AdminError("El horario debe ser futuro.", "startsAt");

  const id = randomUUID();
  const salt = randomToken();
  const endsAt = new Date(d.startsAt.getTime() + spec.durationMinutes * 60_000);
  const blockedUntil = new Date(endsAt.getTime() + spec.bufferMinutes * 60_000);

  return guard(() =>
    sql.begin(async (tx) => {
      await tx`select expire_stale_holds()`;
      if (!d.allowOutsideRules) {
        const ok = await isSlotAvailable(spec.id, d.startsAt, settings.timezone, { enforceBookingWindow: false }, tx);
        if (!ok) throw new AdminError("Ese horario no está disponible en la agenda. Elegí uno libre o marcá “horario fuera de agenda”.", "startsAt");
      }
      const patientId = await upsertPatient(tx, { fullName: d.fullName, email: d.email || null, phone: d.phone || null });
      await tx`
        insert into appointments (
          id, specialty_id, patient_id, starts_at, ends_at, buffer_minutes, blocked_until, status, source,
          manage_token_salt, manage_token_hash, admin_note, confirmed_at
        ) values (
          ${id}, ${spec.id}, ${patientId}, ${d.startsAt}, ${endsAt}, ${spec.bufferMinutes}, ${blockedUntil},
          'confirmed', 'admin', ${salt}, ${manageTokenHash(manageToken(id, salt))}, ${d.adminNote || null}, now()
        )`;
      const ref = { id, startsAt: d.startsAt, version: 1, hasEmail: Boolean(d.email) && d.notify };
      const jobIds = await onConfirmed(tx, ref, settings.reminderHoursBefore);
      await audit(actor, "appointment.created", "appointment", id, { specialty: spec.slug, outsideRules: d.allowOutsideRules, notify: d.notify }, tx);
      return { id, jobIds };
    }),
  );
}

const rescheduleSchema = z.object({
  startsAt: isoInstant,
  specialtyId: z.uuid().optional(),
  allowOutsideRules: z.boolean().optional().default(false),
  notify: z.boolean().optional().default(true),
});

export async function rescheduleAppointment(id: string, input: unknown, actor: Actor) {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    const i = firstIssue(parsed.error);
    throw new AdminError(i.message, i.field);
  }
  const d = parsed.data;
  const { settings } = await loadSiteConfig();
  if (d.startsAt.getTime() <= Date.now()) throw new AdminError("El nuevo horario debe ser futuro.", "startsAt");

  return guard(() =>
    sql.begin(async (tx) => {
      const [a] = await tx<{ id: string; status: string; startsAt: Date; specialtyId: string; specialtyName: string; hasEmail: boolean }[]>`
        select a.id, a.status, a.starts_at, a.specialty_id, s.name as specialty_name, p.email is not null as has_email
        from appointments a join specialties s on s.id = a.specialty_id join patients p on p.id = a.patient_id
        where a.id = ${id} for update of a`;
      if (!a) throw new AdminError("El turno no existe.");
      if (a.status !== "confirmed") throw new AdminError("Solo se pueden reprogramar turnos confirmados.");
      const spec = await specialtyById(d.specialtyId ?? a.specialtyId);
      await tx`select expire_stale_holds()`;
      if (!d.allowOutsideRules) {
        const ok = await isSlotAvailable(spec.id, d.startsAt, settings.timezone, { ignoreAppointmentId: id, enforceBookingWindow: false }, tx);
        if (!ok) throw new AdminError("Ese horario no está disponible en la agenda. Elegí uno libre o marcá “horario fuera de agenda”.", "startsAt");
      }
      const endsAt = new Date(d.startsAt.getTime() + spec.durationMinutes * 60_000);
      const [u] = await tx<{ version: number }[]>`
        update appointments
           set starts_at = ${d.startsAt}, ends_at = ${endsAt}, specialty_id = ${spec.id},
               buffer_minutes = ${spec.bufferMinutes},
               blocked_until = ${new Date(endsAt.getTime() + spec.bufferMinutes * 60_000)},
               version = version + 1
         where id = ${id}
        returning version`;
      const jobIds = await onRescheduled(
        tx,
        { id, startsAt: d.startsAt, version: u.version, hasEmail: a.hasEmail && d.notify },
        { startsAt: a.startsAt, specialtyName: a.specialtyName },
        settings.reminderHoursBefore,
        d.notify,
      );
      await audit(
        actor,
        "appointment.rescheduled",
        "appointment",
        id,
        { from: a.startsAt, to: d.startsAt, specialtyChanged: spec.id !== a.specialtyId, newSpecialty: spec.slug, notify: d.notify },
        tx,
      );
      return { jobIds };
    }),
  );
}

export async function cancelAppointment(id: string, input: { reason?: string; notify?: boolean }, actor: Actor) {
  const reason = (input.reason ?? "").trim().slice(0, 300) || null;
  const notify = input.notify ?? true;
  return sql.begin(async (tx) => {
    const [a] = await tx<{ status: string; startsAt: Date; version: number; hasEmail: boolean }[]>`
      select a.status, a.starts_at, a.version, p.email is not null as has_email
      from appointments a join patients p on p.id = a.patient_id where a.id = ${id} for update of a`;
    if (!a) throw new AdminError("El turno no existe.");
    if (a.status !== "confirmed" && a.status !== "pending_verification") throw new AdminError("Este turno ya no está activo.");
    await tx`
      update appointments
         set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin', cancellation_reason = ${reason},
             hold_expires_at = null, verification_code_hash = null
       where id = ${id}`;
    const jobIds = await onCancelled(
      tx,
      { id, startsAt: a.startsAt, version: a.version, hasEmail: a.hasEmail && notify && a.status === "confirmed" },
      reason,
      notify && a.status === "confirmed",
    );
    await audit(actor, "appointment.cancelled", "appointment", id, { by: "admin", notify, withReason: Boolean(reason) }, tx);
    return { jobIds };
  });
}

/** Realizada / ausente / volver a confirmado (para corregir un error de carga). */
export async function setAttendance(id: string, status: "completed" | "no_show" | "confirmed", actor: Actor) {
  return sql.begin(async (tx) => {
    const [a] = await tx<{ status: string; startsAt: Date }[]>`select status, starts_at from appointments where id = ${id} for update`;
    if (!a) throw new AdminError("El turno no existe.");
    const allowed =
      status === "confirmed" ? ["completed", "no_show"].includes(a.status) : ["confirmed", "completed", "no_show"].includes(a.status);
    if (!allowed) throw new AdminError("No se puede cambiar el estado de este turno.");
    if (status !== "confirmed" && a.startsAt.getTime() > Date.now()) {
      throw new AdminError("Solo se puede marcar como realizada o ausente una consulta que ya comenzó.");
    }
    await tx`update appointments set status = ${status}::appointment_status where id = ${id}`;
    await audit(actor, `appointment.${status === "confirmed" ? "reverted" : status}`, "appointment", id, { from: a.status }, tx);
  });
}

export async function updateAdminNote(id: string, note: string, actor: Actor) {
  const v = note.trim();
  if (v.length > 500) throw new AdminError("La nota administrativa admite hasta 500 caracteres.", "adminNote");
  await sql`update appointments set admin_note = ${v || null} where id = ${id}`;
  await audit(actor, "appointment.note_updated", "appointment", id, {});
}

export async function updatePatientContact(id: string, input: { fullName: unknown; email: unknown; phone: unknown }, actor: Actor) {
  const parsed = z
    .object({ fullName: personName, email: z.union([z.literal(""), emailSchema]), phone })
    .safeParse(input);
  if (!parsed.success) {
    const i = firstIssue(parsed.error);
    throw new AdminError(i.message, i.field);
  }
  try {
    await sql`
      update patients set full_name = ${parsed.data.fullName}, email = ${parsed.data.email || null}, phone = ${parsed.data.phone || null}
      where id = ${id}`;
  } catch (e) {
    if (isPgError(e, "23505")) throw new AdminError("Ya existe un paciente con ese nombre y correo.", "email");
    throw e;
  }
  await audit(actor, "patient.updated", "patient", id, {});
}
