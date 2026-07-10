// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/verifiers/TestPledgeVerifier.sol";
import "../src/verifiers/TestVoteVerifier.sol";
import "../src/verifiers/RealPledgeVerifier.sol";
import "../src/verifiers/RealVoteVerifier.sol";

/// @title SimulateGovernance
/// @notice Full governance lifecycle on Tenderly VNet: create proposals, vote, execute
/// @dev Uses timelock pattern to swap in test verifiers (initial setup phase expired)
///
/// Usage (4 steps):
///   # Step 1: Deploy test verifiers + propose swap (starts 1-min timelock)
///   forge script script/SimulateGovernance.s.sol --sig "step1_ProposeVerifiers()" \
///     --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow
///
///   # Step 2: Advance time 61s + accept + create proposals + vote
///   curl -sX POST $TENDERLY_VIRTUAL_TESTNET_RPC -H "Content-Type: application/json" \
///     -d '{"jsonrpc":"2.0","method":"evm_increaseTime","params":["0x3D"],"id":1}'
///   curl -sX POST $TENDERLY_VIRTUAL_TESTNET_RPC -H "Content-Type: application/json" \
///     -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'
///   forge script script/SimulateGovernance.s.sol --sig "step2_CreateAndVote()" \
///     --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow
///
///   # Step 3: Advance time past voting period (10 min = 601s)
///   curl -sX POST $TENDERLY_VIRTUAL_TESTNET_RPC -H "Content-Type: application/json" \
///     -d '{"jsonrpc":"2.0","method":"evm_increaseTime","params":["0x259"],"id":1}'
///   curl -sX POST $TENDERLY_VIRTUAL_TESTNET_RPC -H "Content-Type: application/json" \
///     -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'
///
///   # Step 4: Execute proposals + propose real verifiers restore
///   forge script script/SimulateGovernance.s.sol --sig "step3_Execute()" \
///     --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow

interface ILaunchpadGovernance {
    struct ProposalParams {
        string name;
        string symbol;
        bytes32 metadataHash;
        uint256 totalSupply;
        uint256 feeBps;
        uint256 deployerBps;
    }

    function createProposal(
        ProposalParams calldata params,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 pledgeAmount,
        uint256 publicInputsBinding
    ) external returns (uint256);

    function votePrivate(
        uint256 proposalId,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 voteWeight,
        bool support
    ) external;

    function executeProposal(uint256 proposalId) external;
    function finalizeRejected(uint256 proposalId) external;

    function proposePledgeVerifier(address v) external;
    function acceptPledgeVerifier() external;
    function proposeVoteVerifier(address v) external;
    function acceptVoteVerifier() external;

    function proposalCount() external view returns (uint256);
    function pendingPledgeVerifier() external view returns (address);
    function pendingVoteVerifier() external view returns (address);

    function proposals(uint256 id) external view returns (
        address creator,
        uint256 pledgedR00t,
        string memory name,
        string memory symbol,
        bytes32 metadataHash,
        uint256 totalSupply,
        uint256 feeBps,
        uint256 deployerBps,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 votingEnds,
        uint8 status,
        address ammAddress,
        address tokenAddress,
        uint256 createdAt
    );
}

interface ITokenPool {
    function root() external view returns (uint256);
}

