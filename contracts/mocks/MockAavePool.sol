// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";

/**
 * @title MockAToken
 * @notice Mock aToken for testing
 */
contract MockAToken is ERC20 {
    address public immutable underlyingAsset;

    constructor(string memory name, string memory symbol, address _underlyingAsset)
        ERC20(name, symbol)
    {
        underlyingAsset = _underlyingAsset;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function scaledBalanceOf(address user) external view returns (uint256) {
        return balanceOf(user);
    }
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
 * @title MockAavePool
 * @notice Mock Aave V3 Pool for testing
 */
contract MockAavePool {
    mapping(address => address) public aTokens;
    mapping(address => uint128) public mockAPY; // in ray (27 decimals)

    event Supply(address indexed asset, uint256 amount, address indexed onBehalfOf);
    event Withdraw(address indexed asset, uint256 amount, address indexed to);

    /**
     * @notice Register an aToken for an asset
     */
    function setAToken(address asset, address aToken) external {
        aTokens[asset] = aToken;
    }

    /**
     * @notice Set mock APY for an asset (in basis points)
     */
    function setMockAPY(address asset, uint256 apyBasisPoints) external {
        // Convert basis points to ray: apyBasisPoints * 1e23
        mockAPY[asset] = uint128(apyBasisPoints * 1e23);
    }

    /**
     * @notice Mock supply function
     */
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external {
        require(aTokens[asset] != address(0), "aToken not set");

        // Transfer underlying from user
        IERC20(asset).transferFrom(msg.sender, address(this), amount);

        // Mint aTokens to the recipient
        MockAToken(aTokens[asset]).mint(onBehalfOf, amount);

        emit Supply(asset, amount, onBehalfOf);
    }

    /**
     * @notice Mock withdraw function
     */
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        require(aTokens[asset] != address(0), "aToken not set");

        // Burn aTokens from sender
        MockAToken(aTokens[asset]).burn(msg.sender, amount);

        // Transfer underlying to recipient
        IERC20(asset).transfer(to, amount);

        emit Withdraw(asset, amount, to);
        return amount;
    }

    /**
     * @notice Mock getReserveData function
     */
    function getReserveData(address asset) external view returns (ReserveData memory) {
        return ReserveData({
            configuration: 0,
            liquidityIndex: 1e27,
            currentLiquidityRate: mockAPY[asset],
            variableBorrowIndex: 1e27,
            currentVariableBorrowRate: 0,
            currentStableBorrowRate: 0,
            lastUpdateTimestamp: uint40(block.timestamp),
            id: 0,
            aTokenAddress: aTokens[asset],
            stableDebtTokenAddress: address(0),
            variableDebtTokenAddress: address(0),
            interestRateStrategyAddress: address(0),
            accruedToTreasury: 0,
            unbacked: 0,
            isolationModeTotalDebt: 0
        });
    }
}
