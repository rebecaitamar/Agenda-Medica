/**
 * Aplica las migraciones de supabase/migrations en orden, registrando cuáles
 * ya se ejecutaron. Útil para entornos locales o si preferís no usar la CLI
 * de Supabase. En Supabase también podés usar `npx supabase db push`.
 *
 *   DATABASE_URL=... npx tsx scripts/migrate.ts            # aplica pendientes
 *   DATABASE_URL=... npx tsx scripts/migrate.ts --local-shim # (solo local) crea antes los objetos de Supabase
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (process.argv.includes("--local-shim")) {
      await sql.unsafe(readFileSync(join(process.cwd(), "scripts/local/supabase-shim.sql"), "utf8"));
      console.log("✓ shim local de Supabase");
    }
    await sql`create table if not exists public._app_migrations (name text primary key, applied_at timestamptz not null default now())`;
    await sql`alter table public._app_migrations enable row level security`;
    await sql.unsafe("revoke all on public._app_migrations from anon, authenticated").catch(() => {});
    const done = new Set((await sql<{ name: string }[]>`select name from public._app_migrations`).map((r) => r.name));
    const dir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const body = readFileSync(join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public._app_migrations (name) values (${f})`;
      });
      console.log(`✓ ${f}`);
    }
    console.log("Migraciones al día.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
