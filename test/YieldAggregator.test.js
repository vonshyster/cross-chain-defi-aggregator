const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldAggregator", function () {
  let aggregator, linkToken, testToken, owner, user1, user2, router;
  let mockPool, mockAToken, strategy, mockRouter;

  // Fixture to deploy contracts and set up test environment
  async function deployYieldAggregatorFixture() {
    const [owner, user1, user2, router] = await ethers.getSigners();

    // Deploy mock LINK token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const linkToken = await MockERC20.deploy("Chainlink Token", "LINK", ethers.parseEther("1000000"));
    const testToken = await MockERC20.deploy("Test Token", "TEST", ethers.parseEther("1000000"));

    // Deploy YieldAggregator
    const YieldAggregator = await ethers.getContractFactory("YieldAggregator");
    const aggregator = await YieldAggregator.deploy(router.address, await linkToken.getAddress());

    // Fund users with test tokens
    await testToken.transfer(user1.address, ethers.parseEther("1000"));
    await testToken.transfer(user2.address, ethers.parseEther("1000"));

    // Fund aggregator with LINK for fees
    await linkToken.transfer(await aggregator.getAddress(), ethers.parseEther("100"));

    return { aggregator, linkToken, testToken, owner, user1, user2, router };
  }

  beforeEach(async function () {
    ({ aggregator, linkToken, testToken, owner, user1, user2, router } = await deployYieldAggregatorFixture());
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await aggregator.owner()).to.equal(owner.address);
    });

    it("Should set the correct LINK token address", async function () {
      expect(await aggregator.linkToken()).to.equal(await linkToken.getAddress());
    });
  });

  describe("Deposit", function () {
    it("Should allow users to deposit tokens", async function () {

      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);

      await expect(aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount))
        .to.emit(aggregator, "TokensDeposited")
        .withArgs(user1.address, await testToken.getAddress(), depositAmount);

      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount);
    });

    it("Should revert when depositing zero amount", async function () {
      await expect(aggregator.connect(user1).deposit(await testToken.getAddress(), 0))
        .to.be.revertedWithCustomError(aggregator, "InvalidAmount");
    });

    it("Should revert when depositing to invalid token address", async function () {
      await expect(aggregator.connect(user1).deposit(ethers.ZeroAddress, ethers.parseEther("100")))
        .to.be.revertedWithCustomError(aggregator, "InvalidTokenAddress");
    });

    it("Should track multiple deposits from same user", async function () {

      const firstDeposit = ethers.parseEther("100");
      const secondDeposit = ethers.parseEther("50");

      await testToken.connect(user1).approve(await aggregator.getAddress(), firstDeposit + secondDeposit);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), firstDeposit);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), secondDeposit);

      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(firstDeposit + secondDeposit);
    });

    it("Should track deposits from multiple users separately", async function () {

      const user1Amount = ethers.parseEther("100");
      const user2Amount = ethers.parseEther("200");

      await testToken.connect(user1).approve(await aggregator.getAddress(), user1Amount);
      await testToken.connect(user2).approve(await aggregator.getAddress(), user2Amount);

      await aggregator.connect(user1).deposit(await testToken.getAddress(), user1Amount);
      await aggregator.connect(user2).deposit(await testToken.getAddress(), user2Amount);

      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress())).to.equal(user1Amount);
      expect(await aggregator.getDeposit(user2.address, await testToken.getAddress())).to.equal(user2Amount);
    });
  });

  describe("Withdraw", function () {
    it("Should allow users to withdraw their deposits", async function () {

      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      const withdrawAmount = ethers.parseEther("50");
      await expect(aggregator.connect(user1).withdraw(await testToken.getAddress(), withdrawAmount))
        .to.emit(aggregator, "TokensWithdrawn")
        .withArgs(user1.address, await testToken.getAddress(), withdrawAmount);

      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress()))
        .to.equal(depositAmount - withdrawAmount);
    });

    it("Should revert when withdrawing more than deposited", async function () {

      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      const withdrawAmount = ethers.parseEther("150");
      await expect(aggregator.connect(user1).withdraw(await testToken.getAddress(), withdrawAmount))
        .to.be.revertedWithCustomError(aggregator, "NotEnoughBalance");
    });

    it("Should revert when withdrawing zero amount", async function () {
      await expect(aggregator.connect(user1).withdraw(await testToken.getAddress(), 0))
        .to.be.revertedWithCustomError(aggregator, "InvalidAmount");
    });

    it("Should revert when withdrawing from invalid token address", async function () {
      await expect(aggregator.connect(user1).withdraw(ethers.ZeroAddress, ethers.parseEther("100")))
        .to.be.revertedWithCustomError(aggregator, "InvalidTokenAddress");
    });
  });

  describe("Allowlist Management", function () {
    it("Should allow owner to allowlist destination chains and emit event", async function () {
      const chainSelector = 16015286601757825753n; // Sepolia

      await expect(aggregator.connect(owner).allowlistDestinationChain(chainSelector, true))
        .to.emit(aggregator, "ChainAllowlisted")
        .withArgs(chainSelector, true);

      expect(await aggregator.allowedDestinationChains(chainSelector)).to.be.true;
    });

    it("Should allow owner to remove chains from allowlist", async function () {

      const chainSelector = 16015286601757825753n;
      await aggregator.connect(owner).allowlistDestinationChain(chainSelector, true);
      await aggregator.connect(owner).allowlistDestinationChain(chainSelector, false);

      expect(await aggregator.allowedDestinationChains(chainSelector)).to.be.false;
    });

    it("Should revert when non-owner tries to allowlist", async function () {

      const chainSelector = 16015286601757825753n;
      await expect(aggregator.connect(user1).allowlistDestinationChain(chainSelector, true))
        .to.be.revertedWithCustomError(aggregator, "OwnableUnauthorizedAccount");
    });
  });

  describe("Security Features", function () {
    it("Should allow pauser/owner to pause the contract", async function () {
      await aggregator.connect(owner).pause();
      expect(await aggregator.paused()).to.be.true;
    });

    it("Should prevent deposits when paused", async function () {
      await aggregator.connect(owner).pause();

      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);

      await expect(aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount))
        .to.be.revertedWithCustomError(aggregator, "EnforcedPause");
    });

    it("Should prevent withdrawals when paused", async function () {
      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      await aggregator.connect(owner).pause();

      await expect(aggregator.connect(user1).withdraw(await testToken.getAddress(), depositAmount))
        .to.be.revertedWithCustomError(aggregator, "EnforcedPause");
    });

    it("Should allow withdrawals after unpause", async function () {
      const depositAmount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), depositAmount);

      await aggregator.connect(owner).pause();
      await aggregator.connect(owner).unpause();

      await expect(aggregator.connect(user1).withdraw(await testToken.getAddress(), depositAmount))
        .to.emit(aggregator, "TokensWithdrawn");
    });

    it("Should revert when non-pauser tries to pause", async function () {
      await expect(aggregator.connect(user1).pause())
        .to.be.revertedWithCustomError(aggregator, "NotPauser");
    });

    it("Should update pauser", async function () {
      await aggregator.connect(owner).setPauser(user1.address);
      expect(await aggregator.pauser()).to.equal(user1.address);
      await aggregator.connect(user1).pause();
      expect(await aggregator.paused()).to.be.true;
    });
  });

  describe("Gas Limit Configuration", function () {
    it("Should allow owner to set gas limit and emit event", async function () {
      const oldGasLimit = await aggregator.gasLimit();
      const newGasLimit = 500_000;

      await expect(aggregator.connect(owner).setGasLimit(newGasLimit))
        .to.emit(aggregator, "GasLimitUpdated")
        .withArgs(oldGasLimit, newGasLimit);

      expect(await aggregator.gasLimit()).to.equal(newGasLimit);
    });

    it("Should revert when setting gas limit below minimum", async function () {
      const tooLow = 10_000; // Below MIN_GAS_LIMIT (50_000)
      await expect(aggregator.connect(owner).setGasLimit(tooLow))
        .to.be.revertedWithCustomError(aggregator, "InvalidAmount");
    });

    it("Should revert when setting gas limit above maximum", async function () {
      const tooHigh = 3_000_000; // Above MAX_GAS_LIMIT (2_000_000)
      await expect(aggregator.connect(owner).setGasLimit(tooHigh))
        .to.be.revertedWithCustomError(aggregator, "InvalidAmount");
    });

    it("Should revert when non-owner tries to set gas limit", async function () {
      await expect(aggregator.connect(user1).setGasLimit(500_000))
        .to.be.revertedWithCustomError(aggregator, "OwnableUnauthorizedAccount");
    });
  });

  describe("LINK Management", function () {
    it("Should allow users to deposit LINK for fees", async function () {
      const linkAmount = ethers.parseEther("10");
      await linkToken.connect(user1).approve(await aggregator.getAddress(), linkAmount);
      await linkToken.transfer(user1.address, linkAmount);

      await expect(aggregator.connect(user1).depositLink(linkAmount))
        .to.emit(aggregator, "LinkDeposited")
        .withArgs(user1.address, linkAmount);
    });

    it("Should track LINK balance correctly", async function () {
      const initialBalance = await aggregator.getLinkBalance();
      const depositAmount = ethers.parseEther("5");

      await linkToken.transfer(user1.address, depositAmount);
      await linkToken.connect(user1).approve(await aggregator.getAddress(), depositAmount);
      await aggregator.connect(user1).depositLink(depositAmount);

      expect(await aggregator.getLinkBalance()).to.equal(initialBalance + depositAmount);
    });

    it("Should revert when depositing zero LINK", async function () {
      await expect(aggregator.connect(user1).depositLink(0))
        .to.be.revertedWithCustomError(aggregator, "InvalidAmount");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to withdraw stuck tokens", async function () {

      // Send tokens directly to contract (simulating stuck tokens)
      const stuckAmount = ethers.parseEther("10");
      await testToken.transfer(await aggregator.getAddress(), stuckAmount);

      const initialBalance = await testToken.balanceOf(owner.address);
      await aggregator.connect(owner).withdrawToken(owner.address, await testToken.getAddress());

      expect(await testToken.balanceOf(owner.address))
        .to.be.greaterThan(initialBalance);
    });

    it("Should revert when non-owner tries to withdraw tokens", async function () {

      await expect(aggregator.connect(user1).withdrawToken(user1.address, await testToken.getAddress()))
        .to.be.revertedWithCustomError(aggregator, "OwnableUnauthorizedAccount");
    });
  });

  describe("Strategies", function () {
    beforeEach(async function () {
      // Deploy mock Aave pool and aToken
      const MockAavePool = await ethers.getContractFactory("MockAavePool");
      mockPool = await MockAavePool.deploy();

      const MockAToken = await ethers.getContractFactory("MockAToken");
      mockAToken = await MockAToken.deploy("Mock AToken", "aTEST", await testToken.getAddress());

      // Wire pool to aToken
      await mockPool.setAToken(await testToken.getAddress(), await mockAToken.getAddress());

      // Deploy strategy and map aToken
      const AaveV3Strategy = await ethers.getContractFactory("AaveV3Strategy");
      strategy = await AaveV3Strategy.deploy(await mockPool.getAddress(), await aggregator.getAddress());
      await strategy.setAToken(await testToken.getAddress(), await mockAToken.getAddress());

      // Register strategy on aggregator
      await aggregator.connect(owner).setStrategy(await testToken.getAddress(), await strategy.getAddress());
      await aggregator.connect(owner).setStrategiesEnabled(true);
    });

    it("Should revert if strategies are enabled but no strategy set for token", async function () {
      const newToken = await (await ethers.getContractFactory("MockERC20")).deploy("Other", "OTH", ethers.parseEther("1000"));
      await aggregator.connect(owner).setStrategiesEnabled(true);

      await newToken.transfer(user1.address, ethers.parseEther("10"));
      await newToken.connect(user1).approve(await aggregator.getAddress(), ethers.parseEther("10"));

      await expect(
        aggregator.connect(user1).deposit(await newToken.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(aggregator, "StrategyNotSet").withArgs(await newToken.getAddress());
    });

    it("Should route deposits into strategy and mint aTokens", async function () {
      const amount = ethers.parseEther("100");
      await testToken.connect(user1).approve(await aggregator.getAddress(), amount);

      await expect(aggregator.connect(user1).deposit(await testToken.getAddress(), amount))
        .to.emit(strategy, "Deposited")
        .withArgs(user1.address, await testToken.getAddress(), amount);

      expect(await mockAToken.balanceOf(await strategy.getAddress())).to.equal(amount);
      expect(await strategy.getUserBalance(user1.address, await testToken.getAddress())).to.equal(amount);
      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress())).to.equal(amount);
    });

    it("Should withdraw from strategy and return funds to user", async function () {
      const amount = ethers.parseEther("50");
      await testToken.connect(user1).approve(await aggregator.getAddress(), amount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), amount);

      const userBalBefore = await testToken.balanceOf(user1.address);

      await expect(aggregator.connect(user1).withdraw(await testToken.getAddress(), amount))
        .to.emit(strategy, "Withdrawn")
        .withArgs(user1.address, await testToken.getAddress(), amount);

      const userBalAfter = await testToken.balanceOf(user1.address);
      expect(userBalAfter).to.equal(userBalBefore + amount); // no fees in mock
      expect(await mockAToken.balanceOf(await strategy.getAddress())).to.equal(0);
      expect(await strategy.getUserBalance(user1.address, await testToken.getAddress())).to.equal(0);
    });

    it("Should report APY and TVL from mock pool", async function () {
      await mockPool.setMockAPY(await testToken.getAddress(), 500); // 5% -> 500 bps
      expect(await strategy.getCurrentAPY(await testToken.getAddress())).to.equal(500);

      const amount = ethers.parseEther("25");
      await testToken.connect(user1).approve(await aggregator.getAddress(), amount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), amount);

      expect(await strategy.getTVL(await testToken.getAddress())).to.equal(amount);
    });
  });

  describe("CCIP Flow (mocked)", function () {
    beforeEach(async function () {
      // Deploy mock router and re-deploy aggregator with it
      const MockCCIPRouter = await ethers.getContractFactory("MockCCIPRouter");
      mockRouter = await MockCCIPRouter.deploy();

      const YieldAggregator = await ethers.getContractFactory("YieldAggregator");
      aggregator = await YieldAggregator.deploy(await mockRouter.getAddress(), await linkToken.getAddress());

      // Fund aggregator with LINK and allowlist a chain
      await linkToken.transfer(await aggregator.getAddress(), ethers.parseEther("10"));
      await aggregator.connect(owner).allowlistDestinationChain(16015286601757825753n, true); // Sepolia selector

      // Give users tokens
      await testToken.transfer(user1.address, ethers.parseEther("100"));
    });

    it("Should send CCIP message and deduct user deposit", async function () {
      const amount = ethers.parseEther("10");
      const chainSelector = 16015286601757825753n;
      const receiver = user2.address;

      await testToken.connect(user1).approve(await aggregator.getAddress(), amount);
      await aggregator.connect(user1).deposit(await testToken.getAddress(), amount);

      const tx = await aggregator.connect(user1).requestYieldOptimization(
        chainSelector,
        receiver,
        await testToken.getAddress(),
        amount,
        "optimize"
      );

      await expect(tx)
        .to.emit(aggregator, "MessageSent");

      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress())).to.equal(0);
    });

    it("Should credit user on simulated receive", async function () {
      const tokenAmounts = [{
        token: await testToken.getAddress(),
        amount: ethers.parseEther("5")
      }];

      await testToken.transfer(await mockRouter.getAddress(), ethers.parseEther("5"));

      await mockRouter.simulateReceive(
        await aggregator.getAddress(),
        16015286601757825753n,
        user2.address,
        ethers.AbiCoder.defaultAbiCoder().encode(["string", "address"], ["incoming", user1.address]),
        tokenAmounts
      );

      expect(await aggregator.getDeposit(user1.address, await testToken.getAddress())).to.equal(ethers.parseEther("5"));
    });
  });
});
