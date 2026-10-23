"use client";

import { useEffect, useState, useTransition } from "react";
import { adminSlotsAction } from "@/app/admin/actions";

type Spec = { id: string; name: string; durationMinutes: number };

/**
 * Selector de especialidad, día y horario para el panel. Consulta los horarios
 * libres en el servidor; permite cargar un horario fuera de la agenda (igual
 * se rechaza si se superpone con otro turno).
 */
export function SlotField({
  specialties,
  defaultSpecialtyId,
  defaultDay,
  defaultTime,
  ignoreAppointmentId,
  minDay,
}: {
  specialties: Spec[];
  defaultSpecialtyId?: string;
  defaultDay: string;
  defaultTime?: string;
  ignoreAppointmentId?: string;
  minDay: string;
}) {
  const [specialtyId, setSpecialtyId] = useState(defaultSpecialtyId ?? specialties[0]?.id ?? "");
  const [day, setDay] = useState(defaultDay);
  const [time, setTime] = useState(defaultTime ?? "");
  const [outside, setOutside] = useState(false);
  const [slots, setSlots] = useState<{ time: string }[] | null>(null);
  const [loading, start] = useTransition();

  useEffect(() => {
    if (!specialtyId || !day) return;
    start(async () => {
      const r = await adminSlotsAction(specialtyId, day, ignoreAppointmentId);
      setSlots(r);
      if (!outside && time && !r.some((s) => s.time === time)) setTime("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialtyId, day, ignoreAppointmentId]);

  const spec = specialties.find((s) => s.id === specialtyId);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="specialtyId" className="field-label">Especialidad</label>
          <select id="specialtyId" name="specialtyId" className="input" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
            {specialties.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} min)</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="day" className="field-label">Fecha</label>
          <input id="day" name="day" type="date" min={minDay} className="input" value={day} onChange={(e) => setDay(e.target.value)} required />
        </div>
      </div>

      <fieldset>
        <legend className="field-label">Horario</legend>
        {!outside && (
          <>
            {loading && <p className="text-sm text-ink-soft">Buscando horarios libres…</p>}
            {!loading && slots && slots.length === 0 && (
              <p className="text-sm text-ink-soft">No hay horarios libres de {spec?.name} ese día.</p>
            )}
            {!loading && slots && slots.length > 0 && (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                {slots.map((s) => (
                  <label key={s.time} className="cursor-pointer">
                    <input type="radio" name="slotTime" value={s.time} checked={time === s.time} onChange={() => setTime(s.time)} className="peer sr-only" />
                    <span className="flex min-h-10 items-center justify-center rounded-lg border border-line-strong text-sm font-semibold tabular-nums peer-checked:border-sage-700 peer-checked:bg-sage-700 peer-checked:text-white peer-focus-visible:outline-3 peer-focus-visible:outline-sage-600 hover:bg-sage-50">
                      {s.time}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {outside && (
          <div className="max-w-40">
            <label htmlFor="customTime" className="sr-only">Hora</label>
            <input id="customTime" type="time" step={300} className="input" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            name="allowOutsideRules"
            className="h-4 w-4 accent-sage-700"
            checked={outside}
            onChange={(e) => {
              setOutside(e.target.checked);
              setTime("");
            }}
          />
          Horario fuera de la agenda (sobreturno o día especial)
        </label>
        {outside && <p className="field-hint">Se ignoran los horarios de atención y los bloqueos, pero no se permite superponer con otro turno.</p>}
      </fieldset>
      <input type="hidden" name="time" value={time} />
    </div>
  );
}
