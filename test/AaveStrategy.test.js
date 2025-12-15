const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aave V3 Strategy Integration", function () {
  let aggregator, strategy, mockAavePool, mockAToken, testToken, linkToken;
  let owner, user1, user2;

  async function deployFixture() {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    linkToken = await MockERC20.deploy("Chainlink Token", "LINK", ethers.parseEther("1000000"));
    testToken = await MockERC20.deploy("Test Token", "TEST", ethers.parseEther("1000000"));

    // Deploy mock Aave pool
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy();

    // Deploy mock aToken
    const MockAToken = await ethers.getContractFactory("MockAToken");
    mockAToken = await MockAToken.deploy("Aave Test Token", "aTE ST", await testToken.getAddress());

    // Configure Aave pool
    await mockAavePool.setAToken(await testToken.getAddress(), await mockAToken.getAddress());
    await mockAavePool.setMockAPY(await testToken.getAddress(), 500); // 5% APY

    // Fund pool with tokens
    await testToken.transfer(await mockAavePool.getAddress(), ethers.parseEther("10000"));

    // Deploy mock router for aggregator
    const MockCCIPRouter = await ethers.getContractFactory("MockCCIPRouter");
    const mockRouter = await MockCCIPRouter.deploy();

    // Deploy YieldAggregator
    const YieldAggregator = await ethers.getContractFactory("YieldAggregator");
    aggregator = await YieldAggregator.deploy(
      await mockRouter.getAddress(),
      await linkToken.getAddress()
    );

    // Deploy Aave V3 Strategy
    const AaveV3Strategy = await ethers.getContractFactory("AaveV3Strategy");
    strategy = await AaveV3Strategy.deploy(
      await mockAavePool.getAddress(),
      await aggregator.getAddress()
    );

    // Configure strategy with aToken mapping
    await strategy.setAToken(await testToken.getAddress(), await mockAToken.getAddress());

    // Wire strategy to aggregator
    await aggregator.setStrategy(await testToken.getAddress(), await strategy.getAddress());

    // Fund users
    await testToken.transfer(user1.address, ethers.parseEther("1000"));
    await testToken.transfer(user2.address, ethers.parseEther("1000"));

    return { aggregator, strategy, mockAavePool, mockAToken, testToken, linkToken, owner, user1, user2 };
  }

  beforeEach(async function () {
    ({ aggregator, strategy, mockAavePool, mockAToken, testToken, linkToken, owner, user1, user2 } = await deployFixture());
  });

  describe("Strategy Configuration", function () {
    it("Should set strategy for a token", async function () {
      const strategyAddress = await aggregator.getStrategy(await testToken.getAddress());
      expect(strategyAddress).to.equal(await strategy.getAddress());
    });

    it("Should emit StrategySet event", async function () {
      const newStrategy = await (await ethers.getContractFactory("AaveV3Strategy")).deploy(
        await mockAavePool.getAddress(),
        await aggregator.getAddress()
      );

      await expect(aggregator.setStrategy(await testToken.getAddress(), await newStrategy.getAddress()))
        .to.emit(aggregator, "StrategySet")
        .withArgs(await testToken.getAddress(), await newStrategy.getAddress());
    });

    it("Should revert when non-owner tries to set strategy", async function () {
      await expect(aggregator.connect(user1).setStrategy(await testToken.getAddress(), await strategy.getAddress()))
        .to.be.revertedWithCustomError(aggregator, "OwnableUnauthorizedAccount");
    });

    it("Should enable/disable strategies", async function () {
      expect(await aggregator.strategiesEnabled()).to.be.false;

      await aggregator.setStrategiesEnabled(true);
      expect(await aggregator.strategiesEnabled()).to.be.true;

      await aggregator.setStrategiesEnabled(false);
      expect(await aggregator.strategiesEnabled()).to.be.false;
    });
  });

  describe("Deposits with Strategy", function () {
    beforeEach(async function () {
      await aggregator.setStrategiesEnabled(true);
    });

    it("Should deposit into strategy when enabled", async function () {
      const depositAmount = ethers.parseEther("100");

      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      // Check user balance in aggregator
      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount);

      // Check strategy received the funds (has aTokens)
      expect(await mockAToken.balanceOf(await strategy.getAddress()))
        .to.equal(depositAmount);

      // Check strategy TVL
      expect(await strategy.getTVL(await testToken.getAddress()))
        .to.equal(depositAmount);
    });

    it("Should track user balance in strategy", async function () {
      const depositAmount = ethers.parseEther("150");

      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      expect(await strategy.getUserBalance(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount);
    });

    it("Should work without strategy when disabled", async function () {
      await aggregator.setStrategiesEnabled(false);

      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      // Funds should stay in aggregator, not in strategy
      expect(await testToken.balanceOf(await aggregator.getAddress()))
        .to.equal(depositAmount);

      expect(await mockAToken.balanceOf(await strategy.getAddress()))
        .to.equal(0);
    });

    it("Should handle multiple users depositing", async function () {
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");

      await testToken.connect(user1).approve(await aggregator.getAddress(), amount1);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), amount1);

      await testToken.connect(user2).approve(await aggregator.getAddress(), amount2);
      await aggregator.connect(user2).deposit(await testToken.getAddress(), amount2);

      expect(await strategy.getUserBalance(user1.address, await testToken.getAddress()))
        .to.equal(amount1);
      expect(await strategy.getUserBalance(user2.address, await testToken.getAddress()))
        .to.equal(amount2);

      expect(await strategy.getTVL(await testToken.getAddress()))
        .to.equal(amount1 + amount2);
    });
  });

  describe("Withdrawals from Strategy", function () {
    beforeEach(async function () {
      await aggregator.setStrategiesEnabled(true);
    });

    it("Should withdraw from strategy when enabled", async function () {
      const depositAmount = ethers.parseEther("100");
      const withdrawAmount = ethers.parseEther("50");

      // Deposit first
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      // Withdraw
      const initialBalance = await testToken.balanceOf(user1.address);
      await aggregator.connect(user1).withdraw(await testToken.getAddress(), withdrawAmount);

      // Check user received tokens
      expect(await testToken.balanceOf(user1.address))
        .to.equal(initialBalance + withdrawAmount);

      // Check strategy TVL decreased
      expect(await strategy.getTVL(await testToken.getAddress()))
        .to.equal(depositAmount - withdrawAmount);

      // Check user balance in strategy
      expect(await strategy.getUserBalance(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount - withdrawAmount);
    });

    it("Should withdraw all funds", async function () {
      const depositAmount = ethers.parseEther("100");

      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      await aggregator.connect(user1).withdraw(await testToken.getAddress(), depositAmount);

      expect(await strategy.getTVL(await testToken.getAddress())).to.equal(0);
      expect(await strategy.getUserBalance(user1.address, await testToken.getAddress()))
        .to.equal(0);
    });
  });

  describe("APY Queries", function () {
    it("Should return current APY from strategy", async function () {
      const apy = await strategy.getCurrentAPY(await testToken.getAddress());
      expect(apy).to.equal(500); // 5% in basis points
    });

    it("Should reflect APY changes", async function () {
      await mockAavePool.setMockAPY(await testToken.getAddress(), 750); // 7.5%
      const apy = await strategy.getCurrentAPY(await testToken.getAddress());
      expect(apy).to.equal(750);
    });
  });

  describe("Strategy Access Control", function () {
    it("Should only allow aggregator to call deposit", async function () {
      const amount = ethers.parseEther("100");
      await testToken.transfer(user1.address, amount);
      await testToken.connect(user1).approve(await strategy.getAddress(), amount);

      await expect(strategy.connect(user1).deposit(await testToken.getAddress(), amount, user1.address))
        .to.be.revertedWithCustomError(strategy, "OnlyAggregator");
    });

    it("Should only allow aggregator to call withdraw", async function () {
      await expect(strategy.connect(user1).withdraw(await testToken.getAddress(), ethers.parseEther("100"), user1.address))
        .to.be.revertedWithCustomError(strategy, "OnlyAggregator");
    });

    it("Should only allow owner to set aToken", async function () {
      const newAToken = await (await ethers.getContractFactory("MockAToken")).deploy(
        "New aToken",
        "aNew",
        await testToken.getAddress()
      );

      await expect(strategy.connect(user1).setAToken(await testToken.getAddress(), await newAToken.getAddress()))
        .to.be.revertedWithCustomError(strategy, "OwnableUnauthorizedAccount");
    });
  });

  describe("Edge Cases", function () {
    it("Should revert when aToken not set", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const newToken = await MockERC20.deploy("New Token", "NEW", ethers.parseEther("1000"));

      await aggregator.setStrategy(await newToken.getAddress(), await strategy.getAddress());
      await aggregator.setStrategiesEnabled(true);

      await newToken.transfer(user1.address, ethers.parseEther("100"));
      await newToken.connect(user1).approve(await aggregator.getAddress(), ethers.parseEther("100"));

      await expect(aggregator.connect(user1).deposit(await newToken.getAddress(), ethers.parseEther("100")))
        .to.be.revertedWithCustomError(strategy, "ATokenNotSet");
    });

    it("Should return 0 TVL for token without aToken", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const newToken = await MockERC20.deploy("New Token", "NEW", ethers.parseEther("1000"));

      expect(await strategy.getTVL(await newToken.getAddress())).to.equal(0);
    });
  });
});
