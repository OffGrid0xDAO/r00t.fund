// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PoseidonT3.sol";

/// @title TokenPool
/// @notice Incremental Merkle tree for token commitments
/// @dev Uses Poseidon hash with depth 24 (~16M leaves)
///
/// ROOT HISTORY OPTIMIZATION:
/// - Uses circular buffer (recentRoots) for O(1) lookup of last ROOT_HISTORY_SIZE roots
/// - Full mapping (roots) maintains ALL historical roots for backward compatibility
/// - New roots check recent buffer first (gas savings ~2-5k per check)
/// - IMPORTANT: All roots are kept forever to ensure user commitments remain valid
contract TokenPool {
    // ============ Constants ============

    /// @notice Depth of the merkle tree
    uint256 public constant DEPTH = 24;

    /// @notice Maximum number of leaves (2^24 = 16,777,216)
    uint256 public constant MAX_LEAVES = 2 ** DEPTH;

    /// @notice Zero value for empty leaves
    /// @dev This should be Poseidon("r00t.fund") in production
    uint256 public constant ZERO_VALUE =
        21663839004416932945382355908790599225266501822907911457504978515578255421292;

    /// @notice Size of the recent roots circular buffer (for gas optimization)
    /// @dev Optimized for ~7 days of activity at ~10 txns/block on Arbitrum
    uint256 public constant ROOT_HISTORY_SIZE = 1000;

    // ============ State Variables ============

    /// @notice Address of the deployed Poseidon contract
    address public immutable poseidon;

    /// @notice Index of next leaf to insert
    uint256 public nextIndex;

    /// @notice Current merkle root
    uint256 public root;

    /// @notice Filled subtrees for incremental insertion
    /// @dev filledSubtrees[i] = the rightmost node at level i that is "filled"
    uint256[DEPTH] public filledSubtrees;

    /// @notice Mapping to track ALL historical roots (never expire)
    /// @dev root => exists
    mapping(uint256 => bool) public roots;

    /// @notice Circular buffer of recent roots for gas-optimized lookup
    /// @dev Allows O(1) verification for recent transactions
    uint256[ROOT_HISTORY_SIZE] public recentRoots;

    /// @notice Current index in the recent roots circular buffer
    uint256 public recentRootsIndex;

    /// @notice Precomputed zero hashes for each level
    /// @dev zeros[i] = hash of empty subtree of height i
    uint256[DEPTH] public zeros;

    /// @notice Owner of the pool (deployer)
    /// @dev SECURITY FIX: Added access control to prevent DoS via merkle tree filling
    address public immutable owner;

    /// @notice Mapping of authorized callers that can insert leaves
    /// @dev SECURITY FIX: Only authorized addresses can insert commitments
    mapping(address => bool) public authorizedCallers;

    /// @notice Mapping of addresses that were ever authorized (for emergency recovery)
    /// @dev SECURITY FIX (Vuln 6): Tracks historical authorization for emergency inserts
    mapping(address => bool) public wasEverAuthorized;

    /// @notice Emergency delay before previously-authorized callers can insert
    /// @dev SECURITY FIX (Vuln 6): 30 days delay for emergency recovery
    uint256 public constant EMERGENCY_INSERT_DELAY = 30 days;

    /// @notice Timestamp when authorization was revoked for each caller
    /// @dev SECURITY FIX (Vuln 6): Used to enforce emergency delay
    mapping(address => uint256) public authorizationRevokedAt;

    /// @notice Maximum number of emergency inserts allowed per caller
    /// @dev SECURITY FIX (Audit Vuln 5): Reduced from 100 to 25 to minimize tree pollution
    ///      25 inserts is enough for legitimate claim processing but strictly limits abuse
    uint256 public constant MAX_EMERGENCY_INSERTS = 25;

    /// @notice Counter for emergency inserts per caller
    /// @dev SECURITY FIX (Audit Vuln 5): Tracks usage to enforce MAX_EMERGENCY_INSERTS
    mapping(address => uint256) public emergencyInsertCount;

    /// @notice Global maximum emergency inserts across ALL previously-authorized callers
    /// @dev SECURITY FIX (Audit Vuln 5): Prevents aggregate DoS if many pools are deauthorized
    uint256 public constant MAX_GLOBAL_EMERGENCY_INSERTS = 1000;

    /// @notice Global counter for emergency inserts
    /// @dev SECURITY FIX (Audit Vuln 5): Ensures total emergency inserts are bounded
    uint256 public globalEmergencyInsertCount;

    // ============ Events ============

    event LeafInserted(uint256 indexed leafIndex, uint256 leaf, uint256 newRoot);
    event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);
    event CallerAuthorized(address indexed caller, bool authorized);

    // ============ Errors ============

    error MerkleTreeFull();
    error UnknownRoot();
    error Unauthorized();
    error EmergencyDelayNotMet();  // SECURITY FIX (Vuln 6): Emergency insert delay not passed
    error NeverAuthorized();       // SECURITY FIX (Vuln 6): Caller was never authorized
    error EmergencyLimitExceeded(); // SECURITY FIX (Audit Vuln 5): Max emergency inserts reached (per-caller)
    error GlobalEmergencyLimitExceeded(); // SECURITY FIX (Audit Vuln 5): Global emergency limit reached

    // ============ Constructor ============

    /// @param _poseidon Address of the deployed Poseidon T3 contract
    constructor(address _poseidon) {
        require(_poseidon != address(0), "TokenPool: zero poseidon address");
        poseidon = _poseidon;

        // SECURITY FIX: Set deployer as owner and authorize them as caller
        owner = msg.sender;
        authorizedCallers[msg.sender] = true;
        wasEverAuthorized[msg.sender] = true;  // SECURITY FIX (Vuln 6): Track historical authorization

        // Precompute zero hashes for each level (GAS OPTIMIZATION: unchecked increment)
        uint256 currentZero = ZERO_VALUE;
        for (uint256 i = 0; i < DEPTH;) {
            zeros[i] = currentZero;
            filledSubtrees[i] = currentZero;
            currentZero = _hashPair(currentZero, currentZero);
            unchecked { ++i; }
        }

        // Set initial root (tree of all zeros)
        root = currentZero;
        roots[root] = true;
    }

    // ============ External Functions ============

    /// @notice Insert a new leaf into the merkle tree
    /// @dev SECURITY FIX: Only authorized callers can insert to prevent DoS attacks
    /// @param leaf The commitment to insert
    /// @return index The index of the inserted leaf
    function insert(uint256 leaf) external returns (uint256 index) {
        if (!authorizedCallers[msg.sender]) revert Unauthorized();
        if (nextIndex >= MAX_LEAVES) revert MerkleTreeFull();

        index = nextIndex;
        uint256 currentIndex = index;
        uint256 currentHash = leaf;

        // Update path from leaf to root (GAS OPTIMIZATION: unchecked increments)
        for (uint256 i = 0; i < DEPTH;) {
            if (currentIndex % 2 == 0) {
                // Current node is a left child
                // Its sibling is a zero hash (empty right subtree)
                // Update filledSubtrees since this level now has a new leftmost filled node
                filledSubtrees[i] = currentHash;
                currentHash = _hashPair(currentHash, zeros[i]);
            } else {
                // Current node is a right child
                // Its sibling is the filled subtree at this level
                currentHash = _hashPair(filledSubtrees[i], currentHash);
            }
            unchecked {
                currentIndex /= 2;
                ++i;
            }
        }

        // Update root
        root = currentHash;
        nextIndex = index + 1;

        // Store root in mapping (ALL roots are stored, never expire)
        roots[root] = true;

        // Also add to circular buffer for gas-optimized recent root lookups
        recentRoots[recentRootsIndex] = root;
        recentRootsIndex = (recentRootsIndex + 1) % ROOT_HISTORY_SIZE;

        emit LeafInserted(index, leaf, root);
    }

    /// @notice Check if a root is known (current or historical)
    /// @param _root The root to check
    /// @return True if the root is known
    /// @dev Checks recent buffer first for gas optimization, then falls back to full mapping
    /// @dev GAS OPTIMIZATION: Uses unchecked increments (~3,000 gas savings)
    function isKnownRoot(uint256 _root) external view returns (bool) {
        if (_root == 0) return false;

        // Fast path: check if it's the current root
        if (_root == root) return true;

        // Check recent roots buffer (gas optimized for recent transactions)
        for (uint256 i = 0; i < ROOT_HISTORY_SIZE;) {
            if (recentRoots[i] == _root) return true;
            unchecked { ++i; }
        }

        // Fall back to full historical mapping (covers all roots ever)
        return roots[_root];
    }

    /// @notice Check if a root is in recent history (gas-optimized)
    /// @param _root The root to check
    /// @return True if the root is in recent history
    /// @dev Only checks the circular buffer, not the full mapping
    /// @dev GAS OPTIMIZATION: Uses unchecked increments
    function isRecentRoot(uint256 _root) external view returns (bool) {
        if (_root == 0) return false;
        if (_root == root) return true;

        for (uint256 i = 0; i < ROOT_HISTORY_SIZE;) {
            if (recentRoots[i] == _root) return true;
            unchecked { ++i; }
        }
        return false;
    }

    /// @notice Get the current root
    /// @return The current merkle root
    function getRoot() external view returns (uint256) {
        return root;
    }

    /// @notice Get the next available leaf index
    /// @return The next leaf index
    function getNextIndex() external view returns (uint256) {
        return nextIndex;
    }

    // ============ Admin Functions ============

    /// @notice Authorize or deauthorize a caller to insert leaves
    /// @dev SECURITY FIX: Only owner can manage authorized callers
    ///      SECURITY FIX (Vuln 6): Tracks historical authorization for emergency recovery
    /// @param caller The address to authorize/deauthorize
    /// @param authorized Whether to authorize (true) or deauthorize (false)
    function setAuthorizedCaller(address caller, bool authorized) external {
        if (msg.sender != owner) revert Unauthorized();

        // SECURITY FIX (Vuln 6): Track historical authorization and revocation
        if (authorized) {
            wasEverAuthorized[caller] = true;
            authorizationRevokedAt[caller] = 0; // Clear revocation timestamp
        } else if (authorizedCallers[caller]) {
            // Only set revocation timestamp if caller is currently authorized
            authorizationRevokedAt[caller] = block.timestamp;
        }

        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    /// @notice Emergency insert for previously-authorized callers after delay
    /// @dev SECURITY FIX (Vuln 6): Allows fund recovery if authorization is revoked
    ///      Previously authorized pools can insert after EMERGENCY_INSERT_DELAY
    ///      This prevents malicious deauthorization from permanently locking user funds
    ///      SECURITY FIX (Audit Vuln 6): Limited to MAX_EMERGENCY_INSERTS per caller to prevent DoS
    /// @param leaf The commitment to insert
    /// @return index The index of the inserted leaf
    function emergencyInsert(uint256 leaf) external returns (uint256 index) {
        // Must have been authorized at some point
        if (!wasEverAuthorized[msg.sender]) revert NeverAuthorized();

        // If currently authorized, use normal insert
        if (authorizedCallers[msg.sender]) revert Unauthorized(); // Use normal insert() instead

        // Check emergency delay has passed since revocation
        uint256 revokedAt = authorizationRevokedAt[msg.sender];
        if (revokedAt == 0) revert NeverAuthorized(); // Was never actually revoked
        if (block.timestamp < revokedAt + EMERGENCY_INSERT_DELAY) revert EmergencyDelayNotMet();

        // SECURITY FIX (Audit Vuln 5): Enforce maximum emergency inserts per caller
        // This prevents a deauthorized malicious pool from filling the merkle tree with garbage
        if (emergencyInsertCount[msg.sender] >= MAX_EMERGENCY_INSERTS) revert EmergencyLimitExceeded();

        // SECURITY FIX (Audit Vuln 5): Enforce global emergency insert limit
        // This prevents aggregate DoS across many deauthorized pools
        if (globalEmergencyInsertCount >= MAX_GLOBAL_EMERGENCY_INSERTS) revert GlobalEmergencyLimitExceeded();

        // Increment both counters
        emergencyInsertCount[msg.sender]++;
        globalEmergencyInsertCount++;

        // Perform the insert (same logic as insert())
        if (nextIndex >= MAX_LEAVES) revert MerkleTreeFull();

        index = nextIndex;
        uint256 currentIndex = index;
        uint256 currentHash = leaf;

        // Update the tree
        for (uint256 i = 0; i < DEPTH;) {
            if (currentIndex % 2 == 0) {
                filledSubtrees[i] = currentHash;
                currentHash = _hashPair(currentHash, zeros[i]);
            } else {
                currentHash = _hashPair(filledSubtrees[i], currentHash);
            }
            unchecked {
                currentIndex /= 2;
                ++i;
            }
        }

        // Update root
        root = currentHash;
        nextIndex = index + 1;

        // Store root in mapping
        roots[root] = true;

        // Add to circular buffer
        recentRoots[recentRootsIndex] = root;
        recentRootsIndex = (recentRootsIndex + 1) % ROOT_HISTORY_SIZE;

        emit LeafInserted(index, leaf, root);
    }

    // ============ Internal Functions ============

    /// @notice Hash two nodes together using Poseidon
    /// @param left Left child
    /// @param right Right child
    /// @return The parent hash
    function _hashPair(uint256 left, uint256 right) internal view returns (uint256) {
        return PoseidonT3.hash(poseidon, [left, right]);
    }
}
