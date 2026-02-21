// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ZkAMMv3Admin.sol";
import "../src/verifiers/RealRemoveLiquidityVerifier.sol";

/// @title UpgradeRemoveLiquidityVerifier
/// @notice Deploy new RemoveLiquidityVerifier with 10 pubSignals and update Admin
/// @dev Run: forge script script/UpgradeRemoveLiquidityVerifier.s.sol --rpc-url sepolia --broadcast
contract UpgradeRemoveLiquidityVerifierScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Current admin address on Sepolia
        address adminAddress = 0xD8B28e7323B6243a2Bb21420384cD04C78B74169;

        console.log("");
        console.log("=====================================================");
        console.log("   Upgrade RemoveLiquidity Verifier (Sepolia)        ");
        console.log("=====================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Admin:", adminAddress);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy new verifier with 10 pubSignals support
        console.log("Step 1: Deploying new RealRemoveLiquidityVerifier...");
        RealRemoveLiquidityVerifier newVerifier = new RealRemoveLiquidityVerifier();
        console.log("  New RemoveLiquidityVerifier:", address(newVerifier));

        // Step 2: Update admin to use new verifier
        console.log("");
        console.log("Step 2: Updating Admin with new verifier...");
        ZkAMMv3Admin admin = ZkAMMv3Admin(adminAddress);
        admin.proposeVerifierChange("removeLiquidity", address(newVerifier));
        console.log("  Verifier change proposed! Execute after timelock expires.");

        vm.stopBroadcast();

        console.log("");
        console.log("=====================================================");
        console.log("   UPGRADE COMPLETE                                  ");
        console.log("=====================================================");
        console.log("");
        console.log("New RemoveLiquidityVerifier:", address(newVerifier));
        console.log("");
        console.log("Frontend and Ponder don't need updates - same contract addresses!");
    }
}
