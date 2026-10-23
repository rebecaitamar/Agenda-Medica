"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTimePicker } from "./date-time-picker";
import { useAvailability } from "./use-availability";
import { Notice } from "../notice";
import { formatLongDate, formatTime } from "@/lib/time";

export function ManageAppointment({
  token,
  tz,
  specialtySlug,
  canCancel,
  canReschedule,
  initialMonth,
}: {
  token: string;
  tz: string;
  specialtySlug: string;
  canCancel: boolean;
  canReschedule: boolean;
  initialMonth: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "cancel" | "reschedule">("idle");
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const avail = useAvailability(specialtySlug, initialMonth);

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "No pudimos completar la acción.");
        if (data?.error?.code === "slot_unavailable") {
          setSlot(null);
          await avail.refresh();
        }
        return;
      }
      setDone(success);
      setMode("idle");
      router.refresh();
    } catch {
      setError("No hay conexión. Revisá tu internet e intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Notice tone="success" role="status">{done}</Notice>;

  return (
    <div className="space-y-5">
      {error && <Notice tone="error">{error}</Notice>}
      {mode === "idle" && (canCancel || canReschedule) && (
        <div className="flex flex-col gap-3 sm:flex-row">
          {canReschedule && (
            <button type="button" className="btn-primary" onClick={() => setMode("reschedule")}>
              Cambiar día u horario
            </button>
          )}
          {canCancel && (
            <button type="button" className="btn-danger" onClick={() => setMode("cancel")}>
              Cancelar turno
            </button>
          )}
        </div>
      )}

      {mode === "cancel" && (
        <div className="panel space-y-4 p-5">
          <p className="font-semibold">¿Querés cancelar el turno?</p>
          <p className="text-[15px] text-ink-soft">El horario queda libre para otra persona. Te enviaremos un correo con la cancelación.</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" className="btn-secondary" onClick={() => setMode("idle")} disabled={busy}>
              No, mantener el turno
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => act({ action: "cancel" }, "Cancelamos tu turno. Te enviamos un correo con la confirmación.")}>
              {busy ? "Cancelando…" : "Sí, cancelar turno"}
            </button>
          </div>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="panel space-y-5 p-5">
          <p className="font-semibold">Elegí el nuevo día y horario</p>
          <DateTimePicker avail={avail} tz={tz} selectedSlot={slot} onSelectSlot={setSlot} />
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="btn-secondary" onClick={() => setMode("idle")} disabled={busy}>
              Volver
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!slot || busy}
              onClick={() =>
                slot &&
                act(
                  { action: "reschedule", startsAt: slot },
                  `Listo: tu turno quedó para el ${formatLongDate(slot, tz)} a las ${formatTime(slot, tz)} h. Te enviamos un correo con el cambio.`,
                )
              }
            >
              {busy ? "Guardando…" : slot ? `Confirmar ${formatTime(slot, tz)} h` : "Elegí un horario"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
