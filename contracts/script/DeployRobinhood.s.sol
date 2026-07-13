// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ZkAMMPair} from "../src/ZkAMMPair.sol";
import {ZkAMMAdmin} from "../src/ZkAMMAdmin.sol";
import {ZkAMMRouter} from "../src/ZkAMMRouter.sol";
import {NullifierRegistry} from "../src/NullifierRegistry.sol";
import {RealSellVerifier} from "../src/verifiers/RealSellVerifier.sol";
import {RealTransferVerifier} from "../src/verifiers/RealTransferVerifier.sol";
import {RealWithdrawVerifier} from "../src/verifiers/RealWithdrawVerifier.sol";
import {RealAddLiquidityVerifier} from "../src/verifiers/RealAddLiquidityVerifier.sol";
import {RealRemoveLiquidityVerifier} from "../src/verifiers/RealRemoveLiquidityVerifier.sol";
import {RealClaimLPFeesVerifier} from "../src/verifiers/RealClaimLPFeesVerifier.sol";
import {RealSwapVerifier} from "../src/verifiers/RealSwapVerifier.sol";
import {RealMergeVerifier} from "../src/verifiers/RealMergeVerifier.sol";
import {RealDepositVerifier} from "../src/verifiers/RealDepositVerifier.sol";

/// @notice Deploys the $R00T confidential-transfer private DEX to Robinhood Chain,
///         wired to an existing $R00T (ROOT_TOKEN). Resolves the Pair<->Admin
///         circular constructor dependency via CREATE-address prediction.
///
/// Env: PRIVATE_KEY, ROOT_TOKEN, [PROTOCOL_TREASURY], [GOVERNANCE],
///      [EMERGENCY_SIGNER_0/1/2]
contract DeployRobinhood is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address root = vm.envAddress("ROOT_TOKEN");
        address treasury = vm.envOr("PROTOCOL_TREASURY", deployer);
        address gov = vm.envOr("GOVERNANCE", deployer);
        // Emergency signers: 3 DISTINCT addresses you actually control (2-of-3 threshold).
        // NEVER auto-derive them (the old `deployer XOR 1/2` default minted phantom addresses
        // with no private key → the emergency multisig could never reach 2 approvals, and
        // setEmergencySigner is itself 2-of-3 → funds gated behind it were unrecoverable).
        // Note: fund recovery does NOT depend on this multisig — Pair.rescueETH/rescueTokens
        // are single-owner — but a broken emergency multisig is still dead weight, so we now
        // REQUIRE real signers via env and fail loudly if they're missing/duplicated.
        address s0 = vm.envAddress("EMERGENCY_SIGNER_0");
        address s1 = vm.envAddress("EMERGENCY_SIGNER_1");
        address s2 = vm.envAddress("EMERGENCY_SIGNER_2");
        require(s0 != address(0) && s1 != address(0) && s2 != address(0), "emergency signers required");
        require(s0 != s1 && s1 != s2 && s0 != s2, "emergency signers must be distinct");

        // Swap fee to restore after bootstrap. Default 3% total, preserving the canonical
        // 3:7 protocol:LP split (90 + 210 = 300 bps). Override via env for a different rate.
        uint256 protocolBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(90));
        uint256 lpBps = vm.envOr("LP_FEE_BPS", uint256(210));

        vm.startBroadcast(pk);

        // 1) verifiers (each consumes one deployer nonce)
        address sellV = address(new RealSellVerifier());
        address transferV = address(new RealTransferVerifier());
        address withdrawV = address(new RealWithdrawVerifier());
        address addLiqV = address(new RealAddLiquidityVerifier());
        address removeLiqV = address(new RealRemoveLiquidityVerifier());
        address claimV = address(new RealClaimLPFeesVerifier());
        address swapV = address(new RealSwapVerifier());
        address mergeV = address(new RealMergeVerifier());
        // PHASE B (CRITICAL-1): deposit value-binding verifier. Wired below via
        // setVerifierInitial("deposit", ...); the Router requires a deposit proof in
        // depositPublic + buyPrivate so a note can never claim more R00T than was deposited.
        address depositV = address(new RealDepositVerifier());

        // 2) predict the Pair address: Admin deploys at nonce `n`, Pair right after at `n+1`.
        //    (Pair's internal Poseidon/TokenPool CREATEs use the Pair's nonce, not the deployer's.)
        uint256 n = vm.getNonce(deployer);
        address predictedPair = vm.computeCreateAddress(deployer, n + 1);

        // 3) Admin (needs the Pair address up front)
        ZkAMMAdmin admin = new ZkAMMAdmin(predictedPair, sellV, transferV, withdrawV, treasury, s0, s1, s2);

        // 4) Pair (needs Admin) — must land exactly at the predicted address
        ZkAMMPair pair = new ZkAMMPair(address(admin), root, "R00T Shielded", "sR00T");
        require(address(pair) == predictedPair, "pair address prediction mismatch");

        // 5) Router + wiring (setRouter also wires the router into the Pair)
        ZkAMMRouter router = new ZkAMMRouter(address(pair), address(admin));
        admin.setRouter(address(router));

        // 6) remaining verifiers (constructor only takes sell/transfer/withdraw)
        admin.setVerifierInitial("addLiquidity", addLiqV);
        admin.setVerifierInitial("removeLiquidity", removeLiqV);
        admin.setVerifierInitial("claimLPFees", claimV);
        admin.setVerifierInitial("swap", swapV);
        admin.setVerifierInitial("merge", mergeV);
        admin.setVerifierInitial("deposit", depositV); // PHASE B: CRITICAL-1 deposit-binding

        // 7) nullifier registry (double-spend guard, SHARED across all rails). Prefer an EXISTING
        //    shared registry via REGISTRY env (so the zkAMM, LandVault + ZkParcelPool all mark the
        //    one global set); else deploy a fresh one. Governance authorizes the Router (deployer
        //    must be governance of the shared registry, which it is on RH).
        address existingReg = vm.envOr("REGISTRY", address(0));
        NullifierRegistry nreg = existingReg == address(0) ? new NullifierRegistry(gov) : NullifierRegistry(existingReg);
        router.setNullifierRegistry(address(nreg));
        nreg.setPoolAuthorization(address(router), true); // deployer = governance on RH shared reg

        // 8) restore the trading fee (bootstrapLiquidity doesn't touch it; deployer is owner).
        router.setFees(protocolBps, lpBps);

        vm.stopBroadcast();

        console.log("=== R00T Private DEX (Robinhood Chain) ===");
        console.log("  $R00T (existing) :", root);
        console.log("  ZkAMMPair        :", address(pair));
        console.log("  ZkAMMAdmin       :", address(admin));
        console.log("  ZkAMMRouter      :", address(router));
        console.log("  NullifierRegistry:", address(nreg));
        console.log("  depositVerifier  :", depositV);
        console.log("  transferVerifier :", transferV);
        console.log("  withdrawVerifier :", withdrawV);
        console.log("  mergeVerifier    :", mergeV);
        console.log("  fee (protocol/lp bps):", protocolBps, lpBps);
        if (gov != deployer) {
            console.log("  ACTION REQUIRED: governance must NullifierRegistry.setPoolAuthorization(router, true)");
        }
    }
}
