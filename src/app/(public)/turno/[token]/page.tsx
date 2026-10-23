import type { Metadata } from "next";
import { nowMs } from "@/lib/clock";
import { findByManageToken, patientChangePolicy } from "@/lib/booking";
import { doctorDisplayName, fullAddress, getSiteConfig } from "@/lib/settings";
import { formatLongDate, formatTime, localDate } from "@/lib/time";
import { ManageAppointment } from "@/components/booking/manage-appointment";
import { Notice } from "@/components/notice";

export const metadata: Metadata = { title: "Mi turno", robots: { index: false, follow: false } };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "info" }> = {
  confirmed: { label: "Confirmado", tone: "success" },
  cancelled: { label: "Cancelado", tone: "warning" },
  completed: { label: "Consulta realizada", tone: "info" },
  no_show: { label: "No asististe a este turno", tone: "warning" },
  expired: { label: "La reserva no se confirmó y venció", tone: "warning" },
  pending_verification: { label: "Pendiente de verificación", tone: "info" },
};

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [a, { settings, profile }] = await Promise.all([findByManageToken(token), getSiteConfig()]);
  const tz = settings.timezone;

  if (!a) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <h1 className="font-serif text-3xl font-semibold">Enlace no válido</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          No encontramos un turno para este enlace. Revisá que hayas abierto el enlace completo del correo de confirmación.
        </p>
      </div>
    );
  }

  const policy = patientChangePolicy(a, settings);
  const status = STATUS[a.status] ?? { label: a.status, tone: "info" as const };
  const address = fullAddress(settings);
  const past = a.startsAt.getTime() < nowMs();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-serif text-3xl font-semibold">Hola, {a.patientFirstName}</h1>
      <p className="mt-2 text-ink-soft">Este es el detalle de tu turno.</p>

      <dl className="panel mt-6 divide-y divide-line">
        {[
          ["Estado", status.label],
          ["Profesional", doctorDisplayName(profile) ?? settings.appName],
          ["Especialidad", a.specialtyName],
          ["Fecha", formatLongDate(a.startsAt, tz)],
          ["Hora", `${formatTime(a.startsAt, tz)} h`],
          ...(address ? [["Dirección", address]] : []),
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-5 py-3">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="text-right font-semibold first-letter:uppercase">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        {a.status === "confirmed" && !past && (
          <ManageAppointment
            token={token}
            tz={tz}
            specialtySlug={a.specialtySlug}
            canCancel={policy.canCancel}
            canReschedule={policy.canReschedule}
            initialMonth={localDate(new Date(), tz).slice(0, 7)}
          />
        )}
        {policy.tooLate && (
          <Notice tone="info">
            Los cambios online se aceptan hasta {settings.patientChangeMinHours} h antes del turno. Para modificarlo, comunicate con el consultorio
            {settings.contactPhone ? ` al ${settings.contactPhone}` : ""}.
          </Notice>
        )}
        {a.status === "confirmed" && !past && !policy.canCancel && !policy.canReschedule && !policy.tooLate && (
          <Notice tone="info">
            Para cancelar o cambiar este turno, comunicate con el consultorio{settings.contactPhone ? ` al ${settings.contactPhone}` : ""}.
          </Notice>
        )}
        {settings.cancellationPolicyText && a.status === "confirmed" && (
          <p className="mt-6 text-[15px] leading-relaxed whitespace-pre-line text-ink-soft">{settings.cancellationPolicyText}</p>
        )}
      </div>
    </div>
  );
}
