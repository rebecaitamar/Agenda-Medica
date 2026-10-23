import Link from "next/link";
import type { Metadata } from "next";
import { nowMs } from "@/lib/clock";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { appointmentDetail } from "@/lib/admin/queries";
import { getSiteConfig, listSpecialties } from "@/lib/settings";
import { formatDate, formatLongDate, formatTime, localDate } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { JobBadge, KIND_LABEL, StatusBadge } from "@/components/admin/badges";
import { SlotField } from "@/components/admin/slot-field";
import { Notice } from "@/components/notice";
import { attendanceAction, cancelAction, noteAction, patientContactAction, rescheduleAction, retryNotificationAction } from "../../../actions";

export const metadata: Metadata = { title: "Detalle del turno" };

const ACTION_LABEL: Record<string, string> = {
  "booking.hold_created": "Reserva online iniciada (esperando verificación del correo)",
  "booking.confirmed": "Turno confirmado",
  "appointment.created": "Turno creado desde el panel",
  "appointment.rescheduled": "Turno reprogramado",
  "appointment.cancelled": "Turno cancelado",
  "appointment.completed": "Consulta marcada como realizada",
  "appointment.no_show": "Ausencia registrada",
  "appointment.reverted": "Volvió a estado confirmado",
  "appointment.note_updated": "Nota administrativa actualizada",
};

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ creado?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { creado } = await searchParams;
  const [a, { settings }, specialties] = await Promise.all([appointmentDetail(id), getSiteConfig(), listSpecialties()]);
  if (!a) notFound();
  const tz = settings.timezone;
  const started = a.startsAt.getTime() <= nowMs();
  const active = a.status === "confirmed";
  const today = localDate(new Date(), tz);

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/admin/agenda?vista=dia&fecha=${localDate(a.startsAt, tz)}`} className="text-sm text-ink-soft hover:text-ink">
          ← Volver a la agenda del día
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl font-semibold">{a.patientName}</h1>
          <StatusBadge status={a.status} />
        </div>
        <p className="mt-1 text-lg first-letter:uppercase">
          {formatLongDate(a.startsAt, tz)}, {formatTime(a.startsAt, tz)} a {formatTime(a.endsAt, tz)} h. {a.specialtyName}
        </p>
      </div>

      {creado && <Notice tone="success" role="status">Turno creado.</Notice>}

      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-8">
          {active && (
            <section className="panel p-5 sm:p-6" aria-labelledby="reprogramar">
              <h2 id="reprogramar" className="mb-4 font-semibold">Reprogramar o cambiar especialidad</h2>
              <ActionForm action={rescheduleAction} className="space-y-5">
                <input type="hidden" name="id" value={a.id} />
                <SlotField
                  specialties={specialties.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }))}
                  defaultSpecialtyId={a.specialtyId}
                  defaultDay={localDate(a.startsAt, tz) < today ? today : localDate(a.startsAt, tz)}
                  ignoreAppointmentId={a.id}
                  minDay={today}
                />
                <label className="flex items-center gap-2 text-[15px]">
                  <input type="checkbox" name="notify" defaultChecked={Boolean(a.patientEmail)} disabled={!a.patientEmail} className="h-4 w-4 accent-sage-700" />
                  Avisar al paciente por correo{!a.patientEmail ? " (no tiene correo registrado)" : ""}
                </label>
                <SubmitButton pending="Reprogramando…">Reprogramar turno</SubmitButton>
              </ActionForm>
            </section>
          )}

          {(active || a.status === "pending_verification") && (
            <section className="panel p-5 sm:p-6" aria-labelledby="cancelar">
              <h2 id="cancelar" className="mb-4 font-semibold">Cancelar turno</h2>
              <ActionForm action={cancelAction} className="space-y-4" confirm="¿Cancelar este turno? El horario quedará libre.">
                <input type="hidden" name="id" value={a.id} />
                <div>
                  <label htmlFor="reason" className="field-label">Motivo para el paciente <span className="font-normal text-ink-soft">(opcional)</span></label>
                  <input id="reason" name="reason" maxLength={300} className="input" placeholder="Ej.: la profesional no atenderá ese día" />
                </div>
                <label className="flex items-center gap-2 text-[15px]">
                  <input type="checkbox" name="notify" defaultChecked={Boolean(a.patientEmail)} disabled={!a.patientEmail || !active} className="h-4 w-4 accent-sage-700" />
                  Avisar al paciente por correo
                </label>
                <SubmitButton className="btn-danger" pending="Cancelando…">Cancelar turno</SubmitButton>
              </ActionForm>
            </section>
          )}

          {["confirmed", "completed", "no_show"].includes(a.status) && started && (
            <section className="panel p-5 sm:p-6" aria-labelledby="asistencia">
              <h2 id="asistencia" className="mb-4 font-semibold">Asistencia</h2>
              <div className="flex flex-wrap gap-3">
                {a.status !== "completed" && (
                  <ActionForm action={attendanceAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="status" value="completed" />
                    <SubmitButton>Marcar como realizada</SubmitButton>
                  </ActionForm>
                )}
                {a.status !== "no_show" && (
                  <ActionForm action={attendanceAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="status" value="no_show" />
                    <SubmitButton className="btn-secondary">Registrar ausencia</SubmitButton>
                  </ActionForm>
                )}
                {a.status !== "confirmed" && (
                  <ActionForm action={attendanceAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="status" value="confirmed" />
                    <SubmitButton className="btn-quiet">Deshacer</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </section>
          )}

          {a.status === "cancelled" && (
            <Notice tone="warning" title="Turno cancelado">
              {a.cancelledBy === "patient" ? "Lo canceló el paciente" : "Se canceló desde el panel"}
              {a.cancelledAt ? ` el ${formatDate(a.cancelledAt, tz)} a las ${formatTime(a.cancelledAt, tz)} h` : ""}.
              {a.cancellationReason ? ` Motivo: ${a.cancellationReason}` : ""}
            </Notice>
          )}

          <section aria-labelledby="historial">
            <h2 id="historial" className="mb-3 font-semibold">Historial</h2>
            <ol className="panel divide-y divide-line">
              {a.history.map((h, i) => {
                const d = h.details as { from?: string; to?: string; by?: string };
                return (
                  <li key={i} className="px-5 py-3 text-[15px]">
                    <p className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</p>
                    <p className="text-sm text-ink-soft">
                      {formatDate(h.createdAt, tz)} {formatTime(h.createdAt, tz)} h.{" "}
                      {h.actorType === "patient" ? "Por el paciente" : h.actorType === "admin" ? "Desde el panel" : "Sistema"}
                      {d.from && d.to ? `. De ${formatDate(d.from, tz)} ${formatTime(d.from, tz)} a ${formatDate(d.to, tz)} ${formatTime(d.to, tz)} h` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <div className="space-y-8">
          <section className="panel p-5 sm:p-6" aria-labelledby="paciente">
            <h2 id="paciente" className="mb-4 font-semibold">Datos del paciente</h2>
            <ActionForm action={patientContactAction} className="space-y-4">
              <input type="hidden" name="patientId" value={a.patientId} />
              <div>
                <label htmlFor="p-name" className="field-label">Nombre y apellido</label>
                <input id="p-name" name="fullName" defaultValue={a.patientName} className="input" required />
              </div>
              <div>
                <label htmlFor="p-email" className="field-label">Correo electrónico</label>
                <input id="p-email" name="email" type="email" defaultValue={a.patientEmail ?? ""} className="input" />
              </div>
              <div>
                <label htmlFor="p-phone" className="field-label">Teléfono</label>
                <input id="p-phone" name="phone" type="tel" defaultValue={a.patientPhone ?? ""} className="input" />
              </div>
              <SubmitButton className="btn-secondary">Guardar datos</SubmitButton>
            </ActionForm>
          </section>

          <section className="panel p-5 sm:p-6" aria-labelledby="nota">
            <h2 id="nota" className="mb-4 font-semibold">Nota administrativa</h2>
            <ActionForm action={noteAction} className="space-y-3">
              <input type="hidden" name="id" value={a.id} />
              <label htmlFor="adminNote" className="sr-only">Nota administrativa</label>
              <textarea id="adminNote" name="adminNote" rows={3} maxLength={500} defaultValue={a.adminNote ?? ""} className="input" aria-describedby="nota-hint" />
              <p id="nota-hint" className="field-hint">No registres información clínica.</p>
              <SubmitButton className="btn-secondary">Guardar nota</SubmitButton>
            </ActionForm>
          </section>

          <section aria-labelledby="notif">
            <h2 id="notif" className="mb-3 font-semibold">Correos de este turno</h2>
            {a.jobs.length === 0 ? (
              <p className="text-ink-soft">Sin correos.</p>
            ) : (
              <ul className="panel divide-y divide-line">
                {a.jobs.map((j) => (
                  <li key={j.id} className="px-5 py-3 text-[15px]">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{KIND_LABEL[j.kind] ?? j.kind}</span>
                      <JobBadge status={j.status} />
                    </p>
                    <p className="text-sm text-ink-soft">
                      {j.status === "sent" && j.sentAt
                        ? `Enviado el ${formatDate(j.sentAt, tz)} a las ${formatTime(j.sentAt, tz)} h`
                        : j.status === "pending"
                          ? `Programado para el ${formatDate(j.runAt, tz)} a las ${formatTime(j.runAt, tz)} h`
                          : j.lastError ?? ""}
                    </p>
                    {j.status === "failed" && (
                      <ActionForm action={retryNotificationAction} className="mt-2">
                        <input type="hidden" name="id" value={j.id} />
                        <SubmitButton className="btn-secondary min-h-9 text-sm" pending="Reintentando…">Reintentar envío</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {a.otherVisits.length > 0 && (
            <section aria-labelledby="otros">
              <h2 id="otros" className="mb-3 font-semibold">Otros turnos del paciente</h2>
              <ul className="panel divide-y divide-line">
                {a.otherVisits.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/turnos/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[15px] hover:bg-sage-50">
                      <span>{formatDate(o.startsAt, tz)} {formatTime(o.startsAt, tz)} h, {o.specialtyName}</span>
                      <StatusBadge status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-sm text-ink-soft">
            Creado el {formatDate(a.createdAt, tz)} a las {formatTime(a.createdAt, tz)} h {a.source === "online" ? "por reserva online" : "desde el panel"}.
          </p>
        </div>
      </div>
    </div>
  );
}
