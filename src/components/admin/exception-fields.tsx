"use client";

import { useState } from "react";

export function ExceptionFields({ specialties, today }: { specialties: { id: string; name: string }[]; today: string }) {
  const [allDay, setAllDay] = useState(true);
  const [kind, setKind] = useState("block");
  const [start, setStart] = useState(today);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="kind" className="field-label">Tipo</label>
          <select id="kind" name="kind" className="input" value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value === "vacation" || e.target.value === "holiday") setAllDay(true); }}>
            <option value="block">Bloqueo de horario</option>
            <option value="pause">Pausa</option>
            <option value="holiday">Feriado</option>
            <option value="vacation">Vacaciones</option>
          </select>
        </div>
        <div>
          <label htmlFor="specialtyId" className="field-label">Afecta a</label>
          <select id="specialtyId" name="specialtyId" className="input" defaultValue="">
            <option value="">Toda la agenda</option>
            {specialties.map((s) => <option key={s.id} value={s.id}>Solo {s.name}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-sage-700" />
        Días completos
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="startDay" className="field-label">Desde</label>
            <input id="startDay" name="startDay" type="date" min={today} className="input" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          {!allDay && (
            <div className="w-32">
              <label htmlFor="startTime" className="field-label">Hora</label>
              <input id="startTime" name="startTime" type="time" step={300} className="input" required />
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="endDay" className="field-label">Hasta</label>
            <input id="endDay" name="endDay" type="date" min={start} className="input" defaultValue={start} key={start} />
          </div>
          {!allDay && (
            <div className="w-32">
              <label htmlFor="endTime" className="field-label">Hora</label>
              <input id="endTime" name="endTime" type="time" step={300} className="input" required />
            </div>
          )}
        </div>
      </div>
      <div>
        <label htmlFor="reason" className="field-label">Motivo <span className="font-normal text-ink-soft">(interno, opcional)</span></label>
        <input id="reason" name="reason" maxLength={200} className="input" placeholder="Ej.: congreso, trámite personal" />
      </div>
    </div>
  );
}
