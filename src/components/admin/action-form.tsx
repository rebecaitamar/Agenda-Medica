"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Notice } from "../notice";
import type { ActionState } from "@/app/admin/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function SubmitButton({ children, pending: pendingLabel, className = "btn-primary", ...rest }: { children: React.ReactNode; pending?: string; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || rest.disabled} {...rest}>
      {pending ? (pendingLabel ?? "Guardando…") : children}
    </button>
  );
}

/**
 * Formulario del panel conectado a una Server Action. Muestra el resultado
 * (éxito o error) junto al formulario. La validación real ocurre en el servidor.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state) msgRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state, resetOnSuccess]);

  const list = Array.isArray(state?.data) ? (state!.data as { id: string; label: string }[]) : null;

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div ref={msgRef} aria-live="polite">
        {state && (
          <div className="mt-4">
            <Notice tone={state.ok ? (list?.length ? "warning" : "success") : "error"}>
              {state.message}
              {list && list.length > 0 && (
                <ul className="mt-2 list-disc pl-5">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link href={`/admin/turnos/${a.id}`} className="link">{a.label}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Notice>
          </div>
        )}
      </div>
    </form>
  );
}
