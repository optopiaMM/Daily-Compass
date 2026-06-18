import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { pingDb } from "./db";
import { seedFromYamlIfEmpty } from "./seed";
import { seedStandingOrdersIfEmpty } from "./seed-payees";
import { syncWeeklyGoalTemplatesFromCsv } from "./templates";

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.message ?? err);
  if (err?.stack) console.error(err.stack);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

console.log(`[boot] NODE_ENV=${process.env.NODE_ENV}`);
console.log(`[boot] DATABASE_URL set: ${!!process.env.DATABASE_URL}`);

const app = express();
const httpServer = createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api")) {
      console.log(`${new Date().toLocaleTimeString()} [express] ${req.method} ${req.path} ${res.statusCode} in ${Date.now() - start}ms`);
    }
  });
  next();
});

(async () => {
  console.log("[boot] pinging database...");
  try {
    await pingDb();
    console.log("[boot] database OK");
  } catch (err: any) {
    console.error("[boot] DATABASE PING FAILED:", err?.message ?? err);
    if (err?.code) console.error("[boot] error code:", err.code);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  }

  try {
    await seedFromYamlIfEmpty();
    await seedStandingOrdersIfEmpty();
  } catch (err: any) {
    console.error("[boot] seed failed (non-fatal):", err?.message ?? err);
  }

  try {
    await syncWeeklyGoalTemplatesFromCsv();
  } catch (err: any) {
    console.error("[boot] templates sync failed (non-fatal):", err?.message ?? err);
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    if (res.headersSent) return next(err);
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  if (process.env.NODE_ENV === "production") {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    console.log(`${new Date().toLocaleTimeString()} [express] serving on port ${port}`);
  });
})();
