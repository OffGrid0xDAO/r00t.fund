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
        // Emergency signers must be distinct + non-zero. Default to deployer-derived
        // distinct addresses; SET REAL ONES via env for production and rotate later.
        address s0 = vm.envOr("EMERGENCY_SIGNER_0", deployer);
        address s1 = vm.envOr("EMERGENCY_SIGNER_1", address(uint160(deployer) ^ uint160(1)));
        address s2 = vm.envOr("EMERGENCY_SIGNER_2", address(uint160(deployer) ^ uint160(2)));

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

        // 7) global nullifier registry (double-spend guard)
        NullifierRegistry nreg = new NullifierRegistry(gov);

        vm.stopBroadcast();

        console.log("=== R00T Private DEX (Robinhood Chain) ===");
        console.log("  $R00T (existing) :", root);
        console.log("  ZkAMMPair        :", address(pair));
        console.log("  ZkAMMAdmin       :", address(admin));
        console.log("  ZkAMMRouter      :", address(router));
        console.log("  NullifierRegistry:", address(nreg));
        console.log("  transferVerifier :", transferV);
        console.log("  withdrawVerifier :", withdrawV);
        console.log("  mergeVerifier    :", mergeV);
    }
}
