import "server-only";
import { NextResponse } from "next/server";
import { BookingError } from "./booking";
import { AdminError } from "./admin/appointments";
import { UnauthorizedError } from "./auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorJson(code: string, message: string, status = 400, field?: string) {
  return json({ error: { code, message, field } }, status);
}

const STATUS: Record<string, number> = {
  invalid: 400,
  slot_unavailable: 409,
  expired: 410,
  wrong_code: 400,
  too_many_attempts: 429,
  not_found: 404,
  email_failed: 502,
  not_allowed: 403,
  too_late: 403,
  resend_limit: 429,
};

/** Convierte errores de dominio en respuestas JSON; los inesperados se registran sin datos personales. */
export function handleError(e: unknown, context: string) {
  if (e instanceof BookingError) return errorJson(e.code, e.message, STATUS[e.code] ?? 400, e.field);
  if (e instanceof AdminError) return errorJson("invalid", e.message, 400, e.field);
  if (e instanceof UnauthorizedError) return errorJson("unauthorized", "No autorizado", 401);
  console.error(`[${context}] error inesperado:`, e instanceof Error ? `${e.name}: ${e.message}` : "desconocido");
  return errorJson("server_error", "Ocurrió un error inesperado. Intentá de nuevo en unos minutos.", 500);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return {};
  const text = await req.text();
  if (text.length > 10_000) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Rechaza solicitudes POST de otros sitios (defensa CSRF para la API pública). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // clientes sin navegador (ej.: tareas del servidor) no envían Origin
  try {
    return new URL(origin).host === new URL(req.url).host || origin === process.env.APP_URL;
  } catch {
    return false;
  }
}
