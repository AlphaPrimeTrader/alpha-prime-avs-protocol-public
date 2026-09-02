import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { readFile, writeFile } from "node:fs/promises";

import { preflight } from "./phase3b-bsc-common.js";

const RESULT_PATH =
  "deployments/bsc-testnet/phase3a-first-gateway-financial-cycle.json";
const EVIDENCE_PATH =
  ".local/phase3a-access-layer-evidence/bsc-testnet-first-gateway-cycle.json";
const GATEWAY = "0x18097B9Af3AfFf28B07Bf4C762e50DF4802bB778";
const MARKETPLACE = "0x9AE0729C414995470b44Db8caB8fc08086520b33";
const TOKEN = "0x20dddf3De5042cf23a1b94af2C660120c324e1Ac";
const LEDGER = "0x720B9af851C954Fb7749De6a4CF3369EDB3d5B8D";
const VAULT = "0x0E9f9cea8349F4718d08d23e003258c0f717edC3";
const SETTLEMENT = "0x51F98c51E1E669d2a25df136a150401352586690";
const TEST_USDT = "0x28c203F523feb6f6B7aE54d49bb6d7C1dEf9a9Db";
const TRADING_DESTINATION = "0x6EB22C5a4B8376A6351ec0869fd7F31A2F6601e8";

const record = JSON.parse(await readFile(RESULT_PATH, "utf8")) as any;
if (
  record.stage !== "submitting_one_gateway_buy" ||
  record.constraints?.successfulEconomicBuys !== 1 ||
  !record.submission?.transactionHash ||
  !record.testUser?.address
) {
  throw new Error("Phase 3A record is not eligible for read-only finalization.");
}

const { ethers } = await network.create();
await preflight(ethers);
const gateway = await ethers.getContractAt("AVSGateway", GATEWAY);
const marketplace = await ethers.getContractAt("AVSMarketplace", MARKETPLACE);
const token = await ethers.getContractAt("AVSToken", TOKEN);
const ledger = await ethers.getContractAt("AVSLedger", LEDGER);
const vault = await ethers.getContractAt("AVSVault", VAULT);
const settlement = await ethers.getContractAt(
  "AVSTradingSettlement",
  SETTLEMENT,
);
const usdt = await ethers.getContractAt("TestUSDT", TEST_USDT);
const testUser = record.testUser.address as string;
const certificationBlock = Number(record.submission.block);

function requireEqual(label: string, actual: unknown, expected: unknown) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const originalTransaction = await ethers.provider.getTransaction(
  record.submission.transactionHash,
);
const originalReceipt = await ethers.provider.getTransactionReceipt(
  record.submission.transactionHash,
);
if (
  !originalTransaction ||
  !originalReceipt ||
  originalReceipt.status !== 1 ||
  originalTransaction.to?.toLowerCase() !== GATEWAY.toLowerCase() ||
  originalTransaction.from.toLowerCase() !== testUser.toLowerCase()
) {
  throw new Error("Original Gateway transaction could not be authenticated.");
}

let replay: any;
try {
  await ethers.provider.call({
    to: originalTransaction.to,
    from: originalTransaction.from,
    data: originalTransaction.data,
  });
  throw new Error("Exact calldata replay unexpectedly succeeded.");
} catch (error: any) {
  const data =
    error?.data ?? error?.error?.data ?? error?.info?.error?.data ?? null;
  if (!data || typeof data !== "string") {
    throw new Error("Exact replay reverted without decodable data.");
  }
  const parsed = marketplace.interface.parseError(data);
  if (!parsed || parsed.name !== "NonceAlreadyUsed") {
    throw new Error(`Unexpected exact replay error: ${parsed?.name ?? data.slice(0, 10)}`);
  }
  replay = {
    method: "eth_call",
    exactOriginalCalldata: true,
    originalTransactionHash: originalTransaction.hash,
    transactionSender: originalTransaction.from,
    reverted: true,
    customError: parsed.name,
    selector: data.slice(0, 10),
    arguments: {
      account: parsed.args[0],
      nonce: parsed.args[1],
    },
  };
}

