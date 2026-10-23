import "server-only";
import { randomUUID } from "node:crypto";
import { sql, isPgError, PG_EXCLUSION_VIOLATION, type Db, type Tx } from "./db";
import { audit } from "./audit";
import { isSlotAvailable } from "./availability";
import { hashCode, manageToken, manageTokenHash, randomToken, safeEqual, verificationCode } from "./crypto";
import { EmailError, sendEmail } from "./email/provider";
import { composeEmail, loadAppointmentForEmail } from "./notifications/compose";
import { createVerificationJob, onCancelled, onConfirmed, onRescheduled } from "./notifications/schedule";
import { fullAddress, loadSiteConfig, type ClinicSettings, type Specialty } from "./settings";
import { bookingSchema, firstIssue, maskEmail } from "./validation";

export type BookingErrorCode =
  | "invalid"
  | "slot_unavailable"
  | "expired"
  | "wrong_code"
  | "too_many_attempts"
  | "not_found"
  | "email_failed"
  | "not_allowed"
  | "too_late"
  | "resend_limit";

export class BookingError extends Error {
  constructor(
    public code: BookingErrorCode,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

const MAX_CODE_ATTEMPTS = 5;
const MAX_CODE_SENDS = 3;

export type ConfirmedSummary = {
  specialtyName: string;
  startsAt: string;
  endsAt: string;
  address: string | null;
  mapsUrl: string | null;
  arrivalInstructions: string | null;
  emailMasked: string | null;
  manageUrl: string;
};

export type StartResult =
  | { state: "verify"; bookingId: string; emailMasked: string; expiresAt: string }
  | { state: "confirmed"; summary: ConfirmedSummary; jobIds: string[] };

/** Pacientes: se reutiliza el registro si coinciden correo y nombre. */
export async function upsertPatient(db: Db, p: { fullName: string; email: string | null; phone: string | null }) {
  if (!p.email) {
    const [row] = await db<{ id: string }[]>`
      insert into patients (full_name, email, phone) values (${p.fullName}, null, ${p.phone}) returning id`;
    return row.id;
  }
  const [row] = await db<{ id: string }[]>`
    insert into patients (full_name, email, phone)
    values (${p.fullName}, ${p.email}, ${p.phone})
    on conflict (email, lower(full_name)) do update
      set phone = coalesce(excluded.phone, patients.phone), full_name = excluded.full_name
    returning id`;
  return row.id;
}

async function getSpecialtyBySlug(slug: string, db: Db = sql) {
  const [s] = await db<Specialty[]>`select * from specialties where slug = ${slug} and active`;
  return s ?? null;
}

function summaryFor(
  a: { id: string; manageTokenSalt: string; startsAt: Date; endsAt: Date; specialtyName: string; email: string | null },
  settings: ClinicSettings,
  baseUrl: string,
): ConfirmedSummary {
  return {
    specialtyName: a.specialtyName,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    address: fullAddress(settings),
    mapsUrl: settings.mapsUrl,
    arrivalInstructions: settings.arrivalInstructions,
    emailMasked: a.email ? maskEmail(a.email) : null,
    manageUrl: `${baseUrl}/turno/${manageToken(a.id, a.manageTokenSalt)}`,
  };
}

/** Mapea la violación de la restricción de exclusión (turno superpuesto) a un error comprensible. */
async function withSlotGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isPgError(e, PG_EXCLUSION_VIOLATION)) {
      throw new BookingError("slot_unavailable", "Ese horario se acaba de ocupar. Elegí otro, por favor.");
    }
    throw e;
  }
}

/**
 * Paso 7–8 del flujo: valida en el servidor, vuelve a comprobar la disponibilidad
 * y guarda el turno. Si la verificación de correo está activa, el horario queda
 * retenido unos minutos hasta que el paciente ingrese el código recibido.
 */
