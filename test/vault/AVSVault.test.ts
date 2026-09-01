import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();
const SCALE = 10n ** 18n;
const BPS = 10_000n;
const CAPITAL_BPS = 500n;
const id = (label: string) => ethers.id(label);

async function deployVault(withTrading = true) {
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
  await Promise.all(
    [usdt, vault, ledger, token, marketplace, migration, trading].map((c) =>
      c.waitForDeployment(),
    ),
  );
  await vault.setAVSToken(await token.getAddress());
  await vault.setAVSLedger(await ledger.getAddress());
  await vault.setMarketplace(await marketplace.getAddress());
  await vault.setMigration(await migration.getAddress());
  if (withTrading) await vault.setTradingContract(await trading.getAddress());
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

async function fund(usdt: any, actor: any, vault: any, amount: bigint) {
  await usdt.mint(await actor.getAddress(), amount);
  await actor.approveToken(
    await usdt.getAddress(),
    await vault.getAddress(),
    amount,
  );
}

describe("AVSVault capital allocation", () => {
  it("allocates floor 5% of every Marketplace capital receipt and routes only its productive remainder", async () => {
    const { beneficiary, usdt, vault, ledger, token, marketplace, trading } =
      await deployVault();
    const capital = 101n * SCALE + 19n;
    const market = (capital * CAPITAL_BPS) / BPS;
    const productive = capital - market;
    await ledger.configureReturn(7n * SCALE, false);
    await fund(usdt, marketplace, vault, capital);

    await expect(
      marketplace.receiveMarketplaceCapital(
        await vault.getAddress(),
        id("market-capital"),
        await beneficiary.getAddress(),
        capital,
      ),
    )
      .to.emit(vault, "CapitalAllocated")
      .withArgs(capital, market, productive)
      .and.to.emit(vault, "PendingTradingCapitalRouted")
      .withArgs(productive);

    expect(await vault.pendingMarketplaceLiquidity()).to.equal(market);
    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await vault.availableMarketLiquidity()).to.equal(market);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(market);
    expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
      productive,
    );
    expect(await ledger.lastCapitalAmount()).to.equal(capital);
    expect(await token.totalSupply()).to.equal(7n * SCALE);
    expect(await vault.accountingSolvent()).to.equal(true);
  });

  it("uses the same fixed base allocation for Migration capital", async () => {
    const { beneficiary, usdt, vault, ledger, migration, trading } =
      await deployVault();
    const capital = 19n * SCALE;
    const market = (capital * CAPITAL_BPS) / BPS;
    await ledger.configureReturn(capital, false);
    await fund(usdt, migration, vault, capital);
    await migration.receiveMigrationCapital(
      await vault.getAddress(),
      id("migration-capital"),
      await beneficiary.getAddress(),
      capital,
    );
    expect(await vault.pendingMarketplaceLiquidity()).to.equal(market);
    expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
      capital - market,
    );
  });

  it("retains exactly pending productive capital until Trading is configured, then releases exactly that amount", async () => {
    const { beneficiary, usdt, vault, ledger, marketplace, trading } =
      await deployVault(false);
    const capital = 100n * SCALE;
    const market = (capital * CAPITAL_BPS) / BPS;
    await ledger.configureReturn(capital, false);
    await fund(usdt, marketplace, vault, capital);
    await expect(
      marketplace.receiveMarketplaceCapital(
        await vault.getAddress(),
        id("unconfigured-trading"),
        await beneficiary.getAddress(),
        capital,
      ),
    )
      .to.emit(vault, "ExcessRetainedBecauseTradingNotConfigured")
      .withArgs(capital - market);
    expect(await vault.pendingTradingCapital()).to.equal(capital - market);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(capital);

    await expect(vault.setTradingContract(await trading.getAddress()))
      .to.emit(vault, "PendingTradingCapitalRouted")
      .withArgs(capital - market);
    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(market);
    expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
      capital - market,
    );
  });

  it("retains Trading returns separately without routing them back to Trading", async () => {
    const { usdt, vault, trading } = await deployVault();
    const tradingReturn = 1_000n * SCALE;
    await fund(usdt, trading, vault, tradingReturn);

    await expect(
      trading.receiveTradingReturn(await vault.getAddress(), tradingReturn),
    )
      .to.emit(vault, "TradingFundsReturned")
      .withArgs(await trading.getAddress(), tradingReturn);

    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await vault.returnedTradingCapital()).to.equal(tradingReturn);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
      tradingReturn,
    );
    expect(await usdt.balanceOf(await trading.getAddress())).to.equal(0n);
    expect(await vault.accountingSolvent()).to.equal(true);
  });

  it("routes only later fresh productive capital while returned capital remains untouched", async () => {
    const { beneficiary, usdt, vault, ledger, marketplace, trading } =
      await deployVault();
    const tradingReturn = 1_000n * SCALE;
    await fund(usdt, trading, vault, tradingReturn);
    await trading.receiveTradingReturn(
      await vault.getAddress(),
      tradingReturn,
    );

    const freshCapital = 100n * SCALE;
    const market = (freshCapital * CAPITAL_BPS) / BPS;
    const productive = freshCapital - market;
    await ledger.configureReturn(freshCapital, false);
    await fund(usdt, marketplace, vault, freshCapital);

    await expect(
      marketplace.receiveMarketplaceCapital(
        await vault.getAddress(),
        id("fresh-after-return"),
        await beneficiary.getAddress(),
        freshCapital,
      ),
    )
      .to.emit(vault, "PendingTradingCapitalRouted")
      .withArgs(productive);

    expect(await vault.pendingMarketplaceLiquidity()).to.equal(market);
    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await vault.returnedTradingCapital()).to.equal(tradingReturn);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(
      tradingReturn + market,
    );
    expect(await usdt.balanceOf(await trading.getAddress())).to.equal(
      productive,
    );
    expect(await vault.accountingSolvent()).to.equal(true);
  });

  it("rejects Trading returns from unauthorized callers", async () => {
    const { outsider, vault } = await deployVault();
    await expect(
      vault.connect(outsider).receiveTradingReturn(1n),
    )
      .to.be.revertedWithCustomError(vault, "Unauthorized")
      .withArgs(await outsider.getAddress());
  });

  it("rejects fee-on-transfer Trading returns with exact balance accounting", async () => {
    const [owner] = await ethers.getSigners();
    const usdt = await ethers.deployContract("FeeOnTransferMock", [100]);
    const vault = await ethers.deployContract("AVSVault", [
      await owner.getAddress(),
      await usdt.getAddress(),
    ]);
    const tradingActor = await ethers.deployContract("VaultActorMock");
    await Promise.all([
      usdt.waitForDeployment(),
      vault.waitForDeployment(),
      tradingActor.waitForDeployment(),
    ]);
    await vault.setTradingContract(await tradingActor.getAddress());

    const amount = 100n * SCALE;
    await usdt.mint(await tradingActor.getAddress(), amount);
    await tradingActor.approveToken(
      await usdt.getAddress(),
      await vault.getAddress(),
      amount,
    );

    await expect(
      tradingActor.receiveTradingReturn(await vault.getAddress(), amount),
    )
      .to.be.revertedWithCustomError(vault, "ExactAmountNotReceived")
      .withArgs(amount, 99n * SCALE);
    expect(await vault.returnedTradingCapital()).to.equal(0n);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await usdt.balanceOf(await tradingActor.getAddress())).to.equal(
      amount,
    );
  });

  it("puts all Marketplace revenue into Marketplace liquidity and never routes it to Trading", async () => {
    const { usdt, vault, ledger, token, marketplace, trading } =
      await deployVault();
    const revenue = 47n * SCALE;
    await fund(usdt, marketplace, vault, revenue);
    await expect(
      marketplace.receiveMarketplaceRevenue(
        await vault.getAddress(),
        id("market-fee"),
        revenue,
      ),
    ).to.emit(vault, "ProtocolRevenueReceived");
    expect(await vault.pendingMarketplaceLiquidity()).to.equal(revenue);
    expect(await vault.pendingTradingCapital()).to.equal(0n);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(revenue);
    expect(await usdt.balanceOf(await trading.getAddress())).to.equal(0n);
    expect(await ledger.protocolRevenueRecordCount()).to.equal(1n);
    expect(await token.mintCount()).to.equal(0n);
  });

  it("releases only legitimate pending marketplace liquidity, with exact transfers", async () => {
    const { outsider, usdt, vault, marketplace } = await deployVault();
    const revenue = 10n * SCALE;
    await fund(usdt, marketplace, vault, revenue);
    await marketplace.receiveMarketplaceRevenue(
      await vault.getAddress(),
      id("liquidity"),
      revenue,
    );
    await expect(
      vault.connect(outsider).provideMarketLiquidity(1n),
    ).to.be.revertedWithCustomError(vault, "Unauthorized");
    await expect(
      marketplace.provideMarketLiquidity(
        await vault.getAddress(),
        revenue + 1n,
      ),
    )
      .to.be.revertedWithCustomError(vault, "InsufficientMarketLiquidity")
      .withArgs(revenue + 1n, revenue);
    await expect(
      marketplace.provideMarketLiquidity(await vault.getAddress(), 4n * SCALE),
    )
      .to.emit(vault, "MarketplaceLiquidityReleased")
      .withArgs(4n * SCALE);
    expect(await vault.availableMarketLiquidity()).to.equal(6n * SCALE);
    expect(await usdt.balanceOf(await marketplace.getAddress())).to.equal(
      4n * SCALE,
    );
    expect(await vault.accountingSolvent()).to.equal(true);
  });

  it("disables reserve-target fabrication while retaining its ABI", async () => {
    const { vault } = await deployVault();
    await expect(
      vault.setReserveTarget(100n * SCALE),
    ).to.be.revertedWithCustomError(vault, "ReserveTargetDisabled");
    expect(await vault.reserveTarget()).to.equal(0n);
    expect(await vault.availableMarketLiquidity()).to.equal(0n);
  });

  it("atomically rolls back capital pull, Ledger record, and allocation when minting cannot proceed", async () => {
    const { beneficiary, usdt, vault, ledger, marketplace } =
      await deployVault();
    const capital = 10n * SCALE;
    await ledger.configureReturn(0n, false);
    await fund(usdt, marketplace, vault, capital);
    await expect(
      marketplace.receiveMarketplaceCapital(
        await vault.getAddress(),
        id("zero-shares"),
        await beneficiary.getAddress(),
        capital,
      ),
    ).to.be.revertedWithCustomError(vault, "SharesToMintIsZero");
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await ledger.recordCount()).to.equal(0n);
    expect(await vault.pendingMarketplaceLiquidity()).to.equal(0n);
  });

  it("rejects fee-on-transfer inflows and rolls back the whole receipt", async () => {
    const [owner, beneficiary] = await ethers.getSigners();
    const usdt = await ethers.deployContract("FeeOnTransferMock", [100]);
    const vault = await ethers.deployContract("AVSVault", [
      await owner.getAddress(),
      await usdt.getAddress(),
    ]);
    const ledger = await ethers.deployContract("VaultLedgerMock");
    const token = await ethers.deployContract("VaultTokenMock");
    const marketplace = await ethers.deployContract("VaultActorMock");
    await Promise.all(
      [usdt, vault, ledger, token, marketplace].map((c) =>
        c.waitForDeployment(),
      ),
    );
    await vault.setAVSLedger(await ledger.getAddress());
    await vault.setAVSToken(await token.getAddress());
    await vault.setMarketplace(await marketplace.getAddress());
    await ledger.configureReturn(1n, false);
    const amount = 100n * SCALE;
    await fund(usdt, marketplace, vault, amount);
    await expect(
      marketplace.receiveMarketplaceCapital(
        await vault.getAddress(),
        id("fee"),
        await beneficiary.getAddress(),
        amount,
      ),
    )
      .to.be.revertedWithCustomError(vault, "ExactAmountNotReceived")
      .withArgs(amount, 99n * SCALE);
    expect(await usdt.balanceOf(await vault.getAddress())).to.equal(0n);
  });

  it("forwards Marketplace-only treasury acquisition and release accounting", async () => {
    const { outsider, vault, ledger, marketplace } = await deployVault();
    const treasuryId = id("treasury-lot");
    await expect(
      vault.connect(outsider).recordTreasuryAcquisition(treasuryId, 2n, 3n),
    ).to.be.revertedWithCustomError(vault, "Unauthorized");
    await marketplace.recordTreasuryAcquisition(
      await vault.getAddress(),
      treasuryId,
      2n,
      3n,
    );
    await marketplace.recordTreasuryRelease(
      await vault.getAddress(),
      treasuryId,
      1n,
      4n,
    );
    expect(await ledger.treasuryAcquisitionRecordCount()).to.equal(1n);
    expect(await ledger.treasuryReleaseRecordCount()).to.equal(1n);
    expect(await ledger.lastTreasuryId()).to.equal(treasuryId);
    expect(await ledger.lastTreasuryAmount()).to.equal(1n);
    expect(await ledger.lastTreasuryValue()).to.equal(4n);
  });

  it("has no owner withdrawal or arbitrary execution surface", async () => {
    const { vault } = await deployVault();
    const forbidden = new Set([
      "withdraw",
      "emergencyWithdraw",
      "transferToken",
      "sweep",
      "rescueToken",
      "arbitraryCall",
    ]);
    const exposed = vault.interface.fragments
      .filter((fragment) => fragment.type === "function")
      .map((fragment) => fragment.name)
      .filter(
        (name): name is string => name !== undefined && forbidden.has(name),
      );
    expect(exposed).to.deep.equal([]);
  });
});
