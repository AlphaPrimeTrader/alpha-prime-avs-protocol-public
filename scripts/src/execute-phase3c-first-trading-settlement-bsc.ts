import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { Wallet } from "ethers";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";

import { preflight } from "./phase3b-bsc-common.js";

const CONFIRMATION = "BSC_TESTNET_PHASE3C_ONE_SETTLEMENT_ONLY";
const CHAIN_ID = 97n;
const GENERATION = 1n;
const SCALE = 10n ** 18n;
const KEY_PATH = "/tmp/avs-phase3c-operational-keys.json";
const DEPLOYMENT_PATH =
  "deployments/bsc-testnet/phase3c-first-trading-settlement.json";
const EVIDENCE_DIRECTORY = ".local/phase3c-first-trading-settlement-evidence";
const EVIDENCE_PATH =
  `${EVIDENCE_DIRECTORY}/bsc-testnet-first-trading-settlement.json`;
const ZERO = "0x0000000000000000000000000000000000000000";

const addresses = {
  gateway: "0x53818cc4105b918042a3799e757771A4555C60F0",
  lens: "0x7ca0b7dD14A0991eBe029508e0F4Fa03cB0b007b",
  token: "0x20dddf3De5042cf23a1b94af2C660120c324e1Ac",
  ledger: "0x720B9af851C954Fb7749De6a4CF3369EDB3d5B8D",
  vault: "0x0E9f9cea8349F4718d08d23e003258c0f717edC3",
  settlement: "0x51F98c51E1E669d2a25df136a150401352586690",
  policy: "0xa6De468dd5A6222a1e5664124aB6975023AF0CF3",
  marketplace: "0x9AE0729C414995470b44Db8caB8fc08086520b33",
  usdt: "0x28c203F523feb6f6B7aE54d49bb6d7C1dEf9a9Db",
} as const;

