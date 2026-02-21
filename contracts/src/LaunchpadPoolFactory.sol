// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkProjectPool} from "./ZkProjectPool.sol";
import {ProjectToken} from "./ProjectToken.sol";
import {TokenPool} from "./TokenPool.sol";
import {NullifierRegistry} from "./NullifierRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Interface for ZkAMMv3 (main pool) for registering project pools
interface IZkAMMv3Factory {
    function registerProjectPool(address pool) external;
}

/// @title LaunchpadPoolFactory
/// @author r00t.fund
/// @notice Factory contract for deploying ZkProjectPool instances
/// @dev Extracted from LaunchpadGovernance to reduce contract size below 24KB limit
///      SECURITY FIX: All admin functions now require 48-hour timelock to prevent
///      instant takeover if owner key is compromised
contract LaunchpadPoolFactory {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Timelock duration for admin changes (TESTNET: 1 minute)
    /// @dev SECURITY FIX (Vuln 1): Prevents instant configuration changes if owner is compromised
    uint256 public constant ADMIN_TIMELOCK = 1 minutes; // TESTNET: Changed from 48 hours for testing

    // ============ State ============

    /// @notice LaunchpadGovernance contract (only caller allowed)
    address public immutable governance;

    /// @notice Main ZkAMMv3 contract
    address public zkAMMv3;

    /// @notice Main R00T token pool
    TokenPool public immutable r00tPool;

    /// @notice Global nullifier registry
    NullifierRegistry public nullifierRegistry;

    /// @notice Platform treasury address
    address public platformTreasury;

    /// @notice Owner (can update config)
    address public owner;

    // ============ Timelock State (SECURITY FIX Vuln 1) ============

    /// @notice Pending ZkAMMv3 address for timelock
    address public pendingZkAMMv3;
    /// @notice Timelock expiry for pending ZkAMMv3 change
    uint256 public zkAMMv3TimelockExpiry;

    /// @notice Pending NullifierRegistry address for timelock
    address public pendingNullifierRegistry;
    /// @notice Timelock expiry for pending NullifierRegistry change
    uint256 public nullifierRegistryTimelockExpiry;

    /// @notice Pending platform treasury address for timelock
    address public pendingPlatformTreasury;
    /// @notice Timelock expiry for pending platform treasury change
    uint256 public platformTreasuryTimelockExpiry;

    /// @notice Pending owner address for timelock
    address public pendingOwner;
    /// @notice Timelock expiry for pending owner change
    uint256 public ownerTimelockExpiry;

    // ============ Events ============

    event PoolDeployed(
        uint256 indexed proposalId,
        address indexed poolAddress,
        address indexed tokenAddress,
        string name,
        string symbol,
        uint256 totalSupply,
        uint256 pledgedR00t
    );

    // Timelock events (SECURITY FIX Vuln 1)
    event ZkAMMv3ChangeProposed(address indexed current, address indexed pending, uint256 effectiveTime);
    event ZkAMMv3ChangeCompleted(address indexed previous, address indexed newAddress);
    event ZkAMMv3ChangeCancelled(address indexed cancelled);
    event NullifierRegistryChangeProposed(address indexed current, address indexed pending, uint256 effectiveTime);
    event NullifierRegistryChangeCompleted(address indexed previous, address indexed newAddress);
    event NullifierRegistryChangeCancelled(address indexed cancelled);
    event PlatformTreasuryChangeProposed(address indexed current, address indexed pending, uint256 effectiveTime);
    event PlatformTreasuryChangeCompleted(address indexed previous, address indexed newAddress);
    event PlatformTreasuryChangeCancelled(address indexed cancelled);
    event OwnershipTransferProposed(address indexed current, address indexed pending, uint256 effectiveTime);
    event OwnershipTransferCompleted(address indexed previous, address indexed newOwner);
    event OwnershipTransferCancelled(address indexed cancelled);

    // ============ Errors ============

    error Unauthorized();
    error ZeroAddress();
    error TimelockNotExpired();
    error NoPendingChange();
    error FactoryNotAuthorizedInNullifierRegistry();  // SECURITY FIX (Audit Vuln 4)
    error FactoryNotAuthorizedInR00tPool();           // SECURITY FIX (Audit Vuln 4)

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _governance,
        address _zkAMMv3,
        address _r00tPool,
        address _nullifierRegistry,
        address _platformTreasury
    ) {
        if (_governance == address(0)) revert ZeroAddress();
        if (_zkAMMv3 == address(0)) revert ZeroAddress();
        if (_r00tPool == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        if (_platformTreasury == address(0)) revert ZeroAddress();

        governance = _governance;
        zkAMMv3 = _zkAMMv3;
        r00tPool = TokenPool(_r00tPool);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
        platformTreasury = _platformTreasury;
        owner = msg.sender;
    }

    // ============ Factory Functions ============

    /// @notice Deploy a new ZkProjectPool and ProjectToken
    /// @dev Only callable by LaunchpadGovernance
    ///      SECURITY FIX (Audit Vuln 4): Pre-flight checks verify this factory is authorized
    ///      in both NullifierRegistry and r00tPool before deploying, preventing wasted gas
    ///      and ensuring pools are properly authorized.
    /// @param params Pool deployment parameters
    /// @return poolAddress Address of deployed ZkProjectPool
    /// @return tokenAddress Address of deployed ProjectToken
    function deployPool(DeployParams calldata params)
        external
        onlyGovernance
        returns (address poolAddress, address tokenAddress)
    {
        // SECURITY FIX (Audit Vuln 4): Pre-flight authorization checks
        // SECURITY FIX (Vuln 3): The factory needs to call setPoolAuthorization() on NullifierRegistry,
        // which requires the caller to be the governance address. So THIS FACTORY must be set as
        // the governance of NullifierRegistry, OR the NullifierRegistry's setPoolAuthorization
        // must be updated to allow authorized callers.
        //
        // Current check: Verify this factory is the governance of NullifierRegistry
        // DEPLOYMENT REQUIREMENT: Before using this factory, call:
        //   nullifierRegistry.proposeGovernance(address(factory))
        //   [wait 48 hours]
        //   nullifierRegistry.acceptGovernance()
        if (nullifierRegistry.governance() != address(this)) {
            revert FactoryNotAuthorizedInNullifierRegistry();
        }

        // Verify this factory can authorize pools in r00tPool
        // This factory must be an authorized caller in r00tPool
        // DEPLOYMENT REQUIREMENT: Before using this factory, call:
        //   r00tPool.setAuthorizedCaller(address(factory), true)
        if (!r00tPool.authorizedCallers(address(this))) {
            revert FactoryNotAuthorizedInR00tPool();
        }

        // Step 1: Deploy ERC20 token with ALL tokens minted to this factory
        ProjectToken token = new ProjectToken(
            params.name,
            params.symbol,
            params.totalSupply,
            address(this),     // All tokens to factory first
            address(0),        // No direct deployer allocation
            0                  // Zero deployer bps
        );
        tokenAddress = address(token);

        // Step 2: Deploy ZkProjectPool
        ZkProjectPool pool = new ZkProjectPool(
            params.name,
            params.symbol,
            tokenAddress,
            params.pledgedR00t,          // Initial R00T reserve
            address(r00tPool),           // R00T token pool
            address(nullifierRegistry),  // Global nullifier registry
            params.creator,              // Project creator
            platformTreasury,            // Platform treasury
            params.proposalId,           // Proposal ID
            params.deployerBps           // Max dev allocation
        );
        poolAddress = address(pool);

        // Step 3: Transfer all tokens to pool
        IERC20(tokenAddress).safeTransfer(poolAddress, params.totalSupply);

        // Step 4: Authorize pool in NullifierRegistry
        nullifierRegistry.setPoolAuthorization(poolAddress, true);

        // Step 5: Authorize pool in r00tPool for R00T claims
        r00tPool.setAuthorizedCaller(poolAddress, true);

        // Step 6: Register pool with ZkAMMv3
        IZkAMMv3Factory(zkAMMv3).registerProjectPool(poolAddress);

        // Step 7: Set ZkAMMv3 as authorized atomic swapper
        pool.setAuthorizedAtomicSwapper(zkAMMv3);

        emit PoolDeployed(
            params.proposalId,
            poolAddress,
            tokenAddress,
            params.name,
            params.symbol,
            params.totalSupply,
            params.pledgedR00t
        );
    }

    // ============ Structs ============

    struct DeployParams {
        string name;
        string symbol;
        uint256 totalSupply;
        uint256 pledgedR00t;
        address creator;
        uint256 proposalId;
        uint256 deployerBps;
    }

    // ============ Admin Functions (SECURITY FIX Vuln 1: All require 48h timelock) ============

    // --- ZkAMMv3 timelock ---
    function proposeZkAMMv3(address _zkAMMv3) external onlyOwner {
        if (_zkAMMv3 == address(0)) revert ZeroAddress();
        pendingZkAMMv3 = _zkAMMv3;
        zkAMMv3TimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit ZkAMMv3ChangeProposed(zkAMMv3, _zkAMMv3, zkAMMv3TimelockExpiry);
    }

    function acceptZkAMMv3() external onlyOwner {
        if (pendingZkAMMv3 == address(0)) revert NoPendingChange();
        if (block.timestamp < zkAMMv3TimelockExpiry) revert TimelockNotExpired();
        address previous = zkAMMv3;
        zkAMMv3 = pendingZkAMMv3;
        pendingZkAMMv3 = address(0);
        zkAMMv3TimelockExpiry = 0;
        emit ZkAMMv3ChangeCompleted(previous, zkAMMv3);
    }

    function cancelZkAMMv3Proposal() external onlyOwner {
        if (pendingZkAMMv3 == address(0)) revert NoPendingChange();
        address cancelled = pendingZkAMMv3;
        pendingZkAMMv3 = address(0);
        zkAMMv3TimelockExpiry = 0;
        emit ZkAMMv3ChangeCancelled(cancelled);
    }

    // --- NullifierRegistry timelock ---
    function proposeNullifierRegistry(address _nullifierRegistry) external onlyOwner {
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        pendingNullifierRegistry = _nullifierRegistry;
        nullifierRegistryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit NullifierRegistryChangeProposed(address(nullifierRegistry), _nullifierRegistry, nullifierRegistryTimelockExpiry);
    }

    function acceptNullifierRegistry() external onlyOwner {
        if (pendingNullifierRegistry == address(0)) revert NoPendingChange();
        if (block.timestamp < nullifierRegistryTimelockExpiry) revert TimelockNotExpired();
        address previous = address(nullifierRegistry);
        nullifierRegistry = NullifierRegistry(pendingNullifierRegistry);
        pendingNullifierRegistry = address(0);
        nullifierRegistryTimelockExpiry = 0;
        emit NullifierRegistryChangeCompleted(previous, address(nullifierRegistry));
    }

    function cancelNullifierRegistryProposal() external onlyOwner {
        if (pendingNullifierRegistry == address(0)) revert NoPendingChange();
        address cancelled = pendingNullifierRegistry;
        pendingNullifierRegistry = address(0);
        nullifierRegistryTimelockExpiry = 0;
        emit NullifierRegistryChangeCancelled(cancelled);
    }

    // --- PlatformTreasury timelock ---
    function proposePlatformTreasury(address _platformTreasury) external onlyOwner {
        if (_platformTreasury == address(0)) revert ZeroAddress();
        pendingPlatformTreasury = _platformTreasury;
        platformTreasuryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit PlatformTreasuryChangeProposed(platformTreasury, _platformTreasury, platformTreasuryTimelockExpiry);
    }

    function acceptPlatformTreasury() external onlyOwner {
        if (pendingPlatformTreasury == address(0)) revert NoPendingChange();
        if (block.timestamp < platformTreasuryTimelockExpiry) revert TimelockNotExpired();
        address previous = platformTreasury;
        platformTreasury = pendingPlatformTreasury;
        pendingPlatformTreasury = address(0);
        platformTreasuryTimelockExpiry = 0;
        emit PlatformTreasuryChangeCompleted(previous, platformTreasury);
    }

    function cancelPlatformTreasuryProposal() external onlyOwner {
        if (pendingPlatformTreasury == address(0)) revert NoPendingChange();
        address cancelled = pendingPlatformTreasury;
        pendingPlatformTreasury = address(0);
        platformTreasuryTimelockExpiry = 0;
        emit PlatformTreasuryChangeCancelled(cancelled);
    }

    // --- Ownership timelock ---
    function proposeOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        ownerTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit OwnershipTransferProposed(owner, newOwner, ownerTimelockExpiry);
    }

    function acceptOwnership() external onlyOwner {
        if (pendingOwner == address(0)) revert NoPendingChange();
        if (block.timestamp < ownerTimelockExpiry) revert TimelockNotExpired();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit OwnershipTransferCompleted(previous, owner);
    }

    function cancelOwnershipProposal() external onlyOwner {
        if (pendingOwner == address(0)) revert NoPendingChange();
        address cancelled = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit OwnershipTransferCancelled(cancelled);
    }
}
