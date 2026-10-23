import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AuthCard } from "@/components/admin/auth-card";
import { Notice } from "@/components/notice";
import { getAdmin } from "@/lib/auth";
import { getSiteConfig } from "@/lib/settings";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Ingresar al panel", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await getAdmin()) redirect("/admin");
  const { settings } = await getSiteConfig();
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <AuthCard title="Ingresar al panel" appName={settings.appName}>
      {!configured && (
        <div className="mb-5">
          <Notice tone="warning" title="Autenticación sin configurar">
            Faltan las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.
          </Notice>
        </div>
      )}
      {error === "link" && (
        <div className="mb-5">
          <Notice tone="warning">El enlace venció o ya se usó. Pedí uno nuevo.</Notice>
        </div>
      )}
      <ActionForm action={loginAction} className="space-y-5">
        <div>
          <label htmlFor="email" className="field-label">Correo electrónico</label>
          <input id="email" name="email" type="email" autoComplete="username" className="input" required />
        </div>
        <div>
          <label htmlFor="password" className="field-label">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" className="input" required />
        </div>
        <SubmitButton className="btn-primary w-full" pending="Ingresando…">Ingresar</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm">
        <Link href="/admin/recuperar" className="link">Olvidé mi contraseña</Link>
      </p>
    </AuthCard>
  );
}
