import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getSiteConfig, listSpecialties } from "@/lib/settings";
import { isValidDay, localDate } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SlotField } from "@/components/admin/slot-field";
import { createAppointmentAction } from "../../../actions";

export const metadata: Metadata = { title: "Nuevo turno" };

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ especialidad?: string; fecha?: string; hora?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { settings } = await getSiteConfig();
  const specialties = await listSpecialties();
  const today = localDate(new Date(), settings.timezone);
  const day = isValidDay(sp.fecha) && sp.fecha >= today ? sp.fecha : today;

  return (
    <div className="max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold">Nuevo turno</h1>
      <p className="mt-1 text-ink-soft">Para turnos pedidos por teléfono o en persona.</p>
      <ActionForm action={createAppointmentAction} className="mt-6 space-y-8">
        <section className="panel space-y-5 p-5 sm:p-6">
          <h2 className="font-semibold">Día y horario</h2>
          <SlotField
            specialties={specialties.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }))}
            defaultSpecialtyId={specialties.find((s) => s.id === sp.especialidad)?.id}
            defaultDay={day}
            defaultTime={/^\d{2}:\d{2}$/.test(sp.hora ?? "") ? sp.hora : undefined}
            minDay={today}
          />
        </section>
        <section className="panel space-y-5 p-5 sm:p-6">
          <h2 className="font-semibold">Paciente</h2>
          <div>
            <label htmlFor="fullName" className="field-label">Nombre y apellido</label>
            <input id="fullName" name="fullName" className="input" required maxLength={120} autoComplete="off" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className="field-label">Correo electrónico <span className="font-normal text-ink-soft">(para avisos)</span></label>
              <input id="email" name="email" type="email" className="input" maxLength={254} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="phone" className="field-label">Teléfono</label>
              <input id="phone" name="phone" type="tel" className="input" maxLength={40} autoComplete="off" />
            </div>
          </div>
          <div>
            <label htmlFor="adminNote" className="field-label">Nota administrativa <span className="font-normal text-ink-soft">(opcional)</span></label>
            <textarea id="adminNote" name="adminNote" rows={2} maxLength={500} className="input" aria-describedby="note-hint" />
            <p id="note-hint" className="field-hint">Solo datos administrativos (ej.: “prefiere que la llamen”). No registres información clínica.</p>
          </div>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-sage-700" />
            Enviar confirmación y recordatorio por correo
          </label>
        </section>
        <SubmitButton pending="Creando turno…">Crear turno</SubmitButton>
      </ActionForm>
    </div>
  );
}
