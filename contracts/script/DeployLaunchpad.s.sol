// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LaunchpadGovernance} from "../src/LaunchpadGovernance.sol";
import {ProjectTokenFactory} from "../src/factories/ProjectTokenFactory.sol";
import {ProjectPoolFactory} from "../src/factories/ProjectPoolFactory.sol";
import {ZkProjectPoolRouter} from "../src/ZkProjectPoolRouter.sol";
import {RealVoteVerifier} from "../src/verifiers/RealVoteVerifier.sol";
import {RealPledgeVerifier} from "../src/verifiers/RealPledgeVerifier.sol";

contract DeployLaunchpadScript is Script {
    address constant ZKAMMV3 = 0x02eBDea1353d38E71214F374467FB00e60c5A883;
    address constant TOKEN_POOL = 0x1c94D3b0b21Ca2515d188E246AeF30276779580E;
    address constant NULLIFIER_REGISTRY = 0xAFa50b0DeA8c33123C1bf5a4b8A84eDB35D2AC1F;
    address constant PLATFORM_TREASURY = 0x42069c220DD72541C2C7Cb7620f2094f1601430A;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("\n========================================");
        console.log("   LaunchpadGovernance Deployment");
        console.log("========================================\n");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy Router & ProjectPoolFactory
        console.log("\nStep 1: Deploying Router & ProjectPoolFactory...");
        // Deploy stateless router (shared by all pools)
        ZkProjectPoolRouter poolRouter = new ZkProjectPoolRouter();
        console.log("  ZkProjectPoolRouter:", address(poolRouter));
        // Deploy factory with router reference
        ProjectPoolFactory poolFactory = new ProjectPoolFactory(address(poolRouter));
        console.log("  ProjectPoolFactory:", address(poolFactory));

        // Step 3: Deploy REAL ZK verifiers (production-ready)
        console.log("\nStep 3: Deploying real ZK verifiers...");
        RealVoteVerifier voteVerifier = new RealVoteVerifier();
        RealPledgeVerifier pledgeVerifier = new RealPledgeVerifier();
        console.log("  RealVoteVerifier:", address(voteVerifier));
        console.log("  RealPledgeVerifier:", address(pledgeVerifier));

        // Step 4: Deploy ProjectTokenFactory (temp governance)
        console.log("\nStep 4: Deploying ProjectTokenFactory...");
        ProjectTokenFactory tokenFactory = new ProjectTokenFactory(deployer);

        // Step 5: Deploy LaunchpadGovernance
        console.log("\nStep 5: Deploying LaunchpadGovernance...");
        LaunchpadGovernance launchpad = new LaunchpadGovernance(
            TOKEN_POOL,
            address(tokenFactory),
            address(poolFactory),
            ZKAMMV3,
            NULLIFIER_REGISTRY,
            PLATFORM_TREASURY,
            address(voteVerifier),
            address(pledgeVerifier)
        );
        console.log("  LaunchpadGovernance:", address(launchpad));

        // Step 6: Redeploy TokenFactory with correct governance
        tokenFactory = new ProjectTokenFactory(address(launchpad));
        launchpad.setTokenFactory(address(tokenFactory));
        console.log("  ProjectTokenFactory:", address(tokenFactory));

        // Step 7: Set governance on pool factory
        // SECURITY: Use setGovernanceInitial for first-time setup (timelocked after this)
        poolFactory.setGovernanceInitial(address(launchpad));

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("   DEPLOYMENT COMPLETE");
        console.log("========================================\n");
        console.log("LaunchpadGovernance:", address(launchpad));
        console.log("ProjectTokenFactory:", address(tokenFactory));
        console.log("ProjectPoolFactory:", address(poolFactory));
        console.log("ZkProjectPoolRouter:", address(poolRouter));
        console.log("\nMANUAL STEPS:");
        console.log("1. ZkAMM.setLaunchpad(launchpad)");
        console.log("2. NullifierRegistry.setGovernance(launchpad)");
    }
}
