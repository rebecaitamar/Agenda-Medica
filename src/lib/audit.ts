import "server-only";
import { sql, type Db } from "./db";

export type Actor = { type: "admin"; userId: string } | { type: "patient" } | { type: "system" };

/** Registro de acciones relevantes. `details` no debe incluir datos personales. */
export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
  db: Db = sql,
) {
  await db`
    insert into audit_logs (actor_type, actor_user_id, action, entity, entity_id, details)
    values (${actor.type}, ${actor.type === "admin" ? actor.userId : null}, ${action}, ${entity}, ${entityId}, ${db.json(details as never)})`;
}
