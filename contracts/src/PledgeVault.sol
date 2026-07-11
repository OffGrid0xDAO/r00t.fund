// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./TokenPool.sol";
import "./PoseidonT3.sol";
import {IPledgeVerifier, IClaimVerifier} from "./interfaces/IVerifier.sol";

/// @notice Minimal view of the SHARED NullifierRegistry the zkAMM also uses.
/// @dev CRITICAL-2: pledge SPEND nullifiers and CLAIM nullifiers are marked in the SAME
///      set the zkAMM sell/withdraw rails use, so a note can never be spent twice across
///      domains (e.g. sold on the zkAMM AND pledged). `checkAndMark` reverts if already spent.
interface INullifierRegistry {
    function checkAndMark(uint256 nullifierHash) external returns (bool wasSpent);
    function isSpent(uint256 nullifierHash) external view returns (bool);
}

/// @notice The zkAMM shielded R00T pool (source of pledged funds), as wired by Phase B.
/// @dev The vault only READS the source root and asks the pool to release the pledged R00T
///      to the land treasury. It never mutates the zkAMM commitment tree (see PHASE_C.md —
///      pre-split, no change output), keeping the cross-domain trust boundary tight.
interface IShieldedRootPool {
    function isKnownRoot(uint256 root) external view returns (bool);
    /// @notice Release `amount` R00T from the shielded pool to `to`. Phase B authorizes
    ///         ONLY this vault to call it, and only ever after a verified pledge proof +
    ///         a freshly-marked spend nullifier (CEI: this is the final interaction).
    function releaseForPledge(address to, uint256 amount) external;
}

/// @notice The Land the vault funds. Mints parcel tokens on claim; supplies the treasury.
interface ILand {
    function treasury() external view returns (address);
    function parcelToken(bytes32 parcelId) external view returns (address);
    function mintParcel(bytes32 parcelId, address to, uint256 amount) external;
}

