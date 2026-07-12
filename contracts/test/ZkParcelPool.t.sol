// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ZkParcelPool.sol";
import "../src/PoseidonT3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Circuit↔verifier PARITY is proven separately on-chain (swap/deposit/withdraw verifyProof
///      all return true against the deployed verifiers). These tests exercise the CONTRACT LOGIC —
///      accounting, reserve reshuffle, tree inserts, note-backing, and every revert path — with
///      mock verifiers so we don't need FFI snarkjs in the unit suite.
contract MockVerifier {
    bool public ret = true;
    function set(bool r) external { ret = r; }
    function verifyProof(uint256[8] calldata, uint256[7] calldata) external view returns (bool) { return ret; }
    function verifyProof(uint256[8] calldata, uint256[3] calldata) external view returns (bool) { return ret; }
    function verifyProof(uint256[8] calldata, uint256[5] calldata) external view returns (bool) { return ret; }
}

contract MockRegistry {
    mapping(uint256 => bool) public spent;
    function isSpent(uint256 n) external view returns (bool) { return spent[n]; }
    function checkAndMark(uint256 n) external returns (bool wasSpent) {
        wasSpent = spent[n];
        require(!wasSpent, "spent");
        spent[n] = true;
    }
}

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MOCK") { _mint(msg.sender, 1_000_000_000e18); }
    function mintTo(address to, uint256 a) external { _mint(to, a); }
}

