import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SCALE = 10n ** 18n;
const BPS = 10_000n;
const FEE_BPS = 2n;
const OLD_USER = "0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba";

const floorGross = (avs: bigint, nav: bigint) => (avs * nav) / SCALE;
const fee = (gross: bigint) => (gross * FEE_BPS) / BPS;

/**
 * This deliberately uses the production token, ledger, vault, migration, and
 * marketplace.  The only contracts below are the existing boundary mocks:
 * legacy state, account policy, and the future trade-settlement source.
 */
async function deployProtocol(configureTrading = true) {
  const [owner, primaryBuyer, secondaryBuyer, seller, migrationBeneficiary] =
    await ethers.getSigners();
  const ownerAddress = await owner.getAddress();
  const usdt = await ethers.deployContract("TestUSDT", [ownerAddress]);
  const oldLedger = await ethers.deployContract("OldLedgerMock", [
    ownerAddress,
  ]);
  const oldVault = await ethers.deployContract("OldVaultMock", [
    ownerAddress,
    await usdt.getAddress(),
    await oldLedger.getAddress(),
  ]);
  const ledger = await ethers.deployContract("AVSLedger", [ownerAddress]);
  const token = await ethers.deployContract("AVSToken", [ownerAddress]);
  const vault = await ethers.deployContract("AVSVault", [
    ownerAddress,
    await usdt.getAddress(),
  ]);
  const policy = await ethers.deployContract("AVSTokenPolicyMock");
  const settlement = await ethers.deployContract("LedgerSourceMock");
  const hook = await ethers.deployContract("MarketplaceSettlementHookMock");

  await oldLedger.setVault(await oldVault.getAddress());
  await oldLedger.setDailyAPYBps(0);
  await ledger.bindAVSToken(await token.getAddress());
  await ledger.configureVault(await vault.getAddress());
  await ledger.configureTradeSettlement(await settlement.getAddress());
  await vault.setAVSToken(await token.getAddress());
  await vault.setAVSLedger(await ledger.getAddress());
  await token.setAccountPolicy(await policy.getAddress());
  await token.setVault(await vault.getAddress());

  const marketplace = await ethers.deployContract("AVSMarketplace", [
    ownerAddress,
    await usdt.getAddress(),
    await token.getAddress(),
    await ledger.getAddress(),
    await vault.getAddress(),
    await hook.getAddress(),
  ]);
  await vault.setMarketplace(await marketplace.getAddress());

  const migration = await ethers.deployContract("Migration", [
    ownerAddress,
    await oldLedger.getAddress(),
    await oldVault.getAddress(),
    await usdt.getAddress(),
    await vault.getAddress(),
    await ledger.getAddress(),
    await token.getAddress(),
  ]);
  await vault.setMigration(await migration.getAddress());
  await oldVault.setExecutor(await migration.getAddress(), true);
  if (configureTrading)
    await vault.setTradingContract(await settlement.getAddress());

  for (const account of [
    primaryBuyer,
    secondaryBuyer,
    seller,
    migrationBeneficiary,
    marketplace,
  ]) {
    await policy.authorize(
      await token.getAddress(),
      await account.getAddress(),
    );
  }
  for (const account of [primaryBuyer, secondaryBuyer, seller]) {
    await usdt.mint(await account.getAddress(), 100_000n * SCALE);
    await usdt
      .connect(account)
      .approve(await marketplace.getAddress(), ethers.MaxUint256);
    await token
      .connect(account)
      .approve(await marketplace.getAddress(), ethers.MaxUint256);
  }

  return {
    owner,
    primaryBuyer,
    secondaryBuyer,
    seller,
    migrationBeneficiary,
    usdt,
    oldLedger,
    oldVault,
    ledger,
    token,
    vault,
    policy,
    settlement,
    hook,
    marketplace,
    migration,
  };
}

