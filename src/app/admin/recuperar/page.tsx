import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AuthCard } from "@/components/admin/auth-card";
import { getSiteConfig } from "@/lib/settings";
import { requestResetAction } from "../actions";

export const metadata: Metadata = { title: "Recuperar acceso", robots: { index: false } };

export default async function ResetPage() {
  const { settings } = await getSiteConfig();
  return (
    <AuthCard title="Recuperar acceso" appName={settings.appName}>
      <p className="mb-5 text-[15px] text-ink-soft">Te enviaremos un enlace para crear una contraseña nueva.</p>
      <ActionForm action={requestResetAction} className="space-y-5">
        <div>
          <label htmlFor="email" className="field-label">Correo electrónico</label>
          <input id="email" name="email" type="email" autoComplete="username" className="input" required />
        </div>
        <SubmitButton className="btn-primary w-full" pending="Enviando…">Enviar enlace</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm">
        <Link href="/admin/login" className="link">Volver a ingresar</Link>
      </p>
    </AuthCard>
  );
}
