// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IYieldStrategy
 * @notice Interface for yield strategies (Aave, Compound, etc.)
 */
interface IYieldStrategy {
    /**
     * @notice Deploy funds to the yield strategy
     * @param token The token to deposit
     * @param amount The amount to deposit
     */
    function deposit(address token, uint256 amount, address user) external returns (uint256);

    /**
     * @notice Withdraw funds from the yield strategy
     * @param token The token to withdraw
     * @param amount The amount to withdraw
     */
    function withdraw(address token, uint256 amount, address user) external returns (uint256);

    /**
     * @notice Get the current yield rate (APY)
     * @param token The token to check
     * @return The current APY in basis points (e.g., 500 = 5%)
     */
    function getCurrentAPY(address token) external view returns (uint256);

    /**
     * @notice Get the total value locked in the strategy
     * @param token The token to check
     * @return The total amount deposited
     */
    function getTVL(address token) external view returns (uint256);

    /**
     * @notice Get user's balance in the strategy
     * @param user The user address
     * @param token The token to check
     * @return The user's balance
     */
    function getUserBalance(address user, address token) external view returns (uint256);
}
