// server/seed-payees.ts
//
// Seeds the standing_orders table ONCE from payees.yaml, mirroring seed.ts.
// After the first load the database is the source of truth and the agent
// keeps the amounts current.

import fs from "fs";
import path from "path";
import { load } from "js-yaml";
import { db } from "./db";
import { standingOrders } from "@shared/schema";

interface YamlPayee {
  name: string;
  amount_gbp?: number;
}
interface YamlPayees {
  config?: { accountant_email?: string };
  payees?: YamlPayee[];
}

export async function seedStandingOrdersIfEmpty(): Promise<void> {
  const existing = await db.select().from(standingOrders).limit(1);
  if (existing.length > 0) {
    console.log("[seed] standing_orders already populated, skipping");
    return;
  }

  const yamlPath = path.resolve(process.cwd(), "payees.yaml");
  if (!fs.existsSync(yamlPath)) {
    console.log(`[seed] payees.yaml not found at ${yamlPath}, skipping`);
    return;
  }

  let parsed: YamlPayees;
  try {
    parsed = load(fs.readFileSync(yamlPath, "utf-8")) as YamlPayees;
  } catch (err: any) {
    console.error(`[seed] failed to parse payees.yaml: ${err?.message ?? err}`);
    return;
  }

  const rows = (parsed?.payees ?? []).map((p) => ({
    payeeName: p.name,
    currentAmountPence: Math.round((p.amount_gbp ?? 0) * 100),
  }));
  if (rows.length === 0) {
    console.log("[seed] no payees in payees.yaml, skipping");
    return;
  }

  await db.insert(standingOrders).values(rows);
  console.log(`[seed] inserted ${rows.length} standing orders`);
}
