// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RootToken.sol";
import "../src/ZkAMMPair.sol";
import "../src/ZkAMMRouter.sol";
import "../src/ZkAMMAdmin.sol";
import "../src/R00TShorts.sol";

// Core Verifiers
import "../src/verifiers/RealSellVerifier.sol";
import "../src/verifiers/RealTransferVerifier.sol";
import "../src/verifiers/RealWithdrawVerifier.sol";
import "../src/verifiers/RealSwapVerifier.sol";
import "../src/verifiers/RealAddLiquidityVerifier.sol";
import "../src/verifiers/RealRemoveLiquidityVerifier.sol";
import "../src/verifiers/RealClaimLPFeesVerifier.sol";
import "../src/verifiers/TestMergeVerifier.sol";

/// @title RedeployPairWithShorts
/// @notice Redeploy Admin + Pair + Router + Shorts for testnet
/// @dev Reuses existing ROOT token and verifiers
contract RedeployPairWithShortsScript is Script {
    // Existing Sepolia addresses to REUSE
    address constant ROOT_TOKEN = 0xDF658dfEae26dc82ACBB7D35FB69A347359D56fF;

    // Amount of ROOT tokens for shorts (will transfer from pair after bootstrap)
    uint256 constant SHORTS_TOKEN_ALLOCATION = 1_000_000 * 1e18;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint256 initialEth = vm.envOr("INITIAL_ETH_RESERVE", uint256(0.01 ether));

        console.log("");
        console.log("=====================================================");
        console.log("   Redeploy Pair + Admin + Shorts (Sepolia)          ");
        console.log("=====================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        console.log("Initial ETH:", initialEth / 1e18, "ETH");
        console.log("Reusing ROOT Token:", ROOT_TOKEN);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ==========================================
        // Step 1: Deploy Verifiers (fresh)
        // ==========================================
        console.log("Step 1: Deploying Verifiers...");

        address sellVerifier = address(new RealSellVerifier());
        address transferVerifier = address(new RealTransferVerifier());
        address withdrawVerifier = address(new RealWithdrawVerifier());
        address swapVerifier = address(new RealSwapVerifier());
        address addLiquidityVerifier = address(new RealAddLiquidityVerifier());
        address removeLiquidityVerifier = address(new RealRemoveLiquidityVerifier());
        address claimLPFeesVerifier = address(new RealClaimLPFeesVerifier());
        address mergeVerifier = address(new TestMergeVerifier());
        console.log("  Verifiers deployed");

        // ==========================================
        // Step 2: Compute addresses and deploy Admin
        // ==========================================
        console.log("");
        console.log("Step 2: Deploying Admin...");

        address emergencySigner1 = deployer;
        address emergencySigner2 = 0x7e28521C66412877C727fC7cA2141bd5A1d5E238;
        address emergencySigner3 = 0x9CeB788f80B908f1a020b44C2cC560b4543ac1EA;

        uint64 adminNonce = vm.getNonce(deployer);
        address predictedPairAddress = vm.computeCreateAddress(deployer, adminNonce + 1);

        ZkAMMAdmin admin = new ZkAMMAdmin(
            predictedPairAddress,
            sellVerifier,
            transferVerifier,
            withdrawVerifier,
            deployer,  // treasury
            emergencySigner1,
            emergencySigner2,
            emergencySigner3
        );
        console.log("  Admin:", address(admin));

        // ==========================================
        // Step 3: Deploy Pair
        // ==========================================
        console.log("");
        console.log("Step 3: Deploying Pair...");

        ZkAMMPair pair = new ZkAMMPair(
            address(admin),
            ROOT_TOKEN,
            "r00t",
            "ROOT"
        );
        console.log("  Pair:", address(pair));
        console.log("  TokenPool:", address(pair.tokenPool()));
        console.log("  LPPool:", address(pair.lpPool()));

        require(address(pair) == predictedPairAddress, "Pair address mismatch!");

        // ==========================================
        // Step 4: Deploy Router
        // ==========================================
        console.log("");
        console.log("Step 4: Deploying Router...");

        ZkAMMRouter router = new ZkAMMRouter(
            address(pair),
            address(admin)
        );
        console.log("  Router:", address(router));

        // ==========================================
        // Step 5: Configure Admin
        // ==========================================
        console.log("");
        console.log("Step 5: Configuring Admin...");

        admin.setRouter(address(router));
        admin.setVerifierInitial("addLiquidity", addLiquidityVerifier);
        admin.setVerifierInitial("removeLiquidity", removeLiquidityVerifier);
        admin.setVerifierInitial("claimLPFees", claimLPFeesVerifier);
        admin.setVerifierInitial("swap", swapVerifier);
        admin.setVerifierInitial("merge", mergeVerifier);
        console.log("  Admin configured");

        // ==========================================
        // Step 6: Transfer ROOT tokens to Pair
        // ==========================================
        console.log("");
        console.log("Step 6: Transferring ROOT tokens to Pair...");

        IERC20 rootToken = IERC20(ROOT_TOKEN);
        uint256 deployerBalance = rootToken.balanceOf(deployer);
        console.log("  Deployer ROOT balance:", deployerBalance / 1e18);

        if (deployerBalance > 0) {
            rootToken.transfer(address(pair), deployerBalance);
            console.log("  Transferred", deployerBalance / 1e18, "ROOT to Pair");
        } else {
            console.log("  WARNING: No ROOT tokens available");
        }

        // ==========================================
        // Step 7: Bootstrap Liquidity
        // ==========================================
        console.log("");
        console.log("Step 7: Bootstrapping liquidity...");

        uint256 lpCommitment = uint256(keccak256(abi.encodePacked("r00t_bootstrap_v2_", block.chainid, address(pair)))) % pair.SNARK_SCALAR_FIELD();

        router.bootstrapLiquidity{value: initialEth}(
            lpCommitment,
            0,
            block.timestamp + 1 hours,
            ""
        );
        console.log("  Pool bootstrapped!");

        // ==========================================
        // Step 8: Deploy R00TShorts
        // ==========================================
        console.log("");
        console.log("Step 8: Deploying R00TShorts...");

        R00TShorts shorts = new R00TShorts(
            address(pair),
            ROOT_TOKEN,
            deployer  // treasury
        );
        console.log("  R00TShorts:", address(shorts));

        // ==========================================
        // Step 9: Set shorts on pair (via admin)
        // ==========================================
        console.log("");
        console.log("Step 9: Setting shorts contract on pair...");

        admin.setShortsContractInitial(address(shorts));
        console.log("  Shorts contract authorized");

        // ==========================================
        // Step 10: Fund shorts with ROOT tokens
        // ==========================================
        console.log("");
        console.log("Step 10: Funding shorts with ROOT tokens...");

        uint256 pairBalance = rootToken.balanceOf(address(pair));
        if (pairBalance > SHORTS_TOKEN_ALLOCATION) {
            // Withdraw ROOT from pair to deployer, then to shorts
            // Note: pair.withdrawROOT needs admin call
            console.log("  Pair has", pairBalance / 1e18, "ROOT");
            console.log("  NOTE: Fund shorts manually with ROOT tokens");
        } else {
            console.log("  NOTE: Fund shorts manually with ROOT tokens");
        }

        vm.stopBroadcast();

        // ==========================================
        // Summary
        // ==========================================
        console.log("");
        console.log("=====================================================");
        console.log("   DEPLOYMENT COMPLETE                               ");
        console.log("=====================================================");
        console.log("");
        console.log("NEW CONTRACTS:");
        console.log("  Admin:", address(admin));
        console.log("  Pair:", address(pair));
        console.log("  Router:", address(router));
        console.log("  R00TShorts:", address(shorts));
        console.log("  TokenPool:", address(pair.tokenPool()));
        console.log("  LPPool:", address(pair.lpPool()));
        console.log("");
        console.log("REUSED:");
        console.log("  ROOT Token:", ROOT_TOKEN);
        console.log("");
        console.log("UPDATE frontend/src/config.ts with:");
        console.log("  zkAMMPair:", address(pair));
        console.log("  zkAMMRouter:", address(router));
        console.log("  zkAMMAdmin:", address(admin));
        console.log("  tokenPool:", address(pair.tokenPool()));
        console.log("  lpPool:", address(pair.lpPool()));
        console.log("  shortsContract:", address(shorts));
        console.log("");
    }
}
