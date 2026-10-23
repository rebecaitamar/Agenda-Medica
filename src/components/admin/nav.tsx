"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Inicio", exact: true },
  { href: "/admin/agenda", label: "Agenda" },
  { href: "/admin/turnos/nuevo", label: "Nuevo turno" },
  { href: "/admin/horarios", label: "Horarios" },
  { href: "/admin/bloqueos", label: "Bloqueos" },
  { href: "/admin/correos", label: "Correos" },
  { href: "/admin/configuracion", label: "Configuración" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Panel" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {ITEMS.map((i) => {
          const active = i.exact ? path === i.href : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 text-[15px] font-medium ${active ? "bg-sage-100 text-sage-800" : "text-ink-soft hover:bg-sage-50 hover:text-ink"}`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
