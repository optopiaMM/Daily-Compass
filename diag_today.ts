import "dotenv/config";
import { pool } from "./server/db";
const TODAY = "2026-06-10";
(async () => {
  const items = await pool.query("SELECT id, type, rank, text, completed, linked_weekly_goal_id FROM daily_items WHERE date=$1 ORDER BY type, rank", [TODAY]);
  console.log("=== Daily items for " + TODAY + " ===");
  console.log(JSON.stringify(items.rows, null, 2));
  const accts = await pool.query("SELECT account_key, account_email, role FROM oauth_tokens WHERE provider='microsoft' ORDER BY created_at");
  console.log("\n=== Connected Outlook accounts ===");
  console.log(JSON.stringify(accts.rows, null, 2));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
