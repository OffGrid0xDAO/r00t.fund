// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RootToken.sol";
import "../src/ParcelLaunchpad.sol";

/// @title DeployParcelLaunchpad — Phase 1: $R00T token + the parcel funding rail.
/// @notice Deploys (or reuses) the ROOT token and the ParcelLaunchpad that
///         collects ETH/USDC pledges per parcel into the land treasury.
///
/// Env:
///   PRIVATE_KEY        deployer key
///   LAND_TREASURY      address that receives all pledges (required)
///   USDC_ADDRESS       USDC (6-decimals) on the target chain (required)
///   ETH_PRICE_E6       USD price of 1 ETH, 6 decimals (default 3000_000000)
///   ROOT_TOKEN         optional — reuse an existing ROOT deployment
///
/// Run:
///   source .env && forge script script/DeployParcelLaunchpad.s.sol \
///     --rpc-url $ROBINHOOD_CHAIN_RPC --broadcast --slow
contract DeployParcelLaunchpad is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("LAND_TREASURY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 ethPriceE6 = vm.envOr("ETH_PRICE_E6", uint256(3000_000000)); // $3,000 default
        address existingRoot = vm.envOr("ROOT_TOKEN", address(0));

        require(treasury != address(0), "LAND_TREASURY unset");
        require(usdc != address(0), "USDC_ADDRESS unset");

        vm.startBroadcast(pk);

        // 1) $R00T token — deploy fresh unless an address was provided
        address root = existingRoot;
        if (root == address(0)) {
            RootToken token = new RootToken(); // mints 69M ROOT to deployer
            root = address(token);
        }

        // 2) Parcel funding rail — collects ETH/USDC → land treasury
        ParcelLaunchpad launchpad = new ParcelLaunchpad(treasury, usdc, ethPriceE6);

        vm.stopBroadcast();

        console.log("=========================================");
        console.log("Phase 1 deployment complete");
        console.log("  $R00T token      :", root);
        console.log("  ParcelLaunchpad  :", address(launchpad));
        console.log("  Land treasury    :", treasury);
        console.log("  USDC             :", usdc);
        console.log("  ETH price (e6)   :", ethPriceE6);
        console.log("=========================================");
        console.log("Next: set CONTRACTS.rootToken + CONTRACTS.parcelLaunchpad in the frontend config.");
    }
}
