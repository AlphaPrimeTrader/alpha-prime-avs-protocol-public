import "@nomicfoundation/hardhat-ethers";
import { readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

import { preflight } from "./phase3b-bsc-common.js";

const CONFIRMATION = "BSC_TESTNET_PHASE4D_EXECUTE_MIGRATION";
const EVIDENCE_PATH = ".local/phase4d-evidence/bsc-testnet-deployments.json";
const DEPLOYMENT_PATH = "deployments/bsc-testnet/phase4d-migration.json";
const OLD_USER = "0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba";
const BENEFICIARY = "0x46785c0bcb28c29e0CfBeF23101C98CA8356FC27";
const DEPOSIT = 10_000n * 10n ** 18n;
const PROFIT = 2_000n * 10n ** 18n;
const HISTORICAL_PROFIT = 999_000n * 10n ** 18n;
const AMOUNT = DEPOSIT + PROFIT;

if (process.env.PHASE4D_EXECUTE_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Execution disabled. Set PHASE4D_EXECUTE_CONFIRM=${CONFIRMATION}.`,
  );
}

type Deployment = {
  name: string;
  address: string;
  sourceVerification: {
    status: string;
    sourcifyCreationMatch?: string;
    sourcifyRuntimeMatch?: string;
    bscScanExternalVerificationId?: string | null;
    bscScanPublicVerification?: {
      apiStatus?: string;
      contractName?: string;
      sourceCodePresent?: boolean;
    };
  };
};
type RecordShape = {
  network: string;
  chainId: string;
  owner: string;
  canonicalContracts: {
    testUsdt: string;
    avsToken: string;
    avsLedger: string;
    avsVault: string;
  };
  deployments: {
    oldLedger: Deployment;
    oldVault: Deployment;
    accountPolicy: Deployment;
    migration: Deployment;
  };
  publicBscScanVerified: boolean;
  migrationExecution: unknown;
  configurationTransactions?: Record<string, string>;
};

const record = JSON.parse(
  await readFile(DEPLOYMENT_PATH, "utf8"),
) as RecordShape;
if (
  record.network !== "bscTestnet" ||
  record.chainId !== "97" ||
  !record.publicBscScanVerified ||
  record.migrationExecution !== null
) {
  throw new Error("Phase 4D deployment record is not approved for execution.");
}
for (const [name, deployment] of Object.entries(record.deployments)) {
  if (
    deployment.sourceVerification.status !== "exact_match" ||
    deployment.sourceVerification.sourcifyCreationMatch !== "exact_match" ||
    deployment.sourceVerification.sourcifyRuntimeMatch !== "exact_match" ||
    !deployment.sourceVerification.bscScanExternalVerificationId ||
    deployment.sourceVerification.bscScanPublicVerification?.apiStatus !==
      "1" ||
    deployment.sourceVerification.bscScanPublicVerification?.contractName !==
      deployment.name ||
    !deployment.sourceVerification.bscScanPublicVerification?.sourceCodePresent
  ) {
    throw new Error(`${name} does not have complete exact-match verification.`);
  }
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
if (checked.deployer.toLowerCase() !== record.owner.toLowerCase()) {
  throw new Error("Signer does not match the recorded Phase 4D owner.");
}

const {
  testUsdt: TEST_USDT,
  avsToken: AVS_TOKEN,
  avsLedger: AVS_LEDGER,
  avsVault: AVS_VAULT,
} = record.canonicalContracts;
const oldLedger = await ethers.getContractAt(
  "OldLedgerMock",
  record.deployments.oldLedger.address,
);
const oldVault = await ethers.getContractAt(
  "OldVaultMock",
  record.deployments.oldVault.address,
);
const policy = await ethers.getContractAt(
  "AccountPolicyMock",
  record.deployments.accountPolicy.address,
);
const migration = await ethers.getContractAt(
  "Migration",
  record.deployments.migration.address,
);
const testUsdt = await ethers.getContractAt("TestUSDT", TEST_USDT);
const avsToken = await ethers.getContractAt("AVSToken", AVS_TOKEN);
const avsLedger = await ethers.getContractAt("AVSLedger", AVS_LEDGER);
const avsVault = await ethers.getContractAt("AVSVault", AVS_VAULT);
const zero = ethers.ZeroAddress;

for (const [name, deployment] of Object.entries(record.deployments)) {
  if ((await ethers.provider.getCode(deployment.address)) === "0x") {
    throw new Error(`${name} has no runtime bytecode.`);
  }
}

function requireAddress(label: string, actual: string, expected: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

requireAddress("OldLedger owner", await oldLedger.owner(), checked.deployer);
requireAddress(
  "OldLedger vault",
  await oldLedger.vault(),
  await oldVault.getAddress(),
);
requireAddress("OldVault owner", await oldVault.owner(), checked.deployer);
requireAddress("OldVault USDT", await oldVault.USDT(), TEST_USDT);
requireAddress(
  "OldVault ledger",
  await oldVault.ledger(),
  await oldLedger.getAddress(),
);
requireAddress("Policy owner", await policy.owner(), checked.deployer);
requireAddress("Policy token", await policy.avsToken(), AVS_TOKEN);
requireAddress("AVSToken owner", await avsToken.owner(), checked.deployer);
requireAddress("AVSLedger owner", await avsLedger.owner(), checked.deployer);
requireAddress("AVSVault owner", await avsVault.owner(), checked.deployer);

const emptyUser = await oldLedger.getUserInfo(OLD_USER);
if (
  emptyUser.totalBalance !== 0n ||
  (await testUsdt.balanceOf(await oldVault.getAddress())) !== 0n ||
  (await testUsdt.balanceOf(await migration.getAddress())) !== 0n ||
  (await avsVault.migration()) !== zero ||
  (await avsVault.reserveTarget()) !== 0n ||
  (await avsVault.marketplace()) !== zero ||
  (await avsVault.tradingContract()) !== zero ||
  (await avsVault.configurationLocked()) ||
  (await avsToken.accountPolicy()) !== zero ||
  (await avsToken.totalSupply()) !== 0n ||
  (await avsLedger.totalNetAssets()) !== 0n ||
  (await migration.migrated(OLD_USER)) ||
  (await migration.migrationClosed())
) {
  throw new Error("Phase 4D execution pre-state is not pristine.");
}

console.log("PHASE_4D_EXECUTION_PREFLIGHT=PASS");
console.log("ALL_NEW_SOURCES_PUBLICLY_VERIFIED=true");
console.log("MAINNET_INTERACTION=false");

const transactions: Record<string, string> = {};
transactions.dailyApy = await confirmedHash(await oldLedger.setDailyAPYBps(0));
transactions.seedUser = await confirmedHash(
  await oldLedger.seedUser(OLD_USER, DEPOSIT, PROFIT, HISTORICAL_PROFIT, 1),
);
transactions.oldVaultFunding = await confirmedHash(
  await testUsdt.mint(await oldVault.getAddress(), AMOUNT),
);
transactions.accountPolicy = await confirmedHash(
  await avsToken.setAccountPolicy(await policy.getAddress()),
);
transactions.beneficiaryAuthorization = await confirmedHash(
  await policy.authorizeAccount(BENEFICIARY),
);
transactions.reserveTarget = await confirmedHash(
  await avsVault.setReserveTarget(AMOUNT),
);
transactions.migrationExecutor = await confirmedHash(
  await oldVault.setExecutor(await migration.getAddress(), true),
);
transactions.avsVaultMigration = await confirmedHash(
  await avsVault.setMigration(await migration.getAddress()),
);

const capitalId = await migration.capitalId(OLD_USER);
const quote = await avsLedger.quoteCapitalInflow(AMOUNT);
const userBefore = await oldLedger.getUserInfo(OLD_USER);
if (
  userBefore.totalBalance !== AMOUNT ||
  (await testUsdt.balanceOf(await oldVault.getAddress())) !== AMOUNT ||
  !(await oldVault.executors(await migration.getAddress())) ||
  (await testUsdt.balanceOf(await migration.getAddress())) !== 0n ||
  (await testUsdt.balanceOf(AVS_VAULT)) !== 0n ||
  (await avsVault.reserveTarget()) !== AMOUNT ||
  (await avsVault.migration()).toLowerCase() !==
    (await migration.getAddress()).toLowerCase() ||
  (await avsToken.accountPolicy()).toLowerCase() !==
    (await policy.getAddress()).toLowerCase() ||
  !(await avsToken.isWhitelisted(BENEFICIARY)) ||
  (await avsToken.totalSupply()) !== 0n ||
  (await avsLedger.totalNetAssets()) !== 0n ||
  (await avsLedger.currentAVSValue()) !== 10n ** 18n ||
  quote !== AMOUNT ||
  (await avsLedger.processedCapitalInflow(capitalId))
) {
  throw new Error("Complete read-only migration preflight failed.");
}

const supplyBefore = await avsToken.totalSupply();
const navBefore = await avsLedger.totalNetAssets();
const migrationTransaction = await migration.migrate(OLD_USER, BENEFICIARY);
const receipt = await migrationTransaction.wait();
if (!receipt) throw new Error("Migration receipt missing.");

let migratedEvent: ReturnType<typeof migration.interface.parseLog> = null;
for (const log of receipt.logs) {
  try {
    const parsed = migration.interface.parseLog(log);
    if (parsed?.name === "UserMigrated") {
      migratedEvent = parsed;
      break;
    }
  } catch {
    // Ignore downstream contract logs.
  }
}
if (!migratedEvent) throw new Error("UserMigrated event missing.");

const userAfter = await oldLedger.getUserInfo(OLD_USER);
const capitalRecord = await avsLedger.capitalRecord(capitalId);
const finalState = {
  oldUserBalance: userAfter.totalBalance,
  oldVaultUsdt: await testUsdt.balanceOf(await oldVault.getAddress()),
  migrationUsdt: await testUsdt.balanceOf(await migration.getAddress()),
  avsVaultUsdt: await testUsdt.balanceOf(AVS_VAULT),
  navBefore,
  navAfter: await avsLedger.totalNetAssets(),
  supplyBefore,
  supplyAfter: await avsToken.totalSupply(),
  beneficiaryAvs: await avsToken.balanceOf(BENEFICIARY),
  migrationAllowance: await testUsdt.allowance(
    await migration.getAddress(),
    AVS_VAULT,
  ),
  capitalProcessed: await avsLedger.processedCapitalInflow(capitalId),
  currentAVSValue: await avsLedger.currentAVSValue(),
};
if (
  finalState.oldUserBalance !== 0n ||
  finalState.oldVaultUsdt !== 0n ||
  finalState.migrationUsdt !== 0n ||
  finalState.avsVaultUsdt !== AMOUNT ||
  finalState.navBefore !== 0n ||
  finalState.navAfter !== AMOUNT ||
  finalState.supplyBefore !== 0n ||
  finalState.supplyAfter !== AMOUNT ||
  finalState.beneficiaryAvs !== AMOUNT ||
  finalState.migrationAllowance !== 0n ||
  !finalState.capitalProcessed ||
  finalState.currentAVSValue !== 10n ** 18n ||
  capitalRecord.beneficiary.toLowerCase() !== BENEFICIARY.toLowerCase() ||
  capitalRecord.capitalAmount !== AMOUNT ||
  capitalRecord.sharesQuoted !== AMOUNT ||
  migratedEvent.args[0].toLowerCase() !== OLD_USER.toLowerCase() ||
  migratedEvent.args[1].toLowerCase() !== BENEFICIARY.toLowerCase() ||
  migratedEvent.args[2] !== capitalId ||
  migratedEvent.args[3] !== AMOUNT ||
  migratedEvent.args[4] !== AMOUNT
) {
  throw new Error("Final Phase 4D state or UserMigrated event is incorrect.");
}

let duplicateSimulation = "unexpected_success";
try {
  await migration.migrate.staticCall(OLD_USER, BENEFICIARY);
} catch (error) {
  const data =
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "string"
      ? error.data
      : null;
  duplicateSimulation = data
    ? (migration.interface.parseError(data)?.name ?? "reverted")
    : "reverted";
}
if (duplicateSimulation !== "AlreadyMigrated") {
  throw new Error(`Duplicate simulation result: ${duplicateSimulation}`);
}
if (
  (await migration.migrationClosed()) ||
  (await avsVault.configurationLocked()) ||
  (await avsToken.vaultLocked()) ||
  (await avsToken.accountPolicyLocked())
) {
  throw new Error("A forbidden closure or configuration lock was observed.");
}

record.configurationTransactions = transactions;
record.migrationExecution = {
  oldUser: OLD_USER,
  beneficiary: BENEFICIARY,
  deposit: DEPOSIT,
  accumulatedProfit: PROFIT,
  historicalProfitExcluded: HISTORICAL_PROFIT,
  migratedAmount: AMOUNT,
  sharesMinted: AMOUNT,
  capitalId,
  quote,
  transactionHash: receipt.hash,
  block: receipt.blockNumber,
  gasUsed: receipt.gasUsed,
  finalState,
  duplicateSimulation,
  restrictions: {
    mainnetInteraction: false,
    migrationClosed: false,
    configurationLocked: false,
  },
};
const json = `${JSON.stringify(record, bigintReplacer, 2)}\n`;
await writeFile(EVIDENCE_PATH, json, "utf8");
await writeFile(DEPLOYMENT_PATH, json, "utf8");

console.log("PHASE_4D_TESTNET_MIGRATION=SUCCESS");
console.log(`MIGRATION_TX_HASH=${receipt.hash}`);
console.log(`MIGRATION_BLOCK=${receipt.blockNumber}`);
console.log(`CAPITAL_ID=${capitalId}`);
console.log(`MIGRATED_AMOUNT=${AMOUNT}`);
console.log(`SHARES_MINTED=${AMOUNT}`);
console.log("DUPLICATE_SIMULATION=AlreadyMigrated");
console.log("MAINNET_INTERACTION=false");
console.log("MIGRATION_CLOSED=false");
console.log("CONFIGURATION_LOCKED=false");

async function confirmedHash(transaction: {
  wait(): Promise<{ hash: string } | null>;
}) {
  const receipt = await transaction.wait();
  if (!receipt) throw new Error("Configuration transaction receipt missing.");
  return receipt.hash;
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
