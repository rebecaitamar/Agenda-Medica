import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Destino de los enlaces de Supabase Auth (recuperación de contraseña e
 * invitaciones). Admite el formato con token_hash (recomendado para SSR) y el
 * formato con code (PKCE).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/admin";
  const safeNext = next.startsWith("/admin") ? next : "/admin";
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  try {
    const supabase = await createSupabaseServer();
    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) return NextResponse.redirect(new URL(safeNext, url));
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeNext, url));
    }
  } catch (e) {
    console.error("[auth] confirmación falló", (e as Error).message);
  }
  return NextResponse.redirect(new URL("/admin/login?error=link", url));
}