contract ZkParcelPoolTest is Test {
    ZkParcelPool pool;
    MockVerifier swapV;
    MockVerifier depV;
    MockVerifier wdV;
    MockRegistry reg;
    MockToken root;
    MockToken parcel;
    address creator = address(this); // this test acts as the LandVault/creator
    address user = makeAddr("user");

    uint256 constant SEED_R00T = 100_000e18;
    uint256 constant SEED_PARCEL = 1_000_000e18;
    uint256 constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @dev field-safe pseudo-commitment (keccak mod field) so we don't trip the contract's FieldRange guard
    function _c(string memory s) internal pure returns (uint256) { return uint256(keccak256(bytes(s))) % FIELD; }

    function setUp() public {
        swapV = new MockVerifier();
        depV = new MockVerifier();
        wdV = new MockVerifier();
        reg = new MockRegistry();
        root = new MockToken();
        parcel = new MockToken();
        address poseidon = PoseidonT3Deployer.deploy();

        pool = new ZkParcelPool(
            bytes32(uint256(1)), address(root), address(parcel),
            address(swapV), address(depV), address(wdV), address(reg),
            creator, poseidon
        );

        // Seed: creator sends real reserves then calls seed()
        root.transfer(address(pool), SEED_R00T);
        parcel.transfer(address(pool), SEED_PARCEL);
        pool.seed();
    }

    // ---- helpers ----
    function _shield(uint256 amount) internal returns (uint256 r00tRoot) {
        root.mintTo(user, amount);
        vm.startPrank(user);
        root.approve(address(pool), amount);
        uint256[8] memory p;
        // commitment/binding are opaque to the mock verifier; use unique nonzero values
        pool.shieldR00T(amount, (uint256(keccak256(abi.encode(amount, "c"))) % FIELD), (uint256(keccak256(abi.encode(amount, "b"))) % FIELD), p, "");
        vm.stopPrank();
        return pool.r00tNotePool().root();
    }

    // ---- seed ----
    function test_Seed_SetsReserves() public view {
        (uint256 r, uint256 pa) = pool.getReserves();
        assertEq(r, SEED_R00T);
        assertEq(pa, SEED_PARCEL);
        assertTrue(pool.seeded());
    }

    function test_Seed_RevertsTwice() public {
        vm.expectRevert(ZkParcelPool.AlreadySeeded.selector);
        pool.seed();
    }

    function test_Seed_RevertsBelowMin() public {
        // fresh pool, tiny balances
        address poseidon = PoseidonT3Deployer.deploy();
        ZkParcelPool p2 = new ZkParcelPool(bytes32(uint256(2)), address(root), address(parcel), address(swapV), address(depV), address(wdV), address(reg), creator, poseidon);
        root.transfer(address(p2), 100); // <= MIN_RESERVE
        parcel.transfer(address(p2), 100);
        vm.expectRevert(ZkParcelPool.MinLiquidity.selector);
        p2.seed();
    }

    // ---- shield ----
    function test_Shield_MintsNote_ReserveUnchanged() public {
        uint256 amount = 5_000e18;
        (uint256 rBefore,) = pool.getReserves();
        _shield(amount);
        (uint256 rAfter,) = pool.getReserves();
        assertEq(rAfter, rBefore, "shield must not change AMM reserve");
        // real balance grew by amount → that's note-backing
        assertEq(root.balanceOf(address(pool)), SEED_R00T + amount);
        assertEq(pool.r00tNotePool().nextIndex(), 1);
    }

    function test_Shield_RevertsBadProof() public {
        depV.set(false);
        root.mintTo(user, 1e18);
        vm.startPrank(user);
        root.approve(address(pool), 1e18);
        uint256[8] memory p;
        vm.expectRevert(ZkParcelPool.InvalidProof.selector);
        pool.shieldR00T(1e18, 123, 456, p, "");
        vm.stopPrank();
    }

    // ---- buy ----
    function test_Buy_ReshufflesReserves_Conserves() public {
        uint256 shieldAmt = 10_000e18;
        uint256 r00tRoot = _shield(shieldAmt);

        uint256 realR00TBefore = root.balanceOf(address(pool));
        uint256 realParcelBefore = parcel.balanceOf(address(pool));
        (uint256 rIn, uint256 pOut) = pool.getReserves();
        uint256 inAmt = 10_000e18;
        uint256 expectedOut = pool.getAmountOut(inAmt, rIn, pOut);

        uint256[8] memory proof;
        pool.buyParcel(
            proof, r00tRoot, 111 /*nullifier*/, inAmt,
            _c("parcelNote") /*outputCommitment*/, 1 /*minOut*/, 0 /*change*/,
            222 /*binding*/, block.timestamp + 100, "", ""
        );

        (uint256 rAfter, uint256 pAfter) = pool.getReserves();
        assertEq(rAfter, rIn + inAmt, "r00tReserve += inAmt");
        assertEq(pAfter, pOut - expectedOut, "parcelReserve -= out");
        // No tokens left the pool (buy is internal reshuffle):
        assertEq(root.balanceOf(address(pool)), realR00TBefore, "real R00T unchanged on buy");
        assertEq(parcel.balanceOf(address(pool)), realParcelBefore, "real parcel unchanged on buy");
        // parcel note inserted
        assertEq(pool.parcelPool().nextIndex(), 1);
    }

    function test_Buy_RevertsSlippage() public {
        uint256 r00tRoot = _shield(10_000e18);
        (uint256 rIn, uint256 pOut) = pool.getReserves();
        uint256 out = pool.getAmountOut(10_000e18, rIn, pOut);
        uint256[8] memory proof;
        vm.expectRevert(ZkParcelPool.SlippageExceeded.selector);
        pool.buyParcel(proof, r00tRoot, 111, 10_000e18, _c("n"), out + 1 /*minOut too high*/, 0, 222, block.timestamp + 100, "", "");
    }

    function test_Buy_RevertsDoubleSpend() public {
        uint256 r00tRoot = _shield(20_000e18);
        uint256[8] memory proof;
        pool.buyParcel(proof, r00tRoot, 111, 5_000e18, _c("a"), 1, 0, 222, block.timestamp + 100, "", "");
        // reuse nullifier 111 → contract's isSpent pre-check reverts NullifierAlreadySpent
        uint256 newRoot = pool.r00tNotePool().root();
        vm.expectRevert(ZkParcelPool.NullifierAlreadySpent.selector);
        pool.buyParcel(proof, newRoot, 111, 5_000e18, _c("b"), 1, 0, 222, block.timestamp + 100, "", "");
    }

    function test_Buy_RevertsUnknownRoot() public {
        _shield(10_000e18);
        uint256[8] memory proof;
        vm.expectRevert(ZkParcelPool.UnknownMerkleRoot.selector);
        pool.buyParcel(proof, 999999 /*bogus root*/, 111, 1e18, _c("n"), 1, 0, 222, block.timestamp + 100, "", "");
    }

    function test_Buy_RevertsExpired() public {
        uint256 r00tRoot = _shield(10_000e18);
        uint256[8] memory proof;
        vm.expectRevert(ZkParcelPool.Expired.selector);
        pool.buyParcel(proof, r00tRoot, 111, 1e18, _c("n"), 1, 0, 222, block.timestamp - 1, "", "");
    }

    // ---- sell ----
    function test_Sell_ReshufflesReserves() public {
        // first buy to create a parcel note + move price
        uint256 r00tRoot = _shield(50_000e18);
        uint256[8] memory proof;
        pool.buyParcel(proof, r00tRoot, 111, 50_000e18, _c("pn"), 1, 0, 222, block.timestamp + 100, "", "");
        uint256 parcelRoot = pool.parcelPool().root();

        uint256 realR00TBefore = root.balanceOf(address(pool));
        uint256 realParcelBefore = parcel.balanceOf(address(pool));
        (uint256 rBefore, uint256 pBefore) = pool.getReserves();
        uint256 sellAmt = 100_000e18;
        uint256 expectedR00tOut = pool.getAmountOut(sellAmt, pBefore, rBefore);

        pool.sellParcel(proof, parcelRoot, 333 /*nullifier*/, sellAmt, _c("r00tNote"), 1, 0, 444, block.timestamp + 100, "", "");

        (uint256 rAfter, uint256 pAfter) = pool.getReserves();
        assertEq(pAfter, pBefore + sellAmt, "parcelReserve += sellAmt");
        assertEq(rAfter, rBefore - expectedR00tOut, "r00tReserve -= out");
        assertEq(root.balanceOf(address(pool)), realR00TBefore, "real R00T unchanged on sell");
        assertEq(parcel.balanceOf(address(pool)), realParcelBefore, "real parcel unchanged on sell");
    }

    // ---- withdraw ----
    function test_WithdrawR00T_PaysFromBacking() public {
        uint256 amount = 8_000e18;
        _shield(amount); // creates note-backing of `amount` R00T
        uint256 r00tRoot = pool.r00tNotePool().root();
        uint256[8] memory proof;
        uint256 recBefore = root.balanceOf(user);
        pool.withdrawR00T(proof, r00tRoot, 777, amount, user, 888);
        assertEq(root.balanceOf(user), recBefore + amount, "recipient got real R00T");
        // AMM reserve untouched
        (uint256 r,) = pool.getReserves();
        assertEq(r, SEED_R00T);
    }

    function test_WithdrawR00T_RevertsIfNoBacking() public {
        // no shield → backing = 0, only AMM reserve exists; withdraw must not touch reserve
        uint256 r00tRoot = pool.r00tNotePool().root(); // empty tree root is "known"
        uint256[8] memory proof;
        vm.expectRevert(ZkParcelPool.InsufficientNoteBacking.selector);
        pool.withdrawR00T(proof, r00tRoot, 777, 1e18, user, 888);
    }

    // ---- accounting invariant across a full round-trip ----
    function test_Invariant_RealBalanceEqualsReservePlusBacking() public {
        uint256 r00tRoot = _shield(30_000e18);
        uint256[8] memory proof;
        pool.buyParcel(proof, r00tRoot, 1, 15_000e18, _c("p1"), 1, 0, 2, block.timestamp + 100, "", "");
        uint256 parcelRoot = pool.parcelPool().root();
        pool.sellParcel(proof, parcelRoot, 3, 20_000e18, _c("r1"), 1, 0, 4, block.timestamp + 100, "", "");

        // realR00T = reserve + backing ; backing must be >= 0
        (uint256 rRes, uint256 pRes) = pool.getReserves();
        assertGe(root.balanceOf(address(pool)), rRes, "real R00T >= reserve");
        assertGe(parcel.balanceOf(address(pool)), pRes, "real parcel >= reserve");
    }
}
