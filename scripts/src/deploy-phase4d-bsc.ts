import "@nomicfoundation/hardhat-ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

import {
  APPROVED_DEPLOYER,
  MINIMUM_BALANCE_WEI,
  PHASE3B_CHAIN_ID,
  preflight,
} from "./phase3b-bsc-common.js";

const DEPLOY_CONFIRM = "BSC_TESTNET_PHASE4D_MIGRATION";
const DEPLOYMENT_PATH = "deployments/bsc-testnet/phase4d-migration.json";
const EVIDENCE_DIRECTORY = ".local/phase4d-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-migration.json`;

const TEST_USDT = "0x398bc6c1201690ec7cDF632aDc82B805240c3F9a";
const AVS_TOKEN = "0x2861F3d12082710118391f06F818CA3412ffFE87";
const AVS_LEDGER = "0x643c16B56f528503FB0f4e3e95E48eBf1D73982e";
const AVS_VAULT = "0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85";
const OLD_USER = "0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba";
const BENEFICIARY = "0x46785c0bcb28c29e0CfBeF23101C98CA8356FC27";
const DEPOSIT_AMOUNT = 10_000n * 10n ** 18n;
const ACCUMULATED_PROFIT = 2_000n * 10n ** 18n;
const TOTAL_PROFIT_EVER = 999_000n * 10n ** 18n;
const MIGRATION_AMOUNT = DEPOSIT_AMOUNT + ACCUMULATED_PROFIT;

if (process.env.PHASE4D_DEPLOY_CONFIRM !== DEPLOY_CONFIRM) {
  throw new Error(
    `Deployment is disabled. Set PHASE4D_DEPLOY_CONFIRM=${DEPLOY_CONFIRM} to deploy Phase 4D on BSC Testnet.`,
  );
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No deployer signer is configured.");
if (checked.chainId !== PHASE3B_CHAIN_ID) {
  throw new Error("Refusing operation outside BSC Testnet.");
}
if (checked.deployer.toLowerCase() !== APPROVED_DEPLOYER.toLowerCase()) {
  throw new Error("Configured signer is not the approved Testnet owner.");
}
if (checked.balance < MINIMUM_BALANCE_WEI) {
  throw new Error("Deployer balance is below the required Testnet minimum.");
}

const existingRecord = await readFile(DEPLOYMENT_PATH, "utf8").catch(
  () => null,
);
if (existingRecord) {
  throw new Error(
    `${DEPLOYMENT_PATH} already exists. Refusing to deploy a second Phase 4D system.`,
  );
}

function requireAddress(label: string, actual: string, expected: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

async function deployAndRecord(
  name: string,
  constructorArguments: readonly unknown[],
) {
  const contract = await ethers.deployContract(name, [...constructorArguments]);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error(`${name} has no deployment transaction.`);
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${name} deployment receipt is unavailable.`);
  const runtime = await ethers.provider.getCode(address);
  if (runtime === "0x") throw new Error(`${name} has no runtime bytecode.`);
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  if (!block) throw new Error(`${name} deployment block is unavailable.`);
  return {
    name,
    address,
    constructorArguments: constructorArguments.map(String),
    deploymentTransaction: receipt.hash,
    deploymentBlock: receipt.blockNumber,
    deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    runtimeBytecodeHash: ethers.keccak256(runtime),
    gasUsed: receipt.gasUsed.toString(),
    sourceVerification: {
      status: "pending",
      bscScan: `https://testnet.bscscan.com/address/${address}#code`,
      sourcify: `https://repo.sourcify.dev/97/${address}`,
    },
  };
}

const testUsdt = await ethers.getContractAt("TestUSDT", TEST_USDT);
const avsToken = await ethers.getContractAt("AVSToken", AVS_TOKEN);
const avsLedger = await ethers.getContractAt("AVSLedger", AVS_LEDGER);
const avsVault = await ethers.getContractAt("AVSVault", AVS_VAULT);
const zero = ethers.ZeroAddress;

