/**
 * Utilidades de fecha y hora. Todas las fechas se muestran en la zona horaria
 * del consultorio, con formato DD/MM/AAAA y reloj de 24 horas.
 * Las "fechas locales" se representan como texto 'YYYY-MM-DD'.
 */
export const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
/** ISO: 1 = lunes … 7 = domingo */
export const ISO_WEEKDAY_NAMES: Record<number, string> = {
  1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 7: "Domingo",
};

type Instant = Date | string | number;
const toDate = (d: Instant) => (d instanceof Date ? d : new Date(d));

function parts(d: Instant, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(toDate(d));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

/** 29/10/2026 */
export function formatDate(d: Instant, tz = DEFAULT_TZ) {
  const p = parts(d, tz);
  return `${p.d}/${p.m}/${p.y}`;
}

/** 09:30 */
export function formatTime(d: Instant, tz = DEFAULT_TZ) {
  const p = parts(d, tz);
  return `${p.hh}:${p.mm}`;
}

/** 2026-10-29 (fecha local en la zona del consultorio) */
export function localDate(d: Instant, tz = DEFAULT_TZ) {
  const p = parts(d, tz);
  return `${p.y}-${p.m}-${p.d}`;
}

/** 'YYYY-MM-DD' → 'DD/MM/AAAA' */
export function formatLocalDate(day: string) {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

function dayToUtc(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(day: string, n: number) {
  const dt = dayToUtc(day);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function addMonths(day: string, n: number) {
  const dt = dayToUtc(day);
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return dt.toISOString().slice(0, 10);
}

/** Día de la semana (0 = domingo) de una fecha local */
export function weekdayOf(day: string) {
  return dayToUtc(day).getUTCDay();
}

/** ISO (1 = lunes … 7 = domingo) */
export function isoWeekdayOf(day: string) {
  return weekdayOf(day) === 0 ? 7 : weekdayOf(day);
}

export function weekdayName(day: string) {
  return WEEKDAYS[weekdayOf(day)];
}

export function weekdayShort(day: string) {
  return WEEKDAYS_SHORT[weekdayOf(day)];
}

/** "jueves 29/10/2026" */
export function formatLongDay(day: string) {
  return `${weekdayName(day)} ${formatLocalDate(day)}`;
}

/** "jueves 29/10/2026" a partir de un instante */
export function formatLongDate(d: Instant, tz = DEFAULT_TZ) {
  return formatLongDay(localDate(d, tz));
}

export function startOfMonth(day: string) {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: string) {
  return addDays(addMonths(startOfMonth(day), 1), -1);
}

/** Lunes de la semana de la fecha dada */
export function startOfWeek(day: string) {
  return addDays(day, 1 - isoWeekdayOf(day));
}

export function monthLabel(day: string) {
  const [y, m] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function isValidDay(day: unknown): day is string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return dayToUtc(day).toISOString().slice(0, 10) === day;
}

/** Diferencia en días entre dos fechas locales */
export function diffDays(a: string, b: string) {
  return Math.round((dayToUtc(a).getTime() - dayToUtc(b).getTime()) / 86_400_000);
}

/** Convierte 'YYYY-MM-DD' + 'HH:MM' en hora local del consultorio a un instante UTC. */
export function zonedToInstant(day: string, time: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Primera aproximación: tratar la hora como UTC y corregir por el desfase de la zona.
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t: number) => {
    const p = parts(t, tz);
    return Date.UTC(+p.y, +p.m - 1, +p.d, +p.hh, +p.mm) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // segunda pasada por si hay cambio de horario
  return new Date(t);
}
