import Link from "next/link";
import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/nav";
import { requireAdmin } from "@/lib/auth";
import { getSiteConfig } from "@/lib/settings";
import { logoutAction } from "../actions";

export const metadata: Metadata = { title: { default: "Panel", template: "%s | Panel" }, robots: { index: false, follow: false } };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const { settings } = await getSiteConfig();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3">
            <Link href="/admin" className="font-serif text-lg font-semibold text-sage-800">
              {settings.appName}
            </Link>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-ink-soft sm:inline">{admin.email}</span>
              <Link href="/" className="btn-quiet min-h-9 text-sm" target="_blank">Ver sitio</Link>
              <form action={logoutAction}>
                <button type="submit" className="btn-secondary min-h-9 px-3 text-sm">Salir</button>
              </form>
            </div>
          </div>
          <div className="pb-2">
            <AdminNav />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