requireAddress("TestUSDT owner", await testUsdt.owner(), checked.deployer);
requireAddress("AVSToken owner", await avsToken.owner(), checked.deployer);
requireAddress("AVSLedger owner", await avsLedger.owner(), checked.deployer);
requireAddress("AVSVault owner", await avsVault.owner(), checked.deployer);
requireAddress("AVSVault USDT", await avsVault.USDT(), TEST_USDT);
requireAddress("AVSVault AVSToken", await avsVault.avsToken(), AVS_TOKEN);
requireAddress("AVSVault AVSLedger", await avsVault.avsLedger(), AVS_LEDGER);

if (
  (await avsVault.migration()) !== zero ||
  (await avsVault.marketplace()) !== zero ||
  (await avsVault.tradingContract()) !== zero ||
  (await avsVault.configurationLocked()) ||
  (await avsVault.reserveTarget()) !== 0n ||
  (await avsToken.accountPolicy()) !== zero ||
  (await avsToken.totalSupply()) !== 0n ||
  (await avsToken.accountPolicyLocked()) ||
  (await avsLedger.totalNetAssets()) !== 0n ||
  (await testUsdt.balanceOf(AVS_VAULT)) !== 0n
) {
  throw new Error(
    "Existing Testnet AVS state is not the approved genesis state.",
  );
}

