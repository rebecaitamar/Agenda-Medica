"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DateTimePicker } from "./date-time-picker";
import { useAvailability } from "./use-availability";
import { Notice } from "../notice";
import { IconCalendar, IconCheck, IconPin } from "../icons";
import { formatLongDate, formatTime } from "@/lib/time";

type Summary = {
  specialtyName: string;
  startsAt: string;
  endsAt: string;
  address: string | null;
  mapsUrl: string | null;
  arrivalInstructions: string | null;
  emailMasked: string | null;
  manageUrl: string;
};

type Props = {
  specialty: { slug: string; name: string; durationMinutes: number };
  tz: string;
  initialMonth: string;
  phoneRequired: boolean;
  formToken: string;
  doctorName: string;
};

type Step = "time" | "details" | "verify" | "done";
type ApiError = { code: string; message: string; field?: string };

const STEPS: { key: Step; label: string }[] = [
  { key: "time", label: "Día y horario" },
  { key: "details", label: "Tus datos" },
  { key: "done", label: "Confirmación" },
];

async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> & { error?: ApiError } }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: { code: "network", message: "No hay conexión. Revisá tu internet e intentá de nuevo." } } };
  }
}

function icsFor(s: Summary, doctor: string) {
  const fmt = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agenda Medica//ES", "BEGIN:VEVENT",
    `UID:${fmt(s.startsAt)}-${Math.random().toString(36).slice(2)}@agenda`,
    `DTSTAMP:${fmt(new Date().toISOString())}`, `DTSTART:${fmt(s.startsAt)}`, `DTEND:${fmt(s.endsAt)}`,
    `SUMMARY:Turno de ${s.specialtyName} - ${doctor}`.replace(/[,;]/g, " "),
    ...(s.address ? [`LOCATION:${s.address.replace(/[,;]/g, " ")}`] : []),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

export function BookingFlow({ specialty, tz, initialMonth, phoneRequired, formToken, doctorName }: Props) {
  const avail = useAvailability(specialty.slug, initialMonth);
  const [step, setStep] = useState<Step>("time");
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", acceptPrivacy: false, website: "" });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ bookingId: string; emailMasked: string; expiresAt: string } | null>(null);
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const slotLost = async (e: ApiError) => {
    setSlot(null);
    await avail.refresh();
    setStep("time");
    setError(e);
  };

  async function submitDetails(ev: React.FormEvent) {
    ev.preventDefault();
    if (!slot || busy) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/public/bookings", { ...form, specialty: specialty.slug, startsAt: slot, formToken });
    setBusy(false);
    if (r.ok && r.data.state === "verify") {
      setPending(r.data as never);
      setCode("");
      return go("verify");
    }
    if (r.ok && r.data.state === "confirmed") {
      setSummary(r.data.summary as Summary);
      return go("done");
    }
    const e = r.data.error ?? { code: "server_error", message: "No pudimos registrar el turno. Intentá de nuevo." };
    if (e.code === "slot_unavailable") return slotLost(e);
    setError(e);
  }

  async function submitCode(ev: React.FormEvent) {
    ev.preventDefault();
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/public/bookings/verify", { bookingId: pending.bookingId, code });
    setBusy(false);
    if (r.ok) {
      setSummary(r.data.summary as Summary);
      return go("done");
    }
    const e = r.data.error ?? { code: "server_error", message: "No pudimos confirmar el turno. Intentá de nuevo." };
    if (["expired", "too_many_attempts", "not_found"].includes(e.code)) {
      setPending(null);
      return slotLost(e);
    }
    setError(e);
  }

  async function resend() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/public/bookings/resend", { bookingId: pending.bookingId });
    setBusy(false);
    if (r.ok) setResent(true);
    else setError(r.data.error ?? { code: "server_error", message: "No pudimos reenviar el código." });
  }

  const stepIndex = step === "verify" ? 1 : STEPS.findIndex((s) => s.key === step);
  const fieldError = (f: string) => (error?.field === f ? error.message : null);

  return (
    <div>
      <ol className="mb-8 flex gap-2 text-sm" aria-label="Pasos de la reserva">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 flex-col gap-1.5" aria-current={i === stepIndex ? "step" : undefined}>
            <span className={`h-1 rounded-full ${i <= stepIndex ? "bg-sage-700" : "bg-line"}`} aria-hidden />
            <span className={i === stepIndex ? "font-semibold text-ink" : "text-ink-soft"}>
              {i + 1}. {s.label}
            </span>
          </li>
        ))}
      </ol>

      {error && step !== "details" && step !== "verify" && (
        <div className="mb-6">
          <Notice tone="warning" title={error.code === "slot_unavailable" ? "Ese horario ya no está disponible" : undefined}>
            {error.message}
          </Notice>
        </div>
      )}

      {step === "time" && (
        <section aria-labelledby="paso-horario">
          <h2 id="paso-horario" ref={headingRef} tabIndex={-1} className="mb-5 font-serif text-2xl font-semibold outline-none">
            Elegí día y horario
          </h2>
          <DateTimePicker
            avail={avail}
            tz={tz}
            selectedSlot={slot}
            onSelectSlot={(s) => {
              setSlot(s);
              setError(null);
            }}
          />
          <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px]" aria-live="polite">
                {slot ? (
                  <>
                    <span className="first-letter:uppercase">{formatLongDate(slot, tz)}</span>, <strong>{formatTime(slot, tz)} h</strong>
                  </>
                ) : (
                  <span className="text-ink-soft">Sin horario elegido</span>
                )}
              </p>
              <button type="button" className="btn-primary" disabled={!slot} onClick={() => go("details")}>
                Continuar
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "details" && slot && (
        <section aria-labelledby="paso-datos" className="max-w-xl">
          <h2 id="paso-datos" ref={headingRef} tabIndex={-1} className="font-serif text-2xl font-semibold outline-none">
            Completá tus datos
          </h2>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-sage-50 px-4 py-3">
            <p className="text-[15px]">
              {specialty.name}
              <br />
              <strong className="first-letter:uppercase">
                {formatLongDate(slot, tz)}, {formatTime(slot, tz)} h
              </strong>
            </p>
            <button type="button" className="btn-quiet shrink-0" onClick={() => go("time")}>
              Cambiar
            </button>
          </div>

          <form onSubmit={submitDetails} className="mt-6 space-y-5" noValidate>
            <div>
              <label htmlFor="fullName" className="field-label">Nombre y apellido</label>
              <input
                id="fullName" className="input" autoComplete="name" required maxLength={120}
                value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                aria-invalid={Boolean(fieldError("fullName"))} aria-describedby={fieldError("fullName") ? "fullName-err" : undefined}
              />
              {fieldError("fullName") && <p id="fullName-err" className="field-error">{fieldError("fullName")}</p>}
            </div>
            <div>
              <label htmlFor="email" className="field-label">Correo electrónico</label>
              <input
                id="email" type="email" inputMode="email" className="input" autoComplete="email" required maxLength={254}
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                aria-invalid={Boolean(fieldError("email"))} aria-describedby="email-hint"
              />
              <p id="email-hint" className={fieldError("email") ? "field-error" : "field-hint"}>
                {fieldError("email") ?? "Te enviaremos ahí la confirmación y el recordatorio."}
              </p>
            </div>
            <div>
              <label htmlFor="phone" className="field-label">
                Teléfono {phoneRequired ? "" : <span className="font-normal text-ink-soft">(opcional)</span>}
              </label>
              <input
                id="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" required={phoneRequired} maxLength={40}
                value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                aria-invalid={Boolean(fieldError("phone"))} aria-describedby={fieldError("phone") ? "phone-err" : undefined}
              />
              {fieldError("phone") && <p id="phone-err" className="field-error">{fieldError("phone")}</p>}
            </div>
            {/* Campo trampa para bots: invisible para personas y lectores de pantalla. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="website">No completar</label>
              <input id="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </div>
            <div>
              <label className="flex items-start gap-3 text-[15px] leading-relaxed">
                <input
                  type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-sage-700" required
                  checked={form.acceptPrivacy} onChange={(e) => setForm({ ...form, acceptPrivacy: e.target.checked })}
                  aria-invalid={Boolean(fieldError("acceptPrivacy"))}
                />
                <span>
                  Acepto la{" "}
                  <Link href="/privacidad" target="_blank" className="link">
                    política de privacidad
                  </Link>{" "}
                  y el uso de mis datos para gestionar el turno.
                </span>
              </label>
              {fieldError("acceptPrivacy") && <p className="field-error">{fieldError("acceptPrivacy")}</p>}
            </div>

            {error && !error.field && <Notice tone="error">{error.message}</Notice>}

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
              <button type="button" className="btn-secondary" onClick={() => go("time")}>Volver</button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Reservando…" : "Reservar turno"}
              </button>
            </div>
          </form>
        </section>
      )}

      {step === "verify" && pending && (
        <section aria-labelledby="paso-codigo" className="max-w-md">
          <h2 id="paso-codigo" ref={headingRef} tabIndex={-1} className="font-serif text-2xl font-semibold outline-none">
            Revisá tu correo
          </h2>
          <p className="mt-3 leading-relaxed">
            Enviamos un código de 6 números a <strong>{pending.emailMasked}</strong>. Ingresalo para confirmar el turno. Guardamos
            el horario hasta las <strong>{formatTime(pending.expiresAt, tz)} h</strong>.
          </p>
          <form onSubmit={submitCode} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="code" className="field-label">Código de verificación</label>
              <input
                id="code" className="input max-w-52 text-center text-2xl tracking-[0.4em] tabular-nums" inputMode="numeric"
                autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-invalid={Boolean(error)} aria-describedby={error ? "code-err" : undefined}
              />
              {error && <p id="code-err" className="field-error" role="alert">{error.message}</p>}
            </div>
            <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy || code.length !== 6}>
              {busy ? "Confirmando…" : "Confirmar turno"}
            </button>
          </form>
          <div className="mt-6 space-y-2 text-[15px] text-ink-soft">
            <p>¿No llegó? Revisá la carpeta de correo no deseado.</p>
            {resent ? (
              <p className="text-sage-700" role="status">Te enviamos un código nuevo.</p>
            ) : (
              <button type="button" className="link" onClick={resend} disabled={busy}>Enviar un código nuevo</button>
            )}
          </div>
        </section>
      )}

      {step === "done" && summary && (
        <section aria-labelledby="paso-listo" className="max-w-xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-700 text-white">
              <IconCheck width={24} height={24} />
            </span>
            <h2 id="paso-listo" ref={headingRef} tabIndex={-1} className="font-serif text-3xl font-semibold outline-none">
              Turno confirmado
            </h2>
          </div>
          <dl className="panel mt-6 divide-y divide-line">
            {[
              ["Profesional", doctorName],
              ["Especialidad", summary.specialtyName],
              ["Fecha", formatLongDate(summary.startsAt, tz)],
              ["Hora", `${formatTime(summary.startsAt, tz)} h`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-5 py-3">
                <dt className="text-ink-soft">{k}</dt>
                <dd className="text-right font-semibold first-letter:uppercase">{v}</dd>
              </div>
            ))}
            {summary.address && (
              <div className="flex gap-3 px-5 py-3">
                <IconPin className="mt-0.5 shrink-0 text-sage-700" />
                <div>
                  <p>{summary.address}</p>
                  {summary.mapsUrl && (
                    <a href={summary.mapsUrl} target="_blank" rel="noopener noreferrer" className="link text-[15px]">Ver en el mapa</a>
                  )}
                </div>
              </div>
            )}
          </dl>
          {summary.arrivalInstructions && (
            <div className="mt-5 rounded-xl bg-sand px-5 py-4">
              <h3 className="font-semibold">Para tu consulta</h3>
              <p className="mt-1.5 leading-relaxed whitespace-pre-line">{summary.arrivalInstructions}</p>
            </div>
          )}
          {summary.emailMasked && (
            <p className="mt-5 leading-relaxed">
              Te enviamos la confirmación a <strong>{summary.emailMasked}</strong>. Antes de la consulta vas a recibir un recordatorio.
            </p>
          )}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a href={icsFor(summary, doctorName)} download="turno.ics" className="btn-secondary">
              <IconCalendar /> Agregar a mi calendario
            </a>
            <a href={summary.manageUrl} className="btn-quiet">Ver o modificar mi turno</a>
          </div>
        </section>
      )}
    </div>
  );
}
