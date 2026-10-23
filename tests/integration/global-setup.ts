import { freshDatabase } from "../support/db";

export default async function setup() {
  const name = new URL(process.env.TEST_DATABASE_URL ?? "postgres://x/agenda_it").pathname.slice(1) || "agenda_it";
  await freshDatabase(name);
}
