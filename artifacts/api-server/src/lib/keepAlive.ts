import mongoose from "mongoose";
import { logger } from "./logger";

export function startKeepAlive(port: number): void {
  if (process.env.KEEP_ALIVE === "false") {
    return;
  }

  // Run every 10 minutes (safely inside Render's 15-minute sleep limit)
  const PING_INTERVAL_MS = 10 * 60 * 1000;

  const ping = async () => {
    // 1. Keep MongoDB Atlas active and prevent paused monitoring
    try {
      if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        logger.debug("Keep-alive: MongoDB Atlas ping successful");
      }
    } catch (mongoErr) {
      logger.warn({ mongoErr }, "Keep-alive: MongoDB Atlas ping failed");
    }

    // 2. Keep Render Web Service awake via external ingress URL
    const externalUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
    if (externalUrl) {
      try {
        const pingUrl = externalUrl.replace(/\/+$/, "") + "/api/healthz";
        const res = await fetch(pingUrl, {
          signal: AbortSignal.timeout(15000),
        });
        logger.info({ status: res.status, url: pingUrl }, "Keep-alive heartbeat sent to Render");
      } catch (httpErr) {
        logger.warn({ httpErr }, "Keep-alive HTTP heartbeat failed");
      }
    }
  };

  // Run initial warm-up ping after 30 seconds, then recurring every 10 minutes
  setTimeout(() => {
    ping().catch(() => {});
    const timer = setInterval(() => {
      ping().catch(() => {});
    }, PING_INTERVAL_MS);
    timer.unref();
  }, 30_000);
}
