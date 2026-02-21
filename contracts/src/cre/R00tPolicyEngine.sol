// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";

/// @title R00tPolicyEngine
/// @author r00t.fund
/// @notice On-chain compliance oracle for privacy-preserving transfer authorization
/// @dev Adapted from Chainlink ACE (Anonymous Compliant Exchange) PolicyEngine pattern.
///
///      Architecture:
///      1. Compliance attestations are stored as hashed identifiers (privacy-preserving)
///      2. CRE DON queries this contract off-chain via EVMClient.callContract() (eth_call)
///      3. If compliant, CRE authorizes the private transfer via CompliantPrivateVault
///      4. Actual identity data never stored on-chain — only compliance status hashes
///
///      Compliance Sources (via CRE ConfidentialHTTPClient):
///      - Sanctions screening (OFAC SDN, EU consolidated sanctions list)
///      - KYC/AML attestation providers (Chainlink DECO, zkKYC providers)
///      - Jurisdiction checks (EU MiCA, Portuguese CMVM compliance)
///      - Carbon credit regulatory compliance (EU ETS participant verification)
///
///      Privacy Model:
///      - addressHash = keccak256(abi.encodePacked(address, salt)) — salt known only to user + CRE
///      - Compliance level stored, not identity
///      - CRE DON has encrypted access to full compliance data via vaultDonSecrets
///      - On-chain contract only stores boolean/enum compliance status
contract R00tPolicyEngine is R00tCREReceiver {
    // ============ Enums ============

    /// @notice Compliance levels for graduated access
    enum ComplianceLevel {
        NONE,           // No compliance attestation
        BASIC,          // Basic sanctions check passed
        STANDARD,       // KYC Level 1 + sanctions clear
        ENHANCED,       // KYC Level 2 + enhanced due diligence
        INSTITUTIONAL   // Full institutional compliance (MiCA, CMVM)
    }

    /// @notice Transfer types with different compliance requirements
    enum TransferType {
        DEPOSIT,        // Public → private (requires BASIC+)
        WITHDRAWAL,     // Private → public (requires STANDARD+)
        PRIVATE_TRANSFER, // Private → private (requires STANDARD+)
        VAULT_TRANSFER, // Vault → vault (requires ENHANCED+)
        CROSS_BORDER    // Cross-jurisdiction (requires INSTITUTIONAL)
    }

    // ============ Structs ============

    /// @notice Compliance attestation for an address hash
    struct ComplianceAttestation {
        ComplianceLevel level;
        uint256 attestedAt;          // Timestamp of attestation
        uint256 expiresAt;           // Attestation expiry (must be refreshed)
        bytes32 attestationHash;     // Hash of full compliance data (off-chain verifiable)
        bool sanctionsCleared;       // OFAC + EU sanctions check passed
        bool jurisdictionApproved;   // User's jurisdiction is approved
        uint8 riskScore;             // 0-100 risk score (lower = better)
        bool active;                 // Whether attestation is active
    }

    /// @notice Transfer policy configuration
    struct TransferPolicy {
        ComplianceLevel minLevel;    // Minimum compliance level required
        uint256 maxAmountPerTx;      // Maximum single transfer amount (wei)
        uint256 maxAmountPerDay;     // Maximum daily transfer volume (wei)
        uint8 maxRiskScore;          // Maximum acceptable risk score
        bool requireSanctionsCheck;  // Whether sanctions check is mandatory
        bool requireJurisdiction;    // Whether jurisdiction approval is mandatory
        bool active;                 // Whether this policy is active
    }

    // ============ State ============

    /// @notice Compliance attestations by address hash
    /// @dev addressHash = keccak256(abi.encodePacked(address, salt))
    mapping(bytes32 => ComplianceAttestation) public attestations;

    /// @notice Transfer policies by transfer type
    mapping(TransferType => TransferPolicy) public policies;

    /// @notice Daily transfer volume tracking by address hash
    /// @dev Maps addressHash → day (block.timestamp / 1 days) → cumulative amount
    mapping(bytes32 => mapping(uint256 => uint256)) public dailyVolume;

    /// @notice Globally blocked address hashes (emergency sanctions)
    mapping(bytes32 => bool) public blockedAddresses;

    /// @notice Approved jurisdictions (ISO 3166-1 alpha-2 country code hash)
    mapping(bytes32 => bool) public approvedJurisdictions;

    /// @notice Total compliance attestations issued
    uint256 public totalAttestations;

    /// @notice Total transfers authorized
    uint256 public totalAuthorized;

    /// @notice Total transfers denied
    uint256 public totalDenied;

    /// @notice Authorized compliance attesters (CRE DON forwarders or oracles)
    mapping(address => bool) public authorizedAttesters;

    // ============ Events ============

    event ComplianceAttested(
        bytes32 indexed addressHash,
        ComplianceLevel level,
        uint256 expiresAt,
        bytes32 attestationHash
    );

    event ComplianceRevoked(
        bytes32 indexed addressHash,
        string reason
    );

    event TransferAuthorized(
        bytes32 indexed fromHash,
        bytes32 indexed toHash,
        TransferType transferType,
        uint256 amount
    );

    event TransferDenied(
        bytes32 indexed fromHash,
        bytes32 indexed toHash,
        TransferType transferType,
        string reason
    );

    event PolicyUpdated(
        TransferType indexed transferType,
        ComplianceLevel minLevel,
        uint256 maxAmountPerTx
    );

    event AddressBlocked(bytes32 indexed addressHash);
    event AddressUnblocked(bytes32 indexed addressHash);
    event JurisdictionUpdated(bytes32 indexed jurisdictionHash, bool approved);
    event AttesterUpdated(address indexed attester, bool authorized);

    // ============ Errors ============

    error AttestationExpired();
    error InsufficientComplianceLevel();
    error ExceedsTransferLimit();
    error ExceedsDailyLimit();
    error SanctionsCheckRequired();
    error JurisdictionNotApproved();
    error AddressIsBlocked();
    error RiskScoreTooHigh();
    error PolicyNotActive();
    error UnauthorizedAttester();

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner
    ) R00tCREReceiver(_donForwarder, _owner) {
        // Initialize default transfer policies
        _initializeDefaultPolicies();

        // Authorize the DON forwarder as an attester
        authorizedAttesters[_donForwarder] = true;

        // Approve EU/EEA jurisdictions by default
        _initializeApprovedJurisdictions();
    }

    // ============ CRE Callback — Compliance Attestation ============

    /// @notice Receive a compliance attestation from the CRE DON
    /// @dev Called by the DON forwarder after off-chain compliance checks pass
    /// @param addressHash Privacy-preserving hash of (address, salt)
    /// @param level Compliance level attested
    /// @param validityPeriod How long the attestation is valid (seconds)
    /// @param attestationHash Hash of full compliance data (for off-chain verification)
    /// @param sanctionsCleared Whether sanctions check passed
    /// @param jurisdictionHash Hash of user's jurisdiction code
    /// @param riskScore Risk score (0-100)
    function attestCompliance(
        bytes32 addressHash,
        ComplianceLevel level,
        uint256 validityPeriod,
        bytes32 attestationHash,
        bool sanctionsCleared,
        bytes32 jurisdictionHash,
        uint8 riskScore
    ) external whenNotPaused {
        if (!authorizedAttesters[msg.sender]) revert UnauthorizedAttester();
        if (blockedAddresses[addressHash]) revert AddressIsBlocked();

        _recordReport();

        bool jurisdictionOk = approvedJurisdictions[jurisdictionHash];

        attestations[addressHash] = ComplianceAttestation({
            level: level,
            attestedAt: block.timestamp,
            expiresAt: block.timestamp + validityPeriod,
            attestationHash: attestationHash,
            sanctionsCleared: sanctionsCleared,
            jurisdictionApproved: jurisdictionOk,
            riskScore: riskScore,
            active: true
        });

        totalAttestations++;

        emit ComplianceAttested(addressHash, level, block.timestamp + validityPeriod, attestationHash);
    }

    // ============ Core Policy Check (Called by CRE via eth_call) ============

    /// @notice Check if a private transfer is allowed
    /// @dev CRE DON calls this via EVMClient.callContract() (eth_call) before authorizing
    /// @param fromHash Sender's address hash
    /// @param toHash Recipient's address hash (bytes32(0) for deposits/withdrawals)
    /// @param amount Transfer amount in wei
    /// @param transferType Type of transfer being requested
    /// @return allowed Whether the transfer is allowed
    /// @return reason Human-readable reason if denied
    function checkPrivateTransferAllowed(
        bytes32 fromHash,
        bytes32 toHash,
        uint256 amount,
        TransferType transferType
    ) external view returns (bool allowed, string memory reason) {
        // 1. Check global blocks
        if (blockedAddresses[fromHash]) {
            return (false, "Sender address is blocked");
        }
        if (toHash != bytes32(0) && blockedAddresses[toHash]) {
            return (false, "Recipient address is blocked");
        }

        // 2. Get transfer policy
        TransferPolicy storage policy = policies[transferType];
        if (!policy.active) {
            return (false, "Transfer type not active");
        }

        // 3. Check sender compliance
        ComplianceAttestation storage senderAtt = attestations[fromHash];
        if (!senderAtt.active) {
            return (false, "Sender has no compliance attestation");
        }
        if (block.timestamp > senderAtt.expiresAt) {
            return (false, "Sender compliance attestation expired");
        }
        if (uint8(senderAtt.level) < uint8(policy.minLevel)) {
            return (false, "Sender compliance level insufficient");
        }

        // 4. Check sanctions
        if (policy.requireSanctionsCheck && !senderAtt.sanctionsCleared) {
            return (false, "Sender sanctions check not cleared");
        }

        // 5. Check jurisdiction
        if (policy.requireJurisdiction && !senderAtt.jurisdictionApproved) {
            return (false, "Sender jurisdiction not approved");
        }

        // 6. Check risk score
        if (senderAtt.riskScore > policy.maxRiskScore) {
            return (false, "Sender risk score too high");
        }

        // 7. Check amount limits
        if (amount > policy.maxAmountPerTx) {
            return (false, "Exceeds per-transaction limit");
        }

        // 8. Check daily volume
        uint256 today = block.timestamp / 1 days;
        uint256 todayVolume = dailyVolume[fromHash][today];
        if (todayVolume + amount > policy.maxAmountPerDay) {
            return (false, "Exceeds daily volume limit");
        }

        // 9. Check recipient compliance (for transfers that have a recipient)
        if (toHash != bytes32(0)) {
            ComplianceAttestation storage recipientAtt = attestations[toHash];
            if (!recipientAtt.active) {
                return (false, "Recipient has no compliance attestation");
            }
            if (block.timestamp > recipientAtt.expiresAt) {
                return (false, "Recipient compliance attestation expired");
            }
            // Recipient needs at least BASIC level
            if (uint8(recipientAtt.level) < uint8(ComplianceLevel.BASIC)) {
                return (false, "Recipient compliance level insufficient");
            }
            if (policy.requireSanctionsCheck && !recipientAtt.sanctionsCleared) {
                return (false, "Recipient sanctions check not cleared");
            }
        }

        return (true, "");
    }

    /// @notice Record a completed transfer volume (called by CompliantPrivateVault via CRE)
    /// @param addressHash Address hash of the transferor
    /// @param amount Transfer amount
    function recordTransferVolume(
        bytes32 addressHash,
        uint256 amount
    ) external {
        if (!authorizedAttesters[msg.sender]) revert UnauthorizedAttester();
        uint256 today = block.timestamp / 1 days;
        dailyVolume[addressHash][today] += amount;
        totalAuthorized++;
    }

    // ============ View Functions ============

    /// @notice Get compliance attestation for an address hash
    function getAttestation(bytes32 addressHash) external view returns (ComplianceAttestation memory) {
        return attestations[addressHash];
    }

    /// @notice Check if an address hash has valid (non-expired) compliance
    function isCompliant(bytes32 addressHash) external view returns (bool) {
        ComplianceAttestation storage att = attestations[addressHash];
        return att.active && block.timestamp <= att.expiresAt && !blockedAddresses[addressHash];
    }

    /// @notice Get compliance level for an address hash
    function getComplianceLevel(bytes32 addressHash) external view returns (ComplianceLevel) {
        ComplianceAttestation storage att = attestations[addressHash];
        if (!att.active || block.timestamp > att.expiresAt) {
            return ComplianceLevel.NONE;
        }
        return att.level;
    }

    /// @notice Get daily transfer volume for an address hash
    function getDailyVolume(bytes32 addressHash) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        return dailyVolume[addressHash][today];
    }

    /// @notice Get transfer policy for a transfer type
    function getPolicy(TransferType transferType) external view returns (TransferPolicy memory) {
        return policies[transferType];
    }

    // ============ Admin Functions ============

    /// @notice Update a transfer policy
    function setPolicy(
        TransferType transferType,
        ComplianceLevel minLevel,
        uint256 maxAmountPerTx,
        uint256 maxAmountPerDay,
        uint8 maxRiskScore,
        bool requireSanctionsCheck,
        bool requireJurisdiction,
        bool active
    ) external onlyOwner {
        policies[transferType] = TransferPolicy({
            minLevel: minLevel,
            maxAmountPerTx: maxAmountPerTx,
            maxAmountPerDay: maxAmountPerDay,
            maxRiskScore: maxRiskScore,
            requireSanctionsCheck: requireSanctionsCheck,
            requireJurisdiction: requireJurisdiction,
            active: active
        });

        emit PolicyUpdated(transferType, minLevel, maxAmountPerTx);
    }

    /// @notice Revoke a compliance attestation
    function revokeCompliance(bytes32 addressHash, string calldata reason) external onlyOwner {
        attestations[addressHash].active = false;
        emit ComplianceRevoked(addressHash, reason);
    }

    /// @notice Block an address hash (emergency sanctions)
    function blockAddress(bytes32 addressHash) external onlyOwner {
        blockedAddresses[addressHash] = true;
        attestations[addressHash].active = false;
        emit AddressBlocked(addressHash);
    }

    /// @notice Unblock an address hash
    function unblockAddress(bytes32 addressHash) external onlyOwner {
        blockedAddresses[addressHash] = false;
        emit AddressUnblocked(addressHash);
    }

    /// @notice Update jurisdiction approval
    function setJurisdiction(bytes32 jurisdictionHash, bool approved) external onlyOwner {
        approvedJurisdictions[jurisdictionHash] = approved;
        emit JurisdictionUpdated(jurisdictionHash, approved);
    }

    /// @notice Update authorized attester
    function setAttester(address attester, bool authorized) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        authorizedAttesters[attester] = authorized;
        emit AttesterUpdated(attester, authorized);
    }

    // ============ Internal Initialization ============

    function _initializeDefaultPolicies() internal {
        // DEPOSIT: Public → Private (low barrier)
        policies[TransferType.DEPOSIT] = TransferPolicy({
            minLevel: ComplianceLevel.BASIC,
            maxAmountPerTx: 100 ether,
            maxAmountPerDay: 500 ether,
            maxRiskScore: 70,
            requireSanctionsCheck: true,
            requireJurisdiction: false,
            active: true
        });

        // WITHDRAWAL: Private → Public (standard compliance)
        policies[TransferType.WITHDRAWAL] = TransferPolicy({
            minLevel: ComplianceLevel.STANDARD,
            maxAmountPerTx: 50 ether,
            maxAmountPerDay: 200 ether,
            maxRiskScore: 50,
            requireSanctionsCheck: true,
            requireJurisdiction: true,
            active: true
        });

        // PRIVATE_TRANSFER: Private → Private (standard compliance)
        policies[TransferType.PRIVATE_TRANSFER] = TransferPolicy({
            minLevel: ComplianceLevel.STANDARD,
            maxAmountPerTx: 50 ether,
            maxAmountPerDay: 200 ether,
            maxRiskScore: 50,
            requireSanctionsCheck: true,
            requireJurisdiction: false,
            active: true
        });

        // VAULT_TRANSFER: Vault → Vault (enhanced compliance)
        policies[TransferType.VAULT_TRANSFER] = TransferPolicy({
            minLevel: ComplianceLevel.ENHANCED,
            maxAmountPerTx: 500 ether,
            maxAmountPerDay: 2000 ether,
            maxRiskScore: 30,
            requireSanctionsCheck: true,
            requireJurisdiction: true,
            active: true
        });

        // CROSS_BORDER: Cross-jurisdiction (institutional)
        policies[TransferType.CROSS_BORDER] = TransferPolicy({
            minLevel: ComplianceLevel.INSTITUTIONAL,
            maxAmountPerTx: 1000 ether,
            maxAmountPerDay: 5000 ether,
            maxRiskScore: 20,
            requireSanctionsCheck: true,
            requireJurisdiction: true,
            active: true
        });
    }

    function _initializeApprovedJurisdictions() internal {
        // EU/EEA member states + UK + Switzerland
        // Hashed as keccak256(abi.encodePacked("XX")) for privacy
        bytes2[32] memory countries = [
            bytes2("PT"), // Portugal
            bytes2("ES"), // Spain
            bytes2("FR"), // France
            bytes2("DE"), // Germany
            bytes2("IT"), // Italy
            bytes2("NL"), // Netherlands
            bytes2("BE"), // Belgium
            bytes2("AT"), // Austria
            bytes2("IE"), // Ireland
            bytes2("FI"), // Finland
            bytes2("SE"), // Sweden
            bytes2("DK"), // Denmark
            bytes2("PL"), // Poland
            bytes2("CZ"), // Czech Republic
            bytes2("GR"), // Greece
            bytes2("RO"), // Romania
            bytes2("HU"), // Hungary
            bytes2("BG"), // Bulgaria
            bytes2("HR"), // Croatia
            bytes2("SK"), // Slovakia
            bytes2("SI"), // Slovenia
            bytes2("LT"), // Lithuania
            bytes2("LV"), // Latvia
            bytes2("EE"), // Estonia
            bytes2("CY"), // Cyprus
            bytes2("MT"), // Malta
            bytes2("LU"), // Luxembourg
            bytes2("NO"), // Norway (EEA)
            bytes2("IS"), // Iceland (EEA)
            bytes2("LI"), // Liechtenstein (EEA)
            bytes2("CH"), // Switzerland
            bytes2("GB")  // United Kingdom
        ];

        for (uint256 i = 0; i < countries.length; i++) {
            bytes32 hash = keccak256(abi.encodePacked(countries[i]));
            approvedJurisdictions[hash] = true;
        }
    }
}
