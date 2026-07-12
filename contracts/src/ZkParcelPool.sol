// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenPool.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapVerifier, IDepositVerifier, IWithdrawVerifier} from "./interfaces/IVerifier.sol";

/// @notice Shared global nullifier registry (same instance the zkAMM + LandVault use), so a
///         parcel/R00T note can never be double-spent across any rail.
interface IParcelNullifierRegistry {
    function checkAndMark(uint256 nullifierHash) external returns (bool wasSpent);
    function isSpent(uint256 nullifierHash) external view returns (bool);
}

/// @title ZkParcelPool
/// @author r00t.fund
/// @notice Self-contained PRIVATE AMM for a single parcel token (e.g. $OAK) against $R00T.
///         Fully shielded on both legs — no router, no Railgun, no new circuits. Reuses the
///         already-deployed swap / deposit / withdraw verifiers and the shared NullifierRegistry.
///
/// @dev ACCOUNTING MODEL (the key to being self-contained without double-counting):
///        realR00T   = root.balanceOf(this)   = r00tReserve   + (R00T backing outstanding R00T notes)
///        realParcel = parcel.balanceOf(this)  = parcelReserve + (parcel backing outstanding notes)
///      `r00tReserve`/`parcelReserve` are the AMM curve. Note-backing is the remainder of the real
///      balance. buy/sell only RESHUFFLE value between the curve and note-backing (no tokens leave
///      the pool). shield (R00T in) and withdraw (token out) are the ONLY real token movements.
///
/// @dev SECURITY INVARIANT (see plan): the swap circuit binds outputCommitment <-> outputAmount but
///      does NOT force outputAmount == getAmountOut() on-chain (outputAmount is private). This is
///      safe ONLY because output notes are pool-local — they are redeemable solely back through this
///      same pool (sell/withdraw) where reserves reconcile. Never insert this pool's notes into a
///      foreign tree, and never pay note value from the AMM reserve.
contract ZkParcelPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant FEE_BPS = 100;          // 1% swap fee (retained in reserve → benefits the pool)
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MIN_RESERVE = 1000;     // a reserve can never be swapped below this floor

    // ============ Immutables ============

    IERC20 public immutable root;             // $R00T
    IERC20 public immutable parcel;           // the parcel token (e.g. $OAK)
    bytes32 public immutable parcelId;
    ISwapVerifier public immutable swapVerifier;
    IDepositVerifier public immutable depositVerifier;
    IWithdrawVerifier public immutable withdrawVerifier;
    IParcelNullifierRegistry public immutable nullifierRegistry; // SHARED
    TokenPool public immutable parcelPool;    // commitments over parcel-token notes
    TokenPool public immutable r00tNotePool;  // commitments over R00T notes (sell output / buy change / shield)
    address public immutable creator;         // LandVault (seeder)

    // ============ State ============

    uint256 public r00tReserve;    // AMM curve reserve (R00T side)
    uint256 public parcelReserve;  // AMM curve reserve (parcel side)
    bool public seeded;

    // ============ Events ============

    event Seeded(uint256 r00tReserve, uint256 parcelReserve);
    event R00tShielded(uint256 indexed commitment, uint256 indexed leafIndex, uint256 amount, bytes note);
    event ParcelBought(uint256 indexed nullifierHash, uint256 r00tIn, uint256 parcelOut, uint256 indexed outCommitment);
    event ParcelSold(uint256 indexed nullifierHash, uint256 parcelIn, uint256 r00tOut, uint256 indexed outCommitment);
    event R00tWithdrawn(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    event ParcelWithdrawn(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    // NewCommitment mirrors the zkAMM event so the frontend tree scanner is reused unchanged.
    event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error NotCreator();
    error AlreadySeeded();
    error NotSeeded();
    error MinLiquidity();
    error InvalidProof();
    error UnknownMerkleRoot();
    error NullifierAlreadySpent();
    error SlippageExceeded();
    error InsufficientLiquidity();
    error InsufficientNoteBacking();
    error FieldRange();
    error Expired();

    // ============ Modifiers ============

    modifier onlyCreator() {
        if (msg.sender != creator) revert NotCreator();
        _;
    }

    modifier notExpired(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    // ============ Constructor ============

    constructor(
        bytes32 _parcelId,
        address _root,
        address _parcel,
        address _swapVerifier,
        address _depositVerifier,
        address _withdrawVerifier,
        address _nullifierRegistry,
        address _creator,
        address _poseidon
    ) {
        if (
            _root == address(0) || _parcel == address(0) || _swapVerifier == address(0)
                || _depositVerifier == address(0) || _withdrawVerifier == address(0)
                || _nullifierRegistry == address(0) || _creator == address(0) || _poseidon == address(0)
        ) revert ZeroAddress();

        parcelId = _parcelId;
        root = IERC20(_root);
        parcel = IERC20(_parcel);
        swapVerifier = ISwapVerifier(_swapVerifier);
        depositVerifier = IDepositVerifier(_depositVerifier);
        withdrawVerifier = IWithdrawVerifier(_withdrawVerifier);
        nullifierRegistry = IParcelNullifierRegistry(_nullifierRegistry);
        creator = _creator;

        // This contract is the sole authorized inserter for both trees (TokenPool authorizes its deployer).
        parcelPool = new TokenPool(_poseidon);
        r00tNotePool = new TokenPool(_poseidon);
    }

    // ============ Seeding (one-shot, by the LandVault) ============

    /// @notice Snapshot the real balances the LandVault just sent as the initial AMM reserves.
    /// @dev LandVault mints parcel seed to this pool + transfers R00T seed, THEN calls seed().
    function seed() external onlyCreator nonReentrant {
        if (seeded) revert AlreadySeeded();
        uint256 r = root.balanceOf(address(this));
        uint256 p = parcel.balanceOf(address(this));
        if (r <= MIN_RESERVE || p <= MIN_RESERVE) revert MinLiquidity();
        r00tReserve = r;
        parcelReserve = p;
        seeded = true;
        emit Seeded(r, p);
    }

    // ============ Shield: real R00T → shielded R00T note (entry point for buying) ============

    /// @notice Deposit public R00T and receive a shielded R00T note in r00tNotePool.
    /// @dev Uses the deposit-binding circuit so the note's amount provably equals the R00T pulled.
    ///      This is note-backing only — it does NOT change the AMM reserve.
    /// @param amount R00T to deposit (pulled via transferFrom; caller must approve)
    /// @param commitment note commitment = Poseidon(nullifier, secret, amount)
    /// @param binding deposit-proof binding = Poseidon(amount, commitment)
    /// @param depositProof Groth16 proof for the deposit-binding circuit
    /// @param encryptedNote encrypted note for recovery
    function shieldR00T(
        uint256 amount,
        uint256 commitment,
        uint256 binding,
        uint256[8] calldata depositProof,
        bytes calldata encryptedNote
    ) external nonReentrant {
        if (amount == 0 || commitment == 0) revert ZeroAmount();
        if (commitment >= SNARK_SCALAR_FIELD || binding >= SNARK_SCALAR_FIELD) revert FieldRange();

        // CRITICAL-1: bind the note amount to the R00T actually deposited.
        uint256[3] memory pub = [binding, amount, commitment];
        if (!depositVerifier.verifyProof(depositProof, pub)) revert InvalidProof();

        root.safeTransferFrom(msg.sender, address(this), amount);
        uint256 leafIndex = r00tNotePool.insert(commitment);

        emit R00tShielded(commitment, leafIndex, amount, encryptedNote);
        emit NewCommitment(commitment, leafIndex, encryptedNote);
    }

    // ============ Buy: shielded R00T note → shielded parcel note ============

    /// @dev All numeric swap inputs. Struct avoids stack-too-deep with the output deposit-pin.
    struct SwapParams {
        uint256[8] proof;              // swap proof (input ownership + output/change well-formed)
        uint256 inputMerkleRoot;
        uint256 inputNullifierHash;
        uint256 inputAmount;
        uint256 outputCommitment;
        uint256 outputAmount;          // SECURITY: the note's value, PINNED by outputDepositProof
        uint256 outputBinding;         // deposit binding = Poseidon(outputAmount, outputCommitment)
        uint256[8] outputDepositProof; // deposit proof pinning outputCommitment ↔ outputAmount
        uint256 minOutputAmount;
        uint256 changeCommitment;
        uint256 publicInputsBinding;
        uint256 deadline;
    }

    function buyParcel(SwapParams calldata p, bytes calldata parcelNote, bytes calldata changeNote)
        external nonReentrant notExpired(p.deadline)
    {
        uint256 parcelOut = _swap(true, p, parcelNote, changeNote);
        emit ParcelBought(p.inputNullifierHash, p.inputAmount, parcelOut, p.outputCommitment);
    }

    // ============ Sell: shielded parcel note → shielded R00T note ============

    function sellParcel(SwapParams calldata p, bytes calldata r00tNote, bytes calldata changeNote)
        external nonReentrant notExpired(p.deadline)
    {
        uint256 r00tOut = _swap(false, p, r00tNote, changeNote);
        emit ParcelSold(p.inputNullifierHash, p.inputAmount, r00tOut, p.outputCommitment);
    }

    /// @dev Shared swap core. isBuy: R00T-note-in (r00tNotePool) → parcel-note-out (parcelPool).
    ///      !isBuy: parcel-note-in (parcelPool) → R00T-note-out (r00tNotePool).
    function _swap(bool isBuy, SwapParams calldata p, bytes calldata outNote, bytes calldata changeNote)
        internal returns (uint256 amountOut)
    {
        if (!seeded) revert NotSeeded();
        // Field-range guards on every public signal.
        if (
            p.inputMerkleRoot >= SNARK_SCALAR_FIELD || p.inputNullifierHash >= SNARK_SCALAR_FIELD
                || p.inputAmount >= SNARK_SCALAR_FIELD || p.outputCommitment >= SNARK_SCALAR_FIELD
                || p.outputAmount >= SNARK_SCALAR_FIELD || p.outputBinding >= SNARK_SCALAR_FIELD
                || p.minOutputAmount >= SNARK_SCALAR_FIELD || p.changeCommitment >= SNARK_SCALAR_FIELD
                || p.publicInputsBinding >= SNARK_SCALAR_FIELD
        ) revert FieldRange();
        if (p.inputAmount == 0 || p.outputCommitment == 0) revert ZeroAmount();

        TokenPool inTree = isBuy ? r00tNotePool : parcelPool;
        TokenPool outTree = isBuy ? parcelPool : r00tNotePool;

        if (!inTree.isKnownRoot(p.inputMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifierRegistry.isSpent(p.inputNullifierHash)) revert NullifierAlreadySpent();

        // 1) Verify the SWAP proof — proves input-note ownership + that outputCommitment/
        //    changeCommitment are well-formed. pubSignals order matches the circuit (verified on-chain):
        //    [publicInputsBinding, inputMerkleRoot, inputNullifierHash, inputAmount, outputCommitment, minOutputAmount, changeCommitment]
        {
            uint256[7] memory pub = [
                p.publicInputsBinding, p.inputMerkleRoot, p.inputNullifierHash, p.inputAmount,
                p.outputCommitment, p.minOutputAmount, p.changeCommitment
            ];
            if (!swapVerifier.verifyProof(p.proof, pub)) revert InvalidProof();
        }

        // 2) SECURITY FIX (output-forgery): the swap circuit leaves outputAmount PRIVATE and
        //    unconstrained, so a note could claim more than the curve gives. Pin the output
        //    note's value with a DEPOSIT proof — depositVerifier proves
        //    outputCommitment == Commitment(_, _, outputAmount) for the PUBLIC outputAmount.
        //    Because both proofs reference the SAME outputCommitment, the swap's private amount
        //    is forced to equal this public outputAmount. Then enforce it against the curve.
        {
            uint256[3] memory dpub = [p.outputBinding, p.outputAmount, p.outputCommitment];
            if (!depositVerifier.verifyProof(p.outputDepositProof, dpub)) revert InvalidProof();
        }

        // 3) AMM check: the pinned outputAmount must be within slippage AND must NOT exceed what
        //    the curve actually yields (no over-claim). Reserves move by the real note value.
        uint256 reserveIn = isBuy ? r00tReserve : parcelReserve;
        uint256 reserveOut = isBuy ? parcelReserve : r00tReserve;
        uint256 curveOut = getAmountOut(p.inputAmount, reserveIn, reserveOut);
        if (p.outputAmount < p.minOutputAmount) revert SlippageExceeded();
        if (p.outputAmount > curveOut) revert SlippageExceeded();       // ← closes the forgery
        if (p.outputAmount > reserveOut - MIN_RESERVE) revert InsufficientLiquidity();
        amountOut = p.outputAmount;

        // ── Effects (CEI): spend the input nullifier in the shared registry first ──
        nullifierRegistry.checkAndMark(p.inputNullifierHash);

        // Reshuffle between curve and note-backing (no tokens leave the pool):
        // input value moves INTO the curve; the PINNED amountOut moves OUT into the new note.
        if (isBuy) {
            r00tReserve = reserveIn + p.inputAmount;
            parcelReserve = reserveOut - amountOut;
        } else {
            parcelReserve = reserveIn + p.inputAmount;
            r00tReserve = reserveOut - amountOut;
        }

        // Insert the output note (into the opposite tree) + optional change note (back into the input tree).
        uint256 outLeaf = outTree.insert(p.outputCommitment);
        emit NewCommitment(p.outputCommitment, outLeaf, outNote);
        if (p.changeCommitment != 0) {
            uint256 chLeaf = inTree.insert(p.changeCommitment);
            emit NewCommitment(p.changeCommitment, chLeaf, changeNote);
        }
    }

    // ============ Withdraw: shielded note → real tokens (exit) ============

    /// @notice Withdraw a shielded R00T note to real R00T at any wallet.
    function withdrawR00T(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding
    ) external nonReentrant {
        _withdraw(r00tNotePool, root, proof, merkleRoot, nullifierHash, amount, recipient, recipientBinding, true);
    }

    /// @notice Withdraw a shielded parcel note to real parcel tokens at any wallet.
    function withdrawParcel(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding
    ) external nonReentrant {
        _withdraw(parcelPool, parcel, proof, merkleRoot, nullifierHash, amount, recipient, recipientBinding, false);
    }

    function _withdraw(
        TokenPool tree,
        IERC20 token,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding,
        bool isR00T
    ) internal {
        if (merkleRoot >= SNARK_SCALAR_FIELD || nullifierHash >= SNARK_SCALAR_FIELD || recipientBinding >= SNARK_SCALAR_FIELD) revert FieldRange();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!tree.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (nullifierRegistry.isSpent(nullifierHash)) revert NullifierAlreadySpent();

        // withdraw circuit pubSignals: [recipientBinding, merkleRoot, nullifierHash, amount, recipient]
        uint256[5] memory pub = [recipientBinding, merkleRoot, nullifierHash, amount, uint256(uint160(recipient))];
        if (!withdrawVerifier.verifyProof(proof, pub)) revert InvalidProof();

        // Pay ONLY from note-backing (real balance minus AMM reserve), never from the curve.
        uint256 reserve = isR00T ? r00tReserve : parcelReserve;
        if (token.balanceOf(address(this)) - reserve < amount) revert InsufficientNoteBacking();

        nullifierRegistry.checkAndMark(nullifierHash);
        token.safeTransfer(recipient, amount);

        if (isR00T) emit R00tWithdrawn(nullifierHash, recipient, amount);
        else emit ParcelWithdrawn(nullifierHash, recipient, amount);
    }

    // ============ Views ============

    /// @notice Constant-product output with the 1% fee embedded on the input.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_BPS);
        return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    function getReserves() external view returns (uint256 _r00tReserve, uint256 _parcelReserve) {
        return (r00tReserve, parcelReserve);
    }

    function isKnownR00tRoot(uint256 r) external view returns (bool) { return r00tNotePool.isKnownRoot(r); }
    function isKnownParcelRoot(uint256 r) external view returns (bool) { return parcelPool.isKnownRoot(r); }
    function isNullifierSpent(uint256 n) external view returns (bool) { return nullifierRegistry.isSpent(n); }
}
