// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ParcelLauncher} from "../../src/hackathon/ParcelLauncher.sol";

/// @notice Deploy the one-tx ParcelLauncher, wired to the live RegenLaunchpad + R00T on Sepolia.
///         Override with env: LAUNCHPAD, ROOT. Then set VITE_PARCEL_LAUNCHER in the frontend.
///         forge script script/hackathon/DeployParcelLauncher.s.sol --rpc-url $SEPOLIA --broadcast
contract DeployParcelLauncher is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address launchpad = vm.envOr("LAUNCHPAD", address(0xC6d8369d72dAC352Ef439Aa37a81355ED442CB11));
        address root = vm.envOr("ROOT", address(0x70E3432B83a83Caa818a98010DF87AF6daa6AbC9));

        vm.startBroadcast(pk);
        ParcelLauncher launcher = new ParcelLauncher(launchpad, root);
        vm.stopBroadcast();

        console2.log("ParcelLauncher:", address(launcher));
        console2.log("  launchpad:", launchpad);
        console2.log("  root:", root);
        console2.log("Set frontend VITE_PARCEL_LAUNCHER to the address above.");
    }
}
