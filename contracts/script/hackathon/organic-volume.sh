#!/usr/bin/env bash
# Organic volume loop — runs OrganicVolume.s.sol every few minutes for ~1–2h so the shared RegenArbHook
# fires on BOTH the ETH/R00T pool (shielded zkAMM) and a parcel/R00T pool. Each run does a small
# randomized batch; the random sleep between runs makes the volume look organic (not one big burst).
#
# Usage:
#   export PRIVATE_KEY=0x...            # a funded Sepolia key (needs a little ETH + can mint test R00T)
#   export SEPOLIA_RPC=https://...      # your Sepolia RPC (Alchemy/drpc/etc)
#   export PARCEL=0xYourHayToken        # the launched parcel token to trade against R00T (e.g. $HAY)
#   # optional: HOOK, ROOT, POOL_MANAGER, DO_ETH=1, DO_PARCEL=1, DURATION_MIN=90, MIN_GAP=180, MAX_GAP=420
#   bash contracts/script/hackathon/organic-volume.sh
set -u
cd "$(dirname "$0")/../.." || exit 1   # → contracts/

: "${PRIVATE_KEY:?set PRIVATE_KEY}"; : "${SEPOLIA_RPC:?set SEPOLIA_RPC}"
DURATION_MIN="${DURATION_MIN:-90}"     # total minutes to keep going (~1.5h)
MIN_GAP="${MIN_GAP:-180}"; MAX_GAP="${MAX_GAP:-420}"  # seconds between batches (3–7 min)
SCRIPT="script/hackathon/OrganicVolume.s.sol:OrganicVolume"

end=$(( $(date +%s) + DURATION_MIN * 60 ))
run=0
ROUTER="${ROUTER:-}"
while [ "$(date +%s)" -lt "$end" ]; do
  run=$((run+1))
  echo "── batch #$run  $(date '+%H:%M:%S') ──"
  out=$(SWAPS="${SWAPS:-8}" ROUTER="$ROUTER" forge script "$SCRIPT" \
        --rpc-url "$SEPOLIA_RPC" --broadcast --slow -vv 2>&1)
  echo "$out" | grep -E "swaps this run|ROUTER \(reuse|Error|revert" || true
  # capture the deployed router the first time so subsequent runs reuse it (less gas/log noise)
  if [ -z "$ROUTER" ]; then
    ROUTER=$(echo "$out" | grep -oE "ROUTER \(reuse next runs\): 0x[0-9a-fA-F]{40}" | grep -oE "0x[0-9a-fA-F]{40}")
    [ -n "$ROUTER" ] && echo "   reusing router $ROUTER for the rest of the loop"
  fi
  [ "$(date +%s)" -ge "$end" ] && break
  gap=$(( RANDOM % (MAX_GAP - MIN_GAP + 1) + MIN_GAP ))
  echo "   sleeping ${gap}s…"
  sleep "$gap"
done
echo "done — ran $run batches over ~${DURATION_MIN}m"
