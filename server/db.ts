import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

// Mask the URL for logging (don't leak the password)
const maskedUrl = process.env.DATABASE_URL.replace(/(:)([^:@]+)(@)/, "$1***$3");
console.log(`[db] connecting to ${maskedUrl}`);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("[db pool error]", err.message);
});

export const db = drizzle(pool, { schema });

export async function pingDb(): Promise<void> {
  const result = await pool.query("SELECT 1 as ok");
  if (!result.rows[0]?.ok) throw new Error("DB ping returned unexpected result");
}
