import type { Metadata } from "next";
import { nowMs } from "@/lib/clock";
import { requireAdmin } from "@/lib/auth";
import { exceptionsList } from "@/lib/admin/queries";
import { getSiteConfig, listSpecialties } from "@/lib/settings";
import { formatDate, formatTime, localDate } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ExceptionFields } from "@/components/admin/exception-fields";
import { addExceptionAction, deleteExceptionAction } from "../../actions";

export const metadata: Metadata = { title: "Bloqueos de agenda" };

const KIND: Record<string, string> = { block: "Bloqueo", vacation: "Vacaciones", holiday: "Feriado", pause: "Pausa" };

export default async function BlocksPage() {
  await requireAdmin();
  const { settings } = await getSiteConfig();
  const tz = settings.timezone;
  const [specialties, list] = await Promise.all([listSpecialties(), exceptionsList()]);
  const today = localDate(new Date(), tz);
  const now = nowMs();

  const range = (s: Date, e: Date) => {
    const endIncl = new Date(e.getTime() - 1);
    const fullDays = formatTime(s, tz) === "00:00" && formatTime(e, tz) === "00:00";
    if (fullDays) {
      const a = formatDate(s, tz);
      const b = formatDate(endIncl, tz);
      return a === b ? `${a}, todo el día` : `Del ${a} al ${b}`;
    }
    const sameDay = localDate(s, tz) === localDate(e, tz);
    return sameDay
      ? `${formatDate(s, tz)}, de ${formatTime(s, tz)} a ${formatTime(e, tz)} h`
      : `Del ${formatDate(s, tz)} ${formatTime(s, tz)} h al ${formatDate(e, tz)} ${formatTime(e, tz)} h`;
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Bloqueos de agenda</h1>
        <p className="mt-1 text-ink-soft">Horarios, días, feriados o vacaciones en los que no se ofrecen turnos.</p>
        <ActionForm action={addExceptionAction} className="panel mt-6 space-y-5 p-5 sm:p-6" resetOnSuccess>
          <ExceptionFields specialties={specialties.map((s) => ({ id: s.id, name: s.name }))} today={today} />
          <SubmitButton pending="Guardando…">Agregar bloqueo</SubmitButton>
        </ActionForm>
      </div>
      <section aria-labelledby="vigentes">
        <h2 id="vigentes" className="text-lg font-semibold lg:mt-12">Bloqueos cargados</h2>
        {list.length === 0 ? (
          <p className="panel mt-3 px-5 py-6 text-ink-soft">No hay bloqueos cargados.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {list.map((e) => {
              const past = e.endsAt.getTime() < now;
              return (
                <li key={e.id} className={`panel flex items-start justify-between gap-4 px-5 py-4 ${past ? "opacity-60" : ""}`}>
                  <div>
                    <p className="font-semibold">
                      {KIND[e.kind]} <span className="font-normal text-ink-soft">{e.specialtyName ? `, solo ${e.specialtyName}` : ", toda la agenda"}</span>
                    </p>
                    <p className="text-[15px]">{range(e.startsAt, e.endsAt)}</p>
                    {e.reason && <p className="text-sm text-ink-soft">{e.reason}</p>}
                  </div>
                  {!past && (
                    <ActionForm action={deleteExceptionAction} confirm="¿Eliminar este bloqueo? Los horarios vuelven a estar disponibles.">
                      <input type="hidden" name="id" value={e.id} />
                      <SubmitButton className="btn-quiet min-h-9 px-2 text-sm text-danger" pending="Eliminando…">Eliminar</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