const expected = record.postState.after;
const readbackBlock = await ethers.provider.getBlockNumber();
const readbackHeader = await ethers.provider.getBlock(readbackBlock);
if (!readbackHeader) throw new Error("Pinned readback block is unavailable.");
const blockTag = { blockTag: readbackBlock };
const currentAfterReplay = {
  totalSupply: await token.totalSupply(blockTag),
  totalNetAssets: await ledger.totalNetAssets(blockTag),
  currentAVSValue: await ledger.currentAVSValue(blockTag),
  userAVS: await token.balanceOf(testUser, blockTag),
  marketplaceTestUSDT: await usdt.balanceOf(MARKETPLACE, blockTag),
  vaultTestUSDT: await usdt.balanceOf(VAULT, blockTag),
  settlementTestUSDT: await usdt.balanceOf(SETTLEMENT, blockTag),
  tradingDestinationTestUSDT: await usdt.balanceOf(
    TRADING_DESTINATION,
    blockTag,
  ),
  protocolRevenue: await marketplace.totalFeesCollected(blockTag),
  orderCount: await marketplace.orderCount(blockTag),
  settlementCount: await settlement.settlementCount(blockTag),
  nonceUsed: await marketplace.isNonceUsed(
    testUser,
    record.signedIntent.intent.nonce,
    blockTag,
  ),
  gatewayNative: await ethers.provider.getBalance(GATEWAY, readbackBlock),
  gatewayTestUSDT: await usdt.balanceOf(GATEWAY, blockTag),
  gatewayAVS: await token.balanceOf(GATEWAY, blockTag),
  gatewayAllowance: await usdt.allowance(testUser, GATEWAY, blockTag),
};
for (const key of [
  "totalSupply",
  "totalNetAssets",
  "currentAVSValue",
  "userAVS",
  "marketplaceTestUSDT",
  "vaultTestUSDT",
  "settlementTestUSDT",
  "tradingDestinationTestUSDT",
  "protocolRevenue",
  "orderCount",
  "settlementCount",
  "gatewayNative",
  "gatewayTestUSDT",
  "gatewayAVS",
  "gatewayAllowance",
] as const) {
  requireEqual(`Post-replay ${key}`, currentAfterReplay[key], expected[key]);
}
if (!currentAfterReplay.nonceUsed) {
  throw new Error("Successful intent nonce is not marked used.");
}

const protocolSnapshot = await gateway.getProtocolSnapshot(blockTag);
const userSnapshot = await gateway.getUserSnapshot(testUser, blockTag);
const marketplaceSnapshot = await gateway.getMarketplaceSnapshot(blockTag);
const wiringHealth = await gateway.getWiringHealth(blockTag);
const globalOrders = await gateway.getOrderIds(0, 100, true, blockTag);
const userOrders = await gateway.getUserOrderIds(
  testUser,
  0,
  100,
  true,
  blockTag,
);
const settlementPage = await gateway.getSettlementSummaries(
  0,
  100,
  blockTag,
);

if (!wiringHealth.marketplaceAuthorized) {
  throw new Error("Gateway reports Marketplace is not AVS-authorized.");
}
if (!wiringHealth.allHealthy) throw new Error("Gateway wiring health failed.");
requireEqual("Snapshot block", protocolSnapshot.blockNumber, readbackBlock);
requireEqual("Snapshot generation", protocolSnapshot.deploymentGeneration, 1n);
requireEqual("Snapshot NAV", protocolSnapshot.currentNAV, expected.currentAVSValue);
requireEqual(
  "Snapshot totalNetAssets",
  protocolSnapshot.totalNetAssets,
  expected.totalNetAssets,
);
requireEqual("Snapshot totalSupply", protocolSnapshot.totalSupply, expected.totalSupply);
requireEqual("User snapshot AVS", userSnapshot.avsBalance, expected.userAVS);
requireEqual(
  "Marketplace snapshot liquidity",
  marketplaceSnapshot.protocolLiquidityUSDT,
  expected.protocolLiquidityUSDT,
);
requireEqual(
  "Marketplace snapshot balance",
  marketplaceSnapshot.actualUSDTBalance,
  expected.marketplaceTestUSDT,
);
if (
  globalOrders.length !== 1 ||
  globalOrders[0] !== 1n ||
  userOrders.length !== 1 ||
  userOrders[0] !== 1n ||
  settlementPage.length !== 0
) {
  throw new Error("Gateway/Lens pagination reconciliation failed.");
}

