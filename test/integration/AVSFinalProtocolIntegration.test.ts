import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();
const SCALE = 10n ** 18n;
const id = (value: string) => ethers.id(value);

describe("AVS final protocol integration revision", function () {
  async function deployProtocol() {
    const [
      owner,
      buyer,
      tradingDestination,
      relayer,
      tradeSigner,
      serverSigner,
    ] = await ethers.getSigners();
    const ownerAddress = await owner.getAddress();
    const usdt = await ethers.deployContract("TestUSDT", [ownerAddress]);
    const ledger = await ethers.deployContract("AVSLedger", [ownerAddress]);
    const token = await ethers.deployContract("AVSToken", [ownerAddress]);
    const vault = await ethers.deployContract("AVSVault", [
      ownerAddress,
      await usdt.getAddress(),
    ]);
    const policy = await ethers.deployContract("AVSTokenPolicyMock");
    const migration = await ethers.deployContract("VaultActorMock");
    const settlement = await ethers.deployContract(
      "AVSTradingSettlement",
      [ownerAddress, await usdt.getAddress()],
    );
    const marketplace = await ethers.deployContract("AVSMarketplace", [
      ownerAddress,
      await usdt.getAddress(),
      await token.getAddress(),
      await ledger.getAddress(),
      await vault.getAddress(),
      await settlement.getAddress(),
    ]);
    await Promise.all(
      [
        usdt,
        ledger,
        token,
        vault,
        policy,
        migration,
        settlement,
        marketplace,
      ].map((contract) => contract.waitForDeployment()),
    );

    await ledger.bindAVSToken(await token.getAddress());
    await ledger.configureVault(await vault.getAddress());
    await ledger.configureTradeSettlement(await settlement.getAddress());
    await token.setAccountPolicy(await policy.getAddress());
    await token.setVault(await vault.getAddress());
    await vault.setAVSToken(await token.getAddress());
    await vault.setAVSLedger(await ledger.getAddress());
    await vault.setMarketplace(await marketplace.getAddress());
    await vault.setMigration(await migration.getAddress());
    await settlement.setLedger(await ledger.getAddress());
    await settlement.setVault(await vault.getAddress());
    await settlement.setMarketplace(await marketplace.getAddress());
    await settlement.setTradingDestination(
      await tradingDestination.getAddress(),
    );
    await settlement.setRelayer(await relayer.getAddress(), true);
    await settlement.setTradeSigner(await tradeSigner.getAddress(), true);
    await settlement.setServerSigner(await serverSigner.getAddress(), true);
    await vault.setTradingContract(await settlement.getAddress());
    await policy.authorize(
      await token.getAddress(),
      await buyer.getAddress(),
    );
    await policy.authorize(
      await token.getAddress(),
      await marketplace.getAddress(),
    );

    await usdt.mint(await buyer.getAddress(), 20_000n * SCALE);
    await usdt
      .connect(buyer)
      .approve(await marketplace.getAddress(), ethers.MaxUint256);

    return {
      owner,
      buyer,
      tradingDestination,
      relayer,
      tradeSigner,
      serverSigner,
      usdt,
      ledger,
      token,
      vault,
      settlement,
      marketplace,
    };
  }

  async function signedSettlement(
    fixture: Awaited<ReturnType<typeof deployProtocol>>,
    sequence: bigint,
    strategy: string,
    grossPnlUsd: bigint,
    feesUsd: bigint,
    multiLeg = false,
  ) {
    const block = await ethers.provider.getBlock("latest");
    const positionId = id(`final-position-${sequence}`);
    const executionHash = id(`final-execution-${sequence}`);
    const settlementId = await fixture.settlement.computeSettlementId(
      sequence,
      positionId,
      executionHash,
    );
    const core = {
      identity: {
        settlementId,
        positionId,
        sequence,
        executionHash,
      },
      metadata: {
        strategy,
        executionType: "FINAL_CLOSE",
        symbol: "BTC/USDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        venues: multiLeg ? "Binance,KuCoin" : "Binance",
      },
      capital: {
        protocolCapitalUsd: 9_500n * SCALE,
        borrowedCapitalUsd: multiLeg ? 9_500n * SCALE : 0n,
        grossNotionalUsd: multiLeg ? 19_000n * SCALE : 9_500n * SCALE,
        quantity: multiLeg ? 0n : SCALE,
        entryPrice: 60_000n * SCALE,
        exitPrice: 61_000n * SCALE,
        averageEntryPrice: 60_050n * SCALE,
      },
      economics: {
        grossPnlUsd,
        tradingFeesUsd: feesUsd,
        networkFeesUsd: 0n,
        financingFeesUsd: 0n,
        otherFeesUsd: 0n,
      },
      timing: {
        openedAt: BigInt(block!.timestamp - 300),
        closedAt: BigInt(block!.timestamp - 5),
        executionMs: 742n,
      },
    };
    const legs = [
      {
        legIndex: 0,
        venue: "Binance",
        action: "BUY",
        assetIn: "USDT",
        assetOut: "BTC",
        amountIn: 9_500n * SCALE,
        amountOut: SCALE,
        executionPrice: 60_000n * SCALE,
        externalReference: id(`binance-${sequence}`),
      },
      ...(multiLeg
        ? [
            {
              legIndex: 1,
              venue: "KuCoin",
              action: "SELL",
              assetIn: "BTC",
              assetOut: "USDT",
              amountIn: SCALE,
              amountOut: 9_950n * SCALE,
              executionPrice: 61_000n * SCALE,
              externalReference: id(`kucoin-${sequence}`),
            },
          ]
        : []),
    ];
    const extraFields = [
      { key: "riskBand", value: "A" },
      { key: "closeReason", value: "finalized" },
    ];
    const settlementHash = await fixture.settlement.computeSettlementHash(
      core,
      legs,
      extraFields,
    );
    const chain = await ethers.provider.getNetwork();
    const domain = {
      name: "Alpha Prime AVS Trading Settlement",
      version: "1",
      chainId: chain.chainId,
      verifyingContract: await fixture.settlement.getAddress(),
    };
    const types = {
      SettlementAuthorization: [
        { name: "settlementHash", type: "bytes32" },
      ],
    };
    const authorization = {
      settlementHash,
      tradeSignature: await fixture.tradeSigner.signTypedData(
        domain,
        types,
        { settlementHash },
      ),
      serverSignature: await fixture.serverSigner.signTypedData(
        domain,
        types,
        { settlementHash },
      ),
    };
    return { core, legs, extraFields, authorization, settlementId };
  }

  async function submit(
    fixture: Awaited<ReturnType<typeof deployProtocol>>,
    payload: Awaited<ReturnType<typeof signedSettlement>>,
  ) {
    return fixture.settlement
      .connect(fixture.relayer)
      .submitSettlement(
        payload.core,
        payload.legs,
        payload.extraFields,
        payload.authorization,
      );
  }

  it("routes 10,000 USDT as 5/95 through Settlement without creating PnL", async function () {
    const fixture = await deployProtocol();
    const destinationBefore = await fixture.usdt.balanceOf(
      await fixture.tradingDestination.getAddress(),
    );
    await fixture.marketplace
      .connect(fixture.buyer)
      .placeMarketBuy(10_000n * SCALE, 4);

    expect(await fixture.token.balanceOf(await fixture.buyer.getAddress()))
      .to.equal(10_000n * SCALE);
    expect(await fixture.ledger.totalGrossProfit()).to.equal(0n);
    expect(await fixture.ledger.totalLoss()).to.equal(0n);
    expect(await fixture.ledger.buybackReserve()).to.equal(0n);
    expect(await fixture.vault.pendingTradingCapital()).to.equal(0n);
    expect(await fixture.vault.pendingMarketplaceLiquidity()).to.equal(0n);
    expect(await fixture.marketplace.protocolLiquidityUSDT()).to.equal(
      502n * SCALE,
    );
    expect(
      await fixture.usdt.balanceOf(
        await fixture.tradingDestination.getAddress(),
      ),
    ).to.equal(destinationBefore + 9_500n * SCALE);
    expect(
      await fixture.usdt.balanceOf(await fixture.settlement.getAddress()),
    ).to.equal(0n);
  });

  it("settles positive, negative, zero, and multi-leg reports exactly once and reconstructs Explorer state", async function () {
    const fixture = await deployProtocol();
    await fixture.marketplace
      .connect(fixture.buyer)
      .placeMarketBuy(10_000n * SCALE, 4);
    const destinationBalance = await fixture.usdt.balanceOf(
      await fixture.tradingDestination.getAddress(),
    );
    const initialAssets = await fixture.ledger.totalNetAssets();

    const positive = await signedSettlement(
      fixture,
      10n,
      "Cross-CEX Arbitrage",
      1_000n * SCALE,
      100n * SCALE,
    );
    await expect(submit(fixture, positive))
      .to.emit(fixture.settlement, "SettlementFinalized")
      .and.to.emit(fixture.ledger, "TradingSettlementRecorded");
    expect(await fixture.ledger.totalNetAssets()).to.equal(
      initialAssets + 810n * SCALE,
    );
    expect(await fixture.ledger.buybackReserve()).to.equal(90n * SCALE);

    const negative = await signedSettlement(
      fixture,
      300n,
      "GRID",
      -700n * SCALE,
      60n * SCALE,
    );
    await submit(fixture, negative);
    expect(await fixture.ledger.totalLoss()).to.equal(760n * SCALE);
    expect(await fixture.ledger.totalNetAssets()).to.equal(
      initialAssets + 50n * SCALE,
    );

    const zero = await signedSettlement(
      fixture,
      21n,
      "DCA",
      10n * SCALE,
      10n * SCALE,
    );
    const zeroNavBefore = await fixture.ledger.currentAVSValue();
    await submit(fixture, zero);
    expect(await fixture.ledger.currentAVSValue()).to.equal(zeroNavBefore);
    expect((await fixture.ledger.settlementRecord(zero.settlementId)).realizedPnL)
      .to.equal(0n);

    const multiLeg = await signedSettlement(
      fixture,
      900n,
      "Cross-CEX Arbitrage",
      500n * SCALE,
      50n * SCALE,
      true,
    );
    await submit(fixture, multiLeg);
    expect(await fixture.settlement.settlementCount()).to.equal(4n);
    expect(await fixture.ledger.settlementCount()).to.equal(4n);
    expect(await fixture.ledger.totalGrossProfit()).to.equal(1_350n * SCALE);
    expect(await fixture.ledger.totalLoss()).to.equal(760n * SCALE);
    expect(await fixture.ledger.buybackReserve()).to.equal(135n * SCALE);
    expect(await fixture.ledger.totalNetAssets()).to.equal(
      initialAssets + 455n * SCALE,
    );
    expect(
      await fixture.usdt.balanceOf(
        await fixture.tradingDestination.getAddress(),
      ),
    ).to.equal(destinationBalance);

    const record = await fixture.settlement.getSettlement(
      multiLeg.settlementId,
    );
    const display = await fixture.settlement.getSettlementDisplay(
      multiLeg.settlementId,
    );
    const accounting = await fixture.settlement.getSettlementAccounting(
      multiLeg.settlementId,
    );
    const timing = await fixture.settlement.getSettlementTiming(
      multiLeg.settlementId,
    );
    const authentication =
      await fixture.settlement.getSettlementAuthentication(
        multiLeg.settlementId,
      );
    const legs = await fixture.settlement.getExecutionLegs(
      multiLeg.settlementId,
    );
    const extras = await fixture.settlement.getExtraFields(
      multiLeg.settlementId,
    );
    expect(record.finalized).to.equal(true);
    expect(record.sequence).to.equal(900n);
    expect(display.strategy).to.equal("Cross-CEX Arbitrage");
    expect(display.symbol).to.equal("BTC/USDT");
    expect(display.quantity).to.equal(0n);
    expect(accounting.netRealizedPnlUsd).to.equal(450n * SCALE);
    expect(accounting.navAfter).to.be.greaterThan(accounting.navBefore);
    expect(display.executionMs).to.equal(742n);
    expect(timing.closedAt).to.be.greaterThan(timing.openedAt);
    expect(authentication.tradeSigner).to.equal(
      await fixture.tradeSigner.getAddress(),
    );
    expect(authentication.serverSigner).to.equal(
      await fixture.serverSigner.getAddress(),
    );
    expect(authentication.relayer).to.equal(
      await fixture.relayer.getAddress(),
    );
    expect(legs).to.have.length(2);
    expect(extras).to.have.length(2);
    expect(
      await fixture.settlement.processedSettlements(
        multiLeg.settlementId,
      ),
    ).to.equal(true);
    expect(await fixture.settlement.getSettlementIds(0, 10)).to.deep.equal([
      positive.settlementId,
      negative.settlementId,
      zero.settlementId,
      multiLeg.settlementId,
    ]);
  });
});