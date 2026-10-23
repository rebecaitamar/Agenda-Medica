"use client";

import { useState } from "react";

const DAYS = [
  [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"], [5, "Viernes"], [6, "Sábado"], [7, "Domingo"],
] as const;

type Rule = { key: number; weekday: number; startTime: string; endTime: string };
let seq = 0;

/** Editor de franjas semanales. Varias franjas por día permiten definir pausas (ej.: 09–12 y 14–18). */
export function RulesEditor({ initial, specialtyName }: { initial: { weekday: number; startTime: string; endTime: string }[]; specialtyName: string }) {
  const [rules, setRules] = useState<Rule[]>(() => initial.map((r) => ({ ...r, key: ++seq })));
  const add = (weekday: number) => {
    const last = rules.filter((r) => r.weekday === weekday).at(-1);
    setRules([...rules, { key: ++seq, weekday, startTime: last ? last.endTime : "09:00", endTime: last ? "" : "13:00" }]);
  };
  const update = (key: number, patch: Partial<Rule>) => setRules(rules.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRules(rules.filter((r) => r.key !== key));

  return (
    <div className="divide-y divide-line">
      {DAYS.map(([wd, name]) => {
        const list = rules.filter((r) => r.weekday === wd);
        return (
          <div key={wd} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <p className="w-28 shrink-0 pt-2 font-medium">{name}</p>
            <div className="flex-1 space-y-2">
              {list.length === 0 && <p className="pt-2 text-[15px] text-ink-soft">No atiende</p>}
              {list.map((r, i) => (
                <div key={r.key} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="weekday" value={wd} />
                  <label className="sr-only" htmlFor={`s-${r.key}`}>{`${name}, franja ${i + 1}, desde`}</label>
                  <input id={`s-${r.key}`} name="startTime" type="time" step={300} className="input w-32" value={r.startTime} onChange={(e) => update(r.key, { startTime: e.target.value })} required />
                  <span className="text-ink-soft">a</span>
                  <label className="sr-only" htmlFor={`e-${r.key}`}>{`${name}, franja ${i + 1}, hasta`}</label>
                  <input id={`e-${r.key}`} name="endTime" type="time" step={300} className="input w-32" value={r.endTime} onChange={(e) => update(r.key, { endTime: e.target.value })} required />
                  <button type="button" className="btn-quiet min-h-10 px-2 text-sm text-danger" onClick={() => remove(r.key)} aria-label={`Quitar franja ${i + 1} del ${name.toLowerCase()} de ${specialtyName}`}>
                    Quitar
                  </button>
                </div>
              ))}
              <button type="button" className="btn-quiet min-h-9 px-2 text-sm" onClick={() => add(wd)}>
                {list.length ? "Agregar otra franja" : "Agregar horario"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
