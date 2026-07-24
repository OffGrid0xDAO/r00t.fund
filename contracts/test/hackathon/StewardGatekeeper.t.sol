// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StewardGatekeeper, IWorldID} from "../../src/hackathon/StewardGatekeeper.sol";
import {RegenLaunchpad, IRegenArbHook} from "../../src/hackathon/RegenLaunchpad.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// mock World ID Router: verifyProof reverts unless the (root, nullifier) pair was pre-approved.
contract MockWorldID is IWorldID {
    mapping(bytes32 => bool) public ok;
    function approve(uint256 root, uint256 nullifierHash) external { ok[keccak256(abi.encode(root, nullifierHash))] = true; }
    function verifyProof(uint256 root, uint256, uint256, uint256 nullifierHash, uint256, uint256[8] calldata) external view {
        require(ok[keccak256(abi.encode(root, nullifierHash))], "invalid proof");
    }
}

contract StewardGatekeeperTest is Test {
    MockWorldID world;
    StewardGatekeeper gate;
    address attester = makeAddr("attester");
    address steward = makeAddr("steward");
    address agent = makeAddr("agent");
    uint256[8] proof; // mock ignores proof contents

    function setUp() public {
        world = new MockWorldID();
        gate = new StewardGatekeeper(IWorldID(address(world)), uint256(keccak256("app_r00t:launch")), attester);
    }

    function test_notEligible_untilAllThreeLayers() public {
        assertFalse(gate.isEligibleSteward(steward), "starts ineligible");

        // 1) on-chain Proof-of-Human
        world.approve(1, 42);
        gate.verifyHuman(steward, 1, 42, proof);
        assertFalse(gate.isEligibleSteward(steward), "PoH alone is not enough");

        // 2) cloud-verified Selfie + Identity relayed by the attester
        vm.prank(attester);
        gate.attest(steward, true, true, true);
        assertTrue(gate.isEligibleSteward(steward), "human + selfie + jurisdiction + age = eligible");
    }

    function test_identityFailBlocks() public {
        world.approve(1, 7);
        gate.verifyHuman(steward, 1, 7, proof);
        vm.prank(attester);
        gate.attest(steward, true, false, true); // wrong jurisdiction
        assertFalse(gate.isEligibleSteward(steward), "prohibited jurisdiction stays blocked");
    }

    function test_invalidWorldProof_reverts() public {
        // never approved in the mock → verifyProof reverts
        vm.expectRevert(bytes("invalid proof"));
        gate.verifyHuman(steward, 9, 9, proof);
    }

    function test_nullifier_cannotBeReused() public {
        world.approve(1, 100);
        gate.verifyHuman(steward, 1, 100, proof);
        world.approve(1, 100); // same nullifier, different target address
        vm.expectRevert(StewardGatekeeper.NullifierAlreadyUsed.selector);
        gate.verifyHuman(agent, 1, 100, proof);
    }

    function test_humanBackedAgent_inheritsEligibility() public {
        world.approve(1, 5);
        gate.verifyHuman(steward, 1, 5, proof);
        vm.prank(attester);
        gate.attest(steward, true, true, true);
        // the agent isn't itself verified...
        assertFalse(gate.isEligibleSteward(agent), "unregistered agent ineligible");
        // ...until registered as backed by the eligible human
        vm.prank(attester);
        gate.registerAgent(agent, steward);
        assertTrue(gate.isEligibleSteward(agent), "human-backed agent inherits eligibility");
    }

    function test_onlyAttester_canAttest() public {
        vm.expectRevert(StewardGatekeeper.NotAttester.selector);
        gate.attest(steward, true, true, true);
    }

    /// the launchpad actually enforces the gate: createParcel reverts for an unverified steward.
    function test_launchpad_enforces_gate() public {
        RegenLaunchpad lp = new RegenLaunchpad(
            IPoolManager(address(1)), IRegenArbHook(address(1)), IERC20(address(1)), address(this), address(gate)
        );
        vm.expectRevert(bytes("steward not World-verified"));
        lp.createParcel(bytes32("P"), IERC20(address(2)), address(3), 1e18, 1e18, 0.02e18, 3600);
    }
}
