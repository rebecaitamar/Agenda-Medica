import "server-only";
import { sql, type Db } from "../db";
import { env } from "../env";
import { manageToken } from "../crypto";
import { renderEmail, type EmailContext, type NotificationKind } from "../email/templates";
import { doctorDisplayName, fullAddress, loadSiteConfig } from "../settings";
import { formatLongDate, formatTime } from "../time";

export type AppointmentForEmail = {
  id: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  version: number;
  manageTokenSalt: string;
  patientName: string;
  patientEmail: string;
  specialtyName: string;
};

export async function loadAppointmentForEmail(id: string, db: Db = sql) {
  const [a] = await db<AppointmentForEmail[]>`
    select a.id, a.status, a.starts_at, a.ends_at, a.version, a.manage_token_salt,
           p.full_name as patient_name, p.email as patient_email, s.name as specialty_name
    from appointments a
    join patients p on p.id = a.patient_id
    join specialties s on s.id = a.specialty_id
    where a.id = ${id}`;
  return a ?? null;
}

export function manageUrlFor(a: { id: string; manageTokenSalt: string }) {
  return `${env.appUrl}/turno/${manageToken(a.id, a.manageTokenSalt)}`;
}

export async function composeEmail(
  kind: NotificationKind,
  a: AppointmentForEmail,
  extra: { code?: string; payload?: Record<string, unknown> } = {},
  db: Db = sql,
) {
  const { settings, profile } = await loadSiteConfig(db);
  const [tpl] = await db<{ subject: string; body: string }[]>`select subject, body from email_templates where kind = ${kind}::notification_kind`;
  if (!tpl) throw new Error(`No existe la plantilla de correo "${kind}"`);

  const tz = settings.timezone;
  const doctor = doctorDisplayName(profile) ?? settings.appName;
  const address = fullAddress(settings);
  const contact = [settings.contactPhone && `Tel. ${settings.contactPhone}`, settings.contactWhatsapp && `WhatsApp ${settings.contactWhatsapp}`, settings.contactEmail]
    .filter(Boolean)
    .join(", ");
  const prev = typeof extra.payload?.previousStartsAt === "string" ? new Date(extra.payload.previousStartsAt) : null;
  const reason = typeof extra.payload?.reason === "string" && extra.payload.reason ? `Motivo: ${extra.payload.reason}` : "";

  const vars: Record<string, string> = {
    paciente: a.patientName,
    medica: doctor,
    especialidad: a.specialtyName,
    fecha: formatLongDate(a.startsAt, tz),
    hora: formatTime(a.startsAt, tz),
    direccion: address ?? "",
    indicaciones: settings.arrivalInstructions ?? "",
    contacto: contact,
    codigo: extra.code ?? "",
    minutos_retencion: String(settings.holdMinutes),
    fecha_anterior: prev ? formatLongDate(prev, tz) : "",
    hora_anterior: prev ? formatTime(prev, tz) : "",
    motivo: reason,
  };

  const details: EmailContext["details"] = [
    { label: "Profesional", value: doctor },
    { label: "Especialidad", value: a.specialtyName },
    { label: "Fecha", value: vars.fecha },
    { label: "Hora", value: `${vars.hora} h` },
    ...(address ? [{ label: "Dirección", value: address }] : []),
  ];

  const canManage =
    (settings.allowPatientCancel || settings.allowPatientReschedule) &&
    ["confirmation", "reminder", "rescheduled"].includes(kind);

  const ctx: EmailContext = {
    appName: settings.appName,
    vars,
    details: kind === "cancelled" ? details.filter((d) => d.label !== "Dirección") : details,
    code: kind === "verification_code" ? extra.code : undefined,
    manageUrl: canManage ? manageUrlFor(a) : null,
    mapsUrl: kind === "cancelled" || kind === "verification_code" ? null : settings.mapsUrl,
    footer: `Recibiste este correo porque se solicitó un turno con tu dirección en ${settings.appName}. Tus datos se usan únicamente para gestionar tus turnos.`,
  };
  return renderEmail(tpl.subject, tpl.body, ctx);
}
