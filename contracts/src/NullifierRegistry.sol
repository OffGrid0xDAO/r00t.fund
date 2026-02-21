// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NullifierRegistry
/// @notice Global registry for tracking spent nullifiers across all pools
/// @dev SECURITY FIX: Prevents double-spending R00T commitments across multiple project pools
///
/// Problem Solved:
/// - R00T commitments live in ZkAMMv3's TokenPool
/// - Multiple ZkProjectPools can accept R00T commitments
/// - Without coordination, same R00T commitment could be spent in multiple pools
///
/// Solution:
/// - Single registry for all R00T nullifiers
/// - Only authorized pools can mark nullifiers as spent
/// - All pools check this registry before accepting R00T nullifiers
///
/// SECURITY FIX (Audit Vuln 4): Governance changes require 48-hour timelock
contract NullifierRegistry {
    // ============ Constants ============

    /// @notice Timelock duration for governance changes (TESTNET: 1 minute)
    /// @dev SECURITY FIX (Audit Vuln 4): Prevents instant governance takeover if owner is compromised
    uint256 public constant GOVERNANCE_TIMELOCK = 1 minutes; // TESTNET: Changed from 48 hours for testing
    // ============ State Variables ============

    /// @notice Mapping of spent nullifier hashes
    mapping(uint256 => bool) public nullifiers;

    /// @notice Authorized pools that can mark nullifiers as spent
    mapping(address => bool) public authorizedPools;

    /// @notice Timestamp when a pool was last authorized (informational only)
    /// @dev SECURITY FIX (Audit Vuln 5): Newly authorized pools must wait before they can mark nullifiers
    ///      SECURITY FIX (Audit Vuln 6 - DOCUMENTATION): This timestamp is updated on EVERY authorization,
    ///      including re-authorizations. It is INFORMATIONAL ONLY and indicates when the pool was last
    ///      toggled to authorized state. For actual cooldown enforcement, use poolOriginalAuthorizationTime.
    ///      External integrations should use poolOriginalAuthorizationTime for security decisions.
    mapping(address => uint256) public poolAuthorizationTime;

    /// @notice Authorization timestamp used for cooldown enforcement
    /// @dev SECURITY FIX (Audit Vuln 10): Resets to 0 on deauthorization to ensure fresh observation window
    ///      When a pool is authorized, this is set to block.timestamp.
    ///      When a pool is deauthorized, this is reset to 0.
    ///      This ensures each authorization decision gets a fresh 24-hour observation window.
    ///      SECURITY FIX (Audit Vuln 6 - DOCUMENTATION): THIS is the timestamp used for actual cooldown
    ///      enforcement in onlyAuthorizedPool modifier. External integrations querying authorization
    ///      status should use this value, not poolAuthorizationTime.
    ///      cooldown_end = poolOriginalAuthorizationTime[pool] + POOL_AUTHORIZATION_COOLDOWN
    mapping(address => uint256) public poolOriginalAuthorizationTime;

    /// @notice Cooldown period before newly authorized pools can mark nullifiers (TESTNET: 1 minute)
    /// @dev SECURITY FIX (Audit Vuln 5): Prevents instant griefing if governance is compromised
    uint256 public constant POOL_AUTHORIZATION_COOLDOWN = 1 minutes; // TESTNET: Changed from 24 hours for testing

    /// @notice Contract owner (can authorize new pools)
    address public owner;

    /// @notice Governance contract (can also authorize pools)
    address public governance;

    /// @notice Pending governance address (for timelock)
    /// @dev SECURITY FIX (Audit Vuln 4): Two-step governance change with timelock
    address public pendingGovernance;

    /// @notice Timestamp when pending governance can be accepted
    /// @dev SECURITY FIX (Audit Vuln 4): Must wait GOVERNANCE_TIMELOCK after proposal
    uint256 public governanceTimelockExpiry;

    /// @notice Whether governance has been finalized (one-time immediate set allowed)
    /// @dev Allows deployment scripts to set governance immediately ONCE, then requires timelock
    bool public governanceFinalized;

    /// @notice Pending owner address (for timelock)
    /// @dev SECURITY FIX (Audit Vuln 2): Two-step ownership change with timelock
    address public pendingOwner;

    /// @notice Timestamp when pending owner can be accepted
    /// @dev SECURITY FIX (Audit Vuln 2): Must wait GOVERNANCE_TIMELOCK after proposal
    uint256 public ownerTimelockExpiry;

    // ============ Events ============

    event NullifierSpent(uint256 indexed nullifierHash, address indexed pool);
    event PoolAuthorized(address indexed pool, bool authorized);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipProposed(address indexed proposedOwner, uint256 effectiveTime);
    event OwnershipProposalCancelled(address indexed cancelledOwner);
    event GovernanceUpdated(address indexed previousGovernance, address indexed newGovernance);
    event GovernanceProposed(address indexed proposedGovernance, uint256 effectiveTime);
    event GovernanceProposalCancelled(address indexed cancelledGovernance);

    // ============ Errors ============

    error Unauthorized();
    error NullifierAlreadySpent();
    error ZeroAddress();
    error TimelockNotExpired();
    error NoPendingGovernance();
    error NoPendingOwner();
    error GovernanceAlreadyFinalized();
    error PoolAuthorizationCooldownNotMet(); // SECURITY FIX (Audit Vuln 5): Pool must wait after authorization

    // ============ Modifiers ============

    /// @dev SECURITY FIX (Vuln 5): Separated admin paths to reduce attack surface
    ///      Previously, both owner AND governance could authorize pools
    ///      Now: governance authorizes pools, owner manages ownership

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier onlyAuthorizedPool() {
        if (!authorizedPools[msg.sender]) revert Unauthorized();
        // SECURITY FIX (Audit Vuln 5): Check cooldown period has passed
        // This prevents instant griefing by a malicious pool authorized by compromised governance
        // SECURITY FIX (Audit Vuln 3): Use original authorization time to prevent toggle bypass
        // A pool that was deauthorized and re-authorized still uses its FIRST authorization time
        if (block.timestamp < poolOriginalAuthorizationTime[msg.sender] + POOL_AUTHORIZATION_COOLDOWN) {
            revert PoolAuthorizationCooldownNotMet();
        }
        _;
    }

    // ============ Constructor ============

    /// @notice Initialize the NullifierRegistry
    /// @param _governance Initial governance address
    /// @dev SECURITY FIX (Vuln 4): Governance is finalized at construction to prevent
    ///      owner from waiting to call setGovernance() at a strategic moment with
    ///      a malicious governance address. Future governance changes require timelock.
    constructor(address _governance) {
        if (_governance == address(0)) revert ZeroAddress();
        owner = msg.sender;
        governance = _governance;
        governanceFinalized = true; // SECURITY FIX: Finalize immediately at construction
    }

    // ============ External Functions ============

    /// @notice Check if a nullifier has been spent
    /// @param nullifierHash The nullifier hash to check
    /// @return True if the nullifier has been spent
    function isSpent(uint256 nullifierHash) external view returns (bool) {
        return nullifiers[nullifierHash];
    }

    /// @notice Get the full authorization status of a pool
    /// @dev SECURITY FIX (Audit Vuln 6): Provides clear view function for external integrations
    ///      to determine actual cooldown status instead of misinterpreting poolAuthorizationTime
    /// @param pool The pool address to check
    /// @return isAuthorized Whether the pool is currently authorized
    /// @return cooldownEnds Timestamp when cooldown ends (0 if never authorized)
    /// @return canMarkNullifiers Whether the pool can currently mark nullifiers
    function getPoolAuthorizationStatus(address pool) external view returns (
        bool isAuthorized,
        uint256 cooldownEnds,
        bool canMarkNullifiers
    ) {
        isAuthorized = authorizedPools[pool];
        uint256 originalAuthTime = poolOriginalAuthorizationTime[pool];
        cooldownEnds = originalAuthTime > 0 ? originalAuthTime + POOL_AUTHORIZATION_COOLDOWN : 0;
        canMarkNullifiers = isAuthorized && block.timestamp >= cooldownEnds;
    }

    /// @notice Mark a nullifier as spent (only authorized pools)
    /// @param nullifierHash The nullifier hash to mark as spent
    function markSpent(uint256 nullifierHash) external onlyAuthorizedPool {
        if (nullifiers[nullifierHash]) revert NullifierAlreadySpent();
        nullifiers[nullifierHash] = true;
        emit NullifierSpent(nullifierHash, msg.sender);
    }

    /// @notice Check and mark a nullifier as spent in one call (gas optimization)
    /// @param nullifierHash The nullifier hash to check and mark
    /// @return wasSpent True if the nullifier was already spent (reverts if so)
    function checkAndMark(uint256 nullifierHash) external onlyAuthorizedPool returns (bool wasSpent) {
        wasSpent = nullifiers[nullifierHash];
        if (wasSpent) revert NullifierAlreadySpent();
        nullifiers[nullifierHash] = true;
        emit NullifierSpent(nullifierHash, msg.sender);
    }

    // ============ Admin Functions ============

    /// @notice Authorize or deauthorize a pool
    /// @param pool The pool address
    /// @param authorized Whether to authorize or deauthorize
    /// @dev SECURITY FIX (Vuln 5): Only governance can authorize pools (not owner)
    ///      This prevents a compromised owner from griefing users by authorizing malicious pools
    /// @dev SECURITY FIX (Audit Vuln 5): Newly authorized pools must wait POOL_AUTHORIZATION_COOLDOWN
    ///      before they can mark nullifiers as spent. This provides a 24-hour window for the
    ///      community to detect and respond to potentially malicious pool authorizations.
    /// @dev SECURITY FIX (Audit Vuln 10): Deauthorization resets poolOriginalAuthorizationTime.
    ///      This ensures re-authorization triggers a fresh 24-hour observation window.
    ///      Without this, a mistakenly authorized (then deauthorized) pool could be later
    ///      re-authorized and immediately operate, bypassing the observation window.
    function setPoolAuthorization(address pool, bool authorized) external onlyGovernance {
        if (pool == address(0)) revert ZeroAddress();
        authorizedPools[pool] = authorized;
        // SECURITY FIX (Audit Vuln 5): Record authorization time for cooldown enforcement
        if (authorized) {
            poolAuthorizationTime[pool] = block.timestamp;
            // SECURITY FIX (Audit Vuln 10): Always set original auth time on authorization
            // This ensures each authorization decision gets a fresh 24-hour observation window
            poolOriginalAuthorizationTime[pool] = block.timestamp;
        } else {
            // SECURITY FIX (Audit Vuln 10): Reset original auth time on deauthorization
            // This ensures re-authorization starts a fresh cooldown period
            poolOriginalAuthorizationTime[pool] = 0;
        }
        emit PoolAuthorized(pool, authorized);
    }

    /// @notice Batch authorize multiple pools
    /// @param pools Array of pool addresses
    /// @param authorized Whether to authorize or deauthorize all
    /// @dev SECURITY FIX (Vuln 5): Only governance can authorize pools (not owner)
    /// @dev SECURITY FIX (Audit Vuln 5): Cooldown applies to each pool individually
    /// @dev SECURITY FIX (Audit Vuln 10): Deauthorization resets cooldown for fresh observation window
    function setPoolAuthorizationBatch(address[] calldata pools, bool authorized) external onlyGovernance {
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i] == address(0)) revert ZeroAddress();
            authorizedPools[pools[i]] = authorized;
            // SECURITY FIX (Audit Vuln 5): Record authorization time for cooldown enforcement
            if (authorized) {
                poolAuthorizationTime[pools[i]] = block.timestamp;
                // SECURITY FIX (Audit Vuln 10): Always set original auth time on authorization
                poolOriginalAuthorizationTime[pools[i]] = block.timestamp;
            } else {
                // SECURITY FIX (Audit Vuln 10): Reset original auth time on deauthorization
                poolOriginalAuthorizationTime[pools[i]] = 0;
            }
            emit PoolAuthorized(pools[i], authorized);
        }
    }

    /// @notice Propose a new owner address (starts timelock)
    /// @param newOwner New owner address
    /// @dev SECURITY FIX (Audit Vuln 2): Requires 48-hour timelock before ownership can be changed
    ///      This gives the community time to react if owner account is compromised
    function proposeOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        ownerTimelockExpiry = block.timestamp + GOVERNANCE_TIMELOCK;
        emit OwnershipProposed(newOwner, ownerTimelockExpiry);
    }

    /// @notice Accept the pending ownership change (after timelock expires)
    /// @dev SECURITY FIX (Audit Vuln 2): Can only be called after GOVERNANCE_TIMELOCK has passed
    /// @dev SECURITY FIX (Audit Vuln 3): Can be called by EITHER current owner OR pendingOwner
    ///      This prevents ownership from being stuck if current owner loses access after proposing
    function acceptOwnership() external {
        if (pendingOwner == address(0)) revert NoPendingOwner();
        if (block.timestamp < ownerTimelockExpiry) revert TimelockNotExpired();
        // SECURITY FIX: Allow either current owner or pending owner to execute
        if (msg.sender != owner && msg.sender != pendingOwner) revert Unauthorized();

        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;

        emit OwnershipTransferred(oldOwner, owner);
    }

    /// @notice Cancel a pending ownership proposal
    /// @dev Allows owner to cancel if they change their mind or detect compromise
    function cancelOwnershipProposal() external onlyOwner {
        if (pendingOwner == address(0)) revert NoPendingOwner();
        address cancelled = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit OwnershipProposalCancelled(cancelled);
    }

    // NOTE: setGovernance() has been removed as part of SECURITY FIX (Vuln 4).
    // Governance is now finalized at construction time, and all future governance
    // changes MUST use the timelock mechanism via proposeGovernance()/acceptGovernance().
    // This prevents a compromised owner from instantly setting malicious governance.

    /// @notice Propose a new governance address (starts timelock)
    /// @param newGovernance New governance address
    /// @dev SECURITY FIX (Audit Vuln 4): Requires 48-hour timelock before governance can be changed
    ///      This gives the community time to react if owner account is compromised
    function proposeGovernance(address newGovernance) external onlyOwner {
        if (newGovernance == address(0)) revert ZeroAddress();
        pendingGovernance = newGovernance;
        governanceTimelockExpiry = block.timestamp + GOVERNANCE_TIMELOCK;
        emit GovernanceProposed(newGovernance, governanceTimelockExpiry);
    }

    /// @notice Accept the pending governance change (after timelock expires)
    /// @dev SECURITY FIX (Audit Vuln 4): Can only be called after GOVERNANCE_TIMELOCK has passed
    function acceptGovernance() external onlyOwner {
        if (pendingGovernance == address(0)) revert NoPendingGovernance();
        if (block.timestamp < governanceTimelockExpiry) revert TimelockNotExpired();

        address oldGovernance = governance;
        governance = pendingGovernance;
        pendingGovernance = address(0);
        governanceTimelockExpiry = 0;

        emit GovernanceUpdated(oldGovernance, governance);
    }

    /// @notice Cancel a pending governance proposal
    /// @dev Allows owner to cancel if they change their mind or detect compromise
    function cancelGovernanceProposal() external onlyOwner {
        if (pendingGovernance == address(0)) revert NoPendingGovernance();
        address cancelled = pendingGovernance;
        pendingGovernance = address(0);
        governanceTimelockExpiry = 0;
        emit GovernanceProposalCancelled(cancelled);
    }
}
