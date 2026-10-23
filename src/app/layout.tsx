import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSiteConfig, doctorDisplayName } from "@/lib/settings";

// La agenda cambia en cada reserva: todas las páginas se generan por solicitud.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { settings, profile } = await getSiteConfig();
    const doctor = doctorDisplayName(profile);
    return {
      title: { default: settings.appName, template: `%s | ${settings.appName}` },
      description: doctor
        ? `Turnos online con ${doctor}: Medicina Clínica y Dermatología.`
        : "Solicitá tu turno online de Medicina Clínica o Dermatología.",
    };
  } catch {
    return { title: "Agenda Médica" };
  }
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2e5e4e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
