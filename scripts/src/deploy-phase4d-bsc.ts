import "@nomicfoundation/hardhat-ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

import { preflight } from "./phase3b-bsc-common.js";
import {
  type SourceVerification,
  verifyWithSourcifyV2,
} from "./sourcify-v2.js";

const CONFIRMATION = "BSC_TESTNET_PHASE4D_DEPLOY_VERIFY_ONLY";
const EVIDENCE_DIRECTORY = ".local/phase4d-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-deployments.json`;
const DEPLOYMENT_PATH = "deployments/bsc-testnet/phase4d-migration.json";

const TEST_USDT = "0x398bc6c1201690ec7cDF632aDc82B805240c3F9a";
const AVS_TOKEN = "0x2861F3d12082710118391f06F818CA3412ffFE87";
const AVS_LEDGER = "0x643c16B56f528503FB0f4e3e95E48eBf1D73982e";
const AVS_VAULT = "0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85";

if (process.env.PHASE4D_DEPLOY_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Deployment disabled. Set PHASE4D_DEPLOY_CONFIRM=${CONFIRMATION}.`,
  );
}
if (
  (await readFile(DEPLOYMENT_PATH, "utf8").catch(() => null)) ||
  (await readFile(EVIDENCE_PATH, "utf8").catch(() => null))
) {
  throw new Error(
    "Phase 4D deployment evidence already exists; refusing duplicates.",
  );
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const zero = ethers.ZeroAddress;
const testUsdt = await ethers.getContractAt("TestUSDT", TEST_USDT);
const avsToken = await ethers.getContractAt("AVSToken", AVS_TOKEN);
const avsLedger = await ethers.getContractAt("AVSLedger", AVS_LEDGER);
const avsVault = await ethers.getContractAt("AVSVault", AVS_VAULT);

function requireAddress(label: string, actual: string, expected: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

requireAddress("TestUSDT owner", await testUsdt.owner(), checked.deployer);
requireAddress("AVSToken owner", await avsToken.owner(), checked.deployer);
requireAddress("AVSLedger owner", await avsLedger.owner(), checked.deployer);
requireAddress("AVSVault owner", await avsVault.owner(), checked.deployer);
requireAddress("AVSVault USDT", await avsVault.USDT(), TEST_USDT);
requireAddress("AVSVault AVSToken", await avsVault.avsToken(), AVS_TOKEN);
requireAddress("AVSVault AVSLedger", await avsVault.avsLedger(), AVS_LEDGER);
requireAddress("AVSToken Vault", await avsToken.vault(), AVS_VAULT);
requireAddress("AVSLedger Vault", await avsLedger.vault(), AVS_VAULT);
requireAddress("AVSLedger AVSToken", await avsLedger.avsToken(), AVS_TOKEN);

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
    "Canonical Testnet AVS state is not the approved genesis state.",
  );
}

console.log("PHASE_4D_DEPLOYMENT_PREFLIGHT=PASS");
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${checked.deployer}`);
console.log("TEST_USDT_MOVEMENT=false");
console.log("MAINNET_INTERACTION=false");

type Deployment = {
  name: string;
  contractIdentifier: string;
  address: string;
  constructorArguments: string[];
  deploymentTransaction: string;
  deploymentBlock: number;
  deployedAt: string;
  runtimeBytecodeHash: string;
  gasUsed: string;
  sourceVerification: SourceVerification | { status: "pending" };
};

async function deploy(
  name: string,
  contractIdentifier: string,
  constructorArguments: readonly string[],
): Promise<Deployment> {
  const contract = await ethers.deployContract(name, [...constructorArguments]);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error(`${name} deployment transaction missing.`);
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${name} deployment receipt missing.`);
  const runtime = await ethers.provider.getCode(address);
  if (runtime === "0x") throw new Error(`${name} runtime missing.`);
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  if (!block) throw new Error(`${name} deployment block missing.`);
  return {
    name,
    contractIdentifier,
    address,
    constructorArguments: [...constructorArguments],
    deploymentTransaction: receipt.hash,
    deploymentBlock: receipt.blockNumber,
    deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    runtimeBytecodeHash: ethers.keccak256(runtime),
    gasUsed: receipt.gasUsed.toString(),
    sourceVerification: { status: "pending" },
  };
}

const oldLedger = await deploy(
  "OldLedgerMock",
  "contracts/test/OldLedgerMock.sol:OldLedgerMock",
  [checked.deployer],
);
const oldVault = await deploy(
  "OldVaultMock",
  "contracts/test/OldVaultMock.sol:OldVaultMock",
  [checked.deployer, TEST_USDT, oldLedger.address],
);
const accountPolicy = await deploy(
  "AccountPolicyMock",
  "contracts/testnet/AccountPolicyMock.sol:AccountPolicyMock",
  [checked.deployer, AVS_TOKEN],
);

const oldLedgerContract = await ethers.getContractAt(
  "OldLedgerMock",
  oldLedger.address,
);
const setVaultReceipt = await (
  await oldLedgerContract.setVault(oldVault.address)
).wait();
if (!setVaultReceipt)
  throw new Error("OldLedger vault wiring receipt missing.");

const migration = await deploy(
  "Migration",
  "contracts/migration/Migration.sol:Migration",
  [
    checked.deployer,
    oldLedger.address,
    oldVault.address,
    TEST_USDT,
    AVS_VAULT,
    AVS_LEDGER,
    AVS_TOKEN,
  ],
);

const record = {
  schemaVersion: 1,
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  owner: checked.deployer,
  compiler: {
    version: "0.8.28+commit.7893614a",
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
  },
  canonicalContracts: {
    testUsdt: TEST_USDT,
    avsToken: AVS_TOKEN,
    avsLedger: AVS_LEDGER,
    avsVault: AVS_VAULT,
  },
  deployments: { oldLedger, oldVault, accountPolicy, migration },
  preMigrationTransactions: {
    oldLedgerVault: setVaultReceipt.hash,
  },
  publicBscScanVerified: false,
  migrationExecution: null,
};

await persist(record);

for (const deployment of [oldLedger, oldVault, accountPolicy, migration]) {
  console.log(`SOURCIFY_SUBMIT=${deployment.name}`);
  deployment.sourceVerification = await verifyWithSourcifyV2({
    chainId: checked.chainId,
    address: deployment.address,
    contractIdentifier: deployment.contractIdentifier,
    creationTransactionHash: deployment.deploymentTransaction,
  });
  await persist(record);
  console.log(`SOURCIFY_EXACT_MATCH=${deployment.name}`);
  console.log(
    `BSCSCAN_EXTERNAL_VERIFICATION_ACCEPTED=${deployment.name}:${deployment.sourceVerification.bscScanExternalVerificationId}`,
  );
}

console.log("PHASE_4D_DEPLOY_VERIFY=SUCCESS");
console.log(`OLD_LEDGER_ADDRESS=${oldLedger.address}`);
console.log(`OLD_VAULT_ADDRESS=${oldVault.address}`);
console.log(`ACCOUNT_POLICY_ADDRESS=${accountPolicy.address}`);
console.log(`MIGRATION_ADDRESS=${migration.address}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log("PUBLIC_BSCSCAN_VISUAL_CONFIRMATION_REQUIRED=true");
console.log("TEST_USDT_MOVEMENT=false");
console.log("MIGRATION_EXECUTED=false");

async function persist(value: unknown) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(EVIDENCE_PATH, json, "utf8");
  await writeFile(DEPLOYMENT_PATH, json, "utf8");
}
