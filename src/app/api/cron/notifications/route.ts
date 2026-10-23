import { safeEqual } from "@/lib/crypto";
import { errorJson, handleError, json } from "@/lib/http";
import { runDueNotifications } from "@/lib/notifications/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tarea programada del servidor: procesa recordatorios y reintentos pendientes.
 * La invoca pg_cron (Supabase) cada 5 minutos con `Authorization: Bearer CRON_SECRET`.
 * No depende de que nadie tenga la aplicación abierta.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (secret.length < 24 || !safeEqual(auth, `Bearer ${secret}`)) {
    return errorJson("unauthorized", "No autorizado", 401);
  }
  try {
    const summary = await runDueNotifications();
    return json({ ok: true, ...summary, at: new Date().toISOString() });
  } catch (e) {
    return handleError(e, "cron.notifications");
  }
}

export const POST = handle;
export const GET = handle;
