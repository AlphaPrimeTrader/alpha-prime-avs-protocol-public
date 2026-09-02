import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Wallet } from "ethers";

import { preflight } from "./phase3b-bsc-common.js";
import {
  type SourceVerification,
  verifyWithSourcifyV2,
} from "./sourcify-v2.js";

const CONFIRMATION = "BSC_TESTNET_ACCESS_LAYER_PHASE2_ONLY";
const GENERATION = 1n;
const ZERO = "0x0000000000000000000000000000000000000000";
const EVIDENCE_DIRECTORY = ".local/phase2-access-layer-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-access-layer-generation.json`;
const DEPLOYMENT_PATH =
  "deployments/bsc-testnet/phase2-access-layer-integrated.json";

if (process.env.PHASE2_ACCESS_LAYER_DEPLOY_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Deployment disabled. Set PHASE2_ACCESS_LAYER_DEPLOY_CONFIRM=${CONFIRMATION}.`,
  );
}

if (
  (await readFile(DEPLOYMENT_PATH, "utf8").catch(() => null)) ||
  (await readFile(EVIDENCE_PATH, "utf8").catch(() => null))
) {
  throw new Error(
    "Phase 2 deployment evidence already exists; refusing duplicate generation.",
  );
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No BSC Testnet deployer signer is configured.");

const initialOwner = checked.deployer;
const tradingDestination = Wallet.createRandom().address;
if ((await ethers.provider.getCode(tradingDestination)) !== "0x") {
  throw new Error("Generated trading destination unexpectedly has contract code.");
}
if (tradingDestination.toLowerCase() === initialOwner.toLowerCase()) {
  throw new Error("Trading destination must be distinct from the owner.");
}

type Deployment = {
  name: string;
  contractIdentifier: string;
  address: string;
  constructorArguments: readonly string[];
  deploymentTransaction: string;
  deploymentBlock: number;
  deployedAt: string;
  runtimeBytecodeHash: string;
  runtimeBytecodeSize: number;
  gasUsed: string;
  sourceVerification: SourceVerification | { status: "pending" };
};

type TransactionRecord = {
  hash: string;
  block: number;
  gasUsed: string;
};

const record: any = {
  schemaVersion: 1,
  stage: "in_progress",
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  deploymentGeneration: GENERATION.toString(),
  generationLabel: "ACCESS_LAYER_PHASE2_BSC_TESTNET_GENERATION_1",
  classification:
    "TESTNET ACCESS LAYER INTEGRATED GENERATION — NOT MAINNET — NOT FINAL PRODUCTION CERTIFICATION",
  owner: initialOwner,
  compiler: {
    version: "0.8.28+commit.7893614a",
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
  },
  deployedContracts: {},
  configurationTransactions: {},
  tradingDestination: {
    address: tradingDestination,
    kind: "EOA",
    codeHash: "0x",
    generatedForThisDeployment: true,
  },
  migration: {
    address: ZERO,
    active: false,
    deployed: false,
  },
  sourceVerification: {
    status: "pending",
  },
  readback: null,
  gatewayBootstrap: null,
};

async function persist() {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const json = `${JSON.stringify(
    record,
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    2,
  )}\n`;
  await writeFile(EVIDENCE_PATH, json, "utf8");
  await writeFile(DEPLOYMENT_PATH, json, "utf8");
}

async function deploy(
  name: string,
  contractIdentifier: string,
  constructorArguments: readonly string[],
) {
  const contract = await ethers.deployContract(name, [...constructorArguments]);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error(`${name} deployment transaction missing.`);
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${name} deployment receipt missing.`);
  const runtime = await ethers.provider.getCode(address);
  if (runtime === "0x") throw new Error(`${name} runtime bytecode missing.`);
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  if (!block) throw new Error(`${name} deployment block missing.`);

  const result: Deployment = {
    name,
    contractIdentifier,
    address,
    constructorArguments: [...constructorArguments],
    deploymentTransaction: receipt.hash,
    deploymentBlock: receipt.blockNumber,
    deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    runtimeBytecodeHash: ethers.keccak256(runtime),
    runtimeBytecodeSize: (runtime.length - 2) / 2,
    gasUsed: receipt.gasUsed.toString(),
    sourceVerification: { status: "pending" },
  };
  record.deployedContracts[name] = result;
  await persist();
  console.log(
    `DEPLOYED=${name} ADDRESS=${address} TX=${receipt.hash} BLOCK=${receipt.blockNumber}`,
  );
  return result;
}

