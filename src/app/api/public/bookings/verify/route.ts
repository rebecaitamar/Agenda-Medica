import { after } from "next/server";
import { verifyBooking } from "@/lib/booking";
import { errorJson, handleError, json, readJson, sameOrigin } from "@/lib/http";
import { dispatchJobs } from "@/lib/notifications/worker";
import { baseUrl, clientIp, rateLimit } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return errorJson("forbidden", "Origen no permitido", 403);
    if (!(await rateLimit("verify:ip", await clientIp(), 30, 600))) {
      return errorJson("rate_limited", "Demasiados intentos. Esperá unos minutos.", 429);
    }
    const body = await readJson(req);
    const { summary, jobIds } = await verifyBooking(body, baseUrl());
    after(() => dispatchJobs(jobIds).catch((e) => console.error("[reserva] envío diferido falló", (e as Error).message)));
    return json({ state: "confirmed", summary });
  } catch (e) {
    return handleError(e, "booking.verify");
  }
}