if (process.env.PHASE3C_SETTLEMENT_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Execution disabled. Set PHASE3C_SETTLEMENT_CONFIRM=${CONFIRMATION}.`,
  );
}
if (
  (await readFile(DEPLOYMENT_PATH, "utf8").catch(() => null)) ||
  (await readFile(EVIDENCE_PATH, "utf8").catch(() => null))
) {
  throw new Error("Phase 3C evidence already exists; refusing a second settlement.");
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [admin] = await ethers.getSigners();
if (!admin) throw new Error("No BSC Testnet deployer signer is configured.");

const gateway = await ethers.getContractAt("AVSGateway", addresses.gateway);
const lens = await ethers.getContractAt("AVSProtocolLens", addresses.lens);
const token = await ethers.getContractAt("AVSToken", addresses.token);
const ledger = await ethers.getContractAt("AVSLedger", addresses.ledger);
const vault = await ethers.getContractAt("AVSVault", addresses.vault);
const settlement = await ethers.getContractAt(
  "AVSTradingSettlement",
  addresses.settlement,
);
const marketplace = await ethers.getContractAt(
  "AVSMarketplace",
  addresses.marketplace,
);
const usdt = await ethers.getContractAt("TestUSDT", addresses.usdt);

function plain(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value
      .filter((_item, index) => String(index) !== "")
      .map((item) => plain(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/^\d+$/.test(key))
        .map(([key, item]) => [key, plain(item)]),
    );
  }
  return value;
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(plain(value)));
}

function equal(label: string, actual: unknown, expected: unknown) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function equalJson(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(json(actual)) !== JSON.stringify(json(expected))) {
    throw new Error(`${label}: values differ.`);
  }
}

async function userBalances(account: string) {
  return {
    avs: (await token.balanceOf(account)).toString(),
    testUSDT: (await usdt.balanceOf(account)).toString(),
  };
}

async function physicalState() {
  const destination = await settlement.tradingDestination();
  return {
    marketplace: {
      avs: (await token.balanceOf(addresses.marketplace)).toString(),
      testUSDT: (await usdt.balanceOf(addresses.marketplace)).toString(),
    },
    vault: {
      avs: (await token.balanceOf(addresses.vault)).toString(),
      testUSDT: (await usdt.balanceOf(addresses.vault)).toString(),
    },
    settlement: {
      avs: (await token.balanceOf(addresses.settlement)).toString(),
      testUSDT: (await usdt.balanceOf(addresses.settlement)).toString(),
    },
    tradingDestination: {
      address: destination,
      avs: (await token.balanceOf(destination)).toString(),
      testUSDT: (await usdt.balanceOf(destination)).toString(),
    },
    gateway: {
      native: (await ethers.provider.getBalance(addresses.gateway)).toString(),
      avs: (await token.balanceOf(addresses.gateway)).toString(),
      testUSDT: (await usdt.balanceOf(addresses.gateway)).toString(),
    },
  };
}

async function economicState() {
  return {
    totalSupply: (await token.totalSupply()).toString(),
    totalNetAssets: (await ledger.totalNetAssets()).toString(),
    currentAVSValue: (await ledger.currentAVSValue()).toString(),
    totalGrossProfit: (await ledger.totalGrossProfit()).toString(),
    totalLoss: (await ledger.totalLoss()).toString(),
    totalBuybackAllocated: (await ledger.totalBuybackAllocated()).toString(),
    buybackReserve: (await ledger.buybackReserve()).toString(),
    protocolRevenue: (await marketplace.totalFeesCollected()).toString(),
    orderCount: (await marketplace.orderCount()).toString(),
    settlementCount: (await settlement.settlementCount()).toString(),
    physical: await physicalState(),
  };
}

const gatewayChainId = await gateway.chainId();
const gatewayGeneration = await gateway.deploymentGeneration();
const gatewayVersion = await gateway.protocolVersion();
const wiringHealth = await gateway.getWiringHealth();
const lensHealth = await lens.getWiringHealth();
const preflightSettlementCount = await settlement.settlementCount();
if (
  gatewayChainId !== CHAIN_ID ||
  gatewayGeneration !== GENERATION ||
  gatewayVersion.join(".") !== "1.1.0" ||
  !wiringHealth.allHealthy ||
  !wiringHealth.marketplaceAuthorized ||
  !lensHealth.allHealthy ||
  !lensHealth.marketplaceAuthorized ||
  preflightSettlementCount !== 0n
) {
  throw new Error(
    `Phase 3C preflight failed: ${JSON.stringify({
      gatewayChainId: gatewayChainId.toString(),
      gatewayGeneration: gatewayGeneration.toString(),
      gatewayVersion: gatewayVersion.map((value: bigint) => value.toString()),
      gatewayAllHealthy: wiringHealth.allHealthy,
      gatewayMarketplaceAuthorized: wiringHealth.marketplaceAuthorized,
      lensAllHealthy: lensHealth.allHealthy,
      lensMarketplaceAuthorized: lensHealth.marketplaceAuthorized,
      settlementCount: preflightSettlementCount.toString(),
    })}`,
  );
}
equal("Lens address exposed by Gateway", await gateway.moduleAddress(await gateway.PROTOCOL_LENS_MODULE_ID()), addresses.lens);
equal("Marketplace authorization", await token.isWhitelisted(addresses.marketplace), true);
equal("Settlement owner", await settlement.owner(), checked.deployer);

const roleStateBefore = {
  relayer: await settlement.authorizedRelayers(checked.deployer),
  tradeSigner: await settlement.authorizedTradeSigners(checked.deployer),
  serverSigner: await settlement.authorizedServerSigners(checked.deployer),
};
if (roleStateBefore.relayer || roleStateBefore.tradeSigner || roleStateBefore.serverSigner) {
  throw new Error("Deployer already occupies a settlement operational role.");
}

const preflightBlock = await ethers.provider.getBlockNumber();
const preflightState = await economicState();
const preflightProtocol = await gateway.getProtocolSnapshot();
const preflightMarketplace = await gateway.getMarketplaceSnapshot();

const keyText = await readFile(KEY_PATH, "utf8").catch(() => null);
const keys = keyText
  ? (JSON.parse(keyText) as {
      relayerPrivateKey: string;
      tradeSignerPrivateKey: string;
      serverSignerPrivateKey: string;
    })
  : {
      relayerPrivateKey: Wallet.createRandom().privateKey,
      tradeSignerPrivateKey: Wallet.createRandom().privateKey,
      serverSignerPrivateKey: Wallet.createRandom().privateKey,
    };
if (!keyText) {
  await writeFile(KEY_PATH, `${JSON.stringify(keys)}\n`, { mode: 0o600 });
  await chmod(KEY_PATH, 0o600);
}
const relayer = new Wallet(keys.relayerPrivateKey, ethers.provider);
const tradeSigner = new Wallet(keys.tradeSignerPrivateKey);
const serverSigner = new Wallet(keys.serverSignerPrivateKey);
const roleAddresses = {
  relayer: relayer.address,
  tradeSigner: tradeSigner.address,
  serverSigner: serverSigner.address,
};
if (
  new Set(Object.values(roleAddresses).map((value) => value.toLowerCase())).size !==
  3
) {
  throw new Error("Temporary settlement roles must be independent.");
}

type TxRecord = {
  label: string;
  hash: string;
  block: number;
  gasUsed: string;
  events?: unknown[];
};
const transactions: TxRecord[] = [];
let rolesConfigured = false;
let settlementSucceeded = false;

const interfaces: Record<string, any> = {
  AVSTradingSettlement: settlement.interface,
  AVSLedger: ledger.interface,
  AVSMarketplace: marketplace.interface,
};
function decodeEvents(receipt: any) {
  return receipt.logs.flatMap((log: any) => {
    for (const [name, iface] of Object.entries(interfaces)) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed) {
          return [{
            logIndex: log.index,
            address: log.address,
            contract: name,
            event: parsed.name,
            args: json(parsed.args),
          }];
        }
      } catch {
        // Try the next known protocol interface.
      }
    }
    return [];
  });
}

async function persist(record: any) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const content = `${JSON.stringify(json(record), null, 2)}\n`;
  await writeFile(EVIDENCE_PATH, content, "utf8");
  await writeFile(DEPLOYMENT_PATH, content, "utf8");
}

const record: any = {
  schemaVersion: 1,
  stage: "preflight_pass",
  network: "bscTestnet",
  chainId: "97",
  economicGeneration: "1",
  accessApiVersion: "1.1.0",
  currentGateway: addresses.gateway,
  currentLens: addresses.lens,
  economicModules: {
    token: addresses.token,
    ledger: addresses.ledger,
    vault: addresses.vault,
    settlement: addresses.settlement,
    marketplace: addresses.marketplace,
    accountPolicy: addresses.policy,
    testUSDT: addresses.usdt,
  },
  preflight: {
    block: preflightBlock,
    protocolVersion: (await gateway.protocolVersion()).map((value: bigint) =>
      value.toString(),
    ),
    deploymentGeneration: (await gateway.deploymentGeneration()).toString(),
    gatewayHealth: wiringHealth,
    lensHealth,
    settlementCount: "0",
    economicState: preflightState,
    protocolSnapshot: preflightProtocol,
    marketplaceSnapshot: preflightMarketplace,
    roleStateBefore,
  },
  temporaryOperationalRoles: roleAddresses,
  roleConfiguration: [],
  settlement: null,
  postSettlement: null,
  replayTest: null,
  invalidSignatureTest: null,
  cleanup: null,
};
await persist(record);

async function sendRole(label: string, action: Promise<any>) {
  const sent = await action;
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed.`);
  const tx: TxRecord = {
    label,
    hash: sent.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    events: decodeEvents(receipt),
  };
  transactions.push(tx);
  record.roleConfiguration.push(tx);
  await persist(record);
  return tx;
}

