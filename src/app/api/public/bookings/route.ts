import { after } from "next/server";
import { startOnlineBooking } from "@/lib/booking";
import { checkFormToken } from "@/lib/crypto";
import { errorJson, handleError, json, readJson, sameOrigin } from "@/lib/http";
import { dispatchJobs } from "@/lib/notifications/worker";
import { baseUrl, clientIp, rateLimit } from "@/lib/request";

export const dynamic = "force-dynamic";

/** Inicia una reserva online (pasos 6 a 8 del flujo). */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return errorJson("forbidden", "Origen no permitido", 403);
    const body = await readJson(req);

    // Protección contra envíos automatizados: campo trampa invisible y tiempo mínimo de llenado.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return errorJson("invalid", "No pudimos procesar la solicitud.", 400);
    }
    if (!checkFormToken(body.formToken)) {
      return errorJson("form_expired", "El formulario venció o se envió demasiado rápido. Recargá la página e intentá de nuevo.", 400);
    }

    const ip = await clientIp();
    if (!(await rateLimit("booking:ip", ip, 8, 600))) {
      return errorJson("rate_limited", "Hiciste varias solicitudes seguidas. Esperá unos minutos e intentá de nuevo.", 429);
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && !(await rateLimit("booking:email", email, 4, 3600))) {
      return errorJson("rate_limited", "Ya hay varias solicitudes con este correo. Esperá un rato o comunicate con el consultorio.", 429);
    }

    const result = await startOnlineBooking(body, baseUrl());
    if (result.state === "confirmed") {
      const ids = result.jobIds;
      after(() => dispatchJobs(ids).catch((e) => console.error("[reserva] envío diferido falló", (e as Error).message)));
      return json({ state: "confirmed", summary: result.summary }, 201);
    }
    return json(result, 202);
  } catch (e) {
    return handleError(e, "booking.start");
  }
}
