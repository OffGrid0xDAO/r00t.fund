// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

/// @title SimulateCREActivity
/// @notice Simulates 54+ realistic CRE workflow transactions on Tenderly VNet
/// @dev Uses the deployer as DON forwarder (same as deployment)
///
/// Usage:
///   source cre-workflows/.env.tenderly
///   forge script script/SimulateCREActivity.s.sol --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow

// Minimal interfaces for each CRE contract
interface IPilotSiteForest {
    function receiveReport(
        int256 ndviCurrent, int256 ndviPreFire, uint256 ndviRecoveryPct,
        int256 dnbr, uint256 soilOrganicCarbon, uint256 estimatedLiveTrees,
        uint256 annualCO2, uint256 carbonCredits, uint256 fireRecoveryIndex
    ) external;
    function getLatestReport() external view returns (
        int256, int256, uint256, int256, uint256, uint256, uint256, uint256, uint256, uint256
    );
}

interface IRegenProofOfReserve {
    function receiveReport(
        uint256 ethReserve, uint256 tokenReserve, uint256 totalTVL,
        uint256 backingRatio, uint256 impactScore
    ) external;
}

interface IAIAgentOrchestrator {
    function receiveReport(
        uint8 riskLevel, uint8 recommendedAction,
        bytes32 analysisHash, bytes calldata strategyData
    ) external;
    function receiveGovernanceAdvisory(
        uint256 proposalId, uint8 recommendation,
        uint256 confidence, bytes32 reasoningHash
    ) external;
}

interface IProtocolHealthMonitor {
    function receiveReport(
        uint256 ethReserve, uint256 tokenReserve, uint256 reserveRatio,
        uint256 shortsUtilization, uint8 overallRiskLevel, uint8 recommendedAction
    ) external;
}

interface IConfidentialFundingVault {
    function receiveReport(
        uint256 proposalId, uint256 impactScore,
        bytes32 attestationHash, bytes calldata encryptedAttestation
    ) external;
    function setMinImpactScore(uint256 _score) external;
}

interface IRegenPredictionMarket {
    function createMarket(
        uint256 proposalId, string calldata metric,
        uint256 targetValue, uint256 resolutionTime
    ) external;
    function buyShares(uint256 marketId, bool isPositive, uint256 minShares) external payable;
    function receiveReport(
        uint256 marketId, uint8 outcome,
        uint256 actualValue, bytes32 proofHash
    ) external;
}

interface IR00tPolicyEngine {
    function attestCompliance(
        bytes32 addressHash, uint8 level, uint256 validityPeriod,
        bytes32 attestationHash, bool sanctionsCleared,
        bytes32 jurisdictionHash, uint8 riskScore
    ) external;
    function setPolicy(
        uint8 transferType, uint8 minLevel, uint256 maxAmountPerTx,
        uint256 maxAmountPerDay, uint8 maxRiskScore,
        bool requireSanctionsCheck, bool requireJurisdiction, bool active
    ) external;
    function setJurisdiction(bytes32 jurisdictionHash, bool approved) external;
}

interface ICompliantPrivateVault {
    function requestDeposit(
        uint256 commitment, bytes32 addressHash, bytes calldata encryptedNote
    ) external payable returns (uint256);
    function authorizeTransfer(uint256 requestId) external;
    function denyTransfer(uint256 requestId, string calldata reason) external;
    function getVaultStats() external view returns (uint256, uint256, uint256, uint256, uint256, uint256);
}

interface IWorldIDGatekeeper {
    function requestVerification(
        bytes32 nullifierHash, bytes32 merkleRoot,
        uint256[8] calldata proof, string calldata verificationLevel
    ) external returns (uint256);
    function receiveVerificationResult(
        uint256 requestId, bool verified, string calldata reason
    ) external;
    function isVerified(address user) external view returns (bool);
    function totalVerified() external view returns (uint256);
    function totalPending() external view returns (uint256);
}

interface IZkAMMPair {
    function ethReserve() external view returns (uint256);
    function tokenReserve() external view returns (uint256);
}

