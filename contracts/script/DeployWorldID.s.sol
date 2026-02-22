// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/cre/WorldIDGatekeeper.sol";

/// @title DeployWorldID
/// @notice Deploy WorldIDGatekeeper to Tenderly VNet and wire into existing LaunchpadGovernance
/// @dev Uses the deployer as DON forwarder (same as all other CRE contracts on VNet)
///
/// Usage:
///   source contracts/.env
///   forge script script/DeployWorldID.s.sol --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow

interface ILaunchpadGovernance {
    function setWorldIdGatekeeper(address _gatekeeper) external;
    function worldIdGatekeeper() external view returns (address);
    function isInitialSetupPhaseActive() external view returns (bool);
    function proposeWorldIdGatekeeper(address _gatekeeper) external;
}

contract DeployWorldIDScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Existing contract addresses from .env
        address launchpad = vm.envAddress("LAUNCHPAD_GOVERNANCE_ADDRESS");

        // Use deployer as DON forwarder for testing (same as other CRE contracts)
        address donForwarder = deployer;

        console.log("");
        console.log("==========================================================");
        console.log("   World ID Gatekeeper Deployment (W8)                     ");
        console.log("   Target: Tenderly Virtual TestNet                        ");
        console.log("==========================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("DON Forwarder:", donForwarder);
        console.log("Launchpad:", launchpad);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ---- Step 1: Deploy WorldIDGatekeeper ----
        console.log("Step 1: Deploying WorldIDGatekeeper...");
        WorldIDGatekeeper gatekeeper = new WorldIDGatekeeper(
            donForwarder,
            deployer,
            "app_staging_r00t_fund"
        );
        console.log("  WorldIDGatekeeper:", address(gatekeeper));

        // ---- Step 2: Wire into LaunchpadGovernance ----
        console.log("");
        console.log("Step 2: Wiring into LaunchpadGovernance...");

        // Check if initial setup phase is still active
        bool setupActive = ILaunchpadGovernance(launchpad).isInitialSetupPhaseActive();

        if (setupActive) {
            // Initial setup phase — can set immediately
            ILaunchpadGovernance(launchpad).setWorldIdGatekeeper(address(gatekeeper));
            console.log("  Set via initial setup (no timelock)");
        } else {
            // Post-setup — need to propose (timelocked)
            ILaunchpadGovernance(launchpad).proposeWorldIdGatekeeper(address(gatekeeper));
            console.log("  Proposed via timelock (execute acceptWorldIdGatekeeper after delay)");
        }

        // Verify
        address currentGatekeeper = ILaunchpadGovernance(launchpad).worldIdGatekeeper();
        console.log("  Current gatekeeper on launchpad:", currentGatekeeper);

        vm.stopBroadcast();

        // ---- Summary ----
        console.log("");
        console.log("==========================================================");
        console.log("   WORLD ID DEPLOYMENT COMPLETE                            ");
        console.log("==========================================================");
        console.log("");
        console.log("  WorldIDGatekeeper:  ", address(gatekeeper));
        console.log("  App ID:             app_staging_r00t_fund");
        console.log("  Action:             create-proposal");
        console.log("  DON Forwarder:      ", donForwarder);
        console.log("");
        console.log("  Add to .env:");
        console.log("  WORLD_ID_GATEKEEPER_ADDRESS=", address(gatekeeper));
        console.log("");
    }
}
