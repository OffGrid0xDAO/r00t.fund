// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ZkAMMPair} from "../src/ZkAMMPair.sol";
import {ZkAMMAdmin} from "../src/ZkAMMAdmin.sol";
import {ZkAMMRouter} from "../src/ZkAMMRouter.sol";
import {NullifierRegistry} from "../src/NullifierRegistry.sol";
import {TestRootToken} from "../src/TestRootToken.sol";
import {
    ISellVerifier,
    ITransferVerifier,
    IWithdrawVerifier,
    IDepositVerifier
} from "../src/interfaces/IVerifier.sol";

/// @dev Always-true stubs so we can exercise the Router's nullifier/state logic without
///      real Groth16 fixtures. The deposit verifier below is NOT a stub — it faithfully
///      enforces the value-binding so the drain-exploit test is meaningful.
contract MockSellVerifier is ISellVerifier {
    function verifyProof(uint256[8] calldata, uint256[9] calldata) external pure returns (bool) { return true; }
}
contract MockTransferVerifier is ITransferVerifier {
    function verifyProof(uint256[8] calldata, uint256[4] calldata) external pure returns (bool) { return true; }
}
contract MockWithdrawVerifier is IWithdrawVerifier {
    function verifyProof(uint256[8] calldata, uint256[5] calldata) external pure returns (bool) { return true; }
}

/// @notice Faithful stand-in for the deposit-binding circuit. Encodes the SAME relation the
///         circom circuit proves — commitment == hash(nullifier, secret, amount) and
///         binding == hash(amount, commitment) — using keccak as the hash. proof[0]/proof[1]
///         carry the note's (nullifier, secret). This lets the test prove the CRITICAL-1 fix:
///         a note whose committed amount != the public amount is REJECTED.
contract MockDepositVerifier is IDepositVerifier {
    uint256 constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function noteCommitment(uint256 nullifier, uint256 secret, uint256 amount) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(nullifier, secret, amount))) % FIELD;
    }
    function binding(uint256 amount, uint256 commitment) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(amount, commitment))) % FIELD;
    }

    function verifyProof(uint256[8] calldata proof, uint256[3] calldata pub) external pure returns (bool) {
        uint256 b = pub[0];
        uint256 amount = pub[1];
        uint256 commitment = pub[2];
        // 1. commitment must equal Poseidon(nullifier, secret, amount) — the whole fix.
        if (noteCommitment(proof[0], proof[1], amount) != commitment) return false;
        // 2. anti-malleability binding of the public inputs.
        if (binding(amount, commitment) != b) return false;
        return true;
    }
}

interface ITokenPoolRoot { function getRoot() external view returns (uint256); }