export async function startOnlineBooking(input: unknown, baseUrl: string): Promise<StartResult> {
  const { settings } = await loadSiteConfig();
  const parsed = bookingSchema(settings.phoneRequired).safeParse(input);
  if (!parsed.success) {
    const i = firstIssue(parsed.error);
    throw new BookingError("invalid", i.message, i.field);
  }
  const data = parsed.data;
  const spec = await getSpecialtyBySlug(data.specialty);
  if (!spec) throw new BookingError("invalid", "La especialidad elegida no está disponible.", "specialty");

  const id = randomUUID();
  const salt = randomToken();
  const tokenHash = manageTokenHash(manageToken(id, salt));
  const verify = settings.requireEmailVerification;
  const code = verify ? verificationCode() : null;
  const startsAt = data.startsAt;
  const endsAt = new Date(startsAt.getTime() + spec.durationMinutes * 60_000);
  const blockedUntil = new Date(endsAt.getTime() + spec.bufferMinutes * 60_000);

  const result = await withSlotGuard(() =>
    sql.begin(async (tx) => {
      await tx`select expire_stale_holds()`;
      if (!(await isSlotAvailable(spec.id, startsAt, settings.timezone, {}, tx))) {
        throw new BookingError("slot_unavailable", "Ese horario ya no está disponible. Elegí otro, por favor.");
      }
      const patientId = await upsertPatient(tx, { fullName: data.fullName, email: data.email, phone: data.phone || null });
      const [appt] = await tx<{ id: string; startsAt: Date; version: number; holdExpiresAt: Date | null }[]>`
        insert into appointments (
          id, specialty_id, patient_id, starts_at, ends_at, buffer_minutes, blocked_until, status, source,
          hold_expires_at, verification_code_hash, verification_sends, manage_token_salt, manage_token_hash, confirmed_at
        ) values (
          ${id}, ${spec.id}, ${patientId}, ${startsAt}, ${endsAt}, ${spec.bufferMinutes}, ${blockedUntil},
          ${verify ? "pending_verification" : "confirmed"}::appointment_status, 'online',
          ${verify ? tx`now() + make_interval(mins => ${settings.holdMinutes})` : null},
          ${code ? hashCode(id, code) : null}, ${verify ? 1 : 0}, ${salt}, ${tokenHash},
          ${verify ? null : tx`now()`}
        )
        returning id, starts_at, version, hold_expires_at`;
      const ref = { id: appt.id, startsAt: appt.startsAt, version: appt.version, hasEmail: true };
      if (verify) {
        const jobId = await createVerificationJob(tx, ref, 1);
        await audit({ type: "patient" }, "booking.hold_created", "appointment", id, { specialty: spec.slug }, tx);
        return { jobIds: [] as string[], verificationJobId: jobId, holdExpiresAt: appt.holdExpiresAt };
      }
      const jobIds = await onConfirmed(tx, ref, settings.reminderHoursBefore);
      await audit({ type: "patient" }, "booking.confirmed", "appointment", id, { specialty: spec.slug }, tx);
      return { jobIds, verificationJobId: null, holdExpiresAt: null };
    }),
  );

  if (verify && code && result.verificationJobId) {
    await sendVerificationCode(id, code, result.verificationJobId, 1);
    return {
      state: "verify",
      bookingId: id,
      emailMasked: maskEmail(data.email),
      expiresAt: result.holdExpiresAt!.toISOString(),
    };
  }

  return {
    state: "confirmed",
    jobIds: result.jobIds,
    summary: summaryFor(
      { id, manageTokenSalt: salt, startsAt, endsAt, specialtyName: spec.name, email: data.email },
      settings,
      baseUrl,
    ),
  };
}

