import "server-only";

export type NotificationKind = "verification_code" | "confirmation" | "reminder" | "rescheduled" | "cancelled";

export const TEMPLATE_LABELS: Record<NotificationKind, string> = {
  verification_code: "Código de verificación",
  confirmation: "Confirmación de turno",
  reminder: "Recordatorio",
  rescheduled: "Reprogramación",
  cancelled: "Cancelación",
};

export const TEMPLATE_VARIABLES: Record<string, string> = {
  paciente: "Nombre del paciente",
  medica: "Nombre de la médica",
  especialidad: "Especialidad",
  fecha: "Fecha del turno (ej.: jueves 29/10/2026)",
  hora: "Hora del turno (24 h)",
  direccion: "Dirección del consultorio",
  indicaciones: "Indicaciones para asistir",
  contacto: "Datos de contacto",
  codigo: "Código de verificación (solo en ese correo)",
  minutos_retencion: "Minutos que se retiene el horario",
  fecha_anterior: "Fecha anterior (reprogramación)",
  hora_anterior: "Hora anterior (reprogramación)",
  motivo: "Motivo de la cancelación, si se indicó",
};

export type EmailContext = {
  appName: string;
  vars: Record<string, string>;
  details: { label: string; value: string }[];
  code?: string;
  manageUrl?: string | null;
  mapsUrl?: string | null;
  footer: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function fillTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function renderEmail(subjectTpl: string, bodyTpl: string, ctx: EmailContext) {
  const subject = fillTemplate(subjectTpl, ctx.vars).replace(/\s+/g, " ").trim();
  const paras = paragraphs(fillTemplate(bodyTpl, ctx.vars));

  const green = "#2E5E4E";
  const ink = "#1E2B27";
  const muted = "#5B6B65";

  const htmlParas = paras
    .map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${ink}">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const codeBlock = ctx.code
    ? `<p style="margin:8px 0 20px;font-size:32px;letter-spacing:8px;font-weight:700;color:${green};font-family:Menlo,Consolas,monospace">${esc(ctx.code)}</p>`
    : "";

  const detailRows = ctx.details
    .map(
      (d) => `<tr>
        <td style="padding:6px 12px 6px 0;font-size:14px;color:${muted};vertical-align:top;white-space:nowrap">${esc(d.label)}</td>
        <td style="padding:6px 0;font-size:15px;color:${ink};font-weight:600">${esc(d.value)}</td>
      </tr>`,
    )
    .join("");

  const detailsBlock = ctx.details.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;background:#EEF5F1;border-radius:10px;margin:6px 0 20px"><tr><td style="padding:14px 18px"><table role="presentation" style="border-collapse:collapse">${detailRows}</table></td></tr></table>`
    : "";

  const mapsLink = ctx.mapsUrl
    ? `<p style="margin:0 0 14px;font-size:14px"><a href="${esc(ctx.mapsUrl)}" style="color:${green}">Ver ubicación en el mapa</a></p>`
    : "";

  const manage = ctx.manageUrl
    ? `<p style="margin:8px 0 18px"><a href="${esc(ctx.manageUrl)}" style="display:inline-block;background:${green};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600">Ver o modificar mi turno</a></p>`
    : "";

  const contact = ctx.vars.contacto
    ? `<p style="margin:0 0 6px;font-size:14px;color:${muted}">Contacto: ${esc(ctx.vars.contacto)}</p>`
    : "";

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F6F4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" style="width:100%;border-collapse:collapse;background:#F3F6F4"><tr><td style="padding:24px 12px">
<table role="presentation" style="max-width:560px;margin:0 auto;width:100%;border-collapse:collapse;background:#ffffff;border-radius:14px">
<tr><td style="padding:22px 26px 6px;font-size:15px;font-weight:700;color:${green}">${esc(ctx.appName)}</td></tr>
<tr><td style="padding:10px 26px 20px">${htmlParas}${codeBlock}${detailsBlock}${mapsLink}${manage}${contact}</td></tr>
</table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:${muted};text-align:center">${esc(ctx.footer)}</p>
</td></tr></table></body></html>`;

  const text = [
    ctx.appName,
    "",
    ...paras.flatMap((p) => [p, ""]),
    ...(ctx.code ? [`Código: ${ctx.code}`, ""] : []),
    ...ctx.details.map((d) => `${d.label}: ${d.value}`),
    ...(ctx.mapsUrl ? ["", `Mapa: ${ctx.mapsUrl}`] : []),
    ...(ctx.manageUrl ? ["", `Ver o modificar mi turno: ${ctx.manageUrl}`] : []),
    ...(ctx.vars.contacto ? ["", `Contacto: ${ctx.vars.contacto}`] : []),
    "",
    ctx.footer,
  ].join("\n");

  return { subject, html, text };
}
