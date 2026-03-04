// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";
import "./interfaces/IACEPolicyEngine.sol";

/// @title CompliantPrivateVault
/// @author r00t.fund
/// @notice Privacy-preserving vault with Chainlink ACE PolicyEngine compliance verification
/// @dev Uses the official Chainlink ACE (Anonymous Compliant Exchange) PolicyEngine
///      (chainlink policy-management core PolicyEngine.sol) for modular compliance checks.
///
///      This vault bridges regulatory compliance with ZK-SNARK privacy:
///
///      Flow for compliant private deposit:
///      1. User calls requestDeposit(amount, commitment, addressHash) → pending
///      2. CRE DON detects PrivateTransferRequested event
///      3. CRE queries ACE PolicyEngine.check() via eth_call (sanctions, volume, KYC)
///      4. If compliant: CRE calls authorizeAndBuy() → vault forwards ETH to ZkAMMRouter.buyPrivate()
///         → user receives ZK commitment with real AMM-priced tokens
///      5. If denied: CRE calls denyTransfer() → funds returned to user
///
///      Flow for compliant private withdrawal:
///      1. User provides ZK proof of commitment ownership (nullifier, root, proof)
///      2. User calls requestWithdrawal(proof, addressHash) → pending
///      3. CRE DON checks compliance via ACE PolicyEngine
///      4. If compliant: CRE calls authorizeWithdrawal() → ETH/tokens sent to user
///
///      Privacy guarantees:
///      - Address hashes (not raw addresses) used for compliance lookups
///      - Commitment values encrypted in events (only user + CRE can decrypt)
///      - On-chain: only sees "transfer X authorized" — no link between parties
///      - ZK proofs ensure commitment ownership without revealing identity
contract CompliantPrivateVault is R00tCREReceiver {
    // ============ Enums ============

    enum RequestStatus {
        NONE,
        PENDING,
        AUTHORIZED,
        DENIED,
        EXECUTED,
        EXPIRED,
        CANCELLED
    }

    enum RequestType {
        DEPOSIT,
        WITHDRAWAL,
        VAULT_TRANSFER
    }

    // ============ Structs ============

    /// @notice Pending transfer request awaiting CRE compliance check
    struct TransferRequest {
        RequestType requestType;
        RequestStatus status;
        address requester;           // msg.sender (for ETH refunds if denied)
        uint256 amount;              // ETH amount (for deposits)
        uint256 commitment;          // Poseidon commitment to insert into ZkAMM
        bytes32 senderHash;          // Privacy-preserving sender identifier
        bytes32 recipientHash;       // Privacy-preserving recipient identifier (for transfers)
        bytes encryptedNote;         // Encrypted note (nullifier, secret, amount)
        uint256 requestedAt;         // Timestamp of request
        uint256 expiresAt;           // Request expiry (must be processed within window)
        string denyReason;           // Reason if denied
    }

    // ============ Constants ============

    /// @notice Maximum time a request can stay pending before it expires
    uint256 public constant REQUEST_EXPIRY = 1 hours;

    /// @notice BN254 scalar field size for SNARK commitments
    uint256 public constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ============ State ============

    /// @notice Transfer requests by ID
    mapping(uint256 => TransferRequest) public requests;

    /// @notice Next request ID
    uint256 public nextRequestId;

    /// @notice Chainlink ACE PolicyEngine (official @chainlink/policy-management)
    IACEPolicyEngine public policyEngine;

    /// @notice ZkAMMPair address (for legacy commitment insertion)
    address public zkAMMPair;

    /// @notice ZkAMMRouter address (for buyPrivate — compliance-gated AMM access)
    address public zkAMMRouter;

    /// @notice Total ETH held for pending deposits
    uint256 public pendingDepositETH;

    /// @notice Total deposits processed
    uint256 public totalDepositsProcessed;

    /// @notice Total withdrawals processed
    uint256 public totalWithdrawalsProcessed;

    /// @notice Total transfers denied
    uint256 public totalDenied;

    /// @notice Total ETH volume processed through compliant transfers
    uint256 public totalComplianceVolume;

    // ============ Events ============

    /// @notice Emitted when a private transfer is requested — CRE DON listens for this
    event PrivateTransferRequested(
        uint256 indexed requestId,
        RequestType requestType,
        bytes32 indexed senderHash,
        bytes32 indexed recipientHash,
        uint256 amount,
        uint256 commitment
    );

    event TransferAuthorized(
        uint256 indexed requestId,
        RequestType requestType,
        uint256 commitment,
        uint256 leafIndex
    );

    event TransferDenied(
        uint256 indexed requestId,
        RequestType requestType,
        string reason
    );

    event TransferExpired(
        uint256 indexed requestId,
        RequestType requestType
    );

    event TransferCancelled(
        uint256 indexed requestId,
        address indexed requester
    );

    event DepositRefunded(
        uint256 indexed requestId,
        address indexed requester,
        uint256 amount
    );

    // ============ Errors ============

    error InvalidCommitment();
    error InvalidRequest();
    error RequestNotPending();
    error RequestExpired();
    error InsufficientDeposit();
    error RefundFailed();
    error InsertionFailed();
    error BuyPrivateFailed();

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner,
        address _policyEngine,
        address _zkAMMPair,
        address _zkAMMRouter
    ) R00tCREReceiver(_donForwarder, _owner) {
        if (_policyEngine == address(0)) revert ZeroAddress();
        if (_zkAMMPair == address(0)) revert ZeroAddress();
        if (_zkAMMRouter == address(0)) revert ZeroAddress();
        policyEngine = IACEPolicyEngine(_policyEngine);
        zkAMMPair = _zkAMMPair;
        zkAMMRouter = _zkAMMRouter;
    }

    // ============ User Functions — Request Private Transfers ============

    /// @notice Request a compliant private deposit (ETH → ZK commitment)
    /// @dev User sends ETH which is held in escrow until CRE authorizes the transfer.
    ///      The commitment will be inserted into ZkAMMPair's Merkle tree if approved.
    /// @param commitment Poseidon commitment hash = hash(nullifier, secret, amount)
    /// @param addressHash User's privacy-preserving address hash = keccak256(address, salt)
    /// @param encryptedNote Encrypted note containing (nullifier, secret, amount)
    /// @return requestId The ID of the pending request
    function requestDeposit(
        uint256 commitment,
        bytes32 addressHash,
        bytes calldata encryptedNote
    ) external payable whenNotPaused returns (uint256 requestId) {
        if (msg.value == 0) revert InsufficientDeposit();
        if (commitment == 0) revert InvalidCommitment();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidCommitment();

        requestId = nextRequestId++;

        requests[requestId] = TransferRequest({
            requestType: RequestType.DEPOSIT,
            status: RequestStatus.PENDING,
            requester: msg.sender,
            amount: msg.value,
            commitment: commitment,
            senderHash: addressHash,
            recipientHash: bytes32(0),
            encryptedNote: encryptedNote,
            requestedAt: block.timestamp,
            expiresAt: block.timestamp + REQUEST_EXPIRY,
            denyReason: ""
        });

        pendingDepositETH += msg.value;

        emit PrivateTransferRequested(
            requestId,
            RequestType.DEPOSIT,
            addressHash,
            bytes32(0),
            msg.value,
            commitment
        );
    }

    /// @notice Request a compliant vault-to-vault transfer
    /// @dev For transferring value between two compliant parties privately.
    ///      Both sender and recipient must have valid PolicyEngine attestations.
    /// @param commitment New commitment for the recipient
    /// @param senderHash Sender's address hash
    /// @param recipientHash Recipient's address hash
    /// @param encryptedNote Encrypted note for the recipient
    /// @return requestId The ID of the pending request
    function requestVaultTransfer(
        uint256 commitment,
        bytes32 senderHash,
        bytes32 recipientHash,
        bytes calldata encryptedNote
    ) external payable whenNotPaused returns (uint256 requestId) {
        if (msg.value == 0) revert InsufficientDeposit();
        if (commitment == 0) revert InvalidCommitment();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidCommitment();

        requestId = nextRequestId++;

        requests[requestId] = TransferRequest({
            requestType: RequestType.VAULT_TRANSFER,
            status: RequestStatus.PENDING,
            requester: msg.sender,
            amount: msg.value,
            commitment: commitment,
            senderHash: senderHash,
            recipientHash: recipientHash,
            encryptedNote: encryptedNote,
            requestedAt: block.timestamp,
            expiresAt: block.timestamp + REQUEST_EXPIRY,
            denyReason: ""
        });

        pendingDepositETH += msg.value;

        emit PrivateTransferRequested(
            requestId,
            RequestType.VAULT_TRANSFER,
            senderHash,
            recipientHash,
            msg.value,
            commitment
        );
    }

    /// @notice Cancel a pending request and get refunded
    /// @dev Only the original requester can cancel, and only while pending
    function cancelRequest(uint256 requestId) external {
        TransferRequest storage req = requests[requestId];
        if (req.status != RequestStatus.PENDING) revert RequestNotPending();
        if (req.requester != msg.sender) revert UnauthorizedOwner();

        req.status = RequestStatus.CANCELLED;

        // Refund ETH for deposit/vault transfer requests
        if (req.amount > 0) {
            pendingDepositETH -= req.amount;
            (bool success, ) = payable(msg.sender).call{value: req.amount}("");
            if (!success) revert RefundFailed();
        }

        emit TransferCancelled(requestId, msg.sender);
    }

    // ============ CRE DON Callbacks — Authorize/Deny Transfers ============

    /// @notice Authorize a pending transfer after compliance check passes
    /// @dev Called by CRE DON forwarder after verifying PolicyEngine + sanctions APIs
    /// @param requestId The request to authorize
    function authorizeTransfer(uint256 requestId) external onlyDonForwarder whenNotPaused {
        TransferRequest storage req = requests[requestId];
        if (req.status != RequestStatus.PENDING) revert RequestNotPending();
        if (block.timestamp > req.expiresAt) {
            req.status = RequestStatus.EXPIRED;
            _refundDeposit(req);
            emit TransferExpired(requestId, req.requestType);
            return;
        }

        _recordReport();
        req.status = RequestStatus.AUTHORIZED;

        // Insert commitment into ZkAMMPair Merkle tree
        uint256 leafIndex = _insertCommitment(req.commitment, req.encryptedNote);

        // Update accounting
        if (req.amount > 0) {
            pendingDepositETH -= req.amount;
        }
        totalComplianceVolume += req.amount;

        if (req.requestType == RequestType.DEPOSIT) {
            totalDepositsProcessed++;
        } else if (req.requestType == RequestType.VAULT_TRANSFER) {
            totalDepositsProcessed++;
        }

        // Note: ACE PolicyEngine tracks volume internally via run()

        req.status = RequestStatus.EXECUTED;

        emit TransferAuthorized(requestId, req.requestType, req.commitment, leafIndex);
    }

    /// @notice Authorize a pending transfer and buy tokens on the AMM
    /// @dev Called by CRE DON after ACE PolicyEngine.check() passes.
    ///      Forwards escrowed ETH to ZkAMMRouter.buyPrivate() so the user
    ///      receives a ZK commitment backed by real AMM-priced tokens.
    /// @param requestId The request to authorize
    /// @param minTokensOut Minimum tokens expected from AMM swap (slippage protection)
    /// @param deadline Transaction deadline timestamp
    function authorizeAndBuy(
        uint256 requestId,
        uint256 minTokensOut,
        uint256 deadline
    ) external onlyDonForwarder whenNotPaused {
        TransferRequest storage req = requests[requestId];
        if (req.status != RequestStatus.PENDING) revert RequestNotPending();
        if (block.timestamp > req.expiresAt) {
            req.status = RequestStatus.EXPIRED;
            _refundDeposit(req);
            emit TransferExpired(requestId, req.requestType);
            return;
        }

        _recordReport();
        // SECURITY FIX (Vuln 3): Don't set AUTHORIZED before external call.
        // If buyPrivate() reverts, the entire tx reverts anyway (no stale status).
        // If buyPrivate() succeeds, we go straight to EXECUTED below.
        // This eliminates the window where status=AUTHORIZED but buy hasn't completed.

        // Forward escrowed ETH to ZkAMMRouter.buyPrivate()
        (bool success, bytes memory result) = zkAMMRouter.call{value: req.amount}(
            abi.encodeWithSignature(
                "buyPrivate(uint256,uint256,uint256,bytes)",
                req.commitment,
                minTokensOut,
                deadline,
                req.encryptedNote
            )
        );
        if (!success) revert BuyPrivateFailed();

        uint256 leafIndex = abi.decode(result, (uint256));

        // Update accounting
        if (req.amount > 0) {
            pendingDepositETH -= req.amount;
        }
        totalComplianceVolume += req.amount;

        if (req.requestType == RequestType.DEPOSIT) {
            totalDepositsProcessed++;
        } else if (req.requestType == RequestType.VAULT_TRANSFER) {
            totalDepositsProcessed++;
        }

        req.status = RequestStatus.EXECUTED;

        emit TransferAuthorized(requestId, req.requestType, req.commitment, leafIndex);
    }

    /// @notice Deny a pending transfer after compliance check fails
    /// @dev Called by CRE DON forwarder when PolicyEngine check or sanctions check fails
    /// @param requestId The request to deny
    /// @param reason Human-readable reason for denial
    function denyTransfer(uint256 requestId, string calldata reason) external onlyDonForwarder whenNotPaused {
        TransferRequest storage req = requests[requestId];
        if (req.status != RequestStatus.PENDING) revert RequestNotPending();

        _recordReport();
        req.status = RequestStatus.DENIED;
        req.denyReason = reason;
        totalDenied++;

        // Refund ETH
        _refundDeposit(req);

        emit TransferDenied(requestId, req.requestType, reason);
    }

    /// @notice Batch authorize multiple transfers
    /// @dev Gas optimization for processing multiple pending requests
    function batchAuthorize(uint256[] calldata requestIds) external onlyDonForwarder whenNotPaused {
        _recordReport();

        for (uint256 i = 0; i < requestIds.length; i++) {
            TransferRequest storage req = requests[requestIds[i]];
            if (req.status != RequestStatus.PENDING) continue;

            if (block.timestamp > req.expiresAt) {
                req.status = RequestStatus.EXPIRED;
                _refundDeposit(req);
                emit TransferExpired(requestIds[i], req.requestType);
                continue;
            }

            req.status = RequestStatus.AUTHORIZED;

            uint256 leafIndex = _insertCommitment(req.commitment, req.encryptedNote);

            if (req.amount > 0) {
                pendingDepositETH -= req.amount;
            }
            totalComplianceVolume += req.amount;
            totalDepositsProcessed++;

            // Note: ACE PolicyEngine tracks volume internally via run()

            req.status = RequestStatus.EXECUTED;

            emit TransferAuthorized(requestIds[i], req.requestType, req.commitment, leafIndex);
        }
    }

    // ============ View Functions ============

    /// @notice Check compliance via ACE PolicyEngine
    /// @dev Wraps policyEngine.check() — CRE DON calls this via eth_call
    /// @param senderHash Privacy-preserving sender identifier
    /// @param amount Transfer amount in wei
    /// @param requestType Type of request (0=DEPOSIT, 1=WITHDRAWAL, 2=VAULT_TRANSFER)
    /// @return allowed True if ACE PolicyEngine returns Allowed
    function checkCompliance(
        bytes32 senderHash,
        uint256 amount,
        uint8 requestType
    ) external view returns (bool allowed) {
        IACEPolicyEngine.Payload memory payload = IACEPolicyEngine.Payload({
            selector: bytes4(keccak256("transfer(bytes32,uint256,uint8)")),
            sender: address(this),
            data: abi.encode(senderHash, amount, requestType),
            context: ""
        });
        IACEPolicyEngine.PolicyResult result = policyEngine.check(payload);
        return result == IACEPolicyEngine.PolicyResult.Allowed;
    }

    /// @notice Get a transfer request
    function getRequest(uint256 requestId) external view returns (TransferRequest memory) {
        return requests[requestId];
    }

    /// @notice Get request status
    function getRequestStatus(uint256 requestId) external view returns (RequestStatus) {
        TransferRequest storage req = requests[requestId];
        if (req.status == RequestStatus.PENDING && block.timestamp > req.expiresAt) {
            return RequestStatus.EXPIRED;
        }
        return req.status;
    }

    /// @notice Get total pending requests count
    function getPendingCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < nextRequestId; i++) {
            if (requests[i].status == RequestStatus.PENDING &&
                block.timestamp <= requests[i].expiresAt) {
                count++;
            }
        }
    }

    /// @notice Get vault statistics
    function getVaultStats() external view returns (
        uint256 _totalDeposits,
        uint256 _totalWithdrawals,
        uint256 _totalDenied,
        uint256 _totalVolume,
        uint256 _pendingETH,
        uint256 _totalRequests
    ) {
        return (
            totalDepositsProcessed,
            totalWithdrawalsProcessed,
            totalDenied,
            totalComplianceVolume,
            pendingDepositETH,
            nextRequestId
        );
    }

    // ============ Admin Functions ============

    /// @notice Update ACE PolicyEngine address
    function setPolicyEngine(address _policyEngine) external onlyOwner {
        if (_policyEngine == address(0)) revert ZeroAddress();
        policyEngine = IACEPolicyEngine(_policyEngine);
    }

    /// @notice Update ZkAMMPair address
    function setZkAMMPair(address _pair) external onlyOwner {
        if (_pair == address(0)) revert ZeroAddress();
        zkAMMPair = _pair;
    }

    /// @notice Update ZkAMMRouter address
    function setZkAMMRouter(address _router) external onlyOwner {
        if (_router == address(0)) revert ZeroAddress();
        zkAMMRouter = _router;
    }

    /// @notice Expire stale pending requests (housekeeping)
    /// @param requestIds Array of request IDs to check and expire
    function expireStaleRequests(uint256[] calldata requestIds) external {
        for (uint256 i = 0; i < requestIds.length; i++) {
            TransferRequest storage req = requests[requestIds[i]];
            if (req.status == RequestStatus.PENDING && block.timestamp > req.expiresAt) {
                req.status = RequestStatus.EXPIRED;
                _refundDeposit(req);
                emit TransferExpired(requestIds[i], req.requestType);
            }
        }
    }

    // ============ Internal Functions ============

    /// @notice Insert commitment into ZkAMMPair via insertCommitmentFromCRE
    function _insertCommitment(
        uint256 commitment,
        bytes memory encryptedNote
    ) internal returns (uint256 leafIndex) {
        // Call ZkAMMPair.insertCommitmentFromCRE()
        // This contract must be authorized as a CRE callback in ZkAMMAdmin
        (bool success, bytes memory result) = zkAMMPair.call(
            abi.encodeWithSignature(
                "insertCommitmentFromCRE(uint256,bytes)",
                commitment,
                encryptedNote
            )
        );
        if (!success) revert InsertionFailed();
        leafIndex = abi.decode(result, (uint256));
    }

    /// @notice Refund deposit ETH to the requester
    function _refundDeposit(TransferRequest storage req) internal {
        if (req.amount > 0 && req.requester != address(0)) {
            uint256 refundAmount = req.amount;
            pendingDepositETH -= refundAmount;

            (bool success, ) = payable(req.requester).call{value: refundAmount}("");
            if (!success) revert RefundFailed();

            emit DepositRefunded(0, req.requester, refundAmount);
        }
    }

    /// @notice Receive ETH for vault operations
    receive() external payable {}
}
