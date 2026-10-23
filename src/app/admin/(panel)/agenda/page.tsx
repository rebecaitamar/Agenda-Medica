import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { appointmentsBetween, weekRange, type AgendaItem } from "@/lib/admin/queries";
import { getSlots } from "@/lib/availability";
import { sql } from "@/lib/db";
import { getSiteConfig, listSpecialties } from "@/lib/settings";
import {
  addDays, addMonths, endOfMonth, formatLocalDate, formatLongDay, formatTime, isValidDay, isoWeekdayOf,
  localDate, monthLabel, startOfMonth, weekdayShort,
} from "@/lib/time";
import { StatusBadge } from "@/components/admin/badges";
import { toneFor } from "@/components/specialty-tone";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";

export const metadata: Metadata = { title: "Agenda" };

type View = "dia" | "semana" | "mes";
const EXC_LABEL: Record<string, string> = { block: "Bloqueo", vacation: "Vacaciones", holiday: "Feriado", pause: "Pausa" };

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ vista?: string; fecha?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { settings } = await getSiteConfig();
  const tz = settings.timezone;
  const today = localDate(new Date(), tz);
  const view: View = sp.vista === "semana" || sp.vista === "mes" ? sp.vista : "dia";
  const day = isValidDay(sp.fecha) ? sp.fecha : today;
  const specialties = await listSpecialties();
  const toneOf = (id: string) => toneFor(Math.max(0, specialties.findIndex((s) => s.id === id)));

  const range =
    view === "dia" ? { from: day, to: day } : view === "semana" ? weekRange(day) : { from: startOfMonth(day), to: endOfMonth(day) };
  const step = (dir: number) =>
    view === "dia" ? addDays(day, dir) : view === "semana" ? addDays(day, 7 * dir) : addMonths(day, dir);
  const title =
    view === "dia"
      ? formatLongDay(day)
      : view === "semana"
        ? `Semana del ${formatLocalDate(range.from)} al ${formatLocalDate(range.to)}`
        : monthLabel(day);

  const items = await appointmentsBetween(range.from, range.to, tz, { includeInactive: view === "dia" });
  const exceptions = await sql<{ id: string; kind: string; startsAt: Date; endsAt: Date; reason: string | null; specialtyName: string | null }[]>`
    select e.id, e.kind, e.starts_at, e.ends_at, e.reason, s.name as specialty_name
    from availability_exceptions e left join specialties s on s.id = e.specialty_id
    where tstzrange(e.starts_at, e.ends_at) && tstzrange((${range.from}::date::timestamp at time zone ${tz}), ((${range.to}::date + 1)::timestamp at time zone ${tz}))
    order by e.starts_at`;

  const byDay = new Map<string, AgendaItem[]>();
  for (const a of items) {
    const k = localDate(a.startsAt, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  const href = (v: View, f: string) => `/admin/agenda?vista=${v}&fecha=${f}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold first-letter:uppercase sm:text-3xl">{title}</h1>
        <Link href="/admin/turnos/nuevo" className="btn-primary">Nuevo turno</Link>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5" role="group" aria-label="Vista">
          {(["dia", "semana", "mes"] as View[]).map((v) => (
            <Link
              key={v}
              href={href(v, day)}
              aria-current={v === view ? "page" : undefined}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${v === view ? "bg-sage-700 text-white" : "text-ink-soft hover:text-ink"}`}
            >
              {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link href={href(view, step(-1))} className="btn-quiet min-h-9 px-2" aria-label="Anterior"><IconChevronLeft /></Link>
          <Link href={href(view, today)} className="btn-secondary min-h-9 px-3 text-sm">Hoy</Link>
          <Link href={href(view, step(1))} className="btn-quiet min-h-9 px-2" aria-label="Siguiente"><IconChevronRight /></Link>
        </div>
        <ul className="flex flex-wrap gap-3 text-sm text-ink-soft">
          {specialties.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${toneFor(i).dot}`} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      </div>

      {exceptions.length > 0 && (
        <ul className="mt-5 space-y-2">
          {exceptions.map((e) => (
            <li key={e.id} className="rounded-lg bg-sand px-4 py-2 text-sm">
              <strong>{EXC_LABEL[e.kind]}</strong> {e.specialtyName ? `(${e.specialtyName})` : "(toda la agenda)"}: {formatLocalDate(localDate(e.startsAt, tz))}{" "}
              {formatTime(e.startsAt, tz)} a {formatLocalDate(localDate(new Date(e.endsAt.getTime() - 1), tz))} {formatTime(e.endsAt, tz)}
              {e.reason ? `. ${e.reason}` : ""}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        {view === "dia" && <DayView day={day} items={items} tz={tz} specialties={specialties} toneOf={toneOf} />}
        {view === "semana" && <WeekView from={range.from} byDay={byDay} tz={tz} today={today} toneOf={toneOf} />}
        {view === "mes" && <MonthView day={day} byDay={byDay} today={today} />}
      </div>
    </div>
  );
}

async function DayView({
  day, items, tz, specialties, toneOf,
}: {
  day: string; items: AgendaItem[]; tz: string; specialties: Awaited<ReturnType<typeof listSpecialties>>; toneOf: (id: string) => ReturnType<typeof toneFor>;
}) {
  const free = await Promise.all(
    specialties.filter((s) => s.active).map(async (s) => ({ s, slots: await getSlots(s.id, day, day, { enforceBookingWindow: false }) })),
  );
  type Row = { at: Date; kind: "appt"; a: AgendaItem } | { at: Date; kind: "free"; specialtyId: string; specialtyName: string; time: string };
  const rows: Row[] = [
    ...items.map((a) => ({ at: a.startsAt, kind: "appt" as const, a })),
    ...free.flatMap(({ s, slots }) => slots.map((sl) => ({ at: sl.startsAt, kind: "free" as const, specialtyId: s.id, specialtyName: s.name, time: formatTime(sl.startsAt, tz) }))),
  ].sort((x, y) => x.at.getTime() - y.at.getTime() || (x.kind === "appt" ? -1 : 1));

  if (rows.length === 0) {
    return <p className="panel px-5 py-8 text-center text-ink-soft">No hay turnos ni horarios de atención este día.</p>;
  }
  return (
    <ol className="panel divide-y divide-line">
      {rows.map((r) =>
        r.kind === "appt" ? (
          <li key={r.a.id}>
            <Link href={`/admin/turnos/${r.a.id}`} className={`flex items-center gap-4 px-5 py-3 hover:bg-sage-50 ${["cancelled"].includes(r.a.status) ? "opacity-60" : ""}`}>
              <span className="w-24 shrink-0 font-semibold tabular-nums">
                {formatTime(r.a.startsAt, tz)} <span className="font-normal text-ink-soft">a {formatTime(r.a.endsAt, tz)}</span>
              </span>
              <span className={`h-9 w-1 shrink-0 rounded-full ${toneOf(r.a.specialtyId).dot}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-medium ${r.a.status === "cancelled" ? "line-through" : ""}`}>{r.a.patientName}</span>
                <span className="text-sm text-ink-soft">{r.a.specialtyName}{r.a.source === "admin" ? ", cargado en el panel" : ""}</span>
              </span>
              <StatusBadge status={r.a.status} />
            </Link>
          </li>
        ) : (
          <li key={`${r.specialtyId}-${r.time}`} className="flex items-center gap-4 px-5 py-2 text-[15px] text-ink-soft">
            <span className="w-24 shrink-0 tabular-nums">{r.time}</span>
            <span className={`h-6 w-1 shrink-0 rounded-full opacity-30 ${toneOf(r.specialtyId).dot}`} aria-hidden />
            <span className="flex-1">Libre, {r.specialtyName}</span>
            <Link href={`/admin/turnos/nuevo?especialidad=${r.specialtyId}&fecha=${day}&hora=${r.time}`} className="link text-sm">
              Agendar
            </Link>
          </li>
        ),
      )}
    </ol>
  );
}

function WeekView({
  from, byDay, tz, today, toneOf,
}: { from: string; byDay: Map<string, AgendaItem[]>; tz: string; today: string; toneOf: (id: string) => ReturnType<typeof toneFor> }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <section key={d} className={`panel min-h-28 p-3 ${d === today ? "border-sage-600" : ""}`} aria-label={formatLongDay(d)}>
            <Link href={`/admin/agenda?vista=dia&fecha=${d}`} className="mb-2 flex items-baseline justify-between hover:underline">
              <span className="text-sm font-semibold capitalize">{weekdayShort(d)}</span>
              <span className="text-sm tabular-nums text-ink-soft">{formatLocalDate(d).slice(0, 5)}</span>
            </Link>
            {list.length === 0 ? (
              <p className="text-sm text-ink-soft/70">Sin turnos</p>
            ) : (
              <ul className="space-y-1.5">
                {list.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/turnos/${a.id}`} className="flex gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-sage-50">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${toneOf(a.specialtyId).dot}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="font-semibold tabular-nums">{formatTime(a.startsAt, tz)}</span>{" "}
                        <span className="break-words">{a.patientName}</span>
                        {a.status !== "confirmed" && <span className="block"><StatusBadge status={a.status} /></span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthView({ day, byDay, today }: { day: string; byDay: Map<string, AgendaItem[]>; today: string }) {
  const first = startOfMonth(day);
  const last = endOfMonth(day);
  const lead = isoWeekdayOf(first) - 1;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: Number(last.slice(8)) }, (_, i) => addDays(first, i))];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink-soft" aria-hidden>
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((w) => <span key={w} className="py-1">{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const n = (byDay.get(d) ?? []).length;
          return (
            <Link
              key={d}
              href={`/admin/agenda?vista=dia&fecha=${d}`}
              aria-label={`${formatLongDay(d)}: ${n} ${n === 1 ? "turno" : "turnos"}`}
              className={`flex aspect-square flex-col justify-between rounded-lg border p-1.5 text-left hover:border-sage-600 sm:aspect-[4/3] sm:p-2.5 ${d === today ? "border-sage-600 bg-sage-50" : "border-line bg-surface"}`}
            >
              <span className="text-sm tabular-nums">{Number(d.slice(8))}</span>
              {n > 0 && <span className="self-end rounded-full bg-sage-700 px-2 text-xs font-semibold text-white sm:text-sm">{n}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
