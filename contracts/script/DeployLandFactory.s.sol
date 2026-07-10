// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RootToken.sol";
import "../src/LandFactory.sol";

/// @title DeployLandFactory — the multi-tenant land rail on Robinhood Chain.
/// @notice Deploys (or reuses) $R00T and the LandFactory, wired to the live
///         Uniswap v4 PoolManager. Stewards call factory.createLand(...) to spin
///         up their own Land (treasury + parcel tokens), pledging $R00T that seeds
///         the parcels' real v4 liquidity.
///
/// Env:
///   PRIVATE_KEY       deployer key
///   USDC_ADDRESS      USDC (6-decimals) on the target chain (required)
///   POOL_MANAGER      Uniswap v4 PoolManager (default: Robinhood Chain 4663)
///   PROTOCOL_TREASURY protocol's 30% of parcel pool fees (default: deployer)
///   VALIDATOR         confirms off-chain KMZ/topography checks (default: deployer)
///   MIN_R00T_PLEDGE   minimum $R00T (18 dec) to open a land (default 1000e18)
///   POOL_FEE          v4 fee tier (default 3000 = 0.30%)
///   TICK_SPACING      v4 tick spacing (default 60)
///   ROOT_PRICE_E6     seed USD/$R00T, 6dp (default 100000 = $0.10)
///   ROOT_TOKEN        optional — reuse an existing $R00T deployment
///
/// Run:
///   source .env && forge script script/DeployLandFactory.s.sol \
///     --rpc-url $ROBINHOOD_CHAIN_RPC --broadcast --slow
contract DeployLandFactory is Script {
    // Uniswap v4 on Robinhood Chain (chainId 4663) — verify on the RH explorer.
    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envAddress("USDC_ADDRESS");
        address poolManager = vm.envOr("POOL_MANAGER", RH_POOL_MANAGER);
        address protocolTreasury = vm.envOr("PROTOCOL_TREASURY", deployer);
        address validator = vm.envOr("VALIDATOR", deployer);
        uint256 minPledge = vm.envOr("MIN_R00T_PLEDGE", uint256(1000e18));
        uint24 poolFee = uint24(vm.envOr("POOL_FEE", uint256(3000)));
        int24 tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));
        uint256 rootPriceE6 = vm.envOr("ROOT_PRICE_E6", uint256(100000));
        address existingRoot = vm.envOr("ROOT_TOKEN", address(0));

        require(usdc != address(0), "USDC_ADDRESS unset");
        require(poolManager != address(0), "POOL_MANAGER unset");

        vm.startBroadcast(pk);

        address rootAddr = existingRoot;
        if (rootAddr == address(0)) {
            RootToken token = new RootToken(); // mints 69M ROOT to deployer
            rootAddr = address(token);
        }

        LandFactory factory = new LandFactory(
            rootAddr, usdc, validator, poolManager, protocolTreasury,
            minPledge, poolFee, tickSpacing, rootPriceE6
        );

        vm.stopBroadcast();

        console.log("=========================================");
        console.log("LandFactory deployment complete (Robinhood Chain)");
        console.log("  $R00T token       :", rootAddr);
        console.log("  LandFactory       :", address(factory));
        console.log("  Uniswap v4 PM     :", poolManager);
        console.log("  USDC              :", usdc);
        console.log("  Validator         :", validator);
        console.log("  Protocol treasury :", protocolTreasury);
        console.log("  Min R00T pledge   :", minPledge);
        console.log("=========================================");
        console.log("Next: set CONTRACTS.landFactory (VITE_LAND_FACTORY) in the frontend config.");
    }
}