async function configure(
  label: string,
  action: () => Promise<{ wait(): Promise<any> }>,
) {
  const transaction = await action();
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${label} receipt missing.`);
  const result: TransactionRecord = {
    hash: receipt.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
  record.configurationTransactions[label] = result;
  await persist();
  console.log(`CONFIGURED=${label} TX=${receipt.hash} BLOCK=${receipt.blockNumber}`);
  return result;
}

function addressOf(deployment: Deployment) {
  return deployment.address;
}

console.log("PHASE_2_ACCESS_LAYER_BSC_TESTNET_PREFLIGHT=PASS");
console.log(`NETWORK=BSC_TESTNET`);
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${initialOwner}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${checked.balance}`);
console.log(`DEPLOYMENT_GENERATION=${GENERATION}`);
console.log(`TRADING_DESTINATION=${tradingDestination}`);
console.log("MAINNET_INTERACTION=false");
console.log("OLD_GENERATION_MUTATION=false");
console.log("ECONOMIC_CYCLE=false");
console.log("MIGRATION_EXECUTED=false");
console.log("LOCKS_EXECUTED=false");
console.log("OWNERSHIP_RENOUNCED=false");

const testUsdt = await deploy(
  "TestUSDT",
  "contracts/testnet/TestUSDT.sol:TestUSDT",
  [initialOwner],
);
const avsToken = await deploy(
  "AVSToken",
  "contracts/token/AVSToken.sol:AVSToken",
  [initialOwner],
);
const avsLedger = await deploy(
  "AVSLedger",
  "contracts/ledger/AVSLedger.sol:AVSLedger",
  [initialOwner],
);
const avsVault = await deploy(
  "AVSVault",
  "contracts/vault/AVSVault.sol:AVSVault",
  [initialOwner, addressOf(testUsdt)],
);
const tradingSettlement = await deploy(
  "AVSTradingSettlement",
  "contracts/trading/AVSTradingSettlement.sol:AVSTradingSettlement",
  [initialOwner, addressOf(testUsdt)],
);
const accountPolicy = await deploy(
  "AccountPolicyMock",
  "contracts/testnet/AccountPolicyMock.sol:AccountPolicyMock",
  [initialOwner, addressOf(avsToken)],
);
const marketplace = await deploy(
  "AVSMarketplace",
  "contracts/marketplace/AVSMarketplace.sol:AVSMarketplace",
  [
    initialOwner,
    addressOf(testUsdt),
    addressOf(avsToken),
    addressOf(avsLedger),
    addressOf(avsVault),
    addressOf(tradingSettlement),
  ],
);

const ledger = await ethers.getContractAt("AVSLedger", avsLedger.address);
const token = await ethers.getContractAt("AVSToken", avsToken.address);
const vault = await ethers.getContractAt("AVSVault", avsVault.address);
const policy = await ethers.getContractAt(
  "AccountPolicyMock",
  accountPolicy.address,
);
const settlement = await ethers.getContractAt(
  "AVSTradingSettlement",
  tradingSettlement.address,
);

