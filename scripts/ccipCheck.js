/* eslint-disable no-console */
require("dotenv").config();
const hre = require("hardhat");

/**
 * Lightweight CCIP connectivity check.
 * Reads fee for a dummy message and confirms router supports the destination chain.
 *
 * Env vars:
 *  - ROUTER_ADDRESS: CCIP router address
 *  - LINK_TOKEN_ADDRESS: LINK token address (feeToken)
 *  - DESTINATION_SELECTOR: destination chain selector (e.g., Sepolia selector)
 */
async function main() {
  const { ROUTER_ADDRESS, LINK_TOKEN_ADDRESS, DESTINATION_SELECTOR } = process.env;

  if (!ROUTER_ADDRESS || !LINK_TOKEN_ADDRESS || !DESTINATION_SELECTOR) {
    throw new Error("Missing ROUTER_ADDRESS, LINK_TOKEN_ADDRESS, or DESTINATION_SELECTOR");
  }

  const router = await hre.ethers.getContractAt("IRouterClient", ROUTER_ADDRESS);

  // Minimal dummy message (no tokens, just data)
  const receiver = hre.ethers.ZeroAddress;
  const evm2AnyMessage = {
    receiver: hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [receiver]),
    data: hre.ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["ccip-check"]),
    tokenAmounts: [],
    extraArgs: hre.ethers.hexlify(
      hre.ethers.toUtf8Bytes("") // placeholder; router ignores for fee calc when empty?
    ),
    feeToken: LINK_TOKEN_ADDRESS,
  };

  console.log(`Checking chain support for selector ${DESTINATION_SELECTOR}...`);
  const supported = await router.isChainSupported(BigInt(DESTINATION_SELECTOR));
  console.log(`isChainSupported: ${supported}`);

  console.log("Estimating fee for dummy message...");
  const fee = await router.getFee(BigInt(DESTINATION_SELECTOR), evm2AnyMessage);
  console.log(`Estimated fee (feeToken ${LINK_TOKEN_ADDRESS}): ${fee.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
