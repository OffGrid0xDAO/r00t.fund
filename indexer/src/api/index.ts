import { ponder } from "@/generated";
import { graphql } from "@ponder/core";
import * as schema from "../../ponder.schema";

/**
 * CORS lock — only allow the r00t.fund app (and its Vercel deployments) to call the
 * indexer from a browser. NOTE: CORS only constrains *browser* cross-origin JS; it does
 * NOT stop curl/servers (and the data here is public on-chain data anyway). Its purpose
 * is to stop OTHER websites from using our indexer as free infra. Override the allowlist
 * without a code change via CORS_ORIGINS (comma-separated exact origins).
 *
 * Implemented as a POST-handler override rather than hono's cors() because Ponder's
 * built-in graphql handler sets `access-control-allow-origin: *` itself; we must run
 * AFTER it (await next()) to force the header to the specific allowed origin, or strip
 * it entirely for disallowed origins.
 */
const ENV_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function allowedOrigin(origin: string | undefined): string | null {
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

ponder.use(async (c, next) => {
  const origin = c.req.header("origin");
  const allow = allowedOrigin(origin);

  // Preflight: answer directly so we control the headers precisely.
  if (c.req.method === "OPTIONS") {
    const h = new Headers();
    if (allow) {
      h.set("Access-Control-Allow-Origin", allow);
      h.set("Vary", "Origin");
      h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      h.set("Access-Control-Allow-Headers", "Content-Type");
      h.set("Access-Control-Max-Age", "86400");
    }
    return new Response(null, { status: 204, headers: h });
  }

  await next();

  // Force the header AFTER the graphql handler (which defaults to "*").
  if (allow) {
    c.res.headers.set("Access-Control-Allow-Origin", allow);
    c.res.headers.set("Vary", "Origin");
  } else {
    c.res.headers.delete("Access-Control-Allow-Origin");
  }
});

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
