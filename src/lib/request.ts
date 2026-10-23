import "server-only";
import { headers } from "next/headers";
import { sha256 } from "./crypto";
import { env } from "./env";
import { sql } from "./db";

/** IP del cliente según el proxy de la plataforma (Vercel), solo para límites de uso. */
export async function clientIp() {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Límite de solicitudes por ventana fija, guardado en PostgreSQL (funciona en
 * entornos serverless sin Redis). La clave se guarda como hash: no se
 * almacenan IPs ni correos en claro.
 */
export async function rateLimit(scope: string, identifier: string, limit: number, windowSeconds: number) {
  const bucket = sha256(`${env.appSecret}:${scope}:${identifier}`).slice(0, 40);
  const [row] = await sql<{ hits: number }[]>`select hit_rate_limit(${bucket}, ${windowSeconds}) as hits`;
  return row.hits <= limit;
}

/** Base pública para enlaces (APP_URL). */
export function baseUrl() {
  return env.appUrl;
}
