// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/R00TShorts.sol";
import "../src/ZkAMMPair.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployR00TShorts
/// @notice Deploy R00TShorts contract to Sepolia and connect with existing ZkAMM
/// @dev After deployment:
///   1. Shorts contract is deployed
///   2. Admin sets shorts contract on pair
///   3. ROOT tokens transferred to shorts contract
contract DeployR00TShortsScript is Script {
    // Deployed Sepolia addresses (fresh deploy 2026-02-06, configurable OI limit + liquidation fix)
    address constant PAIR = 0xdacF977d96840748EB5624508BF98fc5E8CC84E1;
    address constant ROOT_TOKEN = 0x1c5452b40432060Bf196989E709d70df1cfad8d0;
    address constant ADMIN = 0xA0BD95af436e8a6d6d3dd8700E2c72209C6Fb164;

    // Amount of ROOT tokens to fund shorts contract with (1M tokens = 1.45% of supply)
    uint256 constant SHORTS_TOKEN_ALLOCATION = 1_000_000 * 1e18;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = deployer; // Use deployer as treasury for now

        console.log("");
        console.log("=====================================================");
        console.log("   R00TShorts Deployment (Sepolia)                   ");
        console.log("=====================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        console.log("");
        console.log("Existing Contracts:");
        console.log("  Pair:", PAIR);
        console.log("  ROOT Token:", ROOT_TOKEN);
        console.log("  Admin:", ADMIN);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ==========================================
        // Step 1: Deploy R00TShorts
        // ==========================================
        console.log("Step 1: Deploying R00TShorts...");

        R00TShorts shorts = new R00TShorts(
            PAIR,
            ROOT_TOKEN,
            treasury
        );
        console.log("  R00TShorts:", address(shorts));

        // ==========================================
        // Step 2: Note about setting shorts contract on pair
        // ==========================================
        console.log("");
        console.log("Step 2: Shorts contract deployed.");
        console.log("  NOTE: You need to call setShortsContract on pair from admin account");

        // ==========================================
        // Step 3: Fund shorts with ROOT tokens
        // ==========================================
        console.log("");
        console.log("Step 3: Funding shorts with ROOT tokens...");

        IERC20 rootToken = IERC20(ROOT_TOKEN);
        uint256 deployerBalance = rootToken.balanceOf(deployer);
        console.log("  Deployer ROOT balance:", deployerBalance / 1e18);

        if (deployerBalance >= SHORTS_TOKEN_ALLOCATION) {
            rootToken.transfer(address(shorts), SHORTS_TOKEN_ALLOCATION);
            console.log("  Transferred", SHORTS_TOKEN_ALLOCATION / 1e18, "ROOT to shorts");
        } else if (deployerBalance > 0) {
            rootToken.transfer(address(shorts), deployerBalance);
            console.log("  Transferred", deployerBalance / 1e18, "ROOT to shorts (all available)");
        } else {
            console.log("  WARNING: No ROOT tokens to transfer");
            console.log("  You need to fund the shorts contract manually");
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
        console.log("R00TShorts:", address(shorts));
        console.log("");
        console.log("Contract Parameters:");
        console.log("  Pair:", PAIR);
        console.log("  ROOT Token:", ROOT_TOKEN);
        console.log("  Treasury:", treasury);
        console.log("  Available Tokens:", shorts.getAvailableTokens() / 1e18, "ROOT");
        console.log("");
        console.log("If shorts not authorized, run:");
        console.log("  cast send <PAIR> setShortsContract(address) <SHORTS>");
        console.log("");
        console.log("To fund with more tokens:");
        console.log("  cast send <ROOT_TOKEN> transfer(address,uint256) <SHORTS> <amount>");
        console.log("");
        console.log("Frontend config addition:");
        console.log("  shortsContract:", address(shorts));
        console.log("");
    }
}
