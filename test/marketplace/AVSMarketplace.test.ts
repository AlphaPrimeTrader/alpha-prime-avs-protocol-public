import { expect } from "chai";
import { network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

const { ethers } = await network.create();

const SCALE = 10n ** 18n;
const BPS = 10_000n;
const FEE_BPS = 2n;

function fee(amount: bigint): bigint {
  return (amount * FEE_BPS) / BPS;
}

async function deployMarketplace(options?: {
  maxSupply?: bigint;
  sellerOneAVS?: bigint;
  sellerTwoAVS?: bigint;
}) {
  const [
    owner,
    buyerOne,
    buyerTwo,
    sellerOne,
    sellerTwo,
    liquidityProvider,
    outsider,
  ] = await ethers.getSigners();
  const usdt = await ethers.deployContract("MockERC20");
  const ledger = await ethers.deployContract("MarketplaceLedgerMock");
  const token = await ethers.deployContract("MarketplaceTokenMock", [
    options?.maxSupply ?? 1_000_000n * SCALE,
  ]);
  const vault = await ethers.deployContract("MarketplaceVaultMock", [
    await usdt.getAddress(),
    await token.getAddress(),
    await ledger.getAddress(),
  ]);
  const settlementHook = await ethers.deployContract(
    "MarketplaceSettlementHookMock",
  );
  await Promise.all([
    usdt.waitForDeployment(),
    ledger.waitForDeployment(),
    token.waitForDeployment(),
    vault.waitForDeployment(),
    settlementHook.waitForDeployment(),
  ]);

  const marketplace = await ethers.deployContract("AVSMarketplace", [
    await owner.getAddress(),
    await usdt.getAddress(),
    await token.getAddress(),
    await ledger.getAddress(),
    await vault.getAddress(),
    await settlementHook.getAddress(),
  ]);
  await marketplace.waitForDeployment();

  const fundedUSDT = 1_000_000n * SCALE;
  for (const account of [buyerOne, buyerTwo, liquidityProvider]) {
    await usdt.mint(await account.getAddress(), fundedUSDT);
    await usdt
      .connect(account)
      .approve(await marketplace.getAddress(), ethers.MaxUint256);
  }
  await usdt
    .connect(liquidityProvider)
    .approve(await vault.getAddress(), ethers.MaxUint256);

  const sellerOneAVS = options?.sellerOneAVS ?? 1_000n * SCALE;
  const sellerTwoAVS = options?.sellerTwoAVS ?? 1_000n * SCALE;
  if (sellerOneAVS !== 0n) {
    await token.mint(await sellerOne.getAddress(), sellerOneAVS);
  }
  if (sellerTwoAVS !== 0n) {
    await token.mint(await sellerTwo.getAddress(), sellerTwoAVS);
  }
  for (const account of [sellerOne, sellerTwo]) {
    await token
      .connect(account)
      .approve(await marketplace.getAddress(), ethers.MaxUint256);
  }

  return {
    owner,
    buyerOne,
    buyerTwo,
    sellerOne,
    sellerTwo,
    liquidityProvider,
    outsider,
    usdt,
    ledger,
    token,
    vault,
    settlementHook,
    marketplace,
  };
}

async function allocateProtocolLiquidity(
  fixture: Awaited<ReturnType<typeof deployMarketplace>>,
  liquidity: bigint,
  label: string,
) {
  const { liquidityProvider, vault, marketplace } = fixture;
  const capital = liquidity * 20n;
  await vault
    .connect(liquidityProvider)
    .receiveMarketplaceCapital(
      ethers.id(label),
      await liquidityProvider.getAddress(),
      capital,
    );
  await marketplace.syncProtocolLiquidity();
}

describe("AVSMarketplace Phase 4E", function () {
  describe("configuration and authority", function () {
    it("starts with the fixed fee and bounded Testnet defaults", async function () {
      const { marketplace } = await deployMarketplace();
      expect(await marketplace.BUYER_FEE_BPS()).to.equal(2n);
      expect(await marketplace.SELLER_FEE_BPS()).to.equal(2n);
      expect(await marketplace.liquidityAllocationBps()).to.equal(500n);
      expect(await marketplace.maxMatchesPerCall()).to.equal(16n);
      expect(await marketplace.maxScansPerCall()).to.equal(64n);
    });

    it("restricts operational parameters and settlement execution", async function () {
      const { outsider, marketplace } = await deployMarketplace();
      await expect(marketplace.connect(outsider).setParameters(4, 16))
        .to.be.revertedWithCustomError(marketplace, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(
        marketplace.setParameters(0, 16),
      ).to.be.revertedWithCustomError(marketplace, "InvalidParameter");
      await expect(marketplace.connect(outsider).processAfterSettlement(1))
        .to.be.revertedWithCustomError(marketplace, "Unauthorized")
        .withArgs(await outsider.getAddress());
    });

    it("exposes no arbitrary liquidity funding or owner withdrawal path", async function () {
      const { owner, outsider, usdt, marketplace } = await deployMarketplace();
      expect(await usdt.balanceOf(await owner.getAddress())).to.equal(0n);
      expect(
        marketplace.interface.hasFunction("depositProtocolLiquidity"),
      ).to.equal(false);
      expect(
        marketplace.interface.hasFunction("recordProtocolLiquidity"),
      ).to.equal(false);
      await marketplace.connect(outsider).syncProtocolLiquidity();
      expect(await marketplace.protocolLiquidityUSDT()).to.equal(0n);
      expect(marketplace.interface.hasFunction("withdraw")).to.equal(false);
      expect(marketplace.interface.hasFunction("rescue")).to.equal(false);
    });
  });

  describe("official NAV and primary issuance", function () {
    it("uses Ledger NAV and routes real capital plus buyer fee through the Vault", async function () {
      const { buyerOne, usdt, ledger, token, vault, marketplace } =
        await deployMarketplace();
      await ledger.setCurrentAVSValue(2n * SCALE);
      const quantity = 40n * SCALE;
      const gross = 80n * SCALE;
      const buyerFee = fee(gross);
      const beforeUSDT = await usdt.balanceOf(await buyerOne.getAddress());

      await expect(marketplace.connect(buyerOne).placeMarketBuy(quantity, 4))
        .to.emit(marketplace, "PrimaryIssuanceExecuted")
        .withArgs(
          1n,
          await buyerOne.getAddress(),
          anyValue,
          quantity,
          gross,
          2n * SCALE,
          buyerFee,
        );

      expect(await token.balanceOf(await buyerOne.getAddress())).to.equal(
        quantity,
      );
      expect(await usdt.balanceOf(await buyerOne.getAddress())).to.equal(
        beforeUSDT - gross - buyerFee,
      );
      expect(await vault.capitalReceived()).to.equal(gross);
      expect(await vault.revenueReceived()).to.equal(buyerFee);
      expect(await marketplace.buyerEscrowUSDT()).to.equal(0n);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("caps primary issuance at MAX_SUPPLY and refunds a market remainder", async function () {
      const fixture = await deployMarketplace({
        maxSupply: 100n * SCALE,
        sellerOneAVS: 99n * SCALE,
        sellerTwoAVS: 0n,
      });
      const { buyerOne, usdt, token, marketplace } = fixture;
      const before = await usdt.balanceOf(await buyerOne.getAddress());
      await marketplace.connect(buyerOne).placeMarketBuy(10n * SCALE, 4);

      expect(await token.totalSupply()).to.equal(100n * SCALE);
      expect(await token.balanceOf(await buyerOne.getAddress())).to.equal(
        SCALE,
      );
      expect(await usdt.balanceOf(await buyerOne.getAddress())).to.equal(
        before - SCALE - fee(SCALE),
      );
      expect((await marketplace.orders(1)).status).to.equal(2n);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("keeps an inactive triggered buy escrowed and refunds it exactly", async function () {
      const { buyerOne, usdt, ledger, marketplace } = await deployMarketplace();
      await ledger.setCurrentAVSValue(2n * SCALE);
      const quantity = 10n * SCALE;
      const trigger = SCALE;
      const escrow = quantity + fee(quantity);
      const before = await usdt.balanceOf(await buyerOne.getAddress());

      await marketplace
        .connect(buyerOne)
        .placeTriggeredBuy(quantity, trigger, 1);
      expect(await marketplace.buyerEscrowUSDT()).to.equal(escrow);
      expect(await usdt.balanceOf(await buyerOne.getAddress())).to.equal(
        before - escrow,
      );
      await marketplace.connect(buyerOne).cancelOrder(1);
      expect(await marketplace.buyerEscrowUSDT()).to.equal(0n);
      expect(await usdt.balanceOf(await buyerOne.getAddress())).to.equal(
        before,
      );
    });
  });

  describe("approved buy-side source priority", function () {
    it("routes Inventory -> User SELL -> Primary and preserves mixed accounting", async function () {
      const fixture = await deployMarketplace({
        sellerOneAVS: 6_000n * SCALE,
        sellerTwoAVS: 400n * SCALE,
      });
      const {
        buyerOne,
        buyerTwo,
        sellerOne,
        sellerTwo,
        token,
        vault,
        marketplace,
      } = fixture;
      await marketplace.setParameters(8, 32);
      await allocateProtocolLiquidity(
        fixture,
        1_000n * SCALE,
        "routing-capital",
      );
      const capitalBeforeBuy = await vault.capitalReceived();

      await marketplace.connect(sellerOne).placeMarketSell(300n * SCALE, 8);
      expect(await marketplace.protocolInventoryAVS()).to.equal(300n * SCALE);
      await marketplace.setParameters(8, 32);
      await marketplace
        .connect(sellerTwo)
        .placeTriggeredSell(400n * SCALE, SCALE, 8);

      const supplyBefore = await token.totalSupply();
      const receipt = await (
        await marketplace.connect(buyerOne).placeMarketBuy(1_000n * SCALE, 8)
      ).wait();
      const sourceEvents = receipt!.logs
        .map((log) => {
          try {
            return marketplace.interface.parseLog(log)?.name;
          } catch {
            return undefined;
          }
        })
        .filter((name) =>
          [
            "ProtocolInventorySold",
            "SecondaryTradeExecuted",
            "PrimaryIssuanceExecuted",
          ].includes(name ?? ""),
        );

      expect(sourceEvents).to.deep.equal([
        "ProtocolInventorySold",
        "SecondaryTradeExecuted",
        "PrimaryIssuanceExecuted",
      ]);
      expect(await marketplace.protocolInventoryAVS()).to.equal(0n);
      expect((await marketplace.orders(2)).status).to.equal(1n);
      expect(await token.balanceOf(await buyerOne.getAddress())).to.equal(
        1_000n * SCALE,
      );
      expect(await token.totalSupply()).to.equal(supplyBefore + 300n * SCALE);
      expect(await vault.capitalReceived()).to.equal(
        capitalBeforeBuy + 300n * SCALE,
      );

      await marketplace
        .connect(buyerTwo)
        .placeTriggeredBuy(5n * SCALE, SCALE / 2n, 2);
      await marketplace.connect(buyerTwo).cancelOrder(4);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });
  });

  describe("secondary matching, FIFO, and refunds", function () {
    it("preserves FIFO and leaves the later same-trigger order partially filled", async function () {
      const { buyerOne, sellerOne, sellerTwo, token, marketplace } =
        await deployMarketplace({
          sellerOneAVS: 60n * SCALE,
          sellerTwoAVS: 60n * SCALE,
        });
      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(60n * SCALE, SCALE, 1);
      await marketplace
        .connect(sellerTwo)
        .placeTriggeredSell(60n * SCALE, SCALE, 1);
      await marketplace.connect(buyerOne).placeMarketBuy(100n * SCALE, 4);

      expect((await marketplace.orders(1)).status).to.equal(1n);
      expect((await marketplace.orders(2)).status).to.equal(0n);
      expect((await marketplace.orders(2)).remainingAVS).to.equal(20n * SCALE);
      expect(await token.balanceOf(await buyerOne.getAddress())).to.equal(
        100n * SCALE,
      );
      expect(await marketplace.userEscrowAVS()).to.equal(20n * SCALE);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("does not let a newly submitted buy jump an older eligible buy", async function () {
      const fixture = await deployMarketplace({
        maxSupply: 100n * SCALE,
        sellerOneAVS: 2n * SCALE,
        sellerTwoAVS: 0n,
      });
      const { owner, buyerOne, buyerTwo, sellerOne, token, marketplace } =
        fixture;
      await token.mint(await owner.getAddress(), 98n * SCALE);
      await marketplace.setParameters(1, 8);

      await marketplace.connect(buyerOne).placeTriggeredBuy(SCALE, SCALE, 1);
      await marketplace.connect(buyerTwo).placeTriggeredBuy(SCALE, SCALE, 1);
      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(2n * SCALE, SCALE, 1);
      expect((await marketplace.orders(1)).status).to.equal(1n);
      expect((await marketplace.orders(2)).status).to.equal(0n);
      expect((await marketplace.orders(3)).remainingAVS).to.equal(SCALE);

      await marketplace.connect(buyerOne).placeTriggeredBuy(SCALE, SCALE, 1);
      expect((await marketplace.orders(2)).status).to.equal(1n);
      expect((await marketplace.orders(4)).status).to.equal(0n);
      expect(await token.balanceOf(await buyerTwo.getAddress())).to.equal(
        SCALE,
      );
      expect(await token.balanceOf(await buyerOne.getAddress())).to.equal(
        SCALE,
      );
    });

    it("charges 2 BPS to each secondary side and records both as revenue", async function () {
      const { buyerOne, sellerOne, usdt, vault, marketplace } =
        await deployMarketplace();
      const quantity = 100n * SCALE;
      const gross = quantity;
      const sideFee = fee(gross);
      const sellerBefore = await usdt.balanceOf(await sellerOne.getAddress());

      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(quantity, SCALE, 1);
      await marketplace.connect(buyerOne).placeMarketBuy(quantity, 2);

      expect(await usdt.balanceOf(await sellerOne.getAddress())).to.equal(
        sellerBefore + gross - sideFee,
      );
      expect(await vault.revenueReceived()).to.equal(sideFee * 2n);
      expect(await marketplace.totalFeesCollected()).to.equal(sideFee * 2n);
    });

    it("returns sell escrow exactly on cancellation", async function () {
      const { sellerOne, token, marketplace } = await deployMarketplace();
      const before = await token.balanceOf(await sellerOne.getAddress());
      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(25n * SCALE, 2n * SCALE, 1);
      expect(await marketplace.userEscrowAVS()).to.equal(25n * SCALE);
      await marketplace.connect(sellerOne).cancelOrder(1);
      expect(await token.balanceOf(await sellerOne.getAddress())).to.equal(
        before,
      );
      expect(await marketplace.userEscrowAVS()).to.equal(0n);
    });

    it("executes triggered orders at current NAV rather than trigger NAV", async function () {
      const fixture = await deployMarketplace({
        maxSupply: 100n * SCALE,
        sellerOneAVS: 10n * SCALE,
        sellerTwoAVS: 0n,
      });
      const {
        owner,
        buyerOne,
        sellerOne,
        usdt,
        ledger,
        token,
        settlementHook,
        marketplace,
      } = fixture;
      await token.mint(await owner.getAddress(), 90n * SCALE);
      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(10n * SCALE, 2n * SCALE, 1);
      await marketplace
        .connect(buyerOne)
        .placeTriggeredBuy(10n * SCALE, 2n * SCALE, 1);
      const sellerBefore = await usdt.balanceOf(await sellerOne.getAddress());
      await ledger.setCurrentAVSValue(2n * SCALE);
      await settlementHook.process(await marketplace.getAddress(), 1);

      const gross = 20n * SCALE;
      expect(await usdt.balanceOf(await sellerOne.getAddress())).to.equal(
        sellerBefore + gross - fee(gross),
      );
      expect(await token.balanceOf(await buyerOne.getAddress())).to.equal(
        10n * SCALE,
      );
    });

    it("settles mintable primary shares and cancels fractional NAV dust without reverting", async function () {
      const { buyerOne, ledger, token, marketplace } =
        await deployMarketplace();
      await ledger.setCurrentAVSValue((3n * SCALE) / 2n);

      await marketplace.connect(buyerOne).placeMarketBuy(SCALE + 1n, 4);
      expect(await token.balanceOf(await buyerOne.getAddress())).to.equal(
        SCALE,
      );
      expect((await marketplace.orders(1)).status).to.equal(2n);
      expect(await marketplace.buyerEscrowUSDT()).to.equal(0n);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });
  });

  describe("protocol liquidity and inventory", function () {
    it("applies the exact $5 threshold and $3,000 daily value cap without carry-forward", async function () {
      const belowThreshold = await deployMarketplace({
        sellerOneAVS: 99n * SCALE,
        sellerTwoAVS: 0n,
      });
      await allocateProtocolLiquidity(
        belowThreshold,
        10n * SCALE,
        "below-threshold-capital",
      );
      await belowThreshold.marketplace
        .connect(belowThreshold.sellerOne)
        .placeMarketSell(20n * SCALE, 4);
      expect(await belowThreshold.marketplace.protocolInventoryAVS()).to.equal(
        0n,
      );

      const exactThreshold = await deployMarketplace({
        sellerOneAVS: 100n * SCALE,
        sellerTwoAVS: 0n,
      });
      await allocateProtocolLiquidity(
        exactThreshold,
        10n * SCALE,
        "exact-threshold-capital",
      );
      await exactThreshold.marketplace
        .connect(exactThreshold.sellerOne)
        .placeMarketSell(20n * SCALE, 4);
      expect(await exactThreshold.marketplace.protocolInventoryAVS()).to.equal(
        5n * SCALE,
      );

      const capped = await deployMarketplace({
        sellerOneAVS: 100_000n * SCALE,
        sellerTwoAVS: 0n,
      });
      await allocateProtocolLiquidity(
        capped,
        3_100n * SCALE,
        "maximum-capital",
      );
      await capped.marketplace
        .connect(capped.sellerOne)
        .placeMarketSell(5_000n * SCALE, 4);
      expect(await capped.marketplace.protocolInventoryAVS()).to.equal(
        3_000n * SCALE,
      );
      expect(
        (
          await capped.marketplace.dailyProtocolSell(
            await capped.sellerOne.getAddress(),
          )
        ).absorbedValue,
      ).to.equal(3_000n * SCALE);

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      await capped.settlementHook.process(
        await capped.marketplace.getAddress(),
        4,
      );
      expect(
        (
          await capped.marketplace.dailyProtocolSell(
            await capped.sellerOne.getAddress(),
          )
        ).absorbedValue,
      ).to.equal(3_000n * SCALE);
    });

    it("enforces the daily absorption cap and recycles real inventory/liquidity", async function () {
      const fixture = await deployMarketplace({
        sellerOneAVS: 100n * SCALE,
        sellerTwoAVS: 0n,
      });
      const { buyerOne, sellerOne, token, vault, marketplace } = fixture;
      await marketplace.setParameters(4, 16);
      await allocateProtocolLiquidity(
        fixture,
        100n * SCALE,
        "absorption-capital",
      );

      const absorbedGross = 5n * SCALE;
      const sellerFee = fee(absorbedGross);
      await expect(
        marketplace.connect(sellerOne).placeMarketSell(50n * SCALE, 4),
      )
        .to.emit(marketplace, "ProtocolInventoryPurchased")
        .withArgs(
          1n,
          await sellerOne.getAddress(),
          anyValue,
          absorbedGross,
          SCALE,
          absorbedGross,
          0n,
          sellerFee,
        );
      expect(await marketplace.protocolInventoryAVS()).to.equal(absorbedGross);
      expect(
        (await marketplace.dailyProtocolSell(await sellerOne.getAddress()))
          .absorbedValue,
      ).to.equal(absorbedGross);
      expect(await marketplace.protocolLiquidityUSDT()).to.equal(
        100n * SCALE - absorbedGross + sellerFee,
      );

      const supplyBefore = await token.totalSupply();
      const inventoryBuyerFee = fee(absorbedGross);
      await expect(
        marketplace.connect(buyerOne).placeMarketBuy(absorbedGross, 4),
      )
        .to.emit(marketplace, "ProtocolInventorySold")
        .withArgs(
          2n,
          await buyerOne.getAddress(),
          anyValue,
          absorbedGross,
          SCALE,
          absorbedGross,
          inventoryBuyerFee,
          0n,
        );
      expect(await marketplace.protocolInventoryAVS()).to.equal(0n);
      expect(await token.totalSupply()).to.equal(supplyBefore);
      expect(await marketplace.protocolLiquidityUSDT()).to.equal(
        100n * SCALE + sellerFee + inventoryBuyerFee,
      );
      expect(await vault.revenueReceived()).to.equal(
        sellerFee + inventoryBuyerFee,
      );

      await marketplace.connect(sellerOne).placeMarketSell(10n * SCALE, 4);
      expect(await marketplace.protocolInventoryAVS()).to.equal(0n);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("cannot manufacture revenue through repeated protocol inventory cycles", async function () {
      const fixture = await deployMarketplace({
        sellerOneAVS: 200n * SCALE,
        sellerTwoAVS: 0n,
      });
      const { buyerOne, buyerTwo, sellerOne, usdt, vault, marketplace } =
        fixture;
      const firstGross = 10n * SCALE;
      const firstUserSideFee = fee(firstGross);
      const secondGross = (19n * SCALE) / 2n;
      const secondUserSideFee = fee(secondGross);
      const initialLiquidity = 100n * SCALE;
      const sellerBefore = await usdt.balanceOf(await sellerOne.getAddress());
      const buyerOneBefore = await usdt.balanceOf(await buyerOne.getAddress());
      const buyerTwoBefore = await usdt.balanceOf(await buyerTwo.getAddress());

      await marketplace.setParameters(4, 16);
      await allocateProtocolLiquidity(
        fixture,
        initialLiquidity,
        "cycle-capital",
      );

      await marketplace.connect(sellerOne).placeMarketSell(firstGross, 4);
      expect(await marketplace.protocolLiquidityUSDT()).to.equal(
        initialLiquidity - firstGross + firstUserSideFee,
      );
      await marketplace.connect(buyerOne).placeMarketBuy(firstGross, 4);
      expect(await marketplace.protocolLiquidityUSDT()).to.equal(
        initialLiquidity + firstUserSideFee * 2n,
      );

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      await marketplace.connect(sellerOne).placeMarketSell(firstGross, 4);
      expect(await marketplace.protocolLiquidityUSDT()).to.equal(
        initialLiquidity +
          firstUserSideFee * 2n -
          secondGross +
          secondUserSideFee,
      );
      await marketplace.connect(buyerTwo).placeMarketBuy(secondGross, 4);

      expect(await marketplace.protocolLiquidityUSDT()).to.equal(
        initialLiquidity + firstUserSideFee * 2n + secondUserSideFee * 2n,
      );
      expect(await usdt.balanceOf(await sellerOne.getAddress())).to.equal(
        sellerBefore +
          firstGross -
          firstUserSideFee +
          secondGross -
          secondUserSideFee,
      );
      expect(await usdt.balanceOf(await buyerOne.getAddress())).to.equal(
        buyerOneBefore - firstGross - firstUserSideFee,
      );
      expect(await usdt.balanceOf(await buyerTwo.getAddress())).to.equal(
        buyerTwoBefore - secondGross - secondUserSideFee,
      );
      expect(await vault.revenueReceived()).to.equal(
        (firstUserSideFee + secondUserSideFee) * 2n,
      );
      expect(await vault.revenueCount()).to.equal(4n);
      expect(await marketplace.totalFeesCollected()).to.equal(
        (firstUserSideFee + secondUserSideFee) * 2n,
      );
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("skips a capped seller for absorption but keeps it first for a normal buyer", async function () {
      const fixture = await deployMarketplace({
        sellerOneAVS: 100n * SCALE,
        sellerTwoAVS: 100n * SCALE,
      });
      const { buyerOne, sellerOne, sellerTwo, token, vault, marketplace } =
        fixture;
      await marketplace.setParameters(4, 16);
      await allocateProtocolLiquidity(fixture, 100n * SCALE, "skip-capital");
      const capitalBeforeBuy = await vault.capitalReceived();

      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(20n * SCALE, SCALE, 4);
      const olderBeforeSkip = await marketplace.orders(1);
      expect(olderBeforeSkip.remainingAVS).to.equal(15n * SCALE);

      await marketplace
        .connect(sellerTwo)
        .placeTriggeredSell(20n * SCALE, SCALE, 4);
      const olderAfterSkip = await marketplace.orders(1);
      expect((await marketplace.orders(2)).remainingAVS).to.equal(15n * SCALE);
      expect(await marketplace.protocolInventoryAVS()).to.equal(10n * SCALE);
      expect(olderAfterSkip.status).to.equal(0n);
      expect(olderAfterSkip.triggerNAV).to.equal(olderBeforeSkip.triggerNAV);
      expect(olderAfterSkip.remainingAVS).to.equal(
        olderBeforeSkip.remainingAVS,
      );
      expect(olderAfterSkip.createdAt).to.equal(olderBeforeSkip.createdAt);

      const supplyBefore = await token.totalSupply();
      const receipt = await (
        await marketplace.connect(buyerOne).placeMarketBuy(25n * SCALE, 4)
      ).wait();
      const sources = receipt!.logs
        .map((log) => {
          try {
            return marketplace.interface.parseLog(log)?.name;
          } catch {
            return undefined;
          }
        })
        .filter((name) =>
          ["ProtocolInventorySold", "SecondaryTradeExecuted"].includes(
            name ?? "",
          ),
        );
      expect(sources).to.deep.equal([
        "ProtocolInventorySold",
        "SecondaryTradeExecuted",
      ]);
      expect((await marketplace.orders(1)).status).to.equal(1n);
      expect((await marketplace.orders(2)).remainingAVS).to.equal(15n * SCALE);
      expect(await token.totalSupply()).to.equal(supplyBefore);
      expect(await vault.capitalReceived()).to.equal(capitalBeforeBuy);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("renews protocol executability for a resting sell after day rollover", async function () {
      const fixture = await deployMarketplace({
        sellerOneAVS: 200n * SCALE,
        sellerTwoAVS: 0n,
      });
      const { sellerOne, settlementHook, marketplace } = fixture;
      await marketplace.setParameters(4, 16);
      await allocateProtocolLiquidity(
        fixture,
        100n * SCALE,
        "rollover-capital",
      );
      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(20n * SCALE, SCALE, 4);
      const original = await marketplace.orders(1);
      expect(original.remainingAVS).to.equal(10n * SCALE);

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      await settlementHook.process(await marketplace.getAddress(), 4);
      const afterRollover = await marketplace.orders(1);
      expect(afterRollover.remainingAVS).to.equal(SCALE / 2n);
      expect(afterRollover.triggerNAV).to.equal(original.triggerNAV);
      expect(afterRollover.createdAt).to.equal(original.createdAt);
      expect(await marketplace.protocolInventoryAVS()).to.equal(
        19n * SCALE + SCALE / 2n,
      );
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });
  });

  describe("bounded execution and adversarial behavior", function () {
    it("processes one queued match per call and resumes from queue cursors", async function () {
      const fixture = await deployMarketplace({
        maxSupply: 100n * SCALE,
        sellerOneAVS: 3n * SCALE,
        sellerTwoAVS: 3n * SCALE,
      });
      const {
        owner,
        buyerOne,
        buyerTwo,
        sellerOne,
        sellerTwo,
        ledger,
        token,
        settlementHook,
        marketplace,
      } = fixture;
      await token.mint(await owner.getAddress(), 94n * SCALE);
      await marketplace.setParameters(1, 8);
      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(SCALE, 2n * SCALE, 1);
      await marketplace
        .connect(sellerTwo)
        .placeTriggeredSell(SCALE, 2n * SCALE, 1);
      await marketplace
        .connect(buyerOne)
        .placeTriggeredBuy(SCALE, 2n * SCALE, 1);
      await marketplace
        .connect(buyerTwo)
        .placeTriggeredBuy(SCALE, 2n * SCALE, 1);
      await ledger.setCurrentAVSValue(2n * SCALE);

      await settlementHook.process(await marketplace.getAddress(), 1);
      const filledAfterOne = [
        (await marketplace.orders(1)).status,
        (await marketplace.orders(2)).status,
      ].filter((status) => status === 1n).length;
      expect(filledAfterOne).to.equal(1);

      await settlementHook.process(await marketplace.getAddress(), 1);
      expect((await marketplace.orders(1)).status).to.equal(1n);
      expect((await marketplace.orders(2)).status).to.equal(1n);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("blocks an authorized Vault callback from reentering matching", async function () {
      const { buyerOne, sellerOne, vault, marketplace } =
        await deployMarketplace();
      await marketplace.setSettlementHook(await vault.getAddress());
      await vault.configureReentry(await marketplace.getAddress(), true);
      await marketplace
        .connect(sellerOne)
        .placeTriggeredSell(10n * SCALE, SCALE, 1);
      await marketplace.connect(buyerOne).placeMarketBuy(10n * SCALE, 2);
      expect(await vault.reentrySucceeded()).to.equal(false);
      expect(await marketplace.accountingSolvent()).to.equal(true);
    });

    it("rejects fee-on-transfer escrow instead of accepting under-collateralization", async function () {
      const [owner, buyer] = await ethers.getSigners();
      const usdt = await ethers.deployContract("FeeOnTransferMock", [100]);
      const ledger = await ethers.deployContract("MarketplaceLedgerMock");
      const token = await ethers.deployContract("MarketplaceTokenMock", [
        1_000n * SCALE,
      ]);
      const vault = await ethers.deployContract("MarketplaceVaultMock", [
        await usdt.getAddress(),
        await token.getAddress(),
        await ledger.getAddress(),
      ]);
      const hook = await ethers.deployContract("MarketplaceSettlementHookMock");
      await Promise.all([
        usdt.waitForDeployment(),
        ledger.waitForDeployment(),
        token.waitForDeployment(),
        vault.waitForDeployment(),
        hook.waitForDeployment(),
      ]);
      const marketplace = await ethers.deployContract("AVSMarketplace", [
        await owner.getAddress(),
        await usdt.getAddress(),
        await token.getAddress(),
        await ledger.getAddress(),
        await vault.getAddress(),
        await hook.getAddress(),
      ]);
      await marketplace.waitForDeployment();
      await usdt.mint(await buyer.getAddress(), 100n * SCALE);
      await usdt
        .connect(buyer)
        .approve(await marketplace.getAddress(), ethers.MaxUint256);

      await expect(
        marketplace.connect(buyer).placeMarketBuy(10n * SCALE, 1),
      ).to.be.revertedWithCustomError(marketplace, "ExactAmountNotReceived");
    });
  });
});
