import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { notificationList } from "@/lib/admin/queries";
import { env } from "@/lib/env";
import { TEMPLATE_LABELS, TEMPLATE_VARIABLES, type NotificationKind } from "@/lib/email/templates";
import { getSiteConfig } from "@/lib/settings";
import { formatDate, formatTime } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { JobBadge, KIND_LABEL } from "@/components/admin/badges";
import { Notice } from "@/components/notice";
import { retryNotificationAction, saveTemplateAction } from "../../actions";

export const metadata: Metadata = { title: "Correos" };

const FILTERS = [
  ["", "Todos"], ["failed", "Fallidos"], ["pending", "Programados"], ["sent", "Enviados"], ["skipped", "Omitidos"], ["cancelled", "Cancelados"],
] as const;

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  await requireAdmin();
  const { estado } = await searchParams;
  const { settings } = await getSiteConfig();
  const tz = settings.timezone;
  const [jobs, templates, [lastCron]] = await Promise.all([
    notificationList(estado),
    sql<{ kind: NotificationKind; subject: string; body: string }[]>`select kind, subject, body from email_templates order by kind`,
    sql<{ at: Date | null }[]>`select max(created_at) as at from notification_logs where outcome <> 'failed'`,
  ]);
  const hasKey = Boolean(env.resendApiKey);
  const hasFrom = Boolean(env.emailFrom);
  const hasCron = Boolean(env.cronSecret);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Correos</h1>
        <p className="mt-1 text-ink-soft">Estado de las confirmaciones, recordatorios y avisos. Los recordatorios se envían {settings.reminderHoursBefore} h antes de cada turno.</p>
      </div>

      <section aria-labelledby="estado" className="grid gap-3 sm:grid-cols-3">
        <h2 id="estado" className="sr-only">Configuración</h2>
        <div className={`panel px-5 py-4 ${hasKey ? "" : "border-danger/40 bg-danger-50"}`}>
          <p className="text-sm text-ink-soft">Proveedor de correo (Resend)</p>
          <p className="font-semibold">{hasKey ? "Clave configurada" : "Falta RESEND_API_KEY"}</p>
        </div>
        <div className={`panel px-5 py-4 ${hasFrom ? "" : "border-danger/40 bg-danger-50"}`}>
          <p className="text-sm text-ink-soft">Remitente</p>
          <p className="break-all font-semibold">{hasFrom ? env.emailFrom : "Falta EMAIL_FROM"}</p>
        </div>
        <div className={`panel px-5 py-4 ${hasCron ? "" : "border-danger/40 bg-danger-50"}`}>
          <p className="text-sm text-ink-soft">Tarea programada</p>
          <p className="font-semibold">{hasCron ? "CRON_SECRET configurado" : "Falta CRON_SECRET"}</p>
          {lastCron?.at && <p className="text-sm text-ink-soft">Último envío procesado: {formatDate(lastCron.at, tz)} {formatTime(lastCron.at, tz)} h</p>}
        </div>
      </section>
      {(!hasKey || !hasFrom) && (
        <Notice tone="warning" title="Los correos no se están enviando">
          Mientras falte la configuración, cada intento queda registrado como fallido. Cuando la completes, podés reintentarlos desde esta lista.
        </Notice>
      )}

      <section aria-labelledby="registro">
        <h2 id="registro" className="text-lg font-semibold">Registro de envíos</h2>
        <nav aria-label="Filtrar por estado" className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map(([v, l]) => (
            <Link
              key={v}
              href={v ? `/admin/correos?estado=${v}` : "/admin/correos"}
              aria-current={(estado ?? "") === v ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${(estado ?? "") === v ? "border-sage-700 bg-sage-700 text-white" : "border-line-strong bg-surface hover:bg-sage-50"}`}
            >
              {l}
            </Link>
          ))}
        </nav>
        {jobs.length === 0 ? (
          <p className="panel mt-3 px-5 py-6 text-ink-soft">No hay correos en esta categoría.</p>
        ) : (
          <div className="panel mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[15px]">
              <thead className="border-b border-line text-sm text-ink-soft">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Tipo</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Paciente y turno</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Estado</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Detalle</th>
                  <th scope="col" className="px-5 py-2.5 font-medium"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="px-5 py-3">{KIND_LABEL[j.kind] ?? j.kind}</td>
                    <td className="px-3 py-3">
                      <Link href={`/admin/turnos/${j.appointmentId}`} className="hover:underline">{j.patientName}</Link>
                      <span className="block text-sm text-ink-soft tabular-nums">{formatDate(j.startsAt, tz)} {formatTime(j.startsAt, tz)} h</span>
                    </td>
                    <td className="px-3 py-3"><JobBadge status={j.status} /></td>
                    <td className="px-3 py-3 text-sm text-ink-soft">
                      {j.status === "sent" && j.sentAt && `Enviado ${formatDate(j.sentAt, tz)} ${formatTime(j.sentAt, tz)} h`}
                      {j.status === "pending" && `Programado ${formatDate(j.runAt, tz)} ${formatTime(j.runAt, tz)} h${j.attempts ? `, intento ${j.attempts + 1} de ${j.maxAttempts}` : ""}`}
                      {j.lastError && <span className="block">{j.lastError}</span>}
                    </td>
                    <td className="px-5 py-3">
                      {j.status === "failed" && j.kind !== "verification_code" && (
                        <ActionForm action={retryNotificationAction}>
                          <input type="hidden" name="id" value={j.id} />
                          <SubmitButton className="btn-secondary min-h-9 px-3 text-sm" pending="Reintentando…">Reintentar</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="plantillas">
        <h2 id="plantillas" className="text-lg font-semibold">Plantillas</h2>
        <p className="mt-1 max-w-[70ch] text-[15px] text-ink-soft">
          El texto se completa con los datos de cada turno. Además, todos los correos incluyen siempre un recuadro con profesional, especialidad,
          fecha, hora y dirección.
        </p>
        <details className="mt-3 text-[15px]">
          <summary className="cursor-pointer font-semibold text-sage-700">Variables disponibles</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {Object.entries(TEMPLATE_VARIABLES).map(([k, v]) => (
              <li key={k}><code className="rounded bg-sand px-1.5 py-0.5 text-sm">{`{{${k}}}`}</code> {v}</li>
            ))}
          </ul>
        </details>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {templates.map((t) => (
            <ActionForm key={t.kind} action={saveTemplateAction} className="panel space-y-4 p-5">
              <h3 className="font-semibold">{TEMPLATE_LABELS[t.kind]}</h3>
              <input type="hidden" name="kind" value={t.kind} />
              <div>
                <label htmlFor={`subj-${t.kind}`} className="field-label">Asunto</label>
                <input id={`subj-${t.kind}`} name="subject" defaultValue={t.subject} maxLength={150} className="input" required />
              </div>
              <div>
                <label htmlFor={`body-${t.kind}`} className="field-label">Texto</label>
                <textarea id={`body-${t.kind}`} name="body" defaultValue={t.body} rows={7} maxLength={4000} className="input" required />
              </div>
              <SubmitButton className="btn-secondary">Guardar plantilla</SubmitButton>
            </ActionForm>
          ))}
        </div>
      </section>
    </div>
  );
}