/** Envía el código. Si no se puede enviar, libera el horario y lo informa al paciente. */
async function sendVerificationCode(appointmentId: string, code: string, jobId: string, attempt: number) {
  const a = await loadAppointmentForEmail(appointmentId);
  try {
    if (!a) throw new Error("Turno inexistente");
    const email = await composeEmail("verification_code", a, { code });
    const { id } = await sendEmail({ to: a.patientEmail, ...email, idempotencyKey: `verification:${appointmentId}:${attempt}` });
    await sql.begin(async (tx) => {
      await tx`update notification_jobs set status = 'sent', sent_at = now(), attempts = 1, provider_message_id = ${id} where id = ${jobId}`;
      await tx`insert into notification_logs (job_id, attempt, outcome, provider_message_id) values (${jobId}, 1, 'sent', ${id})`;
    });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await sql.begin(async (tx) => {
      await tx`update notification_jobs set status = 'failed', attempts = 1, last_error = ${message} where id = ${jobId}`;
      await tx`insert into notification_logs (job_id, attempt, outcome, error) values (${jobId}, 1, 'failed', ${message})`;
      await tx`update appointments set status = 'expired', verification_code_hash = null
               where id = ${appointmentId} and status = 'pending_verification'`;
    });
    console.error("[reserva] no se pudo enviar el código de verificación", { appointmentId, error: message });
    throw new BookingError(
      "email_failed",
      e instanceof EmailError && !e.retryable
        ? "En este momento no podemos enviar correos de verificación. Comunicate con el consultorio para pedir tu turno."
        : "No pudimos enviarte el código. Revisá tu correo electrónico e intentá de nuevo en unos minutos.",
    );
  }
}

type PendingRow = {
  id: string;
  status: string;
  holdExpired: boolean;
  verificationCodeHash: string | null;
  verificationAttempts: number;
  verificationSends: number;
  startsAt: Date;
  endsAt: Date;
  version: number;
  manageTokenSalt: string;
  specialtyName: string;
  email: string;
};

async function lockPending(tx: Tx, bookingId: string) {
  const [row] = await tx<PendingRow[]>`
    select a.id, a.status, a.hold_expires_at <= now() as hold_expired, a.verification_code_hash,
           a.verification_attempts, a.verification_sends, a.starts_at, a.ends_at, a.version, a.manage_token_salt,
           s.name as specialty_name, p.email
    from appointments a
    join specialties s on s.id = a.specialty_id
    join patients p on p.id = a.patient_id
    where a.id = ${bookingId}
    for update of a`;
  return row ?? null;
}

/** Paso de verificación: el paciente ingresa el código recibido por correo. */
export async function verifyBooking(input: { bookingId?: unknown; code?: unknown }, baseUrl: string) {
  const bookingId = typeof input.bookingId === "string" && /^[0-9a-f-]{36}$/i.test(input.bookingId) ? input.bookingId : null;
  const code = typeof input.code === "string" ? input.code.replace(/\D/g, "") : "";
  if (!bookingId) throw new BookingError("not_found", "No encontramos la reserva. Volvé a elegir un horario.");
  if (code.length !== 6) throw new BookingError("wrong_code", "El código tiene 6 números.", "code");

  const { settings } = await loadSiteConfig();
  const outcome = await sql.begin(async (tx) => {
    const row = await lockPending(tx, bookingId);
    if (!row || row.status !== "pending_verification") return { kind: "not_found" as const };
    if (row.holdExpired) {
      await tx`update appointments set status = 'expired', verification_code_hash = null where id = ${row.id}`;
      return { kind: "expired" as const };
    }
    if (!row.verificationCodeHash || !safeEqual(row.verificationCodeHash, hashCode(row.id, code))) {
      const attempts = row.verificationAttempts + 1;
      const exhausted = attempts >= MAX_CODE_ATTEMPTS;
      await tx`
        update appointments
           set verification_attempts = ${attempts},
               status = ${exhausted ? "expired" : "pending_verification"}::appointment_status,
               verification_code_hash = ${exhausted ? null : row.verificationCodeHash}
         where id = ${row.id}`;
      return { kind: exhausted ? ("too_many" as const) : ("wrong" as const), remaining: MAX_CODE_ATTEMPTS - attempts };
    }
    await tx`
      update appointments
         set status = 'confirmed', confirmed_at = now(), hold_expires_at = null, verification_code_hash = null
       where id = ${row.id}`;
    const jobIds = await onConfirmed(tx, { id: row.id, startsAt: row.startsAt, version: row.version, hasEmail: true }, settings.reminderHoursBefore);
    await audit({ type: "patient" }, "booking.confirmed", "appointment", row.id, { verified: true }, tx);
    return { kind: "ok" as const, row, jobIds };
  });

  switch (outcome.kind) {
    case "not_found":
      throw new BookingError("not_found", "Esta reserva ya no está pendiente. Si no recibiste la confirmación, elegí un horario nuevamente.");
    case "expired":
      throw new BookingError("expired", "Pasó el tiempo para confirmar y el horario se liberó. Elegí un horario nuevamente.");
    case "too_many":
      throw new BookingError("too_many_attempts", "Ingresaste un código incorrecto demasiadas veces. Elegí un horario nuevamente.");
    case "wrong":
      throw new BookingError(
        "wrong_code",
        `El código no es correcto. Te ${outcome.remaining === 1 ? "queda 1 intento" : `quedan ${outcome.remaining} intentos`}.`,
        "code",
      );
  }
  const r = outcome.row;
  return {
    jobIds: outcome.jobIds,
    summary: summaryFor(
      { id: r.id, manageTokenSalt: r.manageTokenSalt, startsAt: r.startsAt, endsAt: r.endsAt, specialtyName: r.specialtyName, email: r.email },
      settings,
      baseUrl,
    ),
  };
}

