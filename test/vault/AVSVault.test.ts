import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SCALE = 10n ** 18n;

function id(label: string): string {
  return ethers.id(label);
}

async function deployMockVault(configureTrading = true) {
  const [owner, beneficiary, outsider] = await ethers.getSigners();
  const usdt = await ethers.deployContract("MockERC20");
  const vault = await ethers.deployContract("AVSVault", [
    await owner.getAddress(),
    await usdt.getAddress(),
  ]);
  const ledger = await ethers.deployContract("VaultLedgerMock");
  const token = await ethers.deployContract("VaultTokenMock");
  const marketplace = await ethers.deployContract("VaultActorMock");
  const migration = await ethers.deployContract("VaultActorMock");
  const trading = await ethers.deployContract("VaultActorMock");

  await Promise.all([
    usdt.waitForDeployment(),
    vault.waitForDeployment(),
    ledger.waitForDeployment(),
    token.waitForDeployment(),
    marketplace.waitForDeployment(),
    migration.waitForDeployment(),
    trading.waitForDeployment(),
  ]);

  await vault.setAVSToken(await token.getAddress());
  await vault.setAVSLedger(await ledger.getAddress());
  await vault.setMarketplace(await marketplace.getAddress());
  await vault.setMigration(await migration.getAddress());
  if (configureTrading) {
    await vault.setTradingContract(await trading.getAddress());
  }

  return {
    owner,
    beneficiary,
    outsider,
    usdt,
    vault,
    ledger,
    token,
    marketplace,
    migration,
    trading,
  };
}

async function fundAndApprove(
  usdt: Awaited<ReturnType<typeof ethers.deployContract>>,
  actor: Awaited<ReturnType<typeof ethers.deployContract>>,
  vault: Awaited<ReturnType<typeof ethers.deployContract>>,
  amount: bigint,
) {
  await usdt.mint(await actor.getAddress(), amount);
  await actor.approveToken(
    await usdt.getAddress(),
    await vault.getAddress(),
    amount,
  );
}

