# Cross-Chain DeFi Reference System (CCIP + Aave v3)

Production-style reference for secure cross-chain intent execution using Chainlink CCIP and Aave v3 strategies. This is not a live DeFi app; it demonstrates architecture, security controls, strategy abstraction, and operational tooling across EVM chains.

## Repository Layout

- `contracts/` – Solidity sources for the CCIP-enabled yield aggregator
  - `interfaces/` – Shared protocol interfaces (e.g., `IYieldStrategy`)
  - `strategies/` – Sample strategies (Aave V3)
  - `mocks/` – Mock CCIP router, Aave pool/aToken, ERC20 for testing
- `scripts/` – Hardhat deployment and maintenance scripts
- `test/` – Contract tests (comprehensive test suite in development)
- `hardhat.config.js` – Hardhat configuration (networks, paths, etherscan)

## Overview

This protocol enables users to deposit funds on one blockchain and automatically optimize yields across multiple chains. It leverages Chainlink's Cross-Chain Interoperability Protocol (CCIP) for secure, decentralized cross-chain messaging and token transfers, creating a unified yield optimization system across heterogeneous blockchain networks.

## Motivation

Cross-chain yield optimization today is fragmented and relies on ad-hoc bridges and custom messaging systems that introduce significant security risks. DeFi users often leave yields on the table because moving assets between chains is complex, expensive, and risky.

This protocol demonstrates how Chainlink CCIP can serve as a secure, decentralized transport layer for both asset transfers and yield optimization intent across chains, enabling robust multi-chain DeFi architectures without compromising security.

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

This will install all Hardhat dependencies and tooling for smart contract development, testing, and deployment.

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

Or via npm script:
```bash
npm run compile
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

Or with npm scripts:
```bash
npm run deploy:sepolia
```

You can override router/LINK addresses at runtime:
```bash
ROUTER_ADDRESS=0x... LINK_TOKEN_ADDRESS=0x... npm run deploy:sepolia
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

## Development Roadmap

**Phase 1: Core Functionality** (In Progress)
- [ ] Implement Aave V3 yield strategy on Sepolia testnet
- [ ] Deploy and test CCIP cross-chain message flow on testnet
- [ ] Create comprehensive unit and integration test suite
- [ ] Add APY calculation and comparison logic

**Phase 2: Production Readiness**
- [ ] Implement additional yield strategies (Compound, others)
- [ ] Add automated APY monitoring and rebalancing
- [ ] Implement gas optimization strategies
- [ ] Add emergency pause functionality
- [ ] Security audit preparation

**Phase 3: Expansion**
- [ ] Add support for more chains (Arbitrum, Optimism, Base)
- [ ] Build frontend dashboard for user interactions
- [ ] Mainnet deployment (after audit)

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

## Related Projects

