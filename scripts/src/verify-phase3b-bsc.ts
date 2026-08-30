import { readFile } from "node:fs/promises";

import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";

import { ENTRYPOINT_V08_ADDRESS } from "../../test/fixtures/entrypoint-v08-runtime";
import { preflight, readEvidence } from "./phase3b-bsc-common.js";

const { ethers } = await network.create();
const checked = await preflight(ethers);
const evidence = await readEvidence();
if (evidence.deployer.toLowerCase() !== checked.deployer.toLowerCase()) {
  throw new Error("Evidence deployer does not match the approved connected deployer.");
}

const record = (name: string) => {
  const found = evidence.deployments.find((item) => item.name === name);
  if (!found) throw new Error(`Evidence lacks ${name}.`);
  return found;
};
const factoryRecord = record("AVSAccountRecoveryKernelFactory");
const authorityRecord = record("AVSAccountRecoveryAuthority");
const controllerRecord = record("AVSEvolutionController");
const boundedRecord = record("BoundedLogicMock");
const receiverRecord = record("TestReceiver");

for (const deployment of evidence.deployments) {
  const code = await ethers.provider.getCode(deployment.address);
  if (code === "0x") throw new Error(`${deployment.name} has no on-chain runtime code.`);
  if (ethers.keccak256(code) !== deployment.runtimeHash) {
    throw new Error(`${deployment.name} runtime hash differs from deployment evidence.`);
  }
}

const factory = await ethers.getContractAt("AVSAccountRecoveryKernelFactory", factoryRecord.address);
const authority = await factory.authority();
const controller = await factory.evolutionController();
if (authority.toLowerCase() !== authorityRecord.address.toLowerCase()) throw new Error("Factory authority mismatch.");
if (controller.toLowerCase() !== controllerRecord.address.toLowerCase()) throw new Error("Factory controller mismatch.");
if ((await factory.entryPoint()).toLowerCase() !== ENTRYPOINT_V08_ADDRESS.toLowerCase()) {
  throw new Error("Factory EntryPoint mismatch.");
}
const controllerView = await ethers.getContractAt("AVSEvolutionController", controller);
const authorityView = await ethers.getContractAt("AVSAccountRecoveryAuthority", authority);
if ((await controllerView.authority()).toLowerCase() !== authority.toLowerCase()) {
  throw new Error("Controller authority mismatch.");
}

type ImmutableReference = { start: number; length: number };
type HardhatArtifact = {
  deployedBytecode: string;
  immutableReferences: Record<string, ImmutableReference[]>;
};

async function localArtifact(path: string): Promise<HardhatArtifact> {
  return JSON.parse(await readFile(path, "utf8")) as HardhatArtifact;
}

function immutableSlots(artifact: HardhatArtifact): ImmutableReference[] {
  return Object.values(artifact.immutableReferences).flat();
}

function runtimeWithoutMetadata(runtime: string, label: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(runtime) || (runtime.length - 2) % 2 !== 0) {
    throw new Error(`${label} runtime is not valid bytecode.`);
  }
  const byteLength = (runtime.length - 2) / 2;
  const metadataLength = Number.parseInt(runtime.slice(-4), 16) + 2;
  if (metadataLength <= 2 || metadataLength >= byteLength) {
    throw new Error(`${label} Solidity metadata length is invalid.`);
  }
  return runtime.slice(0, 2 + (byteLength - metadataLength) * 2);
}

function normalizedRuntime(
  runtime: string,
  artifact: HardhatArtifact,
  label: string,
): string {
  if (runtime.length !== artifact.deployedBytecode.length) {
    throw new Error(`${label} runtime length differs from the local artifact.`);
  }
  let normalized = runtime;
  for (const { start, length } of immutableSlots(artifact)) {
    const offset = 2 + start * 2;
    const end = offset + length * 2;
    normalized =
      normalized.slice(0, offset) +
      artifact.deployedBytecode.slice(offset, end) +
      normalized.slice(end);
  }
  if (
    runtimeWithoutMetadata(normalized, label) !==
    runtimeWithoutMetadata(artifact.deployedBytecode, `${label} artifact`)
  ) {
    throw new Error(`${label} non-immutable runtime bytes differ from the local artifact.`);
  }
  return runtime;
}

