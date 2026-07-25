// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {RegenLaunchpad, IRegenArbHook} from "../../src/hackathon/RegenLaunchpad.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice Deploys a FRESH, fully-automated RegenLaunchpad where ANY steward self-launches: the
///         shared RegenArbHook + a RegenLaunchpad with protocolReserve = address(0) (steward self-seeds
///         the R00T pool side). Also deploys the shared R00T. No demo parcel, no hardcoding — the
///         frontend drives createParcel/bid/clearAndLaunch and auto-discovers every launch.
contract DeployLaunchpadV2 is Script {
    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        // Reuse an EXISTING R00T (ROOT_ADDRESS) so parcels + the base R00T/ETH market share ONE token
        // (coherence); deploy a fresh one only if not provided.
        address existingRoot = vm.envOr("ROOT_ADDRESS", address(0));

        vm.startBroadcast(pk);
        TestToken root = existingRoot != address(0) ? TestToken(existingRoot) : new TestToken("r00t.fund", "ROOT");

        // shared hook (afterSwap), mined; launchpad set after (resolves the cycle)
        bytes memory args = abi.encode(manager, me);
        uint256 startSalt = uint256(keccak256(abi.encodePacked(me, block.timestamp, "v2")));
        (address hookAddr, bytes32 salt) = HookMiner.find(uint160(Hooks.AFTER_SWAP_FLAG), type(RegenArbHook).creationCode, args, startSalt);
        RegenArbHook hook = new RegenArbHook{salt: salt}(manager, me);
        require(address(hook) == hookAddr, "hook addr mismatch");

        // protocolReserve = address(0) → stewards self-seed the R00T pool side. gatekeeper = 0 (open).
        RegenLaunchpad launchpad = new RegenLaunchpad(manager, IRegenArbHook(hookAddr), IERC20(address(root)), address(0), address(0));
        hook.setLaunchpad(address(launchpad));
        vm.stopBroadcast();

        console2.log("== RegenLaunchpad V2 (self-seed, any steward) ==");
        console2.log("PoolManager", address(manager));
        console2.log("launchpad  ", address(launchpad));
        console2.log("hook       ", address(hook));
        console2.log("ROOT       ", address(root));
    }
}