- **[Li.Fi Cross-Chain Swap Demo](https://github.com/andrewwalters/lifi-cross-chain-swap)** - Companion project demonstrating cross-chain swaps using Li.Fi SDK (separate approach from CCIP)

## Author

Built by **Andrew Walters** - Demonstrating Chainlink CCIP expertise for cross-chain DeFi protocol development.

## Strategy + CCIP Configuration

- Deploy `YieldAggregator` with router + LINK token addresses for your network.
- Deploy a strategy (e.g., `AaveV3Strategy`) and map aTokens for each underlying token.
- Wire the strategy on the aggregator and enable strategies:
  ```bash
  AGGREGATOR_ADDRESS=0x... STRATEGY_ADDRESS=0x... TOKEN_ADDRESS=0x... ATOKEN_ADDRESS=0x... ENABLE_STRATEGIES=true npx hardhat run scripts/setupAaveStrategy.js --network <network>
  ```
- Fund the aggregator with LINK for CCIP fees (`depositLink` or direct transfer).
- Allowlist destination chain selectors (`allowlistDestinationChain`), set gas limit (`setGasLimit`).
- View helpers: `getStrategyTVL(token)` and `getStrategyUserBalance(user, token)` to inspect strategy-side balances.
- When `strategiesEnabled` is true, deposits/withdrawals revert if no strategy is configured for the token.

### CCIP Connectivity Check

Run a lightweight fee/support probe (requires router, LINK token, selector):
```bash
ROUTER_ADDRESS=0x... LINK_TOKEN_ADDRESS=0x... DESTINATION_SELECTOR=16015286601757825753 npx hardhat run scripts/ccipCheck.js --network <network>
```

### Deploying a receiver / test ping
- Deploy an aggregator/receiver on a destination chain:
  ```bash
  ROUTER_ADDRESS=0x... LINK_TOKEN_ADDRESS=0x... ALLOW_SELECTOR=... npx hardhat run scripts/deployReceiver.js --network <dest>
  ```
- Send a small ping (optionally with tokens) from source to destination:
  ```bash
  AGGREGATOR_ADDRESS=0x... DEST_SELECTOR=... DEST_RECEIVER=0x... TOKEN_ADDRESS=0x... AMOUNT=... npx hardhat run scripts/pingPong.js --network <source>
  ```

### Aave v3 testnet addresses (for strategy setup)
- **Sepolia** (Aave v3):
  - Pool: `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`
  - WETH aToken: `0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830`
  - USDC aToken: `0x16dA4541aD1807f4443d92D26044C1147406EB80`
  - DAI aToken: `0x29598b72eb5CeBd806C5dCD549490FdA35B13cD8`
- **Avalanche Fuji** (Aave v3):
  - Pool: `0x8B9b2AF4afB389b4a70A474dfD4AdCD4a302bb40`
  - USDC aToken: `0x9CFcc1B289E59FBe1E769f020C77315DF8473760`
  - WAVAX aToken: `0x50902e21C8CfB5f2e45127c1Bbcd6B985119b433`
  - EURC aToken: `0xBb51336dAD7A010Ff32656b53233c2C3670cc5B9`

Use these with `scripts/setupAaveStrategy.js` per token/chain.

### Monitoring / telemetry
Check LINK balance, gas limit, strategies, and per-token TVL:
```bash
AGGREGATOR_ADDRESS=0x... TOKENS=0xToken1,0xToken2 USER=0xUser (optional) npx hardhat run scripts/monitor.js --network <network>
```

### Example Sepolia ↔ Fuji round-trip (commands)
1. Deploy aggregator on Sepolia and Fuji:
   ```bash
   # Sepolia
   ROUTER_ADDRESS=0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 LINK_TOKEN_ADDRESS=0x779877A7B0D9E8603169DdbD7836e478b4624789 ALLOW_SELECTOR=14767482510784806043 npx hardhat run scripts/deployReceiver.js --network sepolia
   # Fuji
   ROUTER_ADDRESS=0xF694E193200268f9a4868e4Aa017A0118C9a8177 LINK_TOKEN_ADDRESS=0x0b9d5D9136855f6FEc3c0993feE6E9CE8a297846 ALLOW_SELECTOR=16015286601757825753 npx hardhat run scripts/deployReceiver.js --network avalancheFuji
   ```
2. Deploy AaveV3Strategy on each chain with the Pool address and the aggregator address.
3. Wire strategy + aToken mapping and enable:
   ```bash
   # Sepolia WETH
   AGGREGATOR_ADDRESS=<sepolia_agg> STRATEGY_ADDRESS=<sepolia_strategy> TOKEN_ADDRESS=<WETH> ATOKEN_ADDRESS=0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830 ENABLE_STRATEGIES=true npx hardhat run scripts/setupAaveStrategy.js --network sepolia
   # Fuji USDC
   AGGREGATOR_ADDRESS=<fuji_agg> STRATEGY_ADDRESS=<fuji_strategy> TOKEN_ADDRESS=<USDC> ATOKEN_ADDRESS=0x9CFcc1B289E59FBe1E769f020C77315DF8473760 ENABLE_STRATEGIES=true npx hardhat run scripts/setupAaveStrategy.js --network avalancheFuji
   ```
4. Fund aggregators with LINK on each chain (via `depositLink` or direct transfer).
5. Send ping from Sepolia to Fuji:
   ```bash
   AGGREGATOR_ADDRESS=<sepolia_agg> DEST_SELECTOR=14767482510784806043 DEST_RECEIVER=<fuji_agg> TOKEN_ADDRESS=<WETH> AMOUNT=<wei> npx hardhat run scripts/pingPong.js --network sepolia
   ```
6. Monitor:
   ```bash
   AGGREGATOR_ADDRESS=<sepolia_agg> TOKENS=<WETH> npx hardhat run scripts/monitor.js --network sepolia
   ```
