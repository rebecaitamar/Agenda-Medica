import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AuthCard } from "@/components/admin/auth-card";
import { getSiteConfig } from "@/lib/settings";
import { updatePasswordAction } from "../actions";

export const metadata: Metadata = { title: "Nueva contraseña", robots: { index: false } };

export default async function UpdatePasswordPage() {
  const { settings } = await getSiteConfig();
  return (
    <AuthCard title="Crear una contraseña nueva" appName={settings.appName}>
      <ActionForm action={updatePasswordAction} className="space-y-5">
        <div>
          <label htmlFor="password" className="field-label">Contraseña nueva</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} className="input" required aria-describedby="pw-hint" />
          <p id="pw-hint" className="field-hint">Al menos 10 caracteres.</p>
        </div>
        <div>
          <label htmlFor="confirm" className="field-label">Repetí la contraseña</label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" className="input" required />
        </div>
        <SubmitButton className="btn-primary w-full">Guardar contraseña</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
