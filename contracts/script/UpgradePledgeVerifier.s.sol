// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/LaunchpadGovernance.sol";
import "../src/verifiers/RealPledgeVerifier.sol";

/// @title UpgradePledgeVerifier
/// @notice Deploy RealPledgeVerifier and update LaunchpadGovernance to use it
/// @dev Run: forge script script/UpgradePledgeVerifier.s.sol --rpc-url sepolia --broadcast
contract UpgradePledgeVerifierScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Launchpad address on Sepolia
        address launchpadAddress = 0xd691561B4ca821c9D5D3F530223c7a44E50Cd765;

        console.log("");
        console.log("=====================================================");
        console.log("   Upgrade Pledge Verifier (Sepolia) - PRODUCTION    ");
        console.log("=====================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Launchpad:", launchpadAddress);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy RealPledgeVerifier (with real ZK proof verification)
        console.log("Step 1: Deploying RealPledgeVerifier...");
        RealPledgeVerifier newVerifier = new RealPledgeVerifier();
        console.log("  RealPledgeVerifier:", address(newVerifier));

        // Step 2: Update launchpad to use new verifier
        console.log("");
        console.log("Step 2: Updating Launchpad with RealPledgeVerifier...");
        LaunchpadGovernance launchpad = LaunchpadGovernance(launchpadAddress);
        launchpad.setPledgeVerifier(address(newVerifier));
        console.log("  Launchpad updated!");

        vm.stopBroadcast();

        console.log("");
        console.log("=====================================================");
        console.log("   UPGRADE COMPLETE                                  ");
        console.log("=====================================================");
        console.log("");
        console.log("RealPledgeVerifier:", address(newVerifier));
        console.log("");
        console.log("Using production ZK verifier with real proof validation.");
    }
}
