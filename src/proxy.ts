import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Renueva la sesión de Supabase en cada solicitud al panel y redirige al
 * inicio de sesión si no hay usuario. Es un control optimista: cada página y
 * acción del panel vuelve a verificar la sesión y el permiso de administración
 * en el servidor (requireAdmin).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;
  const isPublicAdminPage = pathname === "/admin/login" || pathname === "/admin/recuperar";

  if (!url || !key) {
    if (isPublicAdminPage) return response;
    return NextResponse.redirect(new URL("/admin/login?error=config", request.url));
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicAdminPage) {
    const to = new URL("/admin/login", request.url);
    return NextResponse.redirect(to);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
