import cors from "cors";
import express from "express";
import helmet from "helmet";
import { webhookCallback } from "grammy";
import { createAviationBot } from "@aviation/telegram-bot";
import { env } from "./config/env";
import { errorMiddleware, notFound } from "./middleware/error.middleware";
import { adminRouter } from "./routes/admin.routes";

export function createApp() {
  const app = express();
  const bot = createAviationBot(env.TELEGRAM_BOT_TOKEN);

  app.use(helmet());
  app.use(
    cors({
      origin: env.ADMIN_FRONTEND_URL,
      credentials: true
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "aviation-backend" });
  });

  app.use("/api/admin", express.json(), adminRouter);

  app.post(`/telegram/webhook/:secret`, express.json(), (req, res, next) => {
    if (req.params.secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (env.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
      const token = req.header("x-telegram-bot-api-secret-token");
      if (token !== env.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
        res.status(401).json({ error: "Invalid Telegram secret token" });
        return;
      }
    }

    return webhookCallback(bot, "express")(req, res);
  });

  app.use(notFound);
  app.use(errorMiddleware);

  return app;
}
