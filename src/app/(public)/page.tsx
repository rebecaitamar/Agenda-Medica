import Link from "next/link";
import { nextAvailableSlot } from "@/lib/availability";
import { doctorDisplayName, fullAddress, getActiveSpecialties, getSiteConfig } from "@/lib/settings";
import { formatLongDate, formatTime } from "@/lib/time";
import { IconChat, IconClock, IconMail, IconPhone, IconPin } from "@/components/icons";
import { toneFor } from "@/components/specialty-tone";

export default async function HomePage() {
  const [{ settings, profile }, specialties] = await Promise.all([getSiteConfig(), getActiveSpecialties()]);
  const tz = settings.timezone;
  const doctor = doctorDisplayName(profile);
  const address = fullAddress(settings);
  const nexts = await Promise.all(specialties.map((s) => nextAvailableSlot(s, tz)));
  const hasContact = settings.contactPhone || settings.contactWhatsapp || settings.contactEmail;

  return (
    <>
      <section className="mx-auto max-w-5xl px-4 pt-10 pb-8 sm:px-6 sm:pt-16">
        <div className="grid items-start gap-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-2xl">
            <h1 className="font-serif text-4xl leading-[1.1] font-semibold tracking-tight text-ink sm:text-5xl">
              {doctor ?? settings.appName}
            </h1>
            <p className="mt-3 text-lg text-ink-soft">
              {specialties.map((s) => s.name).join(" y ")}
              {profile.licenseNumber ? `. Matrícula ${profile.licenseNumber}` : ""}
            </p>
            {profile.bio && <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed whitespace-pre-line">{profile.bio}</p>}
          </div>
          {profile.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoUrl}
              alt={doctor ? `Fotografía de ${doctor}` : "Fotografía de la profesional"}
              className="h-40 w-40 rounded-full border-4 border-surface object-cover shadow-sm sm:h-48 sm:w-48"
            />
          )}
        </div>
      </section>

      <section aria-labelledby="especialidades" className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="especialidades" className="sr-only">
          Elegí la especialidad
        </h2>
        {specialties.length === 0 ? (
          <p className="panel p-6 text-ink-soft">Por el momento no hay especialidades habilitadas para turnos online.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {specialties.map((s, i) => {
              const tone = toneFor(i);
              const next = nexts[i];
              return (
                <li key={s.id} className={`panel flex flex-col overflow-hidden`}>
                  <div className={`h-1.5 ${tone.dot}`} aria-hidden />
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className={`font-serif text-2xl font-semibold ${tone.text}`}>{s.name}</h3>
                    {s.description && <p className="mt-2 text-ink-soft">{s.description}</p>}
                    <div className={`mt-5 rounded-xl ${tone.soft} px-4 py-3`}>
                      {next ? (
                        <p className="text-[15px]">
                          <span className="block text-ink-soft">Próximo turno disponible</span>
                          <span className="block text-lg font-semibold first-letter:uppercase">
                            {formatLongDate(next.startsAt, tz)}, {formatTime(next.startsAt, tz)} h
                          </span>
                        </p>
                      ) : (
                        <p className="text-[15px] text-ink-soft">No hay horarios disponibles por ahora. Probá más adelante o comunicate con el consultorio.</p>
                      )}
                    </div>
                    <div className="mt-5 flex items-center justify-between gap-3">
                      <span className="text-sm text-ink-soft">Consultas de {s.durationMinutes} minutos</span>
                      <Link href={`/reservar/${s.slug}`} className="btn-primary" aria-label={`Solicitar un turno de ${s.name}`}>
                        Solicitar un turno
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(address || hasContact || (settings.showPublicHours && settings.publicHoursText) || settings.arrivalInstructions) && (
        <section aria-labelledby="consultorio" className="mx-auto mt-14 max-w-5xl px-4 sm:px-6">
          <h2 id="consultorio" className="font-serif text-2xl font-semibold">
            El consultorio
          </h2>
          <div className="mt-5 grid gap-x-10 gap-y-8 md:grid-cols-2">
            <div className="space-y-5">
              {address && (
                <p className="flex gap-3">
                  <IconPin className="mt-0.5 shrink-0 text-sage-700" />
                  <span>
                    {address}
                    {settings.mapsUrl && (
                      <>
                        <br />
                        <a href={settings.mapsUrl} className="link text-[15px]" target="_blank" rel="noopener noreferrer">
                          Ver en el mapa
                        </a>
                      </>
                    )}
                  </span>
                </p>
              )}
              {settings.showPublicHours && settings.publicHoursText && (
                <p className="flex gap-3">
                  <IconClock className="mt-0.5 shrink-0 text-sage-700" />
                  <span className="whitespace-pre-line">{settings.publicHoursText}</span>
                </p>
              )}
              {settings.contactPhone && (
                <p className="flex gap-3">
                  <IconPhone className="mt-0.5 shrink-0 text-sage-700" />
                  <a href={`tel:${settings.contactPhone.replace(/[^\d+]/g, "")}`} className="hover:underline">
                    {settings.contactPhone}
                  </a>
                </p>
              )}
              {settings.contactWhatsapp && (
                <p className="flex gap-3">
                  <IconChat className="mt-0.5 shrink-0 text-sage-700" />
                  <a
                    href={`https://wa.me/${settings.contactWhatsapp.replace(/\D/g, "")}`}
                    className="hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp {settings.contactWhatsapp}
                  </a>
                </p>
              )}
              {settings.contactEmail && (
                <p className="flex gap-3">
                  <IconMail className="mt-0.5 shrink-0 text-sage-700" />
                  <a href={`mailto:${settings.contactEmail}`} className="hover:underline">
                    {settings.contactEmail}
                  </a>
                </p>
              )}
            </div>
            {(settings.arrivalInstructions || settings.cancellationPolicyText) && (
              <div className="space-y-6">
                {settings.arrivalInstructions && (
                  <div className="rounded-xl bg-sand px-5 py-4">
                    <h3 className="font-semibold">Para tu consulta</h3>
                    <p className="mt-1.5 leading-relaxed whitespace-pre-line">{settings.arrivalInstructions}</p>
                  </div>
                )}
                {settings.cancellationPolicyText && (
                  <div>
                    <h3 className="font-semibold">Cancelaciones y cambios</h3>
                    <p className="mt-1.5 leading-relaxed whitespace-pre-line text-ink-soft">{settings.cancellationPolicyText}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
