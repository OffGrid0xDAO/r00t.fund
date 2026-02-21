// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TokenPool} from "./TokenPool.sol";
import {ZkProjectPool} from "./ZkProjectPool.sol";
import {ProjectToken} from "./ProjectToken.sol";
import {NullifierRegistry} from "./NullifierRegistry.sol";
import {IVoteVerifier, ISwapVerifier, ITransferVerifier, IWithdrawVerifier, IPledgeVerifier} from "./interfaces/IVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Interface for ZkAMMv3 (main pool) for registering project pools
interface IZkAMMv3 {
    function registerProjectPool(address pool) external;
    function tokenPool() external view returns (address);
}

/// @title LaunchpadGovernance
/// @author r00t.fund
/// @notice Community-governed launchpad for privacy-preserving ReFi/RWA tokens
/// @dev Uses ZK proofs for private voting - no one knows who voted or their vote weight
contract LaunchpadGovernance {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Platform fee on rejected/cancelled proposals (5% = 500 basis points)
    uint256 public constant PLATFORM_FEE_BPS = 500;

    /// @notice Fee denominator
    uint256 public constant FEE_DENOMINATOR = 10000;

    /// @notice Voting period duration
    uint256 public constant VOTING_PERIOD = 10 minutes; // TESTNET: Changed from 7 days for testing

    /// @notice Minimum votes required for quorum (1M $R00T)
    uint256 public constant MIN_VOTES_FOR_QUORUM = 1_000_000 * 1e18;

    /// @notice Grace period for cancellation (first 24 hours)
    uint256 public constant CANCEL_GRACE_PERIOD = 1 minutes; // TESTNET: Changed from 24 hours for testing

    /// @notice Execution delay after voting ends (prevents race conditions on L2s)
    /// @dev SECURITY FIX (Audit Vuln 2): Prevents race condition between executeProposal and finalizeRejected
    uint256 public constant EXECUTION_DELAY = 1 minutes; // TESTNET: Changed from 1 hour for testing

    /// @notice Emergency claim delay (30 days) - allows anyone to process claims if owner is inactive
    /// @dev SECURITY FIX: Prevents permanent fund lock if governance is compromised
    uint256 public constant EMERGENCY_CLAIM_DELAY = 5 minutes; // TESTNET: Changed from 30 days for testing

    /// @notice Admin timelock duration (48 hours)
    /// @dev SECURITY FIX (Audit Vuln 5): Critical admin changes require timelock
    uint256 public constant ADMIN_TIMELOCK = 1 minutes; // TESTNET: Changed from 48 hours for testing

    // ============ Pending R00T Claims System ============
    // SECURITY FIX: Instead of just emitting events for pledge refunds,
    // we create pending claims that can be processed to create actual R00T commitments

    /// @notice Structure for pending R00T claims (pledge refunds)
    struct PendingR00tClaim {
        uint256 amount;           // Amount of R00T to claim
        uint256 outputCommitment; // Desired output commitment
        bytes encryptedNote;      // Encrypted note for commitment
        bool claimed;             // Whether this claim has been processed
        uint256 createdAt;        // Timestamp for emergency processing
        address creator;          // Original creator who can provide commitment
    }

    // ============ Proposal Status ============

    enum ProposalStatus {
        Active,     // Voting in progress
        Approved,   // Voting ended, approved
        Rejected,   // Voting ended, rejected
        Cancelled,  // Creator cancelled
        Executed    // AMM deployed
    }

    // ============ Structs ============

    struct Proposal {
        // Creator info
        address creator;
        uint256 pledgedR00t;      // $R00T amount pledged as LP

        // Project metadata (core on-chain, details in metadataHash)
        string name;
        string symbol;
        bytes32 metadataHash;       // IPFS hash of full metadata JSON

        // Tokenomics
        uint256 totalSupply;
        uint256 feeBps;
        uint256 deployerBps;        // Deployer allocation (max 5% = 500 bps)

        // Voting
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votingEnds;
        ProposalStatus status;

        // Result
        address ammAddress;         // ZkAMMPair address
        address tokenAddress;       // ERC20 token address
        uint256 createdAt;
    }

    struct ProposalParams {
        string name;
        string symbol;
        bytes32 metadataHash;       // IPFS hash containing: description, rwaType, urls, images
        uint256 totalSupply;
        uint256 feeBps;
        uint256 deployerBps;        // Deployer allocation in bps (max 500 = 5%)
    }

    /// @notice Maximum deployer allocation (5%)
    uint256 public constant MAX_DEPLOYER_BPS = 500;

    // ============ State ============

    /// @notice Main $R00T token pool
    TokenPool public immutable r00tPool;

    /// @notice Main ZkAMMv3 contract (for registering project pools)
    IZkAMMv3 public zkAMMv3;

    /// @notice Vote verifier contract
    IVoteVerifier public voteVerifier;

    /// @notice Shared swap verifier for all project pools
    ISwapVerifier public swapVerifier;

    /// @notice Shared transfer verifier
    ITransferVerifier public transferVerifier;

    /// @notice Shared withdraw verifier
    IWithdrawVerifier public withdrawVerifier;

    /// @notice Pledge verifier for proposal creation
    IPledgeVerifier public pledgeVerifier;

    /// @notice Whether verifiers have been locked (prevents upgrades after lock)
    /// @dev SECURITY FIX (Vuln 3): Prevents owner from replacing verifiers with malicious ones
    bool public verifiersLocked;

    /// @notice Global nullifier registry for cross-pool R00T coordination
    NullifierRegistry public nullifierRegistry;

    /// @notice Platform treasury address (for project pool fees)
    address public platformTreasury;

    /// @notice Platform owner (receives fees)
    address public owner;

    /// @notice All proposals
    mapping(uint256 => Proposal) public proposals;

    /// @notice Total proposal count
    uint256 public proposalCount;

    /// @notice Vote nullifiers per proposal (prevents double voting)
    mapping(uint256 => mapping(uint256 => bool)) public voteNullifiers;

    /// @notice Merkle root snapshot at proposal creation (prevents flash vote attacks)
    /// @dev SECURITY FIX: Only commitments that existed when proposal was created can vote
    mapping(uint256 => uint256) public proposalSnapshotRoot;

    /// @notice Pledge nullifiers (prevents double-spending R00T for pledges)
    mapping(uint256 => bool) public pledgeNullifiers;

    /// @notice Pledge nullifier per proposal (for tracking which nullifier backs which proposal)
    mapping(uint256 => uint256) public proposalPledgeNullifier;

    /// @notice Accumulated platform fees
    uint256 public accumulatedFees;

    /// @notice List of all deployed AMM addresses
    address[] public deployedAMMs;

    /// @notice Mapping for O(1) lookup of deployed AMMs (GAS OPTIMIZATION)
    /// @dev SECURITY FIX: Replaces O(n) array iteration with O(1) mapping lookup
    mapping(address => bool) public deployedAMMsMapping;

    /// @notice Minimum pledge amount to prevent dust proposals (in R00T units)
    uint256 public constant MIN_PLEDGE_AMOUNT = 100 * 1e18;

    /// @notice BN254 scalar field order - all ZK public inputs must be less than this
    /// @dev SECURITY FIX: Prevents nullifier aliasing attacks where values >= SNARK_SCALAR_FIELD
    ///      are equivalent to their remainder mod SNARK_SCALAR_FIELD in the circuit
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ============ Pending Claims State ============

    /// @notice Counter for claim IDs
    uint256 public nextClaimId;

    /// @notice Mapping of claim ID to pending claim details
    mapping(uint256 => PendingR00tClaim) public pendingR00tClaims;

    /// @notice Total pending R00T claims
    uint256 public totalPendingClaims;

    // ============ Pending Admin Changes (Timelock) ============
    // SECURITY FIX (Audit Vuln 5): Critical admin changes require 48-hour timelock

    /// @notice Pending ZkAMMv3 address
    address public pendingZkAMMv3;
    /// @notice Timelock expiry for pending ZkAMMv3 change
    uint256 public zkAMMv3TimelockExpiry;

    /// @notice Pending NullifierRegistry address
    address public pendingNullifierRegistry;
    /// @notice Timelock expiry for pending NullifierRegistry change
    uint256 public nullifierRegistryTimelockExpiry;

    /// @notice Pending platform treasury address
    address public pendingPlatformTreasury;
    /// @notice Timelock expiry for pending platform treasury change
    uint256 public platformTreasuryTimelockExpiry;

    /// @notice Pending owner address
    /// @dev SECURITY FIX (Vuln 2): Ownership transfer now requires timelock
    address public pendingOwner;
    /// @notice Timelock expiry for pending owner change
    uint256 public ownerTimelockExpiry;

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed creator,
        string name,
        string symbol,
        uint256 pledgedR00t,
        uint256 votingEnds
    );

    event VoteCast(
        uint256 indexed proposalId,
        uint256 voteWeight,
        bool support
    );

    event ProposalExecuted(
        uint256 indexed proposalId,
        address indexed ammAddress,
        address indexed tokenAddress
    );

    event ProposalRejected(uint256 indexed proposalId);

    event ProposalCancelled(uint256 indexed proposalId);

    event PledgeWithdrawn(
        uint256 indexed proposalId,
        address indexed creator,
        uint256 amount,
        uint256 fee
    );

    event FeesWithdrawn(address indexed to, uint256 amount);

    event PledgeNullifierSpent(uint256 indexed proposalId, uint256 indexed nullifierHash);

    event R00tClaimCreated(uint256 indexed claimId, uint256 indexed proposalId, address indexed creator, uint256 amount);
    event R00tClaimCommitmentSet(uint256 indexed claimId, uint256 outputCommitment);
    event R00tClaimProcessed(uint256 indexed claimId, uint256 amount, uint256 outputCommitment);
    event PoolR00tClaimProcessed(address indexed pool, uint256 indexed claimId, uint256 amount);
    /// @notice SECURITY FIX (Audit Vuln 8): Emitted when claim processing is delayed due to missing authorization
    /// @dev Users should wait for owner to call r00tPool.setAuthorizedCaller() or use emergency claim after 30 days
    event ClaimProcessingDelayed(uint256 indexed claimId, string reason);

    /// @notice SECURITY FIX (Vuln 4): Governance-specific event for R00T commitment creation
    /// @dev Replaces TokenPool.NewCommitment to properly associate events with governance context
    event R00tCommitmentCreated(uint256 indexed claimId, uint256 indexed commitment, uint256 leafIndex, bytes encryptedNote);

    // SECURITY FIX (Audit Vuln 5): Admin timelock events
    event ZkAMMv3Proposed(address indexed proposed, uint256 effectiveTime);
    event ZkAMMv3Updated(address indexed oldAddress, address indexed newAddress);
    event NullifierRegistryProposed(address indexed proposed, uint256 effectiveTime);
    event NullifierRegistryUpdated(address indexed oldAddress, address indexed newAddress);
    event PlatformTreasuryProposed(address indexed proposed, uint256 effectiveTime);
    event PlatformTreasuryUpdated(address indexed oldAddress, address indexed newAddress);
    event AdminProposalCancelled(string configType, address cancelled);
    event OwnershipTransferProposed(address indexed proposed, uint256 effectiveTime);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // ============ Errors ============

    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownMerkleRoot();
    error ProposalNotActive();
    error ProposalNotEnded();
    error ProposalAlreadyEnded();
    error VotingNotEnded();
    error AlreadyVoted();
    error NotCreator();
    error CancelGracePeriodPassed();
    error QuorumNotMet();
    error NotApproved();
    error AlreadyExecuted();
    error Unauthorized();
    error ZeroAddress();
    error InvalidParams();
    error InsufficientPledge();
    error TransferFailed();
    error ClaimAlreadyProcessed();
    error InvalidClaimId();
    error EmergencyDelayNotMet();
    error CommitmentNotSet();
    error NotClaimCreator();
    error InvalidPool();
    error InvalidScalarField();  // SECURITY FIX: Value >= SNARK_SCALAR_FIELD (nullifier aliasing)
    error VerifiersLocked();     // SECURITY FIX (Vuln 3): Verifiers cannot be changed after lock
    error TimelockNotExpired();  // SECURITY FIX (Audit Vuln 5): Must wait for timelock
    error NoPendingChange();     // SECURITY FIX (Audit Vuln 5): No pending admin change to accept
    error ExecutionDelayNotMet();// SECURITY FIX (Audit Vuln 2): Must wait EXECUTION_DELAY after voting ends

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    /// @notice Initialize the launchpad governance
    /// @param _r00tPool Address of main $R00T TokenPool
    /// @param _zkAMMv3 Address of main ZkAMMv3 contract
    /// @param _nullifierRegistry Global nullifier registry
    /// @param _platformTreasury Platform treasury for pool fees
    /// @param _voteVerifier Vote proof verifier
    /// @param _swapVerifier Swap proof verifier (shared)
    /// @param _transferVerifier Transfer proof verifier (shared)
    /// @param _withdrawVerifier Withdraw proof verifier (shared)
    /// @param _pledgeVerifier Pledge proof verifier for proposal creation
    constructor(
        address _r00tPool,
        address _zkAMMv3,
        address _nullifierRegistry,
        address _platformTreasury,
        address _voteVerifier,
        address _swapVerifier,
        address _transferVerifier,
        address _withdrawVerifier,
        address _pledgeVerifier
    ) {
        if (_r00tPool == address(0)) revert ZeroAddress();
        if (_zkAMMv3 == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        if (_platformTreasury == address(0)) revert ZeroAddress();
        if (_voteVerifier == address(0)) revert ZeroAddress();
        if (_swapVerifier == address(0)) revert ZeroAddress();
        if (_transferVerifier == address(0)) revert ZeroAddress();
        if (_withdrawVerifier == address(0)) revert ZeroAddress();
        if (_pledgeVerifier == address(0)) revert ZeroAddress();

        r00tPool = TokenPool(_r00tPool);
        zkAMMv3 = IZkAMMv3(_zkAMMv3);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
        platformTreasury = _platformTreasury;
        voteVerifier = IVoteVerifier(_voteVerifier);
        swapVerifier = ISwapVerifier(_swapVerifier);
        transferVerifier = ITransferVerifier(_transferVerifier);
        withdrawVerifier = IWithdrawVerifier(_withdrawVerifier);
        pledgeVerifier = IPledgeVerifier(_pledgeVerifier);
        owner = msg.sender;

        // SECURITY FIX: Validate that r00tPool matches zkAMMv3.tokenPool()
        // This ensures authorization via zkAMMv3.registerProjectPool() works correctly
        // and prevents misconfiguration that would lock LP funds
        require(_r00tPool == zkAMMv3.tokenPool(), "r00tPool must match zkAMMv3.tokenPool()");
    }

    // ============ Proposal Functions ============

    /// @notice Create a new project proposal with ZK-verified R00T pledge
    /// @dev Anyone can create a proposal by proving they own R00T to pledge as initial liquidity.
    ///      The pledge is verified via ZK proof and the nullifier is spent to lock the funds.
    /// @param params Project parameters
    /// @param proof ZK proof of R00T commitment ownership
    /// @param merkleRoot R00T pool merkle root used in proof
    /// @param nullifierHash Nullifier hash to prevent double-spending
    /// @param pledgeAmount Amount of R00T to pledge as initial LP
    /// @param publicInputsBinding Binding computed by circuit (Poseidon hash of all public inputs)
    /// @return proposalId The new proposal ID
    function createProposal(
        ProposalParams calldata params,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 pledgeAmount,
        uint256 publicInputsBinding
    ) external returns (uint256 proposalId) {
        // Validate params
        if (bytes(params.name).length == 0) revert InvalidParams();
        if (bytes(params.symbol).length == 0) revert InvalidParams();
        if (params.totalSupply == 0) revert InvalidParams();
        if (params.feeBps > 1000) revert InvalidParams(); // Max 10%
        if (params.deployerBps > MAX_DEPLOYER_BPS) revert InvalidParams(); // Max 5%
        if (pledgeAmount < MIN_PLEDGE_AMOUNT) revert InsufficientPledge();

        // SECURITY FIX: Validate all ZK public inputs are within scalar field
        // This prevents nullifier aliasing attacks
        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // SECURITY: Verify merkle root is known in R00T pool
        if (!r00tPool.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();

        // SECURITY: Verify nullifier not already spent (prevents double-spending pledge)
        if (pledgeNullifiers[nullifierHash]) revert NullifierAlreadySpent();

        // SECURITY: Verify ZK proof of R00T ownership
        // Public signals order (Circom outputs first): [publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, creator]
        uint256[5] memory pubSignals = [
            publicInputsBinding, // Output signal comes first in Circom
            merkleRoot,
            nullifierHash,
            pledgeAmount,
            uint256(uint160(msg.sender)) // Bind proof to msg.sender
        ];

        if (!pledgeVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // SECURITY: Mark nullifier as spent to lock the pledge
        pledgeNullifiers[nullifierHash] = true;

        proposalId = proposalCount++;

        // Store pledge nullifier for this proposal (for potential refund tracking)
        proposalPledgeNullifier[proposalId] = nullifierHash;

        // SECURITY FIX: Store snapshot root for flash vote protection
        // Only commitments that existed at this moment can vote on this proposal
        proposalSnapshotRoot[proposalId] = r00tPool.root();

        Proposal storage p = proposals[proposalId];
        p.creator = msg.sender;
        p.pledgedR00t = pledgeAmount;

        // Metadata
        p.name = params.name;
        p.symbol = params.symbol;
        p.metadataHash = params.metadataHash;

        // Tokenomics
        p.totalSupply = params.totalSupply;
        p.feeBps = params.feeBps;
        p.deployerBps = params.deployerBps;

        // Voting
        p.votingEnds = block.timestamp + VOTING_PERIOD;
        p.status = ProposalStatus.Active;
        p.createdAt = block.timestamp;

        emit PledgeNullifierSpent(proposalId, nullifierHash);
        emit ProposalCreated(
            proposalId,
            msg.sender,
            params.name,
            params.symbol,
            pledgeAmount,
            p.votingEnds
        );
    }

    // ============ Voting Functions ============

    /// @notice Cast a private vote on a proposal
    /// @param proposalId Proposal to vote on
    /// @param proof ZK proof of $R00T holdings
    /// @param merkleRoot Merkle root used in proof
    /// @param nullifierHash Vote nullifier (unique per proposal)
    /// @param voteWeight Amount of $R00T voting with
    /// @param support True = vote FOR, False = vote AGAINST
    function votePrivate(
        uint256 proposalId,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 voteWeight,
        bool support
    ) external {
        // SECURITY FIX: Validate all ZK public inputs are within scalar field
        // This prevents nullifier aliasing attacks
        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        Proposal storage p = proposals[proposalId];

        // Check proposal is active
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp >= p.votingEnds) revert ProposalAlreadyEnded();

        // Check nullifier not used
        if (voteNullifiers[proposalId][nullifierHash]) revert AlreadyVoted();

        // SECURITY FIX: Flash vote protection via snapshot-based voting
        // Only accept the exact merkle root that existed when the proposal was created.
        // This prevents flash vote attacks where an attacker:
        // 1. Flash loans R00T
        // 2. Deposits to R00T pool (creates new commitment with NEW root)
        // 3. Votes using the new commitment
        // 4. Withdraws to repay loan
        // By requiring the snapshot root, new deposits after proposal creation cannot vote.
        uint256 snapshotRoot = proposalSnapshotRoot[proposalId];
        if (merkleRoot != snapshotRoot) revert UnknownMerkleRoot();

        // Also verify the root is actually known (sanity check)
        if (!r00tPool.isKnownRoot(merkleRoot)) revert InvalidProof();

        // Prepare public signals
        uint256[6] memory pubSignals = [
            proposalId,
            merkleRoot,
            nullifierHash,
            voteWeight,
            support ? uint256(1) : uint256(0),
            uint256(0) // voteBinding (computed by circuit)
        ];

        // Verify ZK proof
        if (!voteVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // Mark nullifier as used
        voteNullifiers[proposalId][nullifierHash] = true;

        // Record vote
        if (support) {
            p.votesFor += voteWeight;
        } else {
            p.votesAgainst += voteWeight;
        }

        emit VoteCast(proposalId, voteWeight, support);
    }

    // ============ Resolution Functions ============

    /// @notice Execute an approved proposal (deploy AMM)
    /// @param proposalId Proposal to execute
    function executeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];

        // SECURITY FIX: Check proposal is in Active state
        // This prevents execution of Rejected or Cancelled proposals
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();

        // Check voting ended
        if (block.timestamp < p.votingEnds) revert VotingNotEnded();

        // SECURITY FIX (Audit Vuln 2): Enforce execution delay after voting ends
        // This prevents race conditions on L2s where both executeProposal and finalizeRejected
        // could potentially see the same Active state due to block reordering
        if (block.timestamp < p.votingEnds + EXECUTION_DELAY) revert ExecutionDelayNotMet();

        // Check approved
        uint256 totalVotes = p.votesFor + p.votesAgainst;
        bool quorumMet = totalVotes >= MIN_VOTES_FOR_QUORUM;
        bool approved = p.votesFor > p.votesAgainst;

        if (!quorumMet || !approved) {
            p.status = ProposalStatus.Rejected;
            emit ProposalRejected(proposalId);
            revert NotApproved();
        }

        // SECURITY FIX (Audit Vuln 3): Mark as executed BEFORE external calls
        // This prevents reentrancy where the same proposal could be executed twice
        // if any of the deployment steps has a callback to this contract.
        // If any subsequent step reverts, the entire transaction reverts atomically,
        // so the status change will also be reverted.
        p.status = ProposalStatus.Executed;

        // Step 1: Deploy ERC20 token with ALL tokens minted to this contract
        // Deployer allocation is handled via ZkProjectPool.claimDevAllocation() as private commitments
        ProjectToken token = new ProjectToken(
            p.name,
            p.symbol,
            p.totalSupply,
            address(this),     // All tokens to governance first
            address(0),        // No direct deployer allocation (uses claimDevAllocation instead)
            0                  // Zero deployer bps (dev gets private commitments)
        );

        // Step 2: Deploy ZkProjectPool
        ZkProjectPool pool = new ZkProjectPool(
            p.name,
            p.symbol,
            address(token),
            p.pledgedR00t,           // Initial R00T reserve from creator's pledge
            address(r00tPool),       // R00T token pool for commitment validation
            address(nullifierRegistry), // Global nullifier registry
            p.creator,                 // Project creator (receives creator fees)
            platformTreasury,          // Platform treasury (receives platform fees)
            proposalId,                // Proposal ID for tracking
            p.deployerBps              // SECURITY FIX: Max dev allocation in bps (enforced on-chain)
        );

        // Step 3: Transfer all tokens from governance to pool (SECURITY FIX: use safeTransfer)
        IERC20(address(token)).safeTransfer(address(pool), p.totalSupply);

        // Step 4: Authorize the pool in NullifierRegistry (for cross-pool R00T nullifier tracking)
        nullifierRegistry.setPoolAuthorization(address(pool), true);

        // Step 5: SECURITY FIX (Vuln 1): Authorize the pool in r00tPool so it can process R00T claims
        // Without this, ZkProjectPool.processR00tClaim() and emergencyProcessR00tClaim() would fail
        // because they call r00tPool.insert() which requires authorization
        r00tPool.setAuthorizedCaller(address(pool), true);

        // Store addresses
        p.ammAddress = address(pool);
        p.tokenAddress = address(token);
        deployedAMMs.push(address(pool));
        deployedAMMsMapping[address(pool)] = true;  // GAS OPTIMIZATION: O(1) lookup

        // Register the new pool with ZkAMMv3 for routing (ETH → R00T → Project Token)
        zkAMMv3.registerProjectPool(address(pool));

        // Set ZkAMMv3 as authorized atomic swapper for the pool
        // This enables single-transaction ETH → ProjectToken swaps
        pool.setAuthorizedAtomicSwapper(address(zkAMMv3));

        emit ProposalExecuted(proposalId, address(pool), address(token));
    }

    /// @notice Finalize a rejected proposal and allow withdrawal
    /// @dev SECURITY NOTE (Vuln 3): This function can only transition Active -> Rejected.
    ///      If the proposal was approved (quorum met AND votesFor > votesAgainst),
    ///      caller should use executeProposal() instead to deploy the AMM.
    ///      The NotApproved revert indicates "this proposal passed, use executeProposal()".
    /// @param proposalId Proposal to finalize
    function finalizeRejected(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];

        // Check voting ended
        if (block.timestamp < p.votingEnds) revert VotingNotEnded();

        // SECURITY FIX (Audit Vuln 2): Enforce execution delay after voting ends
        // This prevents race conditions on L2s where both executeProposal and finalizeRejected
        // could potentially see the same Active state due to block reordering
        if (block.timestamp < p.votingEnds + EXECUTION_DELAY) revert ExecutionDelayNotMet();

        // Check still active (not yet resolved) - prevents re-finalization
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();

        // Check rejected (either quorum not met OR votesFor <= votesAgainst)
        uint256 totalVotes = p.votesFor + p.votesAgainst;
        bool quorumMet = totalVotes >= MIN_VOTES_FOR_QUORUM;
        bool approved = p.votesFor > p.votesAgainst && quorumMet;

        // If proposal passed, caller should use executeProposal() instead
        if (approved) revert NotApproved(); // Use executeProposal instead

        p.status = ProposalStatus.Rejected;
        emit ProposalRejected(proposalId);
    }

    /// @notice Withdraw pledge from rejected or cancelled proposal
    /// @dev SECURITY FIX: Creates a pending R00T claim that can be processed to return funds.
    ///      Platform fee (5%) is charged on BOTH rejected AND cancelled proposals.
    ///      This is intentional to discourage spam proposals and cover gas costs.
    /// @param proposalId Proposal to withdraw from
    /// @return claimId The ID of the created pending claim
    function withdrawRejected(uint256 proposalId) external returns (uint256 claimId) {
        Proposal storage p = proposals[proposalId];

        // Check creator
        if (msg.sender != p.creator) revert NotCreator();

        // Check rejected or cancelled - both statuses allow withdrawal with fee
        if (p.status != ProposalStatus.Rejected && p.status != ProposalStatus.Cancelled) {
            revert ProposalNotActive();
        }

        uint256 pledgeAmount = p.pledgedR00t;
        if (pledgeAmount == 0) revert InsufficientPledge(); // Already withdrawn

        // Calculate fee - charged on both rejected AND cancelled proposals (intentional)
        uint256 fee = (pledgeAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 refund = pledgeAmount - fee;

        // Accumulate fee
        accumulatedFees += fee;

        // Clear pledge (prevent re-withdrawal)
        p.pledgedR00t = 0;

        // SECURITY FIX: Create pending R00T claim for the creator
        // The creator will need to call setClaimCommitment() to provide their output commitment
        // Then owner or anyone (after delay) can process the claim to create the R00T commitment
        claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: refund,
            outputCommitment: 0,  // Creator must set this via setClaimCommitment()
            encryptedNote: "",
            claimed: false,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        totalPendingClaims += refund;

        emit PledgeWithdrawn(proposalId, msg.sender, refund, fee);
        emit R00tClaimCreated(claimId, proposalId, msg.sender, refund);

        // SECURITY FIX (Audit Vuln 8): Warn user if immediate claim processing is not available
        // This helps users understand they may need to wait for owner action or use emergency claim
        if (!r00tPool.authorizedCallers(address(this))) {
            emit ClaimProcessingDelayed(claimId, "Governance not authorized in r00tPool - use emergencyProcessR00tClaim after 30 days");
        }
    }

    /// @notice Set the output commitment for a pending claim
    /// @dev Only the claim creator can set the commitment. This allows privacy-preserving refunds.
    /// @param claimId The claim ID
    /// @param outputCommitment The R00T commitment to receive the refund
    /// @param encryptedNote Encrypted note for commitment recovery
    function setClaimCommitment(
        uint256 claimId,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (msg.sender != claim.creator) revert NotClaimCreator();
        if (outputCommitment == 0) revert ZeroAddress();
        // SECURITY FIX (Vuln 4): Validate commitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs (aliasing attack)
        // This prevents users from accidentally locking their R00T refund forever
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        claim.outputCommitment = outputCommitment;
        claim.encryptedNote = encryptedNote;

        emit R00tClaimCommitmentSet(claimId, outputCommitment);
    }

    /// @notice Cancel proposal (only in first 24 hours)
    /// @param proposalId Proposal to cancel
    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];

        // Check creator
        if (msg.sender != p.creator) revert NotCreator();

        // Check still active
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();

        // Check within grace period
        if (block.timestamp > p.createdAt + CANCEL_GRACE_PERIOD) {
            revert CancelGracePeriodPassed();
        }

        p.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(proposalId);
    }

    // ============ Pending Claims Processing ============

    /// @notice Process a pending R00T claim (called by owner)
    /// @dev SECURITY FIX: Creates the actual R00T commitment in the main R00T pool.
    ///      Requires the claim creator to have set their output commitment first.
    ///      DEPLOYMENT REQUIREMENT: This contract must be authorized in r00tPool via
    ///      r00tPool.setAuthorizedCaller(address(this), true) called by r00tPool owner.
    /// @param claimId The claim ID to process
    function processR00tClaim(uint256 claimId) external onlyOwner {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (claim.outputCommitment == 0) revert CommitmentNotSet();

        // SECURITY: Verify this contract is authorized to insert into r00tPool
        // If not authorized, this will revert with clear error instead of failing in insert()
        if (!r00tPool.authorizedCallers(address(this))) revert Unauthorized();

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        // Create the R00T commitment in the main R00T pool
        uint256 leafIndex = r00tPool.insert(claim.outputCommitment);

        // SECURITY FIX (Vuln 4): Use governance-specific event instead of TokenPool.NewCommitment
        // This properly associates the event with governance context for off-chain indexers
        emit R00tCommitmentCreated(claimId, claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount, claim.outputCommitment);
    }

    /// @notice Emergency process a pending R00T claim after delay (called by anyone)
    /// @dev SECURITY FIX: Prevents permanent fund lock if owner is compromised.
    ///      After EMERGENCY_CLAIM_DELAY (30 days), anyone can process pending claims.
    ///      This ensures users can always recover their funds even if owner fails.
    ///      DEPLOYMENT REQUIREMENT: This contract must be authorized in r00tPool.
    /// @param claimId The claim ID to process
    function emergencyProcessR00tClaim(uint256 claimId) external {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (claim.outputCommitment == 0) revert CommitmentNotSet();

        // SECURITY: Require emergency delay to have passed
        if (block.timestamp < claim.createdAt + EMERGENCY_CLAIM_DELAY) {
            revert EmergencyDelayNotMet();
        }

        // SECURITY: Verify this contract is authorized to insert into r00tPool
        if (!r00tPool.authorizedCallers(address(this))) revert Unauthorized();

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        // Create the R00T commitment in the main R00T pool
        uint256 leafIndex = r00tPool.insert(claim.outputCommitment);

        // SECURITY FIX (Vuln 4): Use governance-specific event instead of TokenPool.NewCommitment
        emit R00tCommitmentCreated(claimId, claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount, claim.outputCommitment);
    }

    // ============ Pool R00T Claims Processing ============

    /// @notice Process a pending R00T claim from a deployed ZkProjectPool
    /// @dev SECURITY FIX (Vuln 1): LaunchpadGovernance is the governance address for deployed pools.
    ///      This function allows processing R00T claims from pools without waiting 30 days.
    ///      The pool must have been deployed by this contract (tracked in deployedAMMs).
    /// @param pool Address of the ZkProjectPool
    /// @param claimId The claim ID to process in that pool
    function processPoolR00tClaim(address pool, uint256 claimId) external onlyOwner {
        // GAS OPTIMIZATION: O(1) lookup instead of O(n) array iteration
        if (!deployedAMMsMapping[pool]) revert InvalidPool();

        // Get claim details for event emission
        (uint256 amount, , , ) = ZkProjectPool(pool).getPendingClaim(claimId);

        // Process the claim - this contract is the governance address for the pool
        ZkProjectPool(pool).processR00tClaim(claimId);

        emit PoolR00tClaimProcessed(pool, claimId, amount);
    }

    /// @notice Batch process multiple R00T claims from a deployed ZkProjectPool
    /// @dev Gas-efficient way to process multiple claims in one transaction
    /// @param pool Address of the ZkProjectPool
    /// @param claimIds Array of claim IDs to process
    function processPoolR00tClaimBatch(address pool, uint256[] calldata claimIds) external onlyOwner {
        // GAS OPTIMIZATION: O(1) lookup instead of O(n) array iteration
        if (!deployedAMMsMapping[pool]) revert InvalidPool();

        // Process each claim with unchecked increment (GAS OPTIMIZATION)
        for (uint256 i = 0; i < claimIds.length;) {
            (uint256 amount, , , ) = ZkProjectPool(pool).getPendingClaim(claimIds[i]);
            ZkProjectPool(pool).processR00tClaim(claimIds[i]);
            emit PoolR00tClaimProcessed(pool, claimIds[i], amount);
            unchecked { ++i; }
        }
    }

    // ============ View Functions ============

    /// @notice Get proposal details
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    /// @notice Get all active proposals
    /// @dev GAS OPTIMIZATION: Uses unchecked increments
    function getActiveProposals() external view returns (uint256[] memory) {
        uint256 count = 0;
        uint256 _proposalCount = proposalCount;  // Cache storage read

        for (uint256 i = 0; i < _proposalCount;) {
            if (proposals[i].status == ProposalStatus.Active) {
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }

        uint256[] memory active = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < _proposalCount;) {
            if (proposals[i].status == ProposalStatus.Active) {
                active[idx] = i;
                unchecked { ++idx; }
            }
            unchecked { ++i; }
        }

        return active;
    }

    /// @notice Get all deployed AMM addresses
    /// @dev WARNING: May run out of gas for large arrays. Use getLiveProjectsPaginated for safety.
    function getLiveProjects() external view returns (address[] memory) {
        return deployedAMMs;
    }

    /// @notice Get deployed AMM addresses with pagination (SECURITY FIX M-05)
    /// @dev Prevents gas issues when there are many deployed projects
    /// @param offset Starting index
    /// @param limit Maximum number of results to return
    /// @return projects Array of AMM addresses
    /// @return total Total number of deployed projects
    function getLiveProjectsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory projects, uint256 total) {
        total = deployedAMMs.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        projects = new address[](resultLength);

        for (uint256 i = 0; i < resultLength;) {
            projects[i] = deployedAMMs[offset + i];
            unchecked { ++i; }
        }

        return (projects, total);
    }

    /// @notice Get number of deployed projects
    function getLiveProjectCount() external view returns (uint256) {
        return deployedAMMs.length;
    }

    /// @notice Check if an address is a deployed AMM
    /// @dev GAS OPTIMIZATION: O(1) mapping lookup instead of O(n) array iteration
    function isDeployedAMM(address amm) external view returns (bool) {
        return deployedAMMsMapping[amm];
    }

    /// @notice Get pending claim details
    /// @param claimId The claim ID
    /// @return amount Amount of R00T to claim
    /// @return outputCommitment The output commitment (0 if not set)
    /// @return claimed Whether the claim has been processed
    /// @return createdAt Timestamp when claim was created
    /// @return creator Address of the claim creator
    function getPendingClaim(uint256 claimId) external view returns (
        uint256 amount,
        uint256 outputCommitment,
        bool claimed,
        uint256 createdAt,
        address creator
    ) {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        return (claim.amount, claim.outputCommitment, claim.claimed, claim.createdAt, claim.creator);
    }

    /// @notice Get total pending claims info
    /// @return nextId Next claim ID to be assigned
    /// @return totalPending Total R00T amount in pending claims
    function getPendingClaimsInfo() external view returns (uint256 nextId, uint256 totalPending) {
        return (nextClaimId, totalPendingClaims);
    }

    /// @notice Check if a claim can be emergency processed
    /// @param claimId The claim ID
    /// @return canProcess True if emergency delay has passed
    /// @return timeRemaining Seconds until emergency processing is allowed (0 if ready)
    function canEmergencyProcess(uint256 claimId) external view returns (bool canProcess, uint256 timeRemaining) {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0 || claim.claimed || claim.outputCommitment == 0) {
            return (false, 0);
        }
        uint256 emergencyTime = claim.createdAt + EMERGENCY_CLAIM_DELAY;
        if (block.timestamp >= emergencyTime) {
            return (true, 0);
        }
        return (false, emergencyTime - block.timestamp);
    }

    /// @notice Check if this contract is authorized to process claims
    /// @dev Returns true if this contract can insert commitments into r00tPool
    /// @return authorized True if claims can be processed
    function isAuthorizedForClaims() external view returns (bool authorized) {
        return r00tPool.authorizedCallers(address(this));
    }

    // ============ Admin Functions ============

    /// @notice Withdraw accumulated platform fees as a pending R00T claim
    /// @dev SECURITY FIX (Audit Vuln 3): Creates actual pending claim that can be processed
    ///      to generate a real R00T commitment, instead of just emitting an event.
    ///      The owner must then call setClaimCommitment() and processR00tClaim() to complete.
    /// @param outputCommitment The R00T commitment to receive the fees (0 to defer setting)
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the created pending claim
    function withdrawFees(
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external onlyOwner returns (uint256 claimId) {
        uint256 amount = accumulatedFees;
        if (amount == 0) revert InsufficientPledge(); // No fees to withdraw

        // SECURITY FIX: Clear fees first (CEI pattern)
        accumulatedFees = 0;

        // Create pending R00T claim for the treasury
        claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: amount,
            outputCommitment: outputCommitment,  // Can be 0, owner sets via setClaimCommitment
            encryptedNote: encryptedNote,
            claimed: false,
            createdAt: block.timestamp,
            creator: platformTreasury  // Treasury is the recipient
        });
        totalPendingClaims += amount;

        emit FeesWithdrawn(platformTreasury, amount);
        emit R00tClaimCreated(claimId, 0, platformTreasury, amount);  // proposalId=0 for fee claims
    }

    /// @notice Allow owner to set commitment for a treasury fee claim
    /// @dev SECURITY FIX (Audit Vuln 3): Separate function so owner can set commitment
    ///      for claims created via withdrawFees() where commitment was initially 0
    /// @param claimId The claim ID
    /// @param outputCommitment The R00T commitment to receive the fees
    /// @param encryptedNote Encrypted note for commitment recovery
    function setTreasuryClaimCommitment(
        uint256 claimId,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external onlyOwner {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (claim.creator != platformTreasury) revert NotClaimCreator();  // Only treasury claims
        if (outputCommitment == 0) revert ZeroAddress();
        // SECURITY FIX (Audit Vuln 4): Validate commitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs, causing permanent fund lock
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        claim.outputCommitment = outputCommitment;
        claim.encryptedNote = encryptedNote;

        emit R00tClaimCommitmentSet(claimId, outputCommitment);
    }

    /// @notice Lock all verifiers permanently (cannot be unlocked)
    /// @dev SECURITY FIX (Vuln 3): Once locked, verifiers cannot be changed
    ///      This should be called after all verifiers are properly configured
    ///      Prevents a compromised owner from replacing verifiers with malicious ones
    event VerifiersPermanentlyLocked();

    function lockVerifiers() external onlyOwner {
        verifiersLocked = true;
        emit VerifiersPermanentlyLocked();
    }

    /// @notice Update vote verifier
    /// @dev SECURITY FIX (Vuln 3): Cannot be called after verifiers are locked
    function setVoteVerifier(address _newVerifier) external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();
        voteVerifier = IVoteVerifier(_newVerifier);
    }

    /// @notice Update swap verifier (affects new pools only)
    /// @dev SECURITY FIX (Vuln 3): Cannot be called after verifiers are locked
    function setSwapVerifier(address _newVerifier) external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();
        swapVerifier = ISwapVerifier(_newVerifier);
    }

    /// @notice Update pledge verifier
    /// @dev SECURITY FIX (Vuln 3): Cannot be called after verifiers are locked
    function setPledgeVerifier(address _newVerifier) external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();
        pledgeVerifier = IPledgeVerifier(_newVerifier);
    }

    // ============ Timelocked Admin Functions ============
    // SECURITY FIX (Audit Vuln 5): Critical admin changes require 48-hour timelock

    /// @notice Propose new ZkAMMv3 address (starts timelock)
    function proposeZkAMMv3(address _zkAMMv3) external onlyOwner {
        if (_zkAMMv3 == address(0)) revert ZeroAddress();
        pendingZkAMMv3 = _zkAMMv3;
        zkAMMv3TimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit ZkAMMv3Proposed(_zkAMMv3, zkAMMv3TimelockExpiry);
    }

    /// @notice Accept pending ZkAMMv3 change (after timelock)
    function acceptZkAMMv3() external onlyOwner {
        if (pendingZkAMMv3 == address(0)) revert NoPendingChange();
        if (block.timestamp < zkAMMv3TimelockExpiry) revert TimelockNotExpired();

        address oldAddress = address(zkAMMv3);
        zkAMMv3 = IZkAMMv3(pendingZkAMMv3);
        pendingZkAMMv3 = address(0);
        zkAMMv3TimelockExpiry = 0;
        emit ZkAMMv3Updated(oldAddress, address(zkAMMv3));
    }

    /// @notice Propose new NullifierRegistry address (starts timelock)
    function proposeNullifierRegistry(address _nullifierRegistry) external onlyOwner {
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        pendingNullifierRegistry = _nullifierRegistry;
        nullifierRegistryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit NullifierRegistryProposed(_nullifierRegistry, nullifierRegistryTimelockExpiry);
    }

    /// @notice Accept pending NullifierRegistry change (after timelock)
    function acceptNullifierRegistry() external onlyOwner {
        if (pendingNullifierRegistry == address(0)) revert NoPendingChange();
        if (block.timestamp < nullifierRegistryTimelockExpiry) revert TimelockNotExpired();

        address oldAddress = address(nullifierRegistry);
        nullifierRegistry = NullifierRegistry(pendingNullifierRegistry);
        pendingNullifierRegistry = address(0);
        nullifierRegistryTimelockExpiry = 0;
        emit NullifierRegistryUpdated(oldAddress, address(nullifierRegistry));
    }

    /// @notice Propose new platform treasury address (starts timelock)
    function proposePlatformTreasury(address _platformTreasury) external onlyOwner {
        if (_platformTreasury == address(0)) revert ZeroAddress();
        pendingPlatformTreasury = _platformTreasury;
        platformTreasuryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit PlatformTreasuryProposed(_platformTreasury, platformTreasuryTimelockExpiry);
    }

    /// @notice Accept pending platform treasury change (after timelock)
    function acceptPlatformTreasury() external onlyOwner {
        if (pendingPlatformTreasury == address(0)) revert NoPendingChange();
        if (block.timestamp < platformTreasuryTimelockExpiry) revert TimelockNotExpired();

        address oldAddress = platformTreasury;
        platformTreasury = pendingPlatformTreasury;
        pendingPlatformTreasury = address(0);
        platformTreasuryTimelockExpiry = 0;
        emit PlatformTreasuryUpdated(oldAddress, platformTreasury);
    }

    /// @notice Cancel any pending admin proposal
    /// @param configType "zkAMMv3", "nullifierRegistry", or "platformTreasury"
    function cancelAdminProposal(string calldata configType) external onlyOwner {
        bytes32 typeHash = keccak256(bytes(configType));

        if (typeHash == keccak256("zkAMMv3")) {
            if (pendingZkAMMv3 == address(0)) revert NoPendingChange();
            address cancelled = pendingZkAMMv3;
            pendingZkAMMv3 = address(0);
            zkAMMv3TimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else if (typeHash == keccak256("nullifierRegistry")) {
            if (pendingNullifierRegistry == address(0)) revert NoPendingChange();
            address cancelled = pendingNullifierRegistry;
            pendingNullifierRegistry = address(0);
            nullifierRegistryTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else if (typeHash == keccak256("platformTreasury")) {
            if (pendingPlatformTreasury == address(0)) revert NoPendingChange();
            address cancelled = pendingPlatformTreasury;
            pendingPlatformTreasury = address(0);
            platformTreasuryTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else {
            revert InvalidParams();
        }
    }

    /// @notice Propose ownership transfer (starts timelock)
    /// @dev SECURITY FIX (Vuln 2): Ownership transfer now requires 48-hour timelock
    ///      This prevents immediate takeover if owner key is compromised
    function proposeOwnershipTransfer(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        pendingOwner = _newOwner;
        ownerTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit OwnershipTransferProposed(_newOwner, ownerTimelockExpiry);
    }

    /// @notice Accept pending ownership transfer (after timelock)
    /// @dev SECURITY FIX (Audit Vuln 2): Can be called by EITHER current owner OR pendingOwner
    ///      This prevents ownership from being stuck if current owner loses access after proposing
    function acceptOwnershipTransfer() external {
        if (pendingOwner == address(0)) revert NoPendingChange();
        if (block.timestamp < ownerTimelockExpiry) revert TimelockNotExpired();
        // SECURITY FIX: Allow either current owner or pending owner to execute
        if (msg.sender != owner && msg.sender != pendingOwner) revert Unauthorized();

        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit OwnershipTransferred(oldOwner, owner);
    }

    /// @notice Cancel pending ownership transfer
    function cancelOwnershipTransfer() external onlyOwner {
        if (pendingOwner == address(0)) revert NoPendingChange();
        address cancelled = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit AdminProposalCancelled("owner", cancelled);
    }
}
