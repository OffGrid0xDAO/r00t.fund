import { ponder } from "@/generated";
import { graphql } from "@ponder/core";
import * as schema from "../../ponder.schema";

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