export async function resendVerificationCode(input: { bookingId?: unknown }) {
  const bookingId = typeof input.bookingId === "string" && /^[0-9a-f-]{36}$/i.test(input.bookingId) ? input.bookingId : null;
  if (!bookingId) throw new BookingError("not_found", "No encontramos la reserva.");
  const code = verificationCode();
  const res = await sql.begin(async (tx) => {
    const row = await lockPending(tx, bookingId);
    if (!row || row.status !== "pending_verification" || row.holdExpired) return { kind: "not_found" as const };
    if (row.verificationSends >= MAX_CODE_SENDS) return { kind: "limit" as const };
    const sendNo = row.verificationSends + 1;
    await tx`
      update appointments
         set verification_code_hash = ${hashCode(row.id, code)}, verification_sends = ${sendNo}, verification_attempts = 0
       where id = ${row.id}`;
    const jobId = await createVerificationJob(tx, { id: row.id, startsAt: row.startsAt, version: row.version, hasEmail: true }, sendNo);
    return { kind: "ok" as const, jobId: jobId!, sendNo };
  });
  if (res.kind === "not_found") throw new BookingError("expired", "La reserva venció. Elegí un horario nuevamente.");
  if (res.kind === "limit") throw new BookingError("resend_limit", "Ya enviamos el código varias veces. Revisá la carpeta de spam o elegí un horario nuevamente.");
  await sendVerificationCode(bookingId, code, res.jobId, res.sendNo);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Gestión del turno por parte del paciente (enlace seguro del correo)
// ---------------------------------------------------------------------------

export type ManagedAppointment = {
  id: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  specialtyId: string;
  specialtySlug: string;
  specialtyName: string;
  patientFirstName: string;
  version: number;
  hasEmail: boolean;
};

export async function findByManageToken(token: string, db: Db = sql) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [a] = await db<ManagedAppointment[]>`
    select a.id, a.status, a.starts_at, a.ends_at, a.version, a.specialty_id,
           s.slug as specialty_slug, s.name as specialty_name,
           split_part(p.full_name, ' ', 1) as patient_first_name,
           p.email is not null as has_email
    from appointments a
    join specialties s on s.id = a.specialty_id
    join patients p on p.id = a.patient_id
    where a.manage_token_hash = ${manageTokenHash(token)}`;
  return a ?? null;
}

