// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";

/// @title ConfidentialFundingVault
/// @author r00t.fund
/// @notice Privacy-preserving project funding with EU carbon credit verification (Workflow 1)
/// @dev Prize Track: Privacy ($16k)
///      Integrates with European Voluntary Carbon Market:
///      - Verra VCS Registry verification
///      - Gold Standard credit validation
///      - Portuguese Mercado Voluntário de Carbono (APA/Fundo Ambiental)
///      - EU ETS (CELE) compliance checking
///      - Article 6 Paris Agreement corresponding adjustments
///
///      CRE DON uses ConfidentialHTTPClient to query carbon registries with encrypted
///      API credentials, verifies project impact, and pushes attestations on-chain.
contract ConfidentialFundingVault is R00tCREReceiver {
    // ============ Structs ============

    struct ImpactAttestation {
        uint256 proposalId;
        uint256 impactScore;         // 0-1000 scale (includes EU + PT MVC scoring)
        bytes32 attestationHash;     // Hash of full attestation (includes registry data)
        bytes encryptedAttestation;  // Encrypted: Verra/GS/APA verification + EU compliance
        uint256 timestamp;
        bool verified;
    }

    /// @notice Carbon credit attribution linked to a verified project
    struct CarbonCreditAttestation {
        uint256 proposalId;
        uint256 creditsVerified;     // Total tCO2e verified across registries
        uint256 creditValueEur;      // Value in EUR cents (EU ETS reference price)
        uint256 impactScore;         // 0-1000 composite score
        bool verraVerified;          // Verified on Verra VCS
        bool goldStandardVerified;   // Verified on Gold Standard
        bool ptMvcRegistered;        // Registered in Portuguese voluntary carbon market
        bool article6Compatible;     // Paris Agreement Article 6.2 compliant
        uint256 timestamp;
    }

    struct FundingRecord {
        uint256 proposalId;
        uint256 amount;
        uint256 impactScore;
        uint256 timestamp;
    }

    // ============ State ============

    /// @notice Impact attestations by proposal ID
    mapping(uint256 => ImpactAttestation) public attestations;

    /// @notice Verified proposal IDs
    uint256[] public verifiedProposalIds;

    /// @notice Funding records
    FundingRecord[] public fundingRecords;

    /// @notice Minimum impact score for funding eligibility (default: 100/1000)
    uint256 public minImpactScore;

    /// @notice Carbon credit attestations by proposal ID
    mapping(uint256 => CarbonCreditAttestation) public carbonCredits;

    /// @notice Total verified carbon credits across all projects (tCO2e)
    uint256 public totalVerifiedCredits;

    /// @notice Total carbon credit value in EUR cents
    uint256 public totalCreditValueEur;

    /// @notice Count of projects registered in Portuguese MVC
    uint256 public ptMvcProjectCount;

    /// @notice LaunchpadGovernanceV2 address
    address public governance;

    /// @notice ZkAMMv3Pair address (for commitment insertion)
    address public zkAMMPair;

    // ============ Events ============

    event ConfidentialFundingDistributed(
        uint256 indexed proposalId,
        uint256 impactScore,
        bytes32 attestationHash,
        uint256 timestamp
    );

    event ImpactAttestationStored(
        uint256 indexed proposalId,
        uint256 impactScore,
        bytes32 attestationHash
    );

    event FundingReleased(
        uint256 indexed proposalId,
        uint256 amount,
        uint256 impactScore
    );

    event MinImpactScoreUpdated(uint256 oldScore, uint256 newScore);

    event CarbonCreditVerified(
        uint256 indexed proposalId,
        uint256 creditsVerified,
        uint256 creditValueEur,
        bool ptMvcRegistered,
        bool article6Compatible
    );

    // ============ Errors ============

    error InsufficientImpactScore();
    error ProposalAlreadyAttested();
    error ProposalNotAttested();

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner,
        address _governance,
        address _zkAMMPair
    ) R00tCREReceiver(_donForwarder, _owner) {
        if (_governance == address(0)) revert ZeroAddress();
        if (_zkAMMPair == address(0)) revert ZeroAddress();
        governance = _governance;
        zkAMMPair = _zkAMMPair;
        minImpactScore = 100; // 10% minimum
    }

    // ============ CRE Callback ============

    /// @notice Receive an environmental impact attestation from the CRE DON
    /// @param proposalId LaunchpadGovernanceV2 proposal ID
    /// @param impactScore Verified environmental impact score (0-1000)
    /// @param attestationHash Hash of the encrypted attestation data
    /// @param encryptedAttestation Encrypted environmental attestation (from ConfidentialHTTPClient)
    function receiveReport(
        uint256 proposalId,
        uint256 impactScore,
        bytes32 attestationHash,
        bytes calldata encryptedAttestation
    ) external onlyDonForwarder whenNotPaused {
        if (attestations[proposalId].verified) revert ProposalAlreadyAttested();

        _recordReport();

        attestations[proposalId] = ImpactAttestation({
            proposalId: proposalId,
            impactScore: impactScore,
            attestationHash: attestationHash,
            encryptedAttestation: encryptedAttestation,
            timestamp: block.timestamp,
            verified: true
        });

        verifiedProposalIds.push(proposalId);

        emit ImpactAttestationStored(proposalId, impactScore, attestationHash);
        emit ConfidentialFundingDistributed(
            proposalId,
            impactScore,
            attestationHash,
            block.timestamp
        );
    }

    // ============ View Functions ============

    /// @notice Get impact attestation for a proposal
    function getProjectAttestation(uint256 proposalId) external view returns (
        uint256 impactScore,
        bytes32 attestationHash,
        uint256 timestamp,
        bool verified
    ) {
        ImpactAttestation storage att = attestations[proposalId];
        return (att.impactScore, att.attestationHash, att.timestamp, att.verified);
    }

    /// @notice Check if a proposal has a verified impact attestation
    function isProposalVerified(uint256 proposalId) external view returns (bool) {
        return attestations[proposalId].verified;
    }

    /// @notice Check if a proposal meets the minimum impact score
    function meetsImpactThreshold(uint256 proposalId) external view returns (bool) {
        ImpactAttestation storage att = attestations[proposalId];
        return att.verified && att.impactScore >= minImpactScore;
    }

    /// @notice Get all verified proposal IDs
    function getVerifiedProposalIds() external view returns (uint256[] memory) {
        return verifiedProposalIds;
    }

    /// @notice Get count of verified proposals
    function getVerifiedCount() external view returns (uint256) {
        return verifiedProposalIds.length;
    }

    /// @notice Get carbon credit attestation for a proposal
    function getCarbonCredits(uint256 proposalId) external view returns (CarbonCreditAttestation memory) {
        return carbonCredits[proposalId];
    }

    /// @notice Get total verified carbon credits across all projects
    function getTotalVerifiedCredits() external view returns (uint256) {
        return totalVerifiedCredits;
    }

    /// @notice Get total carbon credit value in EUR
    function getTotalCreditValueEur() external view returns (uint256) {
        return totalCreditValueEur;
    }

    /// @notice Get count of Portuguese MVC registered projects
    function getPtMvcProjectCount() external view returns (uint256) {
        return ptMvcProjectCount;
    }

    // ============ Admin Functions ============

    /// @notice Update minimum impact score for funding eligibility
    function setMinImpactScore(uint256 _score) external onlyOwner {
        uint256 old = minImpactScore;
        minImpactScore = _score;
        emit MinImpactScoreUpdated(old, _score);
    }

    /// @notice Update governance address
    function setGovernance(address _governance) external onlyOwner {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
    }

    /// @notice Update ZkAMMPair address
    function setZkAMMPair(address _pair) external onlyOwner {
        if (_pair == address(0)) revert ZeroAddress();
        zkAMMPair = _pair;
    }

    /// @notice Receive ETH for funding
    receive() external payable {}
}
