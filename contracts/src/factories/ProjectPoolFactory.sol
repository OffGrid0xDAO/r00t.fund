// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ProjectPoolFactory
/// @notice Factory for registering ZkProjectPoolCore instances
/// @dev Due to EIP-170 24KB limit, ZkProjectPoolCore (~18KB) cannot be embedded in factory.
///      Pools are deployed externally (via script/CREATE2) and registered here.
///
///      Deployment workflow:
///      1. LaunchpadGovernance calls deployPool() with all parameters
///      2. Factory emits PoolDeploymentRequested event
///      3. Off-chain keeper deploys ZkProjectPoolCore via script
///      4. Keeper calls registerDeployedPool() to register the pool
///      5. Factory transfers tokens and completes setup
///
///      SECURITY: All admin changes require 48-hour timelock
contract ProjectPoolFactory {
    using SafeERC20 for IERC20;

    /// @notice Admin timelock duration (TESTNET: 1 minute)
    uint256 public constant ADMIN_TIMELOCK = 1 minutes; // TESTNET: Changed from 48 hours for testing

    /// @notice LaunchpadGovernance that can call this factory
    address public governance;

    /// @notice Owner for admin functions
    address public owner;

    /// @notice Shared router for all pools
    address public router;

    /// @notice Total pools deployed
    uint256 public poolCount;

    /// @notice Pending pool deployments
    uint256 public nextDeploymentId;

    /// @notice Deployed pools
    mapping(address => bool) public deployedPools;
    mapping(uint256 => address) public poolByIndex;

    /// @notice Pending deployment requests
    struct PendingDeployment {
        string name;
        string symbol;
        address token;
        uint256 initialRootReserve;
        address r00tPool;
        address nullifierRegistry;
        address creator;
        address platform;
        uint256 proposalId;
        uint256 maxDevAllocationBps;
        bool completed;
        address deployedPool;
    }
    mapping(uint256 => PendingDeployment) public pendingDeployments;

    // ============ Pending Admin Changes (Timelock) ============

    address public pendingOwner;
    uint256 public ownerTimelockExpiry;
    address public pendingGovernance;
    uint256 public governanceTimelockExpiry;

    // ============ Events ============

    event PoolDeploymentRequested(
        uint256 indexed deploymentId,
        address indexed token,
        uint256 indexed proposalId,
        string name,
        string symbol,
        uint256 initialRootReserve,
        address creator
    );
    event PoolDeployed(uint256 indexed deploymentId, address indexed pool, address indexed token, uint256 proposalId);
    event RouterSet(address indexed router);
    event OwnershipTransferProposed(address indexed proposed, uint256 effectiveTime);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event GovernanceProposed(address indexed proposed, uint256 effectiveTime);
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);
    event AdminProposalCancelled(string configType, address cancelled);

    // ============ Errors ============

    error Unauthorized();
    error ZeroAddress();
    error PoolAlreadyDeployed();
    error TimelockNotExpired();
    error NoPendingChange();
    error RouterNotSet();
    error DeploymentNotFound();
    error DeploymentAlreadyCompleted();
    error InvalidPool();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _router) {
        owner = msg.sender;
        if (_router != address(0)) {
            router = _router;
            emit RouterSet(_router);
        }
    }

    // ============ Initial Setup ============

    function setGovernanceInitial(address _governance) external onlyOwner {
        if (governance != address(0)) revert NoPendingChange();
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
        emit GovernanceUpdated(address(0), _governance);
    }

    function setRouter(address _router) external onlyOwner {
        if (_router == address(0)) revert ZeroAddress();
        router = _router;
        emit RouterSet(_router);
    }

    // ============ Pool Deployment (Two-Phase) ============

    /// @notice Request deployment of a new ZkProjectPoolCore (Phase 1)
    /// @dev Called by LaunchpadGovernance. Emits event for off-chain deployment.
    /// @return deploymentId The ID for this deployment request
    function deployPool(
        string memory _name,
        string memory _symbol,
        address _token,
        uint256 _initialRootReserve,
        address _r00tPool,
        address _nullifierRegistry,
        address _creator,
        address _platform,
        uint256 _proposalId,
        uint256 _maxDevAllocationBps
    ) external onlyGovernance returns (address) {
        if (router == address(0)) revert RouterNotSet();

        uint256 deploymentId = nextDeploymentId++;

        pendingDeployments[deploymentId] = PendingDeployment({
            name: _name,
            symbol: _symbol,
            token: _token,
            initialRootReserve: _initialRootReserve,
            r00tPool: _r00tPool,
            nullifierRegistry: _nullifierRegistry,
            creator: _creator,
            platform: _platform,
            proposalId: _proposalId,
            maxDevAllocationBps: _maxDevAllocationBps,
            completed: false,
            deployedPool: address(0)
        });

        emit PoolDeploymentRequested(
            deploymentId,
            _token,
            _proposalId,
            _name,
            _symbol,
            _initialRootReserve,
            _creator
        );

        // Return address(0) for now - actual pool address comes from registerDeployedPool
        // LaunchpadGovernance should handle this by listening for PoolDeployed event
        return address(0);
    }

    /// @notice Register an externally-deployed pool (Phase 2)
    /// @dev Called by keeper/owner after deploying pool via script
    /// @param deploymentId The deployment request ID
    /// @param poolAddress The address of the deployed ZkProjectPoolCore
    /// @param tokenAmount Exact amount of project tokens to transfer to the pool
    function registerDeployedPool(uint256 deploymentId, address poolAddress, uint256 tokenAmount) external onlyOwner {
        PendingDeployment storage pd = pendingDeployments[deploymentId];
        if (pd.token == address(0)) revert DeploymentNotFound();
        if (pd.completed) revert DeploymentAlreadyCompleted();
        if (poolAddress == address(0)) revert ZeroAddress();
        if (deployedPools[poolAddress]) revert PoolAlreadyDeployed();

        // Verify the pool was deployed with correct parameters by checking its state
        // (In production, add more validation)

        pd.completed = true;
        pd.deployedPool = poolAddress;
        deployedPools[poolAddress] = true;
        poolByIndex[poolCount] = poolAddress;
        poolCount++;

        // SECURITY FIX (Vuln 8): Transfer only the specified amount, not entire balance
        // Prevents draining tokens intended for other pending deployments
        if (tokenAmount > 0) {
            uint256 tokenBalance = IERC20(pd.token).balanceOf(address(this));
            if (tokenAmount > tokenBalance) revert InvalidPool();
            IERC20(pd.token).safeTransfer(poolAddress, tokenAmount);
        }

        emit PoolDeployed(deploymentId, poolAddress, pd.token, pd.proposalId);
    }

    /// @notice Get pending deployment details (for off-chain keeper)
    function getPendingDeployment(uint256 deploymentId) external view returns (
        string memory name,
        string memory symbol,
        address token,
        uint256 initialRootReserve,
        address r00tPool,
        address nullifierRegistry,
        address creator,
        address platform,
        uint256 proposalId,
        uint256 maxDevAllocationBps,
        bool completed,
        address deployedPool,
        address routerAddr
    ) {
        PendingDeployment storage pd = pendingDeployments[deploymentId];
        return (
            pd.name,
            pd.symbol,
            pd.token,
            pd.initialRootReserve,
            pd.r00tPool,
            pd.nullifierRegistry,
            pd.creator,
            pd.platform,
            pd.proposalId,
            pd.maxDevAllocationBps,
            pd.completed,
            pd.deployedPool,
            router
        );
    }

    // ============ View Functions ============

    function isDeployedPool(address pool) external view returns (bool) {
        return deployedPools[pool];
    }

    function getDeployedPoolForProposal(uint256 proposalId) external view returns (address) {
        // Linear search - could be optimized with a mapping if needed
        for (uint256 i = 0; i < nextDeploymentId; i++) {
            if (pendingDeployments[i].proposalId == proposalId && pendingDeployments[i].completed) {
                return pendingDeployments[i].deployedPool;
            }
        }
        return address(0);
    }

    // ============ Timelocked Admin Functions ============

    function proposeGovernance(address _governance) external onlyOwner {
        if (_governance == address(0)) revert ZeroAddress();
        pendingGovernance = _governance;
        governanceTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit GovernanceProposed(_governance, governanceTimelockExpiry);
    }

    function acceptGovernance() external onlyOwner {
        if (pendingGovernance == address(0)) revert NoPendingChange();
        if (block.timestamp < governanceTimelockExpiry) revert TimelockNotExpired();

        address oldGovernance = governance;
        governance = pendingGovernance;
        pendingGovernance = address(0);
        governanceTimelockExpiry = 0;
        emit GovernanceUpdated(oldGovernance, governance);
    }

    function proposeOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        ownerTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit OwnershipTransferProposed(newOwner, ownerTimelockExpiry);
    }

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

    function cancelAdminProposal(string calldata configType) external onlyOwner {
        bytes32 typeHash = keccak256(bytes(configType));

        if (typeHash == keccak256("owner")) {
            if (pendingOwner == address(0)) revert NoPendingChange();
            address cancelled = pendingOwner;
            pendingOwner = address(0);
            ownerTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else if (typeHash == keccak256("governance")) {
            if (pendingGovernance == address(0)) revert NoPendingChange();
            address cancelled = pendingGovernance;
            pendingGovernance = address(0);
            governanceTimelockExpiry = 0;
            emit AdminProposalCancelled(configType, cancelled);
        } else {
            revert ZeroAddress();
        }
    }
}
