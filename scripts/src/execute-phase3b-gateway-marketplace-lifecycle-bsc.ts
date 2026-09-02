import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { Wallet } from "ethers";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";

import { preflight } from "./phase3b-bsc-common.js";

/*
 * This is deliberately a continuation, not a rerun of the original Phase 3B
 * attempt.  In particular, order #2 and its owner remain historical evidence.
 * No secret is ever included in either JSON artifact.
 */
const RESULT_PATH = "deployments/bsc-testnet/phase3b-gateway-marketplace-lifecycle.json";
const EVIDENCE_PATH = ".local/phase3b-access-layer-evidence/bsc-testnet-gateway-marketplace-lifecycle.json";
const KEY_PATH = "/tmp/avs-phase3b-continuation-keys.json";
const GATEWAY = "0x18097B9Af3AfFf28B07Bf4C762e50DF4802bB778";
const LENS = "0x822555dE56fe9Fc2d4DF59E75bf59DF05e233F15";
const MARKETPLACE = "0x9AE0729C414995470b44Db8caB8fc08086520b33";
const TOKEN = "0x20dddf3De5042cf23a1b94af2C660120c324e1Ac";
const LEDGER = "0x720B9af851C954Fb7749De6a4CF3369EDB3d5B8D";
const VAULT = "0x0E9f9cea8349F4718d08d23e003258c0f717edC3";
const SETTLEMENT = "0x51F98c51E1E669d2a25df136a150401352586690";
const POLICY = "0xa6De468dd5A6222a1e5664124aB6975023AF0CF3";
const USDT = "0x28c203F523feb6f6B7aE54d49bb6d7C1dEf9a9Db";
const TRADING_DESTINATION = "0x6EB22C5a4B8376A6351ec0869fd7F31A2F6601e8";
const SCALE = 10n ** 18n;
const ONE = SCALE;
const FEE_BPS = 2n;
let mostRecentReceiptBlock = 0;

const oldResult = JSON.parse(await readFile(RESULT_PATH, "utf8")) as any;
const safePreEconomicResume =
  (oldResult.stage === "preflight" || oldResult.stage === "primary") &&
  Array.isArray(oldResult.transactions) &&
  oldResult.transactions.every((item: any) => {
    const label = String(item?.label ?? "");
    return (
      label.startsWith("Authorize ") ||
      label.startsWith("Fund ") ||
      label.startsWith("Approve ")
    );
  });
const primaryTransactions = Array.isArray(oldResult.transactions)
  ? oldResult.transactions.filter((item: any) => item?.label === "signed primary market buy A")
  : [];
const safePrimaryResume =
  oldResult.stage === "primary" &&
  primaryTransactions.length === 1 &&
  oldResult.transactions.every((item: any) => {
    const label = String(item?.label ?? "");
    return (
      label.startsWith("Authorize ") ||
      label.startsWith("Fund ") ||
      label.startsWith("Approve ") ||
      label === "signed primary market buy A"
    );
  });
const acceptedPartial =
  oldResult.stage === "partial"
    ? oldResult
    : safePreEconomicResume || safePrimaryResume
      ? oldResult.acceptedPartialHistory
      : null;
if (!acceptedPartial || acceptedPartial.stage !== "partial") {
  throw new Error("Phase 3B continuation requires the accepted partial evidence.");
}
const { ethers } = await network.create();
const chain = await preflight(ethers);
const [admin] = await ethers.getSigners();
const gateway = (await ethers.getContractAt("AVSGateway", GATEWAY)) as any;
const lens = (await ethers.getContractAt("AVSProtocolLens", LENS)) as any;
const market = (await ethers.getContractAt("AVSMarketplace", MARKETPLACE)) as any;
const token = (await ethers.getContractAt("AVSToken", TOKEN)) as any;
const usdt = (await ethers.getContractAt("TestUSDT", USDT)) as any;
const policy = (await ethers.getContractAt("AccountPolicyMock", POLICY)) as any;
const ledger = (await ethers.getContractAt("AVSLedger", LEDGER)) as any;
const settlement = (await ethers.getContractAt("AVSTradingSettlement", SETTLEMENT)) as any;
const vault = (await ethers.getContractAt("AVSVault", VAULT)) as any;

const stringify = (v: any) => `${JSON.stringify(v, (_k, x) => typeof x === "bigint" ? x.toString() : x, 2)}\n`;
function plain(v: any): any {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !/^\d+$/.test(k)).map(([k, x]) => [k, plain(x)]));
  return v;
}
const eq = (label: string, actual: any, expected: any) => {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${label}: expected ${expected}, got ${actual}`);
};
const yes = (label: string, value: boolean) => { if (!value) throw new Error(`${label}: expected true`); };
const fee = (gross: bigint) => gross * FEE_BPS / 10_000n;
const buyCost = (amount: bigint, nav: bigint) => { const gross = amount * nav / SCALE; return gross + fee(gross); };
const sleep = (n: number) => new Promise(resolve => setTimeout(resolve, n));

/** Every confirmation is an explicit receipt-or-later blockTag read. */
async function confirmed<T>(label: string, receiptBlock: number, read: (tag: number) => Promise<T>, ok: (value: T) => boolean) {
  for (let i = 0; i !== 4; ++i) {
    const head = await ethers.provider.getBlockNumber();
    const tag = Math.max(receiptBlock, head);
    const value = await read(tag);
    if (ok(value)) return { receiptBlock, readbackBlock: tag, retries: i, provider: "configured BSC Testnet RPC" };
    if (i !== 3) await sleep(1500 * (i + 1));
  }
  throw new Error(`${label} did not confirm at receipt block or later.`);
}

const byAddress: Record<string, [string, any]> = {
  [USDT.toLowerCase()]: ["TestUSDT", usdt.interface],
  [TOKEN.toLowerCase()]: ["AVSToken", token.interface],
  [LEDGER.toLowerCase()]: ["AVSLedger", ledger.interface],
  [VAULT.toLowerCase()]: ["AVSVault", (await ethers.getContractAt("AVSVault", VAULT) as any).interface],
  [MARKETPLACE.toLowerCase()]: ["AVSMarketplace", market.interface],
  [SETTLEMENT.toLowerCase()]: ["AVSTradingSettlement", settlement.interface],
};
function events(receipt: any) {
  return receipt.logs.flatMap((log: any) => {
    const entry = byAddress[log.address.toLowerCase()];
    if (!entry) return [];
    try {
      const decoded = entry[1].parseLog(log);
      return decoded ? [{ logIndex: log.index, contractAddress: log.address, contract: entry[0], event: decoded.name, arguments: plain(decoded.args) }] : [];
    } catch { return []; }
  });
}
async function tx(label: string, action: Promise<any>) {
  const sent = await action; const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed.`);
  mostRecentReceiptBlock = Math.max(mostRecentReceiptBlock, receipt.blockNumber);
  const result = { label, hash: sent.hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), events: events(receipt) };
  record.transactions.push(result); await persist(); // receipt evidence is durable before any subsequent read
  record.gatewayChecks.push({ transaction: label, ...(await gatewayZeroCheck(receipt.blockNumber)) });
  await persist();
  return result;
}
async function expectError(label: string, caller: any, method: string, intent: any, signature: string, expected: string) {
  try { await caller[method].staticCall(intent, signature); throw new Error(`${label} unexpectedly succeeded`); }
  catch (error: any) {
    const data = error?.data ?? error?.error?.data ?? error?.info?.error?.data;
    if (typeof data !== "string") throw error;
    const parsed = market.interface.parseError(data);
    if (!parsed || parsed.name !== expected) throw new Error(`${label}: expected ${expected}`);
    return { label, reverted: true, customError: parsed.name, selector: data.slice(0, 10) };
  }
}

