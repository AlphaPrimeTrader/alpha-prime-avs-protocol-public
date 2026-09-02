import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { Wallet } from "ethers";
import { readFile, unlink, writeFile } from "node:fs/promises";

import { preflight } from "./phase3b-bsc-common.js";

const KEY_PATH = "/tmp/avs-phase3c-operational-keys.json";
const EVIDENCE_PATH =
  ".local/phase3c-first-trading-settlement-evidence/bsc-testnet-first-trading-settlement.json";
const DEPLOYMENT_PATH =
  "deployments/bsc-testnet/phase3c-first-trading-settlement.json";
const SETTLEMENT = "0x51F98c51E1E669d2a25df136a150401352586690";

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [admin] = await ethers.getSigners();
if (!admin) throw new Error("No approved BSC Testnet deployer signer is configured.");

const record = JSON.parse(await readFile(EVIDENCE_PATH, "utf8")) as any;
if (record.stage !== "readback_pass" || record.settlement?.transaction == null) {
  throw new Error("Cleanup requires the completed Phase 3C readback evidence.");
}
const keys = JSON.parse(await readFile(KEY_PATH, "utf8")) as {
  relayerPrivateKey: string;
  tradeSignerPrivateKey: string;
  serverSignerPrivateKey: string;
};
const relayer = new Wallet(keys.relayerPrivateKey, ethers.provider);
const tradeSigner = new Wallet(keys.tradeSignerPrivateKey);
const serverSigner = new Wallet(keys.serverSignerPrivateKey);
const roles = {
  relayer: relayer.address,
  tradeSigner: tradeSigner.address,
  serverSigner: serverSigner.address,
};
const settlement = await ethers.getContractAt(
  "AVSTradingSettlement",
  SETTLEMENT,
);
if ((await settlement.settlementCount()) !== 1n) {
  throw new Error("Cleanup requires exactly one successful settlement.");
}

type TxRecord = {
  label: string;
  hash: string;
  block: number;
  gasUsed: string;
};
let adminNonce = await ethers.provider.getTransactionCount(
  checked.deployer,
  "pending",
);
const cleanupTransactions: TxRecord[] = [];
const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function confirmRevoked(
  account: string,
  receiptBlock: number,
  read: (address: string, blockTag?: number) => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const head = await ethers.provider.getBlockNumber();
    const blockTag = Math.max(receiptBlock, head);
    if (!(await read(account, blockTag))) return;
    if (attempt < 4) await sleep(1_500 * (attempt + 1));
  }
  throw new Error("Role revocation did not confirm at receipt block or later.");
}

async function revoke(
  label: string,
  account: string,
  read: (address: string, blockTag?: number) => Promise<boolean>,
  action: (account: string, nonce: number) => Promise<any>,
) {
  if (!(await read(account))) return;
  const sent = await action(account, adminNonce++);
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed.`);
  cleanupTransactions.push({
    label,
    hash: sent.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });
  await confirmRevoked(account, receipt.blockNumber, read);
}

await revoke(
  "revoke temporary relayer",
  roles.relayer,
  (address, blockTag) => settlement.authorizedRelayers(
    address,
    blockTag === undefined ? {} : { blockTag },
  ),
  (address, nonce) => settlement.setRelayer(address, false, { nonce }),
);
await revoke(
  "revoke temporary trade signer",
  roles.tradeSigner,
  (address, blockTag) => settlement.authorizedTradeSigners(
    address,
    blockTag === undefined ? {} : { blockTag },
  ),
  (address, nonce) => settlement.setTradeSigner(address, false, { nonce }),
);
await revoke(
  "revoke temporary server signer",
  roles.serverSigner,
  (address, blockTag) => settlement.authorizedServerSigners(
    address,
    blockTag === undefined ? {} : { blockTag },
  ),
  (address, nonce) => settlement.setServerSigner(address, false, { nonce }),
);

const relayerBalance = await ethers.provider.getBalance(relayer.address);
let gasReturn: TxRecord | null = null;
if (relayerBalance > 0n) {
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  const gasLimit = 21_000n;
  const returnAmount = relayerBalance > gasPrice * gasLimit
    ? relayerBalance - gasPrice * gasLimit
    : 0n;
  if (returnAmount > 0n) {
    const sent = await relayer.sendTransaction({
      to: checked.deployer,
      value: returnAmount,
      gasLimit,
      nonce: await ethers.provider.getTransactionCount(relayer.address, "pending"),
    });
    const receipt = await sent.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("Returning unused relayer gas failed.");
    }
    gasReturn = {
      label: "return unused temporary relayer gas",
      hash: sent.hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
  }
}

const cleanup = {
  transactions: gasReturn
    ? [...cleanupTransactions, gasReturn]
    : cleanupTransactions,
  relayerAuthorized: await settlement.authorizedRelayers(roles.relayer),
  tradeSignerAuthorized: await settlement.authorizedTradeSigners(roles.tradeSigner),
  serverSignerAuthorized: await settlement.authorizedServerSigners(roles.serverSigner),
  relayerNativeBalance: (await ethers.provider.getBalance(relayer.address)).toString(),
  keysDeleted: false,
};
if (
  cleanup.relayerAuthorized ||
  cleanup.tradeSignerAuthorized ||
  cleanup.serverSignerAuthorized
) {
  throw new Error("Temporary role cleanup is incomplete.");
}

record.cleanup = cleanup;
record.stage = "pass";
const content = `${JSON.stringify(record, null, 2)}\n`;
await writeFile(EVIDENCE_PATH, content, "utf8");
await writeFile(DEPLOYMENT_PATH, content, "utf8");
await unlink(KEY_PATH);
cleanup.keysDeleted = true;
const finalContent = `${JSON.stringify(record, null, 2)}\n`;
await writeFile(EVIDENCE_PATH, finalContent, "utf8");
await writeFile(DEPLOYMENT_PATH, finalContent, "utf8");

console.log("PHASE_3C_CLEANUP_BSC_TESTNET=PASS");
console.log(`RELAYER=${roles.relayer}`);
console.log(`TRADE_SIGNER=${roles.tradeSigner}`);
console.log(`SERVER_SIGNER=${roles.serverSigner}`);
console.log(`CLEANUP_TRANSACTIONS=${cleanup.transactions.length}`);
console.log("RELAYER_AUTHORIZED=false");
console.log("TRADE_SIGNER_AUTHORIZED=false");
console.log("SERVER_SIGNER_AUTHORIZED=false");
console.log("KEYS_DELETED=true");