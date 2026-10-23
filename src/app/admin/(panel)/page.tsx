import { nowMs } from "@/lib/clock";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { dashboardData, setupChecklist } from "@/lib/admin/queries";
import { getSiteConfig, listSpecialties, doctorDisplayName } from "@/lib/settings";
import { formatDate, formatLongDay, formatTime } from "@/lib/time";
import { JobBadge, KIND_LABEL, StatusBadge } from "@/components/admin/badges";
import { toneFor } from "@/components/specialty-tone";
import { IconCheck } from "@/components/icons";

export default async function DashboardPage() {
  await requireAdmin();
  const { settings, profile } = await getSiteConfig();
  const specialties = await listSpecialties();
  const tz = settings.timezone;
  const [d, checklist] = await Promise.all([dashboardData(tz, specialties), setupChecklist(settings, profile, specialties)]);
  const toneOf = (id: string) => toneFor(Math.max(0, specialties.findIndex((s) => s.id === id)));
  const pendingSetup = checklist.filter((c) => !c.done);
  const now = nowMs();
  const doctor = doctorDisplayName(profile);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold first-letter:uppercase">{formatLongDay(d.today)}</h1>
        {doctor && <p className="mt-1 text-ink-soft">{doctor}</p>}
      </div>

      {pendingSetup.length > 0 && (
        <section aria-labelledby="puesta" className="rounded-xl border border-warn/25 bg-warn-50 p-5">
          <h2 id="puesta" className="font-semibold">Para terminar la puesta en marcha</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[15px]">
                {c.done ? (
                  <IconCheck className="text-sage-700" />
                ) : (
                  <span className="inline-block h-5 w-5 rounded-full border-2 border-warn/50" aria-hidden />
                )}
                {c.done ? (
                  <span className="text-ink-soft line-through decoration-ink-soft/40">{c.label}</span>
                ) : (
                  <Link href={c.href} className="link">{c.label}</Link>
                )}
                <span className="sr-only">{c.done ? "(listo)" : "(pendiente)"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="hoy">
          <div className="flex items-baseline justify-between">
            <h2 id="hoy" className="text-lg font-semibold">Turnos de hoy</h2>
            <Link href="/admin/agenda?vista=dia" className="link text-sm">Ver agenda del día</Link>
          </div>
          {d.todayItems.length === 0 ? (
            <p className="panel mt-3 px-5 py-6 text-ink-soft">No hay turnos para hoy.</p>
          ) : (
            <ul className="panel mt-3 divide-y divide-line">
              {d.todayItems.map((a) => {
                const t = toneOf(a.specialtyId);
                const isNow = a.startsAt.getTime() <= now && a.endsAt.getTime() > now && a.status === "confirmed";
                return (
                  <li key={a.id}>
                    <Link href={`/admin/turnos/${a.id}`} className={`flex items-center gap-4 px-5 py-3 hover:bg-sage-50 ${a.status === "cancelled" ? "opacity-60" : ""}`}>
                      <span className="w-14 shrink-0 text-lg font-semibold tabular-nums">{formatTime(a.startsAt, tz)}</span>
                      <span className={`h-9 w-1 shrink-0 rounded-full ${t.dot}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-medium ${a.status === "cancelled" ? "line-through" : ""}`}>{a.patientName}</span>
                        <span className="text-sm text-ink-soft">{a.specialtyName}</span>
                      </span>
                      {isNow ? <span className="rounded-full bg-sage-700 px-2.5 py-0.5 text-xs font-semibold text-white">Ahora</span> : <StatusBadge status={a.status} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-8">
          <section aria-labelledby="libres">
            <h2 id="libres" className="text-lg font-semibold">Horarios libres hoy</h2>
            <div className="mt-3 space-y-3">
              {d.freeToday.map(({ specialty, slots }) => (
                <div key={specialty.id} className="panel px-5 py-4">
                  <p className="flex items-center justify-between">
                    <span className="font-medium">{specialty.name}</span>
                    <span className="text-2xl font-semibold tabular-nums">{slots.length}</span>
                  </p>
                  {slots.length > 0 && (
                    <p className="mt-1 text-sm text-ink-soft tabular-nums">
                      {slots.slice(0, 10).map((s) => formatTime(s.startsAt, tz)).join("  ")}
                      {slots.length > 10 ? ` y ${slots.length - 10} más` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="mes">
            <h2 id="mes" className="text-lg font-semibold">Consultas de este mes</h2>
            <ul className="mt-3 grid grid-cols-2 gap-3">
              {specialties.map((s, i) => (
                <li key={s.id} className={`rounded-xl ${toneFor(i).soft} px-4 py-3`}>
                  <p className="text-3xl font-semibold tabular-nums">{d.byMonth.find((m) => m.specialtyId === s.id)?.total ?? 0}</p>
                  <p className="text-sm text-ink-soft">{s.name}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section aria-labelledby="proximos">
        <h2 id="proximos" className="text-lg font-semibold">Próximos 7 días</h2>
        {d.upcoming.length === 0 ? (
          <p className="panel mt-3 px-5 py-6 text-ink-soft">No hay turnos confirmados en los próximos días.</p>
        ) : (
          <div className="panel mt-3 overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-line text-sm text-ink-soft">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Fecha</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Hora</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Paciente</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Especialidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.upcoming.map((a) => (
                  <tr key={a.id} className="hover:bg-sage-50">
                    <td className="px-5 py-2.5 tabular-nums">{formatDate(a.startsAt, tz)}</td>
                    <td className="px-3 py-2.5 font-semibold tabular-nums">{formatTime(a.startsAt, tz)}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/turnos/${a.id}`} className="hover:underline">{a.patientName}</Link>
                    </td>
                    <td className="px-5 py-2.5 text-ink-soft">{a.specialtyName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="cancelados">
          <h2 id="cancelados" className="text-lg font-semibold">Cancelaciones recientes</h2>
          {d.cancelled.length === 0 ? (
            <p className="panel mt-3 px-5 py-6 text-ink-soft">Sin cancelaciones en las últimas dos semanas.</p>
          ) : (
            <ul className="panel mt-3 divide-y divide-line">
              {d.cancelled.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/turnos/${a.id}`} className="flex justify-between gap-3 px-5 py-3 hover:bg-sage-50">
                    <span>
                      <span className="block font-medium">{a.patientName}</span>
                      <span className="text-sm text-ink-soft">
                        {a.specialtyName}, {formatDate(a.startsAt, tz)} {formatTime(a.startsAt, tz)} h
                      </span>
                    </span>
                    <span className="text-sm text-ink-soft">{a.cancelledBy === "patient" ? "Por el paciente" : "Desde el panel"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="correos">
          <div className="flex items-baseline justify-between">
            <h2 id="correos" className="text-lg font-semibold">Correos</h2>
            <Link href="/admin/correos" className="link text-sm">Ver registro</Link>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div className="panel px-4 py-3"><dt className="text-sm text-ink-soft">Programados</dt><dd className="text-2xl font-semibold tabular-nums">{d.notif.pending}</dd></div>
            <div className={`panel px-4 py-3 ${d.notif.failed ? "border-danger/40 bg-danger-50" : ""}`}><dt className="text-sm text-ink-soft">Fallidos</dt><dd className="text-2xl font-semibold tabular-nums">{d.notif.failed}</dd></div>
            <div className="panel px-4 py-3"><dt className="text-sm text-ink-soft">Enviados (7 días)</dt><dd className="text-2xl font-semibold tabular-nums">{d.notif.sent7}</dd></div>
          </dl>
          {d.failed.length > 0 && (
            <ul className="mt-3 space-y-2">
              {d.failed.map((f) => (
                <li key={f.id} className="rounded-lg border border-danger/25 bg-surface px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <JobBadge status="failed" /> {KIND_LABEL[f.kind] ?? f.kind} para{" "}
                    <Link href={`/admin/turnos/${f.appointmentId}`} className="link">{f.patientName}</Link>
                  </span>
                  {f.lastError && <span className="mt-1 block text-ink-soft">{f.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
