import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";

import {
  ENTRYPOINT_V08_ADDRESS,
  ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH,
} from "../../test/fixtures/entrypoint-v08-runtime";

const IMPLEMENTATION_ADDRESS = "0x86499A2a5390bbb40001c021aF6976F11144F9BC";
const FACTORY_ADDRESS = "0x4EA3e3BEC6DC92e5fFB3275DF377e0792EeD7AdD";
const RECEIVER_ADDRESS = "0x3d0d55295e81aA282688031f604A1B37E70009Ef";
const APPROVED_DEPLOYER = "0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9";
const TEST_QX =
  "0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296";
const TEST_QY =
  "0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";

const { ethers } = await network.create();
const provider = ethers.provider;
const [deployer] = await ethers.getSigners();
const deployerAddress = await deployer.getAddress();
const chainId = (await provider.getNetwork()).chainId;

if (chainId !== 97n) throw new Error(`Refusing verification on chain ${chainId}.`);
if (deployerAddress.toLowerCase() !== APPROVED_DEPLOYER.toLowerCase()) {
  throw new Error("Connected signer is not the approved temporary deployer.");
}

const entryPointCode = await provider.getCode(ENTRYPOINT_V08_ADDRESS);
if (ethers.keccak256(entryPointCode) !== ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH) {
  throw new Error("Canonical EntryPoint runtime verification failed.");
}

for (const [label, address] of [
  ["AVSAccount implementation", IMPLEMENTATION_ADDRESS],
  ["AVSAccountFactory", FACTORY_ADDRESS],
  ["TestReceiver", RECEIVER_ADDRESS],
] as const) {
  if ((await provider.getCode(address)) === "0x") {
    throw new Error(`${label} has no on-chain runtime code.`);
  }
}

const factory = await ethers.getContractAt("AVSAccountFactory", FACTORY_ADDRESS, deployer);
const implementationReference = await factory.accountImplementation();
if (implementationReference.toLowerCase() !== IMPLEMENTATION_ADDRESS.toLowerCase()) {
  throw new Error("Factory implementation reference mismatch.");
}

const userSalt = ethers.id("alpha-prime-phase2-bsc-privilege-check-v1");
const testAccountAddress = await factory.predictAccount(TEST_QX, TEST_QY, userSalt);
if ((await provider.getCode(testAccountAddress)) === "0x") {
  const creation = await factory.createAccount(TEST_QX, TEST_QY, userSalt);
  await creation.wait();
}

const account = await ethers.getContractAt("AVSAccount", testAccountAddress, deployer);
const [signerQxBefore, signerQyBefore] = await account.signer();
if (signerQxBefore !== TEST_QX || signerQyBefore !== TEST_QY) {
  throw new Error("Factory-created account signer does not match its Passkey public key.");
}
if ((await account.entryPoint()).toLowerCase() !== ENTRYPOINT_V08_ADDRESS.toLowerCase()) {
  throw new Error("Factory-created account does not use canonical EntryPoint v0.8.");
}

async function requireRevert(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

const mode =
  "0x0100000000000000000000000000000000000000000000000000000000000000";
const executionData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["tuple(address target,uint256 value,bytes callData)[]"],
  [[{ target: deployerAddress, value: 0n, callData: "0x" }]],
);

await requireRevert("Direct deployer execution", () =>
  account.execute.staticCall(mode, executionData),
);
await requireRevert("Second initialization", () =>
  account.initialize.staticCall(TEST_QX, TEST_QY),
);

const [signerQxAfter, signerQyAfter] = await account.signer();
if (signerQxAfter !== signerQxBefore || signerQyAfter !== signerQyBefore) {
  throw new Error("Temporary deployer changed the Factory-created account signer.");
}
if (!(await factory.isAVSAccount(testAccountAddress))) {
  throw new Error("Factory did not record the invariant-check Smart Account.");
}

console.log("PHASE_2_BSC_POST_DEPLOYMENT_SECURITY=PASS");
console.log(`INVARIANT_TEST_ACCOUNT=${testAccountAddress}`);
console.log(`FACTORY_IMPLEMENTATION_REFERENCE=${implementationReference}`);
console.log("TEMPORARY_DEPLOYER_PERMANENT_PRIVILEGES=NONE");