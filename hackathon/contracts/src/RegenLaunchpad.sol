// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {IZkAMMRebalance} from "./interfaces/IZkAMMRebalance.sol";

interface IRegenArbHook {
    function register(PoolKey calldata key, IZkAMMRebalance zkAMM, address regenTreasury, bytes32 parcelId) external;
}

/// @title RegenLaunchpad  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE)
/// @notice Steward-facing orchestrator. From the frontend a steward creates a Land, adds parcels,
///         runs a CCA, and `clearAndLaunch` does EVERYTHING automatically: clear the auction at a
///         fair price P, route the raise to the regeneration treasury, seed BOTH the private zkAMM
///         and the public Uniswap v4 pool (hooked) at P, and register the pool with the shared
///         RegenArbHook. See ../INFRA.md.
/// @dev SCAFFOLD: state machine + the automatic clear/seed/wire flow are laid out; auction math,
///      pool seeding calls, and ENS record writes are TODO for build day.
contract RegenLaunchpad {
    IPoolManager public immutable poolManager;
    IRegenArbHook public immutable hook;      // the ONE shared hook
    address public immutable protocolReserve; // supplies the R00T side of pool liquidity

    enum Phase { None, Pending, Auction, Live }

    struct Parcel {
        address token;          // parcel ERC20
        address land;           // steward's Land
        address regenTreasury;  // the plot's regen fund (raise lands here)
        IZkAMMRebalance zkAMM;   // private pool
        PoolKey uniKey;         // public Uni v4 pool (hooked)
        bytes32 parcelId;
        Phase phase;
        // CCA
        uint64 auctionEnd;
        uint256 reservePriceR00T;
        uint256 clearedPriceR00T;
        uint256 raisedR00T;
    }

    mapping(bytes32 => Parcel) public parcels; // parcelId → Parcel
    mapping(bytes32 => mapping(address => uint256)) public bids; // parcelId → bidder → R00T bid

    event LandCreated(address indexed steward, address land, string ensName);
    event ParcelCreated(bytes32 indexed parcelId, address token, string ensSubname);
    event AuctionStarted(bytes32 indexed parcelId, uint64 end, uint256 reservePriceR00T);
    event Bid(bytes32 indexed parcelId, address indexed bidder, uint256 r00tAmount);
    event Launched(bytes32 indexed parcelId, uint256 clearedPriceR00T, uint256 raisedR00T);

    constructor(IPoolManager _pm, IRegenArbHook _hook, address _protocolReserve) {
        poolManager = _pm;
        hook = _hook;
        protocolReserve = _protocolReserve;
    }

    // ── steward lifecycle (frontend calls these) ──

    /// @notice Create a steward's Land (deploy/attach) + mint <land>.r00t.eth. TODO.
    function createLand(string calldata name, string calldata region, bytes32 geoHash) external returns (address land) {}

    /// @notice Create a parcel token + <parcel>.<land>.r00t.eth; phase→Pending. TODO.
    function createParcel(address land, string calldata name, string calldata ticker, uint256 supply)
        external returns (bytes32 parcelId) {}

    /// @notice Open the CCA. phase→Auction. TODO.
    function startCCA(bytes32 parcelId, uint64 window, uint256 reservePriceR00T) external {}

    /// @notice Place a CCA bid (escrow R00T). TODO.
    function bid(bytes32 parcelId, uint256 r00tAmount) external {}

    /// @notice THE automatic step — clears the auction and launches the parcel in one tx:
    ///   1. clear CCA at uniform price P; distribute tokens; refund marginal.
    ///   2. raise (R00T) → parcel.regenTreasury (funds the land).
    ///   3. seed BOTH pools at P: zkAMM.setReserves(...) + Land.seedParcelLiquidity(P, ...) [Uni v4, hooked];
    ///      R00T side pulled from protocolReserve.
    ///   4. hook.register(uniKey, zkAMM, regenTreasury, parcelId); zkAMM.rebalanceFor(hook).
    ///   5. write ENS records (clearedPrice, pools, status="live"); phase→Live.
    function clearAndLaunch(bytes32 parcelId) external {
        // TODO(build-day): implement 1–5. This is the "everything automatic" tx.
        // emit Launched(parcelId, clearedPriceR00T, raisedR00T);
    }
}
