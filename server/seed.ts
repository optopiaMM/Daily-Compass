import fs from "fs";
import path from "path";
import { load } from "js-yaml";
import { db } from "./db";
import { annualTargets, ninetyDayGoals } from "@shared/schema";

interface YamlAnnualTarget {
  id?: string;
  title: string;
  measure: string;
  horizon: string;
  status?: string;
}

interface YamlFailureTrigger {
  if: string;
  then: string;
}

interface YamlNinetyDayGoal {
  id?: string;
  period: string;
  parent?: string;
  status?: string;
  goal: string;
  why?: string;
  success_indicators?: string[];
  failure_indicators?: string[];
  failure_triggers?: YamlFailureTrigger[];
  protected_rule?: string;
}

interface YamlGoals {
  annual_target?: YamlAnnualTarget;
  ninety_day_goal?: YamlNinetyDayGoal;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parsePeriodToDates(period: string): { start: string; end: string } {
  // Accept "June – August 2026" / "June - August 2026" / "Jun–Aug 2026"
  const cleaned = period.replace(/–|—/g, "-").trim();
  const m = cleaned.toLowerCase().match(/^([a-z]+)\s*-\s*([a-z]+)\s+(\d{4})$/);
  if (!m) throw new Error(`Cannot parse period: "${period}"`);
  const [, startName, endName, year] = m;
  const sm = MONTHS[startName] ?? MONTHS[Object.keys(MONTHS).find((k) => k.startsWith(startName)) ?? ""];
  const em = MONTHS[endName] ?? MONTHS[Object.keys(MONTHS).find((k) => k.startsWith(endName)) ?? ""];
  if (!sm || !em) throw new Error(`Unknown month in period: "${period}"`);
  const start = `${year}-${String(sm).padStart(2, "0")}-01`;
  const lastDay = new Date(Number(year), em, 0).getDate();
  const end = `${year}-${String(em).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export async function seedFromYamlIfEmpty(): Promise<void> {
  const existing = await db.select().from(annualTargets).limit(1);
  if (existing.length > 0) {
    console.log("[seed] annual_targets already populated, skipping");
    return;
  }

  const yamlPath = path.resolve(process.cwd(), "goals.yaml");
  if (!fs.existsSync(yamlPath)) {
    console.log(`[seed] goals.yaml not found at ${yamlPath}, skipping`);
    return;
  }

  console.log(`[seed] reading ${yamlPath}`);
  let parsed: YamlGoals;
  try {
    parsed = load(fs.readFileSync(yamlPath, "utf-8")) as YamlGoals;
  } catch (err: any) {
    console.error(`[seed] failed to parse goals.yaml: ${err?.message ?? err}`);
    return;
  }

  if (!parsed?.annual_target || !parsed?.ninety_day_goal) {
    console.log("[seed] goals.yaml missing annual_target or ninety_day_goal, skipping");
    return;
  }

  const at = parsed.annual_target;
  const [insertedAt] = await db.insert(annualTargets).values({
    title: at.title,
    measure: at.measure,
    horizon: at.horizon,
    status: at.status || "green",
    active: true,
  }).returning();
  console.log(`[seed] annual_target inserted (id=${insertedAt.id}, "${insertedAt.title}")`);

  const ndg = parsed.ninety_day_goal;
  let dates: { start: string; end: string };
  try {
    dates = parsePeriodToDates(ndg.period);
  } catch (err: any) {
    console.error(`[seed] cannot derive dates from period "${ndg.period}": ${err?.message ?? err}. Inserting annual_target only.`);
    return;
  }

  const [insertedNdg] = await db.insert(ninetyDayGoals).values({
    annualTargetId: insertedAt.id,
    periodLabel: ndg.period,
    startDate: dates.start,
    endDate: dates.end,
    goalText: ndg.goal,
    whyText: ndg.why ?? null,
    successIndicators: ndg.success_indicators ?? [],
    failureIndicators: ndg.failure_indicators ?? [],
    failureTriggers: ndg.failure_triggers ?? [],
    protectedRule: ndg.protected_rule ?? null,
    ragStatus: ndg.status || "green",
    active: true,
  }).returning();
  console.log(`[seed] ninety_day_goal inserted (id=${insertedNdg.id}, period="${ndg.period}", dates=${dates.start}..${dates.end})`);
}