/// @title PledgeVault
/// @author r00t.fund — PHASE C (anonymous plot funding)
/// @notice Fund a plot by SPENDING a shielded R00T note (100% credited to the land
///         treasury) and later CLAIM the equivalent parcel tokens to ANY wallet, with no
///         on-chain link between the funding act and the claim wallet.
///
/// Design (reuses Phase B's sound shielded pool — no new crypto trust beyond two circuits):
///   pledgePrivate: verify a pledge proof against the zkAMM source root + SHARED registry
///     → mark the spend nullifier → insert a parcel-/value-bound pledge commitment into this
///       vault's pledge tree → release the pledged R00T to the treasury. Emits PledgeCommitment.
///   claim:         verify a claim proof against THIS vault's pledge tree + SHARED registry
///     → mark the claim nullifier → mint EXACTLY the committed `amount` of EXACTLY `parcelId`'s
///       token to `recipient`. Emits PledgeClaimed.
///
/// Over-claim is cryptographically impossible: `amount` and `parcelId` are baked into the
/// pledge commitment (deposit-binding), each commitment is claimed at most once (nullifier),
/// and a per-parcel accounting cap (claimed ≤ raised) is enforced as defense-in-depth.
contract PledgeVault is ReentrancyGuard, Pausable {
    /// @notice BN254 scalar field — every public signal must be a canonical field element.
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ── immutable wiring ──
    ILand public immutable land;
    INullifierRegistry public immutable nullifierRegistry;
    IShieldedRootPool public immutable source; // zkAMM R00T pool
    IPledgeVerifier public immutable pledgeVerifier;
    IClaimVerifier public immutable claimVerifier;
    TokenPool public immutable pledgePool; // this vault's own commitment tree

    // ── accounting (R00T-denominated; separate from Land's public USD pledge ledger) ──
    mapping(bytes32 => uint256) public raisedRootByParcel;
    mapping(bytes32 => uint256) public claimedRootByParcel;
    /// @notice Guards against re-recording the same pledge commitment value twice.
    mapping(uint256 => bool) public knownPledgeCommitment;

    // ── frozen event ABIs (PHASE C → D indexer; see docs/REMEDIATION_PLAN.md §Interface) ──
    event PledgeCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes32 parcelId, bytes note);
    event PledgeClaimed(uint256 indexed nullifierHash, address indexed recipient, bytes32 parcelId, uint256 amount);

    error NotLand();
    error ZeroAmount();
    error ZeroAddress();
    error UnknownMerkleRoot();
    error InvalidProof();
    error FieldRange();            // a public signal is not a canonical field element
    error CreatorMismatch();       // proof.creator != msg.sender
    error RecipientMismatch();     // proof.recipient != recipient arg
    error ParcelMismatch();        // proof.parcelId != parcelId arg
    error UnknownParcel();         // Land has no token for this parcel
    error DuplicateCommitment();   // pledge commitment already recorded
    error OverClaim();             // claimed would exceed raised for this parcel

    /// @param _land              the Land this vault funds (also the parcel-token minter)
    /// @param _nullifierRegistry SHARED registry (same instance the zkAMM uses)
    /// @param _source            zkAMM shielded R00T pool (source of funds)
    /// @param _pledgeVerifier    RealPledgeVerifier
    /// @param _claimVerifier     RealClaimVerifier
    constructor(
        address _land,
        address _nullifierRegistry,
        address _source,
        address _pledgeVerifier,
        address _claimVerifier
    ) {
        if (
            _land == address(0) || _nullifierRegistry == address(0) || _source == address(0)
                || _pledgeVerifier == address(0) || _claimVerifier == address(0)
        ) revert ZeroAddress();
        land = ILand(_land);
        nullifierRegistry = INullifierRegistry(_nullifierRegistry);
        source = IShieldedRootPool(_source);
        pledgeVerifier = IPledgeVerifier(_pledgeVerifier);
        claimVerifier = IClaimVerifier(_claimVerifier);
        // Deploy our own Poseidon + commitment tree. As deployer we are its owner and the
        // sole authorized inserter (TokenPool authorizes its deployer).
        address poseidonAddr = PoseidonT3Deployer.deploy();
        pledgePool = new TokenPool(poseidonAddr);
    }

    function _inField(uint256 x) private pure returns (bool) {
        return x < SNARK_SCALAR_FIELD;
    }

    /// @notice Fund `parcelId` by spending a shielded R00T note. 100% of the pledged R00T is
    ///         credited to the land treasury; a parcel-/value-bound pledge commitment is
    ///         inserted so the funder can later claim parcel tokens to any wallet.
    /// @param parcelId   the parcel being funded (bytes32(field element) — must be < field)
    /// @param proof      groth16 proof (packed for Solidity)
    /// @param pubSignals [pledgeCommitment, publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, parcelId, creator]
    /// @param note       encrypted note payload for the indexer / claimer (opaque)
    function pledgePrivate(
        bytes32 parcelId,
        uint256[8] calldata proof,
        uint256[7] calldata pubSignals,
        bytes calldata note
    ) external nonReentrant whenNotPaused {
        uint256 pledgeCommitment = pubSignals[0];
        uint256 merkleRoot = pubSignals[2];
        uint256 nullifierHash = pubSignals[3];
        uint256 pledgeAmount = pubSignals[4];
        uint256 parcelField = pubSignals[5];
        uint256 creator = pubSignals[6];

        // ── Checks ──
        // Every public signal must be a canonical field element (defense against malformed
        // calldata that could otherwise be reduced mod p by the verifier).
        for (uint256 i = 0; i < 7; i++) {
            if (!_inField(pubSignals[i])) revert FieldRange();
        }
        if (pledgeAmount == 0) revert ZeroAmount();
        if (creator != uint256(uint160(msg.sender))) revert CreatorMismatch();
        if (parcelField != uint256(parcelId)) revert ParcelMismatch();
        if (land.parcelToken(parcelId) == address(0)) revert UnknownParcel();
        if (knownPledgeCommitment[pledgeCommitment]) revert DuplicateCommitment();
        // The source note must live in the zkAMM tree (a known historical root).
        if (!source.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (!pledgeVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // ── Effects ──
        knownPledgeCommitment[pledgeCommitment] = true;
        raisedRootByParcel[parcelId] += pledgeAmount;
        // Mark the SPEND nullifier in the SHARED registry (reverts if already spent — this is
        // the CRITICAL-2 cross-domain double-spend guard). Do this before external calls.
        nullifierRegistry.checkAndMark(nullifierHash);
        uint256 leafIndex = pledgePool.insert(pledgeCommitment);

        // ── Interactions ──
        // Release the pledged R00T from the shielded pool straight to the treasury (100%).
        source.releaseForPledge(land.treasury(), pledgeAmount);

        emit PledgeCommitment(pledgeCommitment, leafIndex, parcelId, note);
    }

    /// @notice Claim parcel tokens for a prior pledge to ANY wallet.
    /// @param proof      groth16 proof (packed for Solidity)
    /// @param pubSignals [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient]
    /// @param recipient  wallet that receives the minted parcel tokens (bound in the proof)
    function claim(
        uint256[8] calldata proof,
        uint256[6] calldata pubSignals,
        address recipient
    ) external nonReentrant whenNotPaused {
        uint256 merkleRoot = pubSignals[1];
        uint256 nullifierHash = pubSignals[2];
        uint256 parcelField = pubSignals[3];
        uint256 amount = pubSignals[4];
        uint256 recipientField = pubSignals[5];

        // ── Checks ──
        for (uint256 i = 0; i < 6; i++) {
            if (!_inField(pubSignals[i])) revert FieldRange();
        }
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (recipientField != uint256(uint160(recipient))) revert RecipientMismatch();
        bytes32 parcelId = bytes32(parcelField);
        if (land.parcelToken(parcelId) == address(0)) revert UnknownParcel();
        // The pledge commitment must live in THIS vault's pledge tree.
        if (!pledgePool.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (!claimVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // ── Effects ──
        // Mark the CLAIM nullifier in the SHARED registry FIRST — it is the PRIMARY
        // double-claim guard (reverts if already claimed). The registry is trusted,
        // immutable and callback-free, so calling it before the local state write does
        // not open a reentrancy path (we are also nonReentrant). Marking before the cap
        // ensures an exact double-claim is always rejected by the nullifier, not the cap.
        nullifierRegistry.checkAndMark(nullifierHash);
        // Defense-in-depth accounting cap: total claimed for a parcel can never exceed
        // total pledged (guards against any commitment-accounting bug independent of the
        // per-note nullifier).
        if (claimedRootByParcel[parcelId] + amount > raisedRootByParcel[parcelId]) revert OverClaim();
        claimedRootByParcel[parcelId] += amount;

        // ── Interactions ──
        // Mint EXACTLY the committed amount of EXACTLY this parcel's token to `recipient`.
        land.mintParcel(parcelId, recipient, amount);

        emit PledgeClaimed(nullifierHash, recipient, parcelId, amount);
    }

    // ── views ──
    function pledgeRoot() external view returns (uint256) { return pledgePool.getRoot(); }
    function pledgeTree() external view returns (address) { return address(pledgePool); }
}
