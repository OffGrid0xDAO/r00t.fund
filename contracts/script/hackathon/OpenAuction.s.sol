// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";

interface ILaunchpad {
    function createParcel(bytes32 parcelId, IERC20 parcelToken, address regenTreasury, uint256 saleTokens, uint256 poolTokens, uint256 reservePriceR00T, uint64 window) external;
    function bid(bytes32 parcelId, uint256 r00tAmount) external;
    function phaseOf(bytes32) external view returns (uint8);
}

/// @notice Opens a LIVE ongoing CCA on the deployed RegenLaunchpad so the frontend shows an active
///         raise (backers can bid; anyone clearAndLaunch's when the window ends → seeds a real v4 pool).
contract OpenAuction is Script {
    address constant LAUNCHPAD = 0x2EaFE93d9ecf8B8E2Dd0C5f0B5c86a374206C6B0;
    address constant ROOT = 0x3d47002Cbe4e1d1a0640fc20aD1a75eB6559D73B;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        bytes32 id = bytes32("CARROT-RAISE");
        address treasury = address(uint160(uint256(keccak256("r00t.regen.treasury.carrot"))));

        vm.startBroadcast(pk);
        // new parcel token to auction
        TestToken carrot = new TestToken("Carrot Parcel", "CARROT");
        carrot.mint(me, 250_000e18);
        carrot.approve(LAUNCHPAD, type(uint256).max);

        // open a 2-hour uniform-price CCA: 100k CARROT sold, 100k for pools, floor 0.01 R00T/CARROT
        ILaunchpad(LAUNCHPAD).createParcel(id, IERC20(address(carrot)), treasury, 100_000e18, 100_000e18, 0.01e18, 7200);

        // seed an opening bid so the raise shows activity (needs R00T + approval)
        TestToken(ROOT).mint(me, 3_000e18);
        IERC20(ROOT).approve(LAUNCHPAD, type(uint256).max);
        ILaunchpad(LAUNCHPAD).bid(id, 3_000e18);
        vm.stopBroadcast();

        console2.log("opened CARROT raise; phase:", ILaunchpad(LAUNCHPAD).phaseOf(id));
        console2.log("CARROT token:", address(carrot));
    }
}
