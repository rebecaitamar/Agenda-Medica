import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/booking-flow";
import { formToken } from "@/lib/crypto";
import { doctorDisplayName, getActiveSpecialties, getSiteConfig } from "@/lib/settings";
import { localDate } from "@/lib/time";
import { IconChevronLeft } from "@/components/icons";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const spec = (await getActiveSpecialties()).find((s) => s.slug === slug);
  return { title: spec ? `Turno de ${spec.name}` : "Solicitar un turno" };
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ settings, profile }, specialties] = await Promise.all([getSiteConfig(), getActiveSpecialties()]);
  const spec = specialties.find((s) => s.slug === slug);
  if (!spec) notFound();
  const others = specialties.filter((s) => s.id !== spec.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
            <IconChevronLeft width={16} height={16} /> Inicio
          </Link>
          <h1 className="mt-1 font-serif text-3xl font-semibold sm:text-4xl">{spec.name}</h1>
        </div>
        {others.length > 0 && (
          <p className="text-[15px] text-ink-soft">
            ¿Buscabas otra especialidad?{" "}
            {others.map((o, i) => (
              <span key={o.id}>
                {i > 0 && ", "}
                <Link href={`/reservar/${o.slug}`} className="link">{o.name}</Link>
              </span>
            ))}
          </p>
        )}
      </div>
      <BookingFlow
        specialty={{ slug: spec.slug, name: spec.name, durationMinutes: spec.durationMinutes }}
        tz={settings.timezone}
        initialMonth={localDate(new Date(), settings.timezone).slice(0, 7)}
        phoneRequired={settings.phoneRequired}
        formToken={formToken()}
        doctorName={doctorDisplayName(profile) ?? settings.appName}
      />
    </div>
  );
}
