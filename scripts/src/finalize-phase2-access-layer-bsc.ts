import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { readFile, writeFile } from "node:fs/promises";

import { preflight } from "./phase3b-bsc-common.js";

const EVIDENCE_PATH =
  ".local/phase2-access-layer-evidence/bsc-testnet-access-layer-generation.json";
const DEPLOYMENT_PATH =
  "deployments/bsc-testnet/phase2-access-layer-integrated.json";
const ZERO = "0x0000000000000000000000000000000000000000";

const record = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as any;
if (
  record.chainId !== "97" ||
  record.deploymentGeneration !== "1" ||
  record.stage !== "deployment_readback_pass"
) {
  throw new Error("Phase 2 deployment record is not ready for read-only finalization.");
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const deployments = record.deployedContracts;
const gateway = await ethers.getContractAt(
  "AVSGateway",
  deployments.AVSGateway.address,
);
const testUsdt = await ethers.getContractAt(
  "TestUSDT",
  deployments.TestUSDT.address,
);
const token = await ethers.getContractAt(
  "AVSToken",
  deployments.AVSToken.address,
);

const moduleIds = {
  AVS_TOKEN: await gateway.AVS_TOKEN_MODULE_ID(),
  LEDGER: await gateway.LEDGER_MODULE_ID(),
  VAULT: await gateway.VAULT_MODULE_ID(),
  MARKETPLACE: await gateway.MARKETPLACE_MODULE_ID(),
  TRADING_SETTLEMENT: await gateway.TRADING_SETTLEMENT_MODULE_ID(),
  ACCOUNT_POLICY: await gateway.ACCOUNT_POLICY_MODULE_ID(),
  MIGRATION: await gateway.MIGRATION_MODULE_ID(),
  PROTOCOL_LENS: await gateway.PROTOCOL_LENS_MODULE_ID(),
};
const expectedModules = {
  AVS_TOKEN: deployments.AVSToken.address,
  LEDGER: deployments.AVSLedger.address,
  VAULT: deployments.AVSVault.address,
  MARKETPLACE: deployments.AVSMarketplace.address,
  TRADING_SETTLEMENT: deployments.AVSTradingSettlement.address,
  ACCOUNT_POLICY: deployments.AccountPolicyMock.address,
  MIGRATION: ZERO,
  PROTOCOL_LENS: deployments.AVSProtocolLens.address,
};

const discoveredModules: Record<string, string> = {};
const discoveredCodehashes: Record<string, string> = {};
for (const [name, moduleId] of Object.entries(moduleIds)) {
  const address = await gateway.moduleAddress(moduleId);
  const codehash = await gateway.moduleCodehash(moduleId);
  const expected = expectedModules[name as keyof typeof expectedModules];
  if (address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Gateway module ${name} mismatch.`);
  }
  const code = await ethers.provider.getCode(address);
  const expectedCodehash = ethers.keccak256(code);
  if (codehash.toLowerCase() !== expectedCodehash.toLowerCase()) {
    throw new Error(`Gateway module codehash ${name} mismatch.`);
  }
  discoveredModules[name] = address;
  discoveredCodehashes[name] = codehash;
}

const wiringHealth = await gateway.getWiringHealth();
const marketplaceAuthorized = await token.isWhitelisted(
  deployments.AVSMarketplace.address,
);
const protocolSnapshot = await gateway.getProtocolSnapshot();
const marketplaceSnapshot = await gateway.getMarketplaceSnapshot();
const userSnapshot = await gateway.getUserSnapshot(checked.deployer);
const orders = await gateway.getOrderIds(0, 100, true);
const settlements = await gateway.getSettlementSummaries(0, 100);
if (
  !marketplaceAuthorized ||
  !wiringHealth.marketplaceAuthorized ||
  !wiringHealth.allHealthy ||
  orders.length !== 0 ||
  settlements.length !== 0 ||
  (await gateway.chainId()) !== 97n ||
  (await gateway.deploymentGeneration()) !== 1n ||
  (await ethers.provider.getBalance(await gateway.getAddress())) !== 0n ||
  (await testUsdt.balanceOf(await gateway.getAddress())) !== 0n ||
  (await token.balanceOf(await gateway.getAddress())) !== 0n
) {
  throw new Error("Gateway-only bootstrap readback failed.");
}
for (const deployment of Object.values(deployments) as any[]) {
  if (deployment.sourceVerification?.status !== "exact_match") {
    throw new Error(`${deployment.name} source verification is not exact.`);
  }
}

record.gatewayBootstrap = {
  protocolVersion: (await gateway.protocolVersion()).map((value: bigint) =>
    value.toString(),
  ),
  chainId: (await gateway.chainId()).toString(),
  deploymentGeneration: (await gateway.deploymentGeneration()).toString(),
  discoveredModules,
  discoveredCodehashes,
  protocolSnapshot,
  marketplaceSnapshot,
  userSnapshot,
  emptyOrderPagination: orders,
  emptySettlementPagination: settlements,
  wiringHealth,
  marketplaceAuthorized,
  balances: {
    native: "0",
    testUSDT: "0",
    avs: "0",
  },
};
record.sourceVerification.status = "exact_match";
record.stage = "pass";

const json = `${JSON.stringify(
  record,
  (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  2,
)}\n`;
await writeFile(DEPLOYMENT_PATH, json, "utf8");
await writeFile(EVIDENCE_PATH, json, "utf8");

console.log("PHASE_2_ACCESS_LAYER_BSC_TESTNET_FINALIZATION=PASS");
console.log(`AVS_GATEWAY_ADDRESS=${deployments.AVSGateway.address}`);
console.log("ON_CHAIN_WRITES=0");
console.log("SOURCE_VERIFICATION=9/9_EXACT_MATCH");
console.log("ECONOMIC_CYCLE=false");
console.log("MIGRATION_EXECUTED=false");
console.log("LOCKS_EXECUTED=false");
console.log("OWNERSHIP_RENOUNCED=false");
console.log("MAINNET_INTERACTION=false");