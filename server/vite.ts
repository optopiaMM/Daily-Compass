import type { Express } from "express";
import type { Server } from "http";
import { createServer as createViteServer } from "vite";

export async function setupVite(httpServer: Server, app: Express) {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
