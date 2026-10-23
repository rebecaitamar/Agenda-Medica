const STATUS: Record<string, { label: string; cls: string }> = {
  pending_verification: { label: "Esperando verificación", cls: "bg-warn-50 text-warn" },
  confirmed: { label: "Confirmado", cls: "bg-sage-100 text-sage-800" },
  cancelled: { label: "Cancelado", cls: "bg-danger-50 text-danger" },
  completed: { label: "Realizada", cls: "bg-sky-100 text-sky-700" },
  no_show: { label: "Ausente", cls: "bg-sand text-ink" },
  expired: { label: "Vencido", cls: "bg-sand-50 text-ink-soft" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-sand text-ink" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

const JOB: Record<string, { label: string; cls: string }> = {
  pending: { label: "Programado", cls: "bg-sky-100 text-sky-700" },
  processing: { label: "Enviando", cls: "bg-sky-100 text-sky-700" },
  sent: { label: "Enviado", cls: "bg-sage-100 text-sage-800" },
  failed: { label: "Falló", cls: "bg-danger-50 text-danger" },
  cancelled: { label: "Cancelado", cls: "bg-sand-50 text-ink-soft" },
  skipped: { label: "Omitido", cls: "bg-sand text-ink-soft" },
};

export function JobBadge({ status }: { status: string }) {
  const s = JOB[status] ?? { label: status, cls: "bg-sand text-ink" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export const KIND_LABEL: Record<string, string> = {
  verification_code: "Código de verificación",
  confirmation: "Confirmación",
  reminder: "Recordatorio",
  rescheduled: "Reprogramación",
  cancelled: "Cancelación",
};
