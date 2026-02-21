/**
 * start-optimized.ts
 *
 * Startup orchestrator that:
 * 1. Runs find-first-activity to discover optimal startBlock
 * 2. Sets OPTIMIZED_START_BLOCK environment variable
 * 3. Spawns Ponder with the optimized configuration
 *
 * Usage: npx tsx scripts/start-optimized.ts
 */

import { spawn } from "child_process";
import { findFirstActivityBlock } from "./find-first-activity";

async function main() {
  console.log("=".repeat(60));
  console.log("Optimized Ponder Startup");
  console.log("=".repeat(60));
  console.log("");

  // Phase 1: Find first activity block
  console.log("[Startup] Phase 1: Discovering first activity block...\n");

  // Known first event block (discovered via find-first-activity.ts)
  const KNOWN_FIRST_EVENT = 420982912;

  let optimizedStartBlock: number;
  try {
    optimizedStartBlock = await findFirstActivityBlock();
  } catch (error) {
    console.error("[Startup] Failed to find first activity block:", error);
    console.log(`[Startup] Using known first event block: ${KNOWN_FIRST_EVENT}`);
    optimizedStartBlock = KNOWN_FIRST_EVENT;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("[Startup] Phase 2: Starting Ponder...");
  console.log(`[Startup] OPTIMIZED_START_BLOCK=${optimizedStartBlock}`);
  console.log("=".repeat(60));
  console.log("");

  // Phase 2: Start Ponder with optimized startBlock
  const ponderProcess = spawn("ponder", ["start"], {
    stdio: "inherit",
    env: {
      ...process.env,
      OPTIMIZED_START_BLOCK: String(optimizedStartBlock),
    },
    shell: true,
  });

  ponderProcess.on("error", (error) => {
    console.error("[Startup] Failed to start Ponder:", error);
    process.exit(1);
  });

  ponderProcess.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Handle termination signals
  process.on("SIGINT", () => {
    ponderProcess.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    ponderProcess.kill("SIGTERM");
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
