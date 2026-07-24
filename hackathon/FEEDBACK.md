# Uniswap Developer Feedback — r00t.fund RegenArbHook

> Required by both Uniswap Foundation prizes. Fill in at the event, then submit the link via the
> Uniswap Developer Feedback Form: https://developers.uniswap.org/hackathon-feedback

## What we built with the Uniswap stack
- **v4 hook (`RegenArbHook`)**: back-runs each swap with a real cross-pool arb (Uniswap ↔ our private
  zkAMM), routing the captured spread to a regeneration treasury.
- **Uniswap Trading/Routing + LP API**: swap and liquidity execution on the hooked parcel pools.
- (stretch) **Liquidity Launchpad / CCA** for fair parcel-token launch.

## What worked well
- _(event)_

## What was hard / rough edges (be specific — this is what they want)
- v4 hook address-flag mining (HookMiner) + local dev ergonomics: _(event)_
- Nested `poolManager.swap` settlement inside `afterSwap` (flash accounting): _(event)_
- Uniswap API: chain coverage, auth/key flow, routing a token with a custom-hook pool: _(event)_
- CCA framework docs/contracts availability: _(event)_

## What we'd want next
- _(event)_

## Key code
- Hook: `contracts/src/hackathon/RegenArbHook.sol`
- zkAMM public surface: `contracts/src/hackathon/interfaces/IZkAMMRebalance.sol`
- Uniswap API integration: `frontend/…` (lines linked in README)
