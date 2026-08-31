import "@nomicfoundation/hardhat-ethers";
import { readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

import { preflight } from "./phase3b-bsc-common.js";

const CONFIRMATION = "BSC_TESTNET_PHASE4D_CONFIRM_PUBLIC_VERIFICATION";
const EVIDENCE_PATH = ".local/phase4d-evidence/bsc-testnet-deployments.json";
const DEPLOYMENT_PATH = "deployments/bsc-testnet/phase4d-migration.json";
const BSCSCAN_API = "https://api.etherscan.io/v2/api";

if (process.env.PHASE4D_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Confirmation disabled. Set PHASE4D_CONFIRM=${CONFIRMATION}.`,
  );
}

const apiKey = process.env.BSC_SCAN_API_KEY;
if (!apiKey)
  throw new Error("BSC_SCAN_API_KEY is required for public confirmation.");

type SourceVerification = {
  status: string;
  sourcifyCreationMatch?: string;
  sourcifyRuntimeMatch?: string;
  bscScanExternalVerificationId?: string | null;
  bscScanPublicVerification?: unknown;
};
type Deployment = {
  name: string;
  address: string;
  deploymentTransaction: string;
  runtimeBytecodeHash: string;
  sourceVerification: SourceVerification;
};
type RecordShape = {
  network: string;
  chainId: string;
  owner: string;
  deployments: Record<string, Deployment>;
  publicBscScanVerified: boolean;
  migrationExecution: unknown;
};

const record = JSON.parse(
  await readFile(DEPLOYMENT_PATH, "utf8"),
) as RecordShape;
if (record.network !== "bscTestnet" || record.chainId !== "97") {
  throw new Error("Phase 4D record is not for BSC Testnet.");
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
if (checked.deployer.toLowerCase() !== record.owner.toLowerCase()) {
  throw new Error("Signer does not match the recorded owner.");
}

for (const deployment of Object.values(record.deployments)) {
  const runtime = await ethers.provider.getCode(deployment.address);
  if (
    runtime === "0x" ||
    ethers.keccak256(runtime) !== deployment.runtimeBytecodeHash
  ) {
    throw new Error(`${deployment.name} runtime hash does not match evidence.`);
  }

  const sourcifyResponse = await fetch(
    `https://sourcify.dev/server/v2/contract/97/${deployment.address}?fields=matchId,creationMatch,runtimeMatch,deployment.transactionHash`,
  );
  if (!sourcifyResponse.ok) {
    throw new Error(
      `${deployment.name} Sourcify lookup failed (${sourcifyResponse.status}).`,
    );
  }
  const sourcify = (await sourcifyResponse.json()) as {
    creationMatch?: string;
    runtimeMatch?: string;
    deployment?: { transactionHash?: string };
  };
  if (
    sourcify.creationMatch !== "exact_match" ||
    sourcify.runtimeMatch !== "exact_match" ||
    sourcify.deployment?.transactionHash?.toLowerCase() !==
      deployment.deploymentTransaction.toLowerCase()
  ) {
    throw new Error(
      `${deployment.name} does not have independent Sourcify Exact Match.`,
    );
  }

  const url = new URL(BSCSCAN_API);
  url.search = new URLSearchParams({
    chainid: "97",
    module: "contract",
    action: "getsourcecode",
    address: deployment.address,
    apikey: apiKey,
  }).toString();
  const bscScanResponse = await fetch(url);
  if (!bscScanResponse.ok) {
    throw new Error(
      `${deployment.name} BscScan public lookup failed (${bscScanResponse.status}).`,
    );
  }
  const bscScan = (await bscScanResponse.json()) as {
    status?: string;
    message?: string;
    result?: Array<{
      ContractName?: string;
      SourceCode?: string;
      ABI?: string;
      Proxy?: string;
      Implementation?: string;
    }>;
  };
  const source = bscScan.result?.[0];
  if (
    bscScan.status !== "1" ||
    source?.ContractName !== deployment.name ||
    !source.SourceCode ||
    !source.ABI ||
    source.Proxy !== "0" ||
    source.Implementation
  ) {
    throw new Error(
      `${deployment.name} is not publicly source-verified on BscScan: ${bscScan.message ?? "invalid source response"}.`,
    );
  }

  deployment.sourceVerification.bscScanPublicVerification = {
    checkedAt: new Date().toISOString(),
    apiStatus: bscScan.status,
    contractName: source.ContractName,
    sourceCodePresent: true,
    publicCodePage: `https://testnet.bscscan.com/address/${deployment.address}#code`,
  };
  console.log(`PUBLIC_BSCSCAN_VERIFIED=${deployment.name}`);
}

record.publicBscScanVerified = true;
const json = `${JSON.stringify(record, null, 2)}\n`;
await writeFile(EVIDENCE_PATH, json, "utf8");
await writeFile(DEPLOYMENT_PATH, json, "utf8");

console.log("PHASE_4D_PUBLIC_VERIFICATION=SUCCESS");
console.log("SOURCIFY_EXACT_MATCH_ALL=true");
console.log("BSCSCAN_PUBLIC_SOURCE_ALL=true");
console.log(`MIGRATION_EXECUTED=${record.migrationExecution !== null}`);
console.log("THIS_CONFIRMATION_MOVED_TEST_USDT=false");
