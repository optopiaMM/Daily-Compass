import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@shared/schema";
import type { Db } from "./yearwise-commit";

// A real Postgres (PGlite, in-process) with the app schema, so transactions, FKs
// and unique constraints behave as they do on Neon.
export async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  for (const s of statements) await client.exec(s);
  return db as unknown as Db;
}
