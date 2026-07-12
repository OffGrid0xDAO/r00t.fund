// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./TokenPool.sol";
import "./PoseidonT3.sol";
import "./ZkParcelPool.sol";
import {ILandDepositVerifier, IClaimVerifier} from "./interfaces/IVerifier.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";

/// @notice Shared NullifierRegistry (the zkAMM uses the same instance).
/// @dev A note/commitment can be spent at most once across ALL rails — funding a plot
///      here, selling on the zkAMM, or claiming — because every rail marks in this set.
interface INullifierRegistry {
    function checkAndMark(uint256 nullifierHash) external returns (bool wasSpent);
    function isSpent(uint256 nullifierHash) external view returns (bool);
}

/// @notice The Land this vault funds. Supplies OTC pricing + treasury, and (as the wired
///         vault) lets us mint the parcel token on a parcel-claim.
interface ILand {
    function steward() external view returns (address);
    function treasury() external view returns (address);
    function parcelToken(bytes32 parcelId) external view returns (address);
    function rootPriceE6() external view returns (uint256);
    function ethPriceE6() external view returns (uint256);
    function mintRateE18() external view returns (uint256);
    function mintParcel(bytes32 parcelId, address to, uint256 amount) external;
}

/// @title LandVault
/// @author r00t.fund
/// @notice Virtuals-for-land, private. A steward BONDS $R00T into this vault (the reserve).
///         Patrons pay ETH/USDC to fund a parcel — 100% goes to the land treasury (the
///         ground) — and receive a SHIELDED commitment they can later CLAIM to ANY wallet,
///         with no on-chain link to the funding address. At claim time the holder chooses:
///           • R00T          — the OTC floor, paid from the steward's bonded reserve.
///                             Only after the parcel is FULLY FUNDED; irreversible.
///           • parcel token  — the upside, minted by the Land; trade it on the parcel/R00T
///                             pool. Available any time.
///         The choice is one-shot: a single shared nullifier means claiming one path burns
///         the other (and the same underlying can't also be spent on the zkAMM).
///
/// Soundness:
///   • Value+parcel binding (LandDeposit circuit): a commitment can never be claimed for
///     more R00T than paid, nor for a different parcel.
///   • Reserve solvency: committedR00T ≤ reserveR00T at all times, so every R00T claim is
///     payable. The steward can only withdraw FREE (uncommitted) reserve.
///   • One-shot: shared NullifierRegistry.checkAndMark reverts on any second spend.
contract LandVault is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ── immutable wiring ──
    ILand public immutable land;
    IERC20 public immutable root;              // $R00T
    IERC20 public immutable usdc;              // USDG / USDC (6dp)
    INullifierRegistry public immutable nullifierRegistry; // SHARED with the zkAMM
    ILandDepositVerifier public immutable depositVerifier;
    IClaimVerifier public immutable claimVerifier;
    TokenPool public immutable pledgePool;     // this vault's own commitment tree

    // ── ZkParcelPool wiring (private parcel↔R00T AMM, seeded on full-funding) ──
    address public immutable swapVerifier;         // deployed RealSwapVerifier (for pools)
    address public immutable r00tDepositVerifier;  // deployed RealDepositVerifier (pool shield)
    address public immutable withdrawVerifier;     // deployed RealWithdrawVerifier (pool exit)
    address public immutable poseidon;             // shared Poseidon for pool trees
    mapping(bytes32 => address) public zkParcelPoolByParcel;

    // ── reserve accounting (R00T-denominated) ──
    uint256 public reserveR00T;                // steward-bonded R00T held here, backs claims
    uint256 public committedR00T;              // outstanding R00T liability (≤ reserveR00T)
    mapping(bytes32 => uint256) public raisedR00TByParcel;  // monotonic; drives full-funding gate
    mapping(bytes32 => uint256) public parcelTargetR00T;    // steward-set full-funding target
    mapping(uint256 => bool) public knownCommitment;        // dup guard

    // ── events (indexer) ──
    event ReserveFunded(uint256 amount, uint256 reserveR00T);
    event ReserveWithdrawn(address indexed to, uint256 amount, uint256 reserveR00T);
    event ParcelTargetSet(bytes32 indexed parcelId, uint256 targetR00T);
    event Funded(uint256 indexed commitment, uint256 indexed leafIndex, bytes32 parcelId, uint256 rootOut, uint256 paid, address payToken, bytes note);
    event ClaimedR00T(uint256 indexed nullifierHash, address indexed recipient, bytes32 parcelId, uint256 amount);
    event ClaimedParcelToken(uint256 indexed nullifierHash, address indexed recipient, bytes32 parcelId, uint256 parcelOut);

    error NotSteward();
    error ZeroAmount();
    error ZeroAddress();
    error UnknownParcel();
    error FieldRange();
    error DuplicateCommitment();
    error InsufficientReserve();
    error InvalidProof();
    error UnknownMerkleRoot();
    error InsufficientPayment();
    error PaymentFailed();
    error RecipientMismatch();
    error NotFullyFunded();
    error OverCommitted();
    error TargetLocked();

    modifier onlySteward() {
        if (msg.sender != land.steward()) revert NotSteward();
        _;
    }

    constructor(
        address _land,
        address _root,
        address _usdc,
        address _nullifierRegistry,
        address _depositVerifier,
        address _claimVerifier,
        address _swapVerifier,
        address _r00tDepositVerifier,
        address _withdrawVerifier
    ) {
        if (
            _land == address(0) || _root == address(0) || _usdc == address(0)
                || _nullifierRegistry == address(0) || _depositVerifier == address(0) || _claimVerifier == address(0)
                || _swapVerifier == address(0) || _r00tDepositVerifier == address(0) || _withdrawVerifier == address(0)
        ) revert ZeroAddress();
        land = ILand(_land);
        root = IERC20(_root);
        usdc = IERC20(_usdc);
        nullifierRegistry = INullifierRegistry(_nullifierRegistry);
        depositVerifier = ILandDepositVerifier(_depositVerifier);
        claimVerifier = IClaimVerifier(_claimVerifier);
        swapVerifier = _swapVerifier;
        r00tDepositVerifier = _r00tDepositVerifier;
        withdrawVerifier = _withdrawVerifier;
        address poseidonAddr = PoseidonT3Deployer.deploy();
        poseidon = poseidonAddr;
        pledgePool = new TokenPool(poseidonAddr); // vault is deployer => sole authorized inserter
    }

    function _inField(uint256 x) private pure returns (bool) {
        return x < SNARK_SCALAR_FIELD;
    }

    // ── steward: bond / manage the R00T reserve ──

    /// @notice Steward bonds R00T into the vault (Virtuals-style seed). Requires prior approve.
    function fundReserve(uint256 amount) external onlySteward {
        if (amount == 0) revert ZeroAmount();
        root.safeTransferFrom(msg.sender, address(this), amount);
        reserveR00T += amount;
        emit ReserveFunded(amount, reserveR00T);
    }

    /// @notice Withdraw FREE (uncommitted) reserve — e.g. R00T freed when funders take the
    ///         parcel-token path, to seed the parcel/R00T pool. Can never touch committed R00T.
    function withdrawReserve(address to, uint256 amount) external onlySteward nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > reserveR00T - committedR00T) revert InsufficientReserve();
        reserveR00T -= amount;
        root.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount, reserveR00T);
    }

    /// @notice Set a parcel's full-funding target (R00T-equivalent). R00T claims for the
    ///         parcel unlock once raisedR00TByParcel ≥ target.
    /// @dev Lockable-on-funding: once ANY funding has landed for the parcel the target is
    ///      frozen, so a steward can never move the goalposts to deny patrons the R00T floor.
    function setParcelTarget(bytes32 parcelId, uint256 targetR00T) external onlySteward {
        if (targetR00T == 0) revert ZeroAmount();
        if (land.parcelToken(parcelId) == address(0)) revert UnknownParcel();
        if (raisedR00TByParcel[parcelId] != 0) revert TargetLocked();
        parcelTargetR00T[parcelId] = targetR00T;
        emit ParcelTargetSet(parcelId, targetR00T);
    }

    event ZkParcelPoolSeeded(bytes32 indexed parcelId, address indexed pool, uint256 r00tSeed, uint256 parcelSeed);
    error AlreadyHasPool();

    /// @notice Once a parcel is FULLY FUNDED, spin up its private parcel↔R00T AMM (ZkParcelPool)
    ///         and seed it: R00T from the vault's FREE reserve + freshly minted parcel tokens
    ///         (at the OTC mint rate) so the opening price matches the funding valuation. Buyers
    ///         then trade the parcel token shielded, exactly like $R00T. One-shot per parcel.
    /// @dev After this, GOVERNANCE must authorize the pool in the shared NullifierRegistry
    ///      (setPoolAuthorization) before swaps/withdraws can mark nullifiers — see ZkParcelPoolSeeded.
    function seedZkParcelPool(bytes32 parcelId, uint256 r00tSeed, uint256 parcelSeed)
        external
        onlySteward
        nonReentrant
        returns (address pool)
    {
        uint256 target = parcelTargetR00T[parcelId];
        if (target == 0 || raisedR00TByParcel[parcelId] < target) revert NotFullyFunded();
        if (zkParcelPoolByParcel[parcelId] != address(0)) revert AlreadyHasPool();
        if (r00tSeed == 0 || parcelSeed == 0) revert ZeroAmount();
        // R00T seed must come from FREE (uncommitted) reserve so claims stay fully backed.
        if (r00tSeed > reserveR00T - committedR00T) revert InsufficientReserve();

        pool = address(new ZkParcelPool(
            parcelId, address(root), land.parcelToken(parcelId),
            swapVerifier, r00tDepositVerifier, withdrawVerifier,
            address(nullifierRegistry), address(this), poseidon
        ));
        zkParcelPoolByParcel[parcelId] = pool;

        // Seed reserves: move free R00T out of the vault + mint parcel tokens straight to the pool.
        reserveR00T -= r00tSeed;
        root.safeTransfer(pool, r00tSeed);
        land.mintParcel(parcelId, pool, parcelSeed);
        ZkParcelPool(pool).seed();

        emit ZkParcelPoolSeeded(parcelId, pool, r00tSeed, parcelSeed);
    }

    // ── funding: ETH/USDC → treasury, shielded R00T commitment ──

    /// @notice Fund `parcelId` with ETH. 100% of the required ETH goes to the land treasury;
    ///         excess is refunded. Inserts a value+parcel-bound shielded commitment.
    /// @param parcelId   parcel being funded
    /// @param rootOut    R00T-equivalent bought at the OTC rate (bound inside `commitment`)
    /// @param commitment Poseidon(nullifier, secret, parcelId, rootOut)
    /// @param binding    LandDeposit output = Poseidon(parcelId, rootOut, commitment)
    /// @param depositProof groth16 proof for the LandDeposit circuit
    /// @param note       encrypted note for the indexer/claimer (opaque)
    function otcFundETH(
        bytes32 parcelId,
        uint256 rootOut,
        uint256 commitment,
        uint256 binding,
        uint256[8] calldata depositProof,
        bytes calldata note
    ) external payable nonReentrant whenNotPaused {
        uint256 ethNeeded = FullMath.mulDivRoundingUp(rootOut, land.rootPriceE6(), land.ethPriceE6());
        if (msg.value < ethNeeded) revert InsufficientPayment();

        _recordFund(parcelId, rootOut, commitment, binding, depositProof, ethNeeded, address(0), note);

        (bool ok, ) = land.treasury().call{value: ethNeeded}("");
        if (!ok) revert PaymentFailed();
        if (msg.value > ethNeeded) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - ethNeeded}("");
            if (!refunded) revert PaymentFailed();
        }
    }

    /// @notice Fund `parcelId` with USDC/USDG (6dp). 100% goes to the land treasury.
    function otcFundUSDC(
        bytes32 parcelId,
        uint256 rootOut,
        uint256 commitment,
        uint256 binding,
        uint256[8] calldata depositProof,
        bytes calldata note
    ) external nonReentrant whenNotPaused {
        // usd6 owed == rootOut * rootPriceE6 / 1e18 (USDG is 6dp == USD6). Round up, favor treasury.
        uint256 usdcNeeded = FullMath.mulDivRoundingUp(rootOut, land.rootPriceE6(), 1e18);
        _recordFund(parcelId, rootOut, commitment, binding, depositProof, usdcNeeded, address(usdc), note);
        usdc.safeTransferFrom(msg.sender, land.treasury(), usdcNeeded);
    }

    function _recordFund(
        bytes32 parcelId,
        uint256 rootOut,
        uint256 commitment,
        uint256 binding,
        uint256[8] calldata depositProof,
        uint256 paid,
        address payToken,
        bytes calldata note
    ) internal {
        // ── Checks ──
        if (rootOut == 0) revert ZeroAmount();
        if (!_inField(commitment) || !_inField(binding) || !_inField(uint256(parcelId)) || !_inField(rootOut)) revert FieldRange();
        if (land.parcelToken(parcelId) == address(0)) revert UnknownParcel();
        if (knownCommitment[commitment]) revert DuplicateCommitment();
        // Solvency: never promise more R00T than the reserve can back.
        if (committedR00T + rootOut > reserveR00T) revert OverCommitted();
        // Value+parcel binding: commitment provably encodes (parcelId, rootOut).
        uint256[4] memory pub = [binding, uint256(parcelId), rootOut, commitment];
        if (!depositVerifier.verifyProof(depositProof, pub)) revert InvalidProof();

        // ── Effects ──
        knownCommitment[commitment] = true;
        committedR00T += rootOut;
        raisedR00TByParcel[parcelId] += rootOut;
        uint256 leafIndex = pledgePool.insert(commitment);

        emit Funded(commitment, leafIndex, parcelId, rootOut, paid, payToken, note);
    }

    // ── claiming: pick R00T (floor, gated) or parcel token (upside, any time) ──

    /// @param pubSignals [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient]
    function claimR00T(
        uint256[8] calldata proof,
        uint256[6] calldata pubSignals,
        address recipient
    ) external nonReentrant {
        (bytes32 parcelId, uint256 nullifierHash, uint256 amount) = _verifyClaim(proof, pubSignals, recipient);

        // Full-funding gate — R00T floor only unlocks once the parcel is fully funded.
        uint256 target = parcelTargetR00T[parcelId];
        if (target == 0 || raisedR00TByParcel[parcelId] < target) revert NotFullyFunded();

        // ── Effects (CEI): shared nullifier first (one-shot), then reserve accounting ──
        nullifierRegistry.checkAndMark(nullifierHash);
        // committed ≤ reserve invariant guarantees this cannot underflow for a valid claim.
        committedR00T -= amount;
        reserveR00T -= amount;

        // ── Interactions ──
        root.safeTransfer(recipient, amount);
        emit ClaimedR00T(nullifierHash, recipient, parcelId, amount);
    }

    /// @notice Claim the parcel token instead of R00T (upside path; no full-funding gate).
    ///         The would-be R00T is freed back to the reserve (funder chose the token).
    function claimParcelToken(
        uint256[8] calldata proof,
        uint256[6] calldata pubSignals,
        address recipient
    ) external nonReentrant {
        (bytes32 parcelId, uint256 nullifierHash, uint256 amount) = _verifyClaim(proof, pubSignals, recipient);

        // ── Effects: shared nullifier (one-shot vs R00T claim + zkAMM), free the liability ──
        nullifierRegistry.checkAndMark(nullifierHash);
        committedR00T -= amount; // reserveR00T unchanged: freed R00T stays for pool-seeding

        // ── Interactions: mint parcel tokens at the OTC mint rate ──
        uint256 parcelOut = FullMath.mulDiv(amount, land.mintRateE18(), 1e18);
        land.mintParcel(parcelId, recipient, parcelOut);
        emit ClaimedParcelToken(nullifierHash, recipient, parcelId, parcelOut);
    }

    /// @dev Shared claim validation for both paths. Returns (parcelId, nullifierHash, amount).
    function _verifyClaim(
        uint256[8] calldata proof,
        uint256[6] calldata pubSignals,
        address recipient
    ) internal view returns (bytes32 parcelId, uint256 nullifierHash, uint256 amount) {
        for (uint256 i = 0; i < 6; i++) {
            if (!_inField(pubSignals[i])) revert FieldRange();
        }
        uint256 merkleRoot = pubSignals[1];
        nullifierHash = pubSignals[2];
        uint256 parcelField = pubSignals[3];
        amount = pubSignals[4];
        uint256 recipientField = pubSignals[5];

        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (recipientField != uint256(uint160(recipient))) revert RecipientMismatch();
        parcelId = bytes32(parcelField);
        if (land.parcelToken(parcelId) == address(0)) revert UnknownParcel();
        // The commitment must live in THIS vault's pledge tree (a known historical root).
        if (!pledgePool.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (!claimVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();
    }

    // ── admin ──
    function pause() external onlySteward { _pause(); }
    function unpause() external onlySteward { _unpause(); }

    // ── views ──
    function pledgeRoot() external view returns (uint256) { return pledgePool.getRoot(); }
    function pledgeTree() external view returns (address) { return address(pledgePool); }
    function freeReserveR00T() external view returns (uint256) { return reserveR00T - committedR00T; }
    function isParcelFullyFunded(bytes32 parcelId) external view returns (bool) {
        uint256 t = parcelTargetR00T[parcelId];
        return t != 0 && raisedR00TByParcel[parcelId] >= t;
    }
}
