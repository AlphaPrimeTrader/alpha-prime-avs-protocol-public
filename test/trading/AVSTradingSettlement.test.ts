import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();
const id = (value: string) => ethers.id(value);
const ZERO_ID = ethers.ZeroHash;

describe("AVSTradingSettlement", () => {
  async function deployFixture() {
    const [owner, relayer, tradeSigner, serverSigner, outsider, destination] =
      await ethers.getSigners();
    const usdt = await ethers.deployContract("MockERC20");
    const ledger = await ethers.deployContract(
      "TradingSettlementLedgerMock",
      [1_000_000n],
    );
    const marketplace = await ethers.deployContract(
      "TradingSettlementMarketplaceMock",
    );
    const vault = await ethers.deployContract("TradingSettlementVaultMock");
    const settlement = await ethers.deployContract(
      "AVSTradingSettlement",
      [await owner.getAddress(), await usdt.getAddress()],
    );
    await Promise.all(
      [usdt, ledger, marketplace, vault, settlement].map((value) =>
        value.waitForDeployment(),
      ),
    );
    await settlement.setLedger(await ledger.getAddress());
    await settlement.setMarketplace(await marketplace.getAddress());
    await settlement.setVault(await vault.getAddress());
    await settlement.setTradingDestination(
      await destination.getAddress(),
    );
    await settlement.setRelayer(await relayer.getAddress(), true);
    await settlement.setTradeSigner(await tradeSigner.getAddress(), true);
    await settlement.setServerSigner(await serverSigner.getAddress(), true);
    return {
      owner,
      relayer,
      tradeSigner,
      serverSigner,
      outsider,
      destination,
      usdt,
      ledger,
      marketplace,
      vault,
      settlement,
    };
  }

  async function makePayload(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    sequence = 7n,
    grossPnl = 1_000n,
    tradingFees = 100n,
    networkFees = 20n,
    financingFees = 30n,
    otherFees = 50n,
    quantity = 500_000n,
    multiLeg = false,
    protocolCapital = 10_000n,
  ) {
    const latest = await ethers.provider.getBlock("latest");
    const positionId = id(`position-${sequence}`);
    const executionHash = id(`execution-${sequence}`);
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
        strategy: "Delta Neutral",
        executionType: "FINAL_CLOSE",
        symbol: "BTC/USDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        venues: "Binance,Bybit",
      },
      capital: {
        protocolCapitalUsd: protocolCapital,
        borrowedCapitalUsd: 2_000n,
        grossNotionalUsd: 12_000n,
        quantity,
        entryPrice: 60_000n,
        exitPrice: 61_000n,
        averageEntryPrice: 60_050n,
      },
      economics: {
        grossPnlUsd: grossPnl,
        tradingFeesUsd: tradingFees,
        networkFeesUsd: networkFees,
        financingFeesUsd: financingFees,
        otherFeesUsd: otherFees,
      },
      timing: {
        openedAt: BigInt(latest!.timestamp - 120),
        closedAt: BigInt(latest!.timestamp - 5),
        executionMs: 840n,
      },
    };
    const legs = [
      {
        legIndex: 0,
        venue: "Binance",
        action: "SELL",
        assetIn: "BTC",
        assetOut: "USDT",
        amountIn: 500_000n,
        amountOut: 12_500n,
        executionPrice: 61_000n,
        externalReference: id(`venue-order-${sequence}`),
      },
      ...(multiLeg
        ? [
            {
              legIndex: 1,
              venue: "Bybit",
              action: "BUY",
              assetIn: "USDT",
              assetOut: "BTC",
              amountIn: 12_400n,
              amountOut: 490_000n,
              executionPrice: 60_900n,
              externalReference: id(`venue-order-2-${sequence}`),
            },
          ]
        : []),
    ];
    const extraFields = [
      { key: "riskBand", value: "A" },
      { key: "closeReason", value: "take-profit" },
    ];
    const settlementHash = await fixture.settlement.computeSettlementHash(
      core,
      legs,
      extraFields,
    );
    const networkInfo = await ethers.provider.getNetwork();
    const domain = {
      name: "Alpha Prime AVS Trading Settlement",
      version: "1",
      chainId: networkInfo.chainId,
      verifyingContract: await fixture.settlement.getAddress(),
    };
    const types = {
      SettlementAuthorization: [
        { name: "settlementHash", type: "bytes32" },
      ],
    };
    const value = { settlementHash };
    const authorization = {
      settlementHash,
      tradeSignature: await fixture.tradeSigner.signTypedData(
        domain,
        types,
        value,
      ),
      serverSignature: await fixture.serverSigner.signTypedData(
        domain,
        types,
        value,
      ),
    };
    return { core, legs, extraFields, authorization, settlementId };
  }

  it("records one finalized trade, sends only net PnL to Ledger, and archives Explorer data", async () => {
    const fixture = await deployFixture();
    const payload = await makePayload(fixture);
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          payload.authorization,
        ),
    )
      .to.emit(fixture.settlement, "SettlementFinalized")
      .and.to.emit(
        fixture.settlement,
        "MarketplaceProcessingSucceeded",
      );

    expect(await fixture.ledger.lastSettlementId()).to.equal(
      payload.settlementId,
    );
    expect(await fixture.ledger.lastRealizedPnl()).to.equal(800n);
    expect(await fixture.ledger.callCount()).to.equal(1n);
    const record = await fixture.settlement.getSettlement(
      payload.settlementId,
    );
    const accounting = await fixture.settlement.getSettlementAccounting(
      payload.settlementId,
    );
    const display = await fixture.settlement.getSettlementDisplay(
      payload.settlementId,
    );
    expect(record.finalized).to.equal(true);
    expect(accounting.totalFeesUsd).to.equal(200n);
    expect(accounting.netRealizedPnlUsd).to.equal(800n);
    expect(accounting.navBefore).to.equal(1_000_000n);
    expect(accounting.navAfter).to.equal(1_000_800n);
    expect(display.strategy).to.equal("Delta Neutral");
    expect(
      await fixture.settlement.getExecutionLegs(payload.settlementId),
    ).to.have.length(1);
    expect(
      await fixture.settlement.getExtraFields(payload.settlementId),
    ).to.have.length(2);
  });

  it("requires the authorized relayer and two independent authorized signers", async () => {
    const fixture = await deployFixture();
    const payload = await makePayload(fixture);
    await expect(
      fixture.settlement
        .connect(fixture.outsider)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          payload.authorization,
        ),
    )
      .to.be.revertedWithCustomError(
        fixture.settlement,
        "Unauthorized",
      )
      .withArgs(await fixture.outsider.getAddress());

    const badAuthorization = {
      ...payload.authorization,
      serverSignature: await fixture.outsider.signMessage("not-authorized"),
    };
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          badAuthorization,
        ),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "InvalidServerSignature",
    );
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          {
            ...payload.authorization,
            serverSignature: "0x1234",
          },
        ),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "InvalidServerSignature",
    );
  });

  it("rejects settlement, execution, and sequence replay independently without requiring contiguous sequences", async () => {
    const fixture = await deployFixture();
    const first = await makePayload(fixture, 100n);
    await fixture.settlement
      .connect(fixture.relayer)
      .submitSettlement(
        first.core,
        first.legs,
        first.extraFields,
        first.authorization,
      );
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          first.core,
          first.legs,
          first.extraFields,
          first.authorization,
        ),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "DuplicateSettlement",
    );

    const nonContiguous = await makePayload(fixture, 900n);
    const transaction = await fixture.settlement
      .connect(fixture.relayer)
      .submitSettlement(
        nonContiguous.core,
        nonContiguous.legs,
        nonContiguous.extraFields,
        nonContiguous.authorization,
      );
    await transaction.wait();
  });

  it("does not roll back Ledger settlement when the optional Marketplace hook fails", async () => {
    const fixture = await deployFixture();
    await fixture.marketplace.setShouldRevert(true);
    const payload = await makePayload(fixture, 11n, -500n);
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          payload.authorization,
        ),
    ).to.emit(
      fixture.settlement,
      "MarketplaceProcessingDeferred",
    );
    expect(await fixture.ledger.lastRealizedPnl()).to.equal(-700n);
    expect(
      await fixture.settlement.processedSettlements(
        payload.settlementId,
      ),
    ).to.equal(true);
  });

  it("rejects tampered dynamic data because legs and extra fields are signed", async () => {
    const fixture = await deployFixture();
    const payload = await makePayload(fixture);
    const tamperedLegs = [
      { ...payload.legs[0], amountOut: payload.legs[0].amountOut + 1n },
    ];
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          tamperedLegs,
          payload.extraFields,
          payload.authorization,
        ),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "SettlementHashMismatch",
    );
  });

  it("archives a valid zero-net settlement without changing NAV", async () => {
    const fixture = await deployFixture();
    const payload = await makePayload(
      fixture,
      77n,
      10n * 10n ** 18n,
      10n * 10n ** 18n,
      0n,
      0n,
      0n,
    );
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          payload.authorization,
        ),
    )
      .to.emit(fixture.settlement, "SettlementFinalized")
      .and.to.emit(fixture.settlement, "SettlementMetadataRecorded");
    const accounting = await fixture.settlement.getSettlementAccounting(
      payload.settlementId,
    );
    expect(accounting.netRealizedPnlUsd).to.equal(0n);
    expect(accounting.navBefore).to.equal(accounting.navAfter);
    expect(await fixture.settlement.settlementCount()).to.equal(1n);
    expect(
      await fixture.settlement.processedSequences(payload.core.identity.sequence),
    ).to.equal(true);
  });

  it("allows quantity-free multi-leg records but still requires protocol capital", async () => {
    const fixture = await deployFixture();
    const quantityFree = await makePayload(
      fixture,
      79n,
      1_000n,
      100n,
      20n,
      30n,
      50n,
      0n,
      true,
    );
    await fixture.settlement
      .connect(fixture.relayer)
      .submitSettlement(
        quantityFree.core,
        quantityFree.legs,
        quantityFree.extraFields,
        quantityFree.authorization,
      );
    expect(
      (await fixture.settlement.getSettlementDisplay(
        quantityFree.settlementId,
      )).quantity,
    ).to.equal(0n);
    expect(
      await fixture.settlement.getExecutionLegs(quantityFree.settlementId),
    ).to.have.length(2);

    const noProtocolCapital = await makePayload(
      fixture,
      80n,
      1_000n,
      100n,
      20n,
      30n,
      50n,
      0n,
      false,
      0n,
    );
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          noProtocolCapital.core,
          noProtocolCapital.legs,
          noProtocolCapital.extraFields,
          noProtocolCapital.authorization,
        ),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "InvalidAmount",
    );
  });

  it("rejects signatures produced for another verifying contract", async () => {
    const fixture = await deployFixture();
    const payload = await makePayload(fixture, 78n);
    const networkInfo = await ethers.provider.getNetwork();
    const wrongDomain = {
      name: "Alpha Prime AVS Trading Settlement",
      version: "1",
      chainId: networkInfo.chainId,
      verifyingContract: await fixture.ledger.getAddress(),
    };
    const wrongAuthorization = {
      ...payload.authorization,
      tradeSignature: await fixture.tradeSigner.signTypedData(
        wrongDomain,
        {
          SettlementAuthorization: [
            { name: "settlementHash", type: "bytes32" },
          ],
        },
        { settlementHash: payload.authorization.settlementHash },
      ),
    };
    await expect(
      fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          wrongAuthorization,
        ),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "InvalidTradeSignature",
    );
  });

  it("supports bounded pagination and exact forwarding to an EOA without a callback", async () => {
    const fixture = await deployFixture();
    for (const sequence of [3n, 40n]) {
      const payload = await makePayload(fixture, sequence);
      await fixture.settlement
        .connect(fixture.relayer)
        .submitSettlement(
          payload.core,
          payload.legs,
          payload.extraFields,
          payload.authorization,
        );
    }
    expect(await fixture.settlement.getSettlementIds(0, 1)).to.have
      .length(1);
    await expect(
      fixture.settlement.getSettlementIds(0, 101),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "InvalidPageSize",
    );

    const amount = 2_500n;
    await fixture.usdt.mint(await fixture.vault.getAddress(), amount);
    await fixture.vault.forwardCapital(
      await fixture.usdt.getAddress(),
      await fixture.settlement.getAddress(),
      amount,
    );
    expect(
      await fixture.usdt.balanceOf(await fixture.destination.getAddress()),
    ).to.equal(amount);
    expect(
      await fixture.usdt.balanceOf(await fixture.settlement.getAddress()),
    ).to.equal(0n);
  });

  it("forwards to a plain receiving contract and rejects zero or self destinations", async () => {
    const fixture = await deployFixture();
    const receiver = await ethers.deployContract("PlainTradingDestination");
    await receiver.waitForDeployment();
    await fixture.settlement.setTradingDestination(
      await receiver.getAddress(),
    );

    const amount = 777n;
    await fixture.usdt.mint(await fixture.vault.getAddress(), amount);
    await fixture.vault.forwardCapital(
      await fixture.usdt.getAddress(),
      await fixture.settlement.getAddress(),
      amount,
    );
    expect(
      await fixture.usdt.balanceOf(await receiver.getAddress()),
    ).to.equal(amount);
    expect(
      await fixture.usdt.balanceOf(await fixture.settlement.getAddress()),
    ).to.equal(0n);

    await expect(
      fixture.settlement.setTradingDestination(ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "InvalidAddress",
    );
    await expect(
      fixture.settlement.setTradingDestination(
        await fixture.settlement.getAddress(),
      ),
    ).to.be.revertedWithCustomError(
      fixture.settlement,
      "RoleCollision",
    );
  });
});