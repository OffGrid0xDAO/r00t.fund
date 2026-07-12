// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LandFactory} from "../src/LandFactory.sol";
import {Land} from "../src/Land.sol";
import {LandVault} from "../src/LandVault.sol";
import {NullifierRegistry} from "../src/NullifierRegistry.sol";
import {RealLandDepositVerifier} from "../src/verifiers/RealLandDepositVerifier.sol";
import {RealClaimVerifier} from "../src/verifiers/RealClaimVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestRootToken} from "../src/TestRootToken.sol";

/// @notice Deploys the full LandVault chain on Robinhood Chain (4663):
///   new LandFactory (landVault-aware Land) → createLand (deployer bonds R00T) →
///   validate → createParcel → verifiers + NullifierRegistry + LandVault → wire.
/// Reuses existing $R00T + USDG + v4 PoolManager.
///
/// Env: PRIVATE_KEY, ROOT_TOKEN, USDC_ADDRESS, [POOL_MANAGER]
contract DeployLandVault is Script {
    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address root = vm.envAddress("ROOT_TOKEN");
        // USDC/USDG for the pay-with-stablecoin funding path. If the real RH stablecoin
        // address isn't provided, deploy a mock so the vault deploys and ETH-funding can be
        // tested end-to-end (the USDC path just uses this mock). Replace with real USDG later.
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        address poolManager = vm.envOr("POOL_MANAGER", RH_POOL_MANAGER);

        uint256 landBond = 1_000e18;      // steward bond to the Land (pool-seed reserve)
        uint256 vaultReserve = 5_000_000e18; // R00T the vault holds to back claims
        uint256 rootPriceE6 = 100000;     // $0.10 / R00T
        uint256 ethPriceE6 = 3000_000000; // $3000 / ETH
        bytes32 parcelId = bytes32(uint256(1));
        uint256 parcelTarget = 100e18;    // R00T-equiv to "fully fund" the demo parcel

        vm.startBroadcast(pk);

        // 0. Mock stablecoin if no real USDG provided (test ETH-funding path works regardless).
        if (usdc == address(0)) {
            usdc = address(new TestRootToken());
            console.log("  mock USDC (test)  :", usdc);
        }

        // 1. Factory (validator = protocolTreasury = deployer for the demo)
        LandFactory factory = new LandFactory(
            root, usdc, deployer, poolManager, deployer,
            1e18,            // minR00tPledge
            3000,            // poolFee 0.30%
            int24(60),       // tickSpacing
            rootPriceE6      // defaultRootPriceE6
        );

        // 2. Open a Land — deployer bonds R00T
        IERC20(root).approve(address(factory), landBond);
        address landAddr = factory.createLand(LandFactory.CreateArgs({
            name: "Project 001",
            region: "Southern Europe - uplands",
            boundaryHash: keccak256("boundary"),
            topoHash: keccak256("topo"),
            cid: "ipfs://demo",
            treasury: deployer,
            ethPriceE6: ethPriceE6,
            r00tPledge: landBond
        }));
        Land land = Land(landAddr);

        // 3. Validate (deployer is the validator) + create a parcel
        land.validate();
        land.createParcel(parcelId, "Oak Terrace", "OAK");

        // 4. Verifiers + SHARED nullifier registry + vault.
        //    Use the SAME registry the v2 zkAMM router uses (deployer is its governance), so a
        //    shielded allocation can never be double-spent ACROSS rails — funded-then-claimed
        //    here AND sold on the zkAMM both mark the one global set. (Set REGISTRY via env to
        //    override; default = v2 shared registry.)
        address depositV = address(new RealLandDepositVerifier());
        address claimV = address(new RealClaimVerifier());
        NullifierRegistry reg = NullifierRegistry(vm.envOr("REGISTRY", 0x6Ae7adf4Cba5eEAc58a70832998bdb18C6588D4A));
        // Deployed v2 verifiers the ZkParcelPool reuses (swap/deposit/withdraw). Defaults = RH v2.
        address swapV = vm.envOr("SWAP_VERIFIER", 0x63B376A158BCaC3e2b5349297E7D3bdbA357A3b6);
        address r00tDepV = vm.envOr("DEPOSIT_VERIFIER", 0x3B80AABD8c8d52b272Ce836737396186Dc87105c);
        address withdrawV = vm.envOr("WITHDRAW_VERIFIER", 0x3F8a748ceCf94C05bF65968674db4c6b0942ad11);
        LandVault vault = new LandVault(landAddr, root, usdc, address(reg), depositV, claimV, swapV, r00tDepV, withdrawV);

        // 5. Wire: vault can mint parcel tokens; vault authorized to mark nullifiers in the
        //    shared registry (deployer is governance, so this authorization succeeds).
        land.setLandVault(address(vault));
        reg.setPoolAuthorization(address(vault), true);

        // 6. Steward bonds the vault reserve + sets the parcel target
        IERC20(root).approve(address(vault), vaultReserve);
        vault.fundReserve(vaultReserve);
        vault.setParcelTarget(parcelId, parcelTarget);

        vm.stopBroadcast();

        console.log("=== LandVault chain (Robinhood Chain) ===");
        console.log("  LandFactory      :", address(factory));
        console.log("  Land             :", landAddr);
        console.log("  parcel token     :", land.parcelToken(parcelId));
        console.log("  LandVault        :", address(vault));
        console.log("  NullifierRegistry:", address(reg));
        console.log("  landDepositVerif :", depositV);
        console.log("  claimVerifier    :", claimV);
        console.log("  parcelId (uint)  :", uint256(parcelId));
        console.log("  parcelTarget R00T:", parcelTarget);
        console.log("  vault reserve    :", vaultReserve);
    }
}
