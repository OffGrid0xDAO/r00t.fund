// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TokenPool} from "./TokenPool.sol";
import {NullifierRegistry} from "./NullifierRegistry.sol";
import {IVoteVerifier, IPledgeVerifier} from "./interfaces/IVerifier.sol";
import {IZkProjectPool} from "./interfaces/IZkProjectPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Interface for token factory
interface IProjectTokenFactory {
    function deployToken(string calldata name, string calldata symbol, uint256 totalSupply, address recipient) external returns (address);
}

/// @notice Interface for pool factory
interface IProjectPoolFactory {
    function deployPool(
        string calldata name,
        string calldata symbol,
        address tokenAddress,
        uint256 pledgedR00t,
        address r00tPool,
        address nullifierRegistry,
        address creator,
        address platformTreasury,
        uint256 proposalId,
        uint256 deployerBps
    ) external returns (address);
}

/// @notice Interface for ZkAMM
interface IZkAMMGov {
    function registerProjectPool(address pool) external;
}

/// @notice Interface for World ID Gatekeeper (sybil resistance)
interface IWorldIDGatekeeper {
    function isVerified(address user) external view returns (bool);
}

/// @title LaunchpadGovernance
/// @author r00t.fund
/// @notice Community-governed launchpad for privacy-preserving ReFi/RWA tokens
/// @dev V2: Uses external factories to stay under 24KB contract size limit
contract LaunchpadGovernance {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PLATFORM_FEE_BPS = 500;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant VOTING_PERIOD = 10 minutes; // TESTNET: Changed from 7 days for testing
    uint256 public constant MIN_VOTES_FOR_QUORUM = 1_000_000 * 1e18;
    uint256 public constant CANCEL_GRACE_PERIOD = 1 minutes; // TESTNET: Changed from 24 hours for testing
    uint256 public constant EMERGENCY_CLAIM_DELAY = 5 minutes; // TESTNET: Changed from 30 days for testing
    uint256 public constant MAX_DEPLOYER_BPS = 500;
    uint256 public constant MIN_PLEDGE_AMOUNT = 100 * 1e18;
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice Minimum delay before owner can process a R00T claim (TESTNET: 1 minute)
    /// @dev SECURITY FIX (Vuln 3): Prevents instant claim processing by compromised owner
    ///      Claims must age before they can be processed, giving time for detection
    uint256 public constant CLAIM_PROCESSING_DELAY = 1 minutes; // TESTNET: Changed from 24 hours for testing

    /// @notice Admin timelock duration (TESTNET: 1 minute)
    /// @dev SECURITY FIX (Vuln 3): Critical admin changes require timelock
    uint256 public constant ADMIN_TIMELOCK = 1 minutes; // TESTNET: Changed from 48 hours for testing

    /// @notice Maximum duration for initial setup phase (TESTNET: 10 minutes)
    /// @dev SECURITY FIX (Audit): After this period, initial setup automatically expires
    ///      This prevents owner from keeping the contract in setup mode indefinitely
    uint256 public constant MAX_INITIAL_SETUP_DURATION = 10 minutes; // TESTNET: Changed from 7 days for testing

    // ============ Enums & Structs ============

    enum ProposalStatus { Active, Approved, Rejected, Cancelled, Executed }

    struct Proposal {
        address creator;
        uint256 pledgedR00t;
        string name;
        string symbol;
        bytes32 metadataHash;
        uint256 totalSupply;
        uint256 feeBps;
        uint256 deployerBps;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votingEnds;
        ProposalStatus status;
        address ammAddress;
        address tokenAddress;
        uint256 createdAt;
    }

    struct ProposalParams {
        string name;
        string symbol;
        bytes32 metadataHash;
        uint256 totalSupply;
        uint256 feeBps;
        uint256 deployerBps;
    }

    struct PendingR00tClaim {
        uint256 amount;
        uint256 outputCommitment;
        bytes encryptedNote;
        bool claimed;
        uint256 createdAt;
        address creator;
    }

    // ============ State ============

    TokenPool public immutable r00tPool;
    IProjectTokenFactory public tokenFactory;
    IProjectPoolFactory public poolFactory;
    IZkAMMGov public zkAMM;
    IVoteVerifier public voteVerifier;
    IPledgeVerifier public pledgeVerifier;
    NullifierRegistry public nullifierRegistry;
    address public platformTreasury;
    address public owner;

    bool public verifiersLocked;

    /// @notice Optional World ID gatekeeper for sybil-resistant proposal creation
    IWorldIDGatekeeper public worldIdGatekeeper;

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    mapping(uint256 => mapping(uint256 => bool)) public voteNullifiers;
    mapping(uint256 => uint256) public proposalSnapshotRoot;
    mapping(uint256 => bool) public pledgeNullifiers;

    uint256 public accumulatedFees;
    address[] public deployedAMMs;
    mapping(address => bool) public deployedAMMsMapping;

    uint256 public nextClaimId;
    mapping(uint256 => PendingR00tClaim) public pendingR00tClaims;
    uint256 public totalPendingClaims;

    // ============ Pending Admin Changes (Timelock) ============
    // SECURITY FIX (Vuln 3): Critical admin changes require 48-hour timelock

    /// @notice Pending owner address
    address public pendingOwner;
    /// @notice Timelock expiry for pending owner change
    uint256 public ownerTimelockExpiry;

    /// @notice Pending ZkAMM address
    address public pendingZkAMM;
    /// @notice Timelock expiry for pending ZkAMM change
    uint256 public zkAMMTimelockExpiry;

    /// @notice Pending token factory address
    address public pendingTokenFactory;
    /// @notice Timelock expiry for pending token factory change
    uint256 public tokenFactoryTimelockExpiry;

    /// @notice Pending pool factory address
    address public pendingPoolFactory;
    /// @notice Timelock expiry for pending pool factory change
    uint256 public poolFactoryTimelockExpiry;

    /// @notice Whether initial setup is complete (allows one-time immediate config)
    /// @dev SECURITY FIX: After initial setup, all admin changes require timelock
    bool public initialSetupComplete;

    /// @notice Deployment timestamp for initial setup deadline
    /// @dev SECURITY FIX (Audit): Used to enforce MAX_INITIAL_SETUP_DURATION
    uint256 public immutable deploymentTime;

    // ============ Events ============

    event ProposalCreated(uint256 indexed proposalId, address indexed creator, string name, string symbol, uint256 pledgedR00t, uint256 votingEnds);
    event VoteCast(uint256 indexed proposalId, uint256 voteWeight, bool support);
    event ProposalExecuted(uint256 indexed proposalId, address indexed ammAddress, address indexed tokenAddress);
    event ProposalRejected(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event PledgeWithdrawn(uint256 indexed proposalId, address indexed creator, uint256 amount, uint256 fee);
    event R00tClaimCreated(uint256 indexed claimId, uint256 indexed proposalId, address indexed creator, uint256 amount);
    event R00tClaimCommitmentSet(uint256 indexed claimId, uint256 outputCommitment);
    event R00tClaimProcessed(uint256 indexed claimId, uint256 amount, uint256 outputCommitment);
    event R00tCommitmentCreated(uint256 indexed claimId, uint256 indexed commitment, uint256 leafIndex, bytes encryptedNote);
    event VerifiersPermanentlyLocked();

    // SECURITY FIX (Vuln 3): Admin timelock events
    event OwnershipTransferProposed(address indexed proposed, uint256 effectiveTime);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ZkAMMProposed(address indexed proposed, uint256 effectiveTime);
    event ZkAMMUpdated(address indexed oldAddress, address indexed newAddress);
    event TokenFactoryProposed(address indexed proposed, uint256 effectiveTime);
    event TokenFactoryUpdated(address indexed oldAddress, address indexed newAddress);
    event PoolFactoryProposed(address indexed proposed, uint256 effectiveTime);
    event PoolFactoryUpdated(address indexed oldAddress, address indexed newAddress);
    event AdminProposalCancelled(string configType, address cancelled);
    event InitialSetupCompleted();

    // ============ Errors ============

    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownMerkleRoot();
    error ProposalNotActive();
    error VotingNotEnded();
    error ProposalAlreadyEnded();
    error AlreadyVoted();
    error NotCreator();
    error CancelGracePeriodPassed();
    error NotApproved();
    error Unauthorized();
    error ZeroAddress();
    error InvalidParams();
    error InsufficientPledge();
    error ClaimAlreadyProcessed();
    error InvalidClaimId();
    error EmergencyDelayNotMet();
    error CommitmentNotSet();
    error NotClaimCreator();
    error InvalidScalarField();
    error VerifiersLocked();
    error NoFeesToCollect();
    error ClaimTooNew();           // SECURITY FIX (Vuln 3): Claim must age before processing
    error TimelockNotExpired();    // SECURITY FIX (Vuln 3): Must wait for timelock
    error NoPendingChange();       // SECURITY FIX (Vuln 3): No pending admin change to accept
    error InitialSetupAlreadyComplete();  // Initial setup can only be done once
    error InitialSetupPhaseExpired();     // SECURITY FIX (Audit): Initial setup period has passed
    error WorldIdRequired();              // World ID verification required to create proposals

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _r00tPool,
        address _tokenFactory,
        address _poolFactory,
        address _zkAMM,
        address _nullifierRegistry,
        address _platformTreasury,
        address _voteVerifier,
        address _pledgeVerifier
    ) {
        if (_r00tPool == address(0)) revert ZeroAddress();
        if (_tokenFactory == address(0)) revert ZeroAddress();
        if (_poolFactory == address(0)) revert ZeroAddress();
        if (_zkAMM == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        if (_platformTreasury == address(0)) revert ZeroAddress();
        if (_voteVerifier == address(0)) revert ZeroAddress();
        if (_pledgeVerifier == address(0)) revert ZeroAddress();

        r00tPool = TokenPool(_r00tPool);
        tokenFactory = IProjectTokenFactory(_tokenFactory);
        poolFactory = IProjectPoolFactory(_poolFactory);
        zkAMM = IZkAMMGov(_zkAMM);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
        platformTreasury = _platformTreasury;
        voteVerifier = IVoteVerifier(_voteVerifier);
        pledgeVerifier = IPledgeVerifier(_pledgeVerifier);
        owner = msg.sender;

        // SECURITY FIX (Audit): Record deployment time for initial setup deadline enforcement
        deploymentTime = block.timestamp;
    }

    // ============ Proposal Functions ============

    function createProposal(
        ProposalParams calldata params,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 pledgeAmount,
        uint256 publicInputsBinding
    ) external returns (uint256 proposalId) {
        if (bytes(params.name).length == 0) revert InvalidParams();
        if (bytes(params.symbol).length == 0) revert InvalidParams();
        if (params.totalSupply == 0) revert InvalidParams();
        if (params.feeBps > 1000) revert InvalidParams();
        if (params.deployerBps > MAX_DEPLOYER_BPS) revert InvalidParams();
        if (pledgeAmount < MIN_PLEDGE_AMOUNT) revert InsufficientPledge();

        // World ID sybil resistance check (optional — only enforced when gatekeeper is set)
        if (address(worldIdGatekeeper) != address(0)) {
            if (!worldIdGatekeeper.isVerified(msg.sender)) revert WorldIdRequired();
        }

        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        if (!r00tPool.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (pledgeNullifiers[nullifierHash]) revert NullifierAlreadySpent();

        // Public signals order (Circom outputs first): [publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, creator]
        uint256[5] memory pubSignals = [
            publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, uint256(uint160(msg.sender))
        ];

        if (!pledgeVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        pledgeNullifiers[nullifierHash] = true;
        proposalId = proposalCount++;
        proposalSnapshotRoot[proposalId] = r00tPool.root();

        Proposal storage p = proposals[proposalId];
        p.creator = msg.sender;
        p.pledgedR00t = pledgeAmount;
        p.name = params.name;
        p.symbol = params.symbol;
        p.metadataHash = params.metadataHash;
        p.totalSupply = params.totalSupply;
        p.feeBps = params.feeBps;
        p.deployerBps = params.deployerBps;
        p.votingEnds = block.timestamp + VOTING_PERIOD;
        p.status = ProposalStatus.Active;
        p.createdAt = block.timestamp;

        emit ProposalCreated(proposalId, msg.sender, params.name, params.symbol, pledgeAmount, p.votingEnds);
    }

    // ============ Voting ============

    function votePrivate(
        uint256 proposalId,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 voteWeight,
        bool support
    ) external {
        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        // SECURITY FIX: Validate voteWeight against SNARK field to prevent aliasing
        if (voteWeight >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp >= p.votingEnds) revert ProposalAlreadyEnded();
        if (voteNullifiers[proposalId][nullifierHash]) revert AlreadyVoted();

        uint256 snapshotRoot = proposalSnapshotRoot[proposalId];
        if (merkleRoot != snapshotRoot) revert UnknownMerkleRoot();

        // SECURITY FIX (Vuln 16): Use deterministic voteBinding without block.number
        // block.number is unpredictable at proof generation time, causing valid votes to fail
        // TODO (Vuln 9): Include nullifierHash in binding to prevent proof transfer / vote buying.
        //   Change to: keccak256(abi.encodePacked(nullifierHash, msg.sender, proposalId))
        //   This requires updating the vote circuit to match the new binding computation.
        //   Without this, a user can generate a proof and hand it to a vote-buying market contract.
        uint256 voteBinding = uint256(keccak256(abi.encodePacked(msg.sender, proposalId))) % SNARK_SCALAR_FIELD;
        uint256[6] memory pubSignals = [
            proposalId, merkleRoot, nullifierHash, voteWeight, support ? uint256(1) : uint256(0), voteBinding
        ];

        if (!voteVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        voteNullifiers[proposalId][nullifierHash] = true;

        if (support) p.votesFor += voteWeight;
        else p.votesAgainst += voteWeight;

        emit VoteCast(proposalId, voteWeight, support);
    }

    // ============ Execution ============

    function executeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];

        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp < p.votingEnds) revert VotingNotEnded();

        uint256 totalVotes = p.votesFor + p.votesAgainst;
        if (totalVotes < MIN_VOTES_FOR_QUORUM || p.votesFor <= p.votesAgainst) {
            p.status = ProposalStatus.Rejected;
            emit ProposalRejected(proposalId);
            revert NotApproved();
        }

        p.status = ProposalStatus.Executed;

        // Deploy token via factory (tokens go to pool factory first)
        address tokenAddr = tokenFactory.deployToken(p.name, p.symbol, p.totalSupply, address(poolFactory));

        // SECURITY FIX (Vuln 4): Two-phase deployment - request pool deployment
        // deployPool returns address(0) for two-phase pattern, store deployment ID
        poolFactory.deployPool(
            p.name, p.symbol, tokenAddr, p.pledgedR00t,
            address(r00tPool), address(nullifierRegistry),
            p.creator, platformTreasury, proposalId, p.deployerBps
        );

        // Store token address for later configuration in finalizePoolDeployment
        p.tokenAddress = tokenAddr;

        emit ProposalExecuted(proposalId, address(0), tokenAddr);
    }

    /// @notice Finalize pool deployment after keeper registers the pool (Phase 2)
    /// @dev Called by owner after the pool factory's registerDeployedPool completes
    /// @param proposalId The proposal whose pool was deployed
    /// @param poolAddr The deployed pool address (from factory's registerDeployedPool)
    function finalizePoolDeployment(uint256 proposalId, address poolAddr) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Executed) revert ProposalNotActive();
        if (p.ammAddress != address(0)) revert ProposalNotActive(); // Already finalized
        if (poolAddr == address(0)) revert ZeroAddress();

        // Configure pool authorizations
        nullifierRegistry.setPoolAuthorization(poolAddr, true);
        r00tPool.setAuthorizedCaller(poolAddr, true);
        zkAMM.registerProjectPool(poolAddr);
        IZkProjectPool(poolAddr).setAuthorizedAtomicSwapper(address(zkAMM));

        p.ammAddress = poolAddr;
        deployedAMMs.push(poolAddr);
        deployedAMMsMapping[poolAddr] = true;

        emit ProposalExecuted(proposalId, poolAddr, p.tokenAddress);
    }

    function finalizeRejected(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (block.timestamp < p.votingEnds) revert VotingNotEnded();
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();

        uint256 totalVotes = p.votesFor + p.votesAgainst;
        // Revert if proposal passed (votesFor > votesAgainst with quorum)
        // Ties (votesFor == votesAgainst) are rejectable - they fall through this check
        if (totalVotes >= MIN_VOTES_FOR_QUORUM && p.votesFor > p.votesAgainst) revert NotApproved();

        p.status = ProposalStatus.Rejected;
        emit ProposalRejected(proposalId);
    }

    function withdrawRejected(uint256 proposalId) external returns (uint256 claimId) {
        Proposal storage p = proposals[proposalId];
        if (msg.sender != p.creator) revert NotCreator();
        if (p.status != ProposalStatus.Rejected && p.status != ProposalStatus.Cancelled) revert ProposalNotActive();

        uint256 pledgeAmount = p.pledgedR00t;
        if (pledgeAmount == 0) revert InsufficientPledge();

        uint256 fee = (pledgeAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 refund = pledgeAmount - fee;

        accumulatedFees += fee;
        p.pledgedR00t = 0;

        claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: refund, outputCommitment: 0, encryptedNote: "", claimed: false, createdAt: block.timestamp, creator: msg.sender
        });
        totalPendingClaims += refund;

        emit PledgeWithdrawn(proposalId, msg.sender, refund, fee);
        emit R00tClaimCreated(claimId, proposalId, msg.sender, refund);
    }

    function setClaimCommitment(uint256 claimId, uint256 outputCommitment, bytes calldata encryptedNote) external {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (msg.sender != claim.creator) revert NotClaimCreator();
        if (outputCommitment == 0) revert ZeroAddress();
        // SECURITY FIX (Vuln 3): Validate commitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs (aliasing attack)
        // This prevents users from accidentally locking their R00T refund forever
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        claim.outputCommitment = outputCommitment;
        claim.encryptedNote = encryptedNote;
        emit R00tClaimCommitmentSet(claimId, outputCommitment);
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (msg.sender != p.creator) revert NotCreator();
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp > p.createdAt + CANCEL_GRACE_PERIOD) revert CancelGracePeriodPassed();

        p.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(proposalId);
    }

    // ============ Claims ============

    /// @notice Process a pending R00T claim (owner only, with delay)
    /// @dev SECURITY FIX (Vuln 3): Claims must age CLAIM_PROCESSING_DELAY before processing
    ///      This prevents a compromised owner from instantly minting R00T tokens
    function processR00tClaim(uint256 claimId) external onlyOwner {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (claim.outputCommitment == 0) revert CommitmentNotSet();

        // SECURITY FIX (Vuln 3): Require minimum age before processing
        // This gives users time to detect and respond to suspicious claim activity
        if (block.timestamp < claim.createdAt + CLAIM_PROCESSING_DELAY) revert ClaimTooNew();

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        uint256 leafIndex = r00tPool.insert(claim.outputCommitment);
        emit R00tCommitmentCreated(claimId, claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount, claim.outputCommitment);
    }

    /// @notice SECURITY FIX (Vuln 5): Only claim creator can emergency-process their own claim
    function emergencyProcessR00tClaim(uint256 claimId) external {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (claim.outputCommitment == 0) revert CommitmentNotSet();
        // SECURITY FIX (Vuln 5): Restrict to claim creator only
        if (msg.sender != claim.creator) revert NotCreator();
        if (block.timestamp < claim.createdAt + EMERGENCY_CLAIM_DELAY) revert EmergencyDelayNotMet();

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        uint256 leafIndex = r00tPool.insert(claim.outputCommitment);
        emit R00tCommitmentCreated(claimId, claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount, claim.outputCommitment);
    }

    // ============ Fee Withdrawal ============

    /// @notice Withdraw accumulated platform fees as a pending R00T claim
    /// @dev SECURITY FIX: Without this, fees collected from rejected proposals are permanently locked
    /// @param outputCommitment Commitment for receiving R00T fees
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the registered claim
    function withdrawFees(uint256 outputCommitment, bytes calldata encryptedNote) external onlyOwner returns (uint256 claimId) {
        if (accumulatedFees == 0) revert NoFeesToCollect();
        if (outputCommitment == 0) revert ZeroAddress();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        uint256 amount = accumulatedFees;
        accumulatedFees = 0;

        claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: amount,
            outputCommitment: outputCommitment,
            encryptedNote: encryptedNote,
            claimed: false,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        totalPendingClaims += amount;

        emit PlatformFeesWithdrawn(amount, claimId);
    }

    event PlatformFeesWithdrawn(uint256 amount, uint256 claimId);

    // ============ View Functions ============

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getLiveProjectCount() external view returns (uint256) {
        return deployedAMMs.length;
    }

    function isDeployedAMM(address amm) external view returns (bool) {
        return deployedAMMsMapping[amm];
    }

    // ============ Admin ============

    // ============ Timelocked Admin Functions ============
    // SECURITY FIX (Vuln 3): Critical admin changes require 48-hour timelock

    /// @notice Propose new token factory address (starts timelock)
    function proposeTokenFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        pendingTokenFactory = _factory;
        tokenFactoryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit TokenFactoryProposed(_factory, tokenFactoryTimelockExpiry);
    }

    /// @notice Accept pending token factory change (after timelock)
    function acceptTokenFactory() external onlyOwner {
        if (pendingTokenFactory == address(0)) revert NoPendingChange();
        if (block.timestamp < tokenFactoryTimelockExpiry) revert TimelockNotExpired();

        address oldAddress = address(tokenFactory);
        tokenFactory = IProjectTokenFactory(pendingTokenFactory);
        pendingTokenFactory = address(0);
        tokenFactoryTimelockExpiry = 0;
        emit TokenFactoryUpdated(oldAddress, address(tokenFactory));
    }

    /// @notice Propose new pool factory address (starts timelock)
    function proposePoolFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        pendingPoolFactory = _factory;
        poolFactoryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit PoolFactoryProposed(_factory, poolFactoryTimelockExpiry);
    }

    /// @notice Accept pending pool factory change (after timelock)
    function acceptPoolFactory() external onlyOwner {
        if (pendingPoolFactory == address(0)) revert NoPendingChange();
        if (block.timestamp < poolFactoryTimelockExpiry) revert TimelockNotExpired();

        address oldAddress = address(poolFactory);
        poolFactory = IProjectPoolFactory(pendingPoolFactory);
        pendingPoolFactory = address(0);
        poolFactoryTimelockExpiry = 0;
        emit PoolFactoryUpdated(oldAddress, address(poolFactory));
    }

    /// @notice Propose new ZkAMM address (starts timelock)
    function proposeZkAMM(address _zkAMM) external onlyOwner {
        if (_zkAMM == address(0)) revert ZeroAddress();
        pendingZkAMM = _zkAMM;
        zkAMMTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit ZkAMMProposed(_zkAMM, zkAMMTimelockExpiry);
    }

    /// @notice Accept pending ZkAMM change (after timelock)
    function acceptZkAMM() external onlyOwner {
        if (pendingZkAMM == address(0)) revert NoPendingChange();
        if (block.timestamp < zkAMMTimelockExpiry) revert TimelockNotExpired();

        address oldAddress = address(zkAMM);
        zkAMM = IZkAMMGov(pendingZkAMM);
        pendingZkAMM = address(0);
        zkAMMTimelockExpiry = 0;
        emit ZkAMMUpdated(oldAddress, address(zkAMM));
    }

    function lockVerifiers() external onlyOwner {
        verifiersLocked = true;
        emit VerifiersPermanentlyLocked();
    }

    // SECURITY FIX (Vuln 3): Verifier changes now require timelock (propose + accept pattern)
    address public pendingVoteVerifier;
    uint256 public voteVerifierTimelockExpiry;
    address public pendingPledgeVerifier;
    uint256 public pledgeVerifierTimelockExpiry;

    event VoteVerifierProposed(address indexed proposed, uint256 effectiveTime);
    event VoteVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event PledgeVerifierProposed(address indexed proposed, uint256 effectiveTime);
    event PledgeVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    function proposeVoteVerifier(address v) external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (v == address(0)) revert ZeroAddress();
        pendingVoteVerifier = v;
        voteVerifierTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit VoteVerifierProposed(v, voteVerifierTimelockExpiry);
    }

    function acceptVoteVerifier() external onlyOwner {
        if (pendingVoteVerifier == address(0)) revert NoPendingChange();
        if (block.timestamp < voteVerifierTimelockExpiry) revert TimelockNotExpired();
        address old = address(voteVerifier);
        voteVerifier = IVoteVerifier(pendingVoteVerifier);
        pendingVoteVerifier = address(0);
        voteVerifierTimelockExpiry = 0;
        emit VoteVerifierUpdated(old, address(voteVerifier));
    }

    function proposePledgeVerifier(address v) external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (v == address(0)) revert ZeroAddress();
        pendingPledgeVerifier = v;
        pledgeVerifierTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit PledgeVerifierProposed(v, pledgeVerifierTimelockExpiry);
    }

    function acceptPledgeVerifier() external onlyOwner {
        if (pendingPledgeVerifier == address(0)) revert NoPendingChange();
        if (block.timestamp < pledgeVerifierTimelockExpiry) revert TimelockNotExpired();
        address old = address(pledgeVerifier);
        pledgeVerifier = IPledgeVerifier(pendingPledgeVerifier);
        pendingPledgeVerifier = address(0);
        pledgeVerifierTimelockExpiry = 0;
        emit PledgeVerifierUpdated(old, address(pledgeVerifier));
    }

    /// @notice Set vote verifier immediately (only during initial setup)
    function setVoteVerifier(address v) external onlyOwner {
        _requireInitialSetupPhase();
        if (v == address(0)) revert ZeroAddress();
        voteVerifier = IVoteVerifier(v);
    }

    /// @notice Set pledge verifier immediately (only during initial setup)
    function setPledgeVerifier(address v) external onlyOwner {
        _requireInitialSetupPhase();
        if (v == address(0)) revert ZeroAddress();
        pledgeVerifier = IPledgeVerifier(v);
    }

    // ============ Initial Setup Functions (No Timelock) ============
    // These can only be called ONCE during deployment before finalizeInitialSetup()
    // After initial setup is complete, all changes require timelock
    // SECURITY FIX (Audit): Initial setup phase automatically expires after MAX_INITIAL_SETUP_DURATION

    /// @notice Check if initial setup phase is still active
    /// @dev Returns true if setup is not complete AND deadline has not passed
    function isInitialSetupPhaseActive() public view returns (bool) {
        return !initialSetupComplete && block.timestamp < deploymentTime + MAX_INITIAL_SETUP_DURATION;
    }

    /// @notice Internal function to verify initial setup phase is active
    function _requireInitialSetupPhase() internal view {
        if (initialSetupComplete) revert InitialSetupAlreadyComplete();
        if (block.timestamp >= deploymentTime + MAX_INITIAL_SETUP_DURATION) revert InitialSetupPhaseExpired();
    }

    /// @notice Set token factory immediately (only during initial setup)
    /// @dev Used during deployment when factories need to be reconfigured
    ///      SECURITY FIX (Audit): Also checks that MAX_INITIAL_SETUP_DURATION hasn't passed
    function setTokenFactory(address _factory) external onlyOwner {
        _requireInitialSetupPhase();
        if (_factory == address(0)) revert ZeroAddress();
        address oldAddress = address(tokenFactory);
        tokenFactory = IProjectTokenFactory(_factory);
        emit TokenFactoryUpdated(oldAddress, _factory);
    }

    /// @notice Set pool factory immediately (only during initial setup)
    /// @dev SECURITY FIX (Audit): Also checks that MAX_INITIAL_SETUP_DURATION hasn't passed
    function setPoolFactory(address _factory) external onlyOwner {
        _requireInitialSetupPhase();
        if (_factory == address(0)) revert ZeroAddress();
        address oldAddress = address(poolFactory);
        poolFactory = IProjectPoolFactory(_factory);
        emit PoolFactoryUpdated(oldAddress, _factory);
    }

    /// @notice Set ZkAMM immediately (only during initial setup)
    /// @dev SECURITY FIX (Audit): Also checks that MAX_INITIAL_SETUP_DURATION hasn't passed
    function setZkAMM(address _zkAMM) external onlyOwner {
        _requireInitialSetupPhase();
        if (_zkAMM == address(0)) revert ZeroAddress();
        address oldAddress = address(zkAMM);
        zkAMM = IZkAMMGov(_zkAMM);
        emit ZkAMMUpdated(oldAddress, _zkAMM);
    }

    /// @notice Set World ID gatekeeper immediately (only during initial setup)
    /// @dev Can be set to address(0) to disable World ID requirement
    function setWorldIdGatekeeper(address _gatekeeper) external onlyOwner {
        _requireInitialSetupPhase();
        worldIdGatekeeper = IWorldIDGatekeeper(_gatekeeper);
    }

    /// @notice Finalize initial setup (locks immediate setters, enables timelocks)
    /// @dev MUST be called after deployment setup is complete
    ///      After this, all factory/admin changes require 48-hour timelock
    ///      SECURITY FIX (Audit): Also checks that MAX_INITIAL_SETUP_DURATION hasn't passed
    function finalizeInitialSetup() external onlyOwner {
        _requireInitialSetupPhase();
        initialSetupComplete = true;
        emit InitialSetupCompleted();
    }

    /// @notice Propose ownership transfer (starts timelock)
    /// @dev SECURITY FIX (Vuln 3): Ownership transfer now requires 48-hour timelock
    function proposeOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        ownerTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit OwnershipTransferProposed(newOwner, ownerTimelockExpiry);
    }

    /// @notice Accept pending ownership transfer (after timelock)
    /// @dev Can be called by current owner or pending owner (2-step transfer)
    function acceptOwnershipTransfer() external {
        if (pendingOwner == address(0)) revert NoPendingChange();
        if (block.timestamp < ownerTimelockExpiry) revert TimelockNotExpired();
        if (msg.sender != owner && msg.sender != pendingOwner) revert Unauthorized();

        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit OwnershipTransferred(oldOwner, owner);
    }

    // ============ Timelocked World ID Gatekeeper ============

    /// @notice Pending World ID gatekeeper address
    address public pendingWorldIdGatekeeper;
    /// @notice Timelock expiry for pending World ID gatekeeper change
    uint256 public worldIdGatekeeperTimelockExpiry;

    event WorldIdGatekeeperProposed(address indexed proposed, uint256 effectiveTime);
    event WorldIdGatekeeperUpdated(address indexed oldAddress, address indexed newAddress);

    /// @notice Propose new World ID gatekeeper (starts timelock)
    /// @dev Can propose address(0) to disable World ID requirement
    function proposeWorldIdGatekeeper(address _gatekeeper) external onlyOwner {
        pendingWorldIdGatekeeper = _gatekeeper;
        worldIdGatekeeperTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit WorldIdGatekeeperProposed(_gatekeeper, worldIdGatekeeperTimelockExpiry);
    }

    /// @notice Accept pending World ID gatekeeper change (after timelock)
    function acceptWorldIdGatekeeper() external onlyOwner {
        if (worldIdGatekeeperTimelockExpiry == 0) revert NoPendingChange();
        if (block.timestamp < worldIdGatekeeperTimelockExpiry) revert TimelockNotExpired();

        address oldAddress = address(worldIdGatekeeper);
        worldIdGatekeeper = IWorldIDGatekeeper(pendingWorldIdGatekeeper);
        pendingWorldIdGatekeeper = address(0);
        worldIdGatekeeperTimelockExpiry = 0;
        emit WorldIdGatekeeperUpdated(oldAddress, address(worldIdGatekeeper));
    }

    /// @notice Cancel any pending admin proposal
    /// @param configType "owner", "zkAMM", "tokenFactory", or "poolFactory"
    function cancelAdminProposal(string calldata configType) external onlyOwner {
        bytes32 typeHash = keccak256(bytes(configType));

        if (typeHash == keccak256("owner")) {
            if (pendingOwner == address(0)) revert NoPendingChange();
            address cancelled = pendingOwner;
            pendingOwner = address(0);
            ownerTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else if (typeHash == keccak256("zkAMM")) {
            if (pendingZkAMM == address(0)) revert NoPendingChange();
            address cancelled = pendingZkAMM;
            pendingZkAMM = address(0);
            zkAMMTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else if (typeHash == keccak256("tokenFactory")) {
            if (pendingTokenFactory == address(0)) revert NoPendingChange();
            address cancelled = pendingTokenFactory;
            pendingTokenFactory = address(0);
            tokenFactoryTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else if (typeHash == keccak256("poolFactory")) {
            if (pendingPoolFactory == address(0)) revert NoPendingChange();
            address cancelled = pendingPoolFactory;
            pendingPoolFactory = address(0);
            poolFactoryTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else {
            revert InvalidParams();
        }
    }
}
