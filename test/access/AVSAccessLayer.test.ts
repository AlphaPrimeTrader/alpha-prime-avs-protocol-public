import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();
const SCALE = 10n ** 18n;

const types = {
  MarketBuyIntent: [
    { name: "owner", type: "address" },
    { name: "beneficiary", type: "address" },
    { name: "quantityAVS", type: "uint256" },
    { name: "requestedMaxMatches", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "deploymentGeneration", type: "uint256" },
  ],
  TriggeredBuyIntent: [
    { name: "owner", type: "address" }, { name: "beneficiary", type: "address" },
    { name: "quantityAVS", type: "uint256" }, { name: "triggerNAV", type: "uint256" },
    { name: "requestedMaxMatches", type: "uint256" }, { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" },
  ],
  MarketSellIntent: [
    { name: "owner", type: "address" }, { name: "beneficiary", type: "address" },
    { name: "quantityAVS", type: "uint256" }, { name: "requestedMaxMatches", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    { name: "deploymentGeneration", type: "uint256" },
  ],
  TriggeredSellIntent: [
    { name: "owner", type: "address" }, { name: "beneficiary", type: "address" },
    { name: "quantityAVS", type: "uint256" }, { name: "triggerNAV", type: "uint256" },
    { name: "requestedMaxMatches", type: "uint256" }, { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" },
  ],
  CancelIntent: [
    { name: "owner", type: "address" }, { name: "beneficiary", type: "address" },
    { name: "orderId", type: "uint256" }, { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" },
  ],
};

describe("Access Layer Phase 1", function () {
  async function fixture(options: { authorizeMarketplace?: boolean } = {}) {
    const [owner, buyer, beneficiary, seller, relayer, outsider] =
      await ethers.getSigners();
    const ownerAddress = await owner.getAddress();
    const usdt = await ethers.deployContract("TestUSDT", [ownerAddress]);
    const ledger = await ethers.deployContract("AVSLedger", [ownerAddress]);
    const token = await ethers.deployContract("AVSToken", [ownerAddress]);
    const vault = await ethers.deployContract("AVSVault", [ownerAddress, await usdt.getAddress()]);
    const policy = await ethers.deployContract("AccountPolicyMock", [ownerAddress, await token.getAddress()]);
    const migration = await ethers.deployContract("VaultActorMock");
    const settlement = await ethers.deployContract("AVSTradingSettlement", [ownerAddress, await usdt.getAddress()]);
    const marketplace = await ethers.deployContract("AVSMarketplace", [
      ownerAddress, await usdt.getAddress(), await token.getAddress(), await ledger.getAddress(),
      await vault.getAddress(), await settlement.getAddress(),
    ]);
    await Promise.all([usdt, ledger, token, vault, policy, migration, settlement, marketplace].map((c) => c.waitForDeployment()));
    await ledger.bindAVSToken(await token.getAddress());
    await ledger.configureVault(await vault.getAddress());
    await ledger.configureTradeSettlement(await settlement.getAddress());
    await token.setAccountPolicy(await policy.getAddress());
    await token.setVault(await vault.getAddress());
    await vault.setAVSToken(await token.getAddress());
    await vault.setAVSLedger(await ledger.getAddress());
    await vault.setMarketplace(await marketplace.getAddress());
    await vault.setMigration(await migration.getAddress());
    await vault.setTradingContract(await settlement.getAddress());
    await settlement.setLedger(await ledger.getAddress());
    await settlement.setVault(await vault.getAddress());
    await settlement.setMarketplace(await marketplace.getAddress());
    await settlement.setTradingDestination(await outsider.getAddress());
    for (const account of [
      buyer,
      beneficiary,
      seller,
      ...(options.authorizeMarketplace === false ? [] : [marketplace]),
    ]) {
      await policy.authorizeAccount(await account.getAddress());
    }
    const lens = await ethers.deployContract("AVSProtocolLens", [
      await token.getAddress(), await usdt.getAddress(), await ledger.getAddress(), await vault.getAddress(),
      await marketplace.getAddress(), await settlement.getAddress(), await policy.getAddress(),
      await migration.getAddress(), 1,
    ]);
    await lens.waitForDeployment();
    const gateway = await ethers.deployContract("AVSGateway", [
      await token.getAddress(), await ledger.getAddress(), await vault.getAddress(), await marketplace.getAddress(),
      await settlement.getAddress(), await policy.getAddress(), await migration.getAddress(), await lens.getAddress(), 1,
    ]);
    await gateway.waitForDeployment();
    await usdt.mint(await buyer.getAddress(), 1_000n * SCALE);
    await usdt.connect(buyer).approve(await marketplace.getAddress(), ethers.MaxUint256);
    if (options.authorizeMarketplace !== false) {
      await token.connect(seller).approve(await marketplace.getAddress(), ethers.MaxUint256);
    }
    return { owner, buyer, beneficiary, seller, relayer, outsider, usdt, ledger, token, vault, policy, migration, settlement, marketplace, lens, gateway };
  }

  async function domain(marketplace: any) {
    return { name: "AVS Marketplace", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await marketplace.getAddress() };
  }
  async function deadline() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
  }

  it("preserves direct Marketplace APIs and keeps Gateway non-custodial", async () => {
    const f = await fixture();
    const amount = 3n * SCALE;
    const before = await f.usdt.balanceOf(await f.buyer.getAddress());
    await f.marketplace.connect(f.buyer).placeMarketBuy(amount, 2);
    expect(await f.token.balanceOf(await f.buyer.getAddress())).to.equal(amount);
    expect(await f.usdt.balanceOf(await f.buyer.getAddress())).to.be.lessThan(before);
    expect(await f.usdt.allowance(await f.buyer.getAddress(), await f.gateway.getAddress())).to.equal(0n);
    expect(await f.usdt.balanceOf(await f.gateway.getAddress())).to.equal(0n);
    expect(await f.token.balanceOf(await f.gateway.getAddress())).to.equal(0n);

    const legacyMarketplace = new ethers.Contract(
      await f.marketplace.getAddress(),
      [
        "function orders(uint256) view returns (address owner,uint8 side,uint8 orderType,uint8 status,uint256 triggerNAV,uint256 remainingAVS,uint256 remainingUSDT,uint256 createdAt,uint256 previous,uint256 next)",
      ],
      ethers.provider,
    );
    const legacyOrder = await legacyMarketplace.orders(1);
    expect(legacyOrder.owner).to.equal(await f.buyer.getAddress());
    expect(legacyOrder.side).to.equal(0n);
    expect(legacyOrder.orderType).to.equal(0n);
    expect(legacyOrder.status).to.equal(1n);
  });

  it("forwards all five exact EIP-712 intents, routes owner/beneficiary, and rejects replay", async () => {
    const f = await fixture();
    await f.usdt.mint(await f.seller.getAddress(), 11n * SCALE);
    await f.usdt.connect(f.seller).approve(await f.marketplace.getAddress(), ethers.MaxUint256);
    await f.marketplace.connect(f.seller).placeMarketBuy(10n * SCALE, 1);
    const owner = await f.buyer.getAddress();
    const beneficiary = await f.beneficiary.getAddress();
    const d = await deadline();
    const buy = { owner, beneficiary, quantityAVS: SCALE, requestedMaxMatches: 1n, nonce: 9n, deadline: d, deploymentGeneration: 1n };
    const sig = await f.buyer.signTypedData(await domain(f.marketplace), { MarketBuyIntent: types.MarketBuyIntent }, buy);
    await f.gateway.connect(f.relayer).placeMarketBuyWithSignature(buy, sig);
    expect(await f.token.balanceOf(beneficiary)).to.equal(SCALE);
    expect(await f.marketplace.isNonceUsed(owner, 9)).to.equal(true);
    await expect(f.gateway.placeMarketBuyWithSignature(buy, sig)).to.be.revertedWithCustomError(f.marketplace, "NonceAlreadyUsed");
    for (const [name, intent, method] of [
      ["TriggeredBuyIntent", { owner, beneficiary, quantityAVS: SCALE, triggerNAV: SCALE / 2n, requestedMaxMatches: 1n, nonce: 10n, deadline: d, deploymentGeneration: 1n }, "placeTriggeredBuyWithSignature"],
      ["MarketSellIntent", { owner: await f.seller.getAddress(), beneficiary: await f.seller.getAddress(), quantityAVS: SCALE, requestedMaxMatches: 1n, nonce: 11n, deadline: d, deploymentGeneration: 1n }, "placeMarketSellWithSignature"],
      ["TriggeredSellIntent", { owner: await f.seller.getAddress(), beneficiary: await f.seller.getAddress(), quantityAVS: SCALE, triggerNAV: 2n * SCALE, requestedMaxMatches: 1n, nonce: 12n, deadline: d, deploymentGeneration: 1n }, "placeTriggeredSellWithSignature"],
    ] as const) {
      const signer = name.includes("Sell") ? f.seller : f.buyer;
      const signature = await signer.signTypedData(await domain(f.marketplace), { [name]: types[name] }, intent);
      await (f.gateway.connect(f.relayer) as any)[method](intent, signature);
      expect(await f.marketplace.isNonceUsed(intent.owner, intent.nonce)).to.equal(true);
    }
    const cancel = { owner: await f.seller.getAddress(), beneficiary: await f.seller.getAddress(), orderId: 5n, nonce: 13n, deadline: d, deploymentGeneration: 1n };
    const cancelSig = await f.seller.signTypedData(await domain(f.marketplace), { CancelIntent: types.CancelIntent }, cancel);
    await f.gateway.cancelOrderWithSignature(cancel, cancelSig);
    expect((await f.marketplace.orders(5)).status).to.equal(2n);
  });

  it("rejects expired, wrong-domain, generation, malformed, tampered, and wrong-type signatures atomically", async () => {
    const f = await fixture();
    const intent = { owner: await f.buyer.getAddress(), beneficiary: await f.beneficiary.getAddress(), quantityAVS: SCALE, requestedMaxMatches: 1n, nonce: 77n, deadline: await deadline(), deploymentGeneration: 1n };
    const sign = (value: typeof intent, d: any) =>
      f.buyer.signTypedData(d, { MarketBuyIntent: types.MarketBuyIntent }, value);
    const valid = await sign(intent, await domain(f.marketplace));
    for (const [value, signature] of [
      [{ ...intent, quantityAVS: 2n * SCALE }, valid],
      [{ ...intent, deploymentGeneration: 2n }, valid],
      [{ ...intent, deadline: 1n }, valid],
      [intent, "0x1234"],
    ] as const) {
      await expect(
        f.gateway.placeMarketBuyWithSignature(value, signature),
      ).to.be.revert(ethers);
      expect(await f.marketplace.isNonceUsed(intent.owner, 77)).to.equal(false);
    }
    const wrongDomain = await sign(intent, {
      ...(await domain(f.marketplace)),
      verifyingContract: await f.ledger.getAddress(),
    });
    await expect(f.gateway.placeMarketBuyWithSignature(intent, wrongDomain)).to.be.revertedWithCustomError(f.marketplace, "InvalidSignature");
    const wrongType = await f.buyer.signTypedData(await domain(f.marketplace), { MarketSellIntent: types.MarketSellIntent }, intent);
    await expect(f.gateway.placeMarketBuyWithSignature(intent, wrongType)).to.be.revertedWithCustomError(f.marketplace, "InvalidSignature");
  });

  it("supports controllable ERC-1271 and treats invalid, reverting, and malformed responses as invalid", async () => {
    const f = await fixture();
    const wallet = await ethers.deployContract("ControllableERC1271Mock");
    await wallet.waitForDeployment();
    await f.policy.authorizeAccount(await wallet.getAddress());
    await f.usdt.mint(await wallet.getAddress(), 20n * SCALE);
    await wallet.approveToken(await f.usdt.getAddress(), await f.marketplace.getAddress(), ethers.MaxUint256);
    const intent = { owner: await wallet.getAddress(), beneficiary: await f.beneficiary.getAddress(), quantityAVS: SCALE, requestedMaxMatches: 1n, nonce: 1n, deadline: await deadline(), deploymentGeneration: 1n };
    const digest = ethers.TypedDataEncoder.hash(await domain(f.marketplace), { MarketBuyIntent: types.MarketBuyIntent }, intent);
    await wallet.setAcceptedDigest(digest);
    await f.gateway.placeMarketBuyWithSignature(intent, "0xdead");
    for (const mode of [1, 2, 3]) {
      const next = { ...intent, nonce: BigInt(mode + 1) };
      await wallet.setMode(mode);
      await expect(f.gateway.placeMarketBuyWithSignature(next, "0x")).to.be.revertedWithCustomError(f.marketplace, "InvalidSignature");
    }
  });

  it("paginates globally and per user without skips, and Lens/Gateway snapshots forward canonical reads", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await f.marketplace.connect(f.buyer).placeTriggeredBuy(SCALE, 2n * SCALE, 1);
    expect(await f.marketplace.getOrderIds(0, 3, false)).to.deep.equal([1n, 2n, 3n]);
    expect(await f.gateway.getOrderIds(0, 3, true)).to.deep.equal([3n, 2n, 1n]);
    expect(await f.marketplace.getOrderIds(3, 1, false)).to.deep.equal([]);
    expect(await f.marketplace.getOrderIds(0, 0, false)).to.deep.equal([]);
    await expect(f.marketplace.getOrderIds(0, 101, false)).to.be.revertedWithCustomError(f.marketplace, "InvalidPageSize");
    expect(await f.gateway.getUserOrderIds(await f.buyer.getAddress(), 1, 2, false)).to.deep.equal([2n, 3n]);
    const a = await f.lens.getMarketplaceSnapshot();
    const b = await f.gateway.getMarketplaceSnapshot();
    expect(b.orderCount).to.equal(a.orderCount);
    expect(b.actualUSDTBalance).to.equal(await f.usdt.balanceOf(await f.marketplace.getAddress()));
    expect((await f.gateway.getWiringHealth()).marketplaceSettlement).to.equal(true);
    expect((await f.gateway.getWiringHealth()).allHealthy).to.equal(true);
    expect(await f.gateway.getSettlementSummaries(0, 1)).to.deep.equal([]);
  });

  it("fails closed when Marketplace is not AccountPolicy-authorized without changing state", async () => {
    const f = await fixture({ authorizeMarketplace: false });
    const before = {
      supply: await f.token.totalSupply(),
      assets: await f.ledger.totalNetAssets(),
      orders: await f.marketplace.orderCount(),
      marketplaceUSDT: await f.usdt.balanceOf(await f.marketplace.getAddress()),
    };

    const lensHealth = await f.lens.getWiringHealth();
    const gatewayHealth = await f.gateway.getWiringHealth();

    expect(lensHealth.marketplaceAuthorized).to.equal(false);
    expect(lensHealth.allHealthy).to.equal(false);
    expect(gatewayHealth.marketplaceAuthorized).to.equal(false);
    expect(gatewayHealth.allHealthy).to.equal(false);
    expect(await f.token.totalSupply()).to.equal(before.supply);
    expect(await f.ledger.totalNetAssets()).to.equal(before.assets);
    expect(await f.marketplace.orderCount()).to.equal(before.orders);
    expect(await f.usdt.balanceOf(await f.marketplace.getAddress())).to.equal(before.marketplaceUSDT);
  });

  it("reports explicit Marketplace authorization and matches Lens through Gateway", async () => {
    const f = await fixture();
    const lensHealth = await f.lens.getWiringHealth();
    const gatewayHealth = await f.gateway.getWiringHealth();

    expect(lensHealth.marketplaceAuthorized).to.equal(true);
    expect(lensHealth.allHealthy).to.equal(true);
    expect(gatewayHealth.marketplaceAuthorized).to.equal(lensHealth.marketplaceAuthorized);
    expect(gatewayHealth.allHealthy).to.equal(lensHealth.allHealthy);
  });

  it("reports a correctly shaped but wrong Marketplace address as unhealthy", async () => {
    const f = await fixture();
    const wrongMarketplace = await ethers.deployContract("MarketplaceWiringMock", [
      await f.token.getAddress(),
      await f.usdt.getAddress(),
      await f.ledger.getAddress(),
      await f.vault.getAddress(),
      await f.settlement.getAddress(),
    ]);
    await wrongMarketplace.waitForDeployment();

    const lens = await ethers.deployContract("AVSProtocolLens", [
      await f.token.getAddress(),
      await f.usdt.getAddress(),
      await f.ledger.getAddress(),
      await f.vault.getAddress(),
      await wrongMarketplace.getAddress(),
      await f.settlement.getAddress(),
      await f.policy.getAddress(),
      await f.migration.getAddress(),
      1,
    ]);
    await lens.waitForDeployment();
    const health = await lens.getWiringHealth();

    expect(health.marketplaceAuthorized).to.equal(false);
    expect(health.allHealthy).to.equal(false);
  });

  it("keeps unrelated wiring failures false", async () => {
    const f = await fixture();
    const badMarketplace = await ethers.deployContract("MarketplaceWiringMock", [
      await f.usdt.getAddress(),
      await f.usdt.getAddress(),
      await f.ledger.getAddress(),
      await f.vault.getAddress(),
      await f.settlement.getAddress(),
    ]);
    await badMarketplace.waitForDeployment();

    const lens = await ethers.deployContract("AVSProtocolLens", [
      await f.token.getAddress(),
      await f.usdt.getAddress(),
      await f.ledger.getAddress(),
      await f.vault.getAddress(),
      await badMarketplace.getAddress(),
      await f.settlement.getAddress(),
      await f.policy.getAddress(),
      await f.migration.getAddress(),
      1,
    ]);
    await lens.waitForDeployment();
    const health = await lens.getWiringHealth();

    expect(health.marketplaceToken).to.equal(false);
    expect(health.allHealthy).to.equal(false);
  });

  it("keeps health reads view-only and economically inert", async () => {
    const f = await fixture();
    const before = {
      block: await ethers.provider.getBlockNumber(),
      supply: await f.token.totalSupply(),
      assets: await f.ledger.totalNetAssets(),
      orders: await f.marketplace.orderCount(),
    };

    await f.lens.getWiringHealth.staticCall();
    await f.gateway.getWiringHealth.staticCall();

    expect(await ethers.provider.getBlockNumber()).to.equal(before.block);
    expect(await f.token.totalSupply()).to.equal(before.supply);
    expect(await f.ledger.totalNetAssets()).to.equal(before.assets);
    expect(await f.marketplace.orderCount()).to.equal(before.orders);
  });

  it("reports non-canonical Lens wiring and rejects mismatched Gateway modules", async () => {
    const f = await fixture();
    const nonCanonicalLens = await ethers.deployContract("AVSProtocolLens", [
      await f.token.getAddress(),
      await f.token.getAddress(),
      await f.ledger.getAddress(),
      await f.vault.getAddress(),
      await f.marketplace.getAddress(),
      await f.settlement.getAddress(),
      await f.policy.getAddress(),
      await f.migration.getAddress(),
      1,
    ]);
    await nonCanonicalLens.waitForDeployment();
    expect((await nonCanonicalLens.getWiringHealth()).marketplaceUSDT).to.equal(false);
    expect((await nonCanonicalLens.getWiringHealth()).allHealthy).to.equal(false);

    const otherPolicy = await ethers.deployContract("AccountPolicyMock", [
      await f.owner.getAddress(),
      await f.token.getAddress(),
    ]);
    await otherPolicy.waitForDeployment();
    await expect(
      ethers.deployContract("AVSGateway", [
        await f.token.getAddress(),
        await f.ledger.getAddress(),
        await f.vault.getAddress(),
        await f.marketplace.getAddress(),
        await f.settlement.getAddress(),
        await otherPolicy.getAddress(),
        await f.migration.getAddress(),
        await f.lens.getAddress(),
        1,
      ]),
    ).to.be.revertedWithCustomError(f.gateway, "InvalidLensWiring");
  });

  it("exposes immutable discovery/version only and no privileged capability selectors", async () => {
    const f = await fixture();
    expect(await f.gateway.chainId()).to.equal((await ethers.provider.getNetwork()).chainId);
    expect(await f.gateway.deploymentGeneration()).to.equal(1n);
    expect(await f.gateway.protocolVersion()).to.deep.equal([1n, 1n, 0n]);
    expect(await f.gateway.moduleAddress(await f.gateway.MARKETPLACE_MODULE_ID())).to.equal(await f.marketplace.getAddress());
    expect(await f.gateway.moduleCodehash(await f.gateway.MARKETPLACE_MODULE_ID())).to.equal(ethers.keccak256(await ethers.provider.getCode(await f.marketplace.getAddress())));
    for (const signature of ["mint(address,uint256)", "withdraw(address,uint256)", "execute(address,bytes)", "setMarketplace(address)", "submitSettlement(bytes)"]) {
      expect(f.gateway.interface.hasFunction(signature)).to.equal(false);
    }
  });

  it("reports representative direct versus Gateway-routed gas", async () => {
    const directFixture = await fixture();
    const directReceipt = await (
      await directFixture.marketplace
        .connect(directFixture.buyer)
        .placeTriggeredBuy(SCALE, SCALE / 2n, 1)
    ).wait();

    const routedFixture = await fixture();
    const intent = {
      owner: await routedFixture.buyer.getAddress(),
      beneficiary: await routedFixture.buyer.getAddress(),
      quantityAVS: SCALE,
      triggerNAV: SCALE / 2n,
      requestedMaxMatches: 1n,
      nonce: 1n,
      deadline: await deadline(),
      deploymentGeneration: 1n,
    };
    const signature = await routedFixture.buyer.signTypedData(
      await domain(routedFixture.marketplace),
      { TriggeredBuyIntent: types.TriggeredBuyIntent },
      intent,
    );
    const routedReceipt = await (
      await routedFixture.gateway
        .connect(routedFixture.relayer)
        .placeTriggeredBuyWithSignature(intent, signature)
    ).wait();

    expect(directReceipt).not.to.equal(null);
    expect(routedReceipt).not.to.equal(null);
    console.info(
      `Access-layer gas: direct=${directReceipt!.gasUsed} routed=${routedReceipt!.gasUsed} overhead=${routedReceipt!.gasUsed - directReceipt!.gasUsed}`,
    );
  });
});