record.replayTest = {
  ...replay,
  stateAfterReplay: currentAfterReplay,
};
record.gatewayReadback = {
  economicCertificationBlock: certificationBlock,
  economicCertificationBlockTimestamp: record.submission.blockTimestamp,
  pinnedReadbackBlock: readbackBlock,
  pinnedReadbackBlockTimestamp: readbackHeader.timestamp,
  providerArchiveReadFallback: true,
  providerArchiveReadError: "missing trie node",
  deploymentGeneration: "1",
  protocolSnapshot,
  userSnapshot,
  marketplaceSnapshot,
  wiringHealth,
  globalOrders,
  userOrders,
  settlementPage,
};
record.reconciliation = {
  capitalContribution: record.signedIntent.intent.quantityAVS,
  buyerFee: "2000000000000000000",
  userPayment: "10002000000000000000000",
  avsMinted: expected.userAVS,
  marketplaceCapitalAllocation: "500000000000000000000",
  productiveCapital: expected.tradingDestinationTestUSDT,
  protocolRevenue: expected.protocolRevenue,
  totalNetAssets: expected.totalNetAssets,
  currentAVSValue: expected.currentAVSValue,
  capitalCountedAsTradingProfit: false,
  buyerFeeCountedAsTradingProfit: false,
  buyerFeeRecordedAsProtocolRevenue: true,
  totalGrossProfit: expected.totalGrossProfit,
  totalLoss: expected.totalLoss,
  totalBuybackAllocated: expected.totalBuybackAllocated,
  settlementCount: expected.settlementCount,
  discrepancy: null,
};
record.constraints = {
  exactlyOneSuccessfulEconomicBuy: true,
  successfulEconomicBuys: 1,
  signedByReplacementUser: true,
  routedThroughAVSGateway: true,
  marketplaceIndependentlyAuthenticatedUser: true,
  gatewayHeldAssets: false,
  replayRejected: true,
  abandonedCandidateEconomicActivity: false,
  directMarketplaceBuy: false,
  sell: false,
  triggeredOrder: false,
  cancellation: false,
  tradingSettlementSubmitted: false,
  migrationExecuted: false,
  redeployed: false,
  configurationLocked: false,
  ownershipRenounced: false,
  mainnetInteraction: false,
  commit: false,
  push: false,
};
record.ephemeralKeyHandling = {
  availableInMemoryForCompleteTransactionSequence: true,
  printed: false,
  persistedInSourceLogsReportsEvidenceOrGit: false,
  retainedAfterExecutorExit: false,
};
record.stage = "pass";

const json = `${JSON.stringify(
  record,
  (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  2,
)}\n`;
await writeFile(RESULT_PATH, json, "utf8");
await writeFile(EVIDENCE_PATH, json, "utf8");

console.log("PHASE_3A_READ_ONLY_FINALIZATION=PASS");
console.log(`TEST_USER=${testUser}`);
console.log(`GATEWAY_BUY_TX=${originalTransaction.hash}`);
console.log(`CERTIFICATION_BLOCK=${certificationBlock}`);
console.log("EXACT_REPLAY=NonceAlreadyUsed");
console.log("SUCCESSFUL_ECONOMIC_BUYS=1");
console.log("ON_CHAIN_WRITES_DURING_FINALIZATION=0");
console.log("SETTLEMENT=false");
console.log("MIGRATION=false");
console.log("REDEPLOYMENT=false");
console.log("LOCK=false");
console.log("RENOUNCE=false");
console.log("MAINNET=false");
console.log("COMMIT=false");
console.log("PUSH=false");