contract SimulateGovernanceScript is Script {
    uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant MIN_PLEDGE = 100 * 1e18;

    // ==========================================
    // Step 1: Deploy test verifiers + propose swap
    // ==========================================
    function step1_ProposeVerifiers() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address launchpadAddr = vm.envAddress("LAUNCHPAD_GOVERNANCE_ADDRESS");
        ILaunchpadGovernance launchpad = ILaunchpadGovernance(launchpadAddr);

        console.log("");
        console.log("=== Step 1: Propose Test Verifiers ===");

        vm.startBroadcast(deployerPrivateKey);

        TestPledgeVerifier testPledge = new TestPledgeVerifier();
        console.log("  TestPledgeVerifier deployed:", address(testPledge));

        TestVoteVerifier testVote = new TestVoteVerifier();
        console.log("  TestVoteVerifier deployed:", address(testVote));

        launchpad.proposePledgeVerifier(address(testPledge));
        console.log("  Proposed pledge verifier swap (1-min timelock)");

        launchpad.proposeVoteVerifier(address(testVote));
        console.log("  Proposed vote verifier swap (1-min timelock)");

        vm.stopBroadcast();

        console.log("");
        console.log("  Next: advance time 61s, then run step2_CreateAndVote()");
    }

    // ==========================================
    // Step 2: Accept verifiers + create proposals + vote
    // ==========================================
    function step2_CreateAndVote() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address launchpadAddr = vm.envAddress("LAUNCHPAD_GOVERNANCE_ADDRESS");
        address tokenPoolAddr = vm.envAddress("TOKEN_POOL_ADDRESS");

        ILaunchpadGovernance launchpad = ILaunchpadGovernance(launchpadAddr);
        ITokenPool tokenPool = ITokenPool(tokenPoolAddr);

        console.log("");
        console.log("==========================================================");
        console.log("   Governance Lifecycle Simulation                         ");
        console.log("   Step 2: Accept Verifiers + Create Proposals + Vote     ");
        console.log("==========================================================");
        console.log("");

        uint256 currentRoot = tokenPool.root();
        console.log("Deployer:", deployer);
        console.log("TokenPool root:", currentRoot);

        uint256 txCount = 0;

        vm.startBroadcast(deployerPrivateKey);

        // Accept test verifiers (timelock expired)
        console.log("");
        console.log("--- Accepting Test Verifiers ---");

        launchpad.acceptPledgeVerifier();
        txCount++;
        console.log("  Pledge verifier: test (accepts all proofs)");

        launchpad.acceptVoteVerifier();
        txCount++;
        console.log("  Vote verifier: test (accepts all proofs)");

        // ==========================================
        // Proposal 1: Project 001 pilot site 9ha Regeneration
        // ==========================================
        console.log("");
        console.log("--- Proposal: Project 001 pilot site 9ha Regeneration ---");
        console.log("  Regenerating 9 hectares of burned native forest");
        console.log("  the pilot site, Portugal");
        console.log("  2550 native trees (oak, chestnut, birch)");
        console.log("  NDVI satellite monitoring via Chainlink CRE");

        uint256[8] memory dummyProof;
        uint256 nullifier1 = uint256(keccak256(abi.encodePacked("pilot_site_pledge", block.timestamp))) % SNARK_SCALAR_FIELD;
        uint256 binding1 = uint256(keccak256(abi.encodePacked("pilot_site_bind", block.timestamp))) % SNARK_SCALAR_FIELD;

        uint256 pid1 = launchpad.createProposal(
            ILaunchpadGovernance.ProposalParams({
                name: "Pilot Site Native Forest",
                symbol: "PILOT",
                metadataHash: keccak256(abi.encodePacked(
                    "ipfs://QmPilotSite9haRegeneration|",
                    "Regenerating 9 hectares of burned native forest in the pilot site, Portugal. ",
                    "2550 native trees planted. NDVI satellite monitoring via Chainlink CRE. ",
                    "Carbon credits via Verra VCS. Fire recovery index tracked on-chain."
                )),
                totalSupply: 1_000_000 * 1e18,
                feeBps: 100,
                deployerBps: 300
            }),
            dummyProof,
            currentRoot,
            nullifier1,
            MIN_PLEDGE,
            binding1
        );
        txCount++;
        console.log("  CREATED: Proposal", pid1);
        console.log("    Token: PILOT (1,000,000 supply)");
        console.log("    Pledge: 100 R00T");
        console.log("    Fee: 1% | Deployer: 3%");

        // ==========================================
        // Proposal 2: Douro Valley Watershed Recovery
        // ==========================================
        console.log("");
        console.log("--- Proposal: Douro Valley Watershed Recovery ---");

        uint256 nullifier2 = uint256(keccak256(abi.encodePacked("douro_valley_pledge", block.timestamp))) % SNARK_SCALAR_FIELD;
        uint256 binding2 = uint256(keccak256(abi.encodePacked("douro_valley_bind", block.timestamp))) % SNARK_SCALAR_FIELD;

        uint256 pid2 = launchpad.createProposal(
            ILaunchpadGovernance.ProposalParams({
                name: "Douro Valley Watershed",
                symbol: "DOURO",
                metadataHash: keccak256(abi.encodePacked(
                    "ipfs://QmDouroValleyWatershed|",
                    "Restoring 15km of riparian corridors along the Douro River tributaries. ",
                    "Native species reintroduction, erosion control, water quality monitoring."
                )),
                totalSupply: 500_000 * 1e18,
                feeBps: 150,
                deployerBps: 250
            }),
            dummyProof,
            currentRoot,
            nullifier2,
            200 * 1e18,
            binding2
        );
        txCount++;
        console.log("  CREATED: Proposal", pid2);
        console.log("    Token: DOURO (500,000 supply)");

        // ==========================================
        // Proposal 3: Algarve Coastal Rewilding (will fail quorum)
        // ==========================================
        console.log("");
        console.log("--- Proposal: Algarve Coastal Rewilding ---");

        uint256 nullifier3 = uint256(keccak256(abi.encodePacked("algarve_pledge", block.timestamp))) % SNARK_SCALAR_FIELD;
        uint256 binding3 = uint256(keccak256(abi.encodePacked("algarve_bind", block.timestamp))) % SNARK_SCALAR_FIELD;

        uint256 pid3 = launchpad.createProposal(
            ILaunchpadGovernance.ProposalParams({
                name: "Algarve Coastal Rewilding",
                symbol: "ALGARVE",
                metadataHash: keccak256(abi.encodePacked(
                    "ipfs://QmAlgarveCoastalRewilding|",
                    "Rewilding 25 hectares of degraded coastal land in the Algarve. ",
                    "Mediterranean scrubland restoration, pollinator corridors, fire resilience."
                )),
                totalSupply: 750_000 * 1e18,
                feeBps: 100,
                deployerBps: 200
            }),
            dummyProof,
            currentRoot,
            nullifier3,
            150 * 1e18,
            binding3
        );
        txCount++;
        console.log("  CREATED: Proposal", pid3);
        console.log("    Token: ALGARVE (750,000 supply)");

        // ==========================================
        // Voting
        // ==========================================
        console.log("");
        console.log("--- Voting ---");

        // Project 001 pilot site: 1.3M FOR / 200K AGAINST → PASSES
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p1_for_1", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid1, dummyProof, currentRoot, vn, 800_000 * 1e18, true);
            txCount++;
            console.log("  Pilot: 800,000 FOR");
        }
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p1_for_2", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid1, dummyProof, currentRoot, vn, 500_000 * 1e18, true);
            txCount++;
            console.log("  Pilot: 500,000 FOR");
        }
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p1_no_1", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid1, dummyProof, currentRoot, vn, 200_000 * 1e18, false);
            txCount++;
            console.log("  Pilot: 200,000 AGAINST");
        }

        // Douro Valley: 1.3M FOR / 400K AGAINST → PASSES
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p2_for_1", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid2, dummyProof, currentRoot, vn, 600_000 * 1e18, true);
            txCount++;
            console.log("  Douro: 600,000 FOR");
        }
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p2_for_2", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid2, dummyProof, currentRoot, vn, 700_000 * 1e18, true);
            txCount++;
            console.log("  Douro: 700,000 FOR");
        }
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p2_no_1", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid2, dummyProof, currentRoot, vn, 400_000 * 1e18, false);
            txCount++;
            console.log("  Douro: 400,000 AGAINST");
        }

        // Algarve: 300K FOR / 100K AGAINST → FAILS (below 1M quorum)
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p3_for_1", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid3, dummyProof, currentRoot, vn, 300_000 * 1e18, true);
            txCount++;
            console.log("  Algarve: 300,000 FOR (below quorum)");
        }
        {
            uint256 vn = uint256(keccak256(abi.encodePacked("v_p3_no_1", block.timestamp))) % SNARK_SCALAR_FIELD;
            launchpad.votePrivate(pid3, dummyProof, currentRoot, vn, 100_000 * 1e18, false);
            txCount++;
            console.log("  Algarve: 100,000 AGAINST (below quorum)");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("==========================================================");
        console.log("  Step 2 Complete:", txCount, "transactions");
        console.log("==========================================================");
        console.log("");
        console.log("  Proposal", pid1, ": Project 001 pilot site  -- 1.3M FOR / 200K AGAINST (PASSES)");
        console.log("  Proposal", pid2, ": Douro Valley      -- 1.3M FOR / 400K AGAINST (PASSES)");
        console.log("  Proposal", pid3, ": Algarve Coastal   -- 300K FOR / 100K AGAINST (FAILS)");
        console.log("");
        console.log("  Next: advance time 601s, then run step3_Execute()");
    }

    // ==========================================
    // Step 3: Execute proposals + restore verifiers
    // ==========================================
    function step3_Execute() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address launchpadAddr = vm.envAddress("LAUNCHPAD_GOVERNANCE_ADDRESS");
        ILaunchpadGovernance launchpad = ILaunchpadGovernance(launchpadAddr);

        console.log("");
        console.log("==========================================================");
        console.log("   Step 3: Execute Proposals + Restore Verifiers           ");
        console.log("==========================================================");

        uint256 proposalCount = launchpad.proposalCount();
        console.log("Total proposals:", proposalCount);

        uint256 txCount = 0;

        vm.startBroadcast(deployerPrivateKey);

        // Execute Proposal 0 (Project 001 pilot site)
        console.log("");
        console.log("--- Executing Proposal 0: Project 001 pilot site ---");
        try launchpad.executeProposal(0) {
            txCount++;
            console.log("  EXECUTED: PILOT token deployed");
        } catch {
            console.log("  SKIP: already executed or failed");
        }

        // Execute Proposal 1 (Douro Valley)
        console.log("");
        console.log("--- Executing Proposal 1: Douro Valley ---");
        try launchpad.executeProposal(1) {
            txCount++;
            console.log("  EXECUTED: DOURO token deployed");
        } catch {
            console.log("  SKIP: already executed or failed");
        }

        // Reject Proposal 2 (Algarve — below quorum)
        console.log("");
        console.log("--- Rejecting Proposal 2: Algarve (below quorum) ---");
        try launchpad.finalizeRejected(2) {
            txCount++;
            console.log("  REJECTED: Algarve Coastal (insufficient quorum)");
        } catch {
            console.log("  SKIP: already finalized or failed");
        }

        // Restore real verifiers via timelock proposal
        console.log("");
        console.log("--- Proposing Real Verifier Restoration ---");

        RealPledgeVerifier realPledge = new RealPledgeVerifier();
        txCount++;
        launchpad.proposePledgeVerifier(address(realPledge));
        txCount++;
        console.log("  Proposed RealPledgeVerifier:", address(realPledge));

        RealVoteVerifier realVote = new RealVoteVerifier();
        txCount++;
        launchpad.proposeVoteVerifier(address(realVote));
        txCount++;
        console.log("  Proposed RealVoteVerifier:", address(realVote));
        console.log("  (Accept after 1-min timelock to restore production verifiers)");

        vm.stopBroadcast();

        // Display final state
        console.log("");
        console.log("==========================================================");
        console.log("  Step 3 Complete:", txCount, "transactions");
        console.log("==========================================================");

        for (uint256 i = 0; i < proposalCount; i++) {
            (,, string memory name, string memory symbol,,,,, uint256 votesFor, uint256 votesAgainst,,
             uint8 status,, address tokenAddress,) = launchpad.proposals(i);

            string memory statusStr = status == 4 ? "EXECUTED" : status == 2 ? "REJECTED" : "ACTIVE";

            console.log("");
            console.log("  Proposal", i, ":", name);
            console.log("    Symbol:", symbol);
            console.log("    Status:", statusStr);
            console.log("    Votes FOR:", votesFor / 1e18);
            console.log("    Votes AGAINST:", votesAgainst / 1e18);
            if (tokenAddress != address(0)) {
                console.log("    Token:", tokenAddress);
            }
        }

        console.log("");
        console.log("  To restore real verifiers: advance 61s + run step4_RestoreVerifiers()");
    }

    // ==========================================
    // Step 4 (optional): Accept real verifier restoration
    // ==========================================
    function step4_RestoreVerifiers() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address launchpadAddr = vm.envAddress("LAUNCHPAD_GOVERNANCE_ADDRESS");
        ILaunchpadGovernance launchpad = ILaunchpadGovernance(launchpadAddr);

        console.log("=== Restoring Real Verifiers ===");

        vm.startBroadcast(deployerPrivateKey);
        launchpad.acceptPledgeVerifier();
        console.log("  RealPledgeVerifier accepted");
        launchpad.acceptVoteVerifier();
        console.log("  RealVoteVerifier accepted");
        vm.stopBroadcast();

        console.log("  Verifiers restored to production (real ZK proofs required)");
    }
}
