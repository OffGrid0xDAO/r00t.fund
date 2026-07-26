import { ponder } from "@/generated";
import { graphql } from "@ponder/core";
import { Pool } from "pg";
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

/**
 * Off-chain LAND GEOMETRY store — Ponder indexes on-chain data, but a land's terrain drawing
 * (boundary / zones / contours / river) is NOT on-chain (createLand stores only hashes). We persist
 * it here in the SAME Railway Postgres and serve it so ANY device renders a steward's land map, and
 * so `available to invest` lands are browsable cross-device. Keyed by the lowercased steward wallet
 * (and the on-chain land address, if known) — both point at the same geometry row.
 */
const geoPool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }) : null;
let geoReady: Promise<void> | null = null;
function ensureGeo() {
  if (!geoPool) return Promise.resolve();
  if (!geoReady) {
    geoReady = geoPool
      .query(`CREATE TABLE IF NOT EXISTS land_geometry (
        key text PRIMARY KEY,
        steward text,
        land text,
        name text,
        region text,
        parcels int,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
      .then(() => {});
  }
  return geoReady;
}

ponder.post("/land-geometry", async (c) => {
  if (!geoPool) return c.json({ error: "no database" }, 503);
  try {
    await ensureGeo();
    const body = await c.req.json();
    const data = body.land ?? body.data;
    if (!data || !Array.isArray(data.boundary) || data.boundary.length < 3) {
      return c.json({ error: "land.boundary (>=3 points) required" }, 400);
    }
    const steward = body.steward ? String(body.steward).toLowerCase() : null;
    const land = body.landAddress ? String(body.landAddress).toLowerCase() : null;
    const name = data.name ?? null;
    const region = data.region ?? null;
    const parcels = Array.isArray(data.zones) ? data.zones.length : null;
    // upsert under every provided key (steward + land address) so either can fetch it
    const keys = [...new Set([steward, land, String(body.key || "").toLowerCase()].filter(Boolean))] as string[];
    if (!keys.length) return c.json({ error: "key/steward/landAddress required" }, 400);
    for (const key of keys) {
      await geoPool.query(
        `INSERT INTO land_geometry (key, steward, land, name, region, parcels, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (key) DO UPDATE SET steward=$2, land=$3, name=$4, region=$5, parcels=$6, data=$7, updated_at=now()`,
        [key, steward, land, name, region, parcels, data]
      );
    }
    return c.json({ ok: true, keys });
  } catch (err) {
    console.error("[land-geometry] save failed", err);
    return c.json({ error: "save failed" }, 500);
  }
});

ponder.get("/land-geometry/:key", async (c) => {
  if (!geoPool) return c.json({ error: "no database" }, 503);
  try {
    await ensureGeo();
    const key = c.req.param("key").toLowerCase();
    const r = await geoPool.query("SELECT data FROM land_geometry WHERE key=$1 LIMIT 1", [key]);
    if (!r.rows.length) return c.json({ error: "not found" }, 404);
    return c.json({ key, land: r.rows[0].data });
  } catch (err) {
    console.error("[land-geometry] get failed", err);
    return c.json({ error: "get failed" }, 500);
  }
});

// gallery: all lands with a stored map (for "available to invest" across devices)
ponder.get("/lands", async (c) => {
  if (!geoPool) return c.json({ lands: [] });
  try {
    await ensureGeo();
    const r = await geoPool.query(
      `SELECT DISTINCT ON (COALESCE(land, key)) key, land, steward, name, region, parcels, updated_at
       FROM land_geometry ORDER BY COALESCE(land, key), updated_at DESC LIMIT 200`
    );
    return c.json({ lands: r.rows });
  } catch (err) {
    console.error("[land-geometry] list failed", err);
    return c.json({ lands: [] });
  }
});
