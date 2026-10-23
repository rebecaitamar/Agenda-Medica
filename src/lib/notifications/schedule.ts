import "server-only";
import type { Db } from "../db";

/**
 * Programación de notificaciones. Todas las funciones se ejecutan dentro de la
 * misma transacción que modifica el turno, así el turno y sus correos quedan
 * siempre consistentes. Los trabajos se guardan en notification_jobs (cola
 * persistente) y los procesa la tarea programada del servidor; sobreviven a
 * reinicios y despliegues.
 */

/** hasEmail = false cuando el paciente no tiene correo (turno cargado por teléfono). */
type ApptRef = { id: string; startsAt: Date; version: number; hasEmail: boolean };

const NO_EMAIL = "El paciente no tiene correo registrado";

async function insertJob(
  db: Db,
  j: { appointmentId: string; kind: string; key: string; version: number; runAt: Date | "now"; status?: string; lastError?: string; payload?: Record<string, unknown>; noEmail?: boolean },
): Promise<string | null> {
  if (j.noEmail) {
    j = { ...j, status: "skipped", lastError: NO_EMAIL };
  }
  const rows = await db<{ id: string }[]>`
    insert into notification_jobs (appointment_id, kind, idempotency_key, appointment_version, run_at, status, last_error, payload)
    values (
      ${j.appointmentId}, ${j.kind}::notification_kind, ${j.key}, ${j.version},
      ${j.runAt === "now" ? db`now()` : db`${j.runAt}`},
      ${j.status ?? "pending"}::job_status, ${j.lastError ?? null}, ${db.json((j.payload ?? {}) as never)}
    )
    on conflict (idempotency_key) do nothing
    returning id`;
  // Los trabajos omitidos también devuelven id; el despachador solo toma los pendientes.
  return rows[0]?.id ?? null;
}

/** Cancela recordatorios pendientes del turno (antes de reprogramar o al cancelar). */
async function cancelPending(db: Db, appointmentId: string, kinds: string[], reason: string) {
  await db`
    update notification_jobs
       set status = 'cancelled', last_error = ${reason}, locked_at = null
     where appointment_id = ${appointmentId}
       and status = 'pending'
       and kind = any(${kinds}::notification_kind[])`;
}

/**
 * Recordatorio N horas antes del inicio. Si el turno se reservó con menos
 * anticipación, se registra como "omitido" y no se envía un recordatorio atrasado.
 */
export async function scheduleReminder(db: Db, appt: ApptRef, hoursBefore: number) {
  await cancelPending(db, appt.id, ["reminder"], "Reemplazado por una nueva programación");
  const runAt = new Date(appt.startsAt.getTime() - hoursBefore * 3_600_000);
  const tooLate = runAt.getTime() <= Date.now();
  return insertJob(db, {
    noEmail: !appt.hasEmail,
    appointmentId: appt.id,
    kind: "reminder",
    key: `reminder:${appt.id}:v${appt.version}`,
    version: appt.version,
    runAt: tooLate ? "now" : runAt,
    status: tooLate ? "skipped" : "pending",
    lastError: tooLate
      ? `Turno reservado con menos de ${hoursBefore} h de anticipación: no corresponde enviar recordatorio`
      : undefined,
    payload: { hoursBefore },
  });
}

/** Turno confirmado: correo de confirmación inmediato + recordatorio. Devuelve los jobs a despachar ya. */
export async function onConfirmed(db: Db, appt: ApptRef, hoursBefore: number) {
  const id = await insertJob(db, {
    noEmail: !appt.hasEmail,
    appointmentId: appt.id,
    kind: "confirmation",
    key: `confirmation:${appt.id}`,
    version: appt.version,
    runAt: "now",
  });
  await scheduleReminder(db, appt, hoursBefore);
  return id ? [id] : [];
}

export async function onRescheduled(
  db: Db,
  appt: ApptRef,
  previous: { startsAt: Date; specialtyName: string },
  hoursBefore: number,
  notify: boolean,
) {
  await cancelPending(db, appt.id, ["rescheduled"], "Hubo una reprogramación posterior");
  const id = notify
    ? await insertJob(db, {
        noEmail: !appt.hasEmail,
        appointmentId: appt.id,
        kind: "rescheduled",
        key: `rescheduled:${appt.id}:v${appt.version}`,
        version: appt.version,
        runAt: "now",
        payload: { previousStartsAt: previous.startsAt.toISOString(), previousSpecialty: previous.specialtyName },
      })
    : null;
  await scheduleReminder(db, appt, hoursBefore);
  return id ? [id] : [];
}

export async function onCancelled(db: Db, appt: ApptRef, reason: string | null, notify: boolean) {
  await cancelPending(db, appt.id, ["reminder", "confirmation", "rescheduled"], "El turno fue cancelado");
  const id = notify
    ? await insertJob(db, {
        noEmail: !appt.hasEmail,
        appointmentId: appt.id,
        kind: "cancelled",
        key: `cancelled:${appt.id}:v${appt.version}`,
        version: appt.version,
        runAt: "now",
        payload: { reason },
      })
    : null;
  return id ? [id] : [];
}

/** Registro del código de verificación (se envía en línea, no por la cola). */
export async function createVerificationJob(db: Db, appt: ApptRef, sendNo: number) {
  return insertJob(db, {
    appointmentId: appt.id,
    kind: "verification_code",
    key: `verification:${appt.id}:${sendNo}`,
    version: appt.version,
    runAt: "now",
    status: "processing",
  });
}