function immutableWords(runtime: string, artifact: HardhatArtifact): string[] {
  return immutableSlots(artifact).map(({ start, length }) => {
    if (length !== 32) throw new Error("Unexpected non-word Solidity immutable.");
    return `0x${runtime.slice(2 + start * 2, 2 + (start + length) * 2)}`;
  });
}

function decodedImmutableAddress(word: string): string {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(word)) {
    throw new Error("Immutable address word is not ABI-encoded as an address.");
  }
  return ethers.getAddress(`0x${word.slice(-40)}`);
}

const artifacts = {
  bounded: await localArtifact(
    ".hardhat/artifacts/contracts/test/BoundedLogicMock.sol/BoundedLogicMock.json",
  ),
  receiver: await localArtifact(
    ".hardhat/artifacts/contracts/test/TestReceiver.sol/TestReceiver.json",
  ),
  authority: await localArtifact(
    ".hardhat/artifacts/contracts/accounts/AVSAccountRecoveryAuthority.sol/AVSAccountRecoveryAuthority.json",
  ),
  controller: await localArtifact(
    ".hardhat/artifacts/contracts/accounts/AVSEvolutionController.sol/AVSEvolutionController.json",
  ),
  factory: await localArtifact(
    ".hardhat/artifacts/contracts/accounts/AVSAccountRecoveryKernelFactory.sol/AVSAccountRecoveryKernelFactory.json",
  ),
};
const runtimes = {
  bounded: normalizedRuntime(
    await ethers.provider.getCode(boundedRecord.address),
    artifacts.bounded,
    "BoundedLogicMock",
  ),
  receiver: normalizedRuntime(
    await ethers.provider.getCode(receiverRecord.address),
    artifacts.receiver,
    "TestReceiver",
  ),
  authority: normalizedRuntime(
    await ethers.provider.getCode(authority),
    artifacts.authority,
    "AVSAccountRecoveryAuthority",
  ),
  controller: normalizedRuntime(
    await ethers.provider.getCode(controller),
    artifacts.controller,
    "AVSEvolutionController",
  ),
  factory: normalizedRuntime(
    await ethers.provider.getCode(factoryRecord.address),
    artifacts.factory,
    "AVSAccountRecoveryKernelFactory",
  ),
};

const boundedWords = immutableWords(runtimes.bounded, artifacts.bounded);
if (boundedWords.length !== 1 || BigInt(boundedWords[0]!) !== 1n) {
  throw new Error("BoundedLogicMock immutable constructor version is not 1.");
}
const boundedView = await ethers.getContractAt("BoundedLogicMock", boundedRecord.address);
if ((await boundedView.avsAccountStandardVersion()) !== 1n) {
  throw new Error("BoundedLogicMock does not report constructor version 1.");
}
const controllerImmutableAuthorities = immutableWords(
  runtimes.controller,
  artifacts.controller,
).map(decodedImmutableAddress);
if (
  controllerImmutableAuthorities.length === 0 ||
  controllerImmutableAuthorities.some(
    (immutableAuthority) => immutableAuthority.toLowerCase() !== authority.toLowerCase(),
  )
) {
  throw new Error("Controller immutable Authority slots do not match its Authority binding.");
}
const factoryImmutableAddresses = immutableWords(runtimes.factory, artifacts.factory)
  .map(decodedImmutableAddress)
  .map((value) => value.toLowerCase())
  .sort();
const expectedFactoryImmutables = [authority, controller, ENTRYPOINT_V08_ADDRESS]
  .map((value) => value.toLowerCase())
  .sort();
if (JSON.stringify(factoryImmutableAddresses) !== JSON.stringify(expectedFactoryImmutables)) {
  throw new Error("Factory immutable slots do not match Authority, Controller, and EntryPoint.");
}

