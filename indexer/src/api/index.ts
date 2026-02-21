import { ponder } from "@/generated";

/**
 * Alchemy Webhook endpoint
 *
 * Receives push notifications from Alchemy when contract events are detected.
 * This serves two purposes:
 * 1. Wakes Railway service from sleep (any inbound HTTP request triggers wake)
 * 2. Logs the event for monitoring (Ponder's own sync handles DB persistence)
 *
 * Setup in Alchemy Dashboard:
 *   1. Go to https://dashboard.alchemy.com/webhooks
 *   2. Create a "Custom Webhook" or "Address Activity" webhook
 *   3. Set the URL to: https://ponder-indexer-production-50c3.up.railway.app/webhook/alchemy
 *   4. Filter for your contract addresses and event signatures
 */
ponder.get("/webhook/alchemy", (c) => {
  // GET handler for webhook verification (Alchemy sends a GET to verify the endpoint)
  return c.text("ok");
});

ponder.post("/webhook/alchemy", async (c) => {
  try {
    const body = await c.req.json();

    console.log(
      `[Webhook] Alchemy notification received: type=${body.type}, events=${body.event?.activity?.length ?? 0}`
    );

    // Alchemy webhook payload structure:
    // { type: "ADDRESS_ACTIVITY", event: { network: "...", activity: [...] } }
    // We don't need to process the events here — Ponder's sync loop will handle them.
    // The webhook's job is to wake Railway from sleep so Ponder catches up immediately.

    return c.json({ status: "ok" });
  } catch (err) {
    console.error("[Webhook] Error processing:", err);
    return c.json({ status: "error" }, 500);
  }
});

// Health check endpoint
ponder.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: Date.now() });
});
