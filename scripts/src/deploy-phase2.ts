import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";

import {
  ENTRYPOINT_V08_ADDRESS,
  ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH,
  getEntryPointV08RuntimeHash,
  getEntryPointV08RuntimeBytecode,
} from "../../test/fixtures/entrypoint-v08-runtime";

const { ethers } = await network.create();
const provider = ethers.provider;
const chainId = (await provider.getNetwork()).chainId;
const isLocal = chainId === 31_337n;
const isBscTestnet = chainId === 97n;

if (!isLocal && !isBscTestnet) {
  throw new Error(`Refusing deployment on unsupported chain ${chainId}. BSC Testnet only.`);
}

if (isLocal) {
  await provider.send("hardhat_setCode", [
    ENTRYPOINT_V08_ADDRESS,
    getEntryPointV08RuntimeBytecode(chainId),
  ]);
}

const entryPointCode = await provider.getCode(ENTRYPOINT_V08_ADDRESS);
if (entryPointCode === "0x") {
  throw new Error("Canonical EntryPoint v0.8 runtime is missing.");
}
const entryPointHash = ethers.keccak256(entryPointCode);
const expectedEntryPointHash = isBscTestnet
  ? ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH
  : getEntryPointV08RuntimeHash(chainId);
if (entryPointHash !== expectedEntryPointHash) {
  throw new Error(
    `Canonical EntryPoint runtime mismatch on chain ${chainId}: ${entryPointHash}`,
  );
}

const [deployer] = await ethers.getSigners();
const deployerAddress = await deployer.getAddress();
const expectedDeployer = "0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9";
if (isBscTestnet && deployerAddress.toLowerCase() !== expectedDeployer.toLowerCase()) {
  throw new Error("The BSC deployer does not match the approved temporary deployer.");
}

const balanceBefore = await provider.getBalance(deployerAddress);

async function deployAndReport(label: string, deploy: () => Promise<any>) {
  const contract = await deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deploymentTransaction = contract.deploymentTransaction();
  if (!deploymentTransaction) throw new Error(`${label} deployment transaction is unavailable.`);
  const receipt = await deploymentTransaction.wait();
  if (!receipt) throw new Error(`${label} deployment receipt is unavailable.`);
  const runtime = await provider.getCode(address);
  if (runtime === "0x") throw new Error(`${label} has no deployed runtime bytecode.`);
  return {
    address,
    txHash: receipt.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    runtimeHash: ethers.keccak256(runtime),
  };
}

const implementation = await deployAndReport("AVSAccount implementation", () =>
  ethers.deployContract("AVSAccount"),
);

const factory = await deployAndReport("AVSAccountFactory", () =>
  ethers.deployContract("AVSAccountFactory", [implementation.address]),
);

const receiver = await deployAndReport("TestReceiver", () =>
  ethers.deployContract("TestReceiver"),
);

const factoryView = await ethers.getContractAt("AVSAccountFactory", factory.address);
const implementationReference = await factoryView.accountImplementation();
if (implementationReference.toLowerCase() !== implementation.address.toLowerCase()) {
  throw new Error("Factory implementation reference does not match the new implementation.");
}

const balanceAfter = await provider.getBalance(deployerAddress);

console.log("Phase 2 BSC Testnet contracts deployed.");
console.log(`NETWORK_CHAIN_ID=${chainId}`);
console.log(`TEMPORARY_DEPLOYER=${deployerAddress}`);
console.log(`BALANCE_BEFORE=${balanceBefore.toString()}`);
console.log(`BALANCE_AFTER=${balanceAfter.toString()}`);
console.log(`ENTRYPOINT_V08_ADDRESS=${ENTRYPOINT_V08_ADDRESS}`);
console.log(`ENTRYPOINT_V08_RUNTIME_HASH=${entryPointHash}`);
console.log(`AVS_ACCOUNT_IMPLEMENTATION=${implementation.address}`);
console.log(`AVS_ACCOUNT_IMPLEMENTATION_TX=${implementation.txHash}`);
console.log(`AVS_ACCOUNT_IMPLEMENTATION_BLOCK=${implementation.block}`);
console.log(`AVS_ACCOUNT_IMPLEMENTATION_GAS=${implementation.gasUsed.toString()}`);
console.log(`AVS_ACCOUNT_IMPLEMENTATION_RUNTIME_HASH=${implementation.runtimeHash}`);
console.log(`VITE_FACTORY_ADDRESS=${factory.address}`);
console.log(`FACTORY_DEPLOYMENT_TX=${factory.txHash}`);
console.log(`FACTORY_DEPLOYMENT_BLOCK=${factory.block}`);
console.log(`FACTORY_DEPLOYMENT_GAS=${factory.gasUsed.toString()}`);
console.log(`FACTORY_RUNTIME_HASH=${factory.runtimeHash}`);
console.log(`FACTORY_IMPLEMENTATION_REFERENCE=${implementationReference}`);
console.log(`VITE_RECEIVER_ADDRESS=${receiver.address}`);
console.log(`RECEIVER_DEPLOYMENT_TX=${receiver.txHash}`);
console.log(`RECEIVER_DEPLOYMENT_BLOCK=${receiver.block}`);
console.log(`RECEIVER_DEPLOYMENT_GAS=${receiver.gasUsed.toString()}`);
console.log(`RECEIVER_RUNTIME_HASH=${receiver.runtimeHash}`);