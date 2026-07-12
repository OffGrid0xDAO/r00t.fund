import { ponder } from "@/generated";
import { graphql } from "@ponder/core";
import { cors } from "hono/cors";
import * as schema from "../../ponder.schema";

/**
 * CORS lock — only allow the r00t.fund app (and its Vercel deployments) to call the
 * indexer from a browser. NOTE: CORS only constrains *browser* cross-origin JS; it does
 * NOT stop curl/servers (and the data here is public on-chain data anyway). Its purpose
 * is to stop OTHER websites from using our indexer as free infra. Override the allowlist
 * without a code change via CORS_ORIGINS (comma-separated exact origins).
 */
const ENV_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (ENV_ORIGINS.includes(origin)) return origin;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  const ok =
    host === "r00t.fund" ||
    host === "www.r00t.fund" ||
    host.endsWith(".r00t.fund") ||
    // this project's Vercel deployments (stable alias + per-commit previews)
    /^r00t-fund[a-z0-9-]*\.vercel\.app$/.test(host);
  return ok ? origin : null;
}

ponder.use(
  cors({
    origin: (origin) => isAllowedOrigin(origin) ?? "",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

/**
 * GraphQL API - auto-generated from ponder.schema.ts
 * Serves trades, commitments, pool state, stats, and merkle tree data
 */
ponder.use("/graphql", graphql({ schema }));
ponder.use("/", graphql({ schema }));

/**
 * Alchemy Webhook endpoint
 *
 * Receives push notifications from Alchemy when contract events are detected.
 * This serves two purposes:
 * 1. Wakes Railway service from sleep (any inbound HTTP request triggers wake)
 * 2. Logs the event for monitoring (Ponder's own sync handles DB persistence)
 */
ponder.get("/webhook/alchemy", (c) => {
  return c.text("ok");
});

ponder.post("/webhook/alchemy", async (c) => {
  try {
    const body = await c.req.json();
    console.log(
      `[Webhook] Alchemy notification received: type=${body.type}, events=${body.event?.activity?.length ?? 0}`
    );
    return c.json({ status: "ok" });
  } catch (err) {
    console.error("[Webhook] Error processing:", err);
    return c.json({ status: "error" }, 500);
  }
});
