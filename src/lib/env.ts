import "server-only";

/** Lee una variable de entorno del servidor. Nunca usar en componentes de cliente. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** URL pública de la app, sin barra final. Se usa en enlaces de correos. */
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  /** Secreto para firmar enlaces de gestión, formularios y anonimizar IPs. */
  get appSecret() {
    const v = required("APP_SECRET");
    if (v.length < 32) throw new Error("APP_SECRET debe tener al menos 32 caracteres");
    return v;
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? "";
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? "";
  },
  get emailReplyTo() {
    return process.env.EMAIL_REPLY_TO ?? "";
  },
  /** Solo para pruebas automatizadas: permite apuntar a un servidor de prueba. */
  get resendBaseUrl() {
    return (process.env.RESEND_API_BASE_URL ?? "https://api.resend.com").replace(/\/+$/, "");
  },
  get supabaseUrl() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  },
  get supabaseAnonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  },
};
