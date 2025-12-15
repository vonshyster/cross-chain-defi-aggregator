/* eslint-disable no-console */
require("dotenv").config();
const hre = require("hardhat");

/**
 * Configure a strategy for a token and enable strategies.
 *
 * Env vars:
 *  - AGGREGATOR_ADDRESS: deployed YieldAggregator
 *  - STRATEGY_ADDRESS: deployed strategy (e.g., AaveV3Strategy)
 *  - TOKEN_ADDRESS: underlying token address
 *  - ATOKEN_ADDRESS: aToken address (optional; set via strategy if provided)
 */
async function main() {
  const {
    AGGREGATOR_ADDRESS,
    STRATEGY_ADDRESS,
    TOKEN_ADDRESS,
    ATOKEN_ADDRESS,
  } = process.env;

  if (!AGGREGATOR_ADDRESS || !STRATEGY_ADDRESS || !TOKEN_ADDRESS) {
    throw new Error("Missing AGGREGATOR_ADDRESS, STRATEGY_ADDRESS, or TOKEN_ADDRESS");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Using deployer: ${deployer.address}`);

  const aggregator = await hre.ethers.getContractAt("YieldAggregator", AGGREGATOR_ADDRESS);
  console.log(`Setting strategy for token ${TOKEN_ADDRESS} -> ${STRATEGY_ADDRESS}`);
  const tx = await aggregator.setStrategy(TOKEN_ADDRESS, STRATEGY_ADDRESS);
  await tx.wait();

  if (ATOKEN_ADDRESS) {
    console.log(`Setting aToken on strategy: ${ATOKEN_ADDRESS}`);
    const strategy = await hre.ethers.getContractAt("AaveV3Strategy", STRATEGY_ADDRESS);
    const tx2 = await strategy.setAToken(TOKEN_ADDRESS, ATOKEN_ADDRESS);
    await tx2.wait();
  }

  console.log("Enabling strategies globally");
  const enableTx = await aggregator.setStrategiesEnabled(true);
  await enableTx.wait();

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