try {
  await sendRole("authorize temporary relayer", settlement.setRelayer(relayer.address, true));
  await sendRole(
    "authorize temporary trade signer",
    settlement.setTradeSigner(tradeSigner.address, true),
  );
  await sendRole(
    "authorize temporary server signer",
    settlement.setServerSigner(serverSigner.address, true),
  );
  rolesConfigured = true;
  const relayerFunding = await admin.sendTransaction({
    to: relayer.address,
    value: 10n ** 16n,
  });
  const relayerFundingReceipt = await relayerFunding.wait();
  if (!relayerFundingReceipt || relayerFundingReceipt.status !== 1) {
    throw new Error("Temporary relayer gas funding failed.");
  }
  const fundingTx: TxRecord = {
    label: "fund temporary relayer gas",
    hash: relayerFunding.hash,
    block: relayerFundingReceipt.blockNumber,
    gasUsed: relayerFundingReceipt.gasUsed.toString(),
    events: [],
  };
  transactions.push(fundingTx);
  record.roleConfiguration.push(fundingTx);
  await persist(record);

  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable.");
  const sequence = 1001n;
  const positionId = ethers.id("phase3c-first-real-trading-position-1001");
  const executionHash = ethers.id("phase3c-first-real-trading-execution-1001");
  const settlementId = await settlement.computeSettlementId(
    sequence,
    positionId,
    executionHash,
  );
  const core = {
    identity: { settlementId, positionId, sequence, executionHash },
    metadata: {
      strategy: "Cross-CEX Arbitrage",
      executionType: "FINAL_CLOSE",
      symbol: "BTC/USDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      venues: "Binance,KuCoin",
    },
    capital: {
      protocolCapitalUsd: 9_500n * SCALE,
      borrowedCapitalUsd: 0n,
      grossNotionalUsd: 60_000n * SCALE,
      quantity: SCALE,
      entryPrice: 60_000n * SCALE,
      exitPrice: 61_000n * SCALE,
      averageEntryPrice: 60_000n * SCALE,
    },
    economics: {
      grossPnlUsd: 110n * SCALE,
      tradingFeesUsd: 10n * SCALE,
      networkFeesUsd: 0n,
      financingFeesUsd: 0n,
      otherFeesUsd: 0n,
    },
    timing: {
      openedAt: BigInt(latest.timestamp - 3_600),
      closedAt: BigInt(latest.timestamp - 60),
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
      amountIn: 60_000n * SCALE,
      amountOut: SCALE,
      executionPrice: 60_000n * SCALE,
      externalReference: ethers.id("phase3c-binance-buy-1001"),
    },
    {
      legIndex: 1,
      venue: "KuCoin",
      action: "SELL",
      assetIn: "BTC",
      assetOut: "USDT",
      amountIn: SCALE,
      amountOut: 61_000n * SCALE,
      executionPrice: 61_000n * SCALE,
      externalReference: ethers.id("phase3c-kucoin-sell-1001"),
    },
  ];
  const extraFields = [
    { key: "riskBand", value: "A" },
    { key: "closeReason", value: "first-real-testnet-settlement" },
  ];
  const settlementHash = await settlement.computeSettlementHash(
    core,
    legs,
    extraFields,
  );
  const domain = {
    name: await settlement.DOMAIN_NAME(),
    version: await settlement.DOMAIN_VERSION(),
    chainId: CHAIN_ID,
    verifyingContract: addresses.settlement,
  };
  equal("EIP-712 domain name", domain.name, "Alpha Prime AVS Trading Settlement");
  equal("EIP-712 domain version", domain.version, "1");
  const types = {
    SettlementAuthorization: [
      { name: "settlementHash", type: "bytes32" },
    ],
  };
  const tradeSignature = await tradeSigner.signTypedData(
    domain,
    types,
    { settlementHash },
  );
  const serverSignature = await serverSigner.signTypedData(
    domain,
    types,
    { settlementHash },
  );
  const digest = await settlement.settlementDigest(settlementHash);
  equal("off-chain/on-chain digest", digest, ethers.TypedDataEncoder.hash(domain, types, { settlementHash }));
  equal("recovered trade signer", ethers.verifyTypedData(domain, types, { settlementHash }, tradeSignature), tradeSigner.address);
  equal("recovered server signer", ethers.verifyTypedData(domain, types, { settlementHash }, serverSignature), serverSigner.address);
  const authorization = {
    settlementHash,
    tradeSignature,
    serverSignature,
  };
  const netPnl = core.economics.grossPnlUsd - core.economics.tradingFeesUsd;
  const expectedBuyback = netPnl * 1_000n / 10_000n;
  const expectedHolderAssets = netPnl - expectedBuyback;
  equal("computed net PnL", netPnl, 100n * SCALE);
  equal("computed buyback allocation", expectedBuyback, 10n * SCALE);
  equal("computed holder allocation", expectedHolderAssets, 90n * SCALE);
  equal("settlement hash", await settlement.computeSettlementHash(core, legs, extraFields), settlementHash);

  record.settlement = {
    core,
    legs,
    extraFields,
    authorization: {
      settlementHash,
      tradeSignatureRecorded: true,
      serverSignatureRecorded: true,
    },
    domain,
    digest,
    settlementHash,
    settlementId,
    expected: {
      grossPnlUsd: (110n * SCALE).toString(),
      feesUsd: (10n * SCALE).toString(),
      netRealizedPnlUsd: netPnl.toString(),
      buybackAllocation: expectedBuyback.toString(),
      holderNetAssets: expectedHolderAssets.toString(),
    },
    positionId,
    sequence,
    executionHash,
    legsHash: await settlement.calculateLegsHash(legs),
    extrasHash: await settlement.calculateExtraFieldsHash(extraFields),
  };
  await persist(record);

  const sent = await settlement
    .connect(relayer) as any;
  const settlementSubmission = await sent
    .submitSettlement(core, legs, extraFields, authorization);
  const receipt = await settlementSubmission.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Settlement transaction failed.");
  settlementSucceeded = true;
  const settlementTx: TxRecord = {
    label: "submit exactly one finalized trading settlement",
    hash: settlementSubmission.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    events: decodeEvents(receipt),
  };
  transactions.push(settlementTx);
  record.settlement.transaction = settlementTx;
  record.stage = "settlement_submitted";
  await persist(record);

  const certificationBlock = await ethers.provider.getBlockNumber();
  if (certificationBlock < receipt.blockNumber) {
    throw new Error("RPC head is behind settlement receipt block.");
  }
  const postGatewayHealth = await gateway.getWiringHealth({ blockTag: certificationBlock });
  const postProtocol = await gateway.getProtocolSnapshot({ blockTag: certificationBlock });
  const postMarketplace = await gateway.getMarketplaceSnapshot({ blockTag: certificationBlock });
  const settlementIds = await settlement.getSettlementIds(0, 100, { blockTag: certificationBlock });
  const gatewaySettlementSummaries = await gateway.getSettlementSummaries(0, 100, { blockTag: certificationBlock });
  const settlementRecord = await gateway.getSettlement(settlementId, { blockTag: certificationBlock });
  const settlementDetails = await gateway.getSettlementDetails(settlementId, { blockTag: certificationBlock });
  const postState = await economicState();
  const expectedState = {
    ...preflightState,
    totalNetAssets: (BigInt(preflightState.totalNetAssets) + expectedHolderAssets).toString(),
    currentAVSValue: (await ledger.currentAVSValue()).toString(),
    totalGrossProfit: (BigInt(preflightState.totalGrossProfit) + netPnl).toString(),
    totalBuybackAllocated: (BigInt(preflightState.totalBuybackAllocated) + expectedBuyback).toString(),
    buybackReserve: (BigInt(preflightState.buybackReserve) + expectedBuyback).toString(),
    settlementCount: "1",
  };
  equal("total supply unchanged", postState.totalSupply, preflightState.totalSupply);
  equal("total net assets delta", BigInt(postState.totalNetAssets) - BigInt(preflightState.totalNetAssets), expectedHolderAssets);
  equal("gross profit delta", BigInt(postState.totalGrossProfit) - BigInt(preflightState.totalGrossProfit), netPnl);
  equal("buyback allocation delta", BigInt(postState.totalBuybackAllocated) - BigInt(preflightState.totalBuybackAllocated), expectedBuyback);
  equal("buyback reserve delta", BigInt(postState.buybackReserve) - BigInt(preflightState.buybackReserve), expectedBuyback);
  equal("loss unchanged", postState.totalLoss, preflightState.totalLoss);
  equal("protocol revenue unchanged", postState.protocolRevenue, preflightState.protocolRevenue);
  equal("order count unchanged", postState.orderCount, preflightState.orderCount);
  equal("settlement count", postState.settlementCount, "1");
  equalJson("physical balances unchanged", postState.physical, preflightState.physical);
  if (!postGatewayHealth.allHealthy || !postGatewayHealth.marketplaceAuthorized) {
    throw new Error("Access API health failed after settlement.");
  }
  equal("snapshot NAV matches Ledger", postProtocol.currentNAV, postState.currentAVSValue);
  equal("snapshot supply matches Ledger", postProtocol.totalSupply, postState.totalSupply);
  equal("snapshot settlement count", postProtocol.settlementCount, "1");
  equal("snapshot order count", postMarketplace.orderCount, postState.orderCount);
  equal("settlement pagination count", settlementIds.length, 1);
  equal("Gateway summary count", gatewaySettlementSummaries.length, 1);
  equal("settlement ID discoverable", settlementIds[0], settlementId);
  equal("settlement summary ID", gatewaySettlementSummaries[0].settlementId, settlementId);
  equal("archived record ID", settlementRecord.settlementId, settlementId);
  equal("archived record position", settlementRecord.positionId, positionId);
  equal("archived record sequence", settlementRecord.sequence, sequence);
  equal("archived record execution hash", settlementRecord.executionHash, executionHash);
  equal("detail accounting net PnL", settlementDetails.accounting.netRealizedPnlUsd, netPnl);
  equal("detail accounting gross PnL", settlementDetails.accounting.grossPnlUsd, core.economics.grossPnlUsd);
  equal("detail accounting fees", settlementDetails.accounting.totalFeesUsd, core.economics.tradingFeesUsd);
  equal("detail display strategy", settlementDetails.display.strategy, core.metadata.strategy);
  equal("detail display symbol", settlementDetails.display.symbol, core.metadata.symbol);
  equal("detail sequence", settlementDetails.record.sequence, sequence);

  const replay = {
    reverted: false,
    errorName: null as string | null,
    selector: null as string | null,
  };
  try {
    await (settlement.connect(relayer) as any).submitSettlement.staticCall(
      core,
      legs,
      extraFields,
      authorization,
    );
  } catch (error: any) {
    replay.reverted = true;
    replay.errorName = error?.errorName ?? error?.info?.error?.errorName ?? null;
    replay.selector = error?.data ?? error?.info?.error?.data ?? null;
  }
  if (!replay.reverted) throw new Error("Settlement replay eth_call did not revert.");
  record.replayTest = replay;

  const mutatedCore = {
    ...core,
    economics: { ...core.economics, grossPnlUsd: core.economics.grossPnlUsd + 1n },
  };
  const invalidSignature = {
    reverted: false,
    errorName: null as string | null,
    selector: null as string | null,
  };
  try {
    await (settlement.connect(relayer) as any).submitSettlement.staticCall(
      mutatedCore,
      legs,
      extraFields,
      authorization,
    );
  } catch (error: any) {
    invalidSignature.reverted = true;
    invalidSignature.errorName = error?.errorName ?? error?.info?.error?.errorName ?? null;
    invalidSignature.selector = error?.data ?? error?.info?.error?.data ?? null;
  }
  if (!invalidSignature.reverted) {
    throw new Error("Mutated settlement eth_call did not revert.");
  }
  record.invalidSignatureTest = invalidSignature;
  record.postSettlement = {
    certificationBlock,
    economicState: postState,
    expectedState,
    gatewayHealth: postGatewayHealth,
    protocolSnapshot: postProtocol,
    marketplaceSnapshot: postMarketplace,
    settlementPaginationOldestFirst: settlementIds,
    settlementPaginationNewestFirst: settlementIds,
    settlementSummary: gatewaySettlementSummaries[0],
    settlementRecord,
    settlementDetails,
    marketplaceHookEvents: (settlementTx.events ?? []).filter((event: any) =>
      event.event === "MarketplaceProcessingSucceeded" ||
      event.event === "MarketplaceProcessingDeferred",
    ),
  };
  record.stage = "readback_pass";
  await persist(record);
} finally {
  if (rolesConfigured) {
    const cleanupTransactions: TxRecord[] = [];
    for (const [label, build] of [
      ["revoke temporary relayer", () => settlement.setRelayer(relayer.address, false)],
      ["revoke temporary trade signer", () => settlement.setTradeSigner(tradeSigner.address, false)],
      ["revoke temporary server signer", () => settlement.setServerSigner(serverSigner.address, false)],
    ] as const) {
      const sent = await build();
      const receipt = await sent.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error(`${label} failed.`);
      }
      const tx: TxRecord = {
        label,
        hash: sent.hash,
        block: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        events: decodeEvents(receipt),
      };
      cleanupTransactions.push(tx);
      transactions.push(tx);
    }
    const cleanup: any = {
      transactions: cleanupTransactions,
      relayerAuthorized: await settlement.authorizedRelayers(relayer.address),
      tradeSignerAuthorized: await settlement.authorizedTradeSigners(tradeSigner.address),
      serverSignerAuthorized: await settlement.authorizedServerSigners(serverSigner.address),
      keysDeleted: false,
    };
    if (
      cleanup.relayerAuthorized ||
      cleanup.tradeSignerAuthorized ||
      cleanup.serverSignerAuthorized
    ) {
      throw new Error("Temporary settlement role cleanup readback failed.");
    }
    const relayerBalance = await ethers.provider.getBalance(relayer.address);
    if (relayerBalance > 0n) {
      const feeData = await ethers.provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? 0n;
      const gasLimit = 21_000n;
      const returnAmount = relayerBalance > gasPrice * gasLimit
        ? relayerBalance - gasPrice * gasLimit
        : 0n;
      if (returnAmount > 0n) {
        const returned = await relayer.sendTransaction({
          to: checked.deployer,
          value: returnAmount,
          gasLimit,
        });
        const returnedReceipt = await returned.wait();
        if (!returnedReceipt || returnedReceipt.status !== 1) {
          throw new Error("Temporary relayer gas return failed.");
        }
        cleanup.transactions.push({
          label: "return unused temporary relayer gas",
          hash: returned.hash,
          block: returnedReceipt.blockNumber,
          gasUsed: returnedReceipt.gasUsed.toString(),
          events: [],
        });
      }
    }
    cleanup.relayerNativeBalance = (
      await ethers.provider.getBalance(relayer.address)
    ).toString();
    record.cleanup = cleanup;
    record.stage = settlementSucceeded ? "pass" : record.stage;
    await persist(record);
    await unlink(KEY_PATH).catch(() => undefined);
    record.cleanup.keysDeleted = true;
    await persist(record);
  }
}

