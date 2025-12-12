// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {OwnerIsCreator} from "@chainlink/contracts-ccip/src/v0.8/shared/access/OwnerIsCreator.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import {IERC20} from "@chainlink/contracts-ccip/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@chainlink/contracts-ccip/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title YieldAggregator
 * @notice Cross-chain DeFi yield aggregator using Chainlink CCIP
 * @dev Allows users to deposit funds on one chain and optimize yield across multiple chains
 */
contract YieldAggregator is CCIPReceiver, OwnerIsCreator {
    using SafeERC20 for IERC20;

    // Custom errors
    error NotEnoughBalance(uint256 currentBalance, uint256 calculatedFees);
    error NothingToWithdraw();
    error FailedToWithdrawEth(address owner, address target, uint256 value);
    error DestinationChainNotAllowed(uint64 destinationChainSelector);
    error InvalidReceiverAddress();
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

    // State variables
    mapping(uint64 => bool) public allowedDestinationChains;
    mapping(address => mapping(address => uint256)) public userDeposits; // user => token => amount

    IERC20 public immutable linkToken;

    constructor(address _router, address _link) CCIPReceiver(_router) {
        linkToken = IERC20(_link);
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
    }

    /**
     * @notice Deposit tokens into the aggregator
     * @param token The ERC20 token address
     * @param amount The amount to deposit
     */
    function deposit(address token, uint256 amount) external {
        if (amount == 0) revert NothingToWithdraw();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userDeposits[msg.sender][token] += amount;

        emit TokensDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw tokens from the aggregator
     * @param token The ERC20 token address
     * @param amount The amount to withdraw
     */
    function withdraw(address token, uint256 amount) external {
        if (amount == 0) revert NothingToWithdraw();
        if (userDeposits[msg.sender][token] < amount) {
            revert NotEnoughBalance(userDeposits[msg.sender][token], amount);
        }

        userDeposits[msg.sender][token] -= amount;
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
    ) external returns (bytes32 messageId) {
        if (!allowedDestinationChains[destinationChainSelector])
            revert DestinationChainNotAllowed(destinationChainSelector);
        if (receiver == address(0)) revert InvalidReceiverAddress();
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
                Client.EVMExtraArgsV1({gasLimit: 200_000})
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
        linkToken.approve(i_ccipRouter, fees);
        IERC20(token).approve(i_ccipRouter, amount);

        // Send message
        messageId = IRouterClient(i_ccipRouter).ccipSend(
            destinationChainSelector,
            evm2AnyMessage
        );

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
    function withdraw(address beneficiary) public onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        (bool sent, ) = beneficiary.call{value: amount}("");
        if (!sent) revert FailedToWithdrawEth(msg.sender, beneficiary, amount);
    }

    receive() external payable {}
}
