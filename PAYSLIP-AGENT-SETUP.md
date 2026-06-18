# Payslip Agent — setup

This adds a monthly payslip agent to Daily-Compass, reusing the existing
Anthropic + Microsoft Graph + Drizzle plumbing. New files:

- `payees.yaml` — standing-order baseline (root, next to `goals.yaml`)
- `server/graph-mail.ts` — reads the accountant's email + attachments
- `server/payslip.ts` — the agent (extract → validate → create 2 appointments)
- `server/seed-payees.ts` — seeds `standing_orders` from `payees.yaml`

Below are the small edits to existing files.

---

## 1. Dependency (zip handling)

```bash
npm i adm-zip
npm i -D @types/adm-zip
```

## 2. Schema — add to `shared/schema.ts`

```ts
export const standingOrders = pgTable("standing_orders", {
  id: serial("id").primaryKey(),
  payeeName: text("payee_name").notNull().unique(),
  currentAmountPence: integer("current_amount_pence").notNull().default(0),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const payslipRuns = pgTable("payslip_runs", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  sourceMessageId: text("source_message_id"),
  status: text("status").notNull().default("ok"), // ok | needs_review | error
  hmrcAmountPence: integer("hmrc_amount_pence"),
  hmrcDueDate: date("hmrc_due_date"),
  hmrcReference: text("hmrc_reference"),
  hmrcAccount: text("hmrc_account"),
  changesEventId: text("changes_event_id"),
  hmrcEventId: text("hmrc_event_id"),
  notes: text("notes"),
  modelUsage: jsonb("model_usage").$type<{ input_tokens: number; output_tokens: number }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payslipActions = pgTable("payslip_actions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  payeeName: text("payee_name").notNull(),
  requiredAmountPence: integer("required_amount_pence").notNull(),
  previousAmountPence: integer("previous_amount_pence"),
  actionType: text("action_type").notNull(), // no_action | change | verify
  note: text("note"),
});

export type StandingOrder = typeof standingOrders.$inferSelect;
export type PayslipRun = typeof payslipRuns.$inferSelect;
export type PayslipAction = typeof payslipActions.$inferSelect;
```

Then push the schema:

```bash
npm run db:push
```

## 3. Add the Mail.Read scope — `server/outlook.ts`

The app currently only requests calendar scopes. To read the accountant's
email, add `Mail.Read` to the read-write scope:

```ts
const SCOPES_READ_WRITE = "Calendars.ReadWrite Mail.Read User.Read offline_access openid";
```

Then **re-consent once** by visiting `/api/outlook/connect` again, so the new
scope is granted.

## 4. Route — add to `server/routes.ts`

```ts
import { runPayslipAgent } from "./payslip";

app.post("/api/agent/payslip-run", async (_req, res) => {
  try {
    const result = await runPayslipAgent();
    res.json(result);
  } catch (error: any) {
    console.error("[payslip] run error:", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Payslip run failed" });
  }
});
```

## 5. Seed on startup — `server/index.ts`

Next to the existing `seedFromYamlIfEmpty()` call:

```ts
import { seedStandingOrdersIfEmpty } from "./seed-payees";
// ...
await seedStandingOrdersIfEmpty();
```

## 6. Environment

```
ACCOUNTANT_EMAIL=accounts@your-accountant.co.uk
```

(You can also leave it in `payees.yaml` under `config:`, but the env var is
simplest on Railway. `ANTHROPIC_API_KEY` is already used by the existing agent.)

## 7. Monthly trigger (Railway cron)

The agent is **idempotent** — it records the message id it last processed and
no-ops until a new email from the accountant appears. So it's safe to run it
often. Simplest is a daily cron that hits the endpoint; it only does real work
on the day the email lands:

```
0 7 * * *   curl -fsS -X POST https://<your-app>.up.railway.app/api/agent/payslip-run
```

(Run daily at 07:00; the "changes" appointment is then booked for the next
weekday at 08:00.)

---

## Notes / decisions baked in

- **Two appointments**, both 15 min at 08:00:
  - *Payslip actions* — next weekday after the email arrives.
  - *Pay HMRC* — 2 working days before the HMRC due date.
- **Baseline self-maintains**: a "change £A → £B" line fires when net pay
  differs from the stored amount, and the stored amount is then updated to the
  new figure. Set the starting amounts in `payees.yaml`.
- **HMRC reference is copied verbatim** from the email body (never
  reconstructed), since the period suffix changes monthly.
- **Safety net**: if extraction fails validation, no appointments with figures
  are created — instead a single "Payslip agent needs attention" nudge is
  booked and the run is logged as `needs_review`.
- **Working days = weekdays only.** Bank holidays aren't handled. If you want
  them, fetch `https://www.gov.uk/bank-holidays.json` (england-and-wales) and
  skip those dates in `nextWeekday` / `workingDaysBefore`.

## The one open decision — which mailbox?

`server/graph-mail.ts` assumes the accountant emails the **Outlook** account
this app already connects (so reading mail and writing the calendar use the
same account — clean). If the accountant actually emails **Gmail**, either:

- forward those emails into the connected Outlook account (simplest), or
- replace `graph-mail.ts` with a Gmail-API version exposing the same two
  functions (`getLatestMessageFromSender`, `getMessageAttachments`).

Everything else stays identical.