export function patientChangePolicy(a: Pick<ManagedAppointment, "status" | "startsAt">, s: ClinicSettings) {
  const hoursLeft = (a.startsAt.getTime() - Date.now()) / 3_600_000;
  const active = a.status === "confirmed" && hoursLeft > 0;
  const inTime = hoursLeft >= s.patientChangeMinHours;
  return {
    canCancel: active && s.allowPatientCancel && inTime,
    canReschedule: active && s.allowPatientReschedule && inTime,
    tooLate: active && !inTime && (s.allowPatientCancel || s.allowPatientReschedule),
  };
}

export async function cancelByPatient(token: string) {
  const { settings } = await loadSiteConfig();
  return sql.begin(async (tx) => {
    const a = await findByManageToken(token, tx);
    if (!a) throw new BookingError("not_found", "El enlace no es válido.");
    await tx`select 1 from appointments where id = ${a.id} for update`;
    const policy = patientChangePolicy(a, settings);
    if (!policy.canCancel) {
      throw new BookingError(
        policy.tooLate ? "too_late" : "not_allowed",
        policy.tooLate
          ? `Las cancelaciones online se aceptan hasta ${settings.patientChangeMinHours} h antes. Comunicate con el consultorio.`
          : "Este turno no se puede cancelar desde la web.",
      );
    }
    await tx`
      update appointments
         set status = 'cancelled', cancelled_at = now(), cancelled_by = 'patient'
       where id = ${a.id} and status = 'confirmed'`;
    const jobIds = await onCancelled(tx, { id: a.id, startsAt: a.startsAt, version: a.version, hasEmail: a.hasEmail }, null, true);
    await audit({ type: "patient" }, "appointment.cancelled", "appointment", a.id, { by: "patient" }, tx);
    return { jobIds };
  });
}

export async function rescheduleByPatient(token: string, newStartsAtIso: unknown) {
  const { settings } = await loadSiteConfig();
  if (typeof newStartsAtIso !== "string" || Number.isNaN(Date.parse(newStartsAtIso))) {
    throw new BookingError("invalid", "Elegí un horario.");
  }
  const newStart = new Date(newStartsAtIso);
  return withSlotGuard(() =>
    sql.begin(async (tx) => {
      const a = await findByManageToken(token, tx);
      if (!a) throw new BookingError("not_found", "El enlace no es válido.");
      const [locked] = await tx<{ durationMinutes: number; bufferMinutes: number }[]>`
        select s.duration_minutes, s.buffer_minutes
        from appointments ap join specialties s on s.id = ap.specialty_id
        where ap.id = ${a.id} for update of ap`;
      const policy = patientChangePolicy(a, settings);
      if (!policy.canReschedule) {
        throw new BookingError(
          policy.tooLate ? "too_late" : "not_allowed",
          policy.tooLate
            ? `Los cambios online se aceptan hasta ${settings.patientChangeMinHours} h antes. Comunicate con el consultorio.`
            : "Este turno no se puede reprogramar desde la web.",
        );
      }
      await tx`select expire_stale_holds()`;
      if (!(await isSlotAvailable(a.specialtyId, newStart, settings.timezone, { ignoreAppointmentId: a.id }, tx))) {
        throw new BookingError("slot_unavailable", "Ese horario ya no está disponible. Elegí otro, por favor.");
      }
      const endsAt = new Date(newStart.getTime() + locked.durationMinutes * 60_000);
      const [u] = await tx<{ version: number }[]>`
        update appointments
           set starts_at = ${newStart}, ends_at = ${endsAt},
               buffer_minutes = ${locked.bufferMinutes},
               blocked_until = ${new Date(endsAt.getTime() + locked.bufferMinutes * 60_000)},
               version = version + 1
         where id = ${a.id}
        returning version`;
      const jobIds = await onRescheduled(
        tx,
        { id: a.id, startsAt: newStart, version: u.version, hasEmail: a.hasEmail },
        { startsAt: a.startsAt, specialtyName: a.specialtyName },
        settings.reminderHoursBefore,
        true,
      );
      await audit({ type: "patient" }, "appointment.rescheduled", "appointment", a.id, { by: "patient", from: a.startsAt, to: newStart }, tx);
      return { jobIds };
    }),
  );
}