const recoveryRequest = authorityView.interface.getFunction("requestRecovery");
if (!recoveryRequest || recoveryRequest.inputs.length !== 3) {
  throw new Error("Authority requestRecovery ABI is unexpected.");
}
const recoveryRequestFields = recoveryRequest.inputs[1]?.components?.map(
  (component) => component.name,
);
if (
  JSON.stringify(recoveryRequestFields) !==
  JSON.stringify([
    "newTransactionKey",
    "newRecoveryKey",
    "recoveryNonce",
    "requestId",
  ])
) {
  throw new Error("RecoveryRequest is not the atomic transaction/recovery root rotation shape.");
}
if (!authorityView.interface.getFunction("recoveryKeyVersion")) {
  throw new Error("Authority does not expose recoveryKeyVersion.");
}
for (const obsoleteName of [
  "pendingRecovery",
  "cancelRecovery",
  "finalizeRecovery",
  "RECOVERY_DELAY",
] as const) {
  if (authorityView.interface.getFunction(obsoleteName)) {
    throw new Error(`Obsolete Authority surface remains: ${obsoleteName}.`);
  }
}
const recoveryDomain = "AVS_ACCOUNT_RECOVERY_PHASE_3B_ATOMIC_ROOT_ROTATION_V1";
const recoveryAction = "AVS_RECOVERY_ACTION_ROTATE_TRANSACTION_AND_RECOVERY_KEYS";
const recoveryType =
  "AVSAccountRecovery(bytes32 domain,address account,address authority,uint256 chainId,bytes32 currentTransactionKeyHash,uint64 currentTransactionKeyVersion,bytes32 currentRecoveryKeyHash,uint64 currentRecoveryKeyVersion,bytes32 newTransactionKeyHash,bytes32 newRecoveryKeyHash,bytes32 actionType,uint256 recoveryNonce,bytes32 requestId)";
if (
  (await authorityView.RECOVERY_DOMAIN()) !== ethers.id(recoveryDomain) ||
  (await authorityView.RECOVERY_ACTION_ROTATE_TRANSACTION_AND_RECOVERY_KEYS()) !==
    ethers.id(recoveryAction) ||
  (await authorityView.RECOVERY_TYPEHASH()) !== ethers.id(recoveryType)
) {
  throw new Error("Authority recovery domain, action, or typehash is not atomic root rotation.");
}

const pendingUpgrade = controllerView.interface.getFunction("pendingUpgrade");
if (
  !pendingUpgrade ||
  pendingUpgrade.outputs[0]?.components?.at(-1)?.name !== "transactionKeyVersion" ||
  !controllerView.interface.getError("StaleTransactionKeyVersion")
) {
  throw new Error("EvolutionController stale Transaction-key upgrade guard ABI is missing.");
}

for (const contractName of [
  "AVSAccountRecoveryKernelFactory",
  "AVSAccountRecoveryAuthority",
  "AVSEvolutionController",
  "AVSAccountRecoverySecurityKernel",
] as const) {
  const artifact = await ethers.getContractFactory(contractName);
  if (
    artifact.interface.fragments.some(
      (fragment) =>
        fragment.type === "function" &&
        "name" in fragment &&
        typeof fragment.name === "string" &&
        /^(owner|admin|setOwner|transferOwnership)$/i.test(fragment.name),
    )
  ) {
    throw new Error(`${contractName} exposes an owner/admin surface.`);
  }
}

async function requiresRevert(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}
await requiresRevert("Factory pending-configuration consumption", () =>
  factory.consumePendingConfiguration.staticCall(),
);
await requiresRevert("Direct controller initialization", () =>
  controllerView.initializeAccount.staticCall(
    factoryRecord.address,
    boundedRecord.address,
    ethers.keccak256(runtimes.bounded),
    1,
  ),
);
await requiresRevert("Direct Authority atomic recovery", () =>
  authorityView.requestRecovery.staticCall(
    factoryRecord.address,
    {
      newTransactionKey: { qx: ethers.ZeroHash, qy: ethers.ZeroHash },
      newRecoveryKey: { qx: ethers.ZeroHash, qy: ethers.ZeroHash },
      recoveryNonce: 0,
      requestId: ethers.ZeroHash,
    },
    "0x",
  ),
);

console.log("PHASE_3B_BSC_POST_DEPLOYMENT_VERIFICATION=PASS");
console.log("IMMUTABLE_FACTORY_AUTHORITY_CONTROLLER_ENTRYPOINT=PASS");
console.log("OWNER_ADMIN_SURFACES=NONE");
console.log("ATOMIC_ROOT_ROTATION_ABI=PASS");
console.log("STATIC_NEGATIVE_PRIVILEGE_CHECKS=PASS");