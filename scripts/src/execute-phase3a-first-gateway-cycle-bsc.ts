import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Wallet } from "ethers";

import { preflight } from "./phase3b-bsc-common.js";

const CONFIRMATION = "BSC_TESTNET_PHASE3A_ONE_GATEWAY_BUY_ONLY";
const MANIFEST_PATH =
  "deployments/bsc-testnet/phase2-access-layer-integrated.json";
const RESULT_PATH =
  "deployments/bsc-testnet/phase3a-first-gateway-financial-cycle.json";
const EVIDENCE_PATH =
  ".local/phase3a-access-layer-evidence/bsc-testnet-first-gateway-cycle.json";
const SCALE = 10n ** 18n;
const CAPITAL = 10_000n * SCALE;
const BUYER_FEE = 2n * SCALE;
const USER_PAYMENT = CAPITAL + BUYER_FEE;
const MARKETPLACE_ALLOCATION = 500n * SCALE;
const PRODUCTIVE_CAPITAL = 9_500n * SCALE;
const EXPECTED_NAV_AFTER = 1_000_200_000_000_000_000n;
const USER_NATIVE_FUNDING = 10n ** 16n;
const GENERATION = 1n;
const ZERO = "0x0000000000000000000000000000000000000000";

const EXPECTED_ADDRESSES = {
  AVSGateway: "0x18097B9Af3AfFf28B07Bf4C762e50DF4802bB778",
  AVSProtocolLens: "0x822555dE56fe9Fc2d4DF59E75bf59DF05e233F15",
  AVSMarketplace: "0x9AE0729C414995470b44Db8caB8fc08086520b33",
  AVSToken: "0x20dddf3De5042cf23a1b94af2C660120c324e1Ac",
  AVSLedger: "0x720B9af851C954Fb7749De6a4CF3369EDB3d5B8D",
  AVSVault: "0x0E9f9cea8349F4718d08d23e003258c0f717edC3",
  AVSTradingSettlement: "0x51F98c51E1E669d2a25df136a150401352586690",
  AccountPolicyMock: "0xa6De468dd5A6222a1e5664124aB6975023AF0CF3",
  TestUSDT: "0x28c203F523feb6f6B7aE54d49bb6d7C1dEf9a9Db",
} as const;
const EXPECTED_TRADING_DESTINATION =
  "0x6EB22C5a4B8376A6351ec0869fd7F31A2F6601e8";
const ABANDONED_CANDIDATE =
  "0xB0437ffbCfA182cbafdBE43067427b4911C41098";
const ABANDONED_AUTHORIZATION_TX =
  "0x90c32fc37c991dec0ea71a79cee8e9090f8cc8fd6183e8f17556d0494da9f4f7";

const marketBuyTypes = {
  MarketBuyIntent: [
    { name: "owner", type: "address" },
    { name: "beneficiary", type: "address" },
    { name: "quantityAVS", type: "uint256" },
    { name: "requestedMaxMatches", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "deploymentGeneration", type: "uint256" },
  ],
};

