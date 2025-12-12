# Cross-Chain DeFi Yield Aggregator

A decentralized yield optimization protocol leveraging Chainlink CCIP for cross-chain asset management and yield farming.

## Overview

This project enables users to deposit funds on one blockchain and automatically optimize yields across multiple chains. It uses Chainlink's Cross-Chain Interoperability Protocol (CCIP) for secure cross-chain messaging and token transfers.

## Motivation

Cross-chain yield routing today is fragmented, brittle, and security-sensitive. Protocols rely on ad-hoc bridges and custom messaging systems that introduce risk.
This project demonstrates how Chainlink CCIP can serve as a secure transport layer for sending both value and intent across chains, enabling robust, multi-chain DeFi architectures.

## Features

- **Multi-Chain Deposits**: Deposit assets on any supported chain
- **Cross-Chain Yield Optimization**: Automatically move funds to chains with better yields
- **Secure Bridging**: Leverages Chainlink CCIP's security model (DON + Risk Management Network)
- **Yield Strategy Abstraction**: Pluggable interfaces for Aave, Compound, and other DeFi protocols
- **User-Controlled**: Users maintain custody and can withdraw at any time

## Architecture

```
┌─────────────┐                    ┌─────────────┐
│  Chain A    │                    │  Chain B    │
│             │   CCIP Message     │             │
│ ┌─────────┐ │ ──────────────────>│ ┌─────────┐ │
│ │  Yield  │ │   + Token Transfer │ │  Yield  │ │
│ │Agg.     | │                    │ │Agg.     | │
│ └─────────┘ │                    │ └─────────┘ │
│      │      │                    │      │      │
│      ▼      │                    │      ▼      │
│ ┌─────────┐ │                    │ ┌─────────┐ │
│ │ Strategy│ │                    │ │ Strategy│ │
│ │ (Aave)  │ │                    │ |Compound │ |
│ └─────────┘ │                    │ └─────────┘ │
└─────────────┘                    └─────────────┘
```
User Action → YieldAggregator (Chain A)
    ├─ Validate request and deduct user balance
    ├─ Construct EVM2AnyMessage (receiver, data, tokenAmounts)
    ├─ Estimate CCIP fee via Router.getFee()
    ├─ Approve LINK + token
    └─ Call ccipSend()

           ↓

Chainlink CCIP DON
    ├─ Verifies message + fees
    ├─ Routes payload + tokens securely
    └─ Handles execution guarantees

           ↓

YieldAggregator (Chain B)
    ├─ _ccipReceive() triggered by router
    ├─ Decode message + original user
    └─ Credit user balance with received tokens


## Smart Contracts

### YieldAggregator.sol
Main contract handling:
- User deposits and withdrawals
- Cross-chain message sending/receiving via CCIP
- User balance tracking across chains
- Integration with yield strategies

### IYieldStrategy.sol
Interface for yield strategy implementations:
- `deposit()` - Deploy funds to strategy
- `withdraw()` - Withdraw funds from strategy
- `getCurrentAPY()` - Get current yield rate
- `getTVL()` - Get total value locked

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your environment variables:
- Private keys (testnet only, never use mainnet keys)
- RPC URLs (Alchemy, Infura, or public RPCs)
- Block explorer API keys
- CCIP router addresses (pre-filled for testnet)

## Compile Contracts

```bash
npx hardhat compile
```

## Testing

```bash
npx hardhat test
```

## Deployment

Deploy to Sepolia testnet:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

## Supported Networks (Testnet)

| Network | Chain Selector | Router Address |
|---------|---------------|----------------|
| Sepolia | 16015286601757825753 | 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 |
| Polygon Mumbai | 12532609583862916517 | 0x1035CabC275068e0F4b745A29CEDf38E13aF41b1 |
| Avalanche Fuji | 14767482510784806043 | 0xF694E193200268f9a4868e4Aa017A0118C9a8177 |

## Usage Example

```javascript
// 1. Deposit tokens on Chain A
await yieldAggregator.deposit(tokenAddress, amount);

// 2. Request yield optimization to Chain B
await yieldAggregator.requestYieldOptimization(
    chainBSelector,
    receiverAddress,
    tokenAddress,
    amount,
    "Optimizing for higher APY"
);

// 3. Funds are automatically transferred via CCIP
// 4. Receiver contract on Chain B credits your account
// 5. Withdraw anytime from either chain
await yieldAggregator.withdraw(tokenAddress, amount);
```

## Roadmap

- [ ] Implement Aave yield strategy
- [ ] Implement Compound yield strategy
- [ ] Add automated APY monitoring
- [ ] Build frontend dashboard
- [ ] Add support for more chains (Arbitrum, Optimism, Base)
- [ ] Implement gas optimization strategies
- [ ] Add emergency pause functionality
- [ ] Create comprehensive test suite
- [ ] Audit smart contracts
- [ ] Mainnet deployment

## Security Considerations

- Smart contracts are **NOT AUDITED** - use at your own risk
- Only use testnet funds for testing
- CCIP provides built-in security via DON and Risk Management Network
- Always verify chain selectors and router addresses
- Implement proper access controls for production use

## Resources

- [Chainlink CCIP Documentation](https://docs.chain.link/ccip)
- [CCIP Masterclass](https://cll-devrel.gitbook.io/ccip-masterclass-1/)
- [Hardhat Documentation](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)

## License

MIT

## Contributing

Contributions welcome! Please open an issue or submit a PR.

## Author

Built with ☕️ by Andrew Walters - demonstrating CCIP fluency for cross-chain DeFi applications.
