// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IYieldStrategy} from "../interfaces/IYieldStrategy.sol";
import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.2/access/Ownable.sol";

/**
 * @title IAavePool
 * @notice Minimal interface for Aave V3 Pool
 */
interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getReserveData(address asset) external view returns (ReserveData memory);
}

struct ReserveData {
    uint256 configuration;
    uint128 liquidityIndex;
    uint128 currentLiquidityRate;
    uint128 variableBorrowIndex;
    uint128 currentVariableBorrowRate;
    uint128 currentStableBorrowRate;
    uint40 lastUpdateTimestamp;
    uint16 id;
    address aTokenAddress;
    address stableDebtTokenAddress;
    address variableDebtTokenAddress;
    address interestRateStrategyAddress;
    uint128 accruedToTreasury;
    uint128 unbacked;
    uint128 isolationModeTotalDebt;
}

/**
 * @title IAToken
 * @notice Minimal interface for Aave V3 aToken
 */
interface IAToken is IERC20 {
    function scaledBalanceOf(address user) external view returns (uint256);
}

/**
 * @title AaveV3Strategy
 * @notice Yield strategy that deposits funds into Aave V3
 */
contract AaveV3Strategy is IYieldStrategy, Ownable {
    using SafeERC20 for IERC20;

    IAavePool public immutable aavePool;
    address public immutable aggregator;

    // token => aToken mapping
    mapping(address => address) public aTokens;

    // User balances: user => token => amount
    mapping(address => mapping(address => uint256)) public userBalances;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event ATokenMapped(address indexed token, address indexed aToken);

    error OnlyAggregator();
    error InvalidToken();
    error InvalidAmount();
    error ATokenNotSet();

    modifier onlyAggregator() {
        if (msg.sender != aggregator) revert OnlyAggregator();
        _;
    }

    constructor(address _aavePool, address _aggregator) Ownable(msg.sender) {
        aavePool = IAavePool(_aavePool);
        aggregator = _aggregator;
    }

    /**
     * @notice Set the aToken address for a given token
     * @param token The underlying token address
     * @param aToken The corresponding aToken address
     */
    function setAToken(address token, address aToken) external onlyOwner {
        if (token == address(0) || aToken == address(0)) revert InvalidToken();
        aTokens[token] = aToken;
        emit ATokenMapped(token, aToken);
    }

    /**
     * @notice Deposit funds into Aave V3
     * @param token The token to deposit
     * @param amount The amount to deposit
     * @return The amount actually deposited
     */
    function deposit(address token, uint256 amount, address user) external onlyAggregator returns (uint256) {
        if (amount == 0) revert InvalidAmount();
        if (user == address(0)) revert InvalidToken();
        address aToken = aTokens[token];
        if (aToken == address(0)) revert ATokenNotSet();

        // Transfer tokens from aggregator
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Approve Aave pool
        IERC20(token).forceApprove(address(aavePool), amount);

        // Supply to Aave (aTokens are minted to this contract)
        aavePool.supply(token, amount, address(this), 0);

        // Track user balance
        userBalances[user][token] += amount;

        emit Deposited(user, token, amount);
        return amount;
    }

    /**
     * @notice Withdraw funds from Aave V3
     * @param token The token to withdraw
     * @param amount The amount to withdraw
     * @return The amount actually withdrawn
     */
    function withdraw(address token, uint256 amount, address user) external onlyAggregator returns (uint256) {
        if (amount == 0) revert InvalidAmount();
        if (user == address(0)) revert InvalidToken();
        address aToken = aTokens[token];
        if (aToken == address(0)) revert ATokenNotSet();

        // Withdraw from Aave (burns aTokens and returns underlying)
        uint256 withdrawn = aavePool.withdraw(token, amount, msg.sender);

        // Update user balance
        if (userBalances[user][token] >= amount) {
            userBalances[user][token] -= amount;
        } else {
            userBalances[user][token] = 0;
        }

        emit Withdrawn(user, token, withdrawn);
        return withdrawn;
    }

    /**
     * @notice Get the current APY for a token
     * @param token The token to check
     * @return The current APY in basis points (e.g., 500 = 5%)
     */
    function getCurrentAPY(address token) external view returns (uint256) {
        ReserveData memory reserveData = aavePool.getReserveData(token);

        // Aave returns liquidityRate in ray (27 decimals), convert to basis points
        // Ray: 1e27, Basis points: 1e4
        // APY = (liquidityRate / 1e27) * 10000
        return uint256(reserveData.currentLiquidityRate) / 1e23; // 1e27 / 1e4 = 1e23
    }

    /**
     * @notice Get the total value locked in the strategy
     * @param token The token to check
     * @return The total amount deposited (across all users)
     */
    function getTVL(address token) external view returns (uint256) {
        address aToken = aTokens[token];
        if (aToken == address(0)) return 0;

        // Return the balance of aTokens held by this strategy
        return IAToken(aToken).balanceOf(address(this));
    }

    /**
     * @notice Get user's balance in the strategy
     * @param user The user address
     * @param token The token to check
     * @return The user's balance
     */
    function getUserBalance(address user, address token) external view returns (uint256) {
        return userBalances[user][token];
    }

    /**
     * @notice Get the aToken address for a given token
     */
    function getAToken(address token) external view returns (address) {
        return aTokens[token];
    }
}
