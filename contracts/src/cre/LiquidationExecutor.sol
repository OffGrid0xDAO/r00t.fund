// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";
import "../interfaces/IR00TShorts.sol";

/// @title LiquidationExecutor
/// @author r00t.fund
/// @notice CRE callback contract that executes batch liquidations on R00TShorts (Workflow 2)
/// @dev The CRE DON forwarder cannot receive ETH (no receive()), so this thin executor
///      contract acts as the liquidator address, collecting the 5% bonus.
contract LiquidationExecutor is R00tCREReceiver {
    // ============ State ============

    /// @notice The R00TShorts contract to liquidate positions on
    IR00TShorts public immutable r00tShorts;

    /// @notice Total liquidations executed
    uint256 public totalLiquidations;

    /// @notice Total bonus ETH earned from liquidations
    uint256 public totalBonusEarned;

    // ============ Events ============

    event LiquidationBatchExecuted(uint256 count, uint256 totalBonus);
    event BonusesWithdrawn(address indexed to, uint256 amount);

    // ============ Errors ============

    error ArrayLengthMismatch();
    error EmptyArray();
    error WithdrawFailed();
    error InsufficientBalance();

    // ============ Constructor ============

    constructor(
        address _r00tShorts,
        address _donForwarder,
        address _owner
    ) R00tCREReceiver(_donForwarder, _owner) {
        if (_r00tShorts == address(0)) revert ZeroAddress();
        r00tShorts = IR00TShorts(_r00tShorts);
    }

    // ============ CRE Callback ============

    /// @notice Execute a batch of liquidations, called by the CRE DON forwarder
    /// @param positionIds Array of position IDs to liquidate
    /// @param maxRepurchaseCosts Array of max repurchase costs (with slippage buffer)
    function executeLiquidations(
        uint256[] calldata positionIds,
        uint256[] calldata maxRepurchaseCosts
    ) external onlyDonForwarder whenNotPaused {
        if (positionIds.length == 0) revert EmptyArray();
        if (positionIds.length != maxRepurchaseCosts.length) revert ArrayLengthMismatch();

        _recordReport();

        uint256 balanceBefore = address(this).balance;
        uint256 executed = 0;

        for (uint256 i = 0; i < positionIds.length; i++) {
            try r00tShorts.liquidate(positionIds[i], maxRepurchaseCosts[i]) {
                executed++;
            } catch {
                // Position may no longer be liquidatable (closed or price moved)
            }
        }

        uint256 bonusReceived = address(this).balance - balanceBefore;
        totalLiquidations += executed;
        totalBonusEarned += bonusReceived;

        emit LiquidationBatchExecuted(executed, bonusReceived);
    }

    // ============ Admin Functions ============

    /// @notice Withdraw accumulated liquidation bonuses
    /// @param to Address to send bonuses to
    /// @param amount Amount of ETH to withdraw
    function withdrawBonuses(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) revert InsufficientBalance();

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert WithdrawFailed();

        emit BonusesWithdrawn(to, amount);
    }

    // ============ Receive ============

    /// @notice Accept ETH from liquidation bonuses
    receive() external payable {}
}
