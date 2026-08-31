import { expect } from "chai";
import { network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

const { ethers } = await network.create();

const SCALE = 10n ** 18n;
const ZERO_ID = ethers.ZeroHash;

function id(label: string): string {
  return ethers.id(label);
}

async function deployLedger() {
  const [owner, outsider] = await ethers.getSigners();
  const ledger = await ethers.deployContract("AVSLedger", [
    await owner.getAddress(),
  ]);
  await ledger.waitForDeployment();
  return { owner, outsider, ledger };
}

async function deployConfiguredLedger() {
  const foundation = await deployLedger();
  const token = await ethers.deployContract("LedgerTokenMock", [18]);
  const vault = await ethers.deployContract("LedgerSourceMock");
  const tradeSettlement = await ethers.deployContract("LedgerSourceMock");
  await Promise.all([
    token.waitForDeployment(),
    vault.waitForDeployment(),
    tradeSettlement.waitForDeployment(),
  ]);

  await foundation.ledger.bindAVSToken(await token.getAddress());
  await foundation.ledger.configureVault(await vault.getAddress());
  await foundation.ledger.configureTradeSettlement(
    await tradeSettlement.getAddress(),
  );

  return { ...foundation, token, vault, tradeSettlement };
}

async function recordCapital(
  vault: Awaited<ReturnType<typeof ethers.deployContract>>,
  ledger: Awaited<ReturnType<typeof ethers.deployContract>>,
  capitalId: string,
  amount: bigint,
  beneficiary?: string,
) {
  const [defaultBeneficiary] = await ethers.getSigners();
  return vault.recordCapitalInflow(
    await ledger.getAddress(),
    capitalId,
    beneficiary ?? (await defaultBeneficiary.getAddress()),
    amount,
  );
}

async function recordSettlement(
  source: Awaited<ReturnType<typeof ethers.deployContract>>,
  ledger: Awaited<ReturnType<typeof ethers.deployContract>>,
  settlementId: string,
  pnl: bigint,
) {
  return source.recordTradingSettlement(
    await ledger.getAddress(),
    settlementId,
    pnl,
  );
}

async function recordProtocolRevenue(
  vault: Awaited<ReturnType<typeof ethers.deployContract>>,
  ledger: Awaited<ReturnType<typeof ethers.deployContract>>,
  revenueId: string,
  amount: bigint,
) {
  return vault.recordProtocolRevenue(
    await ledger.getAddress(),
    revenueId,
    amount,
  );
}

describe("AVSLedger", function () {
  describe("genesis and bindings", function () {
    it("starts at zero with a 1 USDT genesis value and public reads", async function () {
      const { ledger, outsider } = await deployLedger();

      expect(await ledger.connect(outsider).owner()).to.not.equal(
        ethers.ZeroAddress,
      );
      expect(await ledger.connect(outsider).avsToken()).to.equal(
        ethers.ZeroAddress,
      );
      expect(await ledger.connect(outsider).vault()).to.equal(
        ethers.ZeroAddress,
      );
      expect(await ledger.connect(outsider).tradeSettlement()).to.equal(
        ethers.ZeroAddress,
      );
      expect(await ledger.connect(outsider).totalNetAssets()).to.equal(0n);
      expect(await ledger.connect(outsider).totalGrossProfit()).to.equal(0n);
      expect(await ledger.connect(outsider).totalLoss()).to.equal(0n);
      expect(await ledger.connect(outsider).totalBuybackAllocated()).to.equal(
        0n,
      );
      expect(await ledger.connect(outsider).buybackReserve()).to.equal(0n);
      expect(await ledger.connect(outsider).currentAVSValue()).to.equal(SCALE);
      expect(await ledger.connect(outsider).getCurrentAVSValue()).to.equal(
        SCALE,
      );
      expect(await ledger.connect(outsider).avsTokenName()).to.equal("");
    });

    it("allows the owner to bind the token and each source exactly once", async function () {
      const { ledger, owner, outsider } = await deployLedger();
      const token = await ethers.deployContract("LedgerTokenMock", [18]);
      const wrongDecimalsToken = await ethers.deployContract(
        "LedgerTokenMock",
        [6],
      );
      const vault = await ethers.deployContract("LedgerSourceMock");
      const tradeSettlement = await ethers.deployContract("LedgerSourceMock");
      await Promise.all([
        token.waitForDeployment(),
        wrongDecimalsToken.waitForDeployment(),
        vault.waitForDeployment(),
        tradeSettlement.waitForDeployment(),
      ]);

      await expect(
        ledger.connect(outsider).bindAVSToken(await token.getAddress()),
      )
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(ledger.bindAVSToken(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(ledger, "InvalidContract")
        .withArgs(ethers.ZeroAddress);
      await expect(ledger.bindAVSToken(await owner.getAddress()))
        .to.be.revertedWithCustomError(ledger, "InvalidContract")
        .withArgs(await owner.getAddress());

      await expect(ledger.bindAVSToken(await wrongDecimalsToken.getAddress()))
        .to.be.revertedWithCustomError(ledger, "InvalidTokenDecimals")
        .withArgs(6);
      expect(await ledger.avsToken()).to.equal(ethers.ZeroAddress);

      await expect(ledger.bindAVSToken(await token.getAddress()))
        .to.emit(ledger, "AVSTokenBound")
        .withArgs(await token.getAddress(), "Ledger Token Mock");
      expect(await ledger.avsTokenName()).to.equal("Ledger Token Mock");
      await expect(ledger.bindAVSToken(await token.getAddress()))
        .to.be.revertedWithCustomError(ledger, "AlreadyConfigured")
        .withArgs(await token.getAddress());

      for (const [method, source] of [
        ["configureVault", vault],
        ["configureTradeSettlement", tradeSettlement],
      ] as const) {
        await expect(
          ledger.connect(outsider)[method](await source.getAddress()),
        )
          .to.be.revertedWithCustomError(ledger, "Unauthorized")
          .withArgs(await outsider.getAddress());
        await expect(ledger[method](ethers.ZeroAddress))
          .to.be.revertedWithCustomError(ledger, "InvalidContract")
          .withArgs(ethers.ZeroAddress);
        await expect(ledger[method](await owner.getAddress()))
          .to.be.revertedWithCustomError(ledger, "InvalidContract")
          .withArgs(await owner.getAddress());
        await expect(ledger[method](await source.getAddress()))
          .to.emit(
            ledger,
            method === "configureVault"
              ? "VaultConfigured"
              : "TradeSettlementConfigured",
          )
          .withArgs(await source.getAddress());
        await expect(ledger[method](await source.getAddress()))
          .to.be.revertedWithCustomError(ledger, "AlreadyConfigured")
          .withArgs(await source.getAddress());
      }
    });

    it("rejects a token when any required binding read fails", async function () {
      for (const failurePoint of [1, 2, 3]) {
        const { ledger } = await deployLedger();
        const unreadableToken = await ethers.deployContract(
          "LedgerTokenReadFailureMock",
          [failurePoint],
        );
        await unreadableToken.waitForDeployment();

        await expect(ledger.bindAVSToken(await unreadableToken.getAddress()))
          .to.be.revertedWithCustomError(unreadableToken, "TokenReadFailed")
          .withArgs(failurePoint);
        expect(await ledger.avsToken()).to.equal(ethers.ZeroAddress);
      }
    });

    it("separates the temporary deployer from the configured owner", async function () {
      const [deployer, initialOwner, outsider] = await ethers.getSigners();
      const ledger = await ethers.deployContract("AVSLedger", [
        await initialOwner.getAddress(),
      ]);
      await ledger.waitForDeployment();
      const token = await ethers.deployContract("LedgerTokenMock", [18]);
      const vault = await ethers.deployContract("LedgerSourceMock");
      const tradeSettlement = await ethers.deployContract("LedgerSourceMock");
      await Promise.all([
        token.waitForDeployment(),
        vault.waitForDeployment(),
        tradeSettlement.waitForDeployment(),
      ]);

      expect(await ledger.owner()).to.equal(await initialOwner.getAddress());
      expect(await ledger.owner()).to.not.equal(await deployer.getAddress());

      for (const [method, argument] of [
        ["bindAVSToken", await token.getAddress()],
        ["configureVault", await vault.getAddress()],
        ["configureTradeSettlement", await tradeSettlement.getAddress()],
      ] as const) {
        await expect(ledger.connect(deployer)[method](argument))
          .to.be.revertedWithCustomError(ledger, "Unauthorized")
          .withArgs(await deployer.getAddress());
      }

      await expect(
        ledger.connect(initialOwner).bindAVSToken(await token.getAddress()),
      ).to.emit(ledger, "AVSTokenBound");
      await expect(
        ledger.connect(initialOwner).configureVault(await vault.getAddress()),
      ).to.emit(ledger, "VaultConfigured");
      await expect(
        ledger
          .connect(initialOwner)
          .configureTradeSettlement(await tradeSettlement.getAddress()),
      ).to.emit(ledger, "TradeSettlementConfigured");

      expect(await ledger.connect(outsider).owner()).to.equal(
        await initialOwner.getAddress(),
      );
    });

    it("rejects a zero initial owner", async function () {
      await expect(
        ethers.deployContract("AVSLedger", [ethers.ZeroAddress]),
      ).to.be.revertedWithCustomError(
        await ethers.getContractFactory("AVSLedger"),
        "InvalidOwner",
      );
    });

    it("rejects economic writes before AVS Token binding", async function () {
      const { ledger, owner } = await deployLedger();
      const vault = await ethers.deployContract("LedgerSourceMock");
      const tradeSettlement = await ethers.deployContract("LedgerSourceMock");
      await Promise.all([
        vault.waitForDeployment(),
        tradeSettlement.waitForDeployment(),
      ]);
      await ledger.configureVault(await vault.getAddress());
      await ledger.configureTradeSettlement(await tradeSettlement.getAddress());

      await expect(
        recordCapital(
          vault,
          ledger,
          id("unbound-capital"),
          SCALE,
          await owner.getAddress(),
        ),
      ).to.be.revertedWithCustomError(ledger, "AVSTokenNotBound");
      await expect(
        recordSettlement(
          tradeSettlement,
          ledger,
          id("unbound-settlement"),
          SCALE,
        ),
      ).to.be.revertedWithCustomError(ledger, "AVSTokenNotBound");
      await expect(
        recordProtocolRevenue(
          vault,
          ledger,
          id("unbound-protocol-revenue"),
          SCALE,
        ),
      ).to.be.revertedWithCustomError(ledger, "AVSTokenNotBound");
      expect(await ledger.totalNetAssets()).to.equal(0n);
      expect(await ledger.settlementCount()).to.equal(0n);
    });

    it("blocks renunciation until every mandatory link is configured", async function () {
      const { ledger, owner } = await deployLedger();
      const token = await ethers.deployContract("LedgerTokenMock", [18]);
      const vault = await ethers.deployContract("LedgerSourceMock");
      const tradeSettlement = await ethers.deployContract("LedgerSourceMock");
      await Promise.all([
        token.waitForDeployment(),
        vault.waitForDeployment(),
        tradeSettlement.waitForDeployment(),
      ]);

      await expect(
        ledger.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(ledger, "OwnershipRenunciationNotReady");
      await ledger.connect(owner).bindAVSToken(await token.getAddress());
      await expect(
        ledger.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(ledger, "OwnershipRenunciationNotReady");
      await ledger.connect(owner).configureVault(await vault.getAddress());
      await expect(
        ledger.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(ledger, "OwnershipRenunciationNotReady");
      await ledger
        .connect(owner)
        .configureTradeSettlement(await tradeSettlement.getAddress());
    });

    it("renounces owner authority irreversibly while protocol sources continue operating", async function () {
      const { ledger, owner, outsider, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      const beneficiary = await owner.getAddress();
      const historicalCapitalId = id("pre-renunciation-capital");
      const historicalSettlementId = id("pre-renunciation-settlement");
      const capitalId = id("post-renunciation-capital");
      const settlementId = id("post-renunciation-settlement");
      await recordCapital(
        vault,
        ledger,
        historicalCapitalId,
        100n * SCALE,
        beneficiary,
      );
      await token.mint(await ledger.getAddress(), 100n * SCALE);
      await recordSettlement(
        tradeSettlement,
        ledger,
        historicalSettlementId,
        10n * SCALE,
      );
      const assetsBefore = await ledger.totalNetAssets();
      const grossProfitBefore = await ledger.totalGrossProfit();
      const lossBefore = await ledger.totalLoss();
      const allocatedBefore = await ledger.totalBuybackAllocated();
      const reserveBefore = await ledger.buybackReserve();
      const tokenBefore = await ledger.avsToken();
      const vaultBefore = await ledger.vault();
      const settlementSourceBefore = await ledger.tradeSettlement();
      const capitalRecordBefore =
        await ledger.capitalRecord(historicalCapitalId);
      const settlementRecordBefore = await ledger.settlementRecord(
        historicalSettlementId,
      );

      await expect(ledger.connect(outsider).renounceOwnership())
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(ledger.connect(owner).renounceOwnership())
        .to.emit(ledger, "OwnershipRenounced")
        .withArgs(await owner.getAddress());

      expect(await ledger.owner()).to.equal(ethers.ZeroAddress);
      expect(await ledger.totalNetAssets()).to.equal(assetsBefore);
      expect(await ledger.totalGrossProfit()).to.equal(grossProfitBefore);
      expect(await ledger.totalLoss()).to.equal(lossBefore);
      expect(await ledger.totalBuybackAllocated()).to.equal(allocatedBefore);
      expect(await ledger.buybackReserve()).to.equal(reserveBefore);
      expect(await ledger.avsToken()).to.equal(tokenBefore);
      expect(await ledger.vault()).to.equal(vaultBefore);
      expect(await ledger.tradeSettlement()).to.equal(settlementSourceBefore);
      expect(await ledger.currentAVSValue()).to.equal(
        1_090_000_000_000_000_000n,
      );
      expect(await ledger.ACCOUNTING_SCALE()).to.equal(SCALE);
      expect(await ledger.POSITIVE_PNL_BUYBACK_BPS()).to.equal(1_000n);
      expect(await ledger.BASIS_POINTS()).to.equal(10_000n);
      expect(await ledger.avsTokenName()).to.equal("Ledger Token Mock");
      expect(await ledger.settlementCount()).to.equal(1n);
      const quoteAfterRenunciation =
        (10n * SCALE * 100n * SCALE) / (109n * SCALE);
      expect(await ledger.quoteCapitalInflow(10n * SCALE)).to.equal(
        quoteAfterRenunciation,
      );
      expect(await ledger.calculateSharesForCapital(10n * SCALE)).to.equal(
        quoteAfterRenunciation,
      );
      const capitalRecordAfter =
        await ledger.capitalRecord(historicalCapitalId);
      expect(capitalRecordAfter.capitalId).to.equal(
        capitalRecordBefore.capitalId,
      );
      expect(capitalRecordAfter.beneficiary).to.equal(
        capitalRecordBefore.beneficiary,
      );
      expect(capitalRecordAfter.capitalAmount).to.equal(
        capitalRecordBefore.capitalAmount,
      );
      expect(capitalRecordAfter.sharesQuoted).to.equal(
        capitalRecordBefore.sharesQuoted,
      );
      expect(capitalRecordAfter.totalSupplyBefore).to.equal(
        capitalRecordBefore.totalSupplyBefore,
      );
      expect(capitalRecordAfter.avsValueBefore).to.equal(
        capitalRecordBefore.avsValueBefore,
      );
      expect(capitalRecordAfter.timestamp).to.equal(
        capitalRecordBefore.timestamp,
      );
      const settlementRecordAfter = await ledger.settlementRecord(
        historicalSettlementId,
      );
      expect(settlementRecordAfter.settlementId).to.equal(
        settlementRecordBefore.settlementId,
      );
      expect(settlementRecordAfter.realizedPnL).to.equal(
        settlementRecordBefore.realizedPnL,
      );
      expect(settlementRecordAfter.buybackAllocation).to.equal(
        settlementRecordBefore.buybackAllocation,
      );
      expect(settlementRecordAfter.netEconomicImpact).to.equal(
        settlementRecordBefore.netEconomicImpact,
      );
      expect(settlementRecordAfter.totalSupplyAtSettlement).to.equal(
        settlementRecordBefore.totalSupplyAtSettlement,
      );
      expect(settlementRecordAfter.avsValueBefore).to.equal(
        settlementRecordBefore.avsValueBefore,
      );
      expect(settlementRecordAfter.avsValueAfter).to.equal(
        settlementRecordBefore.avsValueAfter,
      );
      expect(settlementRecordAfter.timestamp).to.equal(
        settlementRecordBefore.timestamp,
      );

      await expect(ledger.connect(owner).renounceOwnership())
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await owner.getAddress());
      await expect(ledger.connect(outsider).configureVault(vaultBefore))
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await outsider.getAddress());

      await recordCapital(vault, ledger, capitalId, SCALE, beneficiary);
      await recordSettlement(tradeSettlement, ledger, settlementId, SCALE);

      expect(await ledger.owner()).to.equal(ethers.ZeroAddress);
      expect(await ledger.totalNetAssets()).to.equal(
        110_900_000_000_000_000_000n,
      );
      expect(await ledger.totalGrossProfit()).to.equal(11n * SCALE);
      expect(await ledger.totalBuybackAllocated()).to.equal(
        1_100_000_000_000_000_000n,
      );
      expect(await ledger.buybackReserve()).to.equal(
        1_100_000_000_000_000_000n,
      );
      expect(await ledger.totalLoss()).to.equal(0n);
      expect(await ledger.processedCapitalInflow(capitalId)).to.equal(true);
      expect(await ledger.processedSettlement(settlementId)).to.equal(true);
      expect((await ledger.capitalRecord(capitalId)).beneficiary).to.equal(
        beneficiary,
      );
      expect(
        (await ledger.settlementRecord(settlementId)).realizedPnL,
      ).to.equal(SCALE);
      expect(await ledger.getCurrentAVSValue()).to.equal(
        1_109_000_000_000_000_000n,
      );
    });
  });

  describe("capital accounting", function () {
    it("quotes first capital at genesis without recording profit", async function () {
      const { ledger, vault, owner } = await deployConfiguredLedger();
      const amount = 1_250n * SCALE;
      const capitalId = id("genesis-capital");
      const beneficiary = await owner.getAddress();

      expect(await ledger.quoteCapitalInflow(amount)).to.equal(amount);
      await expect(recordCapital(vault, ledger, capitalId, amount, beneficiary))
        .to.emit(ledger, "CapitalInflowRecorded")
        .withArgs(capitalId, beneficiary, amount, amount, 0n, SCALE);

      expect(await ledger.totalNetAssets()).to.equal(amount);
      expect(await ledger.totalGrossProfit()).to.equal(0n);
      expect(await ledger.totalLoss()).to.equal(0n);
      expect(await ledger.totalBuybackAllocated()).to.equal(0n);
      expect(await ledger.buybackReserve()).to.equal(0n);
      expect(await ledger.processedCapitalInflow(capitalId)).to.equal(true);
      expect(await ledger.currentAVSValue()).to.equal(SCALE);
      const record = await ledger.capitalRecord(capitalId);
      expect(record.capitalId).to.equal(capitalId);
      expect(record.beneficiary).to.equal(beneficiary);
      expect(record.capitalAmount).to.equal(amount);
      expect(record.sharesQuoted).to.equal(amount);
      expect(record.totalSupplyBefore).to.equal(0n);
      expect(record.avsValueBefore).to.equal(SCALE);
      expect(record.timestamp).to.be.greaterThan(0n);
    });

    it("quotes at the current value before adding capital and does not dilute holders", async function () {
      const { ledger, token, vault } = await deployConfiguredLedger();
      const initialAssets = 1_250n * SCALE;
      const initialSupply = 1_000n * SCALE;
      await recordCapital(vault, ledger, id("initial"), initialAssets);
      await token.mint(await ledger.getAddress(), initialSupply);

      expect(await ledger.currentAVSValue()).to.equal(
        1_250_000_000_000_000_000n,
      );
      const newCapital = initialAssets;
      expect(await ledger.quoteCapitalInflow(newCapital)).to.equal(
        initialSupply,
      );
      await recordCapital(vault, ledger, id("second"), newCapital);

      expect(await ledger.totalNetAssets()).to.equal(2_500n * SCALE);
      expect(await ledger.totalGrossProfit()).to.equal(0n);
      expect(await ledger.totalBuybackAllocated()).to.equal(0n);
      expect(await ledger.currentAVSValue()).to.equal(
        2_500_000_000_000_000_000n,
      );
      await token.mint(await ledger.getAddress(), initialSupply);
      expect(await ledger.currentAVSValue()).to.equal(
        1_250_000_000_000_000_000n,
      );
    });

    it("rounds capital shares down and rejects replay or zero values", async function () {
      const { ledger, token, vault } = await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("rounding-assets"), 10n * SCALE);
      await token.mint(await ledger.getAddress(), 3n * SCALE);

      expect(await ledger.quoteCapitalInflow(SCALE)).to.equal(
        (3n * SCALE) / 10n,
      );
      expect(await ledger.calculateSharesForCapital(SCALE)).to.equal(
        (3n * SCALE) / 10n,
      );
      await expect(
        recordCapital(vault, ledger, ZERO_ID, SCALE),
      ).to.be.revertedWithCustomError(ledger, "InvalidIdentifier");
      await expect(
        recordCapital(vault, ledger, id("zero"), 0n),
      ).to.be.revertedWithCustomError(ledger, "InvalidAmount");
      await expect(
        recordCapital(
          vault,
          ledger,
          id("zero-beneficiary"),
          SCALE,
          ethers.ZeroAddress,
        ),
      ).to.be.revertedWithCustomError(ledger, "InvalidBeneficiary");

      const capitalId = id("replay");
      await recordCapital(vault, ledger, capitalId, SCALE);
      await expect(recordCapital(vault, ledger, capitalId, SCALE))
        .to.be.revertedWithCustomError(ledger, "AlreadyProcessed")
        .withArgs(capitalId);
    });

    it("rejects capital calls from unauthorized accounts", async function () {
      const { ledger, outsider } = await deployConfiguredLedger();

      await expect(
        ledger
          .connect(outsider)
          .recordCapitalInflow(
            id("outsider"),
            await outsider.getAddress(),
            SCALE,
          ),
      )
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await outsider.getAddress());
    });

    it("guards capital overflow and leaves the failed identifier unused", async function () {
      const { ledger, vault } = await deployConfiguredLedger();
      await recordCapital(
        vault,
        ledger,
        id("near-maximum-assets"),
        ethers.MaxUint256 - 1n,
      );
      const overflowId = id("capital-overflow");

      await expect(
        recordCapital(vault, ledger, overflowId, 2n),
      ).to.be.revertedWithCustomError(ledger, "ArithmeticOverflow");
      expect(await ledger.totalNetAssets()).to.equal(ethers.MaxUint256 - 1n);
      expect(await ledger.processedCapitalInflow(overflowId)).to.equal(false);
    });
  });

  describe("protocol revenue accounting", function () {
    it("rejects revenue before an active AVS supply exists", async function () {
      const { ledger, vault } = await deployConfiguredLedger();
      const revenueId = id("pre-supply-protocol-revenue");

      await expect(
        recordProtocolRevenue(vault, ledger, revenueId, SCALE),
      ).to.be.revertedWithCustomError(ledger, "NoActiveEconomicSupply");
      expect(await ledger.totalNetAssets()).to.equal(0n);
      expect(await ledger.processedProtocolRevenue(revenueId)).to.equal(false);
      expect(
        (await ledger.protocolRevenueRecord(revenueId)).revenueId,
      ).to.equal(ZERO_ID);
    });

    it("increases NAV exactly once without minting or changing trading totals", async function () {
      const { ledger, token, vault } = await deployConfiguredLedger();
      const initialAssets = 1_000n * SCALE;
      const revenue = 100n * SCALE;
      const revenueId = id("marketplace-fees");
      await recordCapital(
        vault,
        ledger,
        id("protocol-revenue-assets"),
        initialAssets,
      );
      await token.mint(await ledger.getAddress(), initialAssets);
      const supplyBefore = await token.totalSupply();
      const timestampBefore = (await ethers.provider.getBlock("latest"))!
        .timestamp;

      await expect(recordProtocolRevenue(vault, ledger, revenueId, revenue))
        .to.emit(ledger, "ProtocolRevenueRecorded")
        .withArgs(
          revenueId,
          revenue,
          supplyBefore,
          SCALE,
          1_100_000_000_000_000_000n,
          anyValue,
        );

      expect(await ledger.totalNetAssets()).to.equal(initialAssets + revenue);
      expect(await ledger.totalGrossProfit()).to.equal(0n);
      expect(await ledger.totalLoss()).to.equal(0n);
      expect(await ledger.totalBuybackAllocated()).to.equal(0n);
      expect(await ledger.buybackReserve()).to.equal(0n);
      expect(await token.totalSupply()).to.equal(supplyBefore);
      expect(await ledger.processedProtocolRevenue(revenueId)).to.equal(true);

      const record = await ledger.protocolRevenueRecord(revenueId);
      expect(record.revenueId).to.equal(revenueId);
      expect(record.amount).to.equal(revenue);
      expect(record.totalSupplyAtRecord).to.equal(supplyBefore);
      expect(record.avsValueBefore).to.equal(SCALE);
      expect(record.avsValueAfter).to.equal(1_100_000_000_000_000_000n);
      expect(record.timestamp).to.be.greaterThan(BigInt(timestampBefore));
    });

    it("rejects unauthorized, zero, duplicate, and overflowing revenue atomically", async function () {
      const { ledger, token, vault, outsider } = await deployConfiguredLedger();
      const revenueId = id("unique-protocol-revenue");
      await token.mint(await ledger.getAddress(), SCALE);

      await expect(
        ledger.connect(outsider).recordProtocolRevenue(revenueId, SCALE),
      )
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(
        recordProtocolRevenue(vault, ledger, ZERO_ID, SCALE),
      ).to.be.revertedWithCustomError(ledger, "InvalidIdentifier");
      await expect(
        recordProtocolRevenue(vault, ledger, revenueId, 0n),
      ).to.be.revertedWithCustomError(ledger, "InvalidAmount");

      await recordProtocolRevenue(vault, ledger, revenueId, SCALE);
      await expect(recordProtocolRevenue(vault, ledger, revenueId, SCALE))
        .to.be.revertedWithCustomError(ledger, "AlreadyProcessed")
        .withArgs(revenueId);
      expect(await ledger.totalNetAssets()).to.equal(SCALE);

      const overflowId = id("protocol-revenue-overflow");
      const remaining = ethers.MaxUint256 - SCALE;
      await recordProtocolRevenue(
        vault,
        ledger,
        id("near-max-revenue"),
        remaining,
      );
      await expect(
        recordProtocolRevenue(vault, ledger, overflowId, 1n),
      ).to.be.revertedWithCustomError(ledger, "ArithmeticOverflow");
      expect(await ledger.processedProtocolRevenue(overflowId)).to.equal(false);
      expect(
        (await ledger.protocolRevenueRecord(overflowId)).revenueId,
      ).to.equal(ZERO_ID);
    });
  });

  describe("trading settlement accounting", function () {
    it("rejects settlement when the bound token has zero supply", async function () {
      const { ledger, tradeSettlement } = await deployConfiguredLedger();

      await expect(
        recordSettlement(
          tradeSettlement,
          ledger,
          id("zero-supply-settlement"),
          SCALE,
        ),
      ).to.be.revertedWithCustomError(ledger, "NoActiveEconomicSupply");
      expect(await ledger.totalNetAssets()).to.equal(0n);
      expect(await ledger.settlementCount()).to.equal(0n);
    });

    it("rejects settlement when supply exists but economic assets are zero", async function () {
      const { ledger, token, tradeSettlement } = await deployConfiguredLedger();
      await token.mint(await ledger.getAddress(), SCALE);

      await expect(
        recordSettlement(
          tradeSettlement,
          ledger,
          id("zero-nav-settlement"),
          SCALE,
        ),
      ).to.be.revertedWithCustomError(ledger, "NoActiveEconomicSupply");
      expect(await ledger.totalNetAssets()).to.equal(0n);
      expect(await ledger.settlementCount()).to.equal(0n);
    });

    it("allocates positive PnL as exactly 10% reserve and 90% economic assets", async function () {
      const { ledger, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("assets"), 1_000n * SCALE);
      await token.mint(await ledger.getAddress(), 1_000n * SCALE);

      const profit = 100n * SCALE;
      const settlementId = id("profit");
      await expect(
        recordSettlement(tradeSettlement, ledger, settlementId, profit),
      )
        .to.emit(ledger, "TradingSettlementRecorded")
        .withArgs(
          settlementId,
          profit,
          10n * SCALE,
          90n * SCALE,
          1_000n * SCALE,
          SCALE,
          1_090_000_000_000_000_000n,
          anyValue,
        );

      expect(await ledger.totalNetAssets()).to.equal(1_090n * SCALE);
      expect(await ledger.totalGrossProfit()).to.equal(profit);
      expect(await ledger.totalBuybackAllocated()).to.equal(10n * SCALE);
      expect(await ledger.buybackReserve()).to.equal(10n * SCALE);
      const record = await ledger.settlementRecord(settlementId);
      expect(record.realizedPnL).to.equal(profit);
      expect(record.buybackAllocation).to.equal(10n * SCALE);
      expect(record.netEconomicImpact).to.equal(90n * SCALE);
      expect(record.totalSupplyAtSettlement).to.equal(1_000n * SCALE);
      expect(record.avsValueBefore).to.equal(SCALE);
      expect(record.avsValueAfter).to.equal(1_090_000_000_000_000_000n);
    });

    it("applies negative PnL entirely to assets with no reserve allocation", async function () {
      const { ledger, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("assets"), 1_000n * SCALE);
      await token.mint(await ledger.getAddress(), 100n * SCALE);

      const profit = 100n * SCALE;
      await recordSettlement(
        tradeSettlement,
        ledger,
        id("profit-before-loss"),
        profit,
      );
      const loss = 25n * SCALE;
      const settlementId = id("loss");
      await recordSettlement(tradeSettlement, ledger, settlementId, -loss);

      expect(await ledger.totalNetAssets()).to.equal(1_065n * SCALE);
      expect(await ledger.totalGrossProfit()).to.equal(profit);
      expect(await ledger.totalLoss()).to.equal(loss);
      expect(await ledger.totalBuybackAllocated()).to.equal(10n * SCALE);
      expect(await ledger.buybackReserve()).to.equal(10n * SCALE);
      const record = await ledger.settlementRecord(settlementId);
      expect(record.buybackAllocation).to.equal(0n);
      expect(record.netEconomicImpact).to.equal(-loss);
    });

    it("rounds positive-PnL reserve down without losing an accounting unit", async function () {
      const { ledger, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("dust-assets"), 100n);
      await token.mint(await ledger.getAddress(), 100n);

      await recordSettlement(tradeSettlement, ledger, id("dust-profit"), 11n);

      expect(await ledger.totalGrossProfit()).to.equal(11n);
      expect(await ledger.totalBuybackAllocated()).to.equal(1n);
      expect(await ledger.buybackReserve()).to.equal(1n);
      expect(await ledger.totalNetAssets()).to.equal(110n);
      const record = await ledger.settlementRecord(id("dust-profit"));
      expect(record.buybackAllocation).to.equal(1n);
      expect(record.netEconomicImpact).to.equal(10n);
    });

    it("rejects unauthorized, duplicate, zero, and loss-boundary violations", async function () {
      const { ledger, token, vault, tradeSettlement, outsider } =
        await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("assets"), 100n * SCALE);
      await token.mint(await ledger.getAddress(), SCALE);

      const settlementId = id("authorized");
      await expect(
        ledger.connect(outsider).recordTradingSettlement(settlementId, SCALE),
      )
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(
        recordSettlement(tradeSettlement, ledger, ZERO_ID, SCALE),
      ).to.be.revertedWithCustomError(ledger, "InvalidIdentifier");
      await expect(
        recordSettlement(tradeSettlement, ledger, id("zero-pnl"), 0n),
      ).to.be.revertedWithCustomError(ledger, "InvalidAmount");
      await expect(
        recordSettlement(
          tradeSettlement,
          ledger,
          id("too-much-loss"),
          -101n * SCALE,
        ),
      )
        .to.be.revertedWithCustomError(ledger, "LossExceedsEconomicAssets")
        .withArgs(100n * SCALE, 101n * SCALE);

      await recordSettlement(tradeSettlement, ledger, settlementId, SCALE);
      const recordBeforeReplay = await ledger.settlementRecord(settlementId);
      await expect(
        recordSettlement(tradeSettlement, ledger, settlementId, SCALE),
      )
        .to.be.revertedWithCustomError(ledger, "AlreadyProcessed")
        .withArgs(settlementId);
      const recordAfterReplay = await ledger.settlementRecord(settlementId);
      expect(recordAfterReplay.settlementId).to.equal(
        recordBeforeReplay.settlementId,
      );
      expect(recordAfterReplay.realizedPnL).to.equal(
        recordBeforeReplay.realizedPnL,
      );
      expect(recordAfterReplay.timestamp).to.equal(
        recordBeforeReplay.timestamp,
      );
    });

    it("rejects an unconfigured deployed-source impostor", async function () {
      const { ledger } = await deployConfiguredLedger();
      const impostor = await ethers.deployContract("LedgerSourceMock");
      await impostor.waitForDeployment();

      await expect(recordSettlement(impostor, ledger, id("impostor"), SCALE))
        .to.be.revertedWithCustomError(ledger, "Unauthorized")
        .withArgs(await impostor.getAddress());
    });

    it("handles INT256_MIN as a bounded loss and preserves state on rejection", async function () {
      const { ledger, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("minimum-int-assets"), SCALE);
      await token.mint(await ledger.getAddress(), SCALE);
      const settlementId = id("minimum-int-loss");
      const minimumInt256 = -(2n ** 255n);

      await expect(
        recordSettlement(tradeSettlement, ledger, settlementId, minimumInt256),
      )
        .to.be.revertedWithCustomError(ledger, "LossExceedsEconomicAssets")
        .withArgs(SCALE, 2n ** 255n);
      expect(await ledger.totalNetAssets()).to.equal(SCALE);
      expect(await ledger.totalLoss()).to.equal(0n);
      expect(await ledger.processedSettlement(settlementId)).to.equal(false);
      expect(await ledger.settlementCount()).to.equal(0n);
      expect(
        (await ledger.settlementRecord(settlementId)).settlementId,
      ).to.equal(ZERO_ID);
    });

    it("supports large values and guards arithmetic overflow", async function () {
      const { ledger, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      const largeAssets = ethers.MaxUint256 - 1n;
      await recordCapital(vault, ledger, id("large-assets"), largeAssets);
      await token.mint(await ledger.getAddress(), 2n ** 254n);

      expect(await ledger.quoteCapitalInflow(8n)).to.equal(2n);
      await expect(
        recordSettlement(
          tradeSettlement,
          ledger,
          id("overflow"),
          2n ** 255n - 1n,
        ),
      ).to.be.revertedWithCustomError(ledger, "ArithmeticOverflow");
    });

    it("accepts int256.max positive PnL without losing allocation units", async function () {
      const { ledger, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("max-profit-assets"), SCALE);
      await token.mint(await ledger.getAddress(), SCALE);
      const maximumProfit = 2n ** 255n - 1n;

      await recordSettlement(
        tradeSettlement,
        ledger,
        id("maximum-profit"),
        maximumProfit,
      );

      const expectedBuyback = maximumProfit / 10n;
      expect(await ledger.totalGrossProfit()).to.equal(maximumProfit);
      expect(await ledger.totalBuybackAllocated()).to.equal(expectedBuyback);
      expect(await ledger.buybackReserve()).to.equal(expectedBuyback);
      expect(await ledger.totalNetAssets()).to.equal(
        SCALE + maximumProfit - expectedBuyback,
      );
    });

    it("allows an exact full loss and leaves a zero-value positive-supply state", async function () {
      const { ledger, token, vault, tradeSettlement } =
        await deployConfiguredLedger();
      await recordCapital(vault, ledger, id("exact-loss-assets"), 50n * SCALE);
      await token.mint(await ledger.getAddress(), SCALE);
      await recordSettlement(
        tradeSettlement,
        ledger,
        id("exact-loss"),
        -50n * SCALE,
      );

      expect(await ledger.totalNetAssets()).to.equal(0n);
      expect(await ledger.currentAVSValue()).to.equal(0n);
      await expect(
        ledger.quoteCapitalInflow(SCALE),
      ).to.be.revertedWithCustomError(ledger, "ZeroNAVWithExistingSupply");
      const zeroNavCapitalId = id("zero-nav-capital");
      await expect(
        recordCapital(vault, ledger, zeroNavCapitalId, SCALE),
      ).to.be.revertedWithCustomError(ledger, "ZeroNAVWithExistingSupply");
      expect(await ledger.processedCapitalInflow(zeroNavCapitalId)).to.equal(
        false,
      );
      expect((await ledger.capitalRecord(zeroNavCapitalId)).capitalId).to.equal(
        ZERO_ID,
      );
    });
  });

  it("has no generic economic setters or token-control functions", async function () {
    const { ledger } = await deployLedger();
    const functionNames = ledger.interface.fragments
      .filter((fragment) => fragment.type === "function")
      .map((fragment) => fragment.name);

    expect(functionNames).to.include("renounceOwnership");
    for (const forbidden of [
      "setAVSValue",
      "setNetAssets",
      "setTotalGrossProfit",
      "setTotalLoss",
      "setTotalBuybackAllocated",
      "setBuybackReserve",
      "transferOwnership",
      "nominateOwner",
      "acceptOwnership",
      "recoverOwnership",
      "governanceRecovery",
      "totalProfit",
      "mint",
      "burn",
      "transfer",
      "pause",
      "seize",
    ]) {
      expect(functionNames).not.to.include(forbidden);
    }
  });
});