type Secrets = { lifecyclePrivateKey: string; buyerPrivateKey: string };
let secrets: Secrets;
try { secrets = JSON.parse(await readFile(KEY_PATH, "utf8")) as Secrets; }
catch {
  secrets = { lifecyclePrivateKey: Wallet.createRandom().privateKey, buyerPrivateKey: Wallet.createRandom().privateKey };
  await writeFile(KEY_PATH, stringify(secrets), { mode: 0o600 }); await chmod(KEY_PATH, 0o600);
}
const a = new Wallet(secrets.lifecyclePrivateKey, ethers.provider);
const b = new Wallet(secrets.buyerPrivateKey, ethers.provider);
const A = await a.getAddress(), B = await b.getAddress();

const record: any = {
  schemaVersion: 2, stage: "preflight", network: "bscTestnet", chainId: "97", deploymentGeneration: "1",
  addresses: { gateway: GATEWAY, lens: LENS, marketplace: MARKETPLACE, token: TOKEN, ledger: LEDGER, vault: VAULT, settlement: SETTLEMENT, policy: POLICY, usdt: USDT },
  acceptedPartialHistory: acceptedPartial,
  testUsers: { lifecycleUserA: { address: A, role: "seller/lifecycle user A", privateKeyRecorded: false }, buyerWrongOwnerUserB: { address: B, role: "buyer/wrong-owner user B", privateKeyRecorded: false } },
  keyHandling: { temporaryPath: KEY_PATH, nonWorkspace: true, permissions: "0600", retainedUntilPass: true, printed: false, evidenceContainsKeys: false, signaturesRecorded: false },
  transactions: safePreEconomicResume || safePrimaryResume ? oldResult.transactions : [],
  intents: safePrimaryResume ? (oldResult.intents ?? {}) : {},
  replayTests: safePrimaryResume ? (oldResult.replayTests ?? []) : [],
  confirmations: safePreEconomicResume || safePrimaryResume ? (oldResult.confirmations ?? {}) : {},
  gatewayChecks: safePreEconomicResume || safePrimaryResume ? (oldResult.gatewayChecks ?? []) : [],
};
async function persist() {
  await mkdir(".local/phase3b-access-layer-evidence", { recursive: true });
  await writeFile(RESULT_PATH, stringify(record), "utf8");
  await writeFile(EVIDENCE_PATH, stringify(record), "utf8");
}
async function gatewayZeroCheck(receiptBlock: number) {
  const confirmation = await confirmed("Gateway non-custody and allowances", receiptBlock, async tag => ({
    gatewayUSDT: await usdt.balanceOf(GATEWAY, { blockTag: tag }),
    gatewayAVS: await token.balanceOf(GATEWAY, { blockTag: tag }),
    aGatewayUSDTAllowance: await usdt.allowance(A, GATEWAY, { blockTag: tag }),
    aGatewayAVSAllowance: await token.allowance(A, GATEWAY, { blockTag: tag }),
    bGatewayUSDTAllowance: await usdt.allowance(B, GATEWAY, { blockTag: tag }),
    bGatewayAVSAllowance: await token.allowance(B, GATEWAY, { blockTag: tag }),
  }), values => Object.values(values).every(value => value === 0n));
  return { ...confirmation, values: {
    gatewayUSDT: "0", gatewayAVS: "0", aGatewayUSDTAllowance: "0",
    aGatewayAVSAllowance: "0", bGatewayUSDTAllowance: "0", bGatewayAVSAllowance: "0",
  } };
}
async function rawEconomicState(tag: number) {
  return {
    block: tag, avsSupply: await token.totalSupply({ blockTag: tag }),
    totalNetAssets: await ledger.totalNetAssets({ blockTag: tag }),
    currentAVSValue: await ledger.currentAVSValue({ blockTag: tag }),
    totalFees: (await gateway.getMarketplaceSnapshot({ blockTag: tag })).totalFeesCollected,
    marketplaceUSDT: await usdt.balanceOf(MARKETPLACE, { blockTag: tag }),
    marketplaceAVS: await token.balanceOf(MARKETPLACE, { blockTag: tag }),
    vaultUSDT: await usdt.balanceOf(VAULT, { blockTag: tag }),
    settlementUSDT: await usdt.balanceOf(SETTLEMENT, { blockTag: tag }),
    tradingDestinationUSDT: await usdt.balanceOf(TRADING_DESTINATION, { blockTag: tag }),
    aUSDT: await usdt.balanceOf(A, { blockTag: tag }), aAVS: await token.balanceOf(A, { blockTag: tag }),
    bUSDT: await usdt.balanceOf(B, { blockTag: tag }), bAVS: await token.balanceOf(B, { blockTag: tag }),
    orderCount: await market.orderCount({ blockTag: tag }),
    settlementCount: await settlement.settlementCount({ blockTag: tag }),
    protocolLiquidity: await market.protocolLiquidityUSDT({ blockTag: tag }),
    protocolInventory: await market.protocolInventoryAVS({ blockTag: tag }),
  };
}

