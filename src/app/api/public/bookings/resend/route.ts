import { resendVerificationCode } from "@/lib/booking";
import { errorJson, handleError, json, readJson, sameOrigin } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return errorJson("forbidden", "Origen no permitido", 403);
    if (!(await rateLimit("resend:ip", await clientIp(), 6, 600))) {
      return errorJson("rate_limited", "Demasiadas solicitudes. Esperá unos minutos.", 429);
    }
    await resendVerificationCode(await readJson(req));
    return json({ ok: true });
  } catch (e) {
    return handleError(e, "booking.resend");
  }
}
