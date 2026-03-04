// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";

/// @title WorldIDGatekeeper
/// @author r00t.fund
/// @notice Sybil-resistant identity verification via World ID + Chainlink CRE (Workflow 8)
/// @dev Prize Track: World ($5k) — "Best use of World ID with CRE"
///
///      CRE DON verifies World ID proofs off-chain via Worldcoin cloud API,
///      enabling World ID on ANY EVM chain (including Tenderly VNet).
///
///      Flow:
///      1. User generates ZK proof via IDKit (frontend)
///      2. User submits proof on-chain via requestVerification()
///      3. CRE W8 polls for PENDING requests
///      4. CRE calls Worldcoin cloud API → POST /api/v2/verify/{app_id}
///      5. CRE writes result on-chain via receiveVerificationResult()
///      6. LaunchpadGovernance checks isVerified(address) before createProposal()
contract WorldIDGatekeeper is R00tCREReceiver {
    // ============ Enums & Structs ============

    enum VerificationStatus { NONE, PENDING, VERIFIED, REJECTED }

    struct VerificationRequest {
        address requester;
        bytes32 nullifierHash;
        bytes32 merkleRoot;
        uint256[8] proof;
        string verificationLevel;
        VerificationStatus status;
        uint256 requestedAt;
        uint256 verifiedAt;
    }

    // ============ State ============

    /// @notice All verification requests by ID
    mapping(uint256 => VerificationRequest) public requests;

    /// @notice Next request ID
    uint256 public nextRequestId;

    /// @notice Verified humans mapping
    mapping(address => bool) public verifiedHumans;

    /// @notice Used nullifier hashes (sybil resistance — one person, one verification)
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Worldcoin app ID (for frontend reference)
    string public appId;

    /// @notice Total verified count
    uint256 public totalVerified;

    /// @notice Total pending count
    uint256 public totalPending;

    // ============ Events ============

    event VerificationRequested(
        uint256 indexed requestId,
        address indexed requester,
        bytes32 nullifierHash,
        string verificationLevel
    );

    event VerificationCompleted(
        uint256 indexed requestId,
        address indexed requester,
        bool verified,
        string reason
    );

    event VerificationRevoked(
        address indexed user,
        string reason
    );

    event AppIdUpdated(string oldAppId, string newAppId);

    // ============ Errors ============

    error NullifierAlreadyUsed();
    error AlreadyVerified();
    error InvalidNullifierHash();
    error InvalidRequest();

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner,
        string memory _appId
    ) R00tCREReceiver(_donForwarder, _owner) {
        appId = _appId;
    }

    // ============ User Functions ============

    /// @notice Submit a World ID proof for verification
    /// @param nullifierHash World ID nullifier hash (unique per person per action)
    /// @param merkleRoot World ID Semaphore merkle root
    /// @param proof World ID ZK proof (8 uint256s)
    /// @param verificationLevel "orb" or "device"
    /// @return requestId The ID of the verification request
    /// @dev PRIVACY NOTE (Vuln 5): Proof data (nullifierHash, merkleRoot, proof[8]) is stored
    ///      on-chain BEFORE CRE verification. The nullifierHash is derived from the user's World ID
    ///      identity — storing it permanently associates msg.sender with a World ID, even for rejected
    ///      requests. For production, consider a commit-reveal scheme where proof data is only
    ///      submitted to CRE DON off-chain.
    function requestVerification(
        bytes32 nullifierHash,
        bytes32 merkleRoot,
        uint256[8] calldata proof,
        string calldata verificationLevel
    ) external whenNotPaused returns (uint256 requestId) {
        if (nullifierHash == bytes32(0)) revert InvalidNullifierHash();
        if (usedNullifiers[nullifierHash]) revert NullifierAlreadyUsed();
        if (verifiedHumans[msg.sender]) revert AlreadyVerified();

        requestId = nextRequestId++;

        requests[requestId] = VerificationRequest({
            requester: msg.sender,
            nullifierHash: nullifierHash,
            merkleRoot: merkleRoot,
            proof: proof,
            verificationLevel: verificationLevel,
            status: VerificationStatus.PENDING,
            requestedAt: block.timestamp,
            verifiedAt: 0
        });

        totalPending++;

        emit VerificationRequested(requestId, msg.sender, nullifierHash, verificationLevel);
    }

    // ============ CRE Callback ============

    /// @notice Receive verification result from CRE DON
    /// @param requestId The request ID being resolved
    /// @param verified Whether the World ID proof was valid
    /// @param reason Human-readable reason (for rejections)
    function receiveVerificationResult(
        uint256 requestId,
        bool verified,
        string calldata reason
    ) external onlyDonForwarder whenNotPaused {
        VerificationRequest storage req = requests[requestId];
        if (req.status != VerificationStatus.PENDING) revert InvalidRequest();

        _recordReport();

        totalPending--;

        if (verified) {
            req.status = VerificationStatus.VERIFIED;
            req.verifiedAt = block.timestamp;
            verifiedHumans[req.requester] = true;
            usedNullifiers[req.nullifierHash] = true;
            totalVerified++;
        } else {
            req.status = VerificationStatus.REJECTED;
            req.verifiedAt = block.timestamp;
        }

        emit VerificationCompleted(requestId, req.requester, verified, reason);
    }

    // ============ View Functions ============

    /// @notice Check if a user is a verified human
    function isVerified(address user) external view returns (bool) {
        return verifiedHumans[user];
    }

    /// @notice Get request details
    function getRequest(uint256 requestId) external view returns (
        address requester,
        bytes32 nullifierHash,
        VerificationStatus status,
        string memory verificationLevel,
        uint256 requestedAt,
        uint256 verifiedAt
    ) {
        VerificationRequest storage req = requests[requestId];
        return (
            req.requester,
            req.nullifierHash,
            req.status,
            req.verificationLevel,
            req.requestedAt,
            req.verifiedAt
        );
    }

    /// @notice Get request status by ID
    function getRequestStatus(uint256 requestId) external view returns (uint8) {
        return uint8(requests[requestId].status);
    }

    // ============ Admin Functions ============

    /// @notice Revoke a user's verification (emergency)
    function revokeVerification(address user, string calldata reason) external onlyOwner {
        verifiedHumans[user] = false;
        if (totalVerified > 0) totalVerified--;
        emit VerificationRevoked(user, reason);
    }

    /// @notice Update the Worldcoin app ID
    function setAppId(string calldata _appId) external onlyOwner {
        string memory old = appId;
        appId = _appId;
        emit AppIdUpdated(old, _appId);
    }
}
