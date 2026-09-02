import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { readFile, writeFile } from "node:fs/promises";

import { preflight } from "./phase3b-bsc-common.js";

const SETTLEMENT = "0x51F98c51E1E669d2a25df136a150401352586690";
const EVIDENCE_PATH =
  ".local/phase3c-first-trading-settlement-evidence/bsc-testnet-first-trading-settlement.json";
const DEPLOYMENT_PATH =
  "deployments/bsc-testnet/phase3c-first-trading-settlement.json";

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [admin] = await ethers.getSigners();
if (!admin) throw new Error("No approved BSC Testnet deployer signer is configured.");
const settlement = await ethers.getContractAt(
  "AVSTradingSettlement",
  SETTLEMENT,
);
const record = JSON.parse(await readFile(EVIDENCE_PATH, "utf8")) as any;
if (
  record.stage !== "pass" ||
  record.settlement?.transaction == null ||
  (await settlement.settlementCount()) !== 1n
) {
  throw new Error("Invalid-signature remediation requires completed Phase 3C.");
}

const relayer = record.temporaryOperationalRoles.relayer as string;
let nonce = await ethers.provider.getTransactionCount(checked.deployer, "pending");
const roleTransactions: any[] = [];
async function setRelayer(authorized: boolean) {
  const sent = await settlement.setRelayer(relayer, authorized, { nonce: nonce++ });
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Relayer authorization=${authorized} failed.`);
  }
  roleTransactions.push({
    label: `${authorized ? "authorize" : "revoke"} temporary relayer for invalid-signature eth_call`,
    hash: sent.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const head = await ethers.provider.getBlockNumber();
    const blockTag = Math.max(receipt.blockNumber, head);
    if ((await settlement.authorizedRelayers(relayer, { blockTag })) === authorized) {
      return;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
    }
  }
  throw new Error(`Relayer authorization=${authorized} readback failed.`);
}

await setRelayer(true);
try {
  const submitted = record.settlement.core;
  const sequence = 1002n;
  const positionId = ethers.id("phase3c-negative-auth-position-1002");
  const executionHash = ethers.id("phase3c-negative-auth-execution-1002");
  const settlementId = await settlement.computeSettlementId(
    sequence,
    positionId,
    executionHash,
  );
  const core = {
    identity: { settlementId, positionId, sequence, executionHash },
    metadata: submitted.metadata,
    capital: submitted.capital,
    economics: submitted.economics,
    timing: submitted.timing,
  };
  const settlementHash = await settlement.computeSettlementHash(
    core,
    record.settlement.legs,
    record.settlement.extraFields,
  );
  const mutatedCore = {
    ...core,
    economics: {
      ...core.economics,
      grossPnlUsd: BigInt(core.economics.grossPnlUsd) + 1n,
    },
  };
  const authorization = {
    settlementHash,
    tradeSignature: `0x${"00".repeat(65)}`,
    serverSignature: `0x${"00".repeat(65)}`,
  };
  const data = settlement.interface.encodeFunctionData("submitSettlement", [
    mutatedCore,
    record.settlement.legs,
    record.settlement.extraFields,
    authorization,
  ]);
  let revertData: string | null = null;
  try {
    await ethers.provider.call({
      to: SETTLEMENT,
      from: relayer,
      data,
    });
  } catch (error: any) {
    revertData = error?.data ?? error?.info?.error?.data ?? null;
  }
  const expectedSelector = settlement.interface.getError(
    "SettlementHashMismatch",
  )?.selector;
  if (
    !revertData ||
    !expectedSelector ||
    !revertData.toLowerCase().startsWith(expectedSelector.toLowerCase())
  ) {
    throw new Error(
      `Expected SettlementHashMismatch (${expectedSelector}), got ${revertData}.`,
    );
  }
  record.invalidSignatureTest = {
    reverted: true,
    method: "eth_call",
    case: "fresh settlement identity with grossPnlUsd mutated after settlementHash was signed",
    sequence: sequence.toString(),
    positionId,
    executionHash,
    settlementId,
    signedSettlementHash: settlementHash,
    errorName: "SettlementHashMismatch",
    selector: expectedSelector,
    revertData,
    noStateChange: true,
  };
} finally {
  await setRelayer(false);
}

record.cleanup.invalidSignatureTestRoleTransactions = roleTransactions;
record.cleanup.relayerAuthorized = await settlement.authorizedRelayers(relayer);
record.cleanup.tradeSignerAuthorized = await settlement.authorizedTradeSigners(
  record.temporaryOperationalRoles.tradeSigner,
);
record.cleanup.serverSignerAuthorized = await settlement.authorizedServerSigners(
  record.temporaryOperationalRoles.serverSigner,
);
if (
  record.cleanup.relayerAuthorized ||
  record.cleanup.tradeSignerAuthorized ||
  record.cleanup.serverSignerAuthorized
) {
  throw new Error("Temporary role cleanup failed after invalid-signature test.");
}
let content = `${JSON.stringify(record, null, 2)}\n`;
await writeFile(EVIDENCE_PATH, content, "utf8");
await writeFile(DEPLOYMENT_PATH, content, "utf8");

console.log("PHASE_3C_INVALID_SIGNATURE_ETH_CALL=PASS");
console.log("ERROR=SettlementHashMismatch");
console.log(`SELECTOR=${record.invalidSignatureTest.selector}`);
console.log("SETTLEMENT_COUNT=1");
console.log("TEMPORARY_ROLES_AUTHORIZED=false");