if (!settlementSucceeded) {
  throw new Error("Phase 3C settlement did not complete.");
}

console.log("PHASE_3C_FIRST_REAL_TRADING_SETTLEMENT_BSC_TESTNET=PASS");
console.log("ECONOMIC_GENERATION=1");
console.log("ACCESS_API_VERSION=1.1.0");
console.log(`SETTLEMENT_TX=${record.settlement.transaction.hash}`);
console.log(`SETTLEMENT_BLOCK=${record.settlement.transaction.block}`);
console.log(`SETTLEMENT_ID=${record.settlement.settlementId}`);
console.log(`CERTIFICATION_BLOCK=${record.postSettlement.certificationBlock}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log(`PRIVATE_EVIDENCE=${EVIDENCE_PATH}`);
console.log("SETTLEMENT_COUNT=1");
console.log("NET_PNL=100000000000000000000");
console.log("HOLDER_NET_ASSETS_DELTA=90000000000000000000");
console.log("BUYBACK_DELTA=10000000000000000000");
console.log("SUPPLY_UNCHANGED=true");
console.log("PHYSICAL_CAPITAL_RETURN=false");
console.log("PROTOCOL_REVENUE_DOUBLE_COUNT=false");
console.log("MARKETPLACE_USER_TRANSACTION=false");
console.log("MIGRATION=false");
console.log("LOCK=false");
console.log("RENOUNCE=false");
console.log("MAINNET=false");
console.log("COMMIT=false");
console.log("PUSH=false");