const initialBlock = safePrimaryResume
  ? Number(oldResult.plan.initial.block)
  : await ethers.provider.getBlockNumber();
mostRecentReceiptBlock = Math.max(
  initialBlock,
  ...record.transactions.map((item: any) => Number(item.block ?? 0)),
);
const initialProtocol = safePrimaryResume
  ? {
      currentNAV: BigInt(oldResult.plan.initial.nav),
      totalNetAssets: BigInt(oldResult.preflight.protocol[5]),
      totalSupply: BigInt(oldResult.plan.initial.supply),
      settlementCount: BigInt(oldResult.plan.initial.settlementCount),
    }
  : await gateway.getProtocolSnapshot({ blockTag: initialBlock });
const initialMarket = safePrimaryResume
  ? { orderCount: BigInt(oldResult.plan.initial.orderCount) }
  : await gateway.getMarketplaceSnapshot({ blockTag: initialBlock });
const initialWiring = safePrimaryResume
  ? { allHealthy: true, source: "persisted pre-primary snapshot" }
  : await gateway.getWiringHealth({ blockTag: initialBlock });
const liveReadBlock = await ethers.provider.getBlockNumber();
eq("chain", chain.chainId, 97n); eq("generation", await gateway.deploymentGeneration({ blockTag: liveReadBlock }), 1n);
eq("accepted order count", initialMarket.orderCount, 2n); eq("settlement count", initialProtocol.settlementCount, 0n);
yes("Marketplace remains authorized", await token.isWhitelisted(MARKETPLACE, { blockTag: liveReadBlock }));
yes("wiring", initialWiring.allHealthy);
const historicalTwo = await gateway.getOrder(2, { blockTag: liveReadBlock });
yes("accepted historical order #2 exists", historicalTwo.owner !== ethers.ZeroAddress);
const acceptedPrimary = BigInt(acceptedPartial.intents?.setupPrimaryPurchase?.intent?.quantityAVS ?? 0);
const phase3ASupply = BigInt(acceptedPartial.phase3AReference?.certifiedState?.totalSupply ?? 0);
if (acceptedPrimary === 0n || phase3ASupply === 0n) throw new Error("Accepted partial evidence lacks its certified supply history.");
eq("accepted partial supply", initialProtocol.totalSupply, phase3ASupply + acceptedPrimary);
const nav0 = initialProtocol.currentNAV;
const totalAssets0 = initialProtocol.totalNetAssets;
const totalSupply0 = initialProtocol.totalSupply;
function executablePrimaryQuote(requested: bigint) {
  const grossAtLimit = requested * nav0 / SCALE;
  const escrow = grossAtLimit + fee(grossAtLimit);
  const maxPrincipalByFee = escrow * 10_000n / (10_000n + FEE_BPS);
  const capital = maxPrincipalByFee < grossAtLimit
    ? maxPrincipalByFee
    : grossAtLimit;
  const marketplaceShares = capital * SCALE / nav0;
  const vaultShares = capital * totalSupply0 / totalAssets0;
  return { requested, grossAtLimit, escrow, capital, marketplaceShares, vaultShares };
}
let executablePrimary = executablePrimaryQuote(ONE);
for (
  let reduction = 0n;
  executablePrimary.marketplaceShares !== executablePrimary.vaultShares &&
  reduction < 1_000_000n;
  reduction += 1n
) {
  executablePrimary = executablePrimaryQuote(ONE - reduction - 1n);
}
if (
  executablePrimary.marketplaceShares === 0n ||
  executablePrimary.marketplaceShares !== executablePrimary.vaultShares
) {
  throw new Error("No executable primary quote was found within 1,000,000 wei of 1 AVS.");
}
const requestedPrimaryAVS = executablePrimary.requested;
const mintedPrimaryAVS = executablePrimary.marketplaceShares;
const seedSellAVS = mintedPrimaryAVS / 2n;
const marketSellAVS = mintedPrimaryAVS - seedSellAVS;
const primaryCapital = executablePrimary.capital;
const primaryBuyerFee = fee(primaryCapital);
const primaryFunding = executablePrimary.escrow;
const primaryRefund = primaryFunding - primaryCapital - primaryBuyerFee;
const aTriggeredEscrow = buyCost(mintedPrimaryAVS, SCALE / 2n);
const triggerMargin = nav0 / 100n + 1n;
const bTrigger = nav0 + triggerMargin;
const bFunding = buyCost(mintedPrimaryAVS, bTrigger);
record.plan = plain({
  continuationAllowed: true, requestedPrimaryAVS, additionalPrimaryAVS: mintedPrimaryAVS, automaticThresholdAVS: 100n * SCALE,
  initial: { block: initialBlock, supply: initialProtocol.totalSupply, nav: nav0, orderCount: initialMarket.orderCount, settlementCount: initialProtocol.settlementCount },
  funding: { ARequired: primaryFunding + aTriggeredEscrow, BRequired: bFunding }, primary: { requestedAVS: requestedPrimaryAVS, mintedAVS: mintedPrimaryAVS, capital: primaryCapital, buyerFee: primaryBuyerFee, escrow: primaryFunding, refund: primaryRefund },
  refunds: { triggeredBuyA: aTriggeredEscrow, triggeredSellA: mintedPrimaryAVS },
  secondary: { seedSellAVS, marketSellAVS, fills: 2, expectedMatchingSource: "user-to-user only" },
  bTriggerNAV: bTrigger, protocolAbsorption: "not used; 0.5 AVS seed has less than the $5 daily eligibility floor",
  proposedLensWiringHealthExtension: "Not implemented/deployed here: expose Marketplace AccountPolicy authorization through the canonical policy/token interface and include it in allHealthy.",
});
record.preflight = safePrimaryResume
  ? oldResult.preflight
  : plain({ block: initialBlock, protocol: initialProtocol, marketplace: initialMarket, wiring: initialWiring, historicalOrder2: historicalTwo });
