# r00t.fund — 4-Minute Hackathon Demo Video

**ETHGlobal Lisbon 2026 · Tracks: Uniswap Foundation · World · ENS · 1inch**

> The one-liner to open and close with:
> **"We turn every trade into land regeneration — by arbitraging a *shielded* AMM from a public Uniswap v4 hook, and routing the captured spread into a regen treasury."**

---

## 0. Pre-flight checklist (do this BEFORE you hit record)

- [ ] Wallet = deployer **`0x919257C0E9C3c20eCdf49CF4732AC7BF1ab90C19`** (holds ~4.96M R00T + ETH on Sepolia). Only this wallet can pledge R00T + self-seed the CCA.
- [ ] Network = **Sepolia**. Rabby/MetaMask unlocked, popups allowed.
- [ ] Dev server running: `cd frontend && npm run dev` → `http://localhost:5173`.
- [ ] Have the terrain file ready to drag: **`frontend/public/terrain/pilot-boundary.geojson`**.
- [ ] Open 2 browser tabs: **(1)** the app, **(2)** Sepolia Etherscan on the hook `0x2B019cC4…` → **Events** tab (to show `SpreadCaptured` live).
- [ ] Pre-clear: refresh the app so the map shows the **"Start your land"** empty state (fresh steward experience).
- [ ] Screen-record at 1080p+; close notifications; zoom browser to ~110% so text reads on video.
- [ ] Rehearse the swap once so the arb has fired at least once (chart has candles).

**Live addresses to have on a cue card (Sepolia):**
| What | Address |
|---|---|
| Shared arb hook | `0x2B019cC4D35CeB177fe41a4A8b4D873494C20040` |
| RegenLaunchpad (CCA) | `0xC6d8369d72dAC352Ef439Aa37a81355ED442CB11` |
| LandFactory | `0x38c1549eaF13c5c40ff5Fd81E0Ce8Cef749dC2eB` |
| $R00T | `0x70E3432B83a83Caa818a98010DF87AF6daa6AbC9` |
| Base R00T/ETH shielded pool (ZkAMMPair) | `0xf597Edb2B8380177c42D2FAc45A2D9A4f191D549` |
| Regen treasury (ETH) | `0xBe196EEfCD38593a681f906F11fa4832889e96F5` |

---

## 1. The 4-minute script (240s)

Format: **[time] ON SCREEN** → *voiceover*.

### ACT 1 — The idea (0:00–0:35)

**[0:00–0:12] Landing page / hero.**
> "This is **r00t.fund** — a launchpad that funds real-world land regeneration. Stewards tokenize their land into parcels; anyone can back them. The twist is in the market design."

**[0:12–0:35] A simple diagram slide (or the Steward Console hero).**
> "Every parcel trades on **two** pools at once: a **public Uniswap v4 pool** and a **shielded private AMM**. A custom **v4 hook** watches every swap, and when the two pools drift apart, it **back-runs the arbitrage in the same transaction** — and instead of a bot pocketing that spread, it flows into the land's **regeneration treasury**. Arbitrage becomes funding for the ground."

### ACT 2 — Steward creates a land, live (0:35–1:50)

**[0:35–0:45] Click "Create your land" on the Steward Console.**
> "Let's do the whole thing live. I'm a steward. I connect my wallet on Sepolia and create my land."

**[0:45–1:05] Wizard: Step 1 Land (name + region), Step 2 Topography — drag `pilot-boundary.geojson`.**
> "I name the land, then upload my real boundary file — a GeoJSON of the actual plot. The wizard hashes it on-chain and renders my terrain instantly."
*(Wait for the boundary shape to draw in the preview — that's the money shot.)*

**[1:05–1:25] Step 3 Token — commit R00T. Step 4 Parcels — name one, e.g. `$CACTUS`.**
> "I commit $R00T as the land's seed liquidity, then define my parcels — like a memecoin launchpad, but each parcel is half a hectare of real land. Names, tickers, sizes — all set by me, nothing hardcoded."

**[1:25–1:50] Step 5 Launch — sign the txns. Watch the progress log.**
> "One click launches it. On-chain this **creates my Land**, then opens a **Continuous Clearing Auction** for each parcel — which on clearing seeds *both* the public v4 pool and the private shielded pool, and registers them on the shared arb hook. All automated."
*(Show the log lines: "creating land on-chain…", "✓ land created", "opening CCA…", "✓ raise LIVE".)*

### ACT 3 — The arb turns trading into regeneration (1:50–3:05)

**[1:50–2:05] Go to the map / land page — show the steward's parcels rendered on their terrain.**
> "My land is now on the map, parceled and live — read entirely from chain, not hardcoded."

**[2:05–2:35] Open the swap panel + price chart. Do a swap (ETH → R00T or a parcel).**
> "Now the important part. I trade on the public pool…"
*(Execute the swap, sign.)*
> "…and the moment my swap lands, the hook fires **afterSwap**: it re-checks the shielded pool, and back-runs the arbitrage across both pools in the *same* transaction."

**[2:35–3:05] Switch to the Etherscan tab: regen treasury `0xBe196EEf…` — point at the ETH balance (~0.11 ETH). Then the hook → Events → `SpreadCaptured`.**
> "And here's the proof on Sepolia — this is the land's regeneration treasury, and it's holding real ETH captured purely from arbitrage: **0.11 ETH and counting**. Each capture emits a **`SpreadCaptured`** event from the hook. The chart shows the two pools converging. Every trade becomes capital for the ground."
*(The treasury BALANCE is your hero proof — it's permanent and undeniable. `SpreadCaptured` events show in full on Etherscan's Events tab even though a range-limited RPC won't list them.)*

### ACT 4 — Why it wins / integrations (3:05–3:45)

**[3:05–3:45] A slide with 4 logos, or narrate over the live app.**
> "This is built on real infrastructure:
> — **Uniswap Foundation:** a production v4 hook doing in-transaction cross-pool arbitrage, live quotes from the official v4 Quoter, plus a Continuous Clearing Auction that seeds liquidity on launch.
> — **World:** before creating a land, the steward verifies a unique human with World ID — right in the create-land modal — so real people steward real land.
> — **ENS:** every steward gets a human-readable identity (resolved from L1).
> The novel primitive is arbing a **ZK-shielded** AMM from a public hook — private trading, public regeneration."
> *(Note: 1inch is NOT integrated — do not claim it on camera.)*

### CLOSE (3:45–4:00)

**[3:45–4:00] Back to hero / logo.**
> "r00t.fund — arbitrage that heals the ground. Everything you saw is live on Sepolia today. Thank you."

---

## 2. Exact demo click-path (the happy path)

1. `http://localhost:5173` → connect wallet (Sepolia) → **Steward Console**.
2. **Create your land** → wizard:
   - **Land:** name `Project 001`, region `Southern Europe – uplands`.
   - **Topography:** drag `frontend/public/terrain/pilot-boundary.geojson` → boundary previews.
   - **Token:** commit e.g. `5000` R00T.
   - **Parcels:** `CACTUS` / `Cactus Line` / 0.5 ha (leave the defaults; keep it to **one** parcel to keep the video tight).
   - **Launch step:** your **ENS name + avatar** show in the header (resolved from L1). **Verify with World ID** (scan the QR with World App) → the orb turns to "Verified human" and unlocks the launch button. *(The button reads "Verify humanity to launch" until you do.)*
   - **Create land** → approve R00T → createLand → deploy parcel token → mint → approve launchpad → createParcel (CCA opens).
3. Land page / map → confirm the parcel renders on the terrain.
4. Swap panel → **ETH → R00T** small amount → sign. (The chart pair follows the swap.)
5. Etherscan tab (hook `0x2B01…` → Events) → refresh → point at `SpreadCaptured`.
6. (Optional) show treasury `0xBe196EEf…` balance on Etherscan increasing.

---

## 3. Backup plan (if something misbehaves live)

- **Wallet has no R00T** → you're on the wrong wallet. Use `0x919257…0C19`.
- **CCA/launch is slow** → keep talking; the arb story (Act 3) works off the **already-live base R00T/ETH market** even without launching a new parcel. You can skip parcel launch and just demo the swap → `SpreadCaptured`.
- **"No trades / no candles"** → the chart reads history from the wide-range logs RPC (drpc). Do one swap first in the pre-flight so candles exist.
- **Chain mismatch popup** → the hooks auto-switch to Sepolia; just approve the switch.
- **Don't want to risk live** → pre-record the wizard + swap once, and narrate over the recording. The `SpreadCaptured` events + treasury balance on Etherscan are permanent proof you can always show.

---

## 4. Talking-point cheat sheet (memorize 3)

1. **"Arbitrage becomes regeneration."** A v4 hook back-runs cross-pool arb in-transaction; the spread funds the land treasury in ETH — not a bot.
2. **"Private to trade, public to fund."** Each parcel trades on a real **shielded ZkAMMPair** and a public v4 pool; the hook keeps them in sync and captures the spread.
3. **"Fully self-serve, nothing hardcoded."** Any steward uploads their terrain, commits R00T, names parcels, and launches CCAs that auto-seed both pools + the shared hook — the whole thing is on-chain and automated.

---

## 5. What's real vs. what to *not* claim on camera

- ✅ Live & real on Sepolia: LandFactory, RegenLaunchpad CCA, RegenArbHook (afterSwap arb + `SpreadCaptured`), real shielded ZkAMMPair, regen treasury in ETH, the full steward wizard.
- ⚠️ Do **not** claim the LandVault private-patronage rail is on Sepolia — it exceeds the L1 contract-size limit and lives on Robinhood Chain. If asked, say: *"the shielded trading rail is live on Sepolia; the private-patronage vault runs on our Robinhood Chain deployment."*
