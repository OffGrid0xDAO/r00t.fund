// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ZkAMMAdmin.sol";
import "../src/ZkAMMPair.sol";

/**
 * @title EmergencyWithdraw Script
 * @notice Script to perform emergency ETH withdrawal from ZkAMM
 * @dev Requires 2-of-3 emergency signers to approve
 *
 * Usage:
 * 1. First signer calls emergencyWithdrawAll:
 *    forge script script/EmergencyWithdraw.s.sol:EmergencyWithdrawScript \
 *      --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast \
 *      -s "initiateWithdrawAll(address)" <RECIPIENT_ADDRESS>
 *
 * 2. Second signer confirms with action hash (from first tx logs):
 *    forge script script/EmergencyWithdraw.s.sol:EmergencyWithdrawScript \
 *      --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast \
 *      -s "confirmWithdraw(bytes32)" <ACTION_HASH>
 */
contract EmergencyWithdrawScript is Script {
    // Sepolia deployed addresses (2026-01-20 deployment with proper emergency signers)
    address constant ADMIN = 0xed36216535591751d81Ed58a9858C9268e427976;
    address constant PAIR = 0x80fdAa43B3C911766aB0A6af05A256080F42a169;

    function run() external view {
        // Just display info
        console.log("=== Emergency Withdraw Script ===");
        console.log("Admin contract:", ADMIN);
        console.log("Pair contract:", PAIR);

        // Check current ETH reserve
        ZkAMMPair pair = ZkAMMPair(payable(PAIR));
        uint256 ethReserve = pair.ethReserve();
        console.log("Current ETH reserve:", ethReserve);
        console.log("Current ETH reserve (in ETH):", ethReserve / 1e18);

        // Check emergency signers
        ZkAMMAdmin admin = ZkAMMAdmin(ADMIN);
        console.log("\nEmergency Signers:");
        console.log("  Signer 0:", admin.emergencySigners(0));
        console.log("  Signer 1:", admin.emergencySigners(1));
        console.log("  Signer 2:", admin.emergencySigners(2));

        console.log("\n=== To withdraw all ETH ===");
        console.log("1. First signer runs: initiateWithdrawAll(<recipient>)");
        console.log("2. Second signer runs: confirmWithdraw(<actionHash>)");
    }

    /// @notice First signer calls this to initiate withdrawal of all ETH
    function initiateWithdrawAll(address recipient) external {
        vm.startBroadcast();

        ZkAMMAdmin admin = ZkAMMAdmin(ADMIN);
        ZkAMMPair pair = ZkAMMPair(payable(PAIR));

        uint256 ethReserve = pair.ethReserve();
        console.log("Initiating withdrawal of", ethReserve, "wei to", recipient);

        // This will record the first approval and emit an event with the action hash
        admin.emergencyWithdrawAll(payable(recipient));

        // Calculate and log the action hash for the second signer
        bytes32 actionHash = keccak256(abi.encodePacked("emergencyWithdrawAll", recipient, ethReserve));
        console.log("Action hash for second signer:");
        console.logBytes32(actionHash);

        vm.stopBroadcast();
    }

    /// @notice First signer calls this to initiate withdrawal of specific amount
    function initiateWithdrawAmount(uint256 amount, address recipient) external {
        vm.startBroadcast();

        ZkAMMAdmin admin = ZkAMMAdmin(ADMIN);

        console.log("Initiating withdrawal of", amount, "wei to", recipient);

        admin.emergencyWithdrawETH(amount, payable(recipient));

        // Calculate and log the action hash for the second signer
        bytes32 actionHash = keccak256(abi.encodePacked("emergencyWithdrawETH", amount, recipient));
        console.log("Action hash for second signer:");
        console.logBytes32(actionHash);

        vm.stopBroadcast();
    }

    /// @notice Second signer calls this to confirm the withdrawal
    function confirmWithdraw(bytes32 actionHash) external {
        vm.startBroadcast();

        ZkAMMAdmin admin = ZkAMMAdmin(ADMIN);

        console.log("Confirming emergency action:");
        console.logBytes32(actionHash);

        admin.confirmEmergencyAction(actionHash);

        console.log("Emergency withdrawal confirmed!");

        vm.stopBroadcast();
    }

    /// @notice Check status of a pending emergency action
    function checkAction(bytes32 actionHash) external view {
        ZkAMMAdmin admin = ZkAMMAdmin(ADMIN);

        (uint8 actionType, uint256 amount, address recipient,,) = admin.pendingEmergencyActions(actionHash);
        uint8 approvals = admin.emergencyApprovals(actionHash);
        uint256 timestamp = admin.emergencyApprovalTimestamp(actionHash);

        console.log("Action type:", actionType);
        console.log("Amount:", amount);
        console.log("Recipient:", recipient);
        console.log("Approvals (bitmap):", approvals);
        console.log("Approval timestamp:", timestamp);
        console.log("Current time:", block.timestamp);
    }
}
