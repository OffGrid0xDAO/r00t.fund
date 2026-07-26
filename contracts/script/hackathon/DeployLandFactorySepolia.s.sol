// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LandFactory} from "../../src/LandFactory.sol";
import {Land} from "../../src/Land.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestRootToken} from "../../src/TestRootToken.sol";

/// @notice Multi-tenant Land rail on Ethereum Sepolia — mirrors the Robinhood Chain LandFactory so
///         the whole steward flow (createLand → validate → createParcel → seed v4 liquidity) can be
///         tested end-to-end BEFORE going live on Robinhood. Reuses the hackathon $R00T + the
///         canonical Sepolia Uniswap v4 PoolManager; deploys a mock USDC for the USD-accounting path.
///
/// Env:
///   PRIVATE_KEY   deployer (holds the hackathon $R00T)
///   ROOT_TOKEN    hackathon $R00T (default = clean-stack R00T on Sepolia)
///   POOL_MANAGER  Uniswap v4 PoolManager (default = canonical Sepolia)
///   SMOKE=1       also createLand once to prove the whole path (optional)
///
/// Run:
///   source .env && forge script script/hackathon/DeployLandFactorySepolia.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
contract DeployLandFactorySepolia is Script {
    // Clean-stack hackathon $R00T on Sepolia (DeployCleanStack).
    address constant HACKATHON_ROOT = 0x70E3432B83a83Caa818a98010DF87AF6daa6AbC9;
    // Canonical Uniswap v4 PoolManager on Ethereum Sepolia.
    address constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address root = vm.envOr("ROOT_TOKEN", HACKATHON_ROOT);
        address poolManager = vm.envOr("POOL_MANAGER", SEPOLIA_POOL_MANAGER);
        bool smoke = vm.envOr("SMOKE", uint256(0)) == 1;

        vm.startBroadcast(pk);

        // Mock USDC for the USD-accounting path (Land stores it; ETH funding works regardless).
        address usdc = address(new TestRootToken());

        LandFactory factory = new LandFactory(
            root,
            usdc,
            deployer,        // validator (deployer confirms off-chain terrain checks for the demo)
            poolManager,
            deployer,        // protocolTreasury (protocol's 30% of parcel pool fees)
            1e18,            // minR00tPledge — low so any steward can open a land
            3000,            // poolFee 0.30%
            int24(60),       // tickSpacing
            10000            // defaultRootPriceE6 = $0.01 / R00T (matches the hackathon seed)
        );

        address smokeLand;
        if (smoke) {
            uint256 bond = 1e18;
            IERC20(root).approve(address(factory), bond);
            smokeLand = factory.createLand(LandFactory.CreateArgs({
                name: "Smoke Test Land",
                region: "Sepolia",
                boundaryHash: keccak256("boundary"),
                topoHash: keccak256("topo"),
                cid: "ipfs://smoke",
                treasury: deployer,
                ethPriceE6: 1800_000000,
                r00tPledge: bond
            }));
        }

        vm.stopBroadcast();

        console.log("=== Land rail (Ethereum Sepolia) ===");
        console.log("  LandFactory   :", address(factory));
        console.log("  $R00T (reuse) :", root);
        console.log("  mock USDC     :", usdc);
        console.log("  Uniswap v4 PM :", poolManager);
        console.log("  validator     :", deployer);
        if (smoke) console.log("  smoke Land    :", smokeLand);
        console.log("Next: set HACKATHON.landFactory + HACKATHON.usdc in frontend/src/config.ts");
    }
}
