// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

import {IZkAMMRebalance} from "./interfaces/IZkAMMRebalance.sol";

/// @title RegenArbHook  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE, not production r00t.fund)
/// @notice ONE shared Uniswap v4 hook for ALL parcel pools. Back-runs every swap with a REAL
///         two-leg arbitrage between the public Uniswap pool and r00t.fund's private zkAMM,
///         re-syncing their prices and sweeping the captured spread to that parcel's regeneration
///         treasury. Launching a new parcel just `register()`s its pool — no new hook deploy.
/// @dev Deployed ONCE at a mined CREATE2 address encoding the afterSwap + afterSwapReturnDelta flags.
///      Callbacks are poolManager-only. See ../DESIGN.md (mechanism + guards) and ../INFRA.md (system).
contract RegenArbHook is IHooks {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    struct ParcelConfig {
        IZkAMMRebalance zkAMM;   // the private pool's PUBLIC rebalance surface
        address regenTreasury;   // where the captured spread goes (the plot's regen fund)
        bytes32 parcelId;
        bool registered;
    }

    IPoolManager public immutable poolManager;
    address public immutable launchpad;                 // RegenLaunchpad — the only registrar

    mapping(PoolId => ParcelConfig) public configs;     // poolId → parcel wiring

    uint256 public constant SYNC_THRESHOLD_BPS = 30;    // arb only when pools diverge > 0.30%
    uint256 public constant MAX_REBALANCE_BPS  = 500;   // cap one arb to 5% of the smaller reserve

    event ParcelRegistered(PoolId indexed poolId, bytes32 indexed parcelId, address zkAMM, address treasury);
    event SpreadCaptured(bytes32 indexed parcelId, int256 profitWei, uint256 uniPriceE18, uint256 zkPriceE18);
    event SyncSkipped(bytes32 indexed parcelId, string reason);

    error NotPoolManager();
    error NotLaunchpad();
    error HookNotImplemented();

    modifier onlyPoolManager() { if (msg.sender != address(poolManager)) revert NotPoolManager(); _; }

    constructor(IPoolManager _pm, address _launchpad) {
        poolManager = _pm;
        launchpad = _launchpad;
    }

    /// @notice Wire a newly-launched parcel pool to its zkAMM + regen treasury. onlyLaunchpad.
    function register(PoolKey calldata key, IZkAMMRebalance zkAMM, address regenTreasury, bytes32 parcelId) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        configs[key.toId()] = ParcelConfig(zkAMM, regenTreasury, parcelId, true);
        emit ParcelRegistered(key.toId(), parcelId, address(zkAMM), regenTreasury);
    }

    // ── the only active hook: back-run each user swap with a real cross-pool arb ──
    function afterSwap(
        address, PoolKey calldata key, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        ParcelConfig memory cfg = configs[key.toId()];
        if (!cfg.registered) return (IHooks.afterSwap.selector, int128(0));

        // 1. fair prices: Uniswap post-swap slot0 vs zkAMM TWAP reserves.
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(key.toId());
        (uint256 ethR, uint256 tokR) = cfg.zkAMM.getReserves();
        // uint256 zkPriceE18  = ethR * 1e18 / tokR;                     // ETH per R00T (TODO: TWAP)
        // uint256 uniPriceE18 = _priceFromSqrt(sqrtPriceX96, key);      // TODO
        sqrtPriceX96; ethR; tokR;

        // 2. if diverged > SYNC_THRESHOLD_BPS → run the two-leg arb toward the mid, size ≤ MAX_REBALANCE_BPS:
        //    uniDearer ? { buyTokensForShorts(zkAMM) ; sell on Uni via nested poolManager.swap }
        //              : { buy on Uni ; sellTokensForShorts(zkAMM) }
        //    profit = ethOut - ethIn; require(profit >= 0) else emit SyncSkipped (no forced loss);
        //    poolManager.take(ETH, cfg.regenTreasury, uint(profit));
        //    emit SpreadCaptured(cfg.parcelId, profit, uniPriceE18, zkPriceE18);
        // TODO(build-day): leg sizing + nested-swap flash settlement + take().
        return (IHooks.afterSwap.selector, int128(0));
    }

    // ── unused hooks (address flag bits gate which are callable; these revert) ──
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) { revert HookNotImplemented(); }
    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata) external pure returns (bytes4, BeforeSwapDelta, uint24) { revert HookNotImplemented(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }

    receive() external payable {} // seed inventory + ETH legs

    // TODO(build-day): _priceFromSqrt(); getHookPermissions() if we vendor BaseHook.
}
