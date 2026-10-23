import Link from "next/link";
import type { Metadata } from "next";
import { getActiveSpecialties } from "@/lib/settings";
import { toneFor } from "@/components/specialty-tone";
import { IconChevronRight } from "@/components/icons";

export const metadata: Metadata = { title: "Solicitar un turno" };

export default async function ChooseSpecialtyPage() {
  const specialties = await getActiveSpecialties();
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="font-serif text-3xl font-semibold">¿Para qué especialidad es el turno?</h1>
      {specialties.length === 0 ? (
        <p className="panel mt-6 p-6 text-ink-soft">Por el momento no hay especialidades habilitadas para turnos online.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {specialties.map((s, i) => {
            const tone = toneFor(i);
            return (
              <li key={s.id}>
                <Link
                  href={`/reservar/${s.slug}`}
                  className="panel flex items-center gap-4 px-5 py-5 transition-colors hover:border-sage-600 hover:bg-sage-50"
                >
                  <span className={`h-10 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                  <span className="flex-1">
                    <span className="block text-lg font-semibold">{s.name}</span>
                    <span className="text-[15px] text-ink-soft">{s.description ?? `Consultas de ${s.durationMinutes} minutos`}</span>
                  </span>
                  <IconChevronRight className="text-ink-soft" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
