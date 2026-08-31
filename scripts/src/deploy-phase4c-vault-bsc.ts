import "@nomicfoundation/hardhat-ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

import { MINIMUM_BALANCE_WEI, preflight } from "./phase3b-bsc-common.js";

const EVIDENCE_DIRECTORY = ".local/phase4c-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-vault-deployment.json`;
const TEST_USDT_DEPLOYMENT_PATH = "deployments/bsc-testnet/test-usdt.json";
const DEPLOYMENT_PATH = "deployments/bsc-testnet/avs-vault.json";
const EXPECTED_LEDGER = "0x643c16B56f528503FB0f4e3e95E48eBf1D73982e";
const EXPECTED_AVS_TOKEN = "0x2861F3d12082710118391f06F818CA3412ffFE87";

if (process.env.PHASE4C_VAULT_DEPLOY_CONFIRM !== "BSC_TESTNET_VAULT_ONLY") {
  throw new Error(
    "Deployment is disabled. Set PHASE4C_VAULT_DEPLOY_CONFIRM=BSC_TESTNET_VAULT_ONLY to deploy AVSVault to BSC Testnet.",
  );
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No deployer signer is configured.");

const initialOwner = checked.deployer;
if (initialOwner === ethers.ZeroAddress) {
  throw new Error("Initial owner cannot be the zero address.");
}
if (checked.balance < MINIMUM_BALANCE_WEI) {
  throw new Error("Deployer balance is below the required Testnet minimum.");
}

const testUsdtRecord = JSON.parse(
  await readFile(TEST_USDT_DEPLOYMENT_PATH, "utf8"),
) as {
  network: string;
  chainId: string;
  contract: string;
  address: string;
  initialOwner: string;
  sourceVerification?: { status?: string };
};

if (
  testUsdtRecord.network !== "bscTestnet" ||
  testUsdtRecord.chainId !== "97" ||
  testUsdtRecord.contract !== "TestUSDT" ||
  testUsdtRecord.initialOwner.toLowerCase() !== initialOwner.toLowerCase() ||
  testUsdtRecord.sourceVerification?.status !== "exact_match"
) {
  throw new Error(
    "TestUSDT must be the approved BSC Testnet deployment with exact-match source verification before Vault deployment.",
  );
}

const usdt = await ethers.getContractAt("TestUSDT", testUsdtRecord.address);
const usdtCode = await ethers.provider.getCode(testUsdtRecord.address);
if (usdtCode === "0x") throw new Error("Configured TestUSDT has no bytecode.");
if ((await usdt.decimals()).toString() !== "18") {
  throw new Error("Configured TestUSDT does not use 18 decimals.");
}
if ((await usdt.totalSupply()) !== 0n) {
  throw new Error("Configured TestUSDT already has minted supply.");
}

console.log("PHASE_4C_VAULT_BSC_TESTNET_DEPLOYMENT_PREFLIGHT=PASS");
console.log("NETWORK=BSC_TESTNET");
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${checked.deployer}`);
console.log(`INITIAL_OWNER=${initialOwner}`);
console.log(`USDT=${testUsdtRecord.address}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${checked.balance}`);
console.log(`DEPLOYER_BNB_BALANCE=${ethers.formatEther(checked.balance)} BNB`);
console.log("TEST_USDT_EXACT_MATCH_REQUIRED=true");
console.log("DEPLOYING_EXACTLY_ONE_AVS_VAULT=true");
console.log("CONFIGURATION_EXECUTED=false");
console.log("AVS_MINT_EXECUTED=false");
console.log("FUNDS_TRANSFERRED=false");

const deployment = await ethers.deployContract("AVSVault", [
  initialOwner,
  testUsdtRecord.address,
]);
await deployment.waitForDeployment();
const address = await deployment.getAddress();
const transaction = deployment.deploymentTransaction();
if (!transaction) throw new Error("AVSVault has no deployment transaction.");
const receipt = await transaction.wait();
if (!receipt) throw new Error("AVSVault deployment receipt is unavailable.");
const runtime = await ethers.provider.getCode(address);
if (runtime === "0x") throw new Error("AVSVault has no runtime bytecode.");
const block = await ethers.provider.getBlock(receipt.blockNumber);
if (!block) throw new Error("AVSVault deployment block is unavailable.");

const vault = await ethers.getContractAt("AVSVault", address);
const zero = ethers.ZeroAddress;
const state = {
  owner: await vault.owner(),
  usdt: await vault.USDT(),
  avsToken: await vault.avsToken(),
  avsLedger: await vault.avsLedger(),
  migration: await vault.migration(),
  marketplace: await vault.marketplace(),
  tradingContract: await vault.tradingContract(),
  configurationLocked: await vault.configurationLocked(),
  reserveTarget: (await vault.reserveTarget()).toString(),
  availableMarketLiquidity: (await vault.availableMarketLiquidity()).toString(),
  usdtBalance: (await usdt.balanceOf(address)).toString(),
};

if (state.owner.toLowerCase() !== initialOwner.toLowerCase()) {
  throw new Error("Deployed Vault owner does not equal initialOwner.");
}
if (state.usdt.toLowerCase() !== testUsdtRecord.address.toLowerCase()) {
  throw new Error("Deployed Vault USDT does not equal TestUSDT.");
}
for (const [name, value] of [
  ["avsToken", state.avsToken],
  ["avsLedger", state.avsLedger],
  ["migration", state.migration],
  ["marketplace", state.marketplace],
  ["tradingContract", state.tradingContract],
] as const) {
  if (value !== zero) throw new Error(`${name} is configured unexpectedly.`);
}
if (
  state.configurationLocked ||
  state.reserveTarget !== "0" ||
  state.availableMarketLiquidity !== "0" ||
  state.usdtBalance !== "0"
) {
  throw new Error("Vault initial state is not fully unconfigured.");
}

const deploymentRecord = {
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  contract: "AVSVault",
  address,
  deploymentTransaction: receipt.hash,
  deploymentBlock: receipt.blockNumber,
  deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  deployer: checked.deployer,
  initialOwner,
  usdt: testUsdtRecord.address,
  constructorArguments: [initialOwner, testUsdtRecord.address],
  compiler: {
    version: "0.8.28+commit.7893614a",
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
  },
  runtimeBytecodeHash: ethers.keccak256(runtime),
  gasUsed: receipt.gasUsed.toString(),
  dependencies: {
    avsLedgerCandidate: EXPECTED_LEDGER,
    avsToken: EXPECTED_AVS_TOKEN,
    testUsdt: testUsdtRecord.address,
  },
  initialState: state,
  sourceVerification: {
    status: "pending",
    bscScan: `https://testnet.bscscan.com/address/${address}#code`,
    sourcify: `https://repo.sourcify.dev/97/${address}`,
  },
};

await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
await writeFile(
  EVIDENCE_PATH,
  `${JSON.stringify(deploymentRecord, null, 2)}\n`,
  "utf8",
);
await writeFile(
  DEPLOYMENT_PATH,
  `${JSON.stringify(deploymentRecord, null, 2)}\n`,
  "utf8",
);

console.log("PHASE_4C_VAULT_BSC_TESTNET_DEPLOYMENT=COMPLETE");
console.log(`AVS_VAULT_TESTNET_ADDRESS=${address}`);
console.log(`DEPLOYMENT_TX_HASH=${receipt.hash}`);
console.log(`DEPLOYMENT_BLOCK=${receipt.blockNumber}`);
console.log(`DEPLOYMENT_TIMESTAMP=${deploymentRecord.deployedAt}`);
console.log(`RUNTIME_BYTECODE_HASH=${deploymentRecord.runtimeBytecodeHash}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log("CONFIGURATION_EXECUTED=false");
console.log("AVS_MINT_EXECUTED=false");
console.log("FUNDS_TRANSFERRED=false");
