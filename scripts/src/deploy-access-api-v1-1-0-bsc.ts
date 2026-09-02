import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { preflight } from "./phase3b-bsc-common.js";
import {
  type SourceVerification,
  verifyWithSourcifyV2,
} from "./sourcify-v2.js";

const CONFIRMATION = "BSC_TESTNET_ACCESS_API_V1_1_0_ONLY";
const GENERATION = 1n;
const ACCESS_API_VERSION = [1n, 1n, 0n] as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOYMENT_PATH = "deployments/bsc-testnet/access-api-v1.1.0.json";
const EVIDENCE_DIRECTORY = ".local/access-api-v1.1.0-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-access-api-v1.1.0.json`;

const addresses = {
  testUSDT: "0x28c203F523feb6f6B7aE54d49bb6d7C1dEf9a9Db",
  avsToken: "0x20dddf3De5042cf23a1b94af2C660120c324e1Ac",
  ledger: "0x720B9af851C954Fb7749De6a4CF3369EDB3d5B8D",
  vault: "0x0E9f9cea8349F4718d08d23e003258c0f717edC3",
  tradingSettlement: "0x51F98c51E1E669d2a25df136a150401352586690",
  accountPolicy: "0xa6De468dd5A6222a1e5664124aB6975023AF0CF3",
  marketplace: "0x9AE0729C414995470b44Db8caB8fc08086520b33",
  oldLens: "0x822555dE56fe9Fc2d4DF59E75bf59DF05e233F15",
  oldGateway: "0x18097B9Af3AfFf28B07Bf4C762e50DF4802bB778",
} as const;

const trackedUsers = [
  "0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9",
  "0x007C0A1ec6714f36c2829eBd21f9a27837D5B57A",
  "0x9b694C3D3658c84DB03198e806e150c9A89b5010",
  "0x4012d83Cb22A1a8de3Ef3a3aBF4D2f33FC4832d9",
  "0xc88B32Dc493A8243dc8DA4fF07B37828252770D5",
  "0x6ce220164daf373DE671b2337CB3A022D4a71BF4",
  "0x39c2Aef1d7b096150C613eFdACE0aF1EF45AC290",
  "0xAdB01bD7Ddf8D7d0e5c91612985909AaFE9e3ad0",
] as const;

