import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ENTRYPOINT_V08_ADDRESS,
  ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH,
} from "../../test/fixtures/entrypoint-v08-runtime";

export const PHASE3B_CHAIN_ID = 97n;
export const APPROVED_DEPLOYER = "0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9";
export const MINIMUM_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 tBNB
export const EVIDENCE_DIRECTORY = ".local/phase3b-evidence";
export const EVIDENCE_PATH = join(EVIDENCE_DIRECTORY, "bsc-testnet-deployment.json");

export type DeploymentRecord = {
  name: string;
  address: string;
  txHash: string;
  block: number;
  deployer: string;
  constructorArgs: readonly (string | number)[];
  runtimeHash: string;
  gasUsed: string | null;
  outerDeploymentGasUsed?: string;
};

export type Phase3BEvidence = {
  schemaVersion: 1;
  network: "bscTestnet";
  chainId: "97";
  entryPoint: { address: string; runtimeHash: string };
  deployer: string;
  minimumBalanceWei: string;
  compiler: { solidity: "0.8.28"; optimizer: { enabled: true; runs: 200 } };
  deployments: DeploymentRecord[];
};

export async function preflight(ethers: {
  provider: {
    getNetwork(): Promise<{ chainId: bigint }>;
    getCode(address: string): Promise<string>;
    getBalance(address: string): Promise<bigint>;
  };
  getSigners(): Promise<Array<{ getAddress(): Promise<string> }>>;
  keccak256(value: string): string;
}) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== PHASE3B_CHAIN_ID) {
    throw new Error(`Refusing operation on chain ${chainId}; BSC Testnet (97) only.`);
  }
  const entryPointCode = await ethers.provider.getCode(ENTRYPOINT_V08_ADDRESS);
  if (entryPointCode === "0x") throw new Error("Canonical EntryPoint v0.8 has no runtime code.");
  const entryPointRuntimeHash = ethers.keccak256(entryPointCode);
  if (entryPointRuntimeHash !== ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH) {
    throw new Error("Canonical EntryPoint v0.8 runtime hash does not match the BSC Testnet fixture.");
  }
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No deployer signer is configured.");
  const deployer = await signer.getAddress();
  if (deployer.toLowerCase() !== APPROVED_DEPLOYER.toLowerCase()) {
    throw new Error("Configured signer is not the approved temporary BSC Testnet deployer.");
  }
  const balance = await ethers.provider.getBalance(deployer);
  if (balance < MINIMUM_BALANCE_WEI) {
    throw new Error(
      `Insufficient BSC Testnet balance: at least ${MINIMUM_BALANCE_WEI} wei (0.05 tBNB) is required.`,
    );
  }
  return { chainId, deployer, balance, entryPointRuntimeHash };
}

export async function writeEvidence(evidence: Phase3BEvidence) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export async function readEvidence(): Promise<Phase3BEvidence> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(EVIDENCE_PATH, "utf8"));
  } catch {
    throw new Error(`Local Phase 3B evidence is required at ${EVIDENCE_PATH}.`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !Array.isArray((parsed as { deployments?: unknown }).deployments)
  ) {
    throw new Error("Local Phase 3B evidence has an invalid schema.");
  }
  return parsed as Phase3BEvidence;
}