"use client";

import { IconChevronLeft, IconChevronRight } from "../icons";
import { Notice } from "../notice";
import { addMonths, endOfMonth, formatLocalDate, formatTime, isoWeekdayOf, monthLabel, weekdayName } from "@/lib/time";
import type { useAvailability } from "./use-availability";

const HEAD = [
  ["L", "lunes"], ["M", "martes"], ["M", "miércoles"], ["J", "jueves"], ["V", "viernes"], ["S", "sábado"], ["D", "domingo"],
];

type Avail = ReturnType<typeof useAvailability>;

export function DateTimePicker({
  avail,
  tz,
  selectedSlot,
  onSelectSlot,
}: {
  avail: Avail;
  tz: string;
  selectedSlot: string | null;
  onSelectSlot: (startsAt: string) => void;
}) {
  const { month, setMonth, data, monthLoading, monthError, day, selectDay, slots, slotsLoading, slotsError } = avail;
  const first = `${month}-01`;
  const last = endOfMonth(first);
  const lead = isoWeekdayOf(first) - 1;
  const total = Number(last.slice(8));
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const windowFrom = data?.window.from;
  const windowTo = data?.window.to;
  const canPrev = windowFrom ? first > windowFrom : false;
  const canNext = windowTo ? last < windowTo : false;
  const anyThisMonth = data && Object.keys(data.days).length > 0;

  const groups = slots
    ? [
        { label: "Mañana", items: slots.filter((s) => Number(formatTime(s.startsAt, tz).slice(0, 2)) < 13) },
        { label: "Tarde", items: slots.filter((s) => Number(formatTime(s.startsAt, tz).slice(0, 2)) >= 13) },
      ].filter((g) => g.items.length)
    : [];

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr] md:gap-10">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            className="btn-quiet min-h-10 px-2"
            onClick={() => setMonth(addMonths(first, -1).slice(0, 7))}
            disabled={!canPrev || monthLoading}
            aria-label="Mes anterior"
          >
            <IconChevronLeft />
          </button>
          <p className="font-semibold first-letter:uppercase" aria-live="polite">
            {monthLabel(first)}
          </p>
          <button
            type="button"
            className="btn-quiet min-h-10 px-2"
            onClick={() => setMonth(addMonths(first, 1).slice(0, 7))}
            disabled={!canNext || monthLoading}
            aria-label="Mes siguiente"
          >
            <IconChevronRight />
          </button>
        </div>

        <div role="group" aria-label={`Días de ${monthLabel(first)}`} aria-busy={monthLoading} className="select-none">
          <div aria-hidden className="grid grid-cols-7 text-center text-xs font-semibold text-ink-soft">
            {HEAD.map(([s, l], i) => (
              <span key={i} className="py-1.5" title={l}>
                {s}
              </span>
            ))}
          </div>
          <div className={`grid grid-cols-7 gap-1 transition-opacity ${monthLoading ? "opacity-50" : ""}`}>
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} />;
              const count = data?.days[d] ?? 0;
              const available = count > 0;
              const selected = d === day;
              return (
                <span key={d}>
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => selectDay(d)}
                    aria-pressed={selected}
                    aria-label={`${weekdayName(d)} ${formatLocalDate(d)}${available ? `, ${count} ${count === 1 ? "horario libre" : "horarios libres"}` : ", sin horarios"}`}
                    className={[
                      "relative flex aspect-square w-full items-center justify-center rounded-lg text-[15px] tabular-nums",
                      available
                        ? selected
                          ? "bg-sage-700 font-semibold text-white"
                          : "bg-sage-100 font-semibold text-sage-800 hover:bg-sage-200"
                        : "text-ink-soft/45",
                    ].join(" ")}
                  >
                    {Number(d.slice(8))}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
        {monthError && (
          <div className="mt-3">
            <Notice tone="error">{monthError}</Notice>
          </div>
        )}
        {!monthLoading && !monthError && data && !anyThisMonth && (
          <p className="mt-3 text-sm text-ink-soft">
            No quedan horarios libres en este mes.{canNext ? " Probá con el mes siguiente." : ""}
          </p>
        )}
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <span className="inline-block h-3.5 w-3.5 rounded bg-sage-100 ring-1 ring-sage-200" aria-hidden /> Días con horarios libres
        </p>
      </div>

      <div aria-live="polite">
        {!day && <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-ink-soft">Elegí un día del calendario para ver los horarios.</p>}
        {day && (
          <>
            <h3 className="mb-3 font-semibold first-letter:uppercase">
              {weekdayName(day)} {formatLocalDate(day)}
            </h3>
            {slotsLoading && <p className="text-ink-soft">Buscando horarios…</p>}
            {slotsError && <Notice tone="error">{slotsError}</Notice>}
            {slots && slots.length === 0 && (
              <p className="text-ink-soft">Este día ya no tiene horarios libres. Elegí otro día.</p>
            )}
            {groups.map((g) => (
              <fieldset key={g.label} className="mb-4">
                <legend className="mb-2 text-sm text-ink-soft">{g.label}</legend>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.items.map((s) => {
                    const sel = s.startsAt === selectedSlot;
                    return (
                      <button
                        key={s.startsAt}
                        type="button"
                        onClick={() => onSelectSlot(s.startsAt)}
                        aria-pressed={sel}
                        className={[
                          "min-h-11 rounded-lg border text-[15px] font-semibold tabular-nums",
                          sel ? "border-sage-700 bg-sage-700 text-white" : "border-line-strong bg-surface hover:border-sage-600 hover:bg-sage-50",
                        ].join(" ")}
                      >
                        {formatTime(s.startsAt, tz)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
