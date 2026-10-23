import { after } from "next/server";
import { cancelByPatient, rescheduleByPatient } from "@/lib/booking";
import { errorJson, handleError, json, readJson, sameOrigin } from "@/lib/http";
import { dispatchJobs } from "@/lib/notifications/worker";
import { clientIp, rateLimit } from "@/lib/request";

export const dynamic = "force-dynamic";

/** Acciones del paciente desde el enlace seguro del correo. El token va en el cuerpo, nunca en la URL de la API. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return errorJson("forbidden", "Origen no permitido", 403);
    if (!(await rateLimit("manage:ip", await clientIp(), 20, 600))) {
      return errorJson("rate_limited", "Demasiadas solicitudes. Esperá unos minutos.", 429);
    }
    const body = await readJson(req);
    const token = typeof body.token === "string" ? body.token : "";
    let jobIds: string[] = [];
    if (body.action === "cancel") {
      ({ jobIds } = await cancelByPatient(token));
    } else if (body.action === "reschedule") {
      ({ jobIds } = await rescheduleByPatient(token, body.startsAt));
    } else {
      return errorJson("invalid", "Acción inválida");
    }
    after(() => dispatchJobs(jobIds).catch((e) => console.error("[gestión] envío diferido falló", (e as Error).message)));
    return json({ ok: true });
  } catch (e) {
    return handleError(e, "manage");
  }
}
