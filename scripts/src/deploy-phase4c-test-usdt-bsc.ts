import "@nomicfoundation/hardhat-ethers";
import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";

import { MINIMUM_BALANCE_WEI, preflight } from "./phase3b-bsc-common.js";

const EVIDENCE_DIRECTORY = ".local/phase4c-evidence";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/bsc-testnet-test-usdt-deployment.json`;
const DEPLOYMENT_PATH = "deployments/bsc-testnet/test-usdt.json";

if (
  process.env.PHASE4C_TEST_USDT_DEPLOY_CONFIRM !== "BSC_TESTNET_TEST_USDT_ONLY"
) {
  throw new Error(
    "Deployment is disabled. Set PHASE4C_TEST_USDT_DEPLOY_CONFIRM=BSC_TESTNET_TEST_USDT_ONLY to deploy TestUSDT to BSC Testnet.",
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

console.log("PHASE_4C_TEST_USDT_BSC_TESTNET_DEPLOYMENT_PREFLIGHT=PASS");
console.log("NETWORK=BSC_TESTNET");
console.log(`CHAIN_ID=${checked.chainId}`);
console.log(`DEPLOYER=${checked.deployer}`);
console.log(`INITIAL_OWNER=${initialOwner}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${checked.balance}`);
console.log(`DEPLOYER_BNB_BALANCE=${ethers.formatEther(checked.balance)} BNB`);
console.log("TESTNET_ONLY_ASSET=true");
console.log("DEPLOYING_EXACTLY_ONE_TEST_USDT=true");
console.log("MINT_EXECUTED=false");

const deployment = await ethers.deployContract("TestUSDT", [initialOwner]);
await deployment.waitForDeployment();
const address = await deployment.getAddress();
const transaction = deployment.deploymentTransaction();
if (!transaction) throw new Error("TestUSDT has no deployment transaction.");
const receipt = await transaction.wait();
if (!receipt) throw new Error("TestUSDT deployment receipt is unavailable.");
const runtime = await ethers.provider.getCode(address);
if (runtime === "0x") throw new Error("TestUSDT has no runtime bytecode.");
const block = await ethers.provider.getBlock(receipt.blockNumber);
if (!block) throw new Error("TestUSDT deployment block is unavailable.");

const token = await ethers.getContractAt("TestUSDT", address);
const state = {
  name: await token.name(),
  symbol: await token.symbol(),
  decimals: (await token.decimals()).toString(),
  totalSupply: (await token.totalSupply()).toString(),
  owner: await token.owner(),
  deployerBalance: (await token.balanceOf(checked.deployer)).toString(),
};

if (
  state.name !== "Test USDT" ||
  state.symbol !== "USDT" ||
  state.decimals !== "18"
) {
  throw new Error("Deployed TestUSDT metadata is incorrect.");
}
if (state.totalSupply !== "0" || state.deployerBalance !== "0") {
  throw new Error("TestUSDT was minted during deployment.");
}
if (state.owner.toLowerCase() !== initialOwner.toLowerCase()) {
  throw new Error("Deployed TestUSDT owner does not equal initialOwner.");
}

const deploymentRecord = {
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  contract: "TestUSDT",
  classification: "TESTNET TEST ASSET — NOT PRODUCTION USDT",
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

console.log("PHASE_4C_TEST_USDT_BSC_TESTNET_DEPLOYMENT=COMPLETE");
console.log(`TEST_USDT_TESTNET_ADDRESS=${address}`);
console.log(`DEPLOYMENT_TX_HASH=${receipt.hash}`);
console.log(`DEPLOYMENT_BLOCK=${receipt.blockNumber}`);
console.log(`DEPLOYMENT_TIMESTAMP=${deploymentRecord.deployedAt}`);
console.log(`RUNTIME_BYTECODE_HASH=${deploymentRecord.runtimeBytecodeHash}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
console.log(`DEPLOYMENT_RECORD=${DEPLOYMENT_PATH}`);
console.log("TESTNET_ONLY_ASSET=true");
console.log("MINT_EXECUTED=false");
