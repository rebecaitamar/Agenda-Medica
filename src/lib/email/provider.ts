import "server-only";
import { env } from "../env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export class EmailError extends Error {
  constructor(
    message: string,
    /** false cuando reintentar no sirve (ej.: falta configuración, dirección inválida) */
    public retryable: boolean,
  ) {
    super(message);
  }
}

export function emailConfigured() {
  return Boolean(env.resendApiKey && env.emailFrom);
}

/**
 * Envía un correo con la API de Resend. Usa Idempotency-Key para que un
 * reintento nunca genere un correo duplicado (Resend conserva la clave 24 h).
 * Nunca simula el envío: si falta configuración, lanza un error que queda
 * registrado y visible en el panel.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<{ id: string }> {
  if (!env.resendApiKey) throw new EmailError("Servicio de correo no configurado: falta RESEND_API_KEY", false);
  if (!env.emailFrom) throw new EmailError("Servicio de correo no configurado: falta EMAIL_FROM", false);

  let res: Response;
  try {
    res = await fetch(`${env.resendBaseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(env.emailReplyTo ? { reply_to: env.emailReplyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new EmailError(`No se pudo conectar con Resend: ${(e as Error).message}`, true);
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
  if (res.ok && body.id) return { id: body.id };

  const detail = `${res.status} ${body.name ?? ""} ${body.message ?? ""}`.trim();
  if (res.status === 409 && body.name === "concurrent_idempotent_requests") {
    throw new EmailError(`Resend: envío en curso con la misma clave (${detail})`, true);
  }
  if (res.status === 409) {
    // Misma clave con contenido distinto: un intento anterior pudo haberse entregado.
    // No se reintenta automáticamente para no duplicar; se puede reintentar desde el panel.
    throw new EmailError(`Resend rechazó la clave de idempotencia (${detail}). Revisá si el correo ya llegó antes de reintentar.`, false);
  }
  const retryable = res.status === 429 || res.status >= 500;
  throw new EmailError(`Resend respondió ${detail}`, retryable);
}
