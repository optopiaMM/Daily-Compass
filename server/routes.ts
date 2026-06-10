import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { getLocalQuoteForDate } from "./quotes";
import { syncWeeklyGoalTemplatesFromCsv } from "./templates";
import {
  buildAuthorizeUrl,
  deriveAccountKey,
  exchangeCodeForTokens,
  getMsUserProfile,
  isMsConfigured,
  refreshAccessToken,
  validateAndParseState,
} from "./outlook";
import { scheduleDayWithClaude } from "./agent";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  app.get("/api/annual-target", async (_req, res) => {
    try {
      const target = await storage.getAnnualTarget();
      res.json(target ?? null);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/annual-target", async (req, res) => {
    try {
      const created = await storage.createAnnualTarget(req.body);
      res.json(created);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/annual-target/:id", async (req, res) => {
    try {
      const updated = await storage.updateAnnualTarget(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/ninety-day-goal", async (_req, res) => {
    try {
      const goal = await storage.getCurrentNinetyDayGoal();
      res.json(goal ?? null);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/ninety-day-goals", async (_req, res) => {
    try {
      res.json(await storage.getAllNinetyDayGoals());
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/ninety-day-goal", async (req, res) => {
    try {
      const created = await storage.createNinetyDayGoal(req.body);
      res.json(created);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/ninety-day-goal/:id", async (req, res) => {
    try {
      const updated = await storage.updateNinetyDayGoal(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/agent/schedule-day", async (req, res) => {
    try {
      const date = req.body?.date as string | undefined;
      if (!date) return res.status(400).json({ message: "Missing 'date' in body." });
      const result = await scheduleDayWithClaude(date);
      res.json(result);
    } catch (error: any) {
      console.error("[agent] schedule-day error:", error?.message ?? error);
      res.status(500).json({ message: error?.message ?? "Scheduling failed." });
    }
  });

  app.get("/api/weekly-goal-templates/:weekStartDate", async (req, res) => {
    try {
      res.json(await storage.getWeeklyGoalTemplates(req.params.weekStartDate));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/weekly-goal-templates/reimport", async (_req, res) => {
    try {
      await syncWeeklyGoalTemplatesFromCsv();
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // Outlook OAuth ----------------------------------------------------------
  // Pass ?role=read_only to add a calendar that's just consulted for busy/free.
  // Without the flag, defaults to read_write if no read_write account exists
  // yet, otherwise read_only.
  app.get("/api/outlook/connect", async (req, res) => {
    try {
      if (!isMsConfigured()) {
        return res.status(503).send("Outlook integration not configured. Server is missing Microsoft credentials.");
      }
      const requestedRole = (req.query.role as string | undefined) === "read_only" ? "read_only" : "read_write";
      let role: "read_write" | "read_only" = requestedRole;
      if (requestedRole === "read_write") {
        const existingWrite = await storage.getReadWriteOauthToken("microsoft");
        if (existingWrite) role = "read_only";
      }
      res.redirect(buildAuthorizeUrl({ role }));
    } catch (error: any) {
      res.status(500).send(`Failed to start Outlook connect: ${error.message}`);
    }
  });

  app.get("/api/outlook/callback", async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query as Record<string, string>;
      if (error) {
        return res.status(400).send(`Microsoft returned error: ${error}: ${error_description ?? ""}`);
      }
      if (!code || !state) {
        return res.status(400).send("Missing code or state parameter");
      }
      const payload = validateAndParseState(state);
      if (!payload) {
        return res.status(400).send("State token is invalid or expired. Try connecting again.");
      }
      const tokenResponse = await exchangeCodeForTokens(code, payload.role);
      const profile = await getMsUserProfile(tokenResponse.access_token);
      const email = profile.mail ?? profile.userPrincipalName ?? "account@unknown";
      const accountKey = deriveAccountKey(email);
      const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
      await storage.saveOauthToken({
        provider: "microsoft",
        accountKey,
        role: payload.role,
        accountEmail: email,
        accountName: profile.displayName ?? null,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt,
        scope: tokenResponse.scope ?? null,
      });
      res.redirect(`/?outlook=connected&account=${encodeURIComponent(accountKey)}`);
    } catch (error: any) {
      res.status(500).send(`Outlook callback failed: ${error.message}`);
    }
  });

  app.get("/api/outlook/status", async (_req, res) => {
    try {
      const tokens = await storage.getOauthTokens("microsoft");
      res.json({
        configured: isMsConfigured(),
        connected: tokens.length > 0,
        accounts: tokens.map((t) => ({
          accountKey: t.accountKey,
          accountEmail: t.accountEmail,
          accountName: t.accountName,
          role: t.role,
          expiresAt: t.expiresAt,
        })),
      });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/outlook/disconnect", async (req, res) => {
    try {
      const accountKey = req.body?.accountKey as string | undefined;
      if (!accountKey) return res.status(400).json({ message: "Missing accountKey" });
      await storage.deleteOauthToken("microsoft", accountKey);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/outlook/role", async (req, res) => {
    try {
      const accountKey = req.body?.accountKey as string | undefined;
      const role = req.body?.role as string | undefined;
      if (!accountKey || (role !== "read_write" && role !== "read_only")) {
        return res.status(400).json({ message: "Missing or invalid accountKey/role" });
      }
      if (role === "read_write") {
        // Demote any existing read_write to read_only first — only one writer at a time.
        const existing = await storage.getReadWriteOauthToken("microsoft");
        if (existing && existing.accountKey !== accountKey) {
          await storage.setOauthRole("microsoft", existing.accountKey, "read_only");
        }
      }
      await storage.setOauthRole("microsoft", accountKey, role);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/morning-session/:date", async (req, res) => {
    try {
      const session = await storage.getMorningSession(req.params.date);
      res.json({ completed: session?.completed ?? false });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/morning-session/complete", async (req, res) => {
    try {
      await storage.completeMorningSession(req.body.date);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/quote/:date", async (req, res) => {
    try {
      const { date } = req.params;
      let quote = await storage.getDailyQuote(date);
      if (!quote) {
        try {
          const response = await fetch("https://zenquotes.io/api/today");
          if (response.ok) {
            const data = await response.json();
            if (data && data[0]) quote = await storage.saveDailyQuote({ date, quoteText: data[0].q, author: data[0].a });
          }
        } catch {}
        if (!quote) {
          const local = getLocalQuoteForDate(date);
          quote = await storage.saveDailyQuote({ date, quoteText: local.text, author: local.author });
        }
      }
      res.json(quote);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/gratitude", async (req, res) => {
    try {
      const { date, general1, general2, general3, lizzie, george, ben } = req.body;
      const entry = await storage.createGratitudeEntry({ date, general1, general2, general3, lizzie, george, ben });
      res.json(entry);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/living-powerfully", async (req, res) => {
    try {
      const { entries, weekStartDate } = req.body;
      await storage.createLivingPowerfullyScores(entries);
      for (const entry of entries) {
        if (entry.score <= 5 && entry.actionNote && entry.targetCategory && weekStartDate) {
          const count = await storage.getWeeklyGoalCountByCategory(weekStartDate, entry.targetCategory);
          if (count < 10) await storage.addWeeklyGoal(weekStartDate, entry.targetCategory, entry.actionNote);
        }
      }
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/weekly-goals/:weekStartDate", async (req, res) => {
    try {
      res.json(await storage.getWeeklyGoals(req.params.weekStartDate));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/weekly-goals", async (req, res) => {
    try {
      const { weekStartDate, goals } = req.body;
      await storage.createWeeklyGoals(weekStartDate, goals);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/weekly-goals/add", async (req, res) => {
    try {
      const { weekStartDate, category, goalText } = req.body;
      const count = await storage.getWeeklyGoalCountByCategory(weekStartDate, category);
      if (count >= 10) return res.status(400).json({ message: "That category is full. Please choose a different category or remove an existing goal." });
      res.json(await storage.addWeeklyGoal(weekStartDate, category, goalText));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/weekly-goals-count/:weekStartDate/:category", async (req, res) => {
    try {
      const count = await storage.getWeeklyGoalCountByCategory(req.params.weekStartDate, req.params.category);
      res.json({ count });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/previous-day-items/:date", async (req, res) => {
    try {
      const result = await storage.getItemsForReview(req.params.date);
      res.json(result ?? { items: [], fromDate: "" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/previous-day-review", async (req, res) => {
    try {
      const { date, decisions } = req.body;
      for (const d of decisions) {
        if (d.action === "carry") await storage.carryItemsForward(date, [d.itemId]);
        else if ((d.action === "delay_day" || d.action === "delay_next_week") && d.scheduledDate)
          await storage.scheduleItemForDate(d.itemId, d.scheduledDate);
      }
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/carried-items/:date", async (req, res) => {
    try {
      res.json(await storage.getCarriedItems(req.params.date));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/daily-plan", async (req, res) => {
    try {
      const { date, items } = req.body;
      await storage.createDailyItems(date, items.map((item: any) => ({
        date, type: item.type, text: item.text, rank: item.rank ?? null,
        completed: false, linkedWeeklyGoalId: item.linkedWeeklyGoalId ?? null, scheduledReviewDate: null,
      })));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/daily-items/:date", async (req, res) => {
    try {
      res.json(await storage.getDailyItems(req.params.date));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/daily-items", async (req, res) => {
    try {
      res.json(await storage.addDailyItem(req.body));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/daily-items/:id/toggle", async (req, res) => {
    try {
      const item = await storage.toggleDailyItem(parseInt(req.params.id));
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  return httpServer;
}