if (process.env.PHASE3B2_ACCESS_API_DEPLOY_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Deployment disabled. Set PHASE3B2_ACCESS_API_DEPLOY_CONFIRM=${CONFIRMATION}.`,
  );
}
if (
  (await readFile(DEPLOYMENT_PATH, "utf8").catch(() => null)) ||
  (await readFile(EVIDENCE_PATH, "utf8").catch(() => null))
) {
  throw new Error("Access API v1.1.0 evidence already exists; refusing duplicate deployment.");
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No BSC Testnet deployer signer is configured.");

const testUSDT = await ethers.getContractAt("TestUSDT", addresses.testUSDT);
const token = await ethers.getContractAt("AVSToken", addresses.avsToken);
const ledger = await ethers.getContractAt("AVSLedger", addresses.ledger);
const vault = await ethers.getContractAt("AVSVault", addresses.vault);
const settlement = await ethers.getContractAt(
  "AVSTradingSettlement",
  addresses.tradingSettlement,
);
const marketplace = await ethers.getContractAt(
  "AVSMarketplace",
  addresses.marketplace,
);
const oldGateway = await ethers.getContractAt("AVSGateway", addresses.oldGateway);

for (const [name, address] of Object.entries(addresses)) {
  if ((await ethers.provider.getCode(address)) === "0x") {
    throw new Error(`${name} has no runtime bytecode at ${address}.`);
  }
}

function json(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}

function equal(label: string, actual: unknown, expected: unknown) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function runtimeIdentity(address: string) {
  const code = await ethers.provider.getCode(address);
  return {
    codehash: ethers.keccak256(code),
    size: (code.length - 2) / 2,
  };
}

async function userBalances(account: string) {
  return {
    avs: (await token.balanceOf(account)).toString(),
    testUSDT: (await testUSDT.balanceOf(account)).toString(),
  };
}

async function economicSnapshot() {
  const tradingDestination = await settlement.tradingDestination();
  const users: Record<string, Awaited<ReturnType<typeof userBalances>>> = {};
  for (const account of trackedUsers) users[account] = await userBalances(account);
  return {
    totalSupply: (await token.totalSupply()).toString(),
    totalNetAssets: (await ledger.totalNetAssets()).toString(),
    currentAVSValue: (await ledger.currentAVSValue()).toString(),
    protocolRevenue: (await marketplace.totalFeesCollected()).toString(),
    marketplace: {
      testUSDT: (await testUSDT.balanceOf(addresses.marketplace)).toString(),
      avs: (await token.balanceOf(addresses.marketplace)).toString(),
      protocolLiquidityUSDT: (await marketplace.protocolLiquidityUSDT()).toString(),
      protocolInventoryAVS: (await marketplace.protocolInventoryAVS()).toString(),
    },
    vault: {
      testUSDT: (await testUSDT.balanceOf(addresses.vault)).toString(),
      avs: (await token.balanceOf(addresses.vault)).toString(),
    },
    tradingSettlement: {
      testUSDT: (await testUSDT.balanceOf(addresses.tradingSettlement)).toString(),
      avs: (await token.balanceOf(addresses.tradingSettlement)).toString(),
    },
    tradingDestination: {
      address: tradingDestination,
      testUSDT: (await testUSDT.balanceOf(tradingDestination)).toString(),
      avs: (await token.balanceOf(tradingDestination)).toString(),
      native: (await ethers.provider.getBalance(tradingDestination)).toString(),
    },
    orderCount: (await marketplace.orderCount()).toString(),
    settlementCount: (await settlement.settlementCount()).toString(),
    marketplaceAuthorized: await token.isWhitelisted(addresses.marketplace),
    users,
  };
}

const expectedCoreWiring = {
  tokenVault: await token.vault(),
  tokenAccountPolicy: await token.accountPolicy(),
  ledgerToken: await ledger.avsToken(),
  ledgerVault: await ledger.vault(),
  ledgerSettlement: await ledger.tradeSettlement(),
  vaultUSDT: await vault.USDT(),
  vaultToken: await vault.avsToken(),
  vaultLedger: await vault.avsLedger(),
  vaultMarketplace: await vault.marketplace(),
  vaultSettlement: await vault.tradingContract(),
  vaultMigration: await vault.migration(),
  marketplaceUSDT: await marketplace.USDT(),
  marketplaceToken: await marketplace.AVS(),
  marketplaceLedger: await marketplace.ledger(),
  marketplaceVault: await marketplace.vault(),
  marketplaceSettlement: await marketplace.settlementHook(),
  settlementUSDT: await settlement.USDT(),
  settlementLedger: await settlement.avsLedger(),
  settlementVault: await settlement.vault(),
  settlementMarketplace: await settlement.marketplace(),
};
const expectedWiringValues = {
  tokenVault: addresses.vault,
  tokenAccountPolicy: addresses.accountPolicy,
  ledgerToken: addresses.avsToken,
  ledgerVault: addresses.vault,
  ledgerSettlement: addresses.tradingSettlement,
  vaultUSDT: addresses.testUSDT,
  vaultToken: addresses.avsToken,
  vaultLedger: addresses.ledger,
  vaultMarketplace: addresses.marketplace,
  vaultSettlement: addresses.tradingSettlement,
  vaultMigration: ZERO,
  marketplaceUSDT: addresses.testUSDT,
  marketplaceToken: addresses.avsToken,
  marketplaceLedger: addresses.ledger,
  marketplaceVault: addresses.vault,
  marketplaceSettlement: addresses.tradingSettlement,
  settlementUSDT: addresses.testUSDT,
  settlementLedger: addresses.ledger,
  settlementVault: addresses.vault,
  settlementMarketplace: addresses.marketplace,
};
for (const [name, expected] of Object.entries(expectedWiringValues)) {
  equal(`core wiring ${name}`, expectedCoreWiring[name as keyof typeof expectedCoreWiring], expected);
}
equal("Marketplace generation", await marketplace.DEPLOYMENT_GENERATION(), GENERATION);
equal("old Gateway generation", await oldGateway.deploymentGeneration(), GENERATION);
const oldVersion = await oldGateway.protocolVersion();
if (oldVersion[0] !== 1n || oldVersion[1] !== 0n || oldVersion[2] !== 0n) {
  throw new Error("Historical Gateway is not Access API v1.0.0.");
}

const coreRuntimeBefore: Record<string, Awaited<ReturnType<typeof runtimeIdentity>>> = {};
for (const [name, address] of Object.entries({
  testUSDT: addresses.testUSDT,
  avsToken: addresses.avsToken,
  ledger: addresses.ledger,
  vault: addresses.vault,
  tradingSettlement: addresses.tradingSettlement,
  accountPolicy: addresses.accountPolicy,
  marketplace: addresses.marketplace,
  oldLens: addresses.oldLens,
  oldGateway: addresses.oldGateway,
})) {
  coreRuntimeBefore[name] = await runtimeIdentity(address);
}
const preDeployment = await economicSnapshot();
if (!preDeployment.marketplaceAuthorized) {
  throw new Error("Marketplace is not authorized before deployment; refusing to mutate authorization.");
}

const record: any = {
  schemaVersion: 1,
  stage: "pre_deployment_readback_pass",
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  economicGeneration: GENERATION.toString(),
  accessApiVersion: ACCESS_API_VERSION.map(String).join("."),
  classification: "CURRENT TESTNET ACCESS API v1.1.0 OVER ECONOMIC GENERATION 1",
  deployer: checked.deployer,
  compiler: {
    version: "0.8.28+commit.7893614a",
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
  },
  existingEconomicModules: { ...addresses },
  historicalAccessApi: {
    version: "1.0.0",
    lens: addresses.oldLens,
    gateway: addresses.oldGateway,
    runtimeBefore: {
      lens: coreRuntimeBefore.oldLens,
      gateway: coreRuntimeBefore.oldGateway,
    },
  },
  preDeployment,
  coreWiring: expectedCoreWiring,
  coreRuntimeBefore,
  deployments: {},
  sourceVerification: { status: "pending" },
  postDeployment: null,
  invariantComparison: null,
  gatewayBootstrap: null,
};

async function persist() {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const content = `${JSON.stringify(json(record), null, 2)}\n`;
  await writeFile(EVIDENCE_PATH, content, "utf8");
  await writeFile(DEPLOYMENT_PATH, content, "utf8");
}
await persist();

async function deployContract(
  name: "AVSProtocolLens" | "AVSGateway",
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
  if (receipt.logs.length !== 0) {
    throw new Error(`${name} deployment unexpectedly emitted economic/event logs.`);
  }
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  if (!block) throw new Error(`${name} deployment block missing.`);
  const runtime = await runtimeIdentity(address);
  const deployment = {
    name,
    contractIdentifier,
    address,
    constructorArguments: [...constructorArguments],
    deploymentTransaction: receipt.hash,
    deploymentBlock: receipt.blockNumber,
    deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    gasUsed: receipt.gasUsed.toString(),
    runtimeBytecodeHash: runtime.codehash,
    runtimeBytecodeSize: runtime.size,
    sourceVerification: { status: "pending" } as
      | { status: "pending" }
      | SourceVerification,
  };
  record.deployments[name] = deployment;
  await persist();
  return deployment;
}

const lensArguments = [
  addresses.avsToken,
  addresses.testUSDT,
  addresses.ledger,
  addresses.vault,
  addresses.marketplace,
  addresses.tradingSettlement,
  addresses.accountPolicy,
  ZERO,
  GENERATION.toString(),
] as const;
const lensDeployment = await deployContract(
  "AVSProtocolLens",
  "contracts/access/AVSProtocolLens.sol:AVSProtocolLens",
  lensArguments,
);
const lens = await ethers.getContractAt("AVSProtocolLens", lensDeployment.address);
const lensHealth = await lens.getWiringHealth();
if (!lensHealth.marketplaceAuthorized || !lensHealth.allHealthy) {
  throw new Error("New Lens wiring health failed.");
}
equal("Lens generation", await lens.deploymentGeneration(), GENERATION);

const gatewayArguments = [
  addresses.avsToken,
  addresses.ledger,
  addresses.vault,
  addresses.marketplace,
  addresses.tradingSettlement,
  addresses.accountPolicy,
  ZERO,
  lensDeployment.address,
  GENERATION.toString(),
] as const;
const gatewayDeployment = await deployContract(
  "AVSGateway",
  "contracts/access/AVSGateway.sol:AVSGateway",
  gatewayArguments,
);
const gateway = await ethers.getContractAt("AVSGateway", gatewayDeployment.address);

const version = await gateway.protocolVersion();
if (
  version[0] !== ACCESS_API_VERSION[0] ||
  version[1] !== ACCESS_API_VERSION[1] ||
  version[2] !== ACCESS_API_VERSION[2]
) {
  throw new Error("New Gateway does not report Access API v1.1.0.");
}
equal("Gateway generation", await gateway.deploymentGeneration(), GENERATION);
const gatewayHealth = await gateway.getWiringHealth();
if (
  !gatewayHealth.marketplaceAuthorized ||
  !gatewayHealth.allHealthy ||
  JSON.stringify(json(gatewayHealth)) !== JSON.stringify(json(lensHealth))
) {
  throw new Error("Gateway health does not exactly match healthy Lens output.");
}

const moduleIds = {
  AVS_TOKEN: await gateway.AVS_TOKEN_MODULE_ID(),
  LEDGER: await gateway.LEDGER_MODULE_ID(),
  VAULT: await gateway.VAULT_MODULE_ID(),
  MARKETPLACE: await gateway.MARKETPLACE_MODULE_ID(),
  TRADING_SETTLEMENT: await gateway.TRADING_SETTLEMENT_MODULE_ID(),
  ACCOUNT_POLICY: await gateway.ACCOUNT_POLICY_MODULE_ID(),
  MIGRATION: await gateway.MIGRATION_MODULE_ID(),
  PROTOCOL_LENS: await gateway.PROTOCOL_LENS_MODULE_ID(),
};
const expectedModules = {
  AVS_TOKEN: addresses.avsToken,
  LEDGER: addresses.ledger,
  VAULT: addresses.vault,
  MARKETPLACE: addresses.marketplace,
  TRADING_SETTLEMENT: addresses.tradingSettlement,
  ACCOUNT_POLICY: addresses.accountPolicy,
  MIGRATION: ZERO,
  PROTOCOL_LENS: lensDeployment.address,
};
const discoveredModules: Record<string, string> = {};
const discoveredCodehashes: Record<string, string> = {};
for (const [name, moduleId] of Object.entries(moduleIds)) {
  const address = await gateway.moduleAddress(moduleId);
  equal(`Gateway module ${name}`, address, expectedModules[name as keyof typeof expectedModules]);
  const codehash = await gateway.moduleCodehash(moduleId);
  const expectedCode = address === ZERO ? "0x" : await ethers.provider.getCode(address);
  equal(`Gateway module codehash ${name}`, codehash, ethers.keccak256(expectedCode));
  discoveredModules[name] = address;
  discoveredCodehashes[name] = codehash;
}

const protocolSnapshot = await gateway.getProtocolSnapshot();
const marketplaceSnapshot = await gateway.getMarketplaceSnapshot();
const userSnapshot = await gateway.getUserSnapshot(checked.deployer);
const orderPagination = await gateway.getOrderIds(0, 100, true);
const settlementPagination = await gateway.getSettlementSummaries(0, 100);
equal("protocol snapshot generation", protocolSnapshot.deploymentGeneration, GENERATION);
equal("marketplace snapshot generation", marketplaceSnapshot.deploymentGeneration, GENERATION);
equal("user snapshot generation", userSnapshot.deploymentGeneration, GENERATION);
equal("order pagination count", orderPagination.length, await marketplace.orderCount());
equal("settlement pagination count", settlementPagination.length, await settlement.settlementCount());
if (
  (await ethers.provider.getBalance(gatewayDeployment.address)) !== 0n ||
  (await testUSDT.balanceOf(gatewayDeployment.address)) !== 0n ||
  (await token.balanceOf(gatewayDeployment.address)) !== 0n ||
  (await ethers.provider.getBalance(lensDeployment.address)) !== 0n ||
  (await testUSDT.balanceOf(lensDeployment.address)) !== 0n ||
  (await token.balanceOf(lensDeployment.address)) !== 0n
) {
  throw new Error("New Access Layer unexpectedly holds assets.");
}

const postDeployment = await economicSnapshot();
if (JSON.stringify(postDeployment) !== JSON.stringify(preDeployment)) {
  throw new Error("Economic state changed during Access Layer deployment.");
}
const coreRuntimeAfter: Record<string, Awaited<ReturnType<typeof runtimeIdentity>>> = {};
for (const [name, before] of Object.entries(coreRuntimeBefore)) {
  const address =
    name === "oldLens"
      ? addresses.oldLens
      : name === "oldGateway"
        ? addresses.oldGateway
        : addresses[name as keyof typeof addresses];
  const after = await runtimeIdentity(address);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(`${name} runtime changed during Access Layer deployment.`);
  }
  coreRuntimeAfter[name] = after;
}

record.stage = "deployment_readback_pass";
record.postDeployment = postDeployment;
record.invariantComparison = {
  exactEconomicStateMatch: true,
  coreRuntimeExactMatch: true,
  marketplaceAuthorizationUnchanged: true,
  deploymentLogsEmpty: true,
  noEconomicEvent: true,
};
record.coreRuntimeAfter = coreRuntimeAfter;
record.gatewayBootstrap = {
  chainId: (await gateway.chainId()).toString(),
  economicGeneration: (await gateway.deploymentGeneration()).toString(),
  accessApiVersion: version.map((item: bigint) => item.toString()),
  discoveredModules,
  discoveredCodehashes,
  protocolSnapshot,
  marketplaceSnapshot,
  userSnapshot,
  orderPagination,
  settlementPagination,
  wiringHealth: gatewayHealth,
  balances: {
    native: "0",
    testUSDT: "0",
    avs: "0",
  },
};
await persist();

for (const deployment of [lensDeployment, gatewayDeployment]) {
  deployment.sourceVerification = await verifyWithSourcifyV2({
    chainId: checked.chainId,
    address: deployment.address,
    contractIdentifier: deployment.contractIdentifier,
    creationTransactionHash: deployment.deploymentTransaction,
  });
  await persist();
}

record.sourceVerification.status = "2/2_exact_match";
record.stage = "pass";
await persist();

console.log("PHASE_3B_2_ACCESS_API_V1_1_0_BSC_TESTNET=PASS");
console.log(`ECONOMIC_GENERATION=${GENERATION}`);
console.log("ACCESS_API_VERSION=1.1.0");
console.log(`NEW_LENS=${lensDeployment.address}`);
console.log(`NEW_GATEWAY=${gatewayDeployment.address}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log(`PRIVATE_EVIDENCE=${EVIDENCE_PATH}`);
console.log("CORE_ECONOMIC_CONTRACTS_CHANGED=false");
console.log("MARKETPLACE_AUTHORIZATION_CHANGED=false");
console.log("ECONOMIC_TRANSACTION=false");
console.log("SETTLEMENT=false");
console.log("MIGRATION=false");
console.log("LOCK=false");
console.log("RENOUNCE=false");
console.log("MAINNET=false");
console.log("COMMIT=false");
console.log("PUSH=false");