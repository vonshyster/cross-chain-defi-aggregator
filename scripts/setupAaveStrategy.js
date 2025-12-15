/* eslint-disable no-console */
require("dotenv").config();
const hre = require("hardhat");

/**
 * Sets up AaveV3Strategy mapping for a token and registers it on the aggregator.
 *
 * Env vars:
 *  - AGGREGATOR_ADDRESS: deployed YieldAggregator
 *  - STRATEGY_ADDRESS: deployed AaveV3Strategy
 *  - TOKEN_ADDRESS: underlying token
 *  - ATOKEN_ADDRESS: corresponding aToken
 *  - ENABLE_STRATEGIES: (optional) "true" to enable strategies on the aggregator
 */
async function main() {
  const { AGGREGATOR_ADDRESS, STRATEGY_ADDRESS, TOKEN_ADDRESS, ATOKEN_ADDRESS, ENABLE_STRATEGIES } = process.env;

  if (!AGGREGATOR_ADDRESS || !STRATEGY_ADDRESS || !TOKEN_ADDRESS || !ATOKEN_ADDRESS) {
    throw new Error("Missing AGGREGATOR_ADDRESS, STRATEGY_ADDRESS, TOKEN_ADDRESS, or ATOKEN_ADDRESS");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Using signer: ${deployer.address}`);

  const strategy = await hre.ethers.getContractAt("AaveV3Strategy", STRATEGY_ADDRESS);
  console.log(`Setting aToken mapping on strategy: ${TOKEN_ADDRESS} -> ${ATOKEN_ADDRESS}`);
  const tx1 = await strategy.setAToken(TOKEN_ADDRESS, ATOKEN_ADDRESS);
  await tx1.wait();

  const aggregator = await hre.ethers.getContractAt("YieldAggregator", AGGREGATOR_ADDRESS);
  console.log(`Registering strategy on aggregator for token ${TOKEN_ADDRESS}`);
  const tx2 = await aggregator.setStrategy(TOKEN_ADDRESS, STRATEGY_ADDRESS);
  await tx2.wait();

  if (ENABLE_STRATEGIES === "true") {
    console.log("Enabling strategies globally on aggregator");
    const tx3 = await aggregator.setStrategiesEnabled(true);
    await tx3.wait();
  }

  console.log("Setup complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
