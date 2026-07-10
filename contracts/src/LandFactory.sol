// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Land.sol";

/// @title LandFactory
/// @notice Anyone can set up a Land: submit the geo-file hashes (KMZ boundary +
///         topography, validated off-chain), a treasury, and an $R00T pledge that
///         becomes the land's seed liquidity for its Uniswap v4 parcel pools.
///
/// The factory holds the shared v4 wiring (PoolManager, fee tier, protocol
/// treasury) and applies it to every Land it deploys.
contract LandFactory is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable root;   // $R00T
    address public immutable poolManager;
    address public usdc;
    address public validator;       // confirms off-chain KMZ/topography validation
    address public protocolTreasury; // protocol's 30% of parcel pool fees
    uint256 public minR00tPledge;
    uint24 public poolFee;          // parcel/$R00T pool fee tier (e.g. 3000 = 0.30%)
    int24 public tickSpacing;       // matching tick spacing (e.g. 60)
    uint256 public defaultRootPriceE6; // seed USD/$R00T for new lands (steward can update)

    address[] public lands;

    event LandCreated(uint256 indexed id, address land, address indexed steward, string name, uint256 r00tPledge);
    event ValidatorUpdated(address validator);
    event MinPledgeUpdated(uint256 minR00tPledge);
    event ConfigUpdated(uint24 poolFee, int24 tickSpacing, address protocolTreasury, uint256 defaultRootPriceE6);

    error BelowMinPledge();
    error ZeroAddress();

    struct CreateArgs {
        string name;
        string region;
        bytes32 boundaryHash;
        bytes32 topoHash;
        string cid;
        address treasury;
        uint256 ethPriceE6;
        uint256 r00tPledge;
    }

    constructor(
        address _root,
        address _usdc,
        address _validator,
        address _poolManager,
        address _protocolTreasury,
        uint256 _minR00tPledge,
        uint24 _poolFee,
        int24 _tickSpacing,
        uint256 _defaultRootPriceE6
    ) Ownable(msg.sender) {
        if (_root == address(0) || _usdc == address(0) || _poolManager == address(0)) revert ZeroAddress();
        root = IERC20(_root);
        usdc = _usdc;
        validator = _validator;
        poolManager = _poolManager;
        protocolTreasury = _protocolTreasury;
        minR00tPledge = _minR00tPledge;
        poolFee = _poolFee;
        tickSpacing = _tickSpacing;
        defaultRootPriceE6 = _defaultRootPriceE6;
    }

    /// @notice Open a new land. Requires prior approve() of `r00tPledge` $R00T.
    function createLand(CreateArgs calldata a) external returns (address) {
        if (a.r00tPledge < minR00tPledge) revert BelowMinPledge();
        if (a.treasury == address(0)) revert ZeroAddress();

        Land land = new Land(
            Land.InitParams({
                steward: msg.sender,
                root: address(root),
                usdc: usdc,
                treasury: a.treasury,
                validator: validator,
                poolManager: poolManager,
                protocolTreasury: protocolTreasury,
                poolFee: poolFee,
                tickSpacing: tickSpacing,
                ethPriceE6: a.ethPriceE6,
                rootPriceE6: defaultRootPriceE6,
                name: a.name,
                region: a.region,
                boundaryHash: a.boundaryHash,
                topoHash: a.topoHash,
                cid: a.cid
            })
        );

        root.safeTransferFrom(msg.sender, address(land), a.r00tPledge);
        land.initLiquidity(a.r00tPledge);

        lands.push(address(land));
        emit LandCreated(lands.length - 1, address(land), msg.sender, a.name, a.r00tPledge);
        return address(land);
    }

    function landCount() external view returns (uint256) { return lands.length; }

    function setValidator(address v) external onlyOwner { validator = v; emit ValidatorUpdated(v); }
    function setMinPledge(uint256 m) external onlyOwner { minR00tPledge = m; emit MinPledgeUpdated(m); }
    function setUsdc(address u) external onlyOwner { if (u == address(0)) revert ZeroAddress(); usdc = u; }

    function setConfig(uint24 _poolFee, int24 _tickSpacing, address _protocolTreasury, uint256 _defaultRootPriceE6)
        external onlyOwner
    {
        poolFee = _poolFee;
        tickSpacing = _tickSpacing;
        protocolTreasury = _protocolTreasury;
        defaultRootPriceE6 = _defaultRootPriceE6;
        emit ConfigUpdated(_poolFee, _tickSpacing, _protocolTreasury, _defaultRootPriceE6);
    }
}