await configure("ledger.bindAVSToken", () =>
  ledger.bindAVSToken(avsToken.address),
);
await configure("ledger.configureVault", () =>
  ledger.configureVault(avsVault.address),
);
await configure("ledger.configureTradeSettlement", () =>
  ledger.configureTradeSettlement(tradingSettlement.address),
);
await configure("token.setAccountPolicy", () =>
  token.setAccountPolicy(accountPolicy.address),
);
await configure("token.setVault", () => token.setVault(avsVault.address));
await configure("policy.authorizeMarketplace", () =>
  policy.authorizeAccount(marketplace.address),
);
await configure("vault.setAVSToken", () => vault.setAVSToken(avsToken.address));
await configure("vault.setAVSLedger", () =>
  vault.setAVSLedger(avsLedger.address),
);
await configure("vault.setMarketplace", () =>
  vault.setMarketplace(marketplace.address),
);
await configure("vault.setTradingContract", () =>
  vault.setTradingContract(tradingSettlement.address),
);
await configure("settlement.setLedger", () =>
  settlement.setLedger(avsLedger.address),
);
await configure("settlement.setVault", () =>
  settlement.setVault(avsVault.address),
);
await configure("settlement.setMarketplace", () =>
  settlement.setMarketplace(marketplace.address),
);
await configure("settlement.setTradingDestination", () =>
  settlement.setTradingDestination(tradingDestination),
);

const lens = await deploy(
  "AVSProtocolLens",
  "contracts/access/AVSProtocolLens.sol:AVSProtocolLens",
  [
    addressOf(avsToken),
    addressOf(testUsdt),
    addressOf(avsLedger),
    addressOf(avsVault),
    addressOf(marketplace),
    addressOf(tradingSettlement),
    addressOf(accountPolicy),
    ZERO,
    GENERATION.toString(),
  ],
);
const gateway = await deploy(
  "AVSGateway",
  "contracts/access/AVSGateway.sol:AVSGateway",
  [
    addressOf(avsToken),
    addressOf(avsLedger),
    addressOf(avsVault),
    addressOf(marketplace),
    addressOf(tradingSettlement),
    addressOf(accountPolicy),
    ZERO,
    addressOf(lens),
    GENERATION.toString(),
  ],
);

const testUsdtContract = await ethers.getContractAt(
  "TestUSDT",
  testUsdt.address,
);
const marketplaceContract = await ethers.getContractAt(
  "AVSMarketplace",
  marketplace.address,
);
const lensContract = await ethers.getContractAt(
  "AVSProtocolLens",
  lens.address,
);
const gatewayContract = await ethers.getContractAt(
  "AVSGateway",
  gateway.address,
);

function requireEqual(label: string, actual: unknown, expected: unknown) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function requireZero(label: string, actual: bigint) {
  if (actual !== 0n) throw new Error(`${label} is nonzero: ${actual}`);
}

const health = await lensContract.getWiringHealth();
if (!(await token.isWhitelisted(marketplace.address))) {
  throw new Error("Direct token read reports Marketplace is not AVS-authorized.");
}
if (!health.marketplaceAuthorized) {
  throw new Error("Lens reports Marketplace is not AVS-authorized.");
}
if (!health.allHealthy) throw new Error("Lens wiring health is not allHealthy.");
const protocolSnapshot = await lensContract.getProtocolSnapshot();
const marketplaceSnapshot = await lensContract.getMarketplaceSnapshot();
const userSnapshot = await lensContract.getUserSnapshot(initialOwner);
const gatewayProtocolSnapshot = await gatewayContract.getProtocolSnapshot();
const gatewayMarketplaceSnapshot = await gatewayContract.getMarketplaceSnapshot();
const gatewayUserSnapshot = await gatewayContract.getUserSnapshot(initialOwner);
const gatewayHealth = await gatewayContract.getWiringHealth();
if (!gatewayHealth.marketplaceAuthorized) {
  throw new Error("Gateway reports Marketplace is not AVS-authorized.");
}
const emptyGlobalOrders = await gatewayContract.getOrderIds(0, 100, true);
const emptyUserOrders = await gatewayContract.getUserOrderIds(
  initialOwner,
  0,
  100,
  true,
);
const emptySettlementSummaries = await gatewayContract.getSettlementSummaries(
  0,
  100,
);

