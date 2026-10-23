"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MonthData = { month: string; window: { from: string; to: string }; days: Record<string, number> };
export type SlotData = { startsAt: string; endsAt: string };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "No pudimos cargar la disponibilidad. Revisá tu conexión.");
  return body as T;
}

/** Consulta la disponibilidad real a la API (solo horarios libres). */
export function useAvailability(slug: string, initialMonth: string) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<MonthData | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotData[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const reqId = useRef(0);

  const loadDay = useCallback(
    async (d: string) => {
      const id = ++reqId.current;
      setSlotsLoading(true);
      setSlotsError(null);
      setSlots(null);
      try {
        const r = await getJson<{ slots: SlotData[] }>(`/api/public/availability?specialty=${encodeURIComponent(slug)}&day=${d}`);
        if (id === reqId.current) setSlots(r.slots);
      } catch (e) {
        if (id === reqId.current) setSlotsError((e as Error).message);
      } finally {
        if (id === reqId.current) setSlotsLoading(false);
      }
    },
    [slug],
  );

  // El estado se actualiza solo cuando llega la respuesta; las respuestas viejas se descartan.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getJson<MonthData>(`/api/public/availability?specialty=${encodeURIComponent(slug)}&month=${month}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setMonthError(null);
      })
      .catch((e: Error) => alive && setMonthError(e.message))
      .finally(() => alive && setMonthLoading(false));
    return () => {
      alive = false;
    };
  }, [month, slug, tick]);

  const changeMonth = (m: string) => {
    setMonthLoading(true);
    setMonthError(null);
    setMonth(m);
  };

  const selectDay = (d: string) => {
    setDay(d);
    void loadDay(d);
  };

  /** Vuelve a consultar el mes y el día (ej.: después de que un horario se ocupó). */
  const refresh = async () => {
    setMonthLoading(true);
    setTick((t) => t + 1);
    if (day) await loadDay(day);
  };

  return { month, setMonth: changeMonth, data, monthLoading, monthError, day, selectDay, slots, slotsLoading, slotsError, refresh };
}
