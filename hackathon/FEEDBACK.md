# Uniswap Developer Feedback — r00t.fund RegenArbHook

> Required by the Uniswap Foundation prizes. Submit the link via the Uniswap Developer Feedback Form:
> https://developers.uniswap.org/hackathon-feedback

## Exactly what we built with Uniswap v4 (with source links)

All Uniswap v4 code lives in two folders:
[`contracts/src/hackathon/`](https://github.com/OffGrid0xDAO/r00t.fund/tree/main/contracts/src/hackathon) (hook + CCA + pools),
[`contracts/script/hackathon/`](https://github.com/OffGrid0xDAO/r00t.fund/tree/main/contracts/script/hackathon) (deploy + hook mining + arb tests),
[`contracts/test/hackathon/`](https://github.com/OffGrid0xDAO/r00t.fund/tree/main/contracts/test/hackathon) (hook tests), and the
v4 read/quote hooks in [`frontend/src/hooks/`](https://github.com/OffGrid0xDAO/r00t.fund/tree/main/frontend/src/hooks).

**1. `RegenArbHook` — the v4 hook** ([RegenArbHook.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/RegenArbHook.sol))
An `afterSwap` hook that back-runs each swap with a real cross-pool arbitrage (public v4 pool ⇄ our
private shielded zkAMM) **inside the same transaction**, using v4 **flash accounting**
(`poolManager.unlock` → `unlockCallback` → nested `swap` → `take`/`settle`). The captured spread is
paid to a regeneration treasury in the market's numeraire (native ETH via `CurrencySettler`). One
**shared hook auto-discovers new markets** via a `MarketRegistered` event, so a single deployed hook
serves the base R00T/ETH pair **and** every parcel token. Also exposes a permissionless
`rebalance(PoolKey)` poke, a tunable `maxRebalanceBps` cap, and `IInitializerHook` for real-CCA init.

**2. `RegenLaunchpad` — Continuous Clearing Auction** ([RegenLaunchpad.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/RegenLaunchpad.sol))
Uniform-price fair launch for parcel tokens. `clearAndLaunch` seeds **both** the public v4 pool and
the private pool, then registers the market on the hook — one flow, nothing hardcoded per launch.
One-call launch wrapper: [ParcelLauncher.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/ParcelLauncher.sol).
Real-v4-CCA wiring: [RegenCCAWiring.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/RegenCCAWiring.sol).

**3. The private pool the hook arbs against** ([RegenPrivatePool.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/RegenPrivatePool.sol))
A rebalancer-gated shielded AMM; the hook is the only address allowed to move it. Adapters that let
the hook drive a real ZkAMMPair / ZkParcelPool:
[ZkAMMRebalanceAdapter.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/ZkAMMRebalanceAdapter.sol),
[ZkParcelRebalanceAdapter.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/ZkParcelRebalanceAdapter.sol).
Interfaces: [`interfaces/`](https://github.com/OffGrid0xDAO/r00t.fund/tree/main/contracts/src/hackathon/interfaces)
(`IPrivatePool`, `IZkAMMRebalance`, `IInitializerHook`).

**4. Hook address mining + live deploy**
[HookMiner.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/script/hackathon/HookMiner.sol)
(CREATE2 salt mining for the permission-flag address) ·
[DeployCleanStack.s.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/script/hackathon/DeployCleanStack.s.sol)
(the full live Sepolia stack: R00T + shared hook + base market + self-seed launchpad).

**5. Proof the arb converges**
[TestArbClean.s.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/script/hackathon/TestArbClean.s.sol)
(treasury 0 → 0.112 ETH from captured spread) + the hook test suite in
[`test/hackathon/`](https://github.com/OffGrid0xDAO/r00t.fund/tree/main/contracts/test/hackathon)
([RegenArbHook.t.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/test/hackathon/RegenArbHook.t.sol),
[RegenArbHookIntegration.t.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/test/hackathon/RegenArbHookIntegration.t.sol),
[RegenArbHookDirections.t.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/test/hackathon/RegenArbHookDirections.t.sol),
[RegenLaunchpad.t.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/test/hackathon/RegenLaunchpad.t.sol)).

**6. Uniswap v4 in the frontend**
Live swap quotes from the official Sepolia **v4 Quoter** (`quoteExactInputSingle`):
[useV4Quote.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useV4Quote.ts).
Live pool price via **StateView** (`getSlot0`) + on-chain arb feed:
[useRegenLive.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useRegenLive.ts).
v4 chart/trades/market discovery:
[useV4Chart.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useV4Chart.ts),
[useV4Trades.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useV4Trades.ts),
[useV4Markets.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useV4Markets.ts).
Launch a parcel via the CCA:
[useLaunchParcel.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useLaunchParcel.ts).

## What worked well
- **Flash accounting is a perfect fit for back-running.** Being able to `unlock` and run a second
  nested `swap` on another pool inside `afterSwap`, then `take`/`settle` net deltas atomically, is
  exactly what an in-transaction arb needs — no keeper, no separate tx, no MEV leak. This is the whole
  reason the primitive is possible.
- **Hook permission flags are elegant.** Encoding which callbacks fire into the address itself means
  the PoolManager never pays for hooks you don't use. Once mined, it "just works."
- **Native ETH as `currency0`** (address zero) worked cleanly with `CurrencySettler`, which let our
  regen treasury accrue real ETH rather than a wrapped token.
- **The Quoter returning the honest post-hook output** (the hook runs in the quote simulation but the
  state reverts) was a pleasant surprise — we didn't have to special-case our hooked pools in the UI.

## What was hard / rough edges (specific)
- **HookMiner / CREATE2 salt mining.** Deriving an address whose low bits match the permission flags
  is fiddly, and on redeploys we hit CREATE2 collisions until we threaded a `startSalt` param through
  `HookMiner.find`. A first-class "mine + deploy" helper (or a Foundry cheatcode) would remove a lot
  of boilerplate. Local dev ergonomics around this are the biggest early-stage friction.
- **Nested `poolManager.swap` inside `afterSwap` + flash accounting** has a steep learning curve. The
  reentrancy/lock semantics, who-owes-whom on the `BalanceDelta`, and getting `sync`/`settle`/`take`
  ordering right for **native ETH vs ERC20** took real trial and error. More end-to-end examples of a
  hook that itself swaps on another pool (not just reads) would have saved us a day.
- **`getSlot0` visibility.** We had to cast through `IPoolManager(address(manager)).getSlot0(...)` /
  use `StateLibrary`; it wasn't obvious from the docs which surface to read price from.
- **Contract size (EIP-170).** Our shielded-pool provisioning contract exceeded the 24,576-byte L1
  limit even at `optimizer_runs=1` + `via_ir`. Guidance/patterns for splitting hook-adjacent logic to
  stay under the L1 cap would help.
- **Log infra:** on the free Alchemy tier, `eth_getLogs` is capped to a 10-block range, which broke
  reading swap history for our charts until we pointed historical reads at a wide-range RPC. Clearer
  docs on chain coverage + the auth/key flow for routing a token that only has a custom-hook pool
  would help.
- **CCA framework** docs/reference contracts were hard to find, so we implemented our own uniform-price
  Continuous Clearing Auction. A canonical, importable CCA/launchpad reference would be valuable.

## What we'd want next
- A one-call **mine-and-deploy** helper for hooks, and a canonical "hook that swaps on another pool"
  example (flash-accounting round-trip with native ETH).
- **Multiple hooks per pool** (or a composition standard) — we wanted arb + yield on one pool and hit
  the one-hook-per-pool constraint.
- An importable **CCA / liquidity-launchpad** reference.

## Key code (quick links)
- Hook: [RegenArbHook.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/RegenArbHook.sol)
- CCA launchpad: [RegenLaunchpad.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/src/hackathon/RegenLaunchpad.sol)
- Salt mining: [HookMiner.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/script/hackathon/HookMiner.sol)
- Live-deploy: [DeployCleanStack.s.sol](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/contracts/script/hackathon/DeployCleanStack.s.sol)
- Quoter integration: [useV4Quote.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useV4Quote.ts)
- Live price / arb reads: [useRegenLive.ts](https://github.com/OffGrid0xDAO/r00t.fund/blob/main/frontend/src/hooks/useRegenLive.ts)

## Live on Ethereum Sepolia (chainId 11155111)
- Shared hook: `0x2B019cC4D35CeB177fe41a4A8b4D873494C20040`
- RegenLaunchpad (CCA): `0xC6d8369d72dAC352Ef439Aa37a81355ED442CB11`
- Base R00T/ETH poolId: `0xc85eee3324217afd9113d8b66e59e1e4380976ede7ee4cd3882cc107eca74bfb`
- Regen treasury (ETH): `0xBe196EEfCD38593a681f906F11fa4832889e96F5`
- Uniswap v4 PoolManager / StateView / Quoter (canonical Sepolia)
