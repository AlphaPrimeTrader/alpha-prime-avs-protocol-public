import { readFile } from "node:fs/promises";

const SOURCIFY_SERVER = "https://sourcify.dev/server";
const POLL_INTERVAL_MS = 5_000;
const VERIFICATION_TIMEOUT_MS = 10 * 60_000;

type StandardJsonInput = {
  language: string;
  sources: Record<string, { content?: string }>;
  settings: Record<string, unknown>;
};

type BuildInfo = {
  solcLongVersion: string;
  solcVersion: string;
  input: StandardJsonInput;
};

type BuildOutput = {
  output: { contracts?: Record<string, Record<string, unknown>> };
};

type ArtifactPointer = {
  buildInfoId: string;
  sourceName: string;
  contractName: string;
};

type VerificationJob = {
  verificationId: string;
};

type VerificationStatus = {
  isJobCompleted?: boolean;
  verificationId?: string;
  error?: { customCode?: string; message?: string };
  contract?: {
    matchId?: string;
    creationMatch?: string | null;
    runtimeMatch?: string | null;
  };
  externalVerifications?: {
    etherscan?: {
      verificationId?: string;
      error?: string;
      explorerUrl?: string;
      statusUrl?: string;
    };
  };
};

type VerifiedContract = {
  matchId?: string;
  creationMatch?: string | null;
  runtimeMatch?: string | null;
  verifiedAt?: string;
  deployment?: {
    transactionHash?: string;
  };
};

export type SourceVerification = {
  status: "exact_match";
  verifiedAt: string | null;
  bscScan: string;
  sourcify: string;
  sourcifyVerificationId: string;
  sourcifyMatchId: string | null;
  sourcifyCreationMatch: "exact_match";
  sourcifyRuntimeMatch: "exact_match";
  bscScanExternalVerificationId: string | null;
};

export async function verifyWithSourcifyV2(input: {
  chainId: bigint;
  address: string;
  contractIdentifier: string;
  creationTransactionHash: string;
}): Promise<SourceVerification> {
  if (input.chainId !== 97n) {
    throw new Error("Sourcify verification is restricted to BSC Testnet (97).");
  }

  const resolved = await findBuildInfo(input.contractIdentifier);
  const buildInfo = resolved.buildInfo;
  const compilerVersion = buildInfo.solcLongVersion.startsWith("v")
    ? buildInfo.solcLongVersion
    : `v${buildInfo.solcLongVersion}`;
  const url = `${SOURCIFY_SERVER}/v2/verify/${input.chainId}/${input.address}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion,
      contractIdentifier: resolved.contractIdentifier,
      creationTransactionHash: input.creationTransactionHash,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Sourcify submission failed (${response.status}): ${body.slice(0, 1_000)}`,
    );
  }

  const job = (await response.json()) as VerificationJob;
  if (!job.verificationId) {
    throw new Error("Sourcify did not return a verification ID.");
  }

  const deadline = Date.now() + VERIFICATION_TIMEOUT_MS;
  let status: VerificationStatus | null = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetch(
      `${SOURCIFY_SERVER}/v2/verify/${job.verificationId}`,
    );
    if (!poll.ok) {
      throw new Error(`Sourcify polling failed (${poll.status}).`);
    }
    status = (await poll.json()) as VerificationStatus;
    if (status.isJobCompleted) break;
  }

  if (!status?.isJobCompleted) {
    throw new Error(`Sourcify verification timed out for ${input.address}.`);
  }
  if (status.error) {
    const failure = status.error;
    throw new Error(
      `Sourcify verification failed: ${failure?.customCode ?? "unknown"} ${failure?.message ?? ""}`,
    );
  }
  const external = status.externalVerifications?.etherscan;
  if (external?.error || !external?.verificationId) {
    throw new Error(
      `Sourcify external BscScan publication was not accepted: ${external?.error ?? "missing verification ID"}`,
    );
  }

  const contractResponse = await fetch(
    `${SOURCIFY_SERVER}/v2/contract/${input.chainId}/${input.address}?fields=matchId,creationMatch,runtimeMatch,verifiedAt,deployment.transactionHash`,
  );
  if (!contractResponse.ok) {
    throw new Error(
      `Sourcify verified-contract lookup failed (${contractResponse.status}).`,
    );
  }
  const contract = (await contractResponse.json()) as VerifiedContract;
  if (
    contract.creationMatch !== "exact_match" ||
    contract.runtimeMatch !== "exact_match"
  ) {
    throw new Error(
      `Sourcify match is not exact: creation=${contract.creationMatch}, runtime=${contract.runtimeMatch}.`,
    );
  }
  if (
    contract.deployment?.transactionHash &&
    contract.deployment.transactionHash.toLowerCase() !==
      input.creationTransactionHash.toLowerCase()
  ) {
    throw new Error("Sourcify deployment transaction does not match.");
  }

  return {
    status: "exact_match",
    verifiedAt: contract.verifiedAt ?? null,
    bscScan:
      external.explorerUrl ??
      `https://testnet.bscscan.com/address/${input.address}#code`,
    sourcify: `https://repo.sourcify.dev/${input.chainId}/${input.address}`,
    sourcifyVerificationId: job.verificationId,
    sourcifyMatchId: contract.matchId ?? null,
    sourcifyCreationMatch: "exact_match",
    sourcifyRuntimeMatch: "exact_match",
    bscScanExternalVerificationId: external.verificationId,
  };
}

async function findBuildInfo(contractIdentifier: string): Promise<{
  buildInfo: BuildInfo;
  contractIdentifier: string;
}> {
  const separator = contractIdentifier.lastIndexOf(":");
  if (separator < 1) {
    throw new Error(`Invalid contract identifier: ${contractIdentifier}`);
  }
  const sourcePath = contractIdentifier.slice(0, separator);
  const contractName = contractIdentifier.slice(separator + 1);
  const artifact = JSON.parse(
    await readFile(
      `.hardhat/artifacts/${sourcePath}/${contractName}.json`,
      "utf8",
    ),
  ) as ArtifactPointer;
  if (
    artifact.sourceName !== sourcePath ||
    artifact.contractName !== contractName ||
    !artifact.buildInfoId
  ) {
    throw new Error(`Artifact pointer is invalid for ${contractIdentifier}.`);
  }

  const base = `.hardhat/artifacts/build-info/${artifact.buildInfoId}`;
  const parsed = JSON.parse(
    await readFile(`${base}.json`, "utf8"),
  ) as BuildInfo;
  const buildOutput = JSON.parse(
    await readFile(`${base}.output.json`, "utf8"),
  ) as BuildOutput;
  const buildSourcePath = parsed.input.sources[sourcePath]
    ? sourcePath
    : `project/${sourcePath}`;
  if (
    !buildOutput.output.contracts?.[buildSourcePath]?.[contractName] ||
    parsed.input.settings.optimizer === undefined ||
    parsed.input.sources[buildSourcePath]?.content === undefined
  ) {
    throw new Error(`Build info is incomplete for ${contractIdentifier}.`);
  }
  return {
    buildInfo: parsed,
    contractIdentifier: `${buildSourcePath}:${contractName}`,
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
