// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title R00tCREReceiver
/// @author r00t.fund
/// @notice Base contract for receiving Chainlink CRE DON callback reports
/// @dev All CRE callback contracts inherit from this base.
///      Validates that only the authorized DON forwarder can deliver reports.
abstract contract R00tCREReceiver {
    // ============ State ============

    /// @notice Authorized CRE DON forwarder address
    address public donForwarder;

    /// @notice Contract owner
    address public owner;

    /// @notice Whether the contract is paused
    bool public paused;

    /// @notice Total reports received
    uint256 public reportCount;

    /// @notice Timestamp of the last received report
    uint256 public lastReportTimestamp;

    // ============ Events ============

    event DonForwarderUpdated(address indexed oldForwarder, address indexed newForwarder);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ContractPaused(address indexed by);
    event ContractUnpaused(address indexed by);

    // ============ Errors ============

    error UnauthorizedForwarder();
    error UnauthorizedOwner();
    error ContractIsPaused();
    error ZeroAddress();

    // ============ Modifiers ============

    modifier onlyDonForwarder() {
        if (msg.sender != donForwarder) revert UnauthorizedForwarder();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractIsPaused();
        _;
    }

    // ============ Constructor ============

    constructor(address _donForwarder, address _owner) {
        if (_donForwarder == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        donForwarder = _donForwarder;
        owner = _owner;
    }

    // ============ Admin Functions ============

    /// @notice Update the authorized DON forwarder
    function setDonForwarder(address _donForwarder) external onlyOwner {
        if (_donForwarder == address(0)) revert ZeroAddress();
        address old = donForwarder;
        donForwarder = _donForwarder;
        emit DonForwarderUpdated(old, _donForwarder);
    }

    /// @notice Transfer ownership
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = _newOwner;
        emit OwnershipTransferred(old, _newOwner);
    }

    /// @notice Pause the contract
    function pause() external onlyOwner {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    // ============ Internal Helpers ============

    /// @dev Record that a report was received
    function _recordReport() internal {
        reportCount++;
        lastReportTimestamp = block.timestamp;
    }
}
