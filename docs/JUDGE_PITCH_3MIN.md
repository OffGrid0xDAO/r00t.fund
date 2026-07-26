# r00t.fund — 3-Minute Judge Pitch

Target: ~3:00 spoken. Deliver slower than you read — pause on the bold lines. ~430 words.

---

**[The dream — 0:00]**

I have a dream. A dream of a future for this space that is *less extractive*.

Right now, the smartest technology we've built — pump-dot-fun, the trading bots, the MEV searchers — all of it is pointed at one thing: extracting value from each other. Billions of dollars of the most sophisticated algorithms on earth, optimized to front-run, to snipe, to drain.

**Now imagine we turned that same machine around.** Imagine the revenue of every memecoin launch, every arbitrage bot, every MEV opportunity… was routed *into the ground* — into regenerating the land.

That's r00t.fund.

**[The insight — 0:40]**

Here's the core idea. Every token on r00t.fund trades on *two* pools at once: a **public Uniswap v4 pool**, and a **private, shielded zkAMM**.

When a trade moves one pool, the two drift apart — and that gap is an arbitrage. Normally a bot would race in and pocket that spread. Instead, we wrote a **Uniswap v4 hook** — `RegenArbHook` — that back-runs that arbitrage itself, in the *same transaction*, and sends the captured spread straight to a land-regeneration treasury.

**We don't fight the extractive algorithm. We redirect it.** Arbitrage becomes regeneration.

**[The proof — 1:25]**

And this is real. It's **live on Ethereum Sepolia right now.** A steward uploads their land, commits liquidity, and launches parcel tokens — like a memecoin launchpad, except each token is half a hectare of real earth. Those tokens trade on the public pool and the shielded pool, and our hook keeps them in sync.

The regen treasury on Sepolia is *already holding real ETH* — captured purely from arbitrage. Not a projection. On-chain, today.

**[The stack — 2:00]**

We built it deep across three ecosystems:

- **Uniswap** — a production v4 hook doing in-transaction cross-pool arbitrage, plus a Continuous Clearing Auction that seeds both pools at launch.
- **World** — before you create a land, you prove you're a unique human with World ID. Real people steward real land.
- **ENS** — every steward gets a human-readable identity across the app.

And the privacy is genuine — the shielded pool uses real zero-knowledge proofs. Private to trade, public to regenerate.

**[Close — 2:35]**

This started with our own land — burned in the September 2025 fires in Portugal, still waiting on bureaucratic funds that never came. So we stopped waiting, and we built the rail that funds regeneration directly.

r00t.fund. **Arbitrage that heals the ground.**

Thank you.

---

## Delivery notes
- **Memorize the three landmarks:** "turn the machine around" · "arbitrage becomes regeneration" · "live on Sepolia, real ETH."
- Land the pause after *"we redirect it."* — that's your applause beat.
- If you're over time, cut the World/ENS bullets to one line: "gated by World ID proof-of-humanity, with ENS identity."
- If you're under time, add: "the spread that would've fed a bot now plants oak trees."
