import "@nomicfoundation/hardhat-ethers";
import { readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

import { preflight } from "./phase3b-bsc-common.js";
import { verifyWithSourcifyV2 } from "./sourcify-v2.js";

const CONFIRMATION = "BSC_TESTNET_PHASE4D_VERIFY_EXISTING";
const EVIDENCE_PATH = ".local/phase4d-evidence/bsc-testnet-deployments.json";
const DEPLOYMENT_PATH = "deployments/bsc-testnet/phase4d-migration.json";

if (process.env.PHASE4D_VERIFY_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Verification disabled. Set PHASE4D_VERIFY_CONFIRM=${CONFIRMATION}.`,
  );
}

type Deployment = {
  name: string;
  contractIdentifier: string;
  address: string;
  deploymentTransaction: string;
  runtimeBytecodeHash: string;
  sourceVerification: { status: string };
};
type RecordShape = {
  network: string;
  chainId: string;
  owner: string;
  deployments: Record<string, Deployment>;
  migrationExecution?: unknown;
};

const record = JSON.parse(
  await readFile(DEPLOYMENT_PATH, "utf8"),
) as RecordShape;
if (record.network !== "bscTestnet" || record.chainId !== "97") {
  throw new Error("Phase 4D deployment record is not for BSC Testnet.");
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
if (checked.deployer.toLowerCase() !== record.owner.toLowerCase()) {
  throw new Error("Signer does not match the recorded Phase 4D owner.");
}

for (const deployment of Object.values(record.deployments)) {
  const runtime = await ethers.provider.getCode(deployment.address);
  if (
    runtime === "0x" ||
    ethers.keccak256(runtime) !== deployment.runtimeBytecodeHash
  ) {
    throw new Error(
      `${deployment.name} runtime does not match local evidence.`,
    );
  }
  if (deployment.sourceVerification.status === "exact_match") continue;

  console.log(`SOURCIFY_RESUME=${deployment.name}`);
  deployment.sourceVerification = await verifyWithSourcifyV2({
    chainId: checked.chainId,
    address: deployment.address,
    contractIdentifier: deployment.contractIdentifier,
    creationTransactionHash: deployment.deploymentTransaction,
  });
  const json = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(EVIDENCE_PATH, json, "utf8");
  await writeFile(DEPLOYMENT_PATH, json, "utf8");
  console.log(`SOURCIFY_EXACT_MATCH=${deployment.name}`);
}

console.log("PHASE_4D_SOURCE_VERIFICATION=SUCCESS");
console.log("TEST_USDT_MOVEMENT=false");
console.log(
  `MIGRATION_EXECUTED=${record.migrationExecution !== null && record.migrationExecution !== undefined}`,
);