if (process.env.PHASE3A_GATEWAY_CYCLE_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Execution disabled. Set PHASE3A_GATEWAY_CYCLE_CONFIRM=${CONFIRMATION}.`,
  );
}
const previousAttemptText = await readFile(RESULT_PATH, "utf8").catch(() => null);
const previousAttempt = previousAttemptText
  ? (JSON.parse(previousAttemptText) as any)
  : null;
const previousCandidateAddress =
  previousAttempt?.testUser?.address ??
  previousAttempt?.abandonedCandidate?.address;
if (
  previousAttempt &&
  (previousAttempt.stage !== "preflight" ||
    previousAttempt.constraints?.successfulEconomicBuys !== 0 ||
    previousCandidateAddress?.toLowerCase() !==
      ABANDONED_CANDIDATE.toLowerCase())
) {
  throw new Error("Phase 3A evidence is not an eligible pre-economic continuation.");
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as any;
if (
  manifest.stage !== "pass" ||
  manifest.chainId !== "97" ||
  manifest.deploymentGeneration !== "1"
) {
  throw new Error("Approved Phase 2 manifest is not in PASS state.");
}
for (const [name, address] of Object.entries(EXPECTED_ADDRESSES)) {
  const manifestAddress = manifest.deployedContracts?.[name]?.address;
  if (manifestAddress?.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`${name} differs from the approved manifest.`);
  }
}
if (
  manifest.tradingDestination?.address?.toLowerCase() !==
  EXPECTED_TRADING_DESTINATION.toLowerCase()
) {
  throw new Error("tradingDestination differs from the approved manifest.");
}

const { ethers } = await network.create();
const checked = await preflight(ethers);
const [admin] = await ethers.getSigners();
if (!admin) throw new Error("No approved BSC Testnet admin signer.");

const gateway = await ethers.getContractAt(
  "AVSGateway",
  EXPECTED_ADDRESSES.AVSGateway,
);
const lens = await ethers.getContractAt(
  "AVSProtocolLens",
  EXPECTED_ADDRESSES.AVSProtocolLens,
);
const marketplace = await ethers.getContractAt(
  "AVSMarketplace",
  EXPECTED_ADDRESSES.AVSMarketplace,
);
const token = await ethers.getContractAt(
  "AVSToken",
  EXPECTED_ADDRESSES.AVSToken,
);
const ledger = await ethers.getContractAt(
  "AVSLedger",
  EXPECTED_ADDRESSES.AVSLedger,
);
const vault = await ethers.getContractAt(
  "AVSVault",
  EXPECTED_ADDRESSES.AVSVault,
);
const settlement = await ethers.getContractAt(
  "AVSTradingSettlement",
  EXPECTED_ADDRESSES.AVSTradingSettlement,
);
const policy = await ethers.getContractAt(
  "AccountPolicyMock",
  EXPECTED_ADDRESSES.AccountPolicyMock,
);
const usdt = await ethers.getContractAt(
  "TestUSDT",
  EXPECTED_ADDRESSES.TestUSDT,
);

const record: any = {
  schemaVersion: 1,
  stage: "preflight",
  classification:
    "BSC TESTNET FIRST REAL AVSGATEWAY FINANCIAL CYCLE — ONE MARKET BUY ONLY",
  network: "bscTestnet",
  chainId: checked.chainId.toString(),
  deploymentGeneration: GENERATION.toString(),
  manifest: MANIFEST_PATH,
  addresses: {
    ...EXPECTED_ADDRESSES,
    tradingDestination: EXPECTED_TRADING_DESTINATION,
    migration: ZERO,
  },
  abandonedCandidate: {
    address: ABANDONED_CANDIDATE,
    classification: "AUTHORIZED / NO ECONOMIC ACTIVITY / KEY NOT RETAINED",
  },
  testUser: null,
  preflight: null,
  infrastructure: {},
  signedIntent: null,
  submission: null,
  replayTest: null,
  postState: null,
  gatewayReadback: null,
  reconciliation: null,
  constraints: {
    successfulEconomicBuys: 0,
    directMarketplaceBuy: false,
    tradingSettlementSubmitted: false,
    migrationExecuted: false,
    configurationLocked: false,
    ownershipRenounced: false,
    mainnetInteraction: false,
    commit: false,
    push: false,
  },
};

async function persist() {
  await mkdir(".local/phase3a-access-layer-evidence", { recursive: true });
  const json = `${JSON.stringify(
    record,
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    2,
  )}\n`;
  await writeFile(EVIDENCE_PATH, json, "utf8");
  await writeFile(RESULT_PATH, json, "utf8");
}

function requireEqual(label: string, actual: unknown, expected: unknown) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function requireZero(label: string, actual: bigint) {
  if (actual !== 0n) throw new Error(`${label}: expected zero, got ${actual}`);
}

async function transactionRecord(
  action: Promise<{ wait(): Promise<any>; hash: string }>,
) {
  const transaction = await action;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error("Transaction receipt missing.");
  if (receipt.status !== 1n && receipt.status !== 1) {
    throw new Error(`Transaction ${receipt.hash} failed with status ${receipt.status}.`);
  }
  return {
    hash: receipt.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function confirmAfterReceipt<T>(
  label: string,
  receiptBlock: number,
  read: (blockTag?: number) => Promise<T>,
  matches: (value: T) => boolean,
) {
  const maxAttempts = 4;
  const attempts: Array<{ block: number | "latest"; value: T }> = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const latest = await ethers.provider.getBlockNumber();
    const block = attempt === 0 ? receiptBlock : Math.max(receiptBlock, latest);
    const value = await read(attempt === 0 ? receiptBlock : undefined);
    attempts.push({ block: attempt === 0 ? receiptBlock : "latest", value });
    if (matches(value)) {
      return {
        value,
        receiptBlock,
        readbackBlock: block,
        retries: attempt,
        provider: "configured BSC Testnet RPC",
      };
    }
    if (attempt + 1 < maxAttempts) await sleep(1_500 * (attempt + 1));
  }
  throw new Error(
    `${label} was not confirmed after ${maxAttempts} bounded RPC reads: ${JSON.stringify(
      attempts,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    )}`,
  );
}

const moduleIds = {
  AVSToken: await gateway.AVS_TOKEN_MODULE_ID(),
  AVSLedger: await gateway.LEDGER_MODULE_ID(),
  AVSVault: await gateway.VAULT_MODULE_ID(),
  AVSMarketplace: await gateway.MARKETPLACE_MODULE_ID(),
  AVSTradingSettlement: await gateway.TRADING_SETTLEMENT_MODULE_ID(),
  AccountPolicyMock: await gateway.ACCOUNT_POLICY_MODULE_ID(),
  migration: await gateway.MIGRATION_MODULE_ID(),
  AVSProtocolLens: await gateway.PROTOCOL_LENS_MODULE_ID(),
};
const expectedModules = {
  ...EXPECTED_ADDRESSES,
  migration: ZERO,
};
const discoveredModules: Record<string, string> = {};
for (const [name, moduleId] of Object.entries(moduleIds)) {
  const address = await gateway.moduleAddress(moduleId);
  const expected = expectedModules[name as keyof typeof expectedModules];
  requireEqual(`Gateway module ${name}`, address, expected);
  discoveredModules[name] = address;
}

const wiring = await lens.getWiringHealth();
if (!wiring.marketplaceAuthorized) {
  throw new Error("Lens reports Marketplace is not AVS-authorized.");
}
if (!wiring.allHealthy) throw new Error("Lens wiring health failed.");
requireEqual("Gateway chainId", await gateway.chainId(), 97n);
requireEqual("Gateway generation", await gateway.deploymentGeneration(), GENERATION);
requireEqual("Marketplace generation", await marketplace.DEPLOYMENT_GENERATION(), GENERATION);
requireEqual("Marketplace domain name", await marketplace.DOMAIN_NAME(), "AVS Marketplace");
requireEqual("Marketplace domain version", await marketplace.DOMAIN_VERSION(), "1");
requireZero("AVS totalSupply", await token.totalSupply());
requireZero("Ledger totalNetAssets", await ledger.totalNetAssets());
requireZero("Settlement count", await settlement.settlementCount());
requireZero("Order count", await marketplace.orderCount());
requireEqual("nextOrderId", await marketplace.nextOrderId(), 1n);
requireZero(
  "Gateway native balance",
  await ethers.provider.getBalance(EXPECTED_ADDRESSES.AVSGateway),
);
requireZero(
  "Gateway TestUSDT balance",
  await usdt.balanceOf(EXPECTED_ADDRESSES.AVSGateway),
);
requireZero(
  "Gateway AVS balance",
  await token.balanceOf(EXPECTED_ADDRESSES.AVSGateway),
);
requireEqual("Current NAV", await ledger.currentAVSValue(), SCALE);
requireEqual("Buyer fee BPS", await marketplace.BUYER_FEE_BPS(), 2n);
requireEqual("Vault allocation BPS", await vault.CAPITAL_ALLOCATION_BPS(), 500n);
requireEqual(
  "tradingDestination",
  await settlement.tradingDestination(),
  EXPECTED_TRADING_DESTINATION,
);
requireZero("Marketplace TestUSDT", await usdt.balanceOf(EXPECTED_ADDRESSES.AVSMarketplace));
requireZero("Vault TestUSDT", await usdt.balanceOf(EXPECTED_ADDRESSES.AVSVault));
requireZero(
  "Settlement TestUSDT",
  await usdt.balanceOf(EXPECTED_ADDRESSES.AVSTradingSettlement),
);
requireZero(
  "tradingDestination TestUSDT",
  await usdt.balanceOf(EXPECTED_TRADING_DESTINATION),
);
if (
  (await token.vaultLocked()) ||
  (await token.accountPolicyLocked()) ||
  (await vault.configurationLocked())
) {
  throw new Error("Unexpected irreversible lock before Phase 3A.");
}

const domainRead = await marketplace.eip712Domain();
requireEqual("EIP-712 domain chain", domainRead.chainId, 97n);
requireEqual(
  "EIP-712 verifying contract",
  domainRead.verifyingContract,
  EXPECTED_ADDRESSES.AVSMarketplace,
);

record.preflight = {
  block: await ethers.provider.getBlockNumber(),
  discoveredModules,
  wiringHealth: wiring,
  economicState: {
    totalSupply: "0",
    totalNetAssets: "0",
    currentAVSValue: SCALE.toString(),
    settlementCount: "0",
    orderCount: "0",
  },
  eip712Domain: {
    name: domainRead.name,
    version: domainRead.version,
    chainId: domainRead.chainId,
    verifyingContract: domainRead.verifyingContract,
  },
  gatewayBalances: { native: "0", testUSDT: "0", avs: "0" },
  sourceCalculation: {
    capital: CAPITAL,
    buyerFeeBps: "2",
    buyerFee: BUYER_FEE,
    userPayment: USER_PAYMENT,
    marketplaceAllocationBps: "500",
    marketplaceCapitalAllocation: MARKETPLACE_ALLOCATION,
    productiveCapital: PRODUCTIVE_CAPITAL,
    expectedMintedAVS: CAPITAL,
    expectedTotalNetAssets: USER_PAYMENT,
    expectedCurrentAVSValue: EXPECTED_NAV_AFTER,
  },
};
await persist();
console.log("PHASE3A_PREFLIGHT=PASS");

if (!(await token.isWhitelisted(ABANDONED_CANDIDATE))) {
  throw new Error("Abandoned candidate authorization was not independently confirmed.");
}
if (
  (await usdt.balanceOf(ABANDONED_CANDIDATE)) !== 0n ||
  (await usdt.allowance(ABANDONED_CANDIDATE, EXPECTED_ADDRESSES.AVSMarketplace)) !==
    0n ||
  (await usdt.allowance(ABANDONED_CANDIDATE, EXPECTED_ADDRESSES.AVSGateway)) !==
    0n ||
  (await token.balanceOf(ABANDONED_CANDIDATE)) !== 0n
) {
  throw new Error("Abandoned candidate has unexpected economic activity.");
}
const abandonedAuthorizationReceipt = await ethers.provider.getTransactionReceipt(
  ABANDONED_AUTHORIZATION_TX,
);
if (!abandonedAuthorizationReceipt || abandonedAuthorizationReceipt.status !== 1) {
  throw new Error("Abandoned candidate authorization receipt is unavailable or failed.");
}
const abandonedAuthorizationEvents = abandonedAuthorizationReceipt.logs
  .filter(
    (log) =>
      log.address.toLowerCase() === EXPECTED_ADDRESSES.AVSToken.toLowerCase(),
  )
  .map((log) => {
    try {
      return token.interface.parseLog(log);
    } catch {
      return null;
    }
  })
  .filter(
    (event) =>
      event?.name === "AccountAuthorized" &&
      String(event.args[0]).toLowerCase() === ABANDONED_CANDIDATE.toLowerCase(),
  );
if (abandonedAuthorizationEvents.length !== 1) {
  throw new Error("Abandoned candidate authorization event was not confirmed.");
}
record.abandonedCandidate.authorization = {
  transactionHash: ABANDONED_AUTHORIZATION_TX,
  receiptBlock: abandonedAuthorizationReceipt.blockNumber,
  readbackBlock: await ethers.provider.getBlockNumber(),
  resultingAuthorization: true,
  economicActivity: false,
};
await persist();

const testUser = Wallet.createRandom().connect(ethers.provider);
const testUserAddress = await testUser.getAddress();
const usdtAsTestUser = usdt.connect(testUser) as any;
const gatewayAsTestUser = gateway.connect(testUser) as any;
const prohibitedAddresses = new Set(
  [
    ...Object.values(EXPECTED_ADDRESSES),
    EXPECTED_TRADING_DESTINATION,
    checked.deployer,
  ].map((address) => address.toLowerCase()),
);
if (prohibitedAddresses.has(testUserAddress.toLowerCase())) {
  throw new Error("Generated test user collides with a protocol address.");
}
record.testUser = {
  address: testUserAddress,
  kind: "dedicated ephemeral EOA",
  privateKeyRecorded: false,
};
await persist();
console.log(`TEST_USER=${testUserAddress}`);

record.infrastructure.nativeFunding = await transactionRecord(
  admin.sendTransaction({ to: testUserAddress, value: USER_NATIVE_FUNDING }),
);
await persist();

const authorization = await transactionRecord(
  policy.authorizeAccount(testUserAddress),
);
const authorizationConfirmation = await confirmAfterReceipt(
  "Replacement authorization",
  authorization.block,
  (blockTag) =>
    blockTag === undefined
      ? token.isWhitelisted(testUserAddress)
      : token.isWhitelisted(testUserAddress, { blockTag }),
  (value) => value === true,
);
record.infrastructure.authorization = {
  required: true,
  ...authorization,
  ...authorizationConfirmation,
  resultingState: true,
};
await persist();

const testUsdtFunding = await transactionRecord(
  usdt.mint(testUserAddress, USER_PAYMENT),
);
const fundingConfirmation = await confirmAfterReceipt(
  "Replacement TestUSDT funding",
  testUsdtFunding.block,
  (blockTag) =>
    blockTag === undefined
      ? usdt.balanceOf(testUserAddress)
      : usdt.balanceOf(testUserAddress, { blockTag }),
  (value) => value === USER_PAYMENT,
);
record.infrastructure.testUsdtFunding = {
  ...testUsdtFunding,
  ...fundingConfirmation,
  resultingBalance: USER_PAYMENT,
};
await persist();

record.infrastructure.marketplaceApproval = await transactionRecord(
  usdtAsTestUser.approve(EXPECTED_ADDRESSES.AVSMarketplace, USER_PAYMENT),
);
const approvalConfirmation = await confirmAfterReceipt(
  "Replacement Marketplace allowance",
  record.infrastructure.marketplaceApproval.block,
  async (blockTag) => {
    const options = blockTag === undefined ? {} : { blockTag };
    return {
      marketplace: await usdt.allowance(
        testUserAddress,
        EXPECTED_ADDRESSES.AVSMarketplace,
        options,
      ),
      gateway: await usdt.allowance(
        testUserAddress,
        EXPECTED_ADDRESSES.AVSGateway,
        options,
      ),
    };
  },
  (value) => value.marketplace >= USER_PAYMENT && value.gateway === 0n,
);
const marketplaceAllowance = approvalConfirmation.value.marketplace;
const gatewayAllowance = approvalConfirmation.value.gateway;
record.infrastructure.allowancesBeforeExecution = {
  marketplace: marketplaceAllowance,
  gateway: gatewayAllowance,
};
record.infrastructure.approvalConfirmation = approvalConfirmation;
await persist();

const intentNonce = 1n;
if (await marketplace.isNonceUsed(testUserAddress, intentNonce)) {
  throw new Error("Selected nonce is already used.");
}
const latestBlock = await ethers.provider.getBlock("latest");
if (!latestBlock) throw new Error("Latest BSC Testnet block unavailable.");
const deadline = BigInt(latestBlock.timestamp + 3_600);
const intent = {
  owner: testUserAddress,
  beneficiary: testUserAddress,
  quantityAVS: CAPITAL,
  requestedMaxMatches: 1n,
  nonce: intentNonce,
  deadline,
  deploymentGeneration: GENERATION,
};
const domain = {
  name: "AVS Marketplace",
  version: "1",
  chainId: 97n,
  verifyingContract: EXPECTED_ADDRESSES.AVSMarketplace,
};
const structHash = ethers.TypedDataEncoder.hashStruct(
  "MarketBuyIntent",
  marketBuyTypes,
  intent,
);
const typedDataDigest = ethers.TypedDataEncoder.hash(
  domain,
  marketBuyTypes,
  intent,
);
const signature = await testUser.signTypedData(domain, marketBuyTypes, intent);
const recoveredSigner = ethers.verifyTypedData(
  domain,
  marketBuyTypes,
  intent,
  signature,
);
requireEqual("Recovered signer", recoveredSigner, testUserAddress);
record.signedIntent = {
  domain,
  intent,
  structHash,
  typedDataDigest,
  recoveredSigner,
  signatureRecorded: false,
};
await persist();

const economicBeforeBlock = await ethers.provider.getBlockNumber();
const before = {
  block: economicBeforeBlock,
  userTestUSDT: await usdt.balanceOf(testUserAddress),
  userAVS: await token.balanceOf(testUserAddress),
  totalSupply: await token.totalSupply(),
  totalNetAssets: await ledger.totalNetAssets(),
  currentAVSValue: await ledger.currentAVSValue(),
  marketplaceTestUSDT: await usdt.balanceOf(EXPECTED_ADDRESSES.AVSMarketplace),
  vaultTestUSDT: await usdt.balanceOf(EXPECTED_ADDRESSES.AVSVault),
  settlementTestUSDT: await usdt.balanceOf(
    EXPECTED_ADDRESSES.AVSTradingSettlement,
  ),
  tradingDestinationTestUSDT: await usdt.balanceOf(
    EXPECTED_TRADING_DESTINATION,
  ),
  protocolRevenue: await marketplace.totalFeesCollected(),
  totalGrossProfit: await ledger.totalGrossProfit(),
  totalLoss: await ledger.totalLoss(),
  totalBuybackAllocated: await ledger.totalBuybackAllocated(),
  settlementCount: await settlement.settlementCount(),
  orderCount: await marketplace.orderCount(),
  nonceCount: await marketplace.nonces(testUserAddress),
  nonceUsed: await marketplace.isNonceUsed(testUserAddress, intentNonce),
};

record.stage = "submitting_one_gateway_buy";
await persist();
const economicTransaction =
  await gatewayAsTestUser.placeMarketBuyWithSignature(intent, signature);
const economicReceipt = await economicTransaction.wait();
if (!economicReceipt) throw new Error("Gateway buy receipt missing.");

const parsers = new Map(
  [
    ["TestUSDT", usdt],
    ["AVSToken", token],
    ["AVSLedger", ledger],
    ["AVSVault", vault],
    ["AVSTradingSettlement", settlement],
    ["AVSMarketplace", marketplace],
  ].map(([name, contract]: any[]) => [
    String(contract.target).toLowerCase(),
    { name, interface: contract.interface },
  ]),
);
const events: any[] = [];
for (const log of economicReceipt.logs) {
  const parser = parsers.get(log.address.toLowerCase());
  if (!parser) continue;
  try {
    const parsed = parser.interface.parseLog(log);
    if (!parsed) continue;
    events.push({
      logIndex: log.index,
      contract: parser.name,
      event: parsed.name,
      arguments: Object.fromEntries(
        parsed.fragment.inputs.map((input: any, index: number) => [
          input.name || String(index),
          parsed.args[index],
        ]),
      ),
    });
  } catch {
    // A contract may emit an inherited event absent from another parser.
  }
}
const eventNames = new Set(events.map((event) => event.event));
for (const requiredEvent of [
  "OrderCreated",
  "CapitalInflowRecorded",
  "CapitalAllocated",
  "ProductiveCapitalForwarded",
  "PrimaryIssuanceExecuted",
  "MarketplaceFeeCollected",
  "OrderFilled",
]) {
  if (!eventNames.has(requiredEvent)) {
    throw new Error(`Required event ${requiredEvent} missing.`);
  }
}
const pulledFromUser = events.find(
  (event) =>
    event.contract === "TestUSDT" &&
    event.event === "Transfer" &&
    String(event.arguments.from).toLowerCase() ===
      testUserAddress.toLowerCase() &&
    String(event.arguments.to).toLowerCase() ===
      EXPECTED_ADDRESSES.AVSMarketplace.toLowerCase() &&
    BigInt(event.arguments.value) === USER_PAYMENT,
);
if (!pulledFromUser) {
  throw new Error("Marketplace did not pull the exact payment from the user.");
}

const certificationBlock = economicReceipt.blockNumber;
const certificationHeader = await ethers.provider.getBlock(certificationBlock);
if (!certificationHeader) throw new Error("Certification block unavailable.");
const blockTag = { blockTag: certificationBlock };
const after = {
  block: certificationBlock,
  blockTimestamp: certificationHeader.timestamp,
  userTestUSDT: await usdt.balanceOf(testUserAddress, blockTag),
  userAVS: await token.balanceOf(testUserAddress, blockTag),
  totalSupply: await token.totalSupply(blockTag),
  totalNetAssets: await ledger.totalNetAssets(blockTag),
  currentAVSValue: await ledger.currentAVSValue(blockTag),
  marketplaceTestUSDT: await usdt.balanceOf(
    EXPECTED_ADDRESSES.AVSMarketplace,
    blockTag,
  ),
  vaultTestUSDT: await usdt.balanceOf(EXPECTED_ADDRESSES.AVSVault, blockTag),
  settlementTestUSDT: await usdt.balanceOf(
    EXPECTED_ADDRESSES.AVSTradingSettlement,
    blockTag,
  ),
  tradingDestinationTestUSDT: await usdt.balanceOf(
    EXPECTED_TRADING_DESTINATION,
    blockTag,
  ),
  protocolRevenue: await marketplace.totalFeesCollected(blockTag),
  protocolLiquidityUSDT: await marketplace.protocolLiquidityUSDT(blockTag),
  totalGrossProfit: await ledger.totalGrossProfit(blockTag),
  totalLoss: await ledger.totalLoss(blockTag),
  totalBuybackAllocated: await ledger.totalBuybackAllocated(blockTag),
  settlementCount: await settlement.settlementCount(blockTag),
  orderCount: await marketplace.orderCount(blockTag),
  nonceCount: await marketplace.nonces(testUserAddress, blockTag),
  nonceUsed: await marketplace.isNonceUsed(
    testUserAddress,
    intentNonce,
    blockTag,
  ),
  marketplaceAllowance: await usdt.allowance(
    testUserAddress,
    EXPECTED_ADDRESSES.AVSMarketplace,
    blockTag,
  ),
  gatewayAllowance: await usdt.allowance(
    testUserAddress,
    EXPECTED_ADDRESSES.AVSGateway,
    blockTag,
  ),
  gatewayNative: await ethers.provider.getBalance(
    EXPECTED_ADDRESSES.AVSGateway,
    certificationBlock,
  ),
  gatewayTestUSDT: await usdt.balanceOf(
    EXPECTED_ADDRESSES.AVSGateway,
    blockTag,
  ),
  gatewayAVS: await token.balanceOf(EXPECTED_ADDRESSES.AVSGateway, blockTag),
};

requireEqual("User TestUSDT after", after.userTestUSDT, 0n);
requireEqual("User AVS after", after.userAVS, CAPITAL);
requireEqual("AVS totalSupply after", after.totalSupply, CAPITAL);
requireEqual("Ledger totalNetAssets after", after.totalNetAssets, USER_PAYMENT);
requireEqual("Current AVS value after", after.currentAVSValue, EXPECTED_NAV_AFTER);
requireEqual(
  "Marketplace TestUSDT after",
  after.marketplaceTestUSDT,
  MARKETPLACE_ALLOCATION + BUYER_FEE,
);
requireZero("Vault TestUSDT after", after.vaultTestUSDT);
requireZero("Settlement TestUSDT after", after.settlementTestUSDT);
requireEqual(
  "tradingDestination delta",
  after.tradingDestinationTestUSDT - before.tradingDestinationTestUSDT,
  PRODUCTIVE_CAPITAL,
);
requireEqual("Protocol Revenue after", after.protocolRevenue, BUYER_FEE);
requireEqual(
  "Marketplace protocol liquidity after",
  after.protocolLiquidityUSDT,
  MARKETPLACE_ALLOCATION + BUYER_FEE,
);
requireZero("Trading gross profit", after.totalGrossProfit);
requireZero("Trading loss", after.totalLoss);
requireZero("Buyback allocation", after.totalBuybackAllocated);
requireZero("Settlement count after", after.settlementCount);
requireEqual("Order count after", after.orderCount, 1n);
requireEqual("Nonce count after", after.nonceCount, 1n);
if (!after.nonceUsed) throw new Error("Intent nonce was not consumed.");
requireZero("Marketplace allowance after", after.marketplaceAllowance);
requireZero("Gateway allowance after", after.gatewayAllowance);
requireZero("Gateway native after", after.gatewayNative);
requireZero("Gateway TestUSDT after", after.gatewayTestUSDT);
requireZero("Gateway AVS after", after.gatewayAVS);

const order = await marketplace.orders(1n, blockTag);
requireEqual("Order owner", order.owner, testUserAddress);
requireEqual("Order beneficiary", order.beneficiary, testUserAddress);
requireEqual("Order status", order.status, 1n);
requireZero("Order remaining AVS", order.remainingAVS);
requireZero("Order remaining TestUSDT", order.remainingUSDT);

record.submission = {
  transactionHash: economicReceipt.hash,
  transactionSender: testUserAddress,
  signedOwner: intent.owner,
  beneficiary: intent.beneficiary,
  nonce: intent.nonce,
  deadline: intent.deadline,
  block: certificationBlock,
  blockTimestamp: certificationHeader.timestamp,
  gasUsed: economicReceipt.gasUsed,
  orderId: "1",
  orderOutcome: {
    status: "Filled",
    remainingAVS: order.remainingAVS,
    remainingUSDT: order.remainingUSDT,
  },
  events,
};
record.constraints.successfulEconomicBuys = 1;
record.postState = { before, after };
await persist();

let replayResult: any;
try {
  await gatewayAsTestUser.placeMarketBuyWithSignature.staticCall(
    intent,
    signature,
  );
  throw new Error("Replay unexpectedly succeeded.");
} catch (error: any) {
  const data =
    error?.data ?? error?.error?.data ?? error?.info?.error?.data ?? null;
  if (!data || typeof data !== "string") {
    throw new Error("Replay reverted without decodable revert data.");
  }
  const parsed = marketplace.interface.parseError(data);
  if (!parsed || parsed.name !== "NonceAlreadyUsed") {
    throw new Error(`Unexpected replay revert: ${parsed?.name ?? data.slice(0, 10)}`);
  }
  replayResult = {
    method: "eth_call/staticCall",
    reverted: true,
    customError: parsed.name,
    selector: data.slice(0, 10),
    arguments: {
      account: parsed.args[0],
      nonce: parsed.args[1],
    },
  };
}
const afterReplay = {
  totalSupply: await token.totalSupply(),
  totalNetAssets: await ledger.totalNetAssets(),
  currentAVSValue: await ledger.currentAVSValue(),
  marketplaceTestUSDT: await usdt.balanceOf(EXPECTED_ADDRESSES.AVSMarketplace),
  destinationTestUSDT: await usdt.balanceOf(EXPECTED_TRADING_DESTINATION),
  orderCount: await marketplace.orderCount(),
  settlementCount: await settlement.settlementCount(),
};
requireEqual("Replay totalSupply", afterReplay.totalSupply, after.totalSupply);
requireEqual(
  "Replay totalNetAssets",
  afterReplay.totalNetAssets,
  after.totalNetAssets,
);
requireEqual(
  "Replay currentAVSValue",
  afterReplay.currentAVSValue,
  after.currentAVSValue,
);
requireEqual(
  "Replay Marketplace balance",
  afterReplay.marketplaceTestUSDT,
  after.marketplaceTestUSDT,
);
requireEqual(
  "Replay destination balance",
  afterReplay.destinationTestUSDT,
  after.tradingDestinationTestUSDT,
);
requireEqual("Replay orderCount", afterReplay.orderCount, after.orderCount);
requireEqual(
  "Replay settlementCount",
  afterReplay.settlementCount,
  after.settlementCount,
);
record.replayTest = { ...replayResult, stateAfterReplay: afterReplay };

const gatewayProtocol = await gateway.getProtocolSnapshot(blockTag);
const gatewayUser = await gateway.getUserSnapshot(testUserAddress, blockTag);
const gatewayMarketplace = await gateway.getMarketplaceSnapshot(blockTag);
const userOrders = await gateway.getUserOrderIds(
  testUserAddress,
  0,
  100,
  true,
  blockTag,
);
const globalOrders = await gateway.getOrderIds(0, 100, true, blockTag);
const settlementPagination = await gateway.getSettlementSummaries(
  0,
  100,
  blockTag,
);
requireEqual(
  "Gateway protocol totalSupply",
  gatewayProtocol.totalSupply,
  after.totalSupply,
);
requireEqual(
  "Gateway protocol totalNetAssets",
  gatewayProtocol.totalNetAssets,
  after.totalNetAssets,
);
requireEqual(
  "Gateway protocol NAV",
  gatewayProtocol.currentNAV,
  after.currentAVSValue,
);
requireEqual("Gateway user AVS", gatewayUser.avsBalance, after.userAVS);
requireEqual(
  "Gateway Marketplace liquidity",
  gatewayMarketplace.protocolLiquidityUSDT,
  after.protocolLiquidityUSDT,
);
if (
  userOrders.length !== 1 ||
  userOrders[0] !== 1n ||
  globalOrders.length !== 1 ||
  globalOrders[0] !== 1n ||
  settlementPagination.length !== 0
) {
  throw new Error("Gateway pagination does not match canonical state.");
}

record.gatewayReadback = {
  certificationBlock,
  certificationBlockTimestamp: certificationHeader.timestamp,
  deploymentGeneration: GENERATION,
  protocolSnapshot: gatewayProtocol,
  userSnapshot: gatewayUser,
  marketplaceSnapshot: gatewayMarketplace,
  userOrders,
  globalOrders,
  settlementPagination,
};
record.reconciliation = {
  capitalContribution: CAPITAL,
  buyerFee: BUYER_FEE,
  userPayment: USER_PAYMENT,
  avsMinted: after.userAVS - before.userAVS,
  marketplaceCapitalAllocation: MARKETPLACE_ALLOCATION,
  productiveCapital:
    after.tradingDestinationTestUSDT - before.tradingDestinationTestUSDT,
  protocolRevenue: after.protocolRevenue - before.protocolRevenue,
  totalNetAssets: after.totalNetAssets,
  avsValue: after.currentAVSValue,
  capitalCountedAsTradingProfit: false,
  buyerFeeCountedAsTradingProfit: false,
  buyerFeeRecordedAsProtocolRevenue: true,
  totalGrossProfit: after.totalGrossProfit,
  totalLoss: after.totalLoss,
  totalBuybackAllocated: after.totalBuybackAllocated,
  settlementCount: after.settlementCount,
  discrepancy: null,
};
record.constraints = {
  successfulEconomicBuys: 1,
  routedThroughAVSGateway: true,
  marketplaceVerifiedSignedUser: true,
  gatewayHeldUserAssets: false,
  replayRejected: true,
  directMarketplaceBuy: false,
  triggeredOrder: false,
  sell: false,
  secondaryMatch: false,
  tradingSettlementSubmitted: false,
  settlementRolesConfigured: false,
  migrationExecuted: false,
  configurationLocked: false,
  ownershipRenounced: false,
  mainnetInteraction: false,
  commit: false,
  push: false,
};
record.stage = "pass";
await persist();

console.log("PHASE_3A_FIRST_REAL_GATEWAY_FINANCIAL_CYCLE=PASS");
console.log(`TEST_USER=${testUserAddress}`);
console.log(`AUTHORIZATION_TX=${record.infrastructure.authorization.hash}`);
console.log(`TEST_USDT_FUNDING_TX=${record.infrastructure.testUsdtFunding.hash}`);
console.log(`MARKETPLACE_APPROVAL_TX=${record.infrastructure.marketplaceApproval.hash}`);
console.log(`GATEWAY_BUY_TX=${economicReceipt.hash}`);
console.log(`CERTIFICATION_BLOCK=${certificationBlock}`);
console.log(`GAS_USED=${economicReceipt.gasUsed}`);
console.log("SUCCESSFUL_ECONOMIC_BUYS=1");
console.log("REPLAY_REJECTED=true");
console.log("GATEWAY_CUSTODY=false");
console.log("TRADING_SETTLEMENT_SUBMITTED=false");
console.log("MIGRATION_EXECUTED=false");
console.log("LOCKS_EXECUTED=false");
console.log("OWNERSHIP_RENOUNCED=false");
console.log("MAINNET_INTERACTION=false");
console.log("COMMIT=false");
console.log("PUSH=false");
console.log(`RESULT_PATH=${RESULT_PATH}`);
console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);