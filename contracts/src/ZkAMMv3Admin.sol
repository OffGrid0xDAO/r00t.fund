// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IZkAMMv3Pair.sol";
import {ISellVerifier, ITransferVerifier, IWithdrawVerifier, IAddLiquidityVerifier, IRemoveLiquidityVerifier, IClaimLPFeesVerifier, ISwapVerifier, IMergeVerifier} from "./interfaces/IVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ZkAMMv3Admin
/// @author r00t.fund
/// @notice Admin, timelock, and emergency functions for ZkAMMv3
/// @dev Separated from Router to reduce contract size below 24KB limit
contract ZkAMMv3Admin is ReentrancyGuard {
    // ============ Constants ============

    uint256 public constant ADMIN_TIMELOCK = 1 minutes; // TESTNET: Changed from 48 hours for testing
    uint256 public constant EMERGENCY_APPROVAL_EXPIRY = 1 minutes; // TESTNET: Changed from 24 hours for testing

    // ============ Immutables ============

    IZkAMMv3Pair public immutable pair;

    // ============ Router (set after deployment) ============

    address public router;

    // ============ Verifiers ============

    ISellVerifier public sellVerifier;
    ITransferVerifier public transferVerifier;
    IWithdrawVerifier public withdrawVerifier;
    IAddLiquidityVerifier public addLiquidityVerifier;
    IRemoveLiquidityVerifier public removeLiquidityVerifier;
    IClaimLPFeesVerifier public claimLPFeesVerifier;
    ISwapVerifier public swapVerifier;
    IMergeVerifier public mergeVerifier;
    bool public verifiersLocked;

    // ============ Admin State ============

    address public owner;
    address public treasury;
    address public launchpad;
    address public railgunProxy;
    bool public railgunProxyLocked;

    // Timelock state
    address public pendingOwner;
    uint256 public ownerTimelockExpiry;
    address public pendingTreasury;
    uint256 public treasuryTimelockExpiry;
    address public pendingRailgunProxy;
    uint256 public railgunProxyTimelockExpiry;
    address public pendingLaunchpad;
    uint256 public launchpadTimelockExpiry;
    address public pendingRouter;
    uint256 public routerTimelockExpiry;
    address public pendingVerifier;
    string public pendingVerifierType;
    uint256 public verifierTimelockExpiry;

    // ============ Emergency Multisig ============

    address[3] public emergencySigners;
    mapping(bytes32 => uint8) public emergencyApprovals;
    mapping(bytes32 => uint256) public emergencyApprovalTimestamp;

    struct PendingEmergencyAction {
        uint8 actionType;
        uint256 amount;
        address recipient;
        uint8 signerIndex;
        address newSigner;
    }
    mapping(bytes32 => PendingEmergencyAction) public pendingEmergencyActions;
    // SECURITY FIX (Vuln 12): Track cancel approvals separately (requires 2-of-3)
    mapping(bytes32 => uint8) public emergencyCancelApprovals;
    // SECURITY FIX (Vuln 13): Cooldown between sequential signer replacements
    uint256 public lastSignerReplacementTime;

    // ============ CRE Integration ============

    /// @notice Authorized CRE callback addresses (for Chainlink CRE DON integration)
    mapping(address => bool) public authorizedCRECallback;
    /// @notice Pending CRE callback authorization (subject to timelock)
    address public pendingCRECallback;
    uint256 public creCallbackTimelockExpiry;
    /// @notice Authorized health monitor for emergency actions
    address public authorizedHealthMonitor;

    // ============ Events ============

    event VerifierUpdated(string indexed verifierType, address indexed oldVerifier, address indexed newVerifier);
    event VerifiersPermanentlyLocked();
    event EmergencyWithdrawal(address indexed recipient, uint256 ethAmount, uint256 tokenAmount);
    event EmergencySignerUpdated(uint8 indexed index, address indexed oldSigner, address indexed newSigner);
    event EmergencyApproval(bytes32 indexed actionHash, address indexed signer, uint8 approvalCount);
    event EmergencyApprovalReset(bytes32 indexed actionHash);
    event OwnershipTransferProposed(address indexed currentOwner, address indexed pendingOwner, uint256 effectiveTime);
    event OwnershipTransferCompleted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferCancelled(address indexed pendingOwner);
    event TreasuryChangeProposed(address indexed currentTreasury, address indexed pendingTreasury, uint256 effectiveTime);
    event TreasuryChangeCompleted(address indexed previousTreasury, address indexed newTreasury);
    event TreasuryChangeCancelled(address indexed pendingTreasury);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event RailgunProxyChangeProposed(address indexed currentProxy, address indexed pendingProxy, uint256 effectiveTime);
    event RailgunProxyChangeCompleted(address indexed previousProxy, address indexed newProxy);
    event RailgunProxyLocked(address indexed proxy);
    event LaunchpadChangeProposed(address indexed currentLaunchpad, address indexed pendingLaunchpad, uint256 effectiveTime);
    event LaunchpadChangeCompleted(address indexed previousLaunchpad, address indexed newLaunchpad);
    event LaunchpadChangeCancelled(address indexed pendingLaunchpad);
    event CRECallbackProposed(address indexed callback, uint256 effectiveTime);
    event CRECallbackAuthorized(address indexed callback, bool authorized);
    event CRECallbackCancelled(address indexed callback);
    event HealthMonitorUpdated(address indexed oldMonitor, address indexed newMonitor);
    event ProtocolFeesCollected(address indexed treasury, uint256 amount);
    event RouterUpgraded(address indexed oldRouter, address indexed newRouter);
    event RouterUpgradeProposed(address indexed currentRouter, address indexed pendingRouter, uint256 effectiveTime);
    event RouterUpgradeCancelled(address indexed pendingRouter);
    event VerifierChangeProposed(string indexed verifierType, address indexed pendingVerifier, uint256 effectiveTime);
    event VerifierChangeCancelled(string indexed verifierType, address indexed pendingVerifier);

    // ============ Errors ============

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidProof();
    error NotEmergencySigner();
    error EmergencySignersNotSet();
    error NoPendingAction();
    error VerifiersLocked();
    error TimelockNotExpired();
    error NoPendingChange();
    error RailgunProxyAlreadyLocked();
    error RailgunNotConfigured();
    error InsufficientETH();
    error NoETH();
    error AlreadyBootstrapped();
    error NoFeesToCollect();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _pair,
        address _sellVerifier,
        address _transferVerifier,
        address _withdrawVerifier,
        address _treasury,
        address _emergencySigner0,
        address _emergencySigner1,
        address _emergencySigner2
    ) {
        if (_pair == address(0)) revert ZeroAddress();
        if (_sellVerifier == address(0) || _transferVerifier == address(0) || _withdrawVerifier == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_emergencySigner0 == address(0) || _emergencySigner1 == address(0) || _emergencySigner2 == address(0)) revert ZeroAddress();
        if (_emergencySigner0 == _emergencySigner1 || _emergencySigner1 == _emergencySigner2 || _emergencySigner0 == _emergencySigner2) revert InvalidProof();

        pair = IZkAMMv3Pair(_pair);

        sellVerifier = ISellVerifier(_sellVerifier);
        transferVerifier = ITransferVerifier(_transferVerifier);
        withdrawVerifier = IWithdrawVerifier(_withdrawVerifier);

        owner = msg.sender;
        treasury = _treasury;

        emergencySigners[0] = _emergencySigner0;
        emergencySigners[1] = _emergencySigner1;
        emergencySigners[2] = _emergencySigner2;

        emit EmergencySignerUpdated(0, address(0), _emergencySigner0);
        emit EmergencySignerUpdated(1, address(0), _emergencySigner1);
        emit EmergencySignerUpdated(2, address(0), _emergencySigner2);
    }

    /// @notice Set the router address (can only be called once by owner)
    /// @dev This also sets the router on the Pair contract
    /// @param _router Router contract address
    function setRouter(address _router) external onlyOwner {
        if (router != address(0)) revert("Router already set");
        if (_router == address(0)) revert ZeroAddress();
        router = _router;
        // Also set router on the Pair
        pair.setRouter(_router);
    }

    /// @notice Propose a router upgrade (subject to timelock)
    /// @param _newRouter New router contract address
    function proposeRouterUpgrade(address _newRouter) external onlyOwner {
        if (_newRouter == address(0)) revert ZeroAddress();
        pendingRouter = _newRouter;
        routerTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit RouterUpgradeProposed(router, _newRouter, routerTimelockExpiry);
    }

    /// @notice Execute a pending router upgrade after timelock
    function executeRouterUpgrade() external onlyOwner {
        if (pendingRouter == address(0)) revert NoPendingChange();
        if (block.timestamp < routerTimelockExpiry) revert TimelockNotExpired();
        address oldRouter = router;
        router = pendingRouter;
        pair.upgradeRouter(pendingRouter);
        pendingRouter = address(0);
        routerTimelockExpiry = 0;
        emit RouterUpgraded(oldRouter, router);
    }

    /// @notice Cancel a pending router upgrade
    function cancelRouterUpgrade() external onlyOwner {
        if (pendingRouter == address(0)) revert NoPendingChange();
        address cancelled = pendingRouter;
        pendingRouter = address(0);
        routerTimelockExpiry = 0;
        emit RouterUpgradeCancelled(cancelled);
    }

    // ============ Verifier Management ============

    function lockVerifiers() external onlyOwner {
        verifiersLocked = true;
        emit VerifiersPermanentlyLocked();
    }

    /// @notice Propose a verifier change (subject to timelock)
    /// @param verifierType Which verifier to change ("sell", "transfer", "withdraw", "addLiquidity", "removeLiquidity", "claimLPFees", "swap", "merge")
    /// @param _newVerifier New verifier address
    function proposeVerifierChange(string calldata verifierType, address _newVerifier) external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();
        pendingVerifier = _newVerifier;
        pendingVerifierType = verifierType;
        verifierTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit VerifierChangeProposed(verifierType, _newVerifier, verifierTimelockExpiry);
    }

    /// @notice Execute a pending verifier change after timelock
    function executeVerifierChange() external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (pendingVerifier == address(0)) revert NoPendingChange();
        if (block.timestamp < verifierTimelockExpiry) revert TimelockNotExpired();

        address _newVerifier = pendingVerifier;
        string memory vType = pendingVerifierType;
        bytes32 typeHash = keccak256(bytes(vType));
        address oldVerifier;

        if (typeHash == keccak256("sell")) {
            oldVerifier = address(sellVerifier);
            sellVerifier = ISellVerifier(_newVerifier);
        } else if (typeHash == keccak256("transfer")) {
            oldVerifier = address(transferVerifier);
            transferVerifier = ITransferVerifier(_newVerifier);
        } else if (typeHash == keccak256("withdraw")) {
            oldVerifier = address(withdrawVerifier);
            withdrawVerifier = IWithdrawVerifier(_newVerifier);
        } else if (typeHash == keccak256("addLiquidity")) {
            oldVerifier = address(addLiquidityVerifier);
            addLiquidityVerifier = IAddLiquidityVerifier(_newVerifier);
        } else if (typeHash == keccak256("removeLiquidity")) {
            oldVerifier = address(removeLiquidityVerifier);
            removeLiquidityVerifier = IRemoveLiquidityVerifier(_newVerifier);
        } else if (typeHash == keccak256("claimLPFees")) {
            oldVerifier = address(claimLPFeesVerifier);
            claimLPFeesVerifier = IClaimLPFeesVerifier(_newVerifier);
        } else if (typeHash == keccak256("swap")) {
            oldVerifier = address(swapVerifier);
            swapVerifier = ISwapVerifier(_newVerifier);
        } else if (typeHash == keccak256("merge")) {
            oldVerifier = address(mergeVerifier);
            mergeVerifier = IMergeVerifier(_newVerifier);
        } else {
            revert("Invalid verifier type");
        }

        pendingVerifier = address(0);
        pendingVerifierType = "";
        verifierTimelockExpiry = 0;

        emit VerifierUpdated(vType, oldVerifier, _newVerifier);
    }

    /// @notice Cancel a pending verifier change
    function cancelVerifierChange() external onlyOwner {
        if (pendingVerifier == address(0)) revert NoPendingChange();
        address cancelled = pendingVerifier;
        string memory vType = pendingVerifierType;
        pendingVerifier = address(0);
        pendingVerifierType = "";
        verifierTimelockExpiry = 0;
        emit VerifierChangeCancelled(vType, cancelled);
    }

    /// @notice Set a verifier directly (only when slot is empty - for initial setup)
    function setVerifierInitial(string calldata verifierType, address _newVerifier) external onlyOwner {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();

        bytes32 typeHash = keccak256(bytes(verifierType));
        address oldVerifier;

        if (typeHash == keccak256("sell")) {
            if (address(sellVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            sellVerifier = ISellVerifier(_newVerifier);
        } else if (typeHash == keccak256("transfer")) {
            if (address(transferVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            transferVerifier = ITransferVerifier(_newVerifier);
        } else if (typeHash == keccak256("withdraw")) {
            if (address(withdrawVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            withdrawVerifier = IWithdrawVerifier(_newVerifier);
        } else if (typeHash == keccak256("addLiquidity")) {
            if (address(addLiquidityVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            addLiquidityVerifier = IAddLiquidityVerifier(_newVerifier);
        } else if (typeHash == keccak256("removeLiquidity")) {
            if (address(removeLiquidityVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            removeLiquidityVerifier = IRemoveLiquidityVerifier(_newVerifier);
        } else if (typeHash == keccak256("claimLPFees")) {
            if (address(claimLPFeesVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            claimLPFeesVerifier = IClaimLPFeesVerifier(_newVerifier);
        } else if (typeHash == keccak256("swap")) {
            if (address(swapVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            swapVerifier = ISwapVerifier(_newVerifier);
        } else if (typeHash == keccak256("merge")) {
            if (address(mergeVerifier) != address(0)) revert("Verifier already set - use proposeVerifierChange()");
            mergeVerifier = IMergeVerifier(_newVerifier);
        } else {
            revert("Invalid verifier type");
        }

        emit VerifierUpdated(verifierType, oldVerifier, _newVerifier);
    }

    // ============ Ownership Timelock ============

    function proposeOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        pendingOwner = _newOwner;
        ownerTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit OwnershipTransferProposed(owner, _newOwner, ownerTimelockExpiry);
    }

    function executeOwnershipTransfer() external {
        if (pendingOwner == address(0)) revert NoPendingChange();
        if (block.timestamp < ownerTimelockExpiry) revert TimelockNotExpired();
        if (msg.sender != owner && msg.sender != pendingOwner) revert Unauthorized();

        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;

        emit OwnershipTransferCompleted(oldOwner, owner);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        if (pendingOwner == address(0)) revert NoPendingChange();
        address cancelled = pendingOwner;
        pendingOwner = address(0);
        ownerTimelockExpiry = 0;
        emit OwnershipTransferCancelled(cancelled);
    }

    // ============ Treasury Timelock ============

    function proposeTreasury(address _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert ZeroAddress();
        pendingTreasury = _newTreasury;
        treasuryTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit TreasuryChangeProposed(treasury, _newTreasury, treasuryTimelockExpiry);
    }

    function executeTreasuryChange() external onlyOwner {
        if (pendingTreasury == address(0)) revert NoPendingChange();
        if (block.timestamp < treasuryTimelockExpiry) revert TimelockNotExpired();

        address oldTreasury = treasury;
        treasury = pendingTreasury;
        pendingTreasury = address(0);
        treasuryTimelockExpiry = 0;

        emit TreasuryChangeCompleted(oldTreasury, treasury);
        emit TreasuryUpdated(oldTreasury, treasury);
    }

    function cancelTreasuryChange() external onlyOwner {
        if (pendingTreasury == address(0)) revert NoPendingChange();
        address cancelled = pendingTreasury;
        pendingTreasury = address(0);
        treasuryTimelockExpiry = 0;
        emit TreasuryChangeCancelled(cancelled);
    }

    // ============ Launchpad Timelock ============

    function proposeLaunchpad(address _launchpad) external onlyOwner {
        if (_launchpad == address(0)) revert ZeroAddress();
        pendingLaunchpad = _launchpad;
        launchpadTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit LaunchpadChangeProposed(launchpad, _launchpad, launchpadTimelockExpiry);
    }

    function executeLaunchpadChange() external onlyOwner {
        if (pendingLaunchpad == address(0)) revert NoPendingChange();
        if (block.timestamp < launchpadTimelockExpiry) revert TimelockNotExpired();

        address oldLaunchpad = launchpad;
        launchpad = pendingLaunchpad;
        // SECURITY FIX: Revoke old launchpad authorization before granting new
        if (oldLaunchpad != address(0)) {
            pair.setTokenPoolAuthorizedCaller(oldLaunchpad, false);
        }
        pair.setTokenPoolAuthorizedCaller(launchpad, true);
        pendingLaunchpad = address(0);
        launchpadTimelockExpiry = 0;

        emit LaunchpadChangeCompleted(oldLaunchpad, launchpad);
    }

    function cancelLaunchpadChange() external onlyOwner {
        if (pendingLaunchpad == address(0)) revert NoPendingChange();
        address cancelled = pendingLaunchpad;
        pendingLaunchpad = address(0);
        launchpadTimelockExpiry = 0;
        emit LaunchpadChangeCancelled(cancelled);
    }

    function setLaunchpadInitial(address _launchpad) external onlyOwner {
        if (launchpad != address(0)) revert("Launchpad already set - use proposeLaunchpad()");
        if (_launchpad == address(0)) revert ZeroAddress();
        launchpad = _launchpad;
        pair.setTokenPoolAuthorizedCaller(_launchpad, true);
        emit LaunchpadChangeCompleted(address(0), _launchpad);
    }

    // ============ Railgun Proxy Timelock ============

    function proposeRailgunProxy(address _railgunProxy) external onlyOwner {
        if (railgunProxyLocked) revert RailgunProxyAlreadyLocked();
        if (_railgunProxy == address(0)) revert ZeroAddress();
        pendingRailgunProxy = _railgunProxy;
        railgunProxyTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit RailgunProxyChangeProposed(railgunProxy, _railgunProxy, railgunProxyTimelockExpiry);
    }

    function executeRailgunProxyChange() external onlyOwner {
        if (pendingRailgunProxy == address(0)) revert NoPendingChange();
        if (block.timestamp < railgunProxyTimelockExpiry) revert TimelockNotExpired();

        address oldProxy = railgunProxy;
        railgunProxy = pendingRailgunProxy;
        pendingRailgunProxy = address(0);
        railgunProxyTimelockExpiry = 0;

        emit RailgunProxyChangeCompleted(oldProxy, railgunProxy);
    }

    function lockRailgunProxy() external onlyOwner {
        if (railgunProxy == address(0)) revert RailgunNotConfigured();
        railgunProxyLocked = true;
        emit RailgunProxyLocked(railgunProxy);
    }

    // ============ Other Admin Functions ============

    function addLiquidityOwner() external payable onlyOwner {
        if (pair.bootstrapped()) revert AlreadyBootstrapped();
        if (msg.value == 0) revert NoETH();
        pair.addETHReserve{value: msg.value}();
    }

    function syncETHAccounting() external onlyOwner {
        pair.syncETHAccounting();
    }

    function collectProtocolFees() external onlyOwner nonReentrant {
        uint256 fees = pair.collectProtocolFees(treasury);
        emit ProtocolFeesCollected(treasury, fees);
    }

    /// @notice Sweep LP fees from burned shares to treasury (for planting trees)
    function sweepBurnedShareFees() external onlyOwner nonReentrant {
        uint256 fees = pair.sweepBurnedShareFees(treasury);
        emit ProtocolFeesCollected(treasury, fees);
    }

    function announceEpochIncrement() external onlyOwner {
        require(pair.accumulatedLPFees() >= 0.01 ether, "Insufficient fees to increment epoch");
        pair.announceEpochIncrement();
    }

    function executeEpochIncrement() external onlyOwner {
        pair.executeEpochIncrement();
    }

    function cancelEpochIncrement() external onlyOwner {
        pair.cancelEpochIncrement();
    }

    /// @notice Set the shorts contract on the pair (initial setup only)
    /// @param _shortsContract Address of the R00TShorts contract
    function setShortsContractInitial(address _shortsContract) external onlyOwner {
        if (address(pair.shortsContract()) != address(0)) revert("Shorts already set - use proposeShortsContract()");
        if (_shortsContract == address(0)) revert ZeroAddress();
        pair.setShortsContract(_shortsContract);
        emit ShortsContractChanged(address(0), _shortsContract);
    }

    // Shorts contract timelock
    address public pendingShortsContract;
    uint256 public shortsContractTimelockExpiry;

    event ShortsContractChangeProposed(address indexed currentShorts, address indexed pendingShorts, uint256 effectiveTime);
    event ShortsContractChanged(address indexed oldShorts, address indexed newShorts);
    event ShortsContractChangeCancelled(address indexed pendingShorts);

    function proposeShortsContract(address _shortsContract) external onlyOwner {
        if (_shortsContract == address(0)) revert ZeroAddress();
        pendingShortsContract = _shortsContract;
        shortsContractTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit ShortsContractChangeProposed(address(pair.shortsContract()), _shortsContract, shortsContractTimelockExpiry);
    }

    function executeShortsContractChange() external onlyOwner {
        if (pendingShortsContract == address(0)) revert NoPendingChange();
        if (block.timestamp < shortsContractTimelockExpiry) revert TimelockNotExpired();
        address oldShorts = address(pair.shortsContract());
        pair.setShortsContract(pendingShortsContract);
        emit ShortsContractChanged(oldShorts, pendingShortsContract);
        pendingShortsContract = address(0);
        shortsContractTimelockExpiry = 0;
    }

    function cancelShortsContractChange() external onlyOwner {
        if (pendingShortsContract == address(0)) revert NoPendingChange();
        emit ShortsContractChangeCancelled(pendingShortsContract);
        pendingShortsContract = address(0);
        shortsContractTimelockExpiry = 0;
    }

    /// @notice Allocate ROOT tokens from pool to shorts contract for shorting inventory
    /// @param amount Amount of ROOT tokens to allocate
    function allocateTokensForShorts(uint256 amount) external onlyOwner {
        pair.allocateTokensForShorts(amount);
    }

    // ============ Emergency Functions ============

    function _getSignerIndex(address signer) internal view returns (uint8) {
        for (uint8 i = 0; i < 3; i++) {
            if (emergencySigners[i] == signer) return i;
        }
        revert NotEmergencySigner();
    }

    function _checkAndRecordApproval(bytes32 actionHash) internal returns (bool shouldExecute) {
        if (emergencySigners[0] == address(0)) revert EmergencySignersNotSet();

        uint8 signerIndex = _getSignerIndex(msg.sender);
        uint8 signerBit = uint8(1 << signerIndex);

        uint256 approvalTime = emergencyApprovalTimestamp[actionHash];
        if (approvalTime != 0 && block.timestamp > approvalTime + EMERGENCY_APPROVAL_EXPIRY) {
            emergencyApprovals[actionHash] = 0;
            emergencyApprovalTimestamp[actionHash] = 0;
            emit EmergencyApprovalReset(actionHash);
        }

        uint8 currentApprovals = emergencyApprovals[actionHash];

        if (currentApprovals & signerBit != 0) {
            return _countBits(currentApprovals) >= 2;
        }

        currentApprovals |= signerBit;
        emergencyApprovals[actionHash] = currentApprovals;

        if (emergencyApprovalTimestamp[actionHash] == 0) {
            emergencyApprovalTimestamp[actionHash] = block.timestamp;
        }

        uint8 approvalCount = _countBits(currentApprovals);
        emit EmergencyApproval(actionHash, msg.sender, approvalCount);

        if (approvalCount >= 2) {
            emergencyApprovals[actionHash] = 0;
            emergencyApprovalTimestamp[actionHash] = 0;
            return true;
        }

        return false;
    }

    function _countBits(uint8 n) internal pure returns (uint8 count) {
        while (n != 0) {
            count += n & 1;
            n >>= 1;
        }
    }

    function emergencyWithdrawETH(uint256 amount, address payable recipient) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > pair.ethReserve()) revert InsufficientETH();

        bytes32 actionHash = keccak256(abi.encodePacked("emergencyWithdrawETH", amount, recipient));

        if (pendingEmergencyActions[actionHash].actionType == 0) {
            pendingEmergencyActions[actionHash] = PendingEmergencyAction({
                actionType: 1,
                amount: amount,
                recipient: recipient,
                signerIndex: 0,
                newSigner: address(0)
            });
        }

        if (!_checkAndRecordApproval(actionHash)) {
            return;
        }

        delete pendingEmergencyActions[actionHash];
        pair.emergencyWithdrawETH(amount, recipient);
        emit EmergencyWithdrawal(recipient, amount, 0);
    }

    function emergencyWithdrawAll(address payable recipient) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();

        uint256 ethAmount = pair.ethReserve();
        if (ethAmount == 0) revert NoETH();

        bytes32 actionHash = keccak256(abi.encodePacked("emergencyWithdrawAll", recipient, ethAmount));

        if (pendingEmergencyActions[actionHash].actionType == 0) {
            pendingEmergencyActions[actionHash] = PendingEmergencyAction({
                actionType: 2,
                amount: ethAmount,
                recipient: recipient,
                signerIndex: 0,
                newSigner: address(0)
            });
        }

        if (!_checkAndRecordApproval(actionHash)) {
            return;
        }

        delete pendingEmergencyActions[actionHash];
        pair.emergencyWithdrawETH(ethAmount, recipient);
        emit EmergencyWithdrawal(recipient, ethAmount, 0);
    }

    function setEmergencySigner(uint8 index, address newSigner) external nonReentrant {
        if (index > 2) revert InvalidProof();
        if (newSigner == address(0)) revert ZeroAddress();
        for (uint8 i = 0; i < 3; i++) {
            if (emergencySigners[i] == newSigner) revert InvalidProof();
        }

        bytes32 actionHash = keccak256(abi.encodePacked("setEmergencySigner", index, newSigner));

        if (pendingEmergencyActions[actionHash].actionType == 0) {
            pendingEmergencyActions[actionHash] = PendingEmergencyAction({
                actionType: 3,
                amount: 0,
                recipient: address(0),
                signerIndex: index,
                newSigner: newSigner
            });
        }

        if (!_checkAndRecordApproval(actionHash)) {
            return;
        }

        delete pendingEmergencyActions[actionHash];
        address oldSigner = emergencySigners[index];
        emergencySigners[index] = newSigner;
        emit EmergencySignerUpdated(index, oldSigner, newSigner);
    }

    function confirmEmergencyAction(bytes32 actionHash) external nonReentrant {
        PendingEmergencyAction storage action = pendingEmergencyActions[actionHash];
        if (action.actionType == 0) revert NoPendingAction();

        if (!_checkAndRecordApproval(actionHash)) {
            return;
        }

        // Cache values in memory BEFORE deleting storage (storage ref becomes zero after delete)
        uint8 actionType = action.actionType;
        uint256 amount = action.amount;
        address recipient = action.recipient;
        uint8 signerIndex = action.signerIndex;
        address newSigner = action.newSigner;

        // Delete the pending action first (reentrancy protection)
        delete pendingEmergencyActions[actionHash];

        if (actionType == 1) {
            if (amount > pair.ethReserve()) revert InsufficientETH();
            pair.emergencyWithdrawETH(amount, recipient);
            emit EmergencyWithdrawal(recipient, amount, 0);
        } else if (actionType == 2) {
            if (amount != pair.ethReserve()) revert InsufficientETH();
            pair.emergencyWithdrawETH(amount, recipient);
            emit EmergencyWithdrawal(recipient, amount, 0);
        } else if (actionType == 3) {
            address oldSigner = emergencySigners[signerIndex];
            emergencySigners[signerIndex] = newSigner;
            emit EmergencySignerUpdated(signerIndex, oldSigner, newSigner);
        }
    }

    /// @notice SECURITY FIX (Vuln 12): Require 2-of-3 signers to cancel emergency actions
    function cancelEmergencyApproval(bytes32 actionHash) external {
        uint8 signerIndex = _getSignerIndex(msg.sender);
        uint8 bitmap = emergencyApprovals[actionHash];
        // Record this signer's cancel vote by checking they haven't already voted to cancel
        // Reuse emergencyApprovals bitmap: we need 2 signers to call cancel
        // Store cancel requests in a separate mapping
        emergencyCancelApprovals[actionHash] |= uint8(1 << signerIndex);
        uint8 cancelBitmap = emergencyCancelApprovals[actionHash];
        uint8 cancelCount = _countBits(cancelBitmap);
        if (cancelCount < 2) return; // Need 2-of-3 to cancel
        emergencyApprovals[actionHash] = 0;
        emergencyApprovalTimestamp[actionHash] = 0;
        emergencyCancelApprovals[actionHash] = 0;
        delete pendingEmergencyActions[actionHash];
        emit EmergencyApprovalReset(actionHash);
    }

    /// @notice Owner can force-replace an unresponsive emergency signer (with timelock)
    /// @dev SECURITY FIX (M-7): Prevents single signer from permanently blocking emergency actions
    address public pendingEmergencySignerReplace;
    uint8 public pendingEmergencySignerIndex;
    uint256 public emergencySignerReplaceExpiry;

    event EmergencySignerReplaceProposed(uint8 indexed index, address indexed newSigner, uint256 effectiveTime);
    event EmergencySignerReplaceCancelled(uint8 indexed index, address indexed newSigner);

    function proposeEmergencySignerReplace(uint8 index, address newSigner) external onlyOwner {
        if (index > 2) revert InvalidProof();
        if (newSigner == address(0)) revert ZeroAddress();
        // SECURITY FIX (Vuln 13): Enforce cooldown between sequential replacements
        if (block.timestamp < lastSignerReplacementTime + ADMIN_TIMELOCK) revert TimelockNotExpired();
        for (uint8 i = 0; i < 3; i++) {
            if (emergencySigners[i] == newSigner) revert InvalidProof();
        }
        pendingEmergencySignerReplace = newSigner;
        pendingEmergencySignerIndex = index;
        emergencySignerReplaceExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit EmergencySignerReplaceProposed(index, newSigner, emergencySignerReplaceExpiry);
    }

    function executeEmergencySignerReplace() external onlyOwner {
        if (pendingEmergencySignerReplace == address(0)) revert NoPendingChange();
        if (block.timestamp < emergencySignerReplaceExpiry) revert TimelockNotExpired();
        address oldSigner = emergencySigners[pendingEmergencySignerIndex];
        emergencySigners[pendingEmergencySignerIndex] = pendingEmergencySignerReplace;
        // SECURITY FIX (Vuln 13): Record replacement time for cooldown
        lastSignerReplacementTime = block.timestamp;
        emit EmergencySignerUpdated(pendingEmergencySignerIndex, oldSigner, pendingEmergencySignerReplace);
        pendingEmergencySignerReplace = address(0);
        emergencySignerReplaceExpiry = 0;
    }

    function cancelEmergencySignerReplace() external onlyOwner {
        if (pendingEmergencySignerReplace == address(0)) revert NoPendingChange();
        emit EmergencySignerReplaceCancelled(pendingEmergencySignerIndex, pendingEmergencySignerReplace);
        pendingEmergencySignerReplace = address(0);
        emergencySignerReplaceExpiry = 0;
    }

    // ============ View Functions ============

    function getEmergencyApprovalStatus(bytes32 actionHash) external view returns (
        uint8 approvalBitmap,
        uint8 approvalCount,
        bool isExpired,
        uint256 expiresAt
    ) {
        approvalBitmap = emergencyApprovals[actionHash];
        approvalCount = _countBits(approvalBitmap);
        uint256 approvalTime = emergencyApprovalTimestamp[actionHash];
        if (approvalTime != 0) {
            expiresAt = approvalTime + EMERGENCY_APPROVAL_EXPIRY;
            isExpired = block.timestamp > expiresAt;
        }
    }

    function getEmergencySigners() external view returns (address[3] memory) {
        return emergencySigners;
    }

    function isEmergencySigner(address addr) external view returns (bool) {
        return emergencySigners[0] == addr || emergencySigners[1] == addr || emergencySigners[2] == addr;
    }

    function getPendingEmergencyAction(bytes32 actionHash) external view returns (
        uint8 actionType,
        uint256 amount,
        address recipient,
        uint8 signerIndex,
        address newSigner
    ) {
        PendingEmergencyAction storage action = pendingEmergencyActions[actionHash];
        return (action.actionType, action.amount, action.recipient, action.signerIndex, action.newSigner);
    }

    // ============ CRE Callback Management ============

    /// @notice Propose a CRE callback authorization (subject to timelock)
    /// @param _callback CRE callback contract address
    function proposeCRECallback(address _callback) external onlyOwner {
        if (_callback == address(0)) revert ZeroAddress();
        pendingCRECallback = _callback;
        creCallbackTimelockExpiry = block.timestamp + ADMIN_TIMELOCK;
        emit CRECallbackProposed(_callback, creCallbackTimelockExpiry);
    }

    /// @notice Execute a pending CRE callback authorization after timelock
    function executeCRECallbackAuthorization() external onlyOwner {
        if (pendingCRECallback == address(0)) revert NoPendingChange();
        if (block.timestamp < creCallbackTimelockExpiry) revert TimelockNotExpired();
        authorizedCRECallback[pendingCRECallback] = true;
        emit CRECallbackAuthorized(pendingCRECallback, true);
        pendingCRECallback = address(0);
        creCallbackTimelockExpiry = 0;
    }

    /// @notice Revoke a CRE callback authorization (instant, no timelock needed for revocation)
    /// @param _callback CRE callback contract address to revoke
    function revokeCRECallback(address _callback) external onlyOwner {
        authorizedCRECallback[_callback] = false;
        emit CRECallbackAuthorized(_callback, false);
    }

    /// @notice Cancel a pending CRE callback authorization
    function cancelCRECallbackProposal() external onlyOwner {
        if (pendingCRECallback == address(0)) revert NoPendingChange();
        address cancelled = pendingCRECallback;
        pendingCRECallback = address(0);
        creCallbackTimelockExpiry = 0;
        emit CRECallbackCancelled(cancelled);
    }

    /// @notice Set the authorized health monitor (for CRE risk workflow)
    /// @param _monitor Health monitor contract address
    function setHealthMonitor(address _monitor) external onlyOwner {
        address old = authorizedHealthMonitor;
        authorizedHealthMonitor = _monitor;
        emit HealthMonitorUpdated(old, _monitor);
    }

    // ============ Legacy Functions ============

    function transferOwnership(address) external pure {
        revert("Use proposeOwnership() + executeOwnershipTransfer() with timelock");
    }

    function setTreasury(address) external pure {
        revert("Use proposeTreasury() + executeTreasuryChange() with timelock");
    }

    function setRailgunProxy(address) external pure {
        revert("Use proposeRailgunProxy() + executeRailgunProxyChange() with timelock");
    }

    function setLaunchpad(address) external pure {
        revert("Use proposeLaunchpad() + executeLaunchpadChange() with timelock");
    }

    function upgradeRouter(address) external pure {
        revert("Use proposeRouterUpgrade() + executeRouterUpgrade() with timelock");
    }

    function incrementFeeEpoch() external pure {
        revert("Use announceEpochIncrement() + executeEpochIncrement() with 24h claim window");
    }
}
