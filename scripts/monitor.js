/* eslint-disable no-console */
require("dotenv").config();
const hre = require("hardhat");

/**
 * Simple monitoring script: reports LINK balance, gas limit, strategy status, and per-token TVL.
 *
 * Env vars:
 *  - AGGREGATOR_ADDRESS (required)
 *  - TOKENS (optional, comma-separated token addresses to inspect)
 *  - USER (optional, user address to query strategy user balance)
 */
async function main() {
  const { AGGREGATOR_ADDRESS, TOKENS, USER } = process.env;
  if (!AGGREGATOR_ADDRESS) {
    throw new Error("Missing AGGREGATOR_ADDRESS");
  }

  const agg = await hre.ethers.getContractAt("YieldAggregator", AGGREGATOR_ADDRESS);
  const linkAddr = await agg.linkToken();
  const link = await hre.ethers.getContractAt("IERC20", linkAddr);

  console.log(`Aggregator: ${AGGREGATOR_ADDRESS}`);
  console.log(`LINK: ${linkAddr}`);
  console.log(`Pauser: ${await agg.pauser()}`);
  console.log(`Gas limit: ${await agg.gasLimit()}`);
  console.log(`Strategies enabled: ${await agg.strategiesEnabled()}`);

  const linkBal = await link.balanceOf(AGGREGATOR_ADDRESS);
  console.log(`LINK balance: ${hre.ethers.formatUnits(linkBal, 18)} LINK`);

  if (TOKENS) {
    const tokens = TOKENS.split(",").map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
      const stratAddr = await agg.getStrategy(token);
      const baseBal = await (await hre.ethers.getContractAt("IERC20", token)).balanceOf(AGGREGATOR_ADDRESS);
      const stratTVL = await agg.getStrategyTVL(token);
      const total = await agg.getTotalTVL(token);
      console.log(`\nToken ${token}:`);
      console.log(`  Strategy: ${stratAddr}`);
      console.log(`  Aggregator balance: ${hre.ethers.formatUnits(baseBal, 18)}`);
      console.log(`  Strategy TVL: ${hre.ethers.formatUnits(stratTVL, 18)}`);
      console.log(`  Total TVL: ${hre.ethers.formatUnits(total, 18)}`);
      if (USER) {
        const userBal = await agg.getStrategyUserBalance(USER, token);
        console.log(`  User ${USER} strategy balance: ${hre.ethers.formatUnits(userBal, 18)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
