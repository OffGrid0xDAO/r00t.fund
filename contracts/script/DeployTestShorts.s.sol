// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TestRootToken.sol";
import "../src/ZkAMMPair.sol";
import "../src/ZkAMMRouter.sol";
import "../src/ZkAMMAdmin.sol";
import "../src/R00TShorts.sol";

// Verifiers (reuse existing)
import "../src/verifiers/RealSellVerifier.sol";
import "../src/verifiers/RealTransferVerifier.sol";
import "../src/verifiers/RealWithdrawVerifier.sol";
import "../src/verifiers/RealSwapVerifier.sol";
import "../src/verifiers/RealAddLiquidityVerifier.sol";
import "../src/verifiers/RealRemoveLiquidityVerifier.sol";
import "../src/verifiers/RealClaimLPFeesVerifier.sol";
import "../src/verifiers/TestMergeVerifier.sol";

/// @title DeployTestShorts
/// @notice Deploy a fresh test system with shorts support on Sepolia
contract DeployTestShortsScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("");
        console.log("=====================================================");
        console.log("   Deploy Test Shorts System (Sepolia)               ");
        console.log("=====================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy Test Token
        console.log("");
        console.log("Step 1: Deploying Test ROOT Token...");
        TestRootToken token = new TestRootToken();
        console.log("  Token:", address(token));
        console.log("  Balance:", token.balanceOf(deployer) / 1e18, "tROOT");

        // Step 2: Deploy Verifiers
        console.log("");
        console.log("Step 2: Deploying Verifiers...");
        RealSellVerifier sellVerifier = new RealSellVerifier();
        RealTransferVerifier transferVerifier = new RealTransferVerifier();
        RealWithdrawVerifier withdrawVerifier = new RealWithdrawVerifier();
        RealSwapVerifier swapVerifier = new RealSwapVerifier();
        RealAddLiquidityVerifier addLiqVerifier = new RealAddLiquidityVerifier();
        RealRemoveLiquidityVerifier removeLiqVerifier = new RealRemoveLiquidityVerifier();
        RealClaimLPFeesVerifier claimFeesVerifier = new RealClaimLPFeesVerifier();
        TestMergeVerifier mergeVerifier = new TestMergeVerifier();

        // Step 3: Deploy Pair (need to predict admin address)
        console.log("");
        console.log("Step 3: Deploying Pair...");

        // Current nonce after deploying 9 contracts (token + 8 verifiers)
        // Pair uses nonce, and internally creates 2 TokenPools
        // So after pair deployment, nonce will be currentNonce + 3 (pair + 2 pools created BY pair)
        // But wait - pools are created by Pair contract, not deployer, so they don't use deployer nonce
        // Pair: currentNonce, Admin: currentNonce + 1
        uint64 currentNonce = vm.getNonce(deployer);
        address predictedAdmin = vm.computeCreateAddress(deployer, currentNonce + 1);

        ZkAMMPair pair = new ZkAMMPair(
            predictedAdmin, // admin will be deployed next
            address(token),
            "tROOT",
            "tROOT"
        );
        console.log("  Pair:", address(pair));
        console.log("  TokenPool:", address(pair.tokenPool()));
        console.log("  LPPool:", address(pair.lpPool()));

        // Step 4: Deploy Admin
        console.log("");
        console.log("Step 4: Deploying Admin...");
        // Admin requires 3 DIFFERENT emergency signers
        address signer1 = address(uint160(uint256(keccak256("signer1"))));
        address signer2 = address(uint160(uint256(keccak256("signer2"))));
        address signer3 = address(uint160(uint256(keccak256("signer3"))));

        ZkAMMAdmin admin = new ZkAMMAdmin(
            address(pair),
            address(sellVerifier),
            address(transferVerifier),
            address(withdrawVerifier),
            deployer, // treasury
            signer1,  // emergency signer 1
            signer2,  // emergency signer 2
            signer3   // emergency signer 3
        );
        console.log("  Admin:", address(admin));
        require(address(admin) == predictedAdmin, "Admin address mismatch");

        // Step 5: Deploy Router
        console.log("");
        console.log("Step 5: Deploying Router...");
        ZkAMMRouter router = new ZkAMMRouter(address(pair), address(admin));
        console.log("  Router:", address(router));

        // Step 6: Configure Admin
        console.log("");
        console.log("Step 6: Configuring Admin...");
        admin.setRouter(address(router)); // This also sets router on pair internally
        admin.setVerifierInitial("swap", address(swapVerifier));
        admin.setVerifierInitial("addLiquidity", address(addLiqVerifier));
        admin.setVerifierInitial("removeLiquidity", address(removeLiqVerifier));
        admin.setVerifierInitial("claimLPFees", address(claimFeesVerifier));
        admin.setVerifierInitial("merge", address(mergeVerifier));

        // Step 7: Deploy R00TShorts
        console.log("");
        console.log("Step 7: Deploying R00TShorts...");
        R00TShorts shorts = new R00TShorts(address(pair), address(token), deployer);
        console.log("  Shorts:", address(shorts));

        // Step 8: Set shorts on pair (must go through admin)
        console.log("");
        console.log("Step 8: Setting shorts on pair...");
        admin.setShortsContractInitial(address(shorts));

        // Step 9: Bootstrap liquidity (0.02 ETH - low for testing)
        console.log("");
        console.log("Step 9: Bootstrapping liquidity...");
        uint256 initialEth = 0.02 ether;

        // Transfer tokens to pair first
        uint256 initialTokens = 5_000_000 * 1e18;
        token.transfer(address(pair), initialTokens);

        // Generate deterministic LP commitment for bootstrap
        uint256 lpCommitment = uint256(keccak256(abi.encodePacked("test_bootstrap_", block.chainid, address(pair)))) % pair.SNARK_SCALAR_FIELD();

        router.bootstrapLiquidity{value: initialEth}(
            lpCommitment,
            1, // minLPShares
            block.timestamp + 3600,
            "" // no encrypted note for test
        );
        console.log("  Bootstrapped with ETH:", initialEth / 1e18);
        console.log("  Token reserve:", initialTokens / 1e18);

        // Step 10: Fund shorts with tokens
        console.log("");
        console.log("Step 10: Funding shorts contract...");
        uint256 shortsAllocation = 1_000_000 * 1e18;
        token.transfer(address(shorts), shortsAllocation);
        console.log("  Shorts funded:", shortsAllocation / 1e18, "tROOT");

        vm.stopBroadcast();

        // Summary
        console.log("");
        console.log("=====================================================");
        console.log("   DEPLOYMENT COMPLETE                               ");
        console.log("=====================================================");
        console.log("");
        console.log("UPDATE frontend/src/config.ts with:");
        console.log("  rootToken:", address(token));
        console.log("  zkAMMPair:", address(pair));
        console.log("  zkAMMRouter:", address(router));
        console.log("  zkAMMAdmin:", address(admin));
        console.log("  tokenPool:", address(pair.tokenPool()));
        console.log("  lpPool:", address(pair.lpPool()));
        console.log("  shortsContract:", address(shorts));
        console.log("");
        console.log("Pool State:");
        (uint256 ethRes, uint256 tokenRes) = pair.getReserves();
        console.log("  ETH Reserve:", ethRes / 1e18);
        console.log("  Token Reserve:", tokenRes / 1e18);
        console.log("  Shorts Available:", shorts.getAvailableTokens() / 1e18, "tROOT");
        console.log("");
    }
}
