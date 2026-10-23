/**
 * Crea (o habilita) la cuenta de la médica para el panel.
 *
 *   npm run create-admin -- --email dra@ejemplo.com
 *       Envía una invitación por correo (Supabase) para que elija su contraseña.
 *
 *   ADMIN_PASSWORD='una-clave-larga' npm run create-admin -- --email dra@ejemplo.com --password
 *       Crea la cuenta con esa contraseña (sin correo de invitación).
 *
 * Requiere DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y APP_URL.
 */
import "dotenv/config";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

config({ path: ".env.local" });

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

async function main() {
  const email = (arg("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Indicá el correo: --email dra@ejemplo.com");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!url || !serviceKey || !dbUrl) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o DATABASE_URL");
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let userId: string | null = null;

  // ¿Ya existe?
  for (let page = 1; page < 20 && !userId; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 200) break;
  }

  if (!userId) {
    if (process.argv.includes("--password")) {
      const password = process.env.ADMIN_PASSWORD ?? "";
      if (password.length < 10) throw new Error("ADMIN_PASSWORD debe tener al menos 10 caracteres");
      const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      userId = data.user.id;
      console.log(`✓ Cuenta creada para ${email}`);
    } else {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${appUrl}/auth/confirm?next=/admin/actualizar-clave`,
      });
      if (error) throw error;
      userId = data.user.id;
      console.log(`✓ Invitación enviada a ${email}. Al abrir el enlace va a poder elegir su contraseña.`);
    }
  } else {
    console.log(`La cuenta ${email} ya existía en Supabase Auth.`);
  }

  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [settings] = await sql<{ profile_id: string }[]>`select profile_id from clinic_settings where id`;
    if (!settings) throw new Error("No hay configuración del consultorio: ejecutá primero las migraciones");
    await sql`insert into admin_users (user_id, profile_id) values (${userId}, ${settings.profile_id}) on conflict (user_id) do nothing`;
    await sql`update profiles set user_id = coalesce(user_id, ${userId}) where id = ${settings.profile_id}`;
    console.log("✓ Acceso al panel habilitado.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
