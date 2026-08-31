import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

import { MINIMUM_BALANCE_WEI, preflight } from "./phase3b-bsc-common.js";

const EVIDENCE_DIRECTORY = ".local/phase4c-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-ledger-deployment.json`;
const DEPLOYMENT_PATH = "deployments/bsc-testnet/avs-ledger.json";
const SUPERSEDED_LEDGER = "0x9eAACE24c68C29D7Bd6cef6A660270bB3566Fa04";

if (process.env.PHASE4C_LEDGER_DEPLOY_CONFIRM !== "BSC_TESTNET_LEDGER_ONLY") {
  throw new Error(
    "Deployment is disabled. Set PHASE4C_LEDGER_DEPLOY_CONFIRM=BSC_TESTNET_LEDGER_ONLY to deploy the revised AVSLedger to BSC Testnet.",
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

const supersededRuntime = await ethers.provider.getCode(SUPERSEDED_LEDGER);
if (supersededRuntime === "0x") {
  throw new Error("The superseded Phase 4A Ledger has no runtime bytecode.");
}

console.log("PHASE_4C_LEDGER_BSC_TESTNET_DEPLOYMENT_PREFLIGHT=PASS");
console.log("NETWORK=BSC_TESTNET");
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${checked.deployer}`);
console.log(`INITIAL_OWNER=${initialOwner}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${checked.balance}`);
console.log(`DEPLOYER_BNB_BALANCE=${ethers.formatEther(checked.balance)} BNB`);
console.log(`SUPERSEDED_LEDGER=${SUPERSEDED_LEDGER}`);
console.log("DEPLOYING_REVISED_LEDGER_ONLY=true");

const deployment = await ethers.deployContract("AVSLedger", [initialOwner]);
await deployment.waitForDeployment();
const address = await deployment.getAddress();
const transaction = deployment.deploymentTransaction();
if (!transaction) throw new Error("AVSLedger has no deployment transaction.");
const receipt = await transaction.wait();
if (!receipt) throw new Error("AVSLedger deployment receipt is unavailable.");
const runtime = await ethers.provider.getCode(address);
if (runtime === "0x") throw new Error("AVSLedger has no runtime bytecode.");
const block = await ethers.provider.getBlock(receipt.blockNumber);
if (!block) throw new Error("AVSLedger deployment block is unavailable.");

const ledger = await ethers.getContractAt("AVSLedger", address);
const zero = ethers.ZeroAddress;
const state = {
  owner: await ledger.owner(),
  avsToken: await ledger.avsToken(),
  vault: await ledger.vault(),
  tradeSettlement: await ledger.tradeSettlement(),
  totalNetAssets: (await ledger.totalNetAssets()).toString(),
  totalGrossProfit: (await ledger.totalGrossProfit()).toString(),
  totalLoss: (await ledger.totalLoss()).toString(),
  totalBuybackAllocated: (await ledger.totalBuybackAllocated()).toString(),
  buybackReserve: (await ledger.buybackReserve()).toString(),
  settlementCount: (await ledger.settlementCount()).toString(),
  currentAVSValue: (await ledger.currentAVSValue()).toString(),
};

if (state.owner.toLowerCase() !== initialOwner.toLowerCase()) {
  throw new Error("Deployed owner does not equal explicit initialOwner.");
}
for (const [name, value] of [
  ["avsToken", state.avsToken],
  ["vault", state.vault],
  ["tradeSettlement", state.tradeSettlement],
] as const) {
  if (value !== zero) throw new Error(`${name} is configured unexpectedly.`);
}
for (const [name, value] of [
  ["totalNetAssets", state.totalNetAssets],
  ["totalGrossProfit", state.totalGrossProfit],
  ["totalLoss", state.totalLoss],
  ["totalBuybackAllocated", state.totalBuybackAllocated],
  ["buybackReserve", state.buybackReserve],
  ["settlementCount", state.settlementCount],
] as const) {
  if (value !== "0") throw new Error(`${name} is nonzero unexpectedly.`);
}
if (state.currentAVSValue !== "1000000000000000000") {
  throw new Error("Unconfigured zero-supply AVS value is not 1e18.");
}

async function requireUnauthorizedRevert(
  label: string,
  action: () => Promise<unknown>,
) {
  try {
    await action();
  } catch {
    console.log(`${label}=REVERTED`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

await requireUnauthorizedRevert("UNAUTHORIZED_CAPITAL_WRITE", () =>
  ledger
    .connect(deployer)
    .getFunction("recordCapitalInflow")
    .staticCall(ethers.id("phase4c-unauthorized-capital"), initialOwner, 1n),
);
await requireUnauthorizedRevert("UNAUTHORIZED_PROTOCOL_REVENUE_WRITE", () =>
  ledger
    .connect(deployer)
    .getFunction("recordProtocolRevenue")
    .staticCall(ethers.id("phase4c-unauthorized-revenue"), 1n),
);
await requireUnauthorizedRevert("UNAUTHORIZED_SETTLEMENT_WRITE", () =>
  ledger
    .connect(deployer)
    .getFunction("recordTradingSettlement")
    .staticCall(ethers.id("phase4c-unauthorized-settlement"), 1n),
);

const deploymentRecord = {
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  contract: "AVSLedger",
  address,
  deploymentTransaction: receipt.hash,
  deploymentBlock: receipt.blockNumber,
  deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  deployer: checked.deployer,
  initialOwner,
  constructorArguments: [initialOwner],
  compiler: {
    version: "0.8.28+commit.7893614a",
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
  },
  runtimeBytecodeHash: ethers.keccak256(runtime),
  gasUsed: receipt.gasUsed.toString(),
  supersedes: {
    address: SUPERSEDED_LEDGER,
    reason: "Protocol revenue accounting path added before Vault integration.",
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

console.log("PHASE_4C_LEDGER_BSC_TESTNET_DEPLOYMENT=COMPLETE");
console.log(`AVS_LEDGER_TESTNET_ADDRESS=${address}`);
console.log(`DEPLOYMENT_TX_HASH=${receipt.hash}`);
console.log(`DEPLOYMENT_BLOCK=${receipt.blockNumber}`);
console.log(`DEPLOYMENT_TIMESTAMP=${deploymentRecord.deployedAt}`);
console.log(`RUNTIME_BYTECODE_HASH=${deploymentRecord.runtimeBytecodeHash}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log("LEDGER_LEFT_UNCONFIGURED=true");
console.log("OWNERSHIP_RENOUNCED=false");
console.log("MINT_EXECUTED=false");
console.log("FUNDS_TRANSFERRED=false");
