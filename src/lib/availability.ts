import "server-only";
import { sql, type Db } from "./db";
import { addDays, localDate } from "./time";
import type { Specialty } from "./settings";

export type Slot = { startsAt: Date; endsAt: Date };

export async function getSlots(
  specialtyId: string,
  from: string,
  to: string,
  opts: { ignoreAppointmentId?: string | null; enforceBookingWindow?: boolean } = {},
  db: Db = sql,
): Promise<Slot[]> {
  return db<Slot[]>`
    select starts_at, ends_at
    from available_slots(
      ${specialtyId}::uuid, ${from}::date, ${to}::date, now(),
      ${opts.ignoreAppointmentId ?? null}::uuid,
      ${opts.enforceBookingWindow ?? true}
    )`;
}

/** ¿El instante exacto es un horario reservable? (validación del servidor) */
export async function isSlotAvailable(
  specialtyId: string,
  startsAt: Date,
  tz: string,
  opts: { ignoreAppointmentId?: string | null; enforceBookingWindow?: boolean } = {},
  db: Db = sql,
) {
  const day = localDate(startsAt, tz);
  const rows = await db<{ ok: number }[]>`
    select 1 as ok
    from available_slots(
      ${specialtyId}::uuid, ${day}::date, ${day}::date, now(),
      ${opts.ignoreAppointmentId ?? null}::uuid,
      ${opts.enforceBookingWindow ?? true}
    )
    where starts_at = ${startsAt}`;
  return rows.length > 0;
}

/** Rango de fechas que el público puede consultar para una especialidad. */
export function publicWindow(spec: Pick<Specialty, "maxAdvanceDays">, tz: string) {
  const today = localDate(new Date(), tz);
  return { from: today, to: addDays(today, spec.maxAdvanceDays) };
}

/** Cantidad de horarios libres por día, dentro del rango pedido y de la ventana pública. */
export async function availableDays(spec: Specialty, from: string, to: string, tz: string) {
  const win = publicWindow(spec, tz);
  const f = from < win.from ? win.from : from;
  const t = to > win.to ? win.to : to;
  if (f > t) return {} as Record<string, number>;
  const slots = await getSlots(spec.id, f, t);
  const days: Record<string, number> = {};
  for (const s of slots) {
    const d = localDate(s.startsAt, tz);
    days[d] = (days[d] ?? 0) + 1;
  }
  return days;
}

export async function nextAvailableSlot(spec: Specialty, tz: string): Promise<Slot | null> {
  const win = publicWindow(spec, tz);
  // Se busca por tramos para no generar todo el horizonte de una vez.
  for (let from = win.from; from <= win.to; from = addDays(from, 31)) {
    const to = addDays(from, 30) > win.to ? win.to : addDays(from, 30);
    const [slot] = await sql<Slot[]>`
      select starts_at, ends_at from available_slots(${spec.id}::uuid, ${from}::date, ${to}::date) limit 1`;
    if (slot) return slot;
  }
  return null;
}