describe("AVS protocol integration", function () {
  it("starts at zero and atomically routes a first 100-USDT primary purchase", async function () {
    const { primaryBuyer, ledger, token, vault, marketplace } =
      await deployProtocol();
    expect(await token.totalSupply()).to.equal(0n);
    expect(await ledger.totalNetAssets()).to.equal(0n);
    expect(await ledger.currentAVSValue()).to.equal(SCALE);
    expect(await vault.pendingMarketplaceLiquidity()).to.equal(0n);

    await marketplace.connect(primaryBuyer).placeMarketBuy(100n * SCALE, 4);

    expect(await token.balanceOf(await primaryBuyer.getAddress())).to.equal(
      100n * SCALE,
    );
    expect(await token.totalSupply()).to.equal(100n * SCALE);
    expect(await ledger.totalNetAssets()).to.equal(
      100n * SCALE + fee(100n * SCALE),
    );
    // The primary 5% and its buyer fee are both synchronized as market liquidity.
    expect(await marketplace.protocolLiquidityUSDT()).to.equal(
      5n * SCALE + fee(100n * SCALE),
    );
    expect(await vault.pendingMarketplaceLiquidity()).to.equal(0n);
    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await ledger.currentAVSValue()).to.equal(
      ((await ledger.totalNetAssets()) * SCALE) /
        (await ledger.economicSupply()),
    );
  });

  it("migrates 12,000 USDT through the real legacy bridge with exact allocations", async function () {
    const {
      migrationBeneficiary,
      usdt,
      oldLedger,
      oldVault,
      migration,
      token,
      ledger,
      vault,
      settlement,
    } = await deployProtocol();
    const amount = 12_000n * SCALE;
    await oldLedger.seedUser(OLD_USER, amount, 0, 0, 1);
    await usdt.mint(await oldVault.getAddress(), amount);

    await migration.migrate(OLD_USER, await migrationBeneficiary.getAddress());

    expect(
      await token.balanceOf(await migrationBeneficiary.getAddress()),
    ).to.equal(amount);
    expect(await ledger.totalNetAssets()).to.equal(amount);
    expect(await vault.pendingMarketplaceLiquidity()).to.equal(600n * SCALE);
    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await usdt.balanceOf(await settlement.getAddress())).to.equal(
      11_400n * SCALE,
    );
  });

  it("retains capital and never routes a zero amount before Trading is configured", async function () {
    const { primaryBuyer, usdt, vault, marketplace, settlement } =
      await deployProtocol(false);
    await marketplace.connect(primaryBuyer).placeMarketBuy(100n * SCALE, 4);
    expect(await vault.pendingTradingCapital()).to.equal(95n * SCALE);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
      95n * SCALE,
    );
    expect(await usdt.balanceOf(await settlement.getAddress())).to.equal(0n);

    await vault.setTradingContract(await settlement.getAddress());
    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await usdt.balanceOf(await settlement.getAddress())).to.equal(
      95n * SCALE,
    );
  });

  it("keeps secondary supply fixed, charges exact 2-BPS fees, and derives every price from current NAV", async function () {
    const { primaryBuyer, secondaryBuyer, ledger, token, marketplace } =
      await deployProtocol();
    await marketplace.connect(primaryBuyer).placeMarketBuy(90n * SCALE, 4);
    const nav = await ledger.currentAVSValue();
    const quantity = 10n * SCALE; // 5% of the holder's economic value stays below $5.
    const supplyBefore = await token.totalSupply();
    const assetsBefore = await ledger.totalNetAssets();
    const gross = floorGross(quantity, nav);
    const tradeFee = fee(gross);

    await marketplace
      .connect(primaryBuyer)
      .placeTriggeredSell(quantity, nav, 1);
    await marketplace.connect(secondaryBuyer).placeMarketBuy(quantity, 2);

    expect(await token.totalSupply()).to.equal(supplyBefore);
    expect(await token.balanceOf(await secondaryBuyer.getAddress())).to.equal(
      quantity,
    );
    expect(await marketplace.totalFeesCollected()).to.equal(
      fee(90n * SCALE) + 2n * tradeFee,
    );
    expect(await ledger.totalNetAssets()).to.equal(
      assetsBefore + 2n * tradeFee,
    );
    expect(await ledger.currentAVSValue()).to.equal(
      ((await ledger.totalNetAssets()) * SCALE) /
        (await ledger.economicSupply()),
    );
  });

  it("exercises ledger PnL and specifies treasury absorption/resale revolving economics", async function () {
    const {
      primaryBuyer,
      secondaryBuyer,
      ledger,
      token,
      marketplace,
      settlement,
    } = await deployProtocol();
    await marketplace.connect(primaryBuyer).placeMarketBuy(100n * SCALE, 4);
    const assetsBeforePnl = await ledger.totalNetAssets();
    await settlement.recordTradingSettlement(
      await ledger.getAddress(),
      ethers.id("positive-pnl"),
      10n * SCALE,
    );
    expect(await ledger.totalNetAssets()).to.equal(
      assetsBeforePnl + 9n * SCALE,
    );
    expect(await ledger.buybackReserve()).to.equal(SCALE);
    await settlement.recordTradingSettlement(
      await ledger.getAddress(),
      ethers.id("negative-pnl"),
      -4n * SCALE,
    );
    expect(await ledger.totalNetAssets()).to.equal(
      assetsBeforePnl + 5n * SCALE,
    );

    await marketplace.connect(secondaryBuyer).placeMarketBuy(100n * SCALE, 2);
    // At the on-chain NAV, 100 AVS has a $5+ daily allowance (5%), so this
    // is an actual protocol acquisition, not a mocked accounting transition.
    const navBefore = await ledger.currentAVSValue();
    const assetsBeforeTreasury = await ledger.totalNetAssets();
    const supplyBefore = await token.totalSupply();
    const eligibleValue = (((100n * SCALE * navBefore) / SCALE) * 500n) / BPS;
    const expectedTreasuryAVS = (eligibleValue * SCALE) / navBefore;
    const acquisitionGross = floorGross(expectedTreasuryAVS, navBefore);
    const acquisitionFee = fee(acquisitionGross);
    await marketplace
      .connect(primaryBuyer)
      .placeTriggeredSell(100n * SCALE, navBefore, 2);

    expect(await ledger.treasuryAVS()).to.equal(expectedTreasuryAVS);
    expect(await ledger.economicSupply()).to.equal(
      supplyBefore - expectedTreasuryAVS,
    );
    expect(await ledger.totalNetAssets()).to.equal(
      assetsBeforeTreasury - acquisitionGross + acquisitionFee,
    );
    expect(await ledger.currentAVSValue()).to.equal(
      ((assetsBeforeTreasury - acquisitionGross + acquisitionFee) * SCALE) /
        (supplyBefore - expectedTreasuryAVS),
    );
    expect(await token.totalSupply()).to.equal(supplyBefore);

    const resaleNAV = await ledger.currentAVSValue();
    await marketplace
      .connect(secondaryBuyer)
      .placeMarketBuy(expectedTreasuryAVS, 2);
    expect(await ledger.treasuryAVS()).to.equal(0n);
    expect(await ledger.economicSupply()).to.equal(supplyBefore);
    expect(await ledger.currentAVSValue()).to.be.greaterThan(resaleNAV);
    expect(await token.MAX_SUPPLY()).to.equal(20_000_000n * SCALE);
  });

  it("keeps MAX_SUPPLY tied to totalSupply while treasury inventory exists and is resold", async function () {
    const {
      secondaryBuyer,
      migrationBeneficiary,
      usdt,
      oldLedger,
      oldVault,
      ledger,
      token,
      marketplace,
      migration,
    } = await deployProtocol();
    const maxSupply = await token.MAX_SUPPLY();
    await oldLedger.seedUser(OLD_USER, maxSupply, 0, 0, 1);
    await usdt.mint(await oldVault.getAddress(), maxSupply);
    await migration.migrate(OLD_USER, await migrationBeneficiary.getAddress());
    await token
      .connect(migrationBeneficiary)
      .approve(await marketplace.getAddress(), ethers.MaxUint256);
    await marketplace.syncProtocolLiquidity();

    await marketplace
      .connect(migrationBeneficiary)
      .placeMarketSell(5_000n * SCALE, 4);
    expect(await token.totalSupply()).to.equal(maxSupply);
    expect(await ledger.treasuryAVS()).to.equal(3_000n * SCALE);
    expect(await ledger.economicSupply()).to.equal(maxSupply - 3_000n * SCALE);

    await marketplace.connect(secondaryBuyer).placeMarketBuy(3_001n * SCALE, 4);
    expect(await token.totalSupply()).to.equal(maxSupply);
    expect(await ledger.treasuryAVS()).to.equal(0n);
    expect(await token.balanceOf(await secondaryBuyer.getAddress())).to.equal(
      3_000n * SCALE,
    );
  });
});
