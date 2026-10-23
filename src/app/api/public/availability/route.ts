import { availableDays, getSlots, publicWindow } from "@/lib/availability";
import { sql } from "@/lib/db";
import { errorJson, handleError, json } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/request";
import { loadSiteConfig, type Specialty } from "@/lib/settings";
import { endOfMonth, isValidDay, localDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Disponibilidad pública. Devuelve solo horarios libres: nunca nombres ni datos
 * de otras reservas.
 *   ?specialty=slug&month=YYYY-MM   → días con horarios libres y su cantidad
 *   ?specialty=slug&day=YYYY-MM-DD  → horarios libres de ese día
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit("availability", await clientIp(), 240, 60))) {
      return errorJson("rate_limited", "Demasiadas consultas seguidas. Esperá un minuto.", 429);
    }
    const url = new URL(req.url);
    const slug = url.searchParams.get("specialty") ?? "";
    const [spec] = await sql<Specialty[]>`select * from specialties where slug = ${slug} and active`;
    if (!spec) return errorJson("not_found", "Especialidad no disponible", 404);
    const { settings } = await loadSiteConfig();
    const tz = settings.timezone;
    const window = publicWindow(spec, tz);

    const day = url.searchParams.get("day");
    if (day) {
      if (!isValidDay(day)) return errorJson("invalid", "Fecha inválida");
      if (day < window.from || day > window.to) return json({ day, slots: [] });
      const slots = await getSlots(spec.id, day, day);
      return json({
        day,
        slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
      });
    }

    const month = url.searchParams.get("month") ?? localDate(new Date(), tz).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month) || !isValidDay(`${month}-01`)) return errorJson("invalid", "Mes inválido");
    const days = await availableDays(spec, `${month}-01`, endOfMonth(`${month}-01`), tz);
    return json({ month, window, days, durationMinutes: spec.durationMinutes });
  } catch (e) {
    return handleError(e, "availability");
  }
}