describe("AVSVault", function () {
  describe("construction and configuration", function () {
    it("requires a non-zero owner and contract USDT", async function () {
      const [owner] = await ethers.getSigners();
      const usdt = await ethers.deployContract("MockERC20");
      await usdt.waitForDeployment();

      await expect(
        ethers.deployContract("AVSVault", [
          ethers.ZeroAddress,
          await usdt.getAddress(),
        ]),
      ).to.be.revertedWithCustomError(
        await ethers.getContractFactory("AVSVault"),
        "InvalidOwner",
      );
      await expect(
        ethers.deployContract("AVSVault", [
          await owner.getAddress(),
          await owner.getAddress(),
        ]),
      )
        .to.be.revertedWithCustomError(
          await ethers.getContractFactory("AVSVault"),
          "InvalidContract",
        )
        .withArgs(await owner.getAddress());
    });

    it("allows distinct contract configuration replacement until an irreversible lock", async function () {
      const { owner, outsider, vault, marketplace, migration } =
        await deployMockVault();
      const replacement = await ethers.deployContract("VaultActorMock");
      await replacement.waitForDeployment();

      await expect(
        vault.connect(outsider).setMarketplace(await replacement.getAddress()),
      )
        .to.be.revertedWithCustomError(vault, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(
        vault.setMarketplace(await owner.getAddress()),
      ).to.be.revertedWithCustomError(vault, "InvalidContract");
      await expect(vault.setMarketplace(await migration.getAddress()))
        .to.be.revertedWithCustomError(vault, "AuthorityCollision")
        .withArgs(await migration.getAddress());

      await expect(vault.setMarketplace(await replacement.getAddress()))
        .to.emit(vault, "ConfigurationAddressUpdated")
        .withArgs(
          id("MARKETPLACE"),
          await marketplace.getAddress(),
          await replacement.getAddress(),
        );
      await expect(vault.lockConfiguration()).to.emit(
        vault,
        "ConfigurationLocked",
      );
      await expect(
        vault.setMarketplace(await marketplace.getAddress()),
      ).to.be.revertedWithCustomError(vault, "ConfigurationLockedError");
      await expect(vault.lockConfiguration()).to.be.revertedWithCustomError(
        vault,
        "ConfigurationLockedError",
      );
    });

    it("rejects locking when any required protocol address is missing", async function () {
      const [owner] = await ethers.getSigners();
      const configurations = [
        ["AVS_TOKEN", "setAVSToken"],
        ["AVS_LEDGER", "setAVSLedger"],
        ["MIGRATION", "setMigration"],
        ["MARKETPLACE", "setMarketplace"],
        ["TRADING", "setTradingContract"],
      ] as const;

      for (let missing = 0; missing < configurations.length; missing += 1) {
        const usdt = await ethers.deployContract("MockERC20");
        const vault = await ethers.deployContract("AVSVault", [
          await owner.getAddress(),
          await usdt.getAddress(),
        ]);
        const authorities = await Promise.all(
          configurations.map(() => ethers.deployContract("VaultActorMock")),
        );
        await Promise.all([
          usdt.waitForDeployment(),
          vault.waitForDeployment(),
          ...authorities.map((authority) => authority.waitForDeployment()),
        ]);

        for (let index = 0; index < configurations.length; index += 1) {
          if (index === missing) continue;
          const [, setter] = configurations[index];
          await vault[setter](await authorities[index].getAddress());
        }

        await expect(vault.lockConfiguration())
          .to.be.revertedWithCustomError(vault, "ConfigurationNotReady")
          .withArgs(id(configurations[missing][0]));
      }
    });
  });

  describe("liquidity and routing", function () {
    it("bounds Marketplace liquidity to the reserve target and fixed destination", async function () {
      const { owner, outsider, usdt, vault, marketplace } =
        await deployMockVault();
      const amount = 100n * SCALE;
      await usdt.mint(await vault.getAddress(), amount);
      await vault.setReserveTarget(60n * SCALE);

      expect(await vault.availableMarketLiquidity()).to.equal(60n * SCALE);
      await expect(
        vault.connect(outsider).provideMarketLiquidity(1n),
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
      await expect(
        marketplace.provideMarketLiquidity(
          await vault.getAddress(),
          61n * SCALE,
        ),
      )
        .to.be.revertedWithCustomError(vault, "InsufficientMarketLiquidity")
        .withArgs(61n * SCALE, 60n * SCALE);

      await expect(
        marketplace.provideMarketLiquidity(
          await vault.getAddress(),
          25n * SCALE,
        ),
      )
        .to.emit(vault, "MarketLiquidityProvided")
        .withArgs(25n * SCALE);
      expect(await usdt.balanceOf(await marketplace.getAddress())).to.equal(
        25n * SCALE,
      );
      expect(await usdt.balanceOf(await owner.getAddress())).to.equal(0n);
    });

    it("changes reserve policy without moving funds, including after address lock", async function () {
      const { usdt, vault, marketplace, trading } = await deployMockVault();
      await usdt.mint(await vault.getAddress(), 100n * SCALE);
      await usdt.mint(await marketplace.getAddress(), 4n * SCALE);
      await usdt.mint(await trading.getAddress(), 6n * SCALE);
      await vault.setReserveTarget(40n * SCALE);
      await vault.lockConfiguration();

      const vaultBefore = await usdt.balanceOf(await vault.getAddress());
      const marketplaceBefore = await usdt.balanceOf(
        await marketplace.getAddress(),
      );
      const tradingBefore = await usdt.balanceOf(await trading.getAddress());

      await expect(vault.setReserveTarget(70n * SCALE))
        .to.emit(vault, "ReserveTargetUpdated")
        .withArgs(40n * SCALE, 70n * SCALE);
      expect(await vault.reserveTarget()).to.equal(70n * SCALE);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
        vaultBefore,
      );
      expect(await usdt.balanceOf(await marketplace.getAddress())).to.equal(
        marketplaceBefore,
      );
      expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
        tradingBefore,
      );
    });

    it("retains excess while Trading is unconfigured and routes exactly excess once configured", async function () {
      const { usdt, vault, trading, marketplace } =
        await deployMockVault(false);
      const amount = 100n * SCALE;
      await vault.setReserveTarget(40n * SCALE);
      await usdt.mint(await marketplace.getAddress(), amount);
      await marketplace.approveToken(
        await usdt.getAddress(),
        await vault.getAddress(),
        amount,
      );

      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          id("retained-marketplace-revenue"),
          amount,
        ),
      )
        .to.emit(vault, "ProtocolRevenueReceived")
        .withArgs(
          id("retained-marketplace-revenue"),
          await marketplace.getAddress(),
          amount,
        )
        .and.to.emit(vault, "ExcessRetainedBecauseTradingNotConfigured")
        .withArgs(100n * SCALE - 40n * SCALE);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(amount);

      await vault.setTradingContract(await trading.getAddress());
      const nextAmount = 10n * SCALE;
      await usdt.mint(await marketplace.getAddress(), nextAmount);
      await marketplace.approveToken(
        await usdt.getAddress(),
        await vault.getAddress(),
        nextAmount,
      );
      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          id("routed-marketplace-revenue"),
          nextAmount,
        ),
      )
        .to.emit(vault, "ExcessRoutedToTrading")
        .withArgs(70n * SCALE);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
        40n * SCALE,
      );
      expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
        70n * SCALE,
      );
    });
  });

  describe("capital inflow", function () {
    it("records real Marketplace capital, mints Ledger-determined shares, and routes after completion", async function () {
      const { beneficiary, usdt, vault, ledger, token, marketplace, trading } =
        await deployMockVault();
      const capital = 100n * SCALE;
      const shares = 75n * SCALE;
      await ledger.configureReturn(shares, false);
      await vault.setReserveTarget(25n * SCALE);
      await fundAndApprove(usdt, marketplace, vault, capital);

      await expect(
        marketplace.receiveMarketplaceCapital(
          await vault.getAddress(),
          id("marketplace-capital"),
          await beneficiary.getAddress(),
          capital,
        ),
      )
        .to.emit(vault, "MarketplaceCapitalReceived")
        .withArgs(
          id("marketplace-capital"),
          await beneficiary.getAddress(),
          capital,
          shares,
        )
        .and.to.emit(vault, "ExcessRoutedToTrading")
        .withArgs(75n * SCALE);
      expect(await ledger.recordCount()).to.equal(1n);
      expect(await ledger.lastCapitalAmount()).to.equal(capital);
      expect(await token.totalSupply()).to.equal(shares);
      expect(await token.lastRecipient()).to.equal(
        await beneficiary.getAddress(),
      );
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
        25n * SCALE,
      );
      expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
        75n * SCALE,
      );
    });

    it("supports Migration capital through its distinct source", async function () {
      const { beneficiary, usdt, vault, ledger, token, migration } =
        await deployMockVault();
      const amount = 12n * SCALE;
      await ledger.configureReturn(amount, false);
      await vault.setReserveTarget(amount);
      await fundAndApprove(usdt, migration, vault, amount);

      await expect(
        migration.receiveMigrationCapital(
          await vault.getAddress(),
          id("migration-capital"),
          await beneficiary.getAddress(),
          amount,
        ),
      )
        .to.emit(vault, "MigrationCapitalReceived")
        .withArgs(
          id("migration-capital"),
          await beneficiary.getAddress(),
          amount,
          amount,
        );
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("rejects fee-on-transfer capital and rolls back the transfer", async function () {
      const [owner, beneficiary] = await ethers.getSigners();
      const usdt = await ethers.deployContract("FeeOnTransferMock", [100]);
      const vault = await ethers.deployContract("AVSVault", [
        await owner.getAddress(),
        await usdt.getAddress(),
      ]);
      const ledger = await ethers.deployContract("VaultLedgerMock");
      const token = await ethers.deployContract("VaultTokenMock");
      const marketplace = await ethers.deployContract("VaultActorMock");
      await Promise.all([
        usdt.waitForDeployment(),
        vault.waitForDeployment(),
        ledger.waitForDeployment(),
        token.waitForDeployment(),
        marketplace.waitForDeployment(),
      ]);
      await vault.setAVSLedger(await ledger.getAddress());
      await vault.setAVSToken(await token.getAddress());
      await vault.setMarketplace(await marketplace.getAddress());
      await ledger.configureReturn(1n, false);

      const amount = 100n * SCALE;
      await usdt.mint(await marketplace.getAddress(), amount);
      await marketplace.approveToken(
        await usdt.getAddress(),
        await vault.getAddress(),
        amount,
      );
      await expect(
        marketplace.receiveMarketplaceCapital(
          await vault.getAddress(),
          id("fee-capital"),
          await beneficiary.getAddress(),
          amount,
        ),
      )
        .to.be.revertedWithCustomError(vault, "ExactAmountNotReceived")
        .withArgs(amount, 99n * SCALE);
      expect(await ledger.recordCount()).to.equal(0n);
      expect(await token.totalSupply()).to.equal(0n);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(0n);
      expect(await usdt.balanceOf(await marketplace.getAddress())).to.equal(
        amount,
      );
    });

    it("enforces non-zero shares and independent MAX_SUPPLY before mint", async function () {
      const { beneficiary, usdt, vault, ledger, token, marketplace } =
        await deployMockVault();
      const amount = 10n * SCALE;
      await fundAndApprove(usdt, marketplace, vault, amount);

      await ledger.configureReturn(0n, false);
      await expect(
        marketplace.receiveMarketplaceCapital(
          await vault.getAddress(),
          id("zero-shares"),
          await beneficiary.getAddress(),
          amount,
        ),
      ).to.be.revertedWithCustomError(vault, "SharesToMintIsZero");
      expect(await ledger.recordCount()).to.equal(0n);

      await ledger.configureReturn(1_001n * SCALE, false);
      await expect(
        marketplace.receiveMarketplaceCapital(
          await vault.getAddress(),
          id("max-supply"),
          await beneficiary.getAddress(),
          amount,
        ),
      )
        .to.be.revertedWithCustomError(vault, "MaxSupplyExceeded")
        .withArgs(1_001n * SCALE, 1_000n * SCALE);
      expect(await token.totalSupply()).to.equal(0n);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(0n);
    });
  });

  describe("revenue", function () {
    it("records Marketplace protocol revenue without AVS minting", async function () {
      const { usdt, vault, ledger, token, marketplace, trading } =
        await deployMockVault();
      const marketplaceFees = 7n * SCALE;
      const revenueId = id("marketplace-protocol-revenue");
      await vault.setReserveTarget(marketplaceFees);
      await fundAndApprove(usdt, marketplace, vault, marketplaceFees);

      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          revenueId,
          marketplaceFees,
        ),
      )
        .to.emit(vault, "ProtocolRevenueReceived")
        .withArgs(revenueId, await marketplace.getAddress(), marketplaceFees);
      expect(await ledger.protocolRevenueRecordCount()).to.equal(1n);
      expect(await ledger.lastRevenueId()).to.equal(revenueId);
      expect(await ledger.lastProtocolRevenueAmount()).to.equal(
        marketplaceFees,
      );
      expect(await ledger.recordCount()).to.equal(0n);
      expect(await token.mintCount()).to.equal(0n);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
        marketplaceFees,
      );
    });

    it("accepts Trading returns without Ledger accounting or AVS minting", async function () {
      const { usdt, vault, ledger, token, trading } = await deployMockVault();
      const tradingReturn = 9n * SCALE;
      await vault.setReserveTarget(tradingReturn);
      await fundAndApprove(usdt, trading, vault, tradingReturn);

      await expect(
        trading.receiveTradingReturn(await vault.getAddress(), tradingReturn),
      )
        .to.emit(vault, "TradingFundsReturned")
        .withArgs(await trading.getAddress(), tradingReturn);
      expect(await ledger.protocolRevenueRecordCount()).to.equal(0n);
      expect(await ledger.recordCount()).to.equal(0n);
      expect(await token.mintCount()).to.equal(0n);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
        tradingReturn,
      );
    });

    it("rejects unauthorized and zero identifiers or amounts", async function () {
      const { outsider, vault, marketplace, trading } = await deployMockVault();
      await expect(
        vault
          .connect(outsider)
          .receiveMarketplaceRevenue(id("unauthorized-revenue"), 1n),
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          ethers.ZeroHash,
          1n,
        ),
      ).to.be.revertedWithCustomError(vault, "InvalidIdentifier");
      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          id("zero-marketplace-revenue"),
          0n,
        ),
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
      await expect(
        trading.receiveTradingReturn(await vault.getAddress(), 0n),
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("rolls back the USDT pull when Ledger revenue accounting fails", async function () {
      const { usdt, vault, ledger, marketplace } = await deployMockVault();
      const amount = 12n * SCALE;
      await ledger.configureProtocolRevenueRevert(true);
      await fundAndApprove(usdt, marketplace, vault, amount);

      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          id("rejected-marketplace-revenue"),
          amount,
        ),
      ).to.be.revertedWithCustomError(ledger, "LedgerMockReverted");
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(0n);
      expect(await usdt.balanceOf(await marketplace.getAddress())).to.equal(
        amount,
      );
      expect(await ledger.protocolRevenueRecordCount()).to.equal(0n);
    });

    it("routes Marketplace revenue and Trading returns above the reserve target", async function () {
      const { usdt, vault, marketplace, trading } = await deployMockVault();
      await vault.setReserveTarget(10n * SCALE);

      await fundAndApprove(usdt, marketplace, vault, 15n * SCALE);
      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          id("marketplace-routing"),
          15n * SCALE,
        ),
      )
        .to.emit(vault, "ExcessRoutedToTrading")
        .withArgs(5n * SCALE);

      await fundAndApprove(usdt, trading, vault, 7n * SCALE);
      await expect(
        trading.receiveTradingReturn(await vault.getAddress(), 7n * SCALE),
      )
        .to.emit(vault, "ExcessRoutedToTrading")
        .withArgs(7n * SCALE);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
        10n * SCALE,
      );
      expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
        12n * SCALE,
      );
    });
  });

  describe("existing protocol integration", function () {
    it("works with the actual AVSLedger and AVSToken interfaces", async function () {
      const [owner, beneficiary] = await ethers.getSigners();
      const usdt = await ethers.deployContract("MockERC20");
      const ledger = await ethers.deployContract("AVSLedger", [
        await owner.getAddress(),
      ]);
      const token = await ethers.deployContract("AVSToken", [
        await owner.getAddress(),
      ]);
      const vault = await ethers.deployContract("AVSVault", [
        await owner.getAddress(),
        await usdt.getAddress(),
      ]);
      const marketplace = await ethers.deployContract("VaultActorMock");
      const trading = await ethers.deployContract("VaultActorMock");
      const policy = await ethers.deployContract("VaultAccountPolicyMock");
      await Promise.all([
        usdt.waitForDeployment(),
        ledger.waitForDeployment(),
        token.waitForDeployment(),
        vault.waitForDeployment(),
        marketplace.waitForDeployment(),
        trading.waitForDeployment(),
        policy.waitForDeployment(),
      ]);

      await vault.setAVSLedger(await ledger.getAddress());
      await vault.setAVSToken(await token.getAddress());
      await vault.setMarketplace(await marketplace.getAddress());
      await vault.setTradingContract(await trading.getAddress());
      await ledger.bindAVSToken(await token.getAddress());
      await ledger.configureVault(await vault.getAddress());
      await ledger.configureTradeSettlement(await trading.getAddress());
      await token.setVault(await vault.getAddress());
      await token.setAccountPolicy(await policy.getAddress());
      await policy.authorize(
        await token.getAddress(),
        await beneficiary.getAddress(),
      );
      await vault.setReserveTarget(100n * SCALE);

      const amount = 100n * SCALE;
      await fundAndApprove(usdt, marketplace, vault, amount);
      await expect(
        marketplace.receiveMarketplaceCapital(
          await vault.getAddress(),
          id("actual-integration"),
          await beneficiary.getAddress(),
          amount,
        ),
      ).to.emit(vault, "MarketplaceCapitalReceived");

      expect(await ledger.totalNetAssets()).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);
      expect(await token.balanceOf(await beneficiary.getAddress())).to.equal(
        amount,
      );

      const revenueId = id("actual-marketplace-revenue");
      const revenue = 10n * SCALE;
      await fundAndApprove(usdt, marketplace, vault, revenue);
      await marketplace.receiveMarketplaceRevenue(
        await vault.getAddress(),
        revenueId,
        revenue,
      );
      expect(await ledger.totalNetAssets()).to.equal(amount + revenue);
      expect(await ledger.totalGrossProfit()).to.equal(0n);
      expect(await ledger.totalLoss()).to.equal(0n);
      expect(await ledger.totalBuybackAllocated()).to.equal(0n);
      expect(await ledger.buybackReserve()).to.equal(0n);
      expect(await token.totalSupply()).to.equal(amount);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(amount);
      expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
        revenue,
      );

      await fundAndApprove(usdt, marketplace, vault, revenue);
      await expect(
        marketplace.receiveMarketplaceRevenue(
          await vault.getAddress(),
          revenueId,
          revenue,
        ),
      )
        .to.be.revertedWithCustomError(ledger, "AlreadyProcessed")
        .withArgs(revenueId);
      expect(await ledger.totalNetAssets()).to.equal(amount + revenue);
      expect(await usdt.balanceOf(await marketplace.getAddress())).to.equal(
        revenue,
      );
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(amount);

      const tradingReturn = 9n * SCALE;
      await fundAndApprove(usdt, trading, vault, tradingReturn);
      await trading.receiveTradingReturn(
        await vault.getAddress(),
        tradingReturn,
      );
      expect(await ledger.totalNetAssets()).to.equal(amount + revenue);
      expect(await token.totalSupply()).to.equal(amount);
      expect(await usdt.balanceOf(await vault.getAddress())).to.equal(amount);
    });
  });

  describe("authority surface", function () {
    it("has no owner/admin withdrawal or arbitrary execution function", async function () {
      const { vault } = await deployMockVault();
      const forbidden = new Set([
        "withdraw",
        "emergencyWithdraw",
        "transferToken",
        "sendToTrading",
        "withdrawExcess",
        "sweep",
        "rescueToken",
        "arbitraryCall",
      ]);
      const exposedForbidden = vault.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => fragment.name)
        .filter((name): name is string => name !== undefined)
        .filter((name) => forbidden.has(name));

      expect(exposedForbidden).to.deep.equal([]);
    });
  });
});
