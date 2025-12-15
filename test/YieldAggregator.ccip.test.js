const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldAggregator - CCIP Integration", function () {
  let aggregatorSource, aggregatorDest, mockRouter, linkToken, testToken;
  let owner, user1, user2;

  const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n;
  const FUJI_CHAIN_SELECTOR = 14767482510784806043n;

  async function deployFixture() {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    linkToken = await MockERC20.deploy("Chainlink Token", "LINK", ethers.parseEther("1000000"));
    testToken = await MockERC20.deploy("Test Token", "TEST", ethers.parseEther("1000000"));

    // Deploy mock CCIP router
    const MockCCIPRouter = await ethers.getContractFactory("MockCCIPRouter");
    mockRouter = await MockCCIPRouter.deploy();

    // Deploy YieldAggregator on "source chain" (Sepolia)
    const YieldAggregator = await ethers.getContractFactory("YieldAggregator");
    aggregatorSource = await YieldAggregator.deploy(
      await mockRouter.getAddress(),
      await linkToken.getAddress()
    );

    // Deploy YieldAggregator on "destination chain" (Fuji)
    aggregatorDest = await YieldAggregator.deploy(
      await mockRouter.getAddress(),
      await linkToken.getAddress()
    );

    // Setup: Allowlist destination chain on source
    await aggregatorSource.allowlistDestinationChain(FUJI_CHAIN_SELECTOR, true);

    // Fund users with test tokens
    await testToken.transfer(user1.address, ethers.parseEther("1000"));
    await testToken.transfer(user2.address, ethers.parseEther("1000"));

    // Fund aggregators with LINK for fees
    await linkToken.transfer(await aggregatorSource.getAddress(), ethers.parseEther("100"));
    await linkToken.transfer(await aggregatorDest.getAddress(), ethers.parseEther("100"));

    // Fund mock router with test tokens for simulating receives
    await testToken.transfer(await mockRouter.getAddress(), ethers.parseEther("10000"));

    return { aggregatorSource, aggregatorDest, mockRouter, linkToken, testToken, owner, user1, user2 };
  }

  beforeEach(async function () {
    ({ aggregatorSource, aggregatorDest, mockRouter, linkToken, testToken, owner, user1, user2 } = await deployFixture());
  });

  describe("Cross-Chain Message Sending", function () {
    it("Should send CCIP message with tokens", async function () {
      const depositAmount = ethers.parseEther("100");
      const sendAmount = ethers.parseEther("50");

      // User deposits tokens on source chain
      await testToken.connect(user1).approve(await aggregatorSource.getAddress(), depositAmount);
      await aggregatorSource.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      // Approve aggregator to spend tokens for CCIP transfer
      await testToken.connect(owner).transfer(await aggregatorSource.getAddress(), sendAmount);

      // Request yield optimization to destination chain
      const tx = await aggregatorSource.connect(user1).requestYieldOptimization(
        FUJI_CHAIN_SELECTOR,
        await aggregatorDest.getAddress(),
        await testToken.getAddress(),
        sendAmount,
        "Optimizing yield to Fuji"
      );

      await expect(tx)
        .to.emit(aggregatorSource, "YieldOptimizationRequested")
        .withArgs(user1.address, FUJI_CHAIN_SELECTOR, sendAmount);

      // Verify user balance decreased on source
      expect(await aggregatorSource.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount - sendAmount);
    });

    it("Should revert when destination chain not allowlisted", async function () {
      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregatorSource.getAddress(), depositAmount);
      await aggregatorSource.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      const FAKE_CHAIN_SELECTOR = 99999n;

      await expect(
        aggregatorSource.connect(user1).requestYieldOptimization(
          FAKE_CHAIN_SELECTOR,
          await aggregatorDest.getAddress(),
          await testToken.getAddress(),
          depositAmount,
          "Should fail"
        )
      ).to.be.revertedWithCustomError(aggregatorSource, "DestinationChainNotAllowed");
    });

    it("Should revert when receiver address is invalid", async function () {
      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregatorSource.getAddress(), depositAmount);
      await aggregatorSource.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      await expect(
        aggregatorSource.connect(user1).requestYieldOptimization(
          FUJI_CHAIN_SELECTOR,
          ethers.ZeroAddress,
          await testToken.getAddress(),
          depositAmount,
          "Should fail"
        )
      ).to.be.revertedWithCustomError(aggregatorSource, "InvalidReceiverAddress");
    });

    it("Should revert when user has insufficient balance", async function () {
      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregatorSource.getAddress(), depositAmount);
      await aggregatorSource.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      await expect(
        aggregatorSource.connect(user1).requestYieldOptimization(
          FUJI_CHAIN_SELECTOR,
          await aggregatorDest.getAddress(),
          await testToken.getAddress(),
          ethers.parseEther("200"), // More than deposited
          "Should fail"
        )
      ).to.be.revertedWithCustomError(aggregatorSource, "NotEnoughBalance");
    });

    it("Should use configurable gas limit", async function () {
      const newGasLimit = 500_000;
      await aggregatorSource.setGasLimit(newGasLimit);

      expect(await aggregatorSource.gasLimit()).to.equal(newGasLimit);
    });
  });

  describe("Cross-Chain Message Receiving", function () {
    it("Should receive CCIP message and credit user", async function () {
      const receiveAmount = ethers.parseEther("75");
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address"],
        ["Yield optimization complete", user1.address]
      );

      const tokenAmounts = [
        {
          token: await testToken.getAddress(),
          amount: receiveAmount
        }
      ];

      // Simulate CCIP message receive
      await mockRouter.simulateReceive(
        await aggregatorDest.getAddress(),
        SEPOLIA_CHAIN_SELECTOR,
        await aggregatorSource.getAddress(),
        messageData,
        tokenAmounts
      );

      // Verify user balance increased on destination
      expect(await aggregatorDest.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(receiveAmount);
    });

    it("Should handle multiple token transfers in one message", async function () {
      // Deploy another test token
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const testToken2 = await MockERC20.deploy("Test Token 2", "TEST2", ethers.parseEther("1000000"));

      // Fund router with second token
      await testToken2.transfer(await mockRouter.getAddress(), ethers.parseEther("10000"));

      const amount1 = ethers.parseEther("50");
      const amount2 = ethers.parseEther("25");
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address"],
        ["Multi-token transfer", user2.address]
      );

      const tokenAmounts = [
        {
          token: await testToken.getAddress(),
          amount: amount1
        },
        {
          token: await testToken2.getAddress(),
          amount: amount2
        }
      ];

      await mockRouter.simulateReceive(
        await aggregatorDest.getAddress(),
        SEPOLIA_CHAIN_SELECTOR,
        await aggregatorSource.getAddress(),
        messageData,
        tokenAmounts
      );

      // Verify both token balances
      expect(await aggregatorDest.getDeposit(user2.address, await testToken.getAddress()))
        .to.equal(amount1);
      expect(await aggregatorDest.getDeposit(user2.address, await testToken2.getAddress()))
        .to.equal(amount2);
    });

    it("Should emit MessageReceived event", async function () {
      const receiveAmount = ethers.parseEther("100");
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address"],
        ["Test message", user1.address]
      );

      const tokenAmounts = [
        {
          token: await testToken.getAddress(),
          amount: receiveAmount
        }
      ];

      const tx = mockRouter.simulateReceive(
        await aggregatorDest.getAddress(),
        SEPOLIA_CHAIN_SELECTOR,
        await aggregatorSource.getAddress(),
        messageData,
        tokenAmounts
      );

      await expect(tx)
        .to.emit(aggregatorDest, "MessageReceived");
    });
  });

  describe("End-to-End Cross-Chain Flow", function () {
    it("Should complete full cross-chain yield optimization flow", async function () {
      const depositAmount = ethers.parseEther("200");
      const optimizeAmount = ethers.parseEther("150");

      // Step 1: User deposits on source chain
      await testToken.connect(user1).approve(await aggregatorSource.getAddress(), depositAmount);
      await aggregatorSource.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      expect(await aggregatorSource.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount);

      // Step 2: Fund source aggregator with tokens for the cross-chain transfer
      await testToken.connect(owner).transfer(await aggregatorSource.getAddress(), optimizeAmount);

      // Step 3: Request yield optimization to destination
      const messageId = await aggregatorSource.connect(user1).requestYieldOptimization.staticCall(
        FUJI_CHAIN_SELECTOR,
        await aggregatorDest.getAddress(),
        await testToken.getAddress(),
        optimizeAmount,
        "Optimize to Fuji for higher APY"
      );

      await aggregatorSource.connect(user1).requestYieldOptimization(
        FUJI_CHAIN_SELECTOR,
        await aggregatorDest.getAddress(),
        await testToken.getAddress(),
        optimizeAmount,
        "Optimize to Fuji for higher APY"
      );

      // Verify balance decreased on source
      expect(await aggregatorSource.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount - optimizeAmount);

      // Step 4: Simulate CCIP message delivery to destination
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address"],
        ["Optimize to Fuji for higher APY", user1.address]
      );

      const tokenAmounts = [
        {
          token: await testToken.getAddress(),
          amount: optimizeAmount
        }
      ];

      await mockRouter.simulateReceive(
        await aggregatorDest.getAddress(),
        SEPOLIA_CHAIN_SELECTOR,
        await aggregatorSource.getAddress(),
        messageData,
        tokenAmounts
      );

      // Step 5: Verify user can access funds on destination
      expect(await aggregatorDest.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(optimizeAmount);

      // Step 6: User withdraws from destination chain
      await aggregatorDest.connect(user1).withdraw(await testToken.getAddress(), optimizeAmount);

      expect(await aggregatorDest.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(0);

      expect(await testToken.balanceOf(user1.address))
        .to.equal(ethers.parseEther("1000") - depositAmount + optimizeAmount);
    });

    it("Should handle round-trip optimization (source -> dest -> source)", async function () {
      const depositAmount = ethers.parseEther("100");
      const optimizeAmount = ethers.parseEther("80");

      // Allowlist source chain on destination for return trip
      await aggregatorDest.allowlistDestinationChain(SEPOLIA_CHAIN_SELECTOR, true);

      // Initial deposit on source
      await testToken.connect(user1).approve(await aggregatorSource.getAddress(), depositAmount);
      await aggregatorSource.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      // Fund source aggregator
      await testToken.connect(owner).transfer(await aggregatorSource.getAddress(), optimizeAmount);

      // Send to destination
      await aggregatorSource.connect(user1).requestYieldOptimization(
        FUJI_CHAIN_SELECTOR,
        await aggregatorDest.getAddress(),
        await testToken.getAddress(),
        optimizeAmount,
        "Going to Fuji"
      );

      // Simulate receive on dest
      let messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address"],
        ["Going to Fuji", user1.address]
      );

      await mockRouter.simulateReceive(
        await aggregatorDest.getAddress(),
        SEPOLIA_CHAIN_SELECTOR,
        await aggregatorSource.getAddress(),
        messageData,
        [{
          token: await testToken.getAddress(),
          amount: optimizeAmount
        }]
      );

      expect(await aggregatorDest.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(optimizeAmount);

      // Fund dest aggregator for return trip
      await testToken.connect(owner).transfer(await aggregatorDest.getAddress(), optimizeAmount);

      // Send back to source
      await aggregatorDest.connect(user1).requestYieldOptimization(
        SEPOLIA_CHAIN_SELECTOR,
        await aggregatorSource.getAddress(),
        await testToken.getAddress(),
        optimizeAmount,
        "Returning to Sepolia"
      );

      // Simulate receive back on source
      messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address"],
        ["Returning to Sepolia", user1.address]
      );

      await mockRouter.simulateReceive(
        await aggregatorSource.getAddress(),
        FUJI_CHAIN_SELECTOR,
        await aggregatorDest.getAddress(),
        messageData,
        [{
          token: await testToken.getAddress(),
          amount: optimizeAmount
        }]
      );

      // User should have original amount minus what was kept on source
      expect(await aggregatorSource.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal((depositAmount - optimizeAmount) + optimizeAmount);
    });
  });

  describe("Fee Handling", function () {
    it("Should charge LINK fees from contract balance", async function () {
      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregatorSource.getAddress(), depositAmount);
      await aggregatorSource.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      await testToken.connect(owner).transfer(await aggregatorSource.getAddress(), depositAmount);

      const initialLinkBalance = await linkToken.balanceOf(await aggregatorSource.getAddress());

      await aggregatorSource.connect(user1).requestYieldOptimization(
        FUJI_CHAIN_SELECTOR,
        await aggregatorDest.getAddress(),
        await testToken.getAddress(),
        depositAmount,
        "Test"
      );

      const finalLinkBalance = await linkToken.balanceOf(await aggregatorSource.getAddress());

      expect(finalLinkBalance).to.be.lessThan(initialLinkBalance);
    });

    it("Should revert when contract has insufficient LINK", async function () {
      // Deploy new aggregator with no LINK
      const YieldAggregator = await ethers.getContractFactory("YieldAggregator");
      const aggregatorNoLink = await YieldAggregator.deploy(
        await mockRouter.getAddress(),
        await linkToken.getAddress()
      );

      await aggregatorNoLink.allowlistDestinationChain(FUJI_CHAIN_SELECTOR, true);

      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregatorNoLink.getAddress(), depositAmount);
      await aggregatorNoLink.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      await testToken.connect(owner).transfer(await aggregatorNoLink.getAddress(), depositAmount);

      await expect(
        aggregatorNoLink.connect(user1).requestYieldOptimization(
          FUJI_CHAIN_SELECTOR,
          await aggregatorDest.getAddress(),
          await testToken.getAddress(),
          depositAmount,
          "Should fail"
        )
      ).to.be.revertedWithCustomError(aggregatorNoLink, "NotEnoughBalance");
    });
  });
});