requireEqual("chainId", await gatewayContract.chainId(), 97n);
requireEqual("generation", await gatewayContract.deploymentGeneration(), GENERATION);
requireEqual("marketplace generation", await marketplaceContract.DEPLOYMENT_GENERATION(), GENERATION);
requireEqual("token", await gatewayContract.token(), avsToken.address);
requireEqual("protocol lens", await gatewayContract.protocolLens(), lens.address);
requireEqual("protocol snapshot generation", protocolSnapshot.deploymentGeneration, GENERATION);
requireEqual("marketplace snapshot generation", marketplaceSnapshot.deploymentGeneration, GENERATION);
requireEqual("user snapshot generation", userSnapshot.deploymentGeneration, GENERATION);
if (!gatewayHealth.allHealthy) throw new Error("Gateway wiring health is not allHealthy.");
if (emptyGlobalOrders.length !== 0 || emptyUserOrders.length !== 0) {
  throw new Error("Order indexes are not empty at genesis.");
}
if (emptySettlementSummaries.length !== 0) {
  throw new Error("Settlement history is not empty at genesis.");
}

requireEqual("TestUSDT name", await testUsdtContract.name(), "Test USDT");
requireEqual("TestUSDT symbol", await testUsdtContract.symbol(), "USDT");
requireEqual("TestUSDT decimals", await testUsdtContract.decimals(), 18n);
requireZero("TestUSDT totalSupply", await testUsdtContract.totalSupply());
requireZero("AVS totalSupply", await token.totalSupply());
requireZero("Ledger totalNetAssets", await ledger.totalNetAssets());
requireEqual("Ledger currentAVSValue", await ledger.currentAVSValue(), 1n * 10n ** 18n);
requireZero("Ledger settlementCount", await ledger.settlementCount());
requireZero("Marketplace orderCount", await marketplaceContract.orderCount());
requireEqual("Marketplace nextOrderId", await marketplaceContract.nextOrderId(), 1n);
requireZero("Marketplace deployer nonce count", await marketplaceContract.nonces(initialOwner));
requireZero("Marketplace deployer open sell escrow", await marketplaceContract.userOpenSellEscrow(initialOwner));
requireZero("Settlement count", await settlement.settlementCount());
requireEqual("Settlement tradingDestination", await settlement.tradingDestination(), tradingDestination);
requireEqual("Vault migration", await vault.migration(), ZERO);
if (
  (await token.vault()) !== avsVault.address ||
  (await token.accountPolicy()) !== accountPolicy.address ||
  (await ledger.avsToken()) !== avsToken.address ||
  (await ledger.vault()) !== avsVault.address ||
  (await ledger.tradeSettlement()) !== tradingSettlement.address ||
  (await vault.USDT()) !== testUsdt.address ||
  (await vault.avsToken()) !== avsToken.address ||
  (await vault.avsLedger()) !== avsLedger.address ||
  (await vault.marketplace()) !== marketplace.address ||
  (await vault.tradingContract()) !== tradingSettlement.address ||
  (await marketplaceContract.USDT()) !== testUsdt.address ||
  (await marketplaceContract.AVS()) !== avsToken.address ||
  (await marketplaceContract.ledger()) !== avsLedger.address ||
  (await marketplaceContract.vault()) !== avsVault.address ||
  (await marketplaceContract.settlementHook()) !== tradingSettlement.address ||
  (await settlement.USDT()) !== testUsdt.address ||
  (await settlement.avsLedger()) !== avsLedger.address ||
  (await settlement.vault()) !== avsVault.address ||
  (await settlement.marketplace()) !== marketplace.address
) {
  throw new Error("Canonical dependency wiring readback failed.");
}
if (
  (await token.accountPolicyLocked()) ||
  (await token.vaultLocked()) ||
  (await vault.configurationLocked())
) {
  throw new Error("An irreversible configuration lock was executed.");
}
if (
  (await settlement.authorizedRelayers(initialOwner)) ||
  (await settlement.authorizedTradeSigners(initialOwner)) ||
  (await settlement.authorizedServerSigners(initialOwner))
) {
  throw new Error("An operational settlement role was configured unexpectedly.");
}
if (
  (await ethers.provider.getBalance(gateway.address)) !== 0n ||
  (await testUsdtContract.balanceOf(gateway.address)) !== 0n ||
  (await token.balanceOf(gateway.address)) !== 0n
) {
  throw new Error("Gateway has an unexpected balance.");
}

