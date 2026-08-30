import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

import { MINIMUM_BALANCE_WEI, preflight } from "./phase3b-bsc-common.js";

const EVIDENCE_DIRECTORY = ".local/phase4a-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-ledger-deployment.json`;

if (process.env.PHASE4A_DEPLOY_CONFIRM !== "BSC_TESTNET_ONLY") {
  throw new Error(
    "Deployment is disabled. Set PHASE4A_DEPLOY_CONFIRM=BSC_TESTNET_ONLY to deploy AVSLedger to BSC Testnet.",
  );
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No deployer signer is configured.");

const initialOwner = checked.deployer;
if (initialOwner.toLowerCase() !== checked.deployer.toLowerCase()) {
  throw new Error("Initial owner is not the approved Testnet wallet.");
}
if (initialOwner === ethers.ZeroAddress) {
  throw new Error("Initial owner cannot be the zero address.");
}
if (checked.balance < MINIMUM_BALANCE_WEI) {
  throw new Error("Deployer balance is below the required Testnet minimum.");
}

console.log("PHASE_4A_BSC_TESTNET_DEPLOYMENT_PREFLIGHT=PASS");
console.log("NETWORK=BSC_TESTNET");
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${checked.deployer}`);
console.log(`INITIAL_OWNER=${initialOwner}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${checked.balance}`);
console.log(`DEPLOYER_BNB_BALANCE=${ethers.formatEther(checked.balance)} BNB`);
console.log("CONSTRUCTOR_INITIAL_OWNER_EXPLICIT=true");

const ledger = await ethers.deployContract("AVSLedger", [initialOwner]);
await ledger.waitForDeployment();
const address = await ledger.getAddress();
const transaction = ledger.deploymentTransaction();
if (!transaction) throw new Error("AVSLedger has no deployment transaction.");
const receipt = await transaction.wait();
if (!receipt) throw new Error("AVSLedger deployment receipt is unavailable.");
const runtime = await ethers.provider.getCode(address);
if (runtime === "0x") throw new Error("AVSLedger has no runtime bytecode.");

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

async function requiresRevert(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    console.log(`${label}=REVERTED`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

await requiresRevert("UNAUTHORIZED_CAPITAL_WRITE", () =>
  ledger
    .connect(deployer)
    .getFunction("recordCapitalInflow")
    .staticCall(
      ethers.id("phase4a-unauthorized-capital"),
      checked.deployer,
      1n,
    ),
);
await requiresRevert("UNAUTHORIZED_SETTLEMENT_WRITE", () =>
  ledger
    .connect(deployer)
    .getFunction("recordTradingSettlement")
    .staticCall(ethers.id("phase4a-unauthorized-settlement"), 1n),
);

const evidence = {
  schemaVersion: 1,
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  deployer: checked.deployer,
  initialOwner,
  minimumBalanceWei: MINIMUM_BALANCE_WEI.toString(),
  deployerBalanceWei: checked.balance.toString(),
  compiler: {
    solidity: "0.8.28",
    optimizer: { enabled: true, runs: 200 },
  },
  ledger: {
    address,
    txHash: receipt.hash,
    block: receipt.blockNumber,
    constructorArgs: [initialOwner],
    runtimeHash: ethers.keccak256(runtime),
    gasUsed: receipt.gasUsed.toString(),
  },
  initialState: state,
  sourceVerification: {
    status: "PENDING",
    explorer: `https://testnet.bscscan.com/address/${address}#code`,
  },
};

await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
await writeFile(
  EVIDENCE_PATH,
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);

console.log("PHASE_4A_BSC_TESTNET_DEPLOYMENT=COMPLETE");
console.log(`AVS_LEDGER_TESTNET_ADDRESS=${address}`);
console.log(`DEPLOYMENT_TX_HASH=${receipt.hash}`);
console.log(`DEPLOYMENT_BLOCK=${receipt.blockNumber}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
