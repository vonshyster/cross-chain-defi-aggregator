/* eslint-disable no-console */
require("dotenv").config();
const hre = require("hardhat");

/**
 * Deploys YieldAggregator (or a receiver variant) on a target chain, allowlists a selector, and funds LINK if desired.
 *
 * Env vars:
 *  - ROUTER_ADDRESS: CCIP router on this chain
 *  - LINK_TOKEN_ADDRESS: LINK token on this chain
 *  - ALLOW_SELECTOR: destination chain selector to allowlist (optional)
 */
async function main() {
  const { ROUTER_ADDRESS, LINK_TOKEN_ADDRESS, ALLOW_SELECTOR } = process.env;
  if (!ROUTER_ADDRESS || !LINK_TOKEN_ADDRESS) {
    throw new Error("Missing ROUTER_ADDRESS or LINK_TOKEN_ADDRESS");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Using signer: ${deployer.address}`);
  console.log(`Router: ${ROUTER_ADDRESS}`);
  console.log(`LINK: ${LINK_TOKEN_ADDRESS}`);

  const YieldAggregator = await hre.ethers.getContractFactory("YieldAggregator");
  const agg = await YieldAggregator.deploy(ROUTER_ADDRESS, LINK_TOKEN_ADDRESS);
  await agg.waitForDeployment();
  const addr = await agg.getAddress();
  console.log(`Deployed aggregator/receiver at ${addr}`);

  if (ALLOW_SELECTOR) {
    console.log(`Allowlisting selector ${ALLOW_SELECTOR}`);
    const tx = await agg.allowlistDestinationChain(BigInt(ALLOW_SELECTOR), true);
    await tx.wait();
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
