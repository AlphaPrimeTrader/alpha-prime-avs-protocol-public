import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { readFile } from "node:fs/promises";

type DeploymentRecord = {
  network: string;
  chainId: string;
  contract: string;
  address: string;
  deploymentTransaction: string;
  deploymentBlock: number;
  deployedAt: string;
  deployer: string;
  initialOwner: string;
  constructorArguments: string[];
  compiler: {
    version: string;
    optimizer: { enabled: boolean; runs: number };
    evmVersion: string;
  };
  runtimeBytecodeHash: string;
  initialState: {
    name: string;
    symbol: string;
    decimals: string;
    maxSupply: string;
    totalSupply: string;
    owner: string;
    vault: string;
    accountPolicy: string;
    vaultLocked: boolean;
    accountPolicyLocked: boolean;
  };
  sourceVerification: {
    status: string;
    bscScan: string;
    sourcify: string;
  };
};

const record = JSON.parse(
  await readFile("deployments/bsc-testnet/avs-token.json", "utf8"),
) as DeploymentRecord;
if (record.network !== "bscTestnet" || record.chainId !== "97") {
  throw new Error("AVSToken deployment record is not for BSC Testnet.");
}

const { ethers } = await network.create();
const chainId = (await ethers.provider.getNetwork()).chainId;
if (chainId !== 97n) {
  throw new Error(
    `Refusing verification on chain ${chainId}; BSC Testnet only.`,
  );
}

const runtime = await ethers.provider.getCode(record.address);
if (runtime === "0x") throw new Error("Deployed AVSToken has no runtime code.");
const runtimeHash = ethers.keccak256(runtime);
if (runtimeHash !== record.runtimeBytecodeHash) {
  throw new Error("Deployed AVSToken runtime bytecode hash changed.");
}

const token = await ethers.getContractAt("AVSToken", record.address);
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

if (
  state.name !== "AVS" ||
  state.symbol !== "AVS" ||
  state.decimals !== "18" ||
  state.maxSupply !== "20000000000000000000000000" ||
  state.totalSupply !== "0" ||
  state.owner.toLowerCase() !== record.initialOwner.toLowerCase() ||
  state.vault !== zero ||
  state.accountPolicy !== zero ||
  state.vaultLocked ||
  state.accountPolicyLocked
) {
  throw new Error("Direct AVSToken Testnet state verification failed.");
}

console.log("PHASE_4B_BSC_TESTNET_STATE=PASS");
console.log(`NETWORK=BSC_TESTNET`);
console.log(`CHAIN_ID=${chainId}`);
console.log(`AVS_TOKEN_TESTNET_ADDRESS=${record.address}`);
console.log(`DEPLOYMENT_TX_HASH=${record.deploymentTransaction}`);
console.log(`DEPLOYMENT_BLOCK=${record.deploymentBlock}`);
console.log(`DEPLOYMENT_TIMESTAMP=${record.deployedAt}`);
console.log(`DEPLOYER=${record.deployer}`);
console.log(`INITIAL_OWNER=${record.initialOwner}`);
console.log(`RUNTIME_BYTECODE_HASH=${runtimeHash}`);
console.log(`BSC_SCAN=${record.sourceVerification.bscScan}`);
console.log(`SOURCIFY=${record.sourceVerification.sourcify}`);
console.log("VAULT=0x0000000000000000000000000000000000000000");
console.log("ACCOUNT_POLICY=0x0000000000000000000000000000000000000000");
console.log("VAULT_LOCKED=false");
console.log("ACCOUNT_POLICY_LOCKED=false");
console.log("TOTAL_SUPPLY=0");
console.log("OWNERSHIP_RENOUNCED=false");
console.log("LEDGER_BOUND=false");
