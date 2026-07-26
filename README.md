<div align="center">

# 🌳 R00t.fund

### The Private Launchpad for Regenerative Projects

**Regenerating land. Verifying impact. Preserving privacy.**

*A regenerative-liquidity protocol: a Uniswap v4 hook back-runs cross-pool arbitrage between a public pool*
*and a shielded zkAMM, routing the captured spread into a land-regeneration treasury — private to trade, public to regenerate.*

<br/>

[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=for-the-badge&logo=solidity&logoColor=white)](https://soliditylang.org/)
[![Uniswap v4](https://img.shields.io/badge/Uniswap-v4_Hook-FF007A?style=for-the-badge&logo=uniswap&logoColor=white)](https://docs.uniswap.org/contracts/v4/overview)
[![Foundry](https://img.shields.io/badge/Foundry-Build-F7B93E?style=for-the-badge&logo=ethereum&logoColor=black)](https://book.getfoundry.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Circom](https://img.shields.io/badge/Circom-ZK--SNARKs-8B5CF6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDIgNy41VjE2LjVMMTIgMjJMMjIgMTYuNVY3LjVMMTIgMloiLz48L3N2Zz4=&logoColor=white)](https://docs.circom.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Viem](https://img.shields.io/badge/Viem-EVM-1C1C1C?style=for-the-badge&logo=ethereum&logoColor=white)](https://viem.sh/)
[![Tailwind](https://img.shields.io/badge/Tailwind-CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

<br/>

[![Sepolia](https://img.shields.io/badge/LIVE-Ethereum_Sepolia-6C47FF?style=flat-square&logo=ethereum&logoColor=white)](#)
[![RegenArbHook](https://img.shields.io/badge/RegenArbHook-afterSwap_arb-D6FE51?style=flat-square)](#)
[![World ID](https://img.shields.io/badge/World_ID-Proof_of_Humanity-000000?style=flat-square)](#)
[![ENS](https://img.shields.io/badge/ENS-Steward_Identity-5298FF?style=flat-square&logo=ens&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](#)
[![ZK Circuits](https://img.shields.io/badge/ZK_Circuits-shielded_AMM-8B5CF6?style=flat-square)](#)

<br/>

*Fund what Heals · Arbitrage that Regenerates · Built on Uniswap v4 · Rooted in the earth*

</div>

---

**Built at ETHGlobal Lisbon 2026** — competing across Uniswap Foundation, World, and ENS tracks

| Track | Our Submission |
|-------|---------------|
| **Uniswap Foundation** | `RegenArbHook` — a production v4 hook that back-runs cross-pool arbitrage (public v4 ⇄ shielded zkAMM) in the same transaction, routing the spread to a regen treasury; plus a Continuous Clearing Auction that seeds both pools on launch |
| **World** | On-chain proof-of-humanity gate — stewards verify a unique human with World ID (IDKit) before creating a land, so real people steward real land |
| **ENS** | Every steward gets a human-readable identity — `.eth` name + avatar resolved from L1 across the app |
| **Live on Sepolia** | Full stack deployed on Ethereum Sepolia: LandFactory, RegenLaunchpad (CCA), the shared arb hook, a real shielded ZkAMMPair, and a regen treasury accruing real ETH from captured spread |

---


## What is r00t.fund?

**r00t.fund is a launchpad for land regeneration that turns trading itself into funding for the ground.**

The most sophisticated technology in crypto — memecoin launchpads, arbitrage bots, MEV searchers — is pointed at extracting value from other traders. r00t.fund turns that machine around. Every parcel token trades on **two pools at once**: a public **Uniswap v4** pool and a private, **shielded zkAMM**. A custom v4 hook — `RegenArbHook` — watches every swap, back-runs the cross-pool arbitrage **in the same transaction**, and routes the captured spread into a **land-regeneration treasury**.

Instead of a bot pocketing the spread, the spread heals the land. **Private to trade, public to regenerate.**

This is not a mockup. The full stack is **live on Ethereum Sepolia**, and the regen treasury is already holding real ETH captured purely from arbitrage.

---

## How it works

```
                 ┌──────────────────────┐     afterSwap      ┌──────────────────────┐
   user swap ───▶│  PUBLIC POOL         │──── back-run ─────▶│  PRIVATE POOL        │
                 │  Uniswap v4          │◀─── rebalance ─────│  shielded zkAMM 🛡    │
                 │  R00T / ETH          │                    │  R00T / ETH          │
                 └──────────┬───────────┘                    └──────────┬───────────┘
                            │           ┌───────────────┐               │
                            └──────────▶│ RegenArbHook  │◀──────────────┘
                                        │  (afterSwap)  │
                                        └───────┬───────┘
                                                │ captured spread (ETH)
                                                ▼
                                    ┌───────────────────────┐
                                    │  REGEN TREASURY        │
                                    │  funds land restoration│
                                    └───────────────────────┘
```

1. **A steward creates a land.** They upload their real boundary/topography, verify a unique human with **World ID**, get an **ENS** identity, and commit `$R00T` as seed liquidity.
2. **They launch parcel tokens** through a **Continuous Clearing Auction** (like a memecoin launchpad, but each token is half a hectare of real land). On clear, the auction seeds **both** the public v4 pool and the shielded zkAMM and registers the market on the shared hook.
3. **People trade.** Every swap on the public pool moves its price; the two pools drift apart.
4. **The hook fires `afterSwap`**, opens a flash-accounting `unlock`, runs the counter-swap on the private pool, and takes the spread — atomically, no keeper, no MEV leak.
5. **The spread lands in the regen treasury** as ETH, funding the ground.

---

## The three integrations

### Uniswap Foundation — `RegenArbHook` + CCA
- **`afterSwap` hook** performs a real cross-pool arbitrage using v4 **flash accounting** (`unlock` → nested `swap` → `take`/`settle`). Native ETH (`currency0 = address(0)`) so the treasury accrues real ETH.
- **Shared hook, auto-discovery** — one deployed hook serves the base R00T/ETH pair *and* every parcel, via a `MarketRegistered` event. Nothing hardcoded per launch.
- **Continuous Clearing Auction** (`RegenLaunchpad`) — uniform-price fair launch that seeds both pools + wires the hook on clear.
- **Live quotes** from the official Sepolia **v4 Quoter** (`quoteExactInputSingle`); live price via **StateView** (`getSlot0`).
- Full dev feedback: [`hackathon/FEEDBACK.md`](hackathon/FEEDBACK.md).

### World — proof-of-humanity gate
Before a wallet can create a land, the steward proves they're a unique human with **World ID** (IDKit widget → orb/device). Real people steward real land — sybil-resistant land creation, gated in the create-land flow.

### ENS — steward identity
Every steward gets a human-readable identity: their `.eth` name + avatar are resolved from Ethereum L1 (`useEnsName`/`useEnsAvatar`) and shown across the app; the create-land wizard auto-fills the steward handle from ENS.

---

## Live on Ethereum Sepolia (chainId 11155111)

| Contract | Address |
|----------|---------|
| **RegenArbHook** (shared) | `0x2B019cC4D35CeB177fe41a4A8b4D873494C20040` |
| **RegenLaunchpad** (CCA) | `0xC6d8369d72dAC352Ef439Aa37a81355ED442CB11` |
| **LandFactory** | `0x38c1549eaF13c5c40ff5Fd81E0Ce8Cef749dC2eB` |
| **$R00T** | `0x70E3432B83a83Caa818a98010DF87AF6daa6AbC9` |
| Base R00T/ETH poolId | `0xc85eee3324217afd9113d8b66e59e1e4380976ede7ee4cd3882cc107eca74bfb` |
| Base shielded pool (ZkAMMPair) | `0xf597Edb2B8380177c42D2FAc45A2D9A4f191D549` |
| **Regen treasury** (ETH) | `0xBe196EEfCD38593a681f906F11fa4832889e96F5` |
| Uniswap v4 PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Uniswap v4 StateView | `0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c` |
| Uniswap v4 Quoter | `0x61b3f2011a92d183c7dbadbda940a7555ccf9227` |

Verify the hook's captured spread on Etherscan → the treasury balance is real ETH from `SpreadCaptured` events.

---

## The problem

Every year billions flow into carbon markets and reforestation programmes, and **60–80% is consumed by intermediaries** — brokers, certifiers, consultants, registry fees — before anything touches the earth. A landowner who plants trees on burned hillside sees a fraction of what a credit buyer paid, sometimes nothing. Meanwhile, the extractive machine of DeFi (bots, MEV, launchpad churn) captures enormous value and returns none of it to the physical world.

**r00t.fund closes the loop:** the value that trading generates is captured on-chain and routed *directly* to land regeneration — no middlemen, no self-reporting, funds flowing to the ground.

---

## Real project: Pilot Site native forest restoration

This is not a hypothetical. After the **September 2025 fires** devastated the pilot site in Portugal, our land was destroyed. We started small — **25+ kg of ground-cover seed** and a few trees planted by hand — but nothing that compares to what's possible with real funding.

**The honest situation:** we still haven't received the promised government fire-damage funds or the agricultural support to restore the farm; ICNF processes move at glacial speed. The burned land needs thousands of trees, not the handful we can afford out of pocket.

**This is why we built r00t.fund.** Every dollar we win at this hackathon goes straight to replanting the forest.

### Restoration plan: 9 hectares, 2,550 native trees

| Species | Portuguese Name | Target Trees | CO2/tree/year |
|---------|----------------|:------------:|:-------------:|
| *Quercus robur* | Carvalho-roble | 800 | 22 kg |
| *Quercus pyrenaica* | Carvalho-negral | 600 | 18 kg |
| *Castanea sativa* | Castanheiro | 400 | 25 kg |
| *Crataegus monogyna* | Espinheiro / Pilriteiro | 300 | 8 kg |
| *Prunus spinosa* | Abrunheiro | 200 | 6 kg |
| *Arbutus unedo* | Medronheiro | 150 | 12 kg |
| *Fraxinus angustifolia* | Freixo | 100 | 15 kg |
| | **Total** | **2,550** | |

**Location:** withheld — Project 001 pilot site (coordinates in private config) · **Fire date:** September 2025 · **Planting target:** Spring 2026 (pending funding) · **ICNF Ref:** PRRF-SE-2025-0042

---

## Key contracts

| Contract | Purpose | File |
|----------|---------|------|
| `RegenArbHook` | v4 `afterSwap` hook — cross-pool arb → regen treasury | [`contracts/src/hackathon/RegenArbHook.sol`](contracts/src/hackathon/RegenArbHook.sol) |
| `RegenLaunchpad` | Continuous Clearing Auction; seeds both pools on clear | [`contracts/src/hackathon/RegenLaunchpad.sol`](contracts/src/hackathon/RegenLaunchpad.sol) |
| `RegenPrivatePool` / ZkAMMPair | Shielded R00T/ETH AMM the hook arbs against | [`contracts/src/hackathon/RegenPrivatePool.sol`](contracts/src/hackathon/RegenPrivatePool.sol) |
| `ParcelLauncher` | One-call parcel token launch into the CCA | [`contracts/src/hackathon/ParcelLauncher.sol`](contracts/src/hackathon/ParcelLauncher.sol) |
| `StewardGatekeeper` | On-chain World ID proof-of-humanity gate | [`contracts/src/hackathon/StewardGatekeeper.sol`](contracts/src/hackathon/StewardGatekeeper.sol) |
| `LandFactory` / `Land` | Multi-tenant land rail; each steward spins up a Land | [`contracts/src/LandFactory.sol`](contracts/src/LandFactory.sol) |

**Deploy scripts:** [`contracts/script/hackathon/`](contracts/script/hackathon/) — `DeployCleanStack.s.sol` (full live stack), `DeployLandFactorySepolia.s.sol`, `HookMiner.sol`, `TestArbClean.s.sol` (proves arb convergence).

---

## Frontend

| Piece | File |
|-------|------|
| Steward Console (create land → launch parcels → trade) | `frontend/src/components/StewardConsole.tsx` |
| Create-land wizard (terrain upload · World ID · ENS) | `frontend/src/components/pilot/StartYourLand.tsx` |
| World ID gate | `frontend/src/components/pilot/WorldIdGate.tsx` |
| ENS steward identity | `frontend/src/components/StewardIdentity.tsx` |
| v4 Quoter live quotes | `frontend/src/hooks/useV4Quote.ts` |
| Live pool prices + arb feed | `frontend/src/hooks/useRegenLive.ts` |
| Launch a parcel via the CCA | `frontend/src/hooks/useLaunchParcel.ts` |

**Presentation assets** (standalone, real live Sepolia data): [`docs/arb-theater.html`](docs/arb-theater.html) (candlestick arb terminal), [`docs/hook-pools.html`](docs/hook-pools.html) (dual-pool rebalance visual), [`docs/ethglobal-logo.html`](docs/ethglobal-logo.html) (cinematic closing).

---

## Technology stack

| Layer | Technology |
|-------|-----------|
| Hook + contracts | Solidity 0.8.26, Foundry, Uniswap v4-core (flash accounting, `StateLibrary`, `CurrencySettler`), `via_ir` |
| Privacy | ZK-SNARK shielded AMM (Circom/Groth16, Poseidon Merkle trees) |
| Identity | World ID (IDKit / MiniKit), ENS (L1 resolution via wagmi) |
| Frontend | React 18, TypeScript, Tailwind, framer-motion, wagmi/viem |
| Indexer | Ponder |

---

## Development

```bash
# contracts
cd contracts && forge build && forge test

# deploy the full hook stack to Sepolia
source .env && forge script script/hackathon/DeployCleanStack.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow

# frontend
cd frontend && npm install && npm run dev
```

---

## License

MIT

---

<p align="center">
  <strong>r00t.fund</strong> — Arbitrage that heals the ground.
  <br/>
  Built at ETHGlobal Lisbon 2026 · Rooted in the earth.
</p>
