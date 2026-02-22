// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RootToken.sol";
import "../src/ZkAMMPair.sol";
import "../src/ZkAMMRouter.sol";
import "../src/ZkAMMAdmin.sol";
import "../src/NullifierRegistry.sol";
import "../src/R00TShorts.sol";

// Core Verifiers (REAL - production ready)
import "../src/verifiers/RealSellVerifier.sol";
import "../src/verifiers/RealTransferVerifier.sol";
import "../src/verifiers/RealWithdrawVerifier.sol";
import "../src/verifiers/RealSwapVerifier.sol";
import "../src/verifiers/RealAddLiquidityVerifier.sol";
import "../src/verifiers/RealRemoveLiquidityVerifier.sol";
import "../src/verifiers/RealClaimLPFeesVerifier.sol";
import "../src/verifiers/RealMergeVerifier.sol";

// Launchpad Verifiers
import "../src/verifiers/RealVoteVerifier.sol";
import "../src/verifiers/RealPledgeVerifier.sol";

// Launchpad
import "../src/LaunchpadGovernance.sol";
import "../src/factories/ProjectTokenFactory.sol";
import "../src/factories/ProjectPoolFactory.sol";
import "../src/ZkProjectPoolRouter.sol";

// CRE Contracts
import "../src/cre/R00tPolicyEngine.sol";
import "../src/cre/CompliantPrivateVault.sol";
import "../src/cre/ConfidentialFundingVault.sol";
import "../src/cre/RegenProofOfReserve.sol";
import "../src/cre/AIAgentOrchestrator.sol";
import "../src/cre/RegenPredictionMarket.sol";
import "../src/cre/ProtocolHealthMonitor.sol";
import "../src/cre/SerraEstrelaNativeForest.sol";
import "../src/cre/WorldIDGatekeeper.sol";

/// @title DeployTenderlyVNet
/// @notice Full system + CRE deployment to Tenderly Virtual TestNet
/// @dev Deploys:
///   Phase 1: Core ZkAMM system (token, verifiers, admin, pair, router)
///   Phase 2: Launchpad (governance, factories, pool router)
///   Phase 3: R00TShorts
///   Phase 4: All 8 CRE workflow contracts
///   Phase 5: Wire CRE contracts into core system (authorize callbacks)
///
/// Usage:
///   forge script script/DeployTenderlyVNet.s.sol --rpc-url tenderly-vnet --broadcast --slow
contract DeployTenderlyVNetScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint256 initialEth = vm.envOr("INITIAL_ETH_RESERVE", uint256(0.1 ether));

        // Use deployer as DON forwarder for testing on Virtual TestNet
        // In production, this would be the Chainlink CRE DON forwarder address
        address donForwarder = deployer;

        console.log("");
        console.log("==========================================================");
        console.log("   r00t.fund Full System + CRE Deployment                  ");
        console.log("   Target: Tenderly Virtual TestNet (Sepolia Fork)          ");
        console.log("==========================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        console.log("DON Forwarder (test):", donForwarder);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ==========================================
        // PHASE 1: Core ZkAMM System
        // ==========================================
        console.log("--- PHASE 1: Core ZkAMM System ---");
        console.log("");

        // Step 1: ROOT Token
        console.log("Step 1: Deploying ROOT Token...");
        RootToken rootToken = new RootToken();
        console.log("  RootToken:", address(rootToken));

        // Step 2: Core Verifiers
        console.log("Step 2: Deploying Core Verifiers...");
        address sellVerifier = address(new RealSellVerifier());
        address transferVerifier = address(new RealTransferVerifier());
        address withdrawVerifier = address(new RealWithdrawVerifier());
        address swapVerifier = address(new RealSwapVerifier());
        address addLiquidityVerifier = address(new RealAddLiquidityVerifier());
        address removeLiquidityVerifier = address(new RealRemoveLiquidityVerifier());
        address claimLPFeesVerifier = address(new RealClaimLPFeesVerifier());
        address mergeVerifier = address(new RealMergeVerifier());
        console.log("  8 core verifiers deployed");

        // Step 3: Launchpad Verifiers
        console.log("Step 3: Deploying Launchpad Verifiers...");
        address voteVerifier = address(new RealVoteVerifier());
        address pledgeVerifier = address(new RealPledgeVerifier());
        console.log("  2 launchpad verifiers deployed");

        // Step 4: Admin (with predicted pair address)
        console.log("Step 4: Deploying Admin...");
        address emergencySigner1 = deployer;
        address emergencySigner2 = 0x7e28521C66412877C727fC7cA2141bd5A1d5E238;
        address emergencySigner3 = 0x9CeB788f80B908f1a020b44C2cC560b4543ac1EA;

        uint64 adminNonce = vm.getNonce(deployer);
        address predictedPairAddress = vm.computeCreateAddress(deployer, adminNonce + 1);

        ZkAMMAdmin admin = new ZkAMMAdmin(
            predictedPairAddress,
            sellVerifier,
            transferVerifier,
            withdrawVerifier,
            deployer,
            emergencySigner1,
            emergencySigner2,
            emergencySigner3
        );
        console.log("  Admin:", address(admin));

        // Step 5: Pair
        console.log("Step 5: Deploying Pair...");
        ZkAMMPair pair = new ZkAMMPair(
            address(admin),
            address(rootToken),
            "r00t",
            "ROOT"
        );
        console.log("  Pair:", address(pair));
        require(address(pair) == predictedPairAddress, "Pair address mismatch!");

        // Step 6: Router
        console.log("Step 6: Deploying Router...");
        ZkAMMRouter router = new ZkAMMRouter(
            address(pair),
            address(admin)
        );
        console.log("  Router:", address(router));

        // Step 7: Configure
        console.log("Step 7: Configuring ZkAMM...");
        admin.setRouter(address(router));
        admin.setVerifierInitial("addLiquidity", addLiquidityVerifier);
        admin.setVerifierInitial("removeLiquidity", removeLiquidityVerifier);
        admin.setVerifierInitial("claimLPFees", claimLPFeesVerifier);
        admin.setVerifierInitial("swap", swapVerifier);
        admin.setVerifierInitial("merge", mergeVerifier);
        console.log("  Router + verifiers configured");

        // Step 8: Transfer tokens + bootstrap
        console.log("Step 8: Bootstrapping liquidity...");
        rootToken.transfer(address(pair), rootToken.totalSupply());
        uint256 lpCommitment = uint256(keccak256(abi.encodePacked(
            "r00t_bootstrap_lp_", block.chainid, address(pair)
        ))) % pair.SNARK_SCALAR_FIELD();

        router.bootstrapLiquidity{value: initialEth}(
            lpCommitment, 0, block.timestamp + 1 hours, ""
        );
        console.log("  Pool bootstrapped with", initialEth / 1e18, "ETH");

        // ==========================================
        // PHASE 2: Launchpad
        // ==========================================
        console.log("");
        console.log("--- PHASE 2: Launchpad ---");

        NullifierRegistry nullifierRegistry = new NullifierRegistry(deployer);
        nullifierRegistry.setPoolAuthorization(address(router), true);

        ZkProjectPoolRouter poolRouter = new ZkProjectPoolRouter();
        ProjectPoolFactory poolFactory = new ProjectPoolFactory(address(poolRouter));
        ProjectTokenFactory tempTokenFactory = new ProjectTokenFactory(deployer);

        LaunchpadGovernance launchpad = new LaunchpadGovernance(
            address(pair.tokenPool()),
            address(tempTokenFactory),
            address(poolFactory),
            address(router),
            address(nullifierRegistry),
            deployer,
            voteVerifier,
            pledgeVerifier
        );

        ProjectTokenFactory tokenFactory = new ProjectTokenFactory(address(launchpad));
        launchpad.setTokenFactory(address(tokenFactory));
        poolFactory.setGovernanceInitial(address(launchpad));
        admin.setLaunchpadInitial(address(launchpad));
        console.log("  LaunchpadGovernance:", address(launchpad));

        // ==========================================
        // PHASE 3: R00TShorts
        // ==========================================
        console.log("");
        console.log("--- PHASE 3: R00TShorts ---");

        R00TShorts shorts = new R00TShorts(address(pair), address(rootToken), deployer);
        admin.setShortsContractInitial(address(shorts));
        uint256 shortsAllocation = 10_000_000 * 1e18;
        admin.allocateTokensForShorts(shortsAllocation);
        console.log("  R00TShorts:", address(shorts));

        // ==========================================
        // PHASE 4: CRE Workflow Contracts
        // ==========================================
        console.log("");
        console.log("--- PHASE 4: CRE Workflow Contracts ---");
        console.log("");

        // W6: R00tPolicyEngine (deployed first — needed by CompliantPrivateVault)
        console.log("Deploying W6a: R00tPolicyEngine...");
        R00tPolicyEngine policyEngine = new R00tPolicyEngine(donForwarder, deployer);
        console.log("  R00tPolicyEngine:", address(policyEngine));

        // W6: CompliantPrivateVault (ACE pattern)
        console.log("Deploying W6b: CompliantPrivateVault...");
        CompliantPrivateVault vault = new CompliantPrivateVault(
            donForwarder, deployer, address(policyEngine), address(pair), address(router)
        );
        console.log("  CompliantPrivateVault:", address(vault));

        // W1: ConfidentialFundingVault
        console.log("Deploying W1: ConfidentialFundingVault...");
        ConfidentialFundingVault fundingVault = new ConfidentialFundingVault(
            donForwarder, deployer, address(launchpad), address(pair)
        );
        console.log("  ConfidentialFundingVault:", address(fundingVault));

        // W2: RegenProofOfReserve
        console.log("Deploying W2: RegenProofOfReserve...");
        RegenProofOfReserve proofOfReserve = new RegenProofOfReserve(donForwarder, deployer);
        console.log("  RegenProofOfReserve:", address(proofOfReserve));

        // W3: AIAgentOrchestrator
        console.log("Deploying W3: AIAgentOrchestrator...");
        AIAgentOrchestrator aiOrchestrator = new AIAgentOrchestrator(donForwarder, deployer);
        console.log("  AIAgentOrchestrator:", address(aiOrchestrator));

        // W4: RegenPredictionMarket
        console.log("Deploying W4: RegenPredictionMarket...");
        RegenPredictionMarket predictionMarket = new RegenPredictionMarket(
            donForwarder, deployer, deployer
        );
        console.log("  RegenPredictionMarket:", address(predictionMarket));

        // W5: ProtocolHealthMonitor
        console.log("Deploying W5: ProtocolHealthMonitor...");
        ProtocolHealthMonitor healthMonitor = new ProtocolHealthMonitor(
            donForwarder, deployer, address(admin)
        );
        console.log("  ProtocolHealthMonitor:", address(healthMonitor));

        // W7: SerraEstrelaNativeForest
        console.log("Deploying W7: SerraEstrelaNativeForest...");
        SerraEstrelaNativeForest serraDaEstrela = new SerraEstrelaNativeForest(
            donForwarder, deployer
        );
        console.log("  SerraEstrelaNativeForest:", address(serraDaEstrela));

        // W8: WorldIDGatekeeper
        console.log("Deploying W8: WorldIDGatekeeper...");
        WorldIDGatekeeper worldIdGatekeeper = new WorldIDGatekeeper(
            donForwarder, deployer, "app_staging_r00t_fund"
        );
        console.log("  WorldIDGatekeeper:", address(worldIdGatekeeper));

        // ==========================================
        // PHASE 5: Wire CRE into Core System
        // ==========================================
        console.log("");
        console.log("--- PHASE 5: Wiring CRE into Core System ---");

        // Propose CRE callback authorizations (timelocked — execute after delay)
        admin.proposeCRECallback(address(vault));
        console.log("  CompliantPrivateVault CRE callback proposed (execute after timelock)");

        // Set health monitor on admin (no timelock needed)
        admin.setHealthMonitor(address(healthMonitor));
        console.log("  ProtocolHealthMonitor set on Admin");

        // Set World ID gatekeeper on launchpad (initial setup — no timelock)
        launchpad.setWorldIdGatekeeper(address(worldIdGatekeeper));
        console.log("  WorldIDGatekeeper set on LaunchpadGovernance");

        console.log("");
        console.log("  NOTE: CRE callback authorization requires timelock.");
        console.log("  Run DeployTenderlyVNetPhase2.s.sol after timelock expires");
        console.log("  to execute CRE authorizations.");

        vm.stopBroadcast();

        // ==========================================
        // Summary
        // ==========================================
        console.log("");
        console.log("==========================================================");
        console.log("   DEPLOYMENT COMPLETE - Tenderly Virtual TestNet           ");
        console.log("==========================================================");
        console.log("");
        console.log("CORE CONTRACTS:");
        console.log("  RootToken:         ", address(rootToken));
        console.log("  Pair:              ", address(pair));
        console.log("  Router:            ", address(router));
        console.log("  Admin:             ", address(admin));
        console.log("  TokenPool:         ", address(pair.tokenPool()));
        console.log("  LPPool:            ", address(pair.lpPool()));
        console.log("");
        console.log("LAUNCHPAD:");
        console.log("  LaunchpadV2:       ", address(launchpad));
        console.log("  TokenFactory:      ", address(tokenFactory));
        console.log("  PoolFactory:       ", address(poolFactory));
        console.log("");
        console.log("SHORTS:");
        console.log("  R00TShorts:        ", address(shorts));
        console.log("");
        console.log("CRE WORKFLOW CONTRACTS:");
        console.log("  W1 ConfidentialFunding:  ", address(fundingVault));
        console.log("  W2 ProofOfReserve:       ", address(proofOfReserve));
        console.log("  W3 AIOrchestrator:       ", address(aiOrchestrator));
        console.log("  W4 PredictionMarket:     ", address(predictionMarket));
        console.log("  W5 HealthMonitor:        ", address(healthMonitor));
        console.log("  W6 PolicyEngine:         ", address(policyEngine));
        console.log("  W6 CompliantVault:        ", address(vault));
        console.log("  W7 SerraEstrelaDataFeed: ", address(serraDaEstrela));
        console.log("  W8 WorldIDGatekeeper:    ", address(worldIdGatekeeper));
        console.log("");
        console.log("DON Forwarder (test):      ", donForwarder);
        console.log("");
        console.log("Explorer: https://dashboard.tenderly.co/manifestordao/manifestordao/testnet/596dfbfb-e22d-4186-b982-33682540383d");
        console.log("");
    }
}
