import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getRules } from "@/lib/admin/config";
import { listSpecialties } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { RulesEditor } from "@/components/admin/rules-editor";
import { toneFor } from "@/components/specialty-tone";
import { saveRulesAction, saveSpecialtyAction } from "../../actions";

export const metadata: Metadata = { title: "Horarios de atención" };

export default async function SchedulePage() {
  await requireAdmin();
  const specialties = await listSpecialties();
  const rules = await Promise.all(specialties.map((s) => getRules(s.id)));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Horarios de atención</h1>
        <p className="mt-1 max-w-[70ch] text-ink-soft">
          Cada especialidad tiene sus propios días, horarios y duración. Los turnos se generan automáticamente con esta configuración. Si las
          dos especialidades comparten un horario, al reservar una se ocupa también para la otra.
        </p>
      </div>

      {specialties.map((s, i) => (
        <section key={s.id} aria-labelledby={`sp-${s.id}`} className="panel overflow-hidden">
          <div className={`h-1.5 ${toneFor(i).dot}`} aria-hidden />
          <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <h2 id={`sp-${s.id}`} className="font-serif text-2xl font-semibold">{s.name}</h2>
              <ActionForm action={saveSpecialtyAction} className="mt-5 space-y-4">
                <input type="hidden" name="id" value={s.id} />
                <div>
                  <label className="field-label" htmlFor={`name-${s.id}`}>Nombre visible</label>
                  <input id={`name-${s.id}`} name="name" defaultValue={s.name} className="input" required maxLength={80} />
                </div>
                <div>
                  <label className="field-label" htmlFor={`desc-${s.id}`}>Descripción breve <span className="font-normal text-ink-soft">(opcional)</span></label>
                  <textarea id={`desc-${s.id}`} name="description" defaultValue={s.description ?? ""} rows={2} maxLength={400} className="input" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="field-label" htmlFor={`dur-${s.id}`}>Duración (min)</label>
                    <input id={`dur-${s.id}`} name="durationMinutes" type="number" min={5} max={240} defaultValue={s.durationMinutes} className="input" required />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`buf-${s.id}`}>Descanso entre turnos (min)</label>
                    <input id={`buf-${s.id}`} name="bufferMinutes" type="number" min={0} max={120} defaultValue={s.bufferMinutes} className="input" required />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`notice-${s.id}`}>Anticipación mínima (h)</label>
                    <input id={`notice-${s.id}`} name="minNoticeHours" type="number" min={0} max={720} defaultValue={s.minNoticeHours} className="input" required aria-describedby={`notice-h-${s.id}`} />
                    <p id={`notice-h-${s.id}`} className="field-hint">Cuánto antes como mínimo se puede reservar.</p>
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`adv-${s.id}`}>Reservas hasta (días)</label>
                    <input id={`adv-${s.id}`} name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={s.maxAdvanceDays} className="input" required aria-describedby={`adv-h-${s.id}`} />
                    <p id={`adv-h-${s.id}`} className="field-hint">Horizonte máximo hacia adelante.</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[15px]">
                  <input type="checkbox" name="active" defaultChecked={s.active} className="h-4 w-4 accent-sage-700" />
                  Ofrecer turnos online de esta especialidad
                </label>
                <SubmitButton className="btn-secondary">Guardar especialidad</SubmitButton>
              </ActionForm>
            </div>
            <div>
              <h3 className="font-semibold">Días y franjas horarias</h3>
              <ActionForm action={saveRulesAction} className="mt-2">
                <input type="hidden" name="specialtyId" value={s.id} />
                <RulesEditor initial={rules[i]} specialtyName={s.name} />
                <div className="mt-4">
                  <SubmitButton>Guardar horarios de {s.name}</SubmitButton>
                </div>
              </ActionForm>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
