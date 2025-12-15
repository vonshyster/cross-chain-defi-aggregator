// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.2/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts@5.0.2/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol";
import {IYieldStrategy} from "./interfaces/IYieldStrategy.sol";

/**
 * @title YieldAggregator
 * @notice Cross-chain DeFi yield aggregator using Chainlink CCIP
 * @dev Allows users to deposit funds on one chain and optimize yield across multiple chains
 */
contract YieldAggregator is CCIPReceiver, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Custom errors
    error NotEnoughBalance(uint256 currentBalance, uint256 calculatedFees);
    error NothingToWithdraw();
    error FailedToWithdrawEth(address owner, address target, uint256 value);
    error DestinationChainNotAllowed(uint64 destinationChainSelector);
    error InvalidReceiverAddress();
    error InvalidTokenAddress();
    error InvalidAmount();
    error StrategyNotSet(address token);
    error NotPauser();
    error OnlySelf();

    // Events
    event MessageSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address receiver,
        string message,
        address feeToken,
        uint256 fees
    );

    event MessageReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address sender,
        string message
    );

    event TokensDeposited(
        address indexed user,
        address indexed token,
        uint256 amount
    );

    event TokensWithdrawn(
        address indexed user,
        address indexed token,
        uint256 amount
    );

    event YieldOptimizationRequested(
        address indexed user,
        uint64 indexed targetChain,
        uint256 amount
    );

    event GasLimitUpdated(
        uint256 oldGasLimit,
        uint256 newGasLimit
    );

    event ChainAllowlisted(
        uint64 indexed chainSelector,
        bool allowed
    );

    event LinkDeposited(
        address indexed sender,
        uint256 amount
    );

    event StrategySet(
        address indexed token,
        address indexed strategy
    );

    event FeeCharged(bytes32 indexed messageId, uint256 feeAmount);
    event PauserUpdated(address indexed oldPauser, address indexed newPauser);

    // State variables
    mapping(uint64 => bool) public allowedDestinationChains;
    mapping(address => mapping(address => uint256)) public userDeposits; // user => token => amount
    mapping(address => IYieldStrategy) public strategies; // token => strategy

    IERC20 public immutable linkToken;
    uint256 public gasLimit;
    bool public strategiesEnabled;
    address public pauser;

    // Constants
    uint256 public constant MIN_GAS_LIMIT = 50_000;
    uint256 public constant MAX_GAS_LIMIT = 2_000_000;

    constructor(address _router, address _link) CCIPReceiver(_router) Ownable(msg.sender) {
        if (_link == address(0)) revert InvalidTokenAddress();
        linkToken = IERC20(_link);
        gasLimit = 200_000; // Default gas limit
        pauser = msg.sender;
    }

    /**
     * @notice Allows chain owner to configure which chains can receive messages
     * @param _destinationChainSelector Chain selector for the destination chain
     * @param allowed Whether the chain is allowed
     */
    function allowlistDestinationChain(
        uint64 _destinationChainSelector,
        bool allowed
    ) external onlyOwner {
        allowedDestinationChains[_destinationChainSelector] = allowed;
        emit ChainAllowlisted(_destinationChainSelector, allowed);
    }

    /**
     * @notice Set the gas limit for CCIP messages
     * @param _gasLimit New gas limit (must be between MIN_GAS_LIMIT and MAX_GAS_LIMIT)
     */
    function setGasLimit(uint256 _gasLimit) external onlyOwner {
        if (_gasLimit < MIN_GAS_LIMIT || _gasLimit > MAX_GAS_LIMIT) revert InvalidAmount();
        uint256 oldGasLimit = gasLimit;
        gasLimit = _gasLimit;
        emit GasLimitUpdated(oldGasLimit, _gasLimit);
    }

    /**
     * @notice Update pauser role
     */
    function setPauser(address newPauser) external onlyOwner {
        address old = pauser;
        pauser = newPauser;
        emit PauserUpdated(old, newPauser);
    }

    /**
     * @notice Pause the contract (emergency stop)
     */
    function pause() external {
        if (msg.sender != pauser && msg.sender != owner()) revert NotPauser();
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external {
        if (msg.sender != pauser && msg.sender != owner()) revert NotPauser();
        _unpause();
    }

    /**
     * @notice Deposit LINK tokens for CCIP fees
     * @param amount Amount of LINK to deposit
     */
    function depositLink(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        linkToken.safeTransferFrom(msg.sender, address(this), amount);
        emit LinkDeposited(msg.sender, amount);
    }

    /**
     * @notice Get the LINK balance available for fees
     */
    function getLinkBalance() external view returns (uint256) {
        return linkToken.balanceOf(address(this));
    }

    /**
     * @notice Set yield strategy for a token
     * @param token The token address
     * @param strategy The strategy contract address
     */
    function setStrategy(address token, address strategy) external onlyOwner {
        if (token == address(0)) revert InvalidTokenAddress();
        strategies[token] = IYieldStrategy(strategy);
        emit StrategySet(token, strategy);
    }

    /**
     * @notice Enable or disable strategy usage globally
     * @param enabled Whether strategies should be used
     */
    function setStrategiesEnabled(bool enabled) external onlyOwner {
        strategiesEnabled = enabled;
    }

    /**
     * @notice Get strategy for a token
     */
    function getStrategy(address token) external view returns (address) {
        return address(strategies[token]);
    }

    /**
     * @notice Get total TVL for a token (aggregator holdings + strategy TVL)
     */
    function getTotalTVL(address token) external view returns (uint256) {
        uint256 baseBalance = IERC20(token).balanceOf(address(this));
        address strategyAddr = address(strategies[token]);
        uint256 strategyBalance = strategyAddr == address(0) ? 0 : strategies[token].getTVL(token);
        return baseBalance + strategyBalance;
    }

    /**
     * @notice Get strategy TVL for a token (0 if none)
     */
    function getStrategyTVL(address token) external view returns (uint256) {
        address strategyAddr = address(strategies[token]);
        if (strategyAddr == address(0)) return 0;
        return strategies[token].getTVL(token);
    }

    /**
     * @notice Get user's balance in strategy for a token (0 if none)
     */
    function getStrategyUserBalance(address user, address token) external view returns (uint256) {
        address strategyAddr = address(strategies[token]);
        if (strategyAddr == address(0)) return 0;
        return strategies[token].getUserBalance(user, token);
    }

    /**
     * @notice Deposit tokens into the aggregator
     * @param token The ERC20 token address
     * @param amount The amount to deposit
     */
    function deposit(address token, uint256 amount) external whenNotPaused nonReentrant {
        if (token == address(0)) revert InvalidTokenAddress();
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userDeposits[msg.sender][token] += amount;

        // If strategies are enabled and a strategy exists for this token, deposit into it
        if (strategiesEnabled) {
            address strategyAddr = address(strategies[token]);
            if (strategyAddr == address(0)) revert StrategyNotSet(token);
            IERC20(token).forceApprove(strategyAddr, 0);
            IERC20(token).forceApprove(strategyAddr, amount);
            strategies[token].deposit(token, amount, msg.sender);
        }

        emit TokensDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw tokens from the aggregator
     * @param token The ERC20 token address
     * @param amount The amount to withdraw
     */
    function withdraw(address token, uint256 amount) external whenNotPaused nonReentrant {
        if (token == address(0)) revert InvalidTokenAddress();
        if (amount == 0) revert InvalidAmount();
        if (userDeposits[msg.sender][token] < amount) {
            revert NotEnoughBalance(userDeposits[msg.sender][token], amount);
        }

        userDeposits[msg.sender][token] -= amount;

        // If strategies are enabled and a strategy exists, withdraw from it
        if (strategiesEnabled) {
            address strategyAddr = address(strategies[token]);
            if (strategyAddr == address(0)) revert StrategyNotSet(token);
            strategies[token].withdraw(token, amount, msg.sender);
        }

        IERC20(token).safeTransfer(msg.sender, amount);

        emit TokensWithdrawn(msg.sender, token, amount);
    }

    /**
     * @notice Request yield optimization by moving funds to another chain
     * @param destinationChainSelector Chain selector for the destination chain
     * @param receiver Address of the receiver contract on the destination chain
     * @param token Token to transfer
     * @param amount Amount to transfer
     * @param messageText Additional message data
     */
    function requestYieldOptimization(
        uint64 destinationChainSelector,
        address receiver,
        address token,
        uint256 amount,
        string calldata messageText
    ) external whenNotPaused nonReentrant returns (bytes32 messageId) {
        if (!allowedDestinationChains[destinationChainSelector])
            revert DestinationChainNotAllowed(destinationChainSelector);
        if (receiver == address(0)) revert InvalidReceiverAddress();
        if (token == address(0)) revert InvalidTokenAddress();
        if (amount == 0) revert InvalidAmount();
        if (userDeposits[msg.sender][token] < amount) {
            revert NotEnoughBalance(userDeposits[msg.sender][token], amount);
        }

        // Deduct from user deposits
        userDeposits[msg.sender][token] -= amount;

        // Create token transfer
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({
            token: token,
            amount: amount
        });

        // Create CCIP message
        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(receiver),
            data: abi.encode(messageText, msg.sender),
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: gasLimit})
            ),
            feeToken: address(linkToken)
        });

        // Get fee and check balance
        uint256 fees = IRouterClient(i_ccipRouter).getFee(
            destinationChainSelector,
            evm2AnyMessage
        );

        if (fees > linkToken.balanceOf(address(this)))
            revert NotEnoughBalance(linkToken.balanceOf(address(this)), fees);

        // Approve router to spend LINK and tokens
        linkToken.forceApprove(i_ccipRouter, 0);
        linkToken.forceApprove(i_ccipRouter, fees);
        IERC20(token).forceApprove(i_ccipRouter, 0);
        IERC20(token).forceApprove(i_ccipRouter, amount);

        // Send message
        messageId = IRouterClient(i_ccipRouter).ccipSend(
            destinationChainSelector,
            evm2AnyMessage
        );

        emit FeeCharged(messageId, fees);
        emit YieldOptimizationRequested(msg.sender, destinationChainSelector, amount);
        emit MessageSent(
            messageId,
            destinationChainSelector,
            receiver,
            messageText,
            address(linkToken),
            fees
        );

        return messageId;
    }

    /**
     * @notice Internal function to handle incoming CCIP messages
     * @dev Override from CCIPReceiver
     */
    function _ccipReceive(
        Client.Any2EVMMessage memory any2EvmMessage
    ) internal override {
        bytes32 messageId = any2EvmMessage.messageId;
        uint64 sourceChainSelector = any2EvmMessage.sourceChainSelector;
        address sender = abi.decode(any2EvmMessage.sender, (address));
        (string memory message, address originalUser) = abi.decode(
            any2EvmMessage.data,
            (string, address)
        );

        // Credit received tokens to user
        if (any2EvmMessage.destTokenAmounts.length > 0) {
            for (uint256 i = 0; i < any2EvmMessage.destTokenAmounts.length; i++) {
                address token = any2EvmMessage.destTokenAmounts[i].token;
                uint256 amount = any2EvmMessage.destTokenAmounts[i].amount;
                userDeposits[originalUser][token] += amount;
            }
        }

        emit MessageReceived(messageId, sourceChainSelector, sender, message);
    }

    /**
     * @notice Get user's deposit balance for a specific token
     */
    function getDeposit(address user, address token) external view returns (uint256) {
        return userDeposits[user][token];
    }

    /**
     * @notice Withdraw stuck tokens (owner only)
     */
    function withdrawToken(
        address beneficiary,
        address token
    ) public onlyOwner {
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();
        IERC20(token).safeTransfer(beneficiary, amount);
    }

    /**
     * @notice Withdraw stuck ETH (owner only)
     */
    function withdrawEth(address beneficiary) public onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        (bool sent, ) = beneficiary.call{value: amount}("");
        if (!sent) revert FailedToWithdrawEth(msg.sender, beneficiary, amount);
    }

    receive() external payable {}
}