const eip712Domain = await marketplaceContract.eip712Domain();
requireEqual("EIP-712 domain name", eip712Domain.name, "AVS Marketplace");
requireEqual("EIP-712 domain version", eip712Domain.version, "1");
requireEqual("EIP-712 domain chain", eip712Domain.chainId, 97n);
requireEqual("EIP-712 verifying contract", eip712Domain.verifyingContract, marketplace.address);
requireEqual("EIP-712 marketplace generation", await marketplaceContract.DEPLOYMENT_GENERATION(), GENERATION);

record.stage = "deployment_readback_pass";
record.readback = {
  initialEconomicState: {
    totalSupply: (await token.totalSupply()).toString(),
    totalNetAssets: (await ledger.totalNetAssets()).toString(),
    currentAVSValue: (await ledger.currentAVSValue()).toString(),
    settlementCount: (await settlement.settlementCount()).toString(),
    orderCount: (await marketplaceContract.orderCount()).toString(),
  },
  wiringHealth: health,
  gatewayWiringHealth: gatewayHealth,
  protocolSnapshot,
  marketplaceSnapshot,
  userSnapshot,
  gatewayProtocolSnapshot,
  gatewayMarketplaceSnapshot,
  gatewayUserSnapshot,
  emptyGlobalOrders,
  emptyUserOrders,
  emptySettlementSummaries,
  eip712Domain,
  locks: {
    tokenVaultLocked: await token.vaultLocked(),
    tokenAccountPolicyLocked: await token.accountPolicyLocked(),
    vaultConfigurationLocked: await vault.configurationLocked(),
  },
  settlementRoles: {
    ownerRelayer: await settlement.authorizedRelayers(initialOwner),
    ownerTradeSigner: await settlement.authorizedTradeSigners(initialOwner),
    ownerServerSigner: await settlement.authorizedServerSigners(initialOwner),
  },
};
await persist();

const verificationTargets = [
  testUsdt,
  avsToken,
  avsLedger,
  avsVault,
  tradingSettlement,
  accountPolicy,
  marketplace,
  lens,
  gateway,
] as const;
for (const deployment of verificationTargets) {
  console.log(`SOURCIFY_SUBMIT=${deployment.name}`);
  deployment.sourceVerification = await verifyWithSourcifyV2({
    chainId: checked.chainId,
    address: deployment.address,
    contractIdentifier: deployment.contractIdentifier,
    creationTransactionHash: deployment.deploymentTransaction,
  });
  await persist();
  console.log(`SOURCIFY_EXACT_MATCH=${deployment.name}`);
}

