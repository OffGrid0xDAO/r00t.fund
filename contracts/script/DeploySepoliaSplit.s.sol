// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RootToken.sol";
import "../src/ZkAMMPair.sol";
import "../src/ZkAMMRouter.sol";
import "../src/ZkAMMAdmin.sol";
import "../src/NullifierRegistry.sol";
import "../src/R00TShorts.sol";

// Core Verifiers (REAL - production ready with snarkjs circuits)
import "../src/verifiers/RealSellVerifier.sol";
import "../src/verifiers/RealTransferVerifier.sol";
import "../src/verifiers/RealWithdrawVerifier.sol";
import "../src/verifiers/RealSwapVerifier.sol";
import "../src/verifiers/RealAddLiquidityVerifier.sol";
import "../src/verifiers/RealRemoveLiquidityVerifier.sol";
import "../src/verifiers/RealClaimLPFeesVerifier.sol";
import "../src/verifiers/RealMergeVerifier.sol";

// Launchpad Verifiers (REAL - production ready with snarkjs circuits)
import "../src/verifiers/RealVoteVerifier.sol";
import "../src/verifiers/RealPledgeVerifier.sol";

// Launchpad
import "../src/LaunchpadGovernance.sol";
import "../src/factories/ProjectTokenFactory.sol";
import "../src/factories/ProjectPoolFactory.sol";
import "../src/ZkProjectPoolRouter.sol";

/// @title DeploySepoliaSplit
/// @notice Deploy full r00t.fund system to Sepolia (Split ZkAMM + Launchpad)
/// @dev Deployment order:
/// 1. ROOT token
/// 2. All verifiers (core + launchpad)
/// 3. Admin (needs predicted pair address)
/// 4. Pair (with admin address)
/// 5. Router (with pair and admin addresses)
/// 6. Set router on Admin (which sets it on Pair too)
/// 7. Transfer ROOT tokens to Pair
/// 8. NullifierRegistry
/// 9. Pool system (ZkProjectPoolImpl, PoolDeployer, ProjectPoolFactory)
/// 10. LaunchpadGovernance (with placeholder token factory)
/// 11. ProjectTokenFactory (with launchpad address)
/// 12. Update launchpad with correct token factory
/// 13. Connect everything
///
/// Usage:
///   forge script script/DeploySepoliaSplit.s.sol --rpc-url sepolia --broadcast
contract DeploySepoliaSplitScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint256 initialEth = vm.envOr("INITIAL_ETH_RESERVE", uint256(0.01 ether));

        console.log("");
        console.log("=====================================================");
        console.log("   r00t.fund Full System Deployment (Sepolia)        ");
        console.log("=====================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        console.log("Initial ETH:", initialEth / 1e18, "ETH");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ==========================================
        // Step 1: Deploy ROOT Token
        // ==========================================
        console.log("Step 1: Deploying ROOT Token...");
        RootToken rootToken = new RootToken();
        console.log("  RootToken:", address(rootToken));

        // ==========================================
        // Step 2: Deploy Core Verifiers (REAL - production)
        // ==========================================
        console.log("");
        console.log("Step 2: Deploying Core Verifiers (REAL - production)...");

        address sellVerifier = address(new RealSellVerifier());
        console.log("  RealSellVerifier:", sellVerifier);

        address transferVerifier = address(new RealTransferVerifier());
        console.log("  RealTransferVerifier:", transferVerifier);

        address withdrawVerifier = address(new RealWithdrawVerifier());
        console.log("  RealWithdrawVerifier:", withdrawVerifier);

        address swapVerifier = address(new RealSwapVerifier());
        console.log("  RealSwapVerifier:", swapVerifier);

        address addLiquidityVerifier = address(new RealAddLiquidityVerifier());
        console.log("  RealAddLiquidityVerifier:", addLiquidityVerifier);

        address removeLiquidityVerifier = address(new RealRemoveLiquidityVerifier());
        console.log("  RealRemoveLiquidityVerifier:", removeLiquidityVerifier);

        address claimLPFeesVerifier = address(new RealClaimLPFeesVerifier());
        console.log("  RealClaimLPFeesVerifier:", claimLPFeesVerifier);

        address mergeVerifier = address(new RealMergeVerifier());
        console.log("  RealMergeVerifier:", mergeVerifier);

        // ==========================================
        // Step 3: Deploy Launchpad Verifiers (REAL - production)
        // ==========================================
        console.log("");
        console.log("Step 3: Deploying Launchpad Verifiers (REAL - production)...");

        address voteVerifier = address(new RealVoteVerifier());
        console.log("  RealVoteVerifier:", voteVerifier);

        address pledgeVerifier = address(new RealPledgeVerifier());
        console.log("  RealPledgeVerifier:", pledgeVerifier);

        // ==========================================
        // Step 4: Deploy Admin (with predicted pair address)
        // ==========================================
        console.log("");
        console.log("Step 4: Computing addresses and deploying Admin...");

        // Emergency signers - 2-of-3 multisig for emergency withdrawals
        address emergencySigner1 = deployer;
        address emergencySigner2 = 0x7e28521C66412877C727fC7cA2141bd5A1d5E238;
        address emergencySigner3 = 0x9CeB788f80B908f1a020b44C2cC560b4543ac1EA;

        // Compute what the Pair address will be
        uint64 adminNonce = vm.getNonce(deployer);
        // After deploying Admin (nonce), Pair will be deployed (nonce+1)
        address predictedPairAddress = vm.computeCreateAddress(deployer, adminNonce + 1);

        ZkAMMAdmin admin = new ZkAMMAdmin(
            predictedPairAddress,       // pair (predicted)
            sellVerifier,
            transferVerifier,
            withdrawVerifier,
            deployer,                   // treasury
            emergencySigner1,
            emergencySigner2,
            emergencySigner3
        );
        console.log("  Admin:", address(admin));

        // ==========================================
        // Step 5: Deploy Pair
        // ==========================================
        console.log("");
        console.log("Step 5: Deploying Pair...");

        // Deploy Pair with minimal ETH (bootstrap will add the real liquidity)
        ZkAMMPair pair = new ZkAMMPair(
            address(admin),             // admin
            address(rootToken),         // rootToken
            "r00t",                     // name
            "ROOT"                      // symbol
        );
        console.log("  Pair:", address(pair));
        console.log("  TokenPool:", address(pair.tokenPool()));
        console.log("  LPPool:", address(pair.lpPool()));

        // Verify prediction was correct
        require(address(pair) == predictedPairAddress, "Pair address mismatch!");

        // ==========================================
        // Step 6: Deploy Router
        // ==========================================
        console.log("");
        console.log("Step 6: Deploying Router...");

        ZkAMMRouter router = new ZkAMMRouter(
            address(pair),
            address(admin)
        );
        console.log("  Router:", address(router));

        // ==========================================
        // Step 7: Configure - Set Router on Admin/Pair
        // ==========================================
        console.log("");
        console.log("Step 7: Configuring ZkAMM system...");

        // Set router (Admin sets it on both itself and Pair)
        admin.setRouter(address(router));
        console.log("  Router set on Admin and Pair");

        // Configure additional verifiers on Admin (initial set - no timelock needed for empty slots)
        admin.setVerifierInitial("addLiquidity", addLiquidityVerifier);
        admin.setVerifierInitial("removeLiquidity", removeLiquidityVerifier);
        admin.setVerifierInitial("claimLPFees", claimLPFeesVerifier);
        admin.setVerifierInitial("swap", swapVerifier);
        admin.setVerifierInitial("merge", mergeVerifier);
        console.log("  All core verifiers configured (including merge)");

        // ==========================================
        // Step 8: Transfer ROOT tokens to Pair
        // ==========================================
        console.log("");
        console.log("Step 8: Transferring ROOT tokens to Pair...");
        rootToken.transfer(address(pair), rootToken.totalSupply());
        console.log("  ", rootToken.totalSupply() / 1e18, "ROOT transferred to Pair");

        // ==========================================
        // Step 8b: Bootstrap Liquidity
        // ==========================================
        console.log("");
        console.log("Step 8b: Bootstrapping liquidity with", initialEth / 1e18, "ETH...");

        // Generate deterministic LP commitment for bootstrap
        uint256 lpCommitment = uint256(keccak256(abi.encodePacked("r00t_bootstrap_lp_", block.chainid, address(pair)))) % pair.SNARK_SCALAR_FIELD();

        router.bootstrapLiquidity{value: initialEth}(
            lpCommitment,
            0,  // minLPShares
            block.timestamp + 1 hours,  // deadline
            ""  // empty encrypted note
        );
        console.log("  Pool bootstrapped! LP Commitment:", lpCommitment);
        console.log("  Total LP Shares:", pair.totalLPShares() / 1e18);

        // ==========================================
        // Step 9: Deploy NullifierRegistry
        // ==========================================
        console.log("");
        console.log("Step 9: Deploying NullifierRegistry...");

        NullifierRegistry nullifierRegistry = new NullifierRegistry(deployer);
        nullifierRegistry.setPoolAuthorization(address(router), true);
        console.log("  NullifierRegistry:", address(nullifierRegistry));

        // ==========================================
        // Step 10: Deploy Pool Router & Factory
        // ==========================================
        console.log("");
        console.log("Step 10: Deploying Pool Router & Factory...");

        // Deploy stateless router (shared by all pools)
        ZkProjectPoolRouter poolRouter = new ZkProjectPoolRouter();
        console.log("  ZkProjectPoolRouter:", address(poolRouter));
        // Deploy factory with router reference
        ProjectPoolFactory poolFactory = new ProjectPoolFactory(address(poolRouter));
        console.log("  ProjectPoolFactory:", address(poolFactory));

        // ==========================================
        // Step 11: Deploy Placeholder Token Factory
        // ==========================================
        console.log("");
        console.log("Step 11: Deploying placeholder TokenFactory...");

        // Deploy with deployer as temporary governance (will be replaced)
        ProjectTokenFactory tempTokenFactory = new ProjectTokenFactory(deployer);
        console.log("  Temporary TokenFactory:", address(tempTokenFactory));

        // ==========================================
        // Step 12: Deploy LaunchpadGovernance
        // ==========================================
        console.log("");
        console.log("Step 12: Deploying LaunchpadGovernance...");

        LaunchpadGovernance launchpad = new LaunchpadGovernance(
            address(pair.tokenPool()),   // r00tPool
            address(tempTokenFactory),   // tokenFactory (temporary, will update)
            address(poolFactory),        // poolFactory
            address(router),             // zkAMMv3 (router is the main entry point)
            address(nullifierRegistry),  // nullifierRegistry
            deployer,                    // platformTreasury
            voteVerifier,                // voteVerifier
            pledgeVerifier               // pledgeVerifier
        );
        console.log("  LaunchpadGovernance:", address(launchpad));

        // ==========================================
        // Step 13: Deploy Real Token Factory
        // ==========================================
        console.log("");
        console.log("Step 13: Deploying real TokenFactory with Launchpad...");

        ProjectTokenFactory tokenFactory = new ProjectTokenFactory(address(launchpad));
        console.log("  ProjectTokenFactory:", address(tokenFactory));

        // Update launchpad with correct token factory
        launchpad.setTokenFactory(address(tokenFactory));
        console.log("  Launchpad updated with real TokenFactory");

        // ==========================================
        // Step 14: Connect Everything
        // ==========================================
        console.log("");
        console.log("Step 14: Connecting all contracts...");

        // Set governance on pool factory
        poolFactory.setGovernanceInitial(address(launchpad));
        console.log("  PoolFactory governance set to Launchpad");

        // Set launchpad on ZkAMM Admin (for project pool registration)
        // This also authorizes launchpad in TokenPool via pair.setTokenPoolAuthorizedCaller
        admin.setLaunchpadInitial(address(launchpad));
        console.log("  Admin launchpad set (also authorized in TokenPool)");

        // ==========================================
        // Step 15: Deploy R00TShorts + Fund with tokens
        // ==========================================
        console.log("");
        console.log("Step 15: Deploying R00TShorts...");

        R00TShorts shorts = new R00TShorts(
            address(pair),
            address(rootToken),
            deployer  // treasury
        );
        console.log("  R00TShorts:", address(shorts));

        // Set shorts contract on pair (one-time)
        admin.setShortsContractInitial(address(shorts));
        console.log("  Shorts contract set on Pair");

        // Allocate 10M ROOT tokens (14.5% of supply) from pool to shorts
        uint256 shortsAllocation = 10_000_000 * 1e18;
        admin.allocateTokensForShorts(shortsAllocation);
        console.log("  Allocated", shortsAllocation / 1e18, "ROOT to shorts");
        console.log("  Shorts available:", shorts.getAvailableTokens() / 1e18, "ROOT");

        vm.stopBroadcast();

        // ==========================================
        // Summary
        // ==========================================
        console.log("");
        console.log("=====================================================");
        console.log("   DEPLOYMENT COMPLETE                               ");
        console.log("=====================================================");
        console.log("");
        console.log("CORE CONTRACTS (ZkAMM):");
        console.log("  Pair:              ", address(pair));
        console.log("  Router:            ", address(router));
        console.log("  Admin:             ", address(admin));
        console.log("  TokenPool:         ", address(pair.tokenPool()));
        console.log("  LPPool:            ", address(pair.lpPool()));
        console.log("");
        console.log("LAUNCHPAD:");
        console.log("  LaunchpadGovernance:", address(launchpad));
        console.log("  ProjectTokenFactory:  ", address(tokenFactory));
        console.log("  ProjectPoolFactory:   ", address(poolFactory));
        console.log("  ZkProjectPoolRouter:  ", address(poolRouter));
        console.log("");
        console.log("SHORTS:");
        console.log("  R00TShorts:           ", address(shorts));
        console.log("");
        console.log("SUPPORTING:");
        console.log("  RootToken:            ", address(rootToken));
        console.log("  NullifierRegistry:    ", address(nullifierRegistry));
        console.log("");
        console.log("CORE VERIFIERS:");
        console.log("  Sell:               ", sellVerifier);
        console.log("  Transfer:           ", transferVerifier);
        console.log("  Withdraw:           ", withdrawVerifier);
        console.log("  Swap:               ", swapVerifier);
        console.log("  AddLiquidity:       ", addLiquidityVerifier);
        console.log("  RemoveLiquidity:    ", removeLiquidityVerifier);
        console.log("  ClaimLPFees:        ", claimLPFeesVerifier);
        console.log("  Merge:              ", mergeVerifier);
        console.log("");
        console.log("LAUNCHPAD VERIFIERS:");
        console.log("  Vote:               ", voteVerifier);
        console.log("  Pledge:             ", pledgeVerifier);
        console.log("");
        console.log("=====================================================");
        console.log("");
        console.log("Frontend .env:");
        console.log("VITE_CHAIN_ID=11155111");
        console.log("VITE_ZKAMM_PAIR_ADDRESS=", address(pair));
        console.log("VITE_ZKAMM_ROUTER_ADDRESS=", address(router));
        console.log("VITE_ZKAMM_ADMIN_ADDRESS=", address(admin));
        console.log("VITE_TOKEN_POOL_ADDRESS=", address(pair.tokenPool()));
        console.log("VITE_LP_POOL_ADDRESS=", address(pair.lpPool()));
        console.log("VITE_NULLIFIER_REGISTRY_ADDRESS=", address(nullifierRegistry));
        console.log("VITE_ROOT_TOKEN_ADDRESS=", address(rootToken));
        console.log("VITE_LAUNCHPAD_ADDRESS=", address(launchpad));
        console.log("VITE_TOKEN_FACTORY_ADDRESS=", address(tokenFactory));
        console.log("VITE_POOL_FACTORY_ADDRESS=", address(poolFactory));
        console.log("VITE_SHORTS_CONTRACT_ADDRESS=", address(shorts));
        console.log("");
    }
}
