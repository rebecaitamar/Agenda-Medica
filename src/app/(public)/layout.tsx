import Link from "next/link";
import { getSiteConfig, fullAddress } from "@/lib/settings";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { settings } = await getSiteConfig();
  const address = fullAddress(settings);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Ir al contenido
      </a>
      <header className="border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="font-serif text-lg font-semibold text-sage-800 sm:text-xl">
            {settings.appName}
          </Link>
          <Link href="/reservar" className="btn-primary min-h-10 px-4 text-sm">
            Solicitar un turno
          </Link>
        </div>
      </header>
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <footer className="mt-16 border-t border-line bg-sand-50">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            {settings.appName}
            {address ? `, ${address}` : ""}
          </p>
          <nav aria-label="Enlaces legales" className="flex gap-5">
            <Link href="/privacidad" className="hover:text-ink hover:underline">
              Política de privacidad
            </Link>
            <Link href="/admin" className="hover:text-ink hover:underline" rel="nofollow">
              Acceso profesional
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
