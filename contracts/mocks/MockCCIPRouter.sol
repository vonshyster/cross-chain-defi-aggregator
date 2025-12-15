// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IAny2EVMMessageReceiver} from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";

/**
 * @title MockCCIPRouter
 * @notice Mock CCIP router for testing cross-chain message flow
 */
contract MockCCIPRouter {
    uint256 public mockFee = 0.001 ether;
    bool public shouldRevert;

    event MessageSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address indexed receiver,
        Client.EVM2AnyMessage message,
        uint256 fee
    );

    event MessageReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address indexed receiver,
        Client.Any2EVMMessage message
    );

    /**
     * @notice Set the mock fee for CCIP messages
     */
    function setMockFee(uint256 _fee) external {
        mockFee = _fee;
    }

    /**
     * @notice Toggle revert behavior for testing failure cases
     */
    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    /**
     * @notice Mock getFee - returns the mock fee
     */
    function getFee(
        uint64 /* destinationChainSelector */,
        Client.EVM2AnyMessage memory /* message */
    ) external view returns (uint256) {
        return mockFee;
    }

    /**
     * @notice Mock ccipSend - simulates sending a cross-chain message
     * @dev Transfers tokens from sender and emits event
     */
    function ccipSend(
        uint64 destinationChainSelector,
        Client.EVM2AnyMessage calldata message
    ) external returns (bytes32) {
        if (shouldRevert) {
            revert("MockCCIPRouter: Forced revert");
        }

        // Transfer fee token (LINK) from sender
        IERC20 feeToken = IERC20(message.feeToken);
        require(feeToken.transferFrom(msg.sender, address(this), mockFee), "Fee transfer failed");

        // Transfer tokens from sender if any
        for (uint256 i = 0; i < message.tokenAmounts.length; i++) {
            IERC20 token = IERC20(message.tokenAmounts[i].token);
            require(
                token.transferFrom(msg.sender, address(this), message.tokenAmounts[i].amount),
                "Token transfer failed"
            );
        }

        // Generate mock message ID
        bytes32 messageId = keccak256(
            abi.encodePacked(
                block.timestamp,
                msg.sender,
                destinationChainSelector,
                message.receiver
            )
        );

        emit MessageSent(messageId, destinationChainSelector, abi.decode(message.receiver, (address)), message, mockFee);

        return messageId;
    }

    /**
     * @notice Simulate receiving a CCIP message on the destination chain
     * @dev Helper function to test the receiver's _ccipReceive logic
     */
    function simulateReceive(
        address receiver,
        uint64 sourceChainSelector,
        address sender,
        bytes calldata data,
        Client.EVMTokenAmount[] calldata tokenAmounts
    ) external returns (bytes32) {
        // Transfer tokens to receiver before calling ccipReceive
        for (uint256 i = 0; i < tokenAmounts.length; i++) {
            IERC20 token = IERC20(tokenAmounts[i].token);
            require(
                token.transfer(receiver, tokenAmounts[i].amount),
                "Token transfer to receiver failed"
            );
        }

        // Construct Any2EVMMessage
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256(abi.encodePacked(block.timestamp, sender, receiver)),
            sourceChainSelector: sourceChainSelector,
            sender: abi.encode(sender),
            data: data,
            destTokenAmounts: tokenAmounts
        });

        // Call the receiver's ccipReceive function
        IAny2EVMMessageReceiver(receiver).ccipReceive(message);

        emit MessageReceived(message.messageId, sourceChainSelector, receiver, message);

        return message.messageId;
    }

    /**
     * @notice Check if chain is supported (always true for mock)
     */
    function isChainSupported(uint64 /* chainSelector */) external pure returns (bool) {
        return true;
    }

    /**
     * @notice Get supported tokens (returns empty array for mock)
     */
    function getSupportedTokens(uint64 /* chainSelector */) external pure returns (address[] memory) {
        return new address[](0);
    }
}
