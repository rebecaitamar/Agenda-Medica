import "server-only";
import postgres from "postgres";

/**
 * Conexión única a PostgreSQL (Supabase). Solo se usa en el servidor.
 * - `prepare: false` es necesario con el pooler de Supabase en modo transacción (puerto 6543).
 * - Las columnas se convierten a camelCase.
 * - Las columnas `date` se devuelven como texto 'YYYY-MM-DD' para evitar corrimientos de zona horaria.
 */
type Sql = postgres.Sql<{ bigint: number }>;

const g = globalThis as unknown as { __agendaSql?: Sql };

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable de entorno DATABASE_URL");
  return postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    transform: postgres.camel,
    types: {
      bigint: postgres.BigInt,
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    } as never,
  }) as unknown as Sql;
}

// Proxy perezoso: la conexión se crea en el primer uso (no durante el build).
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  get(_t, prop) {
    g.__agendaSql ??= create();
    const v = (g.__agendaSql as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(g.__agendaSql) : v;
  },
  apply(_t, _this, args) {
    g.__agendaSql ??= create();
    return (g.__agendaSql as unknown as (...a: unknown[]) => unknown)(...args);
  },
}) as Sql;

export type Tx = postgres.TransactionSql<{ bigint: number }>;
export type Db = Sql | Tx;

/** Código de PostgreSQL para violaciones de restricciones de exclusión (superposición). */
export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_UNIQUE_VIOLATION = "23505";

export function isPgError(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === code;
}