// Re-read only through the Gateway ABI to prove one-address bootstrap.
const gatewayOnly = await ethers.getContractAt("AVSGateway", gateway.address);
const moduleIds = {
  AVS_TOKEN: await gatewayOnly.AVS_TOKEN_MODULE_ID(),
  LEDGER: await gatewayOnly.LEDGER_MODULE_ID(),
  VAULT: await gatewayOnly.VAULT_MODULE_ID(),
  MARKETPLACE: await gatewayOnly.MARKETPLACE_MODULE_ID(),
  TRADING_SETTLEMENT: await gatewayOnly.TRADING_SETTLEMENT_MODULE_ID(),
  ACCOUNT_POLICY: await gatewayOnly.ACCOUNT_POLICY_MODULE_ID(),
  MIGRATION: await gatewayOnly.MIGRATION_MODULE_ID(),
  PROTOCOL_LENS: await gatewayOnly.PROTOCOL_LENS_MODULE_ID(),
};
const discoveredModules = Object.fromEntries(
  await Promise.all(
    Object.entries(moduleIds).map(async ([name, id]) => [
      name,
      await gatewayOnly.moduleAddress(id),
    ]),
  ),
);
const discoveredCodehashes = Object.fromEntries(
  await Promise.all(
    Object.entries(moduleIds).map(async ([name, id]) => [
      name,
      await gatewayOnly.moduleCodehash(id),
    ]),
  ),
);
const bootstrapProtocol = await gatewayOnly.getProtocolSnapshot();
const bootstrapMarketplace = await gatewayOnly.getMarketplaceSnapshot();
const bootstrapUser = await gatewayOnly.getUserSnapshot(initialOwner);
const bootstrapOrders = await gatewayOnly.getOrderIds(0, 100, true);
const bootstrapSettlements = await gatewayOnly.getSettlementSummaries(0, 100);
const bootstrapHealth = await gatewayOnly.getWiringHealth();
if (
  !bootstrapHealth.marketplaceAuthorized ||
  !bootstrapHealth.allHealthy ||
  bootstrapOrders.length !== 0 ||
  bootstrapSettlements.length !== 0
) {
  throw new Error("Gateway-only bootstrap readback failed.");
}

for (const [name, address] of Object.entries({
  AVS_TOKEN: avsToken.address,
  LEDGER: avsLedger.address,
  VAULT: avsVault.address,
  MARKETPLACE: marketplace.address,
  TRADING_SETTLEMENT: tradingSettlement.address,
  ACCOUNT_POLICY: accountPolicy.address,
  MIGRATION: ZERO,
  PROTOCOL_LENS: lens.address,
})) {
  requireEqual(`Gateway module ${name}`, discoveredModules[name], address);
}
for (const [name, rawAddress] of Object.entries(discoveredModules)) {
  const address = String(rawAddress);
  const expectedCode = address === ZERO ? "0x" : await ethers.provider.getCode(address);
  const expectedHash = ethers.keccak256(expectedCode);
  requireEqual(`Gateway codehash ${name}`, discoveredCodehashes[name], expectedHash);
}

record.gatewayBootstrap = {
  protocolVersion: (await gatewayOnly.protocolVersion()).map((value: bigint) =>
    value.toString(),
  ),
  chainId: (await gatewayOnly.chainId()).toString(),
  deploymentGeneration: (await gatewayOnly.deploymentGeneration()).toString(),
  discoveredModules,
  discoveredCodehashes,
  protocolSnapshot: bootstrapProtocol,
  marketplaceSnapshot: bootstrapMarketplace,
  userSnapshot: bootstrapUser,
  emptyOrderPagination: bootstrapOrders,
  emptySettlementPagination: bootstrapSettlements,
  wiringHealth: bootstrapHealth,
  balances: {
    native: (await ethers.provider.getBalance(gateway.address)).toString(),
    testUSDT: (await testUsdtContract.balanceOf(gateway.address)).toString(),
    avs: (await token.balanceOf(gateway.address)).toString(),
  },
};
record.stage = "pass";
record.sourceVerification.status = "exact_match";
await persist();

console.log("PHASE_2_ACCESS_LAYER_BSC_TESTNET_DEPLOYMENT=PASS");
console.log(`DEPLOYMENT_GENERATION=${GENERATION}`);
console.log(`TRADING_DESTINATION=${tradingDestination}`);
console.log(`AVS_GATEWAY_ADDRESS=${gateway.address}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
console.log("INITIAL_TOTAL_SUPPLY=0");
console.log("INITIAL_TOTAL_NET_ASSETS=0");
console.log("INITIAL_SETTLEMENT_COUNT=0");
console.log("INITIAL_ORDER_COUNT=0");
console.log("ECONOMIC_CYCLE=false");
console.log("MIGRATION_EXECUTED=false");
console.log("LOCKS_EXECUTED=false");
console.log("OWNERSHIP_RENOUNCED=false");
console.log("MAINNET_INTERACTION=false");
console.log("COMMIT=false");
console.log("PUSH=false");