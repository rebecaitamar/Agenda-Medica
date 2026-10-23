import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { createSupabaseServer } from "./supabase/server";

export type AdminSession = { userId: string; email: string | null };

/**
 * Verifica la sesión con Supabase Auth (getUser valida el token contra el
 * servidor de autenticación) y que el usuario figure en admin_users.
 */
export const getAdmin = cache(async (): Promise<AdminSession | null> => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [row] = await sql<{ userId: string }[]>`select user_id from admin_users where user_id = ${user.id}`;
  if (!row) return null;
  return { userId: user.id, email: user.email ?? null };
});

/** Para páginas del panel: redirige al login si no hay una sesión de administración válida. */
export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/** Para Server Actions y Route Handlers: lanza un error en lugar de redirigir. */
export async function assertAdmin(): Promise<AdminSession> {
  const admin = await getAdmin();
  if (!admin) throw new UnauthorizedError();
  return admin;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("No autorizado");
  }
}
