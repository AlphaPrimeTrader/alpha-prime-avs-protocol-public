import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

import { MINIMUM_BALANCE_WEI, preflight } from "./phase3b-bsc-common.js";

const EVIDENCE_DIRECTORY = ".local/phase4b-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-token-deployment.json`;
const DEPLOYMENT_PATH = "deployments/bsc-testnet/avs-token.json";

if (process.env.PHASE4B_DEPLOY_CONFIRM !== "BSC_TESTNET_ONLY") {
  throw new Error(
    "Deployment is disabled. Set PHASE4B_DEPLOY_CONFIRM=BSC_TESTNET_ONLY to deploy AVSToken to BSC Testnet.",
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

console.log("PHASE_4B_BSC_TESTNET_DEPLOYMENT_PREFLIGHT=PASS");
console.log("NETWORK=BSC_TESTNET");
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${checked.deployer}`);
console.log(`INITIAL_OWNER=${initialOwner}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${checked.balance}`);
console.log(`DEPLOYER_BNB_BALANCE=${ethers.formatEther(checked.balance)} BNB`);
console.log("CONSTRUCTOR_INITIAL_OWNER_EXPLICIT=true");
console.log("DEPLOYING_EXACTLY_ONE_AVS_TOKEN=true");

const deployment = await ethers.deployContract("AVSToken", [initialOwner]);
await deployment.waitForDeployment();
const address = await deployment.getAddress();
const transaction = deployment.deploymentTransaction();
if (!transaction) throw new Error("AVSToken has no deployment transaction.");
const receipt = await transaction.wait();
if (!receipt) throw new Error("AVSToken deployment receipt is unavailable.");
const runtime = await ethers.provider.getCode(address);
if (runtime === "0x") throw new Error("AVSToken has no runtime bytecode.");
const block = await ethers.provider.getBlock(receipt.blockNumber);
if (!block) throw new Error("AVSToken deployment block is unavailable.");

const token = await ethers.getContractAt("AVSToken", address);
const zero = ethers.ZeroAddress;
const state = {
  name: await token.name(),
  symbol: await token.symbol(),
  decimals: (await token.decimals()).toString(),
  maxSupply: (await token.MAX_SUPPLY()).toString(),
  totalSupply: (await token.totalSupply()).toString(),
  owner: await token.owner(),
  vault: await token.vault(),
  accountPolicy: await token.accountPolicy(),
  vaultLocked: await token.vaultLocked(),
  accountPolicyLocked: await token.accountPolicyLocked(),
};

if (state.name !== "AVS" || state.symbol !== "AVS") {
  throw new Error("Deployed AVSToken metadata is incorrect.");
}
if (state.decimals !== "18") {
  throw new Error("Deployed AVSToken decimals are not 18.");
}
if (state.maxSupply !== "20000000000000000000000000") {
  throw new Error("Deployed AVSToken MAX_SUPPLY is incorrect.");
}
if (state.totalSupply !== "0") {
  throw new Error("AVSToken was minted during deployment.");
}
if (state.owner.toLowerCase() !== initialOwner.toLowerCase()) {
  throw new Error("Deployed owner does not equal explicit initialOwner.");
}
if (
  state.vault !== zero ||
  state.accountPolicy !== zero ||
  state.vaultLocked ||
  state.accountPolicyLocked
) {
  throw new Error("AVSToken was configured or locked during deployment.");
}

const deploymentRecord = {
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  contract: "AVSToken",
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

console.log("PHASE_4B_BSC_TESTNET_DEPLOYMENT=COMPLETE");
console.log(`AVS_TOKEN_TESTNET_ADDRESS=${address}`);
console.log(`DEPLOYMENT_TX_HASH=${receipt.hash}`);
console.log(`DEPLOYMENT_BLOCK=${receipt.blockNumber}`);
console.log(`DEPLOYMENT_TIMESTAMP=${deploymentRecord.deployedAt}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log("TOKEN_LEFT_UNCONFIGURED=true");
console.log("TOKEN_TOTAL_SUPPLY=0");
console.log("TOKEN_OWNERSHIP_RENOUNCED=false");
console.log("LEDGER_BOUND=false");
