/** Crea una base de datos de prueba limpia en PostgreSQL local y aplica las migraciones reales. */
import { execFileSync } from "node:child_process";
import postgres from "postgres";

export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

export function dbUrl(name: string) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function freshDatabase(name: string) {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const url = dbUrl(name);
  execFileSync("npx", ["tsx", "scripts/migrate.ts", "--local-shim"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  return url;
}