console.log("PHASE_4D_BSC_TESTNET_DEPLOYMENT_PREFLIGHT=PASS");
console.log(`NETWORK=BSC_TESTNET`);
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${checked.deployer}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${checked.balance}`);
console.log(`TEST_USDT=${TEST_USDT}`);
console.log(`AVS_TOKEN=${AVS_TOKEN}`);
console.log(`AVS_LEDGER=${AVS_LEDGER}`);
console.log(`AVS_VAULT=${AVS_VAULT}`);
console.log("MAINNET_INTERACTION=false");

const oldLedgerRecord = await deployAndRecord("OldLedgerMock", [
  checked.deployer,
]);
const oldVaultRecord = await deployAndRecord("OldVaultMock", [
  checked.deployer,
  TEST_USDT,
  oldLedgerRecord.address,
]);
const policyRecord = await deployAndRecord("AccountPolicyMock", [
  checked.deployer,
  AVS_TOKEN,
]);

const oldLedger = await ethers.getContractAt(
  "OldLedgerMock",
  oldLedgerRecord.address,
);
const oldVault = await ethers.getContractAt(
  "OldVaultMock",
  oldVaultRecord.address,
);
const policy = await ethers.getContractAt(
  "AccountPolicyMock",
  policyRecord.address,
);

const wiringTxs: Record<string, string> = {};
const setVaultTx = await oldLedger.setVault(oldVaultRecord.address);
wiringTxs.oldLedgerVault = (await setVaultTx.wait())!.hash;
const setApyTx = await oldLedger.setDailyAPYBps(0);
wiringTxs.oldLedgerDailyApy = (await setApyTx.wait())!.hash;

const seedTx = await oldLedger.seedUser(
  OLD_USER,
  DEPOSIT_AMOUNT,
  ACCUMULATED_PROFIT,
  TOTAL_PROFIT_EVER,
  1,
);
wiringTxs.seedUser = (await seedTx.wait())!.hash;

const fundTx = await testUsdt.mint(oldVaultRecord.address, MIGRATION_AMOUNT);
wiringTxs.oldVaultFunding = (await fundTx.wait())!.hash;

if ((await testUsdt.balanceOf(oldVaultRecord.address)) !== MIGRATION_AMOUNT) {
  throw new Error("OldVaultMock funding is not exactly 12,000 TestUSDT.");
}

const setPolicyTx = await avsToken.setAccountPolicy(policyRecord.address);
wiringTxs.accountPolicy = (await setPolicyTx.wait())!.hash;
const authorizeTx = await policy.authorizeAccount(BENEFICIARY);
wiringTxs.beneficiaryAuthorization = (await authorizeTx.wait())!.hash;

if (!(await avsToken.isWhitelisted(BENEFICIARY))) {
  throw new Error("Beneficiary authorization did not take effect.");
}

const reserveTx = await avsVault.setReserveTarget(MIGRATION_AMOUNT);
wiringTxs.reserveTarget = (await reserveTx.wait())!.hash;

const migrationRecord = await deployAndRecord("Migration", [
  checked.deployer,
  oldLedgerRecord.address,
  oldVaultRecord.address,
  TEST_USDT,
  AVS_VAULT,
  AVS_LEDGER,
  AVS_TOKEN,
]);
const migration = await ethers.getContractAt(
  "Migration",
  migrationRecord.address,
);

const executorTx = await oldVault.setExecutor(migrationRecord.address, true);
wiringTxs.migrationExecutor = (await executorTx.wait())!.hash;
const migrationBindingTx = await avsVault.setMigration(migrationRecord.address);
wiringTxs.avsVaultMigration = (await migrationBindingTx.wait())!.hash;

const capitalId = await migration.capitalId(OLD_USER);
const quote = await avsLedger.quoteCapitalInflow(MIGRATION_AMOUNT);
const preflightState = {
  oldLedger: {
    vault: await oldLedger.vault(),
    userInfo: await oldLedger.getUserInfo(OLD_USER),
  },
  oldVault: {
    USDT: await oldVault.USDT(),
    ledger: await oldVault.ledger(),
    executor: await oldVault.executors(migrationRecord.address),
    usdtBalance: await testUsdt.balanceOf(oldVaultRecord.address),
  },
  migration: {
    usdtBalance: await testUsdt.balanceOf(migrationRecord.address),
    migrated: await migration.migrated(OLD_USER),
    migrationClosed: await migration.migrationClosed(),
  },
  avsVault: {
    USDT: await testUsdt.balanceOf(AVS_VAULT),
    migration: await avsVault.migration(),
    reserveTarget: await avsVault.reserveTarget(),
  },
  avsLedger: {
    vault: await avsLedger.vault(),
    avsToken: await avsLedger.avsToken(),
    totalNetAssets: await avsLedger.totalNetAssets(),
    currentAVSValue: await avsLedger.currentAVSValue(),
    quote,
    capitalProcessed: await avsLedger.processedCapitalInflow(capitalId),
  },
  avsToken: {
    vault: await avsToken.vault(),
    accountPolicy: await avsToken.accountPolicy(),
    beneficiaryWhitelisted: await avsToken.isWhitelisted(BENEFICIARY),
    totalSupply: await avsToken.totalSupply(),
  },
};

requireAddress(
  "OldLedger.vault",
  preflightState.oldLedger.vault,
  oldVaultRecord.address,
);
requireAddress("OldVault.USDT", preflightState.oldVault.USDT, TEST_USDT);
requireAddress(
  "OldVault.ledger",
  preflightState.oldVault.ledger,
  oldLedgerRecord.address,
);
requireAddress("AVSLedger.vault", preflightState.avsLedger.vault, AVS_VAULT);
requireAddress(
  "AVSLedger.avsToken",
  preflightState.avsLedger.avsToken,
  AVS_TOKEN,
);
requireAddress("AVSToken.vault", preflightState.avsToken.vault, AVS_VAULT);
requireAddress(
  "AVSVault.migration",
  preflightState.avsVault.migration,
  migrationRecord.address,
);
if (
  preflightState.oldLedger.userInfo.totalBalance !== MIGRATION_AMOUNT ||
  preflightState.oldVault.usdtBalance !== MIGRATION_AMOUNT ||
  preflightState.oldVault.executor !== true ||
  preflightState.migration.usdtBalance !== 0n ||
  preflightState.migration.migrated ||
  preflightState.migration.migrationClosed ||
  preflightState.avsVault.USDT !== 0n ||
  preflightState.avsVault.reserveTarget !== MIGRATION_AMOUNT ||
  preflightState.avsLedger.totalNetAssets !== 0n ||
  preflightState.avsLedger.currentAVSValue !== 10n ** 18n ||
  preflightState.avsLedger.quote !== MIGRATION_AMOUNT ||
  preflightState.avsLedger.capitalProcessed ||
  preflightState.avsToken.accountPolicy.toLowerCase() !==
    policyRecord.address.toLowerCase() ||
  !preflightState.avsToken.beneficiaryWhitelisted ||
  preflightState.avsToken.totalSupply !== 0n
) {
  throw new Error("Phase 4D read-only preflight failed before migration.");
}

const migrationTx = await migration.migrate(OLD_USER, BENEFICIARY);
const migrationReceipt = await migrationTx.wait();
if (!migrationReceipt) throw new Error("Migration receipt is unavailable.");
const migrationBlock = await ethers.provider.getBlock(
  migrationReceipt.blockNumber,
);
if (!migrationBlock) throw new Error("Migration block is unavailable.");

let migratedEvent: ReturnType<typeof migration.interface.parseLog> = null;
for (const log of migrationReceipt.logs) {
  try {
    const parsed = migration.interface.parseLog(log);
    if (parsed?.name === "UserMigrated") {
      migratedEvent = parsed;
      break;
    }
  } catch {
    // Ignore logs emitted by the downstream AVS contracts.
  }
}
if (!migratedEvent) throw new Error("UserMigrated event was not emitted.");

const finalState = {
  oldLedger: await oldLedger.getUserInfo(OLD_USER),
  oldVaultUsdt: await testUsdt.balanceOf(oldVaultRecord.address),
  migrationUsdt: await testUsdt.balanceOf(migrationRecord.address),
  migrationAllowance: await testUsdt.allowance(
    migrationRecord.address,
    AVS_VAULT,
  ),
  migrated: await migration.migrated(OLD_USER),
  avsVaultUsdt: await testUsdt.balanceOf(AVS_VAULT),
  avsLedgerAssets: await avsLedger.totalNetAssets(),
  avsTokenSupply: await avsToken.totalSupply(),
  beneficiaryAvs: await avsToken.balanceOf(BENEFICIARY),
  capitalProcessed: await avsLedger.processedCapitalInflow(capitalId),
  capitalRecord: await avsLedger.capitalRecord(capitalId),
  currentAVSValue: await avsLedger.currentAVSValue(),
};

if (
  finalState.oldLedger.totalBalance !== 0n ||
  finalState.oldVaultUsdt !== 0n ||
  finalState.migrationUsdt !== 0n ||
  finalState.migrationAllowance !== 0n ||
  !finalState.migrated ||
  finalState.avsVaultUsdt !== MIGRATION_AMOUNT ||
  finalState.avsLedgerAssets !== MIGRATION_AMOUNT ||
  finalState.avsTokenSupply !== MIGRATION_AMOUNT ||
  finalState.beneficiaryAvs !== MIGRATION_AMOUNT ||
  !finalState.capitalProcessed ||
  finalState.currentAVSValue !== 10n ** 18n ||
  finalState.capitalRecord.beneficiary.toLowerCase() !==
    BENEFICIARY.toLowerCase() ||
  finalState.capitalRecord.capitalAmount !== MIGRATION_AMOUNT ||
  finalState.capitalRecord.sharesQuoted !== MIGRATION_AMOUNT
) {
  throw new Error("Phase 4D post-migration state does not match exactly.");
}

let duplicateSimulation = "unexpected_success";
try {
  await migration.migrate.staticCall(OLD_USER, BENEFICIARY);
} catch (error) {
  const decoded = migration.interface.parseError(
    error instanceof Error && "data" in error
      ? String((error as { data?: unknown }).data)
      : "",
  );
  duplicateSimulation = decoded?.name ?? "reverted";
}
if (duplicateSimulation !== "AlreadyMigrated") {
  throw new Error(
    `Duplicate migration simulation did not return AlreadyMigrated: ${duplicateSimulation}`,
  );
}

const block = await ethers.provider.getBlock(migrationReceipt.blockNumber);
const evidence = {
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  owner: checked.deployer,
  testnetOnly: true,
  canonicalExistingContracts: {
    testUsdt: TEST_USDT,
    avsToken: AVS_TOKEN,
    avsLedger: AVS_LEDGER,
    avsVault: AVS_VAULT,
  },
  participants: { oldUser: OLD_USER, beneficiary: BENEFICIARY },
  amounts: {
    depositAmount: DEPOSIT_AMOUNT.toString(),
    accumulatedProfit: ACCUMULATED_PROFIT.toString(),
    totalProfitEver: TOTAL_PROFIT_EVER.toString(),
    migrationAmount: MIGRATION_AMOUNT.toString(),
  },
  deployments: {
    oldLedger: oldLedgerRecord,
    oldVault: oldVaultRecord,
    accountPolicy: policyRecord,
    migration: migrationRecord,
  },
  configurationTransactions: wiringTxs,
  capitalId,
  quote: quote.toString(),
  migrationTransaction: {
    hash: migrationReceipt.hash,
    block: migrationReceipt.blockNumber,
    timestamp: block?.timestamp ?? null,
    gasUsed: migrationReceipt.gasUsed.toString(),
    event: {
      oldUser: migratedEvent.args[0],
      beneficiary: migratedEvent.args[1],
      capitalId: migratedEvent.args[2],
      migratedAmount: migratedEvent.args[3].toString(),
      sharesMinted: migratedEvent.args[4].toString(),
    },
  },
  preflightState,
  finalState,
  duplicateSimulation,
  restrictions: {
    mainnetInteraction: false,
    migrationClosed: false,
    avsVaultConfigurationLocked: await avsVault.configurationLocked(),
    avsTokenVaultLocked: await avsToken.vaultLocked(),
    avsTokenAccountPolicyLocked: await avsToken.accountPolicyLocked(),
  },
};

if (
  evidence.restrictions.avsVaultConfigurationLocked ||
  evidence.restrictions.avsTokenVaultLocked ||
  evidence.restrictions.avsTokenAccountPolicyLocked
) {
  throw new Error("A forbidden Testnet configuration lock was observed.");
}

await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
await writeFile(
  EVIDENCE_PATH,
  `${JSON.stringify(evidence, bigintReplacer, 2)}\n`,
  "utf8",
);
await writeFile(
  DEPLOYMENT_PATH,
  `${JSON.stringify(evidence, bigintReplacer, 2)}\n`,
  "utf8",
);

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

console.log("PHASE_4D_TESTNET_MIGRATION=SUCCESS");
console.log(`OLD_LEDGER_ADDRESS=${oldLedgerRecord.address}`);
console.log(`OLD_VAULT_ADDRESS=${oldVaultRecord.address}`);
console.log(`ACCOUNT_POLICY_ADDRESS=${policyRecord.address}`);
console.log(`MIGRATION_ADDRESS=${migrationRecord.address}`);
console.log(`MIGRATION_TX_HASH=${migrationReceipt.hash}`);
console.log(`MIGRATION_BLOCK=${migrationReceipt.blockNumber}`);
console.log(`CAPITAL_ID=${capitalId}`);
console.log(`MIGRATED_AMOUNT=${MIGRATION_AMOUNT}`);
console.log(`SHARES_MINTED=${MIGRATION_AMOUNT}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log("MAINNET_INTERACTION=false");
console.log("MIGRATION_CLOSED=false");
console.log("CONFIGURATION_LOCKED=false");