contract ZkAMMDepositBindingTest is Test {
    uint256 constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    TestRootToken root;
    ZkAMMPair pair;
    ZkAMMAdmin admin;
    ZkAMMRouter router;
    NullifierRegistry registry;
    MockDepositVerifier depositV;

    address user = makeAddr("user");
    address recipient = makeAddr("recipient");

    function setUp() public {
        root = new TestRootToken(); // mints 69M to this

        // Mock verifiers (this contract is the deployer/owner/governance).
        address sellV = address(new MockSellVerifier());
        address transferV = address(new MockTransferVerifier());
        address withdrawV = address(new MockWithdrawVerifier());
        depositV = new MockDepositVerifier();

        address treasury = makeAddr("treasury");
        address s0 = makeAddr("s0");
        address s1 = makeAddr("s1");
        address s2 = makeAddr("s2");

        // Resolve the Pair<->Admin circular dep via CREATE prediction (mirrors deploy script).
        uint256 n = vm.getNonce(address(this));
        address predictedPair = vm.computeCreateAddress(address(this), n + 1);
        admin = new ZkAMMAdmin(predictedPair, sellV, transferV, withdrawV, treasury, s0, s1, s2);
        pair = new ZkAMMPair(address(admin), address(root), "R00T Shielded", "sR00T");
        require(address(pair) == predictedPair, "pair prediction mismatch");

        router = new ZkAMMRouter(address(pair), address(admin));
        admin.setRouter(address(router));
        admin.setVerifierInitial("deposit", address(depositV));

        // Shared nullifier registry (governance = this).
        registry = new NullifierRegistry(address(this));
        router.setNullifierRegistry(address(registry));
        registry.setPoolAuthorization(address(router), true);
        // Past the pool-authorization cooldown so the Router can mark nullifiers.
        vm.warp(block.timestamp + 61);

        // Bootstrap ETH liquidity so the curve is priced.
        router.bootstrapLiquidity{value: 1 ether}(uint256(12345), 0, block.timestamp + 1 hours, hex"01");

        // Give the Pair real ROOT so withdrawals can pay out.
        root.transfer(address(pair), 1_000_000e18);
    }

    // ---- helpers ----
    function _commit(uint256 nul, uint256 sec, uint256 amt) internal view returns (uint256) {
        return depositV.noteCommitment(nul, sec, amt);
    }
    function _bind(uint256 amt, uint256 commitment) internal view returns (uint256) {
        return depositV.binding(amt, commitment);
    }
    function _emptyProof() internal pure returns (uint256[8] memory p) {}

    // =====================================================================================
    // CRITICAL-1 — depositPublic value binding
    // =====================================================================================

    function test_depositPublic_matchingAmount_succeeds() public {
        uint256 amount = 1_000e18;
        uint256 nul = 111;
        uint256 sec = 222;
        uint256 commitment = _commit(nul, sec, amount);
        uint256 b = _bind(amount, commitment);
        bytes32 depBinding = keccak256(abi.encodePacked(commitment, user, amount));

        uint256[8] memory proof = _emptyProof();
        proof[0] = nul;
        proof[1] = sec;

        root.transfer(user, amount);
        vm.startPrank(user);
        root.approve(address(pair), amount);
        router.depositPublic(amount, commitment, depBinding, b, proof, hex"aa");
        vm.stopPrank();

        // The Pair pulled EXACTLY `amount` from the user.
        assertEq(root.balanceOf(user), 0);
    }

    /// @notice THE DRAIN EXPLOIT: a note Poseidon(n, s, BIG) deposited with a public amount of 1
    ///         must REVERT — otherwise the depositor could later withdraw BIG and drain the pool.
    function test_depositPublic_valueForgery_reverts() public {
        uint256 realAmount = 1; // what the attacker actually pays
        uint256 bigAmount = 10_000_000e18; // what the note secretly claims
        uint256 nul = 333;
        uint256 sec = 444;

        // Note commitment bakes in BIG, but the attacker declares amount = 1.
        uint256 commitment = _commit(nul, sec, bigAmount);
        uint256 b = _bind(realAmount, commitment);
        bytes32 depBinding = keccak256(abi.encodePacked(commitment, user, realAmount));

        uint256[8] memory proof = _emptyProof();
        proof[0] = nul;
        proof[1] = sec;

        root.transfer(user, realAmount);
        vm.startPrank(user);
        root.approve(address(pair), realAmount);
        vm.expectRevert(ZkAMMRouter.InvalidProof.selector);
        router.depositPublic(realAmount, commitment, depBinding, b, proof, hex"aa");
        vm.stopPrank();
    }

    /// @notice Even if the attacker forges the binding to match amount=1, the commitment still
    ///         can't bake in BIG — the proof fails.
    function test_depositPublic_forgedBinding_reverts() public {
        uint256 bigAmount = 5_000_000e18;
        uint256 nul = 555;
        uint256 sec = 666;
        uint256 commitment = _commit(nul, sec, bigAmount);
        uint256 b = _bind(1, commitment); // binding says amount=1
        bytes32 depBinding = keccak256(abi.encodePacked(commitment, user, uint256(1)));

        uint256[8] memory proof = _emptyProof();
        proof[0] = nul;
        proof[1] = sec;

        root.transfer(user, 1);
        vm.startPrank(user);
        root.approve(address(pair), 1);
        vm.expectRevert(ZkAMMRouter.InvalidProof.selector);
        router.depositPublic(1, commitment, depBinding, b, proof, hex"aa");
        vm.stopPrank();
    }

    // =====================================================================================
    // CRITICAL-1 — buyPrivate exact-out binding
    // =====================================================================================

    function test_buyPrivate_exactOut_succeeds() public {
        uint256 tokensOut = 500e18;
        uint256 nul = 777;
        uint256 sec = 888;
        uint256 commitment = _commit(nul, sec, tokensOut);
        uint256 b = _bind(tokensOut, commitment);

        uint256[8] memory proof = _emptyProof();
        proof[0] = nul;
        proof[1] = sec;

        (, uint256 tokenReserveBefore) = pair.getReserves();

        vm.deal(user, 5 ether);
        uint256 balBefore = user.balance;
        vm.prank(user);
        router.buyPrivate{value: 1 ether}(commitment, tokensOut, b, proof, block.timestamp + 1 hours, hex"bb");

        (, uint256 tokenReserveAfter) = pair.getReserves();
        // The curve released EXACTLY tokensOut.
        assertEq(tokenReserveBefore - tokenReserveAfter, tokensOut);
        // Excess ETH was refunded (cost is tiny vs 1 ether sent).
        assertGt(user.balance, balBefore - 1 ether);
        assertLt(user.balance, balBefore);
    }

    /// @notice buyPrivate must reject a note whose committed amount != the tokensOut it delivers.
    function test_buyPrivate_mismatchedTokensOut_reverts() public {
        uint256 tokensOut = 500e18; // what the buyer asks the curve to deliver
        uint256 hiddenAmount = 999e18; // what the note secretly claims
        uint256 nul = 909;
        uint256 sec = 808;
        uint256 commitment = _commit(nul, sec, hiddenAmount);
        uint256 b = _bind(tokensOut, commitment);

        uint256[8] memory proof = _emptyProof();
        proof[0] = nul;
        proof[1] = sec;

        vm.deal(user, 5 ether);
        vm.prank(user);
        vm.expectRevert(ZkAMMRouter.InvalidProof.selector);
        router.buyPrivate{value: 1 ether}(commitment, tokensOut, b, proof, block.timestamp + 1 hours, hex"bb");
    }

    // =====================================================================================
    // CRITICAL-2 — one shared NullifierRegistry across all note-spend rails
    // =====================================================================================

    /// @notice A note nullifier spent via withdraw cannot be re-spent via transfer — they share
    ///         ONE registry. This is the zkAMM proxy for the sell-vs-pledge double-spend (C).
    function test_sharedNullifier_crossRailDoubleSpend_reverts() public {
        uint256 merkleRoot = ITokenPoolRoot(pair.getTokenPool()).getRoot();
        assertTrue(pair.isKnownRoot(merkleRoot));

        uint256 nullifierHash = 424242;
        uint256[8] memory proof = _emptyProof();

        // First spend: withdraw 1 wei of ROOT (mock withdraw verifier returns true).
        router.withdrawPublic(proof, merkleRoot, nullifierHash, 1, recipient, 0, block.timestamp + 1 hours);
        assertTrue(registry.isSpent(nullifierHash));

        // Second spend of the SAME nullifier via a different rail (transfer) must revert.
        vm.expectRevert(NullifierRegistry.NullifierAlreadySpent.selector);
        router.transferPrivate(proof, merkleRoot, nullifierHash, uint256(1234567), 0, block.timestamp + 1 hours, hex"", hex"");
    }

    /// @notice Same-rail replay (withdraw twice) is also blocked by the shared registry.
    function test_sharedNullifier_sameRailReplay_reverts() public {
        uint256 merkleRoot = ITokenPoolRoot(pair.getTokenPool()).getRoot();
        uint256 nullifierHash = 987654;
        uint256[8] memory proof = _emptyProof();

        router.withdrawPublic(proof, merkleRoot, nullifierHash, 1, recipient, 0, block.timestamp + 1 hours);

        vm.expectRevert(NullifierRegistry.NullifierAlreadySpent.selector);
        router.withdrawPublic(proof, merkleRoot, nullifierHash, 1, recipient, 0, block.timestamp + 1 hours);
    }

    /// @notice If the registry isn't wired, note-spends fail closed (defense-in-depth).
    function test_noRegistry_spendReverts() public {
        // Fresh Router with no registry set.
        ZkAMMRouter r2 = new ZkAMMRouter(address(pair), address(admin));
        uint256 merkleRoot = ITokenPoolRoot(pair.getTokenPool()).getRoot();
        uint256[8] memory proof = _emptyProof();
        vm.expectRevert(ZkAMMRouter.NullifierRegistryNotSet.selector);
        r2.withdrawPublic(proof, merkleRoot, uint256(1), 1, recipient, 0, block.timestamp + 1 hours);
    }

    function test_setNullifierRegistry_onlyOnce() public {
        vm.expectRevert(ZkAMMRouter.NullifierRegistryAlreadySet.selector);
        router.setNullifierRegistry(address(registry));
    }
}