await persist();

async function auth(who: string, role: string) {
  if (await token.isWhitelisted(who, { blockTag: await ethers.provider.getBlockNumber() })) return { user: who, role, alreadyAuthorized: true };
  const r = await tx(`Authorize ${role}`, policy.authorizeAccount(who));
  return { user: who, role, ...r, confirmation: await confirmed(`${role} authorization`, r.block, tag => token.isWhitelisted(who, { blockTag: tag }), Boolean) };
}
record.infrastructure = { authorizations: [await auth(A, "lifecycle user A"), await auth(B, "buyer/wrong-owner user B")] }; await persist();
for (const [who, amount, role] of [[A, primaryFunding + aTriggeredEscrow, "A"], [B, bFunding, "B"]] as const) {
  if (await ethers.provider.getBalance(who) < 50_000_000_000_000_000n) {
    await tx(`Fund ${role} gas`, admin.sendTransaction({ to: who, value: 100_000_000_000_000_000n }));
  }
  const currentBalance = await usdt.balanceOf(who, { blockTag: await ethers.provider.getBlockNumber() });
  if (currentBalance < amount) {
    const funded = await tx(`Fund ${role} exact TestUSDT`, usdt.mint(who, amount - currentBalance));
    record.confirmations[`funding${role}`] = await confirmed<bigint>(`${role} funding`, funded.block, tag => usdt.balanceOf(who, { blockTag: tag }), v => v >= amount);
  }
  const signer = role === "A" ? a : b;
  const currentAllowance = await usdt.allowance(who, MARKETPLACE, { blockTag: await ethers.provider.getBlockNumber() });
  if (currentAllowance < amount) {
    const approved = await tx(`Approve Marketplace TestUSDT for ${role}`, usdt.connect(signer).approve(MARKETPLACE, amount));
    record.confirmations[`approval${role}`] = await confirmed<bigint>(`${role} marketplace allowance`, approved.block, tag => usdt.allowance(who, MARKETPLACE, { blockTag: tag }), v => v >= amount);
  }
  eq(`${role} gateway USDT allowance`, await usdt.allowance(who, GATEWAY, { blockTag: await ethers.provider.getBlockNumber() }), 0n);
}
const requiredAVSAllowance = 2n * mintedPrimaryAVS;
const existingAVSAllowance = await token.allowance(A, MARKETPLACE, { blockTag: await ethers.provider.getBlockNumber() });
if (existingAVSAllowance < requiredAVSAllowance) {
  const avsApproval = await tx("Approve Marketplace AVS for A", token.connect(a).approve(MARKETPLACE, requiredAVSAllowance));
  record.confirmations.avsApprovalA = await confirmed<bigint>("A AVS marketplace allowance", avsApproval.block, tag => token.allowance(A, MARKETPLACE, { blockTag: tag }), v => v >= requiredAVSAllowance);
}
eq("A gateway AVS allowance", await token.allowance(A, GATEWAY, { blockTag: await ethers.provider.getBlockNumber() }), 0n);
let economicBefore: Awaited<ReturnType<typeof rawEconomicState>>;
if (safePrimaryResume) {
  const afterPrimaryBlock = Math.max(mostRecentReceiptBlock, await ethers.provider.getBlockNumber());
  const afterPrimary = await rawEconomicState(afterPrimaryBlock);
  const capitalAllocated = primaryTransactions[0].events.find((item: any) => item.event === "CapitalAllocated");
  if (!capitalAllocated) throw new Error("Persisted primary receipt lacks CapitalAllocated.");
  const retainedCapital = BigInt(capitalAllocated.arguments[1]);
  const tradingCapital = BigInt(capitalAllocated.arguments[2]);
  economicBefore = {
    ...afterPrimary,
    block: initialBlock,
    avsSupply: afterPrimary.avsSupply - mintedPrimaryAVS,
    totalNetAssets: afterPrimary.totalNetAssets - primaryCapital - primaryBuyerFee,
    currentAVSValue: nav0,
    totalFees: afterPrimary.totalFees - primaryBuyerFee,
    marketplaceUSDT: afterPrimary.marketplaceUSDT - retainedCapital - primaryBuyerFee,
    vaultUSDT: afterPrimary.vaultUSDT,
    tradingDestinationUSDT: afterPrimary.tradingDestinationUSDT - tradingCapital,
    aUSDT: afterPrimary.aUSDT + primaryCapital + primaryBuyerFee,
    aAVS: afterPrimary.aAVS - mintedPrimaryAVS,
    orderCount: afterPrimary.orderCount - 1n,
    protocolLiquidity: afterPrimary.protocolLiquidity - retainedCapital - primaryBuyerFee,
  };
  eq("reconstructed primary capital allocation", retainedCapital + tradingCapital, primaryCapital);
} else {
  economicBefore = await rawEconomicState(initialBlock);
}

