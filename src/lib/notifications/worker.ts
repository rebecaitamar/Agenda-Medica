import "server-only";
import { sql } from "../db";
import { EmailError, sendEmail } from "../email/provider";
import type { NotificationKind } from "../email/templates";
import { composeEmail, loadAppointmentForEmail } from "./compose";

/**
 * Procesador de la cola de notificaciones.
 * - Toma trabajos vencidos con FOR UPDATE SKIP LOCKED: dos ejecuciones
 *   simultáneas nunca procesan el mismo trabajo.
 * - Antes de enviar verifica que el turno siga vigente y que no haya cambiado.
 * - Reintenta con espera creciente; cada intento queda en notification_logs.
 */

type Job = {
  id: string;
  appointmentId: string;
  kind: NotificationKind;
  idempotencyKey: string;
  appointmentVersion: number;
  runAt: Date;
  status: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
};

export type RunSummary = { processed: number; sent: number; failed: number; retrying: number; skipped: number };

/** Un recordatorio no se envía si su horario programado pasó hace más de esto (no se mandan tarde). */
const REMINDER_GRACE_MS = 6 * 3_600_000;
const STALE_LOCK = "10 minutes";

function backoffMinutes(attempt: number) {
  return Math.min(5 * 2 ** (attempt - 1), 240); // 5, 10, 20, 40… hasta 4 h
}

async function claim(opts: { ids?: string[]; limit: number }): Promise<Job[]> {
  return sql<Job[]>`
    with c as (
      select id from notification_jobs
      where kind <> 'verification_code'
        and (
          (status = 'pending' and run_at <= now())
          or (status = 'processing' and locked_at < now() - ${STALE_LOCK}::interval)
        )
        ${opts.ids ? sql`and id = any(${opts.ids}::uuid[])` : sql``}
      order by run_at
      limit ${opts.limit}
      for update skip locked
    )
    update notification_jobs j
       set status = 'processing', locked_at = now(), attempts = j.attempts + 1
      from c
     where j.id = c.id
    returning j.*`;
}

async function finish(job: Job, outcome: "sent" | "skipped" | "cancelled", info: { providerId?: string; reason?: string }) {
  await sql.begin(async (tx) => {
    await tx`
      update notification_jobs
         set status = ${outcome}::job_status,
             locked_at = null,
             sent_at = ${outcome === "sent" ? tx`now()` : tx`sent_at`},
             provider_message_id = ${info.providerId ?? null},
             last_error = ${info.reason ?? null}
       where id = ${job.id}`;
    await tx`
      insert into notification_logs (job_id, attempt, outcome, provider_message_id, error)
      values (${job.id}, ${job.attempts}, ${outcome}, ${info.providerId ?? null}, ${info.reason ?? null})`;
  });
}

async function fail(job: Job, err: unknown): Promise<"failed" | "retrying"> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const retryable = !(err instanceof EmailError) || err.retryable;
  const giveUp = !retryable || job.attempts >= job.maxAttempts;
  await sql.begin(async (tx) => {
    await tx`
      update notification_jobs
         set status = ${giveUp ? "failed" : "pending"}::job_status,
             locked_at = null,
             last_error = ${message},
             run_at = ${giveUp ? tx`run_at` : tx`now() + make_interval(mins => ${backoffMinutes(job.attempts)})`}
       where id = ${job.id}`;
    await tx`
      insert into notification_logs (job_id, attempt, outcome, error)
      values (${job.id}, ${job.attempts}, 'failed', ${message})`;
  });
  return giveUp ? "failed" : "retrying";
}

/** Decide si el trabajo sigue teniendo sentido. Devuelve el motivo para omitirlo o null. */
function staleReason(job: Job, a: { status: string; version: number; startsAt: Date }) {
  const now = Date.now();
  switch (job.kind) {
    case "reminder":
      if (a.status !== "confirmed") return { outcome: "cancelled" as const, reason: "El turno ya no está vigente" };
      if (a.version !== job.appointmentVersion) return { outcome: "cancelled" as const, reason: "El turno fue reprogramado" };
      if (a.startsAt.getTime() <= now) return { outcome: "skipped" as const, reason: "El turno ya comenzó" };
      if (now - job.runAt.getTime() > REMINDER_GRACE_MS)
        return { outcome: "skipped" as const, reason: "Recordatorio vencido: no se envía con atraso" };
      return null;
    case "confirmation":
      if (a.status !== "confirmed" && a.status !== "completed")
        return { outcome: "cancelled" as const, reason: "El turno ya no está confirmado" };
      return null;
    case "rescheduled":
      if (a.status !== "confirmed") return { outcome: "cancelled" as const, reason: "El turno ya no está vigente" };
      if (a.version !== job.appointmentVersion) return { outcome: "skipped" as const, reason: "Hubo una reprogramación posterior" };
      return null;
    case "cancelled":
      if (a.status !== "cancelled") return { outcome: "cancelled" as const, reason: "El turno no está cancelado" };
      return null;
    default:
      return { outcome: "skipped" as const, reason: "Tipo de notificación no procesable por la cola" };
  }
}

async function deliver(job: Job): Promise<keyof Omit<RunSummary, "processed">> {
  try {
    const a = await loadAppointmentForEmail(job.appointmentId);
    if (!a) {
      await finish(job, "cancelled", { reason: "El turno no existe" });
      return "skipped";
    }
    const stale = staleReason(job, a);
    if (stale) {
      await finish(job, stale.outcome, { reason: stale.reason });
      return "skipped";
    }
    const email = await composeEmail(job.kind, a, { payload: job.payload });
    const suffix = typeof job.payload.keySuffix === "string" ? `:${job.payload.keySuffix}` : "";
    const { id } = await sendEmail({ to: a.patientEmail, ...email, idempotencyKey: `${job.idempotencyKey}${suffix}` });
    await finish(job, "sent", { providerId: id });
    return "sent";
  } catch (e) {
    return fail(job, e);
  }
}

async function run(jobs: Job[]): Promise<RunSummary> {
  const summary: RunSummary = { processed: 0, sent: 0, failed: 0, retrying: 0, skipped: 0 };
  for (const job of jobs) {
    summary.processed++;
    summary[await deliver(job)]++;
  }
  return summary;
}

/** Tarea programada: procesa todo lo vencido. */
export async function runDueNotifications(limit = 50): Promise<RunSummary> {
  await sql`select expire_stale_holds()`;
  await sql`delete from rate_limits where window_start < now() - interval '2 days'`;
  return run(await claim({ limit }));
}

/** Envío inmediato de trabajos recién creados (confirmación, cambios). Si falla, la tarea programada reintenta. */
export async function dispatchJobs(ids: string[]): Promise<RunSummary> {
  if (!ids.length) return { processed: 0, sent: 0, failed: 0, retrying: 0, skipped: 0 };
  return run(await claim({ ids, limit: ids.length }));
}

/** Reintento manual desde el panel (solo trabajos fallidos). */
export async function retryJob(id: string) {
  const [job] = await sql<Job[]>`
    update notification_jobs
       set status = 'pending',
           run_at = now(),
           max_attempts = least(attempts + 3, 20),
           last_error = null,
           -- Se conserva la misma clave de idempotencia (Resend no duplica). Solo si el
           -- proveedor rechazó la clave se usa una nueva, porque la médica lo pidió explícitamente.
           payload = case when last_error like 'Resend rechazó la clave%'
                          then payload || jsonb_build_object('keySuffix', 'manual-' || (attempts + 1))
                          else payload end
     where id = ${id} and status = 'failed' and kind <> 'verification_code'
    returning *`;
  if (!job) return null;
  return dispatchJobs([job.id]);
}
