import "dotenv/config";
import { pool } from "./server/db";
(async () => {
  for (const d of ["2026-06-09", "2026-06-10", "2026-06-11"]) {
    const r = await pool.query("SELECT id, type, rank, text, completed FROM daily_items WHERE date=$1 ORDER BY type, rank", [d]);
    console.log(`=== daily_items for ${d} (${r.rowCount} rows) ===`);
    console.log(JSON.stringify(r.rows, null, 2));
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
