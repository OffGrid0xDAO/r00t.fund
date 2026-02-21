// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ZkAMMv3Router.sol";
import "../src/ZkAMMv3Admin.sol";

/// @title UpgradeRouter
/// @notice Deploy new ZkAMMv3Router with removeLiquidity reserve update fix and upgrade Admin
/// @dev Run: forge script script/UpgradeRouter.s.sol --rpc-url sepolia --broadcast
/// @dev BUGFIX: removeLiquidityPrivate was calling updateReserves(ethOut, tokensOut, false)
///      which INCREASED tokenReserve instead of decreasing it. Now uses two calls:
///      updateReserves(ethOut, 0, false) + updateReserves(0, tokensOut, true)
contract UpgradeRouterScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Current deployed addresses on Sepolia (Feb 5 deployment)
        address adminAddress = 0xF55A96A56567a9cE34a29c604A11Ed126E1d9Ad9;
        address pairAddress = 0xbC9c1c58Df08029077E5CD79110aF61384D59b0e;

        console.log("");
        console.log("=====================================================");
        console.log("   Upgrade ZkAMMv3Router (Sepolia)                   ");
        console.log("=====================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Admin:", adminAddress);
        console.log("Pair:", pairAddress);
        console.log("");

        ZkAMMv3Admin admin = ZkAMMv3Admin(adminAddress);
        address oldRouter = admin.router();
        console.log("Old Router:", oldRouter);

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy new Router with tokensOut parameter fix
        console.log("");
        console.log("Step 1: Deploying new ZkAMMv3Router...");
        ZkAMMv3Router newRouter = new ZkAMMv3Router(pairAddress, adminAddress);
        console.log("  New Router:", address(newRouter));

        // Step 2: Propose router upgrade (subject to timelock)
        console.log("");
        console.log("Step 2: Proposing Router upgrade (subject to timelock)...");
        admin.proposeRouterUpgrade(address(newRouter));
        console.log("  Router upgrade proposed! Execute after timelock expires.");

        vm.stopBroadcast();

        // Verify the upgrade
        address currentRouter = admin.router();
        console.log("");
        console.log("=====================================================");
        console.log("   UPGRADE COMPLETE                                  ");
        console.log("=====================================================");
        console.log("");
        console.log("Old Router:", oldRouter);
        console.log("New Router:", address(newRouter));
        console.log("Admin.router():", currentRouter);
        console.log("");
        console.log("Frontend config.ts update:");
        console.log("  ROUTER:", address(newRouter));
        console.log("");
    }
}
