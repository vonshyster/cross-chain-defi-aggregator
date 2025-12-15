/* eslint-disable no-console */
require("dotenv").config();
const hre = require("hardhat");

/**
 * Initiates a small CCIP send to test connectivity (ping) and expects a receive (pong) on the peer chain.
 * Assumes both chains have deployed YieldAggregator and are allowlisted appropriately.
 *
 * Env vars:
 *  - AGGREGATOR_ADDRESS: local chain aggregator
 *  - DEST_SELECTOR: destination chain selector
 *  - DEST_RECEIVER: receiver address on destination chain
 *  - TOKEN_ADDRESS: token to send (optional; defaults to none)
 *  - AMOUNT: amount to send (wei; optional; defaults to 0)
 */
async function main() {
  const { AGGREGATOR_ADDRESS, DEST_SELECTOR, DEST_RECEIVER, TOKEN_ADDRESS, AMOUNT } = process.env;
  if (!AGGREGATOR_ADDRESS || !DEST_SELECTOR || !DEST_RECEIVER) {
    throw new Error("Missing AGGREGATOR_ADDRESS, DEST_SELECTOR, or DEST_RECEIVER");
  }

  const amount = AMOUNT ? BigInt(AMOUNT) : 0n;
  const [sender] = await hre.ethers.getSigners();
  const agg = await hre.ethers.getContractAt("YieldAggregator", AGGREGATOR_ADDRESS);

  console.log(`Pinging destination selector ${DEST_SELECTOR} -> receiver ${DEST_RECEIVER}`);
  let msg;
  if (amount > 0n) {
    // Approve and deposit to have balance
    const token = await hre.ethers.getContractAt("IERC20", TOKEN_ADDRESS);
    await token.approve(AGGREGATOR_ADDRESS, amount);
    await agg.deposit(TOKEN_ADDRESS, amount);
    msg = await agg.requestYieldOptimization(BigInt(DEST_SELECTOR), DEST_RECEIVER, TOKEN_ADDRESS, amount, "ping");
  } else {
    msg = await agg.requestYieldOptimization(BigInt(DEST_SELECTOR), DEST_RECEIVER, hre.ethers.ZeroAddress, 0, "ping");
  }
  const receipt = await msg.wait();
  console.log(`Ping tx hash: ${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
