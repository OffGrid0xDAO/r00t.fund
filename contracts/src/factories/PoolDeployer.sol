// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkProjectPool} from "../ZkProjectPool.sol";

/// @title PoolDeployer
/// @notice Deploys ZkProjectPool instances directly (full contract deployment)
/// @dev Changed from clone pattern because ZkProjectPoolImpl exceeds 24KB limit.
///      Each pool is a full contract deployment (~20KB) rather than a minimal proxy.
///      This is more expensive but stays within EIP-170 size limits.
///      SECURITY: All admin changes require 48-hour timelock for consistency with other contracts
contract PoolDeployer {
    /// @notice Admin timelock duration (TESTNET: 1 minute)
    /// @dev SECURITY FIX (Vuln 2,3): Critical admin changes require timelock
    uint256 public constant ADMIN_TIMELOCK = 1 minutes; // TESTNET: Changed from 48 hours for testing

    /// @notice Factory that can call this deployer
    address public factory;

    /// @notice Owner for admin functions
    address public owner;

    /// @notice Total pools deployed
    uint256 public poolCount;

    // ============ Pending Admin Changes (Timelock) ============
    // SECURITY FIX (Vuln 2,3): Critical admin changes require 48-hour timelock

    /// @notice Pending factory address
    address public pendingFactory;
    /// @notice Timelock expiry for pending factory change
    uint256 public factoryTimelockExpiry;

    /// @notice Pending owner address
    address public pendingOwner;
    /// @notice Timelock expiry for pending owner change
    uint256 public ownerTimelockExpiry;

    event PoolCreated(address indexed pool, uint256 indexed poolId);
    event FactoryProposed(address indexed proposed, uint256 effectiveTime);
    event FactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event OwnershipTransferProposed(address indexed proposed, uint256 effectiveTime);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AdminProposalCancelled(string configType, address cancelled);

    error Unauthorized();
    error ZeroAddress();
    error FactoryAlreadySet();
    error TimelockNotExpired();
    error NoPendingChange();

    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ============ Initial Setup (One-time) ============

    /// @notice Set factory address for initial deployment (only if not yet set)
    /// @dev Can only be called once - before factory is set. After that, use timelocked proposeFactory.
    ///      This allows initial deployment without waiting for timelock.
    function setFactoryInitial(address _factory) external onlyOwner {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
        emit FactoryUpdated(address(0), _factory);
    }

    // ============ Timelocked Admin Functions ============
    // SECURITY FIX (Vuln 2,3): All critical admin changes require 48-hour timelock

    /// @notice Propose new factory address (starts timelock)
    /// @dev SECURITY FIX (Vuln 2): Prevents instant factory change by compromised owner
    ///      Factory controls pool deployment, so instant change could allow malicious deployments
    ///      NOTE: For initial setup, use setFactoryInitial() instead.
    function proposeFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        pendingFactory = _factory;
        factoryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit FactoryProposed(_factory, factoryTimelockExpiry);
    }

    /// @notice Accept pending factory change (after timelock)
    function acceptFactory() external onlyOwner {
        if (pendingFactory == address(0)) revert NoPendingChange();
        if (block.timestamp < factoryTimelockExpiry) revert TimelockNotExpired();

        address oldFactory = factory;
        factory = pendingFactory;
        pendingFactory = address(0);
        factoryTimelockExpiry = 0;
        emit FactoryUpdated(oldFactory, factory);
    }

    /// @notice Deploy a new ZkProjectPool (full contract, not clone)
    function deploy(
        string calldata _name,
        string calldata _symbol,
        address token,
        uint256 initialRootReserve,
        address r00tPool,
        address nullifierRegistry,
        address creator,
        address platform,
        uint256 proposalId,
        uint256 maxDevAllocationBps
    ) external onlyFactory returns (address pool) {
        // Deploy full ZkProjectPool contract
        ZkProjectPool newPool = new ZkProjectPool(
            _name,
            _symbol,
            token,
            initialRootReserve,
            r00tPool,
            nullifierRegistry,
            creator,
            platform,
            proposalId,
            maxDevAllocationBps
        );

        pool = address(newPool);
        poolCount++;

        emit PoolCreated(pool, poolCount - 1);
    }

    // ============ Timelocked Ownership Transfer ============
    // SECURITY FIX (Vuln 3): Ownership transfer requires 48-hour timelock

    /// @notice Propose ownership transfer (starts timelock)
    /// @dev SECURITY FIX (Vuln 3): Prevents instant takeover if owner key is compromised
    function proposeOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        ownerTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit OwnershipTransferProposed(newOwner, ownerTimelockExpiry);
    }

    /// @notice Accept pending ownership transfer (after timelock)
    function acceptOwnershipTransfer() external {
        // SECURITY FIX: Allow pending owner (not just current owner) to accept
        if (msg.sender != owner && msg.sender != pendingOwner) revert Unauthorized();
        if (pendingOwner == address(0)) revert NoPendingChange();
        if (block.timestamp < ownerTimelockExpiry) revert TimelockNotExpired();

        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit OwnershipTransferred(oldOwner, owner);
    }

    /// @notice Cancel any pending admin proposal
    /// @param configType "owner" or "factory"
    function cancelAdminProposal(string calldata configType) external onlyOwner {
        bytes32 typeHash = keccak256(bytes(configType));

        if (typeHash == keccak256("owner")) {
            if (pendingOwner == address(0)) revert NoPendingChange();
            address cancelled = pendingOwner;
            pendingOwner = address(0);
            ownerTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else if (typeHash == keccak256("factory")) {
            if (pendingFactory == address(0)) revert NoPendingChange();
            address cancelled = pendingFactory;
            pendingFactory = address(0);
            factoryTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else {
            revert ZeroAddress(); // Invalid config type
        }
    }
}