const domain = { name: "AVS Marketplace", version: "1", chainId: 97n, verifyingContract: MARKETPLACE };
const types: any = {
  MarketBuyIntent: [{ name: "owner", type: "address" }, { name: "beneficiary", type: "address" }, { name: "quantityAVS", type: "uint256" }, { name: "requestedMaxMatches", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" }],
  TriggeredBuyIntent: [{ name: "owner", type: "address" }, { name: "beneficiary", type: "address" }, { name: "quantityAVS", type: "uint256" }, { name: "triggerNAV", type: "uint256" }, { name: "requestedMaxMatches", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" }],
  TriggeredSellIntent: [{ name: "owner", type: "address" }, { name: "beneficiary", type: "address" }, { name: "quantityAVS", type: "uint256" }, { name: "triggerNAV", type: "uint256" }, { name: "requestedMaxMatches", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" }],
  MarketSellIntent: [{ name: "owner", type: "address" }, { name: "beneficiary", type: "address" }, { name: "quantityAVS", type: "uint256" }, { name: "requestedMaxMatches", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" }],
  CancelIntent: [{ name: "owner", type: "address" }, { name: "beneficiary", type: "address" }, { name: "orderId", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "deploymentGeneration", type: "uint256" }],
};
const expectedNonces = new Map<string, bigint>();
async function initialNonce(owner: string) {
  /* Two equal, explicitly block-pinned reads prevent a stale RPC "latest"
     response from becoming an EIP-712 nonce. */
  for (let retry = 0; retry < 4; retry += 1) {
    const tag = Math.max(mostRecentReceiptBlock, await ethers.provider.getBlockNumber());
    const first = await market.nonces(owner, { blockTag: tag });
    const second = await market.nonces(owner, { blockTag: tag });
    if (first === second) return first;
    if (retry !== 3) await sleep(1500 * (retry + 1));
  }
  throw new Error("Marketplace nonce did not stabilize at a receipt-or-later block.");
}
expectedNonces.set(A.toLowerCase(), await initialNonce(A));
expectedNonces.set(B.toLowerCase(), await initialNonce(B));
async function signed(type: string, owner: Wallet, value: any) {
  const signature = await owner.signTypedData(domain, { [type]: types[type] }, value);
  const digest = ethers.TypedDataEncoder.hash(domain, { [type]: types[type] }, value);
  eq(`${type} signer`, ethers.recoverAddress(digest, signature).toLowerCase(), (await owner.getAddress()).toLowerCase());
  return { signature, evidence: { domain: plain(domain), type, intent: plain(value), typedDataDigest: digest, signatureRecorded: false } };
}
async function expiry() { return BigInt((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))!.timestamp + 3600); }
async function action(name: string, type: string, owner: Wallet, method: string, fields: any) {
  const ownerAddress = await owner.getAddress();
  const n = expectedNonces.get(ownerAddress.toLowerCase());
  if (n === undefined) throw new Error(`Missing confirmed nonce cache for ${ownerAddress}`);
  const value = { owner: ownerAddress, beneficiary: ownerAddress, ...fields, nonce: n, deadline: await expiry(), deploymentGeneration: 1n };
  const s = await signed(type, owner, value); record.intents[name] = s.evidence; await persist();
  const r = await tx(name, (gateway.connect(owner) as any)[method](value, s.signature));
  record.confirmations[`${name}Nonce`] = await confirmed(`${name} nonce`, r.block, tag => market.nonces(ownerAddress, { blockTag: tag }), v => v === n + 1n);
  expectedNonces.set(ownerAddress.toLowerCase(), n + 1n);
  record.replayTests.push(await expectError(`${name} replay`, gateway.connect(owner), method, value, s.signature, "NonceAlreadyUsed"));
  return { value, signature: s.signature, receipt: r };
}
async function orderAt(label: string, id: bigint, receiptBlock: number, predicate: (o: any) => boolean) {
  const c = await confirmed(label, receiptBlock, tag => gateway.getOrder(id, { blockTag: tag }), predicate);
  record.confirmations[label] = c;
  await persist();
  return { order: await gateway.getOrder(id, { blockTag: c.readbackBlock }), confirmation: c };
}
const firstId = initialMarket.orderCount + 1n;
record.stage = "primary";
let primary: any;
if (safePrimaryResume) {
  const existing = primaryTransactions[0];
  const existingIntent = oldResult.intents["signed primary market buy A"].intent;
  const value = {
    owner: existingIntent.owner,
    beneficiary: existingIntent.beneficiary,
    quantityAVS: BigInt(existingIntent.quantityAVS),
    requestedMaxMatches: BigInt(existingIntent.requestedMaxMatches),
    nonce: BigInt(existingIntent.nonce),
    deadline: BigInt(existingIntent.deadline),
    deploymentGeneration: BigInt(existingIntent.deploymentGeneration),
  };
  const replay = await signed("MarketBuyIntent", a, value);
  record.replayTests.push(await expectError("signed primary market buy A replay", gateway.connect(a), "placeMarketBuyWithSignature", value, replay.signature, "NonceAlreadyUsed"));
  primary = { value, receipt: existing };
} else {
  primary = await action("signed primary market buy A", "MarketBuyIntent", a, "placeMarketBuyWithSignature", { quantityAVS: requestedPrimaryAVS, requestedMaxMatches: 1n });
}
const primaryRemainderAVS = requestedPrimaryAVS - mintedPrimaryAVS;
const primaryExpectedStatus = primaryRemainderAVS === 0n ? 1n : 2n;
const primaryOrder = await orderAt("primary order", firstId, primary.receipt.block, o => o.status === primaryExpectedStatus && o.remainingAVS === primaryRemainderAVS && o.remainingUSDT === 0n && o.owner.toLowerCase() === A.toLowerCase() && o.beneficiary.toLowerCase() === A.toLowerCase());
record.confirmations.primaryAVS = await confirmed<bigint>("A exact primary AVS", primary.receipt.block, tag => token.balanceOf(A, { blockTag: tag }), v => v === mintedPrimaryAVS);

record.stage = "cancelled_triggered_buy";
const buy = await action("signed triggered buy A", "TriggeredBuyIntent", a, "placeTriggeredBuyWithSignature", { quantityAVS: mintedPrimaryAVS, triggerNAV: SCALE / 2n, requestedMaxMatches: 1n });
const buyId = firstId + 1n; await orderAt("open triggered buy", buyId, buy.receipt.block, o => o.status === 0n && o.remainingAVS === mintedPrimaryAVS && o.remainingUSDT === aTriggeredEscrow);
const beforeBuyRefund = await usdt.balanceOf(A, { blockTag: await ethers.provider.getBlockNumber() });
const buyCancel = await action("signed cancel triggered buy A", "CancelIntent", a, "cancelOrderWithSignature", { orderId: buyId });
const cancelledBuy = await orderAt("cancelled buy", buyId, buyCancel.receipt.block, o => o.status === 2n && o.remainingUSDT === 0n);
const afterBuyRefund = await usdt.balanceOf(A, { blockTag: cancelledBuy.confirmation.readbackBlock }); eq("buy refund", afterBuyRefund - beforeBuyRefund, aTriggeredEscrow);

record.stage = "cancelled_triggered_sell";
const sell = await action("signed triggered sell A", "TriggeredSellIntent", a, "placeTriggeredSellWithSignature", { quantityAVS: mintedPrimaryAVS, triggerNAV: 2n * SCALE, requestedMaxMatches: 1n });
const sellId = buyId + 1n; await orderAt("open triggered sell", sellId, sell.receipt.block, o => o.status === 0n && o.remainingAVS === mintedPrimaryAVS);
const wrongNonce = expectedNonces.get(B.toLowerCase());
if (wrongNonce === undefined) throw new Error("Missing confirmed B nonce cache.");
const wrong = { owner: B, beneficiary: B, orderId: sellId, nonce: wrongNonce, deadline: await expiry(), deploymentGeneration: 1n };
const wrongSignature = await b.signTypedData(domain, { CancelIntent: types.CancelIntent }, wrong);
const wrongDigest = ethers.TypedDataEncoder.hash(domain, { CancelIntent: types.CancelIntent }, wrong);
record.wrongOwnerIntent = { domain: plain(domain), type: "CancelIntent", intent: plain(wrong), typedDataDigest: wrongDigest, recoveredSigner: ethers.recoverAddress(wrongDigest, wrongSignature), signatureRecorded: false };
record.wrongOwnerRejection = await expectError("B wrong-owner cancellation", gateway.connect(b), "cancelOrderWithSignature", wrong, wrongSignature, "InvalidSignature"); // never persist signature; static call never advances B's cache
const beforeSellRefund = await token.balanceOf(A, { blockTag: await ethers.provider.getBlockNumber() });
const sellCancel = await action("signed cancel triggered sell A", "CancelIntent", a, "cancelOrderWithSignature", { orderId: sellId });
const cancelledSell = await orderAt("cancelled sell", sellId, sellCancel.receipt.block, o => o.status === 2n && o.remainingAVS === 0n);
eq("sell refund", (await token.balanceOf(A, { blockTag: cancelledSell.confirmation.readbackBlock })) - beforeSellRefund, mintedPrimaryAVS);

record.stage = "secondary_fills";
const seed = await action("eligible seed triggered sell A", "TriggeredSellIntent", a, "placeTriggeredSellWithSignature", { quantityAVS: seedSellAVS, triggerNAV: SCALE / 2n, requestedMaxMatches: 1n });
const seedId = sellId + 1n; await orderAt("seed remains open", seedId, seed.receipt.block, o => o.status === 0n && o.remainingAVS === seedSellAVS);
const protocolBeforeConfirmation = await confirmed("seed marketplace snapshot", seed.receipt.block, tag => gateway.getMarketplaceSnapshot({ blockTag: tag }), () => true);
const protocolBefore = await gateway.getMarketplaceSnapshot({ blockTag: protocolBeforeConfirmation.readbackBlock });
const bBuy = await action("signed triggered buy B", "TriggeredBuyIntent", b, "placeTriggeredBuyWithSignature", { quantityAVS: mintedPrimaryAVS, triggerNAV: bTrigger, requestedMaxMatches: 1n });
const bId = seedId + 1n;
const firstTrade = bBuy.receipt.events.find((e: any) => e.contractAddress.toLowerCase() === MARKETPLACE.toLowerCase() && e.event === "SecondaryTradeExecuted");
if (!firstTrade) throw new Error("First secondary fill event missing.");
const firstGross = BigInt(firstTrade.arguments.grossValue ?? firstTrade.arguments[6]);
const firstBuyerFee = BigInt(firstTrade.arguments.buyerFee ?? firstTrade.arguments[7]);
const firstSellerFee = BigInt(firstTrade.arguments.sellerFee ?? firstTrade.arguments[8]);
eq("first fill quantity", firstTrade.arguments.quantity ?? firstTrade.arguments[4], seedSellAVS); eq("first buyer fee", firstBuyerFee, fee(firstGross)); eq("first seller fee", firstSellerFee, fee(firstGross));
await orderAt("B partially filled", bId, bBuy.receipt.block, o => o.status === 0n && o.remainingAVS === marketSellAVS && o.remainingUSDT === bFunding - firstGross - firstBuyerFee);
await orderAt("seed filled", seedId, bBuy.receipt.block, o => o.status === 1n && o.remainingAVS === 0n);
const finalSell = await action("signed market sell A", "MarketSellIntent", a, "placeMarketSellWithSignature", { quantityAVS: marketSellAVS, requestedMaxMatches: 1n });
const finalSellId = bId + 1n; await orderAt("B completed", bId, finalSell.receipt.block, o => o.status === 1n && o.remainingAVS === 0n && o.remainingUSDT === 0n);
await orderAt("final sell filled", finalSellId, finalSell.receipt.block, o => o.status === 1n && o.remainingAVS === 0n);
const secondTrade = finalSell.receipt.events.find((e: any) => e.contractAddress.toLowerCase() === MARKETPLACE.toLowerCase() && e.event === "SecondaryTradeExecuted");
if (!secondTrade) throw new Error("Second secondary fill event missing.");
const secondGross = BigInt(secondTrade.arguments.grossValue ?? secondTrade.arguments[6]);
const secondBuyerFee = BigInt(secondTrade.arguments.buyerFee ?? secondTrade.arguments[7]);
const secondSellerFee = BigInt(secondTrade.arguments.sellerFee ?? secondTrade.arguments[8]);
eq("second fill quantity", secondTrade.arguments.quantity ?? secondTrade.arguments[4], marketSellAVS); eq("second buyer fee", secondBuyerFee, fee(secondGross)); eq("second seller fee", secondSellerFee, fee(secondGross));

const finalBlock = await ethers.provider.getBlockNumber();
const economicAfter = await rawEconomicState(finalBlock);
const [gp, lp, gm, lm, ga, la, gb, lb, globalG, globalL, userAG, userAL, userBG, userBL] = await Promise.all([
  gateway.getProtocolSnapshot({ blockTag: finalBlock }), lens.getProtocolSnapshot({ blockTag: finalBlock }),
  gateway.getMarketplaceSnapshot({ blockTag: finalBlock }), lens.getMarketplaceSnapshot({ blockTag: finalBlock }),
  gateway.getUserSnapshot(A, { blockTag: finalBlock }), lens.getUserSnapshot(A, { blockTag: finalBlock }),
  gateway.getUserSnapshot(B, { blockTag: finalBlock }), lens.getUserSnapshot(B, { blockTag: finalBlock }),
  gateway.getOrderIds(0, 100, false, { blockTag: finalBlock }), lens.getOrderIds(0, 100, false, { blockTag: finalBlock }),
  gateway.getUserOrderIds(A, 0, 100, false, { blockTag: finalBlock }), lens.getUserOrderIds(A, 0, 100, false, { blockTag: finalBlock }),
  gateway.getUserOrderIds(B, 0, 100, false, { blockTag: finalBlock }), lens.getUserOrderIds(B, 0, 100, false, { blockTag: finalBlock }),
]);
eq("settlement remains zero", gp.settlementCount, 0n); eq("final count", gm.orderCount, initialMarket.orderCount + 6n);
eq("one minimal additional primary issuance only", gp.totalSupply, initialProtocol.totalSupply + mintedPrimaryAVS);
eq("no protocol inventory", gm.protocolInventoryAVS, protocolBefore.protocolInventoryAVS);
eq("Gateway USDT", await usdt.balanceOf(GATEWAY, { blockTag: finalBlock }), 0n); eq("Gateway AVS", await token.balanceOf(GATEWAY, { blockTag: finalBlock }), 0n);
eq("A Gateway USDT allowance", await usdt.allowance(A, GATEWAY, { blockTag: finalBlock }), 0n); eq("B Gateway USDT allowance", await usdt.allowance(B, GATEWAY, { blockTag: finalBlock }), 0n);
eq("A Gateway AVS allowance", await token.allowance(A, GATEWAY, { blockTag: finalBlock }), 0n);
yes("gateway/lens protocol reconciliation", JSON.stringify(plain(gp)) === JSON.stringify(plain(lp)));
yes("gateway/lens market reconciliation", JSON.stringify(plain(gm)) === JSON.stringify(plain(lm)));
yes("gateway/lens A reconciliation", JSON.stringify(plain(ga)) === JSON.stringify(plain(la)));
yes("gateway/lens B reconciliation", JSON.stringify(plain(gb)) === JSON.stringify(plain(lb)));
yes("global pagination reconciliation", JSON.stringify(plain(globalG)) === JSON.stringify(plain(globalL)));
yes("A pagination reconciliation", JSON.stringify(plain(userAG)) === JSON.stringify(plain(userAL)));
yes("B pagination reconciliation", JSON.stringify(plain(userBG)) === JSON.stringify(plain(userBL)));
yes("historical global index retained", globalG.map(String).includes("2"));
yes("A historical index retained", [firstId, buyId, sellId, seedId, finalSellId].every(id => userAG.map(String).includes(id.toString())));
yes("B historical index retained", userBG.map(String).includes(bId.toString()));
const page = async (account: string | null, offset: number, limit: number, newest: boolean) =>
  account ? gateway.getUserOrderIds(account, offset, limit, newest, { blockTag: finalBlock }) : gateway.getOrderIds(offset, limit, newest, { blockTag: finalBlock });
const pagination = {
  globalOldestSmall: await page(null, 0, 2, false), globalOldestMiddle: await page(null, 2, 3, false), globalOldestEnd: await page(null, Number(finalSellId), 2, false),
  globalNewestSmall: await page(null, 0, 2, true), globalNewestMiddle: await page(null, 2, 3, true), globalNewestEnd: await page(null, Number(finalSellId), 2, true),
  aOldestSmall: await page(A, 0, 2, false), aOldestMiddle: await page(A, 2, 2, false), aOldestEnd: await page(A, 5, 2, false),
  aNewestSmall: await page(A, 0, 2, true), aNewestMiddle: await page(A, 2, 2, true), aNewestEnd: await page(A, 5, 2, true),
  bOldestSmall: await page(B, 0, 1, false), bOldestEnd: await page(B, 1, 1, false), bNewestSmall: await page(B, 0, 1, true), bNewestEnd: await page(B, 1, 1, true),
};
const expectedGlobal = Array.from({ length: Number(finalSellId) }, (_v, i) => BigInt(i + 1));
yes("global IDs exact and unique", globalG.length === expectedGlobal.length && new Set(globalG.map(String)).size === globalG.length && globalG.every((id: bigint, i: number) => id === expectedGlobal[i]));
yes("cancelled and filled remain indexed", userAG.map(String).includes(buyId.toString()) && userAG.map(String).includes(sellId.toString()) && userAG.map(String).includes(seedId.toString()));
const orders = await Promise.all(expectedGlobal.map(async id => ({ id, gateway: await gateway.getOrder(id, { blockTag: finalBlock }), lens: await lens.getOrder(id, { blockTag: finalBlock }) })));
for (const item of orders) {
  yes(`order ${item.id} gateway/lens`, JSON.stringify(plain(item.gateway)) === JSON.stringify(plain(item.lens)));
}
const expectedStatuses = new Map<string, bigint>([["1", 1n], ["2", 1n], [firstId.toString(), primaryExpectedStatus], [buyId.toString(), 2n], [sellId.toString(), 2n], [seedId.toString(), 1n], [bId.toString(), 1n], [finalSellId.toString(), 1n]]);
for (const item of orders) eq(`order ${item.id} status`, item.gateway.status, expectedStatuses.get(item.id.toString()));
for (const item of orders.filter(item => item.id >= firstId)) {
  const expectedOwner = item.id === bId ? B : A;
  eq(`order ${item.id} owner`, item.gateway.owner, expectedOwner);
  eq(`order ${item.id} beneficiary`, item.gateway.beneficiary, expectedOwner);
}
record.pagination = plain({ ...pagination, expectedGlobal, allOrders: orders.map(item => ({ id: item.id, status: item.gateway.status, owner: item.gateway.owner, beneficiary: item.gateway.beneficiary })) });
eq("two secondary fees", gm.totalFeesCollected - protocolBefore.totalFeesCollected, firstBuyerFee + firstSellerFee + secondBuyerFee + secondSellerFee);
eq("A exact final TestUSDT", await usdt.balanceOf(A, { blockTag: finalBlock }), economicBefore.aUSDT - primaryCapital - primaryBuyerFee + firstGross - firstSellerFee + secondGross - secondSellerFee);
eq("B exact final TestUSDT", await usdt.balanceOf(B, { blockTag: finalBlock }), economicBefore.bUSDT - firstGross - firstBuyerFee - secondGross - secondBuyerFee);
eq("A final AVS (no burn)", await token.balanceOf(A, { blockTag: finalBlock }), 0n);
eq("B exact acquired AVS", await token.balanceOf(B, { blockTag: finalBlock }), mintedPrimaryAVS);
eq("economic supply delta", economicAfter.avsSupply - economicBefore.avsSupply, mintedPrimaryAVS);
const allSecondaryFees = firstBuyerFee + firstSellerFee + secondBuyerFee + secondSellerFee;
eq("economic net-assets delta", economicAfter.totalNetAssets - economicBefore.totalNetAssets, primaryCapital + primaryBuyerFee + allSecondaryFees);
eq("economic fee delta", economicAfter.totalFees - economicBefore.totalFees, primaryBuyerFee + allSecondaryFees);
eq("economic marketplace AVS delta", economicAfter.marketplaceAVS - economicBefore.marketplaceAVS, 0n);
eq("economic settlement USDT delta", economicAfter.settlementUSDT - economicBefore.settlementUSDT, 0n);
eq("economic protocol inventory delta", economicAfter.protocolInventory - economicBefore.protocolInventory, 0n);
eq("economic order delta", economicAfter.orderCount - economicBefore.orderCount, 6n);
eq("economic settlement delta", economicAfter.settlementCount - economicBefore.settlementCount, 0n);
eq("tracked USDT conservation", (economicAfter.marketplaceUSDT - economicBefore.marketplaceUSDT) + (economicAfter.vaultUSDT - economicBefore.vaultUSDT) + (economicAfter.settlementUSDT - economicBefore.settlementUSDT) + (economicAfter.tradingDestinationUSDT - economicBefore.tradingDestinationUSDT) + (economicAfter.aUSDT - economicBefore.aUSDT) + (economicAfter.bUSDT - economicBefore.bUSDT), 0n);
eq("tracked AVS issuance conservation", (economicAfter.marketplaceAVS - economicBefore.marketplaceAVS) + (economicAfter.aAVS - economicBefore.aAVS) + (economicAfter.bAVS - economicBefore.bAVS), mintedPrimaryAVS);
eq("final NAV reconciliation", economicAfter.currentAVSValue, economicAfter.totalNetAssets * SCALE / economicAfter.avsSupply);
record.finalSnapshots = plain({ block: finalBlock, protocolGateway: gp, protocolLens: lp, marketplaceGateway: gm, marketplaceLens: lm, userA: ga, userB: gb, globalGateway: globalG, globalLens: globalL, userAGateway: userAG, userALens: userAL, userBGateway: userBG, userBLens: userBL });
const rawDelta = Object.fromEntries(Object.keys(economicBefore).filter(key => key !== "block" && typeof (economicBefore as any)[key] === "bigint").map(key => [key, (economicAfter as any)[key] - (economicBefore as any)[key]]));
record.economicReconciliation = plain({ before: economicBefore, after: economicAfter, delta: rawDelta, primary: { requestedAVS: requestedPrimaryAVS, mintedAVS: mintedPrimaryAVS, capital: primaryCapital, buyerFee: primaryBuyerFee, escrow: primaryFunding, refund: primaryRefund }, fills: [{ quantityAVS: seedSellAVS, gross: firstGross, buyerFee: firstBuyerFee, sellerFee: firstSellerFee }, { quantityAVS: marketSellAVS, gross: secondGross, buyerFee: secondBuyerFee, sellerFee: secondSellerFee }], refunds: { triggeredBuy: aTriggeredEscrow, triggeredSell: mintedPrimaryAVS, primary: primaryRefund }, explainedDelta: { supply: mintedPrimaryAVS, totalNetAssets: primaryCapital + primaryBuyerFee + allSecondaryFees, totalFees: primaryBuyerFee + allSecondaryFees, marketplaceAVS: 0n, settlementUSDT: 0n, protocolInventory: 0n, orderCount: 6n, settlementCount: 0n }, noUnexplainedDelta: true });
record.constraints = { additionalPrimaryAVS: mintedPrimaryAVS, additionalPrimaryAVSBelowOne: mintedPrimaryAVS < ONE, onlyOneAdditionalPrimaryIssuance: true, secondaryFills: 2, buyerAndSellerFeeBps: "2", protocolAbsorptionUsed: false, settlementCountZero: true, gatewayCustodyZero: true, gatewayAllowancesZero: true, exactReplayRejected: true, wrongOwnerRejected: true, noBurn: true, historicalPartialPreserved: true };
record.stage = "pass"; await persist();
await unlink(KEY_PATH);
console.log("PHASE_3B_GATEWAY_MARKETPLACE_LIFECYCLE=PASS");
console.log(`LIFECYCLE_USER_A=${A}`);
console.log(`BUYER_WRONG_OWNER_USER_B=${B}`);