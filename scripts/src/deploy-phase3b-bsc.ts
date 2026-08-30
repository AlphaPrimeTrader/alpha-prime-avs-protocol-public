import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";

import {
  MINIMUM_BALANCE_WEI,
  type DeploymentRecord,
  preflight,
  writeEvidence,
} from "./phase3b-bsc-common.js";

if (process.env.PHASE3B_DEPLOY_CONFIRM !== "BSC_TESTNET_ONLY") {
  throw new Error(
    "Deployment is disabled. Set PHASE3B_DEPLOY_CONFIRM=BSC_TESTNET_ONLY to deploy to BSC Testnet.",
  );
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No deployer signer is configured.");

async function deployAndRecord(
  name: string,
  contractName: string,
  constructorArgs: readonly (string | number)[],
): Promise<DeploymentRecord> {
  const contract = await ethers.deployContract(contractName, [...constructorArgs]);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error(`${name} has no deployment transaction.`);
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${name} deployment receipt is unavailable.`);
  const runtime = await ethers.provider.getCode(address);
  if (runtime === "0x") throw new Error(`${name} has no runtime bytecode.`);
  return {
    name,
    address,
    txHash: receipt.hash,
    block: receipt.blockNumber,
    deployer: checked.deployer,
    constructorArgs,
    runtimeHash: ethers.keccak256(runtime),
    gasUsed: receipt.gasUsed.toString(),
  };
}

// This is the approved bounded implementation used by the Phase 3B integration tests.
const boundedLogic = await deployAndRecord("BoundedLogicMock", "BoundedLogicMock", [1]);
const receiver = await deployAndRecord("TestReceiver", "TestReceiver", []);
const factory = await deployAndRecord(
  "AVSAccountRecoveryKernelFactory",
  "AVSAccountRecoveryKernelFactory",
  [],
);

const factoryView = await ethers.getContractAt(
  "AVSAccountRecoveryKernelFactory",
  factory.address,
);
const authorityAddress = await factoryView.authority();
const controllerAddress = await factoryView.evolutionController();
const entryPointAddress = await factoryView.entryPoint();
for (const [name, address] of [
  ["AVSAccountRecoveryAuthority", authorityAddress],
  ["AVSEvolutionController", controllerAddress],
] as const) {
  const runtime = await ethers.provider.getCode(address);
  if (runtime === "0x") throw new Error(`${name} was not created by the factory.`);
}
if (entryPointAddress.toLowerCase() !== "0x4337084d9e255ff0702461cf8895ce9e3b5ff108") {
  throw new Error("Factory EntryPoint binding is not canonical.");
}

const childRecords: DeploymentRecord[] = await Promise.all(
  [
    ["AVSAccountRecoveryAuthority", authorityAddress],
    ["AVSEvolutionController", controllerAddress],
  ].map(async ([name, address]) => {
    const runtime = await ethers.provider.getCode(address);
    return {
      name,
      address,
      txHash: factory.txHash,
      block: factory.block,
      deployer: checked.deployer,
      constructorArgs: name === "AVSEvolutionController" ? [authorityAddress] : [],
      runtimeHash: ethers.keccak256(runtime),
      gasUsed: null,
      outerDeploymentGasUsed: factory.gasUsed ?? undefined,
    };
  }),
);

await writeEvidence({
  schemaVersion: 1,
  network: "bscTestnet",
  chainId: "97",
  entryPoint: {
    address: entryPointAddress,
    runtimeHash: checked.entryPointRuntimeHash,
  },
  deployer: checked.deployer,
  minimumBalanceWei: MINIMUM_BALANCE_WEI.toString(),
  compiler: { solidity: "0.8.28", optimizer: { enabled: true, runs: 200 } },
  deployments: [boundedLogic, receiver, factory, ...childRecords],
});

console.log("PHASE_3B_BSC_TESTNET_DEPLOYMENT=COMPLETE");
console.log("EVIDENCE_PATH=.local/phase3b-evidence/bsc-testnet-deployment.json");