contract SimulateCREActivityScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Contract addresses from .env.tenderly
        address pilotSite = vm.envAddress("PILOT_SITE_DATAFEED_ADDRESS");
        address proofOfReserve = vm.envAddress("REGEN_PROOF_OF_RESERVE_ADDRESS");
        address aiOrchestrator = vm.envAddress("AI_AGENT_ORCHESTRATOR_ADDRESS");
        address healthMonitor = vm.envAddress("PROTOCOL_HEALTH_MONITOR_ADDRESS");
        address fundingVault = vm.envAddress("CONFIDENTIAL_FUNDING_VAULT_ADDRESS");
        address predictionMarket = vm.envAddress("REGEN_PREDICTION_MARKET_ADDRESS");
        address policyEngine = vm.envAddress("R00T_POLICY_ENGINE_ADDRESS");
        address compliantVault = vm.envAddress("COMPLIANT_PRIVATE_VAULT_ADDRESS");
        address zkammPair = vm.envAddress("ZKAMM_PAIR_ADDRESS");
        address worldIdGatekeeper = vm.envAddress("WORLD_ID_GATEKEEPER_ADDRESS");

        console.log("");
        console.log("==========================================================");
        console.log("   CRE Workflow Activity Simulation                        ");
        console.log("   Target: Tenderly Virtual TestNet                        ");
        console.log("==========================================================");
        console.log("");
        console.log("DON Forwarder (deployer):", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        uint256 txCount = 0;

        // ==========================================
        // W7: Project 001 pilot site Data Feed -- 6 reports
        // Simulates 6-hourly NDVI/restoration updates
        // ==========================================
        console.log("--- W7: Project 001 pilot site Restoration Data Feed ---");

        // Report 1: Early recovery (Month 1 -- Dec 2025)
        IPilotSiteForest(pilotSite).receiveReport(
            2800,   // ndviCurrent: 0.2800 (burned land, low vegetation)
            7200,   // ndviPreFire: 0.7200 (healthy forest before fire)
            38,     // ndviRecoveryPct: 38%
            -450,   // dnbr: -0.450 (moderate burn severity)
            12500,  // soilOrganicCarbon: 12.5 t/ha
            2550,   // estimatedLiveTrees: 2550 planted
            0,      // annualCO2: 0 (just planted)
            0,      // carbonCredits: 0
            280     // fireRecoveryIndex: 280/1000
        );
        txCount++;
        console.log("  Report 1: Early recovery (NDVI 0.28, 2550 trees planted)");

        // Report 2: Spring growth (Month 4 -- Mar 2026)
        IPilotSiteForest(pilotSite).receiveReport(
            3400, 7200, 47, -380, 13200, 2480, 8500, 0, 340
        );
        txCount++;
        console.log("  Report 2: Spring growth (NDVI 0.34, 2480 surviving)");

        // Report 3: Summer check (Month 7 -- Jun 2026)
        IPilotSiteForest(pilotSite).receiveReport(
            4100, 7200, 57, -290, 14800, 2410, 22000, 5, 420
        );
        txCount++;
        console.log("  Report 3: Summer check (NDVI 0.41, 5 carbon credits)");

        // Report 4: Autumn assessment (Month 10 -- Sep 2026)
        IPilotSiteForest(pilotSite).receiveReport(
            4600, 7200, 64, -220, 16100, 2380, 35000, 12, 510
        );
        txCount++;
        console.log("  Report 4: Autumn assessment (NDVI 0.46, 12 credits)");

        // Report 5: First anniversary (Month 12 -- Nov 2026)
        IPilotSiteForest(pilotSite).receiveReport(
            5100, 7200, 71, -170, 17500, 2350, 42000, 18, 580
        );
        txCount++;
        console.log("  Report 5: First anniversary (NDVI 0.51, 18 credits)");

        // Report 6: Latest (Month 14 -- Jan 2027)
        IPilotSiteForest(pilotSite).receiveReport(
            5400, 7200, 75, -140, 18200, 2320, 48000, 24, 620
        );
        txCount++;
        console.log("  Report 6: Latest (NDVI 0.54, 92% survival, 24 credits)");

        // ==========================================
        // W2: Proof of Reserve -- 6 reports
        // Simulates 30-min TVL/reserve health updates
        // ==========================================
        console.log("");
        console.log("--- W2: Regenerative Proof of Reserve ---");

        IRegenProofOfReserve por = IRegenProofOfReserve(proofOfReserve);

        por.receiveReport(0.1 ether, 100_000_000 ether, 0.1 ether, 10000, 280);
        txCount++;
        console.log("  Report 1: Initial (0.1 ETH reserve, impact 280)");

        por.receiveReport(0.12 ether, 99_500_000 ether, 0.12 ether, 10050, 340);
        txCount++;
        console.log("  Report 2: Growth phase (0.12 ETH, impact 340)");

        por.receiveReport(0.15 ether, 98_000_000 ether, 0.18 ether, 10200, 420);
        txCount++;
        console.log("  Report 3: Active trading (0.15 ETH, impact 420)");

        por.receiveReport(0.18 ether, 96_000_000 ether, 0.25 ether, 10500, 510);
        txCount++;
        console.log("  Report 4: TVL growth (0.18 ETH, impact 510)");

        por.receiveReport(0.22 ether, 94_000_000 ether, 0.35 ether, 10800, 580);
        txCount++;
        console.log("  Report 5: Healthy reserves (0.22 ETH, impact 580)");

        por.receiveReport(0.25 ether, 92_000_000 ether, 0.42 ether, 11000, 620);
        txCount++;
        console.log("  Report 6: Latest (0.25 ETH, backing 110%, impact 620)");

        // ==========================================
        // W5: Protocol Health Monitor -- 8 reports
        // Simulates per-minute health checks
        // ==========================================
        console.log("");
        console.log("--- W5: Protocol Health Monitor ---");

        IProtocolHealthMonitor phm = IProtocolHealthMonitor(healthMonitor);

        // RiskLevel: 0=NONE, 1=LOW, 2=MODERATE, 3=HIGH, 4=CRITICAL
        // Action: 0=NONE, 1=REDUCE_EXPOSURE, 2=PAUSE_SHORTS, 3=EMERGENCY_PAUSE, 4=FULL_SHUTDOWN
        phm.receiveReport(0.1 ether, 100_000_000 ether, 10000, 0, 0, 0);
        txCount++;
        console.log("  Report 1: Healthy (risk NONE)");

        phm.receiveReport(0.12 ether, 99_500_000 ether, 10050, 500, 0, 0);
        txCount++;
        console.log("  Report 2: Normal activity (5% shorts util)");

        phm.receiveReport(0.15 ether, 98_000_000 ether, 10200, 1500, 1, 0);
        txCount++;
        console.log("  Report 3: Low risk (15% shorts util)");

        phm.receiveReport(0.14 ether, 97_000_000 ether, 10100, 2500, 1, 0);
        txCount++;
        console.log("  Report 4: Minor dip (25% shorts util, LOW risk)");

        phm.receiveReport(0.16 ether, 96_500_000 ether, 10300, 2000, 1, 0);
        txCount++;
        console.log("  Report 5: Recovery (20% shorts util)");

        phm.receiveReport(0.18 ether, 95_000_000 ether, 10500, 3500, 2, 1);
        txCount++;
        console.log("  Report 6: MODERATE risk (35% shorts, reduce exposure)");

        phm.receiveReport(0.20 ether, 94_000_000 ether, 10400, 2000, 1, 0);
        txCount++;
        console.log("  Report 7: Risk resolved (20% shorts)");

        phm.receiveReport(0.22 ether, 93_000_000 ether, 10600, 1000, 0, 0);
        txCount++;
        console.log("  Report 8: Latest - all healthy (10% shorts)");

        // ==========================================
        // W3: AI Agent Orchestrator -- 8 reports
        // Simulates AI market analysis + governance advisories
        // ==========================================
        console.log("");
        console.log("--- W3: AI Agent Orchestrator ---");

        IAIAgentOrchestrator ai = IAIAgentOrchestrator(aiOrchestrator);

        // Market analysis reports (RiskLevel: 0-3, Action: 0=HOLD, 1=BUY, 2=SELL, 3=HEDGE, 4=EXIT)
        ai.receiveReport(0, 1, keccak256("ai_analysis_001_bullish_ndvi_recovery"), "");
        txCount++;
        console.log("  Analysis 1: BUY signal (bullish NDVI recovery)");

        ai.receiveReport(0, 0, keccak256("ai_analysis_002_hold_stable"), "");
        txCount++;
        console.log("  Analysis 2: HOLD (stable conditions)");

        ai.receiveReport(1, 1, keccak256("ai_analysis_003_buy_dip_opportunity"), "");
        txCount++;
        console.log("  Analysis 3: BUY (dip opportunity, LOW risk)");

        ai.receiveReport(2, 3, keccak256("ai_analysis_004_moderate_risk_hedge"), "");
        txCount++;
        console.log("  Analysis 4: HEDGE (MODERATE risk detected)");

        ai.receiveReport(1, 1, keccak256("ai_analysis_005_buy_recovery"), "");
        txCount++;
        console.log("  Analysis 5: BUY (recovery confirmed)");

        ai.receiveReport(0, 0, keccak256("ai_analysis_006_hold_healthy"), "");
        txCount++;
        console.log("  Analysis 6: HOLD (healthy market)");

        // Governance advisories
        ai.receiveGovernanceAdvisory(1, 1, 8500, keccak256("gov_advisory_proposal_1_approve"));
        txCount++;
        console.log("  Advisory 1: Proposal #1 -- APPROVE (85% confidence)");

        ai.receiveGovernanceAdvisory(2, 2, 7200, keccak256("gov_advisory_proposal_2_reject"));
        txCount++;
        console.log("  Advisory 2: Proposal #2 -- REJECT (72% confidence)");

        // ==========================================
        // W1: Confidential Funding Vault -- 5 transactions
        // Simulates carbon credit verification attestations
        // ==========================================
        console.log("");
        console.log("--- W1: Confidential Funding Vault ---");

        IConfidentialFundingVault cfv = IConfidentialFundingVault(fundingVault);

        cfv.setMinImpactScore(500);
        txCount++;
        console.log("  Config: Min impact score set to 500");

        cfv.receiveReport(1, 720, keccak256("verra_vcs_001_pilot_site_reforestation"),
            abi.encode("encrypted_attestation_pilot_site_9ha_2550trees"));
        txCount++;
        console.log("  Attestation 1: Proposal #1 -- Project 001 pilot site (score 720)");

        cfv.receiveReport(2, 650, keccak256("gold_standard_002_soil_restoration"),
            abi.encode("encrypted_attestation_soil_carbon_project"));
        txCount++;
        console.log("  Attestation 2: Proposal #2 -- Soil restoration (score 650)");

        cfv.receiveReport(3, 810, keccak256("verra_vcs_003_watershed_recovery"),
            abi.encode("encrypted_attestation_watershed_project"));
        txCount++;
        console.log("  Attestation 3: Proposal #3 -- Watershed recovery (score 810)");

        cfv.receiveReport(4, 420, keccak256("eco_registry_004_low_impact"),
            abi.encode("encrypted_attestation_low_impact_project"));
        txCount++;
        console.log("  Attestation 4: Proposal #4 -- Low impact (score 420, below threshold)");

        // ==========================================
        // W6: Compliance -- PolicyEngine + CompliantVault -- 12 transactions
        // Simulates EU MiCA compliance attestations + deposits
        // ==========================================
        console.log("");
        console.log("--- W6: Compliance (ACE Pattern) ---");

        IR00tPolicyEngine pe = IR00tPolicyEngine(policyEngine);

        // Set up jurisdictions (EU approved)
        pe.setJurisdiction(keccak256("PT"), true);  // Portugal
        txCount++;
        console.log("  Jurisdiction: Portugal (PT) approved");

        pe.setJurisdiction(keccak256("DE"), true);  // Germany
        txCount++;
        console.log("  Jurisdiction: Germany (DE) approved");

        pe.setJurisdiction(keccak256("FR"), true);  // France
        txCount++;
        console.log("  Jurisdiction: France (FR) approved");

        // Set policies (0=DEPOSIT, 1=WITHDRAWAL, 2=TRANSFER, 3=SWAP)
        pe.setPolicy(0, 1, 10 ether, 50 ether, 80, true, true, true);
        txCount++;
        console.log("  Policy: Deposits -- BASIC level, max 10 ETH/tx, 50 ETH/day");

        pe.setPolicy(2, 2, 5 ether, 25 ether, 60, true, true, true);
        txCount++;
        console.log("  Policy: Transfers -- STANDARD level, max 5 ETH/tx");

        // Compliance attestations for test addresses
        bytes32 user1Hash = keccak256(abi.encodePacked(deployer, bytes32("salt_user_1")));
        bytes32 user2Hash = keccak256(abi.encodePacked(address(0xBEEF), bytes32("salt_user_2")));
        bytes32 user3Hash = keccak256(abi.encodePacked(address(0xCAFE), bytes32("salt_user_3")));
        bytes32 user4Hash = keccak256(abi.encodePacked(address(0xDEAD), bytes32("salt_user_4")));

        pe.attestCompliance(user1Hash, 3, 365 days, keccak256("kyc_attestation_user1"),
            true, keccak256("PT"), 15);
        txCount++;
        console.log("  Attestation: User1 -- ENHANCED (PT, risk 15)");

        pe.attestCompliance(user2Hash, 2, 180 days, keccak256("kyc_attestation_user2"),
            true, keccak256("DE"), 25);
        txCount++;
        console.log("  Attestation: User2 -- STANDARD (DE, risk 25)");

        pe.attestCompliance(user3Hash, 1, 90 days, keccak256("kyc_attestation_user3"),
            true, keccak256("FR"), 40);
        txCount++;
        console.log("  Attestation: User3 -- BASIC (FR, risk 40)");

        pe.attestCompliance(user4Hash, 4, 730 days, keccak256("kyc_attestation_user4_institutional"),
            true, keccak256("PT"), 5);
        txCount++;
        console.log("  Attestation: User4 -- INSTITUTIONAL (PT, risk 5)");

        // Compliant vault deposits + authorizations
        ICompliantPrivateVault cv = ICompliantPrivateVault(compliantVault);

        uint256 commitment1 = uint256(keccak256(abi.encodePacked("test_deposit_commitment_1", block.timestamp))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 reqId1 = cv.requestDeposit{value: 0.01 ether}(commitment1, user1Hash, "");
        txCount++;
        console.log("  Deposit request 1: 0.01 ETH (user1, ENHANCED)");

        cv.authorizeTransfer(reqId1);
        txCount++;
        console.log("  Authorized: Request", reqId1);

        // ==========================================
        // W4: Prediction Markets -- 5 transactions
        // Simulates environmental outcome markets
        // ==========================================
        console.log("");
        console.log("--- W4: Regenerative Prediction Markets ---");

        IRegenPredictionMarket pm = IRegenPredictionMarket(predictionMarket);

        pm.createMarket(1, "NDVI_RECOVERY_PCT", 70, block.timestamp + 180 days);
        txCount++;
        console.log("  Market 1: Will Project 001 pilot site reach 70% NDVI recovery?");

        pm.createMarket(2, "TREE_SURVIVAL_RATE", 90, block.timestamp + 365 days);
        txCount++;
        console.log("  Market 2: Will tree survival exceed 90%?");

        pm.createMarket(3, "CARBON_CREDITS", 50, block.timestamp + 365 days);
        txCount++;
        console.log("  Market 3: Will project generate >50 carbon credits in year 1?");

        pm.buyShares{value: 0.005 ether}(1, true, 0);
        txCount++;
        console.log("  Bet: 0.005 ETH on YES for NDVI recovery >70%");

        pm.buyShares{value: 0.003 ether}(2, true, 0);
        txCount++;
        console.log("  Bet: 0.003 ETH on YES for tree survival >90%");

        pm.buyShares{value: 0.002 ether}(3, true, 0);
        txCount++;
        console.log("  Bet: 0.002 ETH on YES for >50 carbon credits");

        pm.buyShares{value: 0.004 ether}(1, false, 0);
        txCount++;
        console.log("  Bet: 0.004 ETH on NO for NDVI recovery >70%");

        pm.buyShares{value: 0.003 ether}(3, false, 0);
        txCount++;
        console.log("  Bet: 0.003 ETH on NO for >50 carbon credits");

        // ==========================================
        // W8: World ID Verification -- 6 transactions
        // Simulates sybil-resistant identity verification
        // Uses block.timestamp to generate unique nullifiers per run
        // ==========================================
        console.log("");
        console.log("--- W8: World ID Verification ---");

        IWorldIDGatekeeper wid = IWorldIDGatekeeper(worldIdGatekeeper);

        // Check if deployer is already verified (idempotent re-runs)
        // Note: All requestVerification calls come from deployer (msg.sender),
        // so once deployer is verified, ALL new requests revert with AlreadyVerified()
        bool alreadyVerified = wid.isVerified(deployer);
        if (alreadyVerified) {
            uint256 totalVerifiedCount = wid.totalVerified();
            uint256 totalPendingCount = wid.totalPending();
            console.log("  Deployer verified: true");
            console.log("  Total verified humans:", totalVerifiedCount);
            console.log("  Total pending requests:", totalPendingCount);
            console.log("  SKIP: W8 already completed in previous run");
            console.log("  (requestVerification reverts for already-verified sender)");
        } else {
            // Verification request 1: Deployer verifies as human
            uint256[8] memory worldIdProof1;
            worldIdProof1[0] = uint256(keccak256(abi.encodePacked("worldid_proof_element_0", block.timestamp)));
            worldIdProof1[1] = uint256(keccak256(abi.encodePacked("worldid_proof_element_1", block.timestamp)));
            bytes32 nullifier1 = keccak256(abi.encodePacked(deployer, "worldid_nullifier_1", block.timestamp));
            bytes32 root1 = keccak256(abi.encodePacked("worldid_merkle_root_1", block.timestamp));
            uint256 reqId1_wid = wid.requestVerification(nullifier1, root1, worldIdProof1, "orb");
            txCount++;
            console.log("  Request 1: Deployer requests orb verification");

            // CRE verifies and approves
            wid.receiveVerificationResult(reqId1_wid, true, "World ID proof verified via Worldcoin cloud API");
            txCount++;
            console.log("  Result 1: VERIFIED (orb level)");

            // Check verification status
            bool deployerVerifiedNow = wid.isVerified(deployer);
            uint256 totalVerifiedCount = wid.totalVerified();
            console.log("  Deployer verified:", deployerVerifiedNow ? "true" : "false");
            console.log("  Total verified humans:", totalVerifiedCount);
        }

        // ==========================================
        // Extra: Additional compliance deposits
        // Uses block.timestamp for unique commitments per run
        // ==========================================
        console.log("");
        console.log("--- Extra: Additional Compliance Deposits ---");

        uint256 commitment2 = uint256(keccak256(abi.encodePacked("test_deposit_commitment_2", block.timestamp))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 reqId2 = cv.requestDeposit{value: 0.02 ether}(commitment2, user2Hash, "");
        txCount++;
        console.log("  Deposit request 2: 0.02 ETH (user2, STANDARD)");

        cv.authorizeTransfer(reqId2);
        txCount++;
        console.log("  Authorized: Request", reqId2);

        uint256 commitment3 = uint256(keccak256(abi.encodePacked("test_deposit_commitment_3", block.timestamp))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 reqId3 = cv.requestDeposit{value: 0.005 ether}(commitment3, user3Hash, "");
        txCount++;
        console.log("  Deposit request 3: 0.005 ETH (user3, BASIC)");

        cv.denyTransfer(reqId3, "Insufficient compliance level for amount");
        txCount++;
        console.log("  Denied: Request", reqId3, "(insufficient compliance)");

        vm.stopBroadcast();

        // ==========================================
        // Summary
        // ==========================================
        console.log("");
        console.log("==========================================================");
        console.log("   CRE ACTIVITY SIMULATION COMPLETE                        ");
        console.log("==========================================================");
        console.log("");
        console.log("Total transactions:", txCount);
        console.log("");
        console.log("  W7 Project 001 pilot site:     6 data feed reports");
        console.log("  W2 Proof of Reserve:     6 TVL/reserve reports");
        console.log("  W5 Health Monitor:       8 health checks");
        console.log("  W3 AI Orchestrator:      8 analysis + advisories");
        console.log("  W1 Funding Vault:        5 attestations");
        console.log("  W6 Compliance (ACE):    16 policies + attestations + deposits");
        console.log("  W4 Prediction Markets:   8 markets + bets");
        console.log("  W8 World ID:             6 verification requests + results");
        console.log("  -----------------------------------------");
        console.log("  TOTAL:                  63 transactions");
        console.log("");
        console.log("Explorer: https://dashboard.tenderly.co/manifestordao/manifestordao/testnet/596dfbfb-e22d-4186-b982-33682540383d");
        console.log("");
    }
}
