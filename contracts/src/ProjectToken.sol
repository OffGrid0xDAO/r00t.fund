// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProjectToken
/// @notice Simple ERC20 token for launchpad projects
/// @dev Minted once at deployment - total supply to pool, deployer allocation capped at 5%
contract ProjectToken {
    // ============ Constants ============

    /// @notice Maximum deployer allocation (5% = 500 basis points)
    uint256 public constant MAX_DEPLOYER_BPS = 500;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Maximum allowed total supply to prevent overflow in unchecked arithmetic
    /// @dev SECURITY FIX M-03: Ensures balanceOf[to] += amount cannot overflow
    uint256 public constant MAX_TOTAL_SUPPLY = type(uint256).max / 2;

    // ============ ERC20 State ============

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ============ Events ============

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============ Constructor ============

    /// @notice Deploy project token with allocation to pool and deployer
    /// @param _name Token name
    /// @param _symbol Token symbol
    /// @param _totalSupply Total supply (with 18 decimals)
    /// @param _poolAddress Address of the ZkAMMPair pool (receives most tokens)
    /// @param _deployerAddress Deployer address (receives capped allocation)
    /// @param _deployerBps Deployer allocation in basis points (max 500 = 5%)
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        address _poolAddress,
        address _deployerAddress,
        uint256 _deployerBps
    ) {
        require(_poolAddress != address(0), "Invalid pool address");
        require(_deployerBps <= MAX_DEPLOYER_BPS, "Deployer allocation exceeds 5%");
        require(_totalSupply <= MAX_TOTAL_SUPPLY, "Supply exceeds maximum");  // SECURITY FIX M-03

        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;

        // Calculate allocations
        uint256 deployerAmount = (_totalSupply * _deployerBps) / BPS_DENOMINATOR;
        uint256 poolAmount = _totalSupply - deployerAmount;

        // Mint to pool (for AMM liquidity)
        balanceOf[_poolAddress] = poolAmount;
        emit Transfer(address(0), _poolAddress, poolAmount);

        // Mint to deployer (capped at 5%)
        if (deployerAmount > 0 && _deployerAddress != address(0)) {
            balanceOf[_deployerAddress] = deployerAmount;
            emit Transfer(address(0), _deployerAddress, deployerAmount);
        }
    }

    // ============ ERC20 Functions ============

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "Insufficient allowance");
            allowance[from][msg.sender] = currentAllowance - amount;
        }
        return _transfer(from, to, amount);
    }

    /// @dev GAS OPTIMIZATION: Uses unchecked arithmetic for validated operations
    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(from != address(0), "Transfer from zero");
        require(to != address(0), "Transfer to zero");
        require(balanceOf[from] >= amount, "Insufficient balance");

        unchecked {
            balanceOf[from] -= amount;  // Cannot underflow due to check above
            balanceOf[to] += amount;    // Cannot overflow for reasonable token supplies
        }
        emit Transfer(from, to, amount);
        return true;
    }
}
