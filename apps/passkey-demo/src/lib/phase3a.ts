import {
  AbiCoder,
  BrowserProvider,
  Contract,
  Interface,
  concat,
  formatEther,
  getAddress,
  getBytes,
  hexlify,
  id,
  keccak256,
  parseEther,
  sha256,
  toBeHex,
  toUtf8Bytes,
  zeroPadValue,
} from "ethers";

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[] | object;
      }) => Promise<unknown>;
      isMetaMask?: boolean;
      providers?: Array<{
        request: (args: {
          method: string;
          params?: unknown[] | object;
        }) => Promise<unknown>;
        isMetaMask?: boolean;
      }>;
    };
  }
}

export type CredentialRole = "transaction" | "recovery" | "evolution";

export type PasskeyMaterial = {
  role: CredentialRole;
  credentialId: string;
  credentialIdBytes: Uint8Array;
  qx: string;
  qy: string;
};

export type PasskeySet = {
  transaction: PasskeyMaterial;
  recovery: PasskeyMaterial;
  evolution: PasskeyMaterial;
};

export type AccountFlowDebug = {
  walletConnected: "YES" | "NO";
  walletAddress: string;
  chainId: string;
  tBNBBalance: string;
  factoryAddress: string;
  authorityAddress: string;
  controllerAddress: string;
  userSalt: string;
  rpIdHash: string;
  predictedAddress: string;
  estimateGas: string;
  sendTransactionStatus: string;
  txHash: string;
  receiptStatus: string;
};

export type AccountDeployment = {
  predictedAddress: string;
  deployedAddress: string;
  account: string;
  authority: string;
  evolutionController: string;
  rpIdHash: string;
  userSalt: string;
  chainId: bigint;
  status: "PASS";
  debug: AccountFlowDebug;
};

export type OperationResult = {
  userOpHash: string;
  transactionHash: string;
  receiverEventFound: boolean;
  modifiedTargetRejected: boolean;
  modifiedCalldataRejected: boolean;
  modifiedValueRejected: boolean;
  modifiedNonceRejected: boolean;
  replayRejected: boolean;
  directEoaExecutionRejected: boolean;
};

export type EvolutionResult = {
  requestId: string;
  requestTransactionHash: string;
  cancelTransactionHash: string;
  executableAt: string;
  earlyFinalizationRejected: boolean;
  unauthorizedCancellationRejected: boolean;
  authorizedCancellationSucceeded: boolean;
  canceledRequestFinalizationRejected: boolean;
};

export const BSC_TESTNET_CHAIN_ID = 97n;
export const ENTRYPOINT_V08_ADDRESS =
  "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
export const LEGACY_PHASE2_FACTORY_ADDRESS =
  "0x4EA3e3BEC6DC92e5fFB3275DF377e0792EeD7AdD";
export const PHASE3A_FACTORY_ADDRESS =
  "0xe01DAafEcA3e1F63d5528F66facb175169add04e";

const INITIALIZATION_TUPLE =
  "((bytes32,bytes32),(bytes32,bytes32),(bytes32,bytes32),bytes32,address,bytes32,address,bytes32,uint64)";
const UPGRADE_TUPLE = "(address,bytes32,uint64,uint48,uint48,bytes32)";

const FACTORY_ABI = [
  "function authority() view returns (address)",
  "function evolutionController() view returns (address)",
  "function entryPoint() view returns (address)",
  "function predictAccount(bytes32 transactionKeyX,bytes32 transactionKeyY,bytes32 userSalt) view returns (address)",
  `function createAccount(${INITIALIZATION_TUPLE} initialization,bytes creationSignature) returns (address)`,
];
const AUTHORITY_ABI = [
  `function getCreationDigest(address account,${INITIALIZATION_TUPLE} initialization) view returns (bytes32)`,
  "function transactionKey(address account) view returns (bytes32 qx,bytes32 qy)",
  "function recoveryKey(address account) view returns (bytes32 qx,bytes32 qy)",
  "function evolutionKey(address account) view returns (bytes32 qx,bytes32 qy)",
  "function rpIdHash(address account) view returns (bytes32)",
];
const CONTROLLER_ABI = [
  `function getUpgradeDigest(address account,${UPGRADE_TUPLE} request) view returns (bytes32)`,
  "function getCancellationDigest(address account,bytes32 requestId) view returns (bytes32)",
  "function pendingUpgrade(address account) view returns (address implementation,bytes32 codehash,uint64 standardVersion,uint48 requestedAt,uint48 executableAt,uint48 deadline,bytes32 requestId,uint256 nonce)",
  "function finalizeUpgrade(address account)",
  "function cancelUpgrade(address account,bytes32 requestId,bytes transactionSignature)",
];
const ACCOUNT_ABI = [
  "function execute(bytes32 mode,bytes executionData)",
  `function requestUpgrade(${UPGRADE_TUPLE} request,bytes transactionSignature,bytes evolutionSignature)`,
  "function cancelUpgrade(bytes32 requestId,bytes transactionSignature)",
  "function authority() view returns (address)",
  "function evolutionController() view returns (address)",
  "function entryPoint() view returns (address)",
];
const ENTRYPOINT_ABI = [
  "function getNonce(address sender,uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address payable beneficiary)",
];
const RECEIVER_ABI = [
  "function emitTest(bytes data)",
  "event TestExecuted(address indexed account,uint256 value,bytes data)",
];

const config = {
  factory: PHASE3A_FACTORY_ADDRESS,
  receiver:
    import.meta.env.VITE_RECEIVER_ADDRESS ??
    "0x3d0d55295e81aA282688031f604A1B37E70009Ef",
  initialImplementation:
    import.meta.env.VITE_INITIAL_IMPLEMENTATION_ADDRESS ??
    "0x4e68BE79A7ec63De4FB9abD84Addbc87AecC8AC5",
  nextImplementation:
    import.meta.env.VITE_NEXT_IMPLEMENTATION_ADDRESS ??
    "0x0ed2097B83F91D25005c0892b6Ee32d4bBD43dE3",
  userSalt: import.meta.env.VITE_USER_SALT ?? "alpha-prime-phase3a-passkey-demo",
  chainId: BigInt(import.meta.env.VITE_CHAIN_ID ?? "97"),
};

export const DEMO_CHAIN_ID = config.chainId;
export const DEMO_NETWORK_NAME =
  import.meta.env.VITE_NETWORK_NAME ?? "BSC Testnet";
export const DEMO_FACTORY_ADDRESS = config.factory;

const BSC_TESTNET_PARAMS = {
  chainId: "0x61",
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};
const ABI_CODER = AbiCoder.defaultAbiCoder();
const ACCOUNT_INTERFACE = new Interface(ACCOUNT_ABI);
const RECEIVER_INTERFACE = new Interface(RECEIVER_ABI);
const EXECUTE_MODE =
  "0x0100000000000000000000000000000000000000000000000000000000000000";
const MIN_ACCOUNT_PREFUND = parseEther("0.01");

type InjectedProvider = NonNullable<typeof window.ethereum>;
type PackedUserOperation = {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
};

const requireAddress = (label: string, value: string): string => {
  if (!value) throw new Error(`${label} is not configured.`);
  return getAddress(value);
};

const requirePhase3aFactory = (): string => {
  const factoryAddress = requireAddress("Phase 3A Factory", config.factory);
  if (factoryAddress.toLowerCase() === LEGACY_PHASE2_FACTORY_ADDRESS.toLowerCase()) {
    throw new Error(
      "Refusing to use the legacy Phase 2 AVSAccountFactory. Open the Phase 3A artifact.",
    );
  }
  return factoryAddress;
};

const base64UrlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

const extractP256Coordinates = (
  spki: ArrayBuffer,
): { qx: string; qy: string } => {
  const bytes = new Uint8Array(spki);
  for (let offset = bytes.length - 65; offset >= 0; offset -= 1) {
    if (bytes[offset] !== 0x04 || offset + 65 > bytes.length) continue;
    return {
      qx: bytesToHex(bytes.slice(offset + 1, offset + 33)),
      qy: bytesToHex(bytes.slice(offset + 33, offset + 65)),
    };
  }
  throw new Error("The authenticator did not expose an uncompressed P-256 key.");
};

const getInjectedProvider = (): InjectedProvider => {
  if (!window.ethereum) {
    throw new Error("Install or connect an injected EVM wallet first.");
  }
  const candidates = window.ethereum.providers ?? [window.ethereum];
  return candidates.find((candidate) => candidate.isMetaMask) ?? candidates[0];
};

const connectWallet = async () => {
  const injected = getInjectedProvider();
  const accounts = await injected.request({
    method: "eth_requestAccounts",
    params: [],
  });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("The wallet returned no account.");
  }
  const provider = new BrowserProvider(injected);
  let chainId = (await provider.getNetwork()).chainId;
  if (chainId !== config.chainId && config.chainId === BSC_TESTNET_CHAIN_ID) {
    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BSC_TESTNET_PARAMS.chainId }],
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: number }).code
          : undefined;
      if (code !== 4902) throw error;
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [BSC_TESTNET_PARAMS],
      });
    }
    chainId = (await provider.getNetwork()).chainId;
  }
  if (chainId !== config.chainId) {
    throw new Error(`Expected chain ${config.chainId}, connected to ${chainId}.`);
  }
  const signer = await provider.getSigner();
  return { provider, signer, chainId, walletAddress: await signer.getAddress() };
};

function parseDerSignature(signature: Uint8Array): {
  r: string;
  s: string;
} {
  if (signature[0] !== 0x30) throw new Error("WebAuthn signature is not DER.");
  let cursor = 2;
  if (signature[cursor] === 0x81) cursor += 1;
  if (signature[cursor] === 0x82) cursor += 2;
  if (signature[cursor++] !== 0x02) throw new Error("DER r is missing.");
  const rLength = signature[cursor++];
  const rBytes = signature.slice(cursor, cursor + rLength);
  cursor += rLength;
  if (signature[cursor++] !== 0x02) throw new Error("DER s is missing.");
  const sLength = signature[cursor++];
  const sBytes = signature.slice(cursor, cursor + sLength);
  const normalize = (value: Uint8Array): string =>
    zeroPadValue(hexlify(value[0] === 0 ? value.slice(1) : value), 32);
  const curveOrder =
    0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const rawS = BigInt(normalize(sBytes));
  const lowS = rawS > curveOrder / 2n ? curveOrder - rawS : rawS;
  return { r: normalize(rBytes), s: zeroPadValue(toBeHex(lowS), 32) };
}

const encodeAssertion = (
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  derSignature: Uint8Array,
): string => {
  const clientData = new TextDecoder().decode(clientDataJSON);
  const challengeIndex = clientData.indexOf('"challenge":"');
  const typeIndex = clientData.indexOf('"type":"webauthn.get"');
  if (challengeIndex < 0 || typeIndex < 0) {
    throw new Error("Unexpected clientDataJSON layout.");
  }
  const { r, s } = parseDerSignature(derSignature);
  return ABI_CODER.encode(
    ["bytes32", "bytes32", "uint256", "uint256", "bytes", "string"],
    [r, s, challengeIndex, typeIndex, authenticatorData, clientData],
  );
};

const signDigest = async (
  passkey: PasskeyMaterial,
  digest: string,
): Promise<string> => {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: getBytes(digest) as unknown as BufferSource,
      rpId: window.location.hostname,
      allowCredentials: [
        {
          id: passkey.credentialIdBytes as unknown as BufferSource,
          type: "public-key",
        },
      ],
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("The Passkey assertion was cancelled.");
  const response = credential.response as AuthenticatorAssertionResponse;
  return encodeAssertion(
    new Uint8Array(response.authenticatorData),
    new Uint8Array(response.clientDataJSON),
    new Uint8Array(response.signature),
  );
};

export async function createBrowserPasskey(
  role: CredentialRole,
): Promise<PasskeyMaterial> {
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    throw new Error("WebAuthn requires HTTPS or localhost.");
  }
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: window.location.hostname, name: "Alpha Prime Phase 3A" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: `alpha-prime-${role}-${Date.now()}`,
        displayName: `Alpha Prime ${role} credential`,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 120_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error(`${role} credential creation was cancelled.`);
  const response = credential.response as AuthenticatorAttestationResponse & {
    getPublicKey?: () => ArrayBuffer | null;
  };
  const publicKey = response.getPublicKey?.();
  if (!publicKey) throw new Error("The browser did not expose the P-256 key.");
  return {
    role,
    credentialId: base64UrlEncode(new Uint8Array(credential.rawId)),
    credentialIdBytes: new Uint8Array(credential.rawId),
    ...extractP256Coordinates(publicKey),
  };
}

const publicKeyTuple = (passkey: PasskeyMaterial) => [
  passkey.qx,
  passkey.qy,
];

export async function createAvsAccount(
  passkeys: PasskeySet,
): Promise<AccountDeployment> {
  const factoryAddress = requirePhase3aFactory();
  const initialImplementation = requireAddress(
    "Initial implementation",
    config.initialImplementation,
  );
  const { provider, signer, chainId, walletAddress } = await connectWallet();
  const factory = new Contract(factoryAddress, FACTORY_ABI, signer);
  const authorityAddress = getAddress(await factory.authority());
  const controllerAddress = getAddress(await factory.evolutionController());
  if (getAddress(await factory.entryPoint()) !== ENTRYPOINT_V08_ADDRESS) {
    throw new Error("Factory EntryPoint binding is not canonical v0.8.");
  }
  const userSalt = id(config.userSalt);
  const rpIdHash = sha256(toUtf8Bytes(window.location.hostname));
  const initialCode = await provider.getCode(initialImplementation);
  if (initialCode === "0x") throw new Error("Initial implementation has no code.");
  const initialCodehash = keccak256(initialCode);
  const initialization = [
    publicKeyTuple(passkeys.transaction),
    publicKeyTuple(passkeys.recovery),
    publicKeyTuple(passkeys.evolution),
    rpIdHash,
    factoryAddress,
    userSalt,
    initialImplementation,
    initialCodehash,
    1,
  ];
  const predictedAddress = getAddress(
    await factory.predictAccount(
      passkeys.transaction.qx,
      passkeys.transaction.qy,
      userSalt,
    ),
  );
  const authority = new Contract(authorityAddress, AUTHORITY_ABI, signer);
  const creationDigest = await authority.getCreationDigest(
    predictedAddress,
    initialization,
  );
  const creationSignature = await signDigest(
    passkeys.transaction,
    creationDigest,
  );
  const walletBalance = await provider.getBalance(walletAddress);
  const debug: AccountFlowDebug = {
    walletConnected: "YES",
    walletAddress: getAddress(walletAddress),
    chainId: chainId.toString(),
    tBNBBalance: `${formatEther(walletBalance)} tBNB`,
    factoryAddress,
    authorityAddress,
    controllerAddress,
    userSalt,
    rpIdHash,
    predictedAddress,
    estimateGas: "pending",
    sendTransactionStatus: "pending",
    txHash: "pending",
    receiptStatus: "pending",
  };
  const simulated = getAddress(
    await factory.createAccount.staticCall(initialization, creationSignature),
  );
  if (simulated !== predictedAddress) {
    throw new AccountFlowError("Factory simulation changed the predicted address.", debug);
  }
  const gas = await factory.createAccount.estimateGas(
    initialization,
    creationSignature,
  );
  debug.estimateGas = gas.toString();
  const tx = await factory.createAccount(initialization, creationSignature);
  debug.sendTransactionStatus = "broadcast";
  debug.txHash = tx.hash;
  const receipt = await tx.wait();
  debug.receiptStatus = String(receipt?.status ?? "unknown");
  if (!receipt || receipt.status !== 1) {
    throw new AccountFlowError("Account creation reverted.", debug);
  }
  if ((await provider.getCode(predictedAddress)) === "0x") {
    throw new AccountFlowError("No code exists at the predicted address.", debug);
  }
  const account = new Contract(predictedAddress, ACCOUNT_ABI, signer);
  if (
    getAddress(await account.authority()) !== authorityAddress ||
    getAddress(await account.evolutionController()) !== controllerAddress ||
    getAddress(await account.entryPoint()) !== ENTRYPOINT_V08_ADDRESS
  ) {
    throw new AccountFlowError("Kernel immutable bindings are incorrect.", debug);
  }
  const expectedKeys = [
    ["transaction", passkeys.transaction, await authority.transactionKey(predictedAddress)],
    ["recovery", passkeys.recovery, await authority.recoveryKey(predictedAddress)],
    ["evolution", passkeys.evolution, await authority.evolutionKey(predictedAddress)],
  ] as const;
  for (const [role, expected, actual] of expectedKeys) {
    if (actual[0] !== expected.qx || actual[1] !== expected.qy) {
      throw new AccountFlowError(`${role} key was registered incorrectly.`, debug);
    }
  }
  if ((await authority.rpIdHash(predictedAddress)) !== rpIdHash) {
    throw new AccountFlowError("RP-ID hash was registered incorrectly.", debug);
  }
  const accountBalance = await provider.getBalance(predictedAddress);
  if (accountBalance < MIN_ACCOUNT_PREFUND) {
    const funding = await signer.sendTransaction({
      to: predictedAddress,
      value: MIN_ACCOUNT_PREFUND - accountBalance,
    });
    await funding.wait();
    debug.sendTransactionStatus = "created and prefunded";
  }
  return {
    predictedAddress,
    deployedAddress: predictedAddress,
    account: predictedAddress,
    authority: authorityAddress,
    evolutionController: controllerAddress,
    rpIdHash,
    userSalt,
    chainId,
    status: "PASS",
    debug,
  };
}

const packUint128Pair = (first: bigint, second: bigint): string =>
  concat([
    zeroPadValue(toBeHex(first), 16),
    zeroPadValue(toBeHex(second), 16),
  ]);

const encodeExecution = (
  target: string,
  value: bigint,
  callData: string,
): string =>
  ABI_CODER.encode(
    ["tuple(address target,uint256 value,bytes callData)[]"],
    [[{ target, value, callData }]],
  );

const buildUserOperation = async (
  entryPoint: Contract,
  account: string,
  callData: string,
): Promise<PackedUserOperation> => ({
  sender: account,
  nonce: await entryPoint.getNonce(account, 0),
  initCode: "0x",
  callData,
  accountGasLimits: packUint128Pair(1_200_000n, 1_200_000n),
  preVerificationGas: 80_000n,
  gasFees: packUint128Pair(1_000_000_000n, 2_000_000_000n),
  paymasterAndData: "0x",
  signature: "0x",
});

const signUserOperation = async (
  entryPoint: Contract,
  userOp: PackedUserOperation,
  transactionPasskey: PasskeyMaterial,
): Promise<{ userOpHash: string; signed: PackedUserOperation }> => {
  const userOpHash = await entryPoint.getUserOpHash(userOp);
  return {
    userOpHash,
    signed: {
      ...userOp,
      signature: await signDigest(transactionPasskey, userOpHash),
    },
  };
};

const rejects = async (action: () => Promise<unknown>): Promise<boolean> => {
  try {
    await action();
    return false;
  } catch {
    return true;
  }
};

export async function signAndSubmitTestOperation(
  transactionPasskey: PasskeyMaterial,
  deployment: AccountDeployment,
): Promise<OperationResult> {
  const receiverAddress = requireAddress("Receiver", config.receiver);
  const { signer, chainId, walletAddress } = await connectWallet();
  if (chainId !== deployment.chainId) throw new Error("Account is on another chain.");
  const entryPoint = new Contract(ENTRYPOINT_V08_ADDRESS, ENTRYPOINT_ABI, signer);
  const account = new Contract(deployment.account, ACCOUNT_ABI, signer);
  const receiverCall = RECEIVER_INTERFACE.encodeFunctionData("emitTest", [
    toUtf8Bytes("alpha-prime-phase-3a"),
  ]);
  const executionData = encodeExecution(receiverAddress, 0n, receiverCall);
  const accountCallData = ACCOUNT_INTERFACE.encodeFunctionData("execute", [
    EXECUTE_MODE,
    executionData,
  ]);
  const built = await signUserOperation(
    entryPoint,
    await buildUserOperation(entryPoint, deployment.account, accountCallData),
    transactionPasskey,
  );
  const alteredTargetCall = ACCOUNT_INTERFACE.encodeFunctionData("execute", [
    EXECUTE_MODE,
    encodeExecution(walletAddress, 0n, "0x"),
  ]);
  const alteredCalldataCall = ACCOUNT_INTERFACE.encodeFunctionData("execute", [
    EXECUTE_MODE,
    encodeExecution(
      receiverAddress,
      0n,
      RECEIVER_INTERFACE.encodeFunctionData("emitTest", [
        toUtf8Bytes("tampered"),
      ]),
    ),
  ]);
  const alteredValueCall = ACCOUNT_INTERFACE.encodeFunctionData("execute", [
    EXECUTE_MODE,
    encodeExecution(receiverAddress, 1n, receiverCall),
  ]);
  const estimate = (operation: PackedUserOperation) =>
    entryPoint.handleOps.estimateGas([operation], walletAddress, {
      gasLimit: 2_500_000n,
    });
  const modifiedTargetRejected = await rejects(() =>
    estimate({ ...built.signed, callData: alteredTargetCall }),
  );
  const modifiedCalldataRejected = await rejects(() =>
    estimate({ ...built.signed, callData: alteredCalldataCall }),
  );
  const modifiedValueRejected = await rejects(() =>
    estimate({ ...built.signed, callData: alteredValueCall }),
  );
  const modifiedNonceRejected = await rejects(() =>
    estimate({ ...built.signed, nonce: built.signed.nonce + 1n }),
  );
  const directEoaExecutionRejected = await rejects(() =>
    account.execute.staticCall(EXECUTE_MODE, executionData),
  );
  if (
    !modifiedTargetRejected ||
    !modifiedCalldataRejected ||
    !modifiedValueRejected ||
    !modifiedNonceRejected ||
    !directEoaExecutionRejected
  ) {
    throw new Error("One or more adversarial operation checks unexpectedly passed.");
  }
  const tx = await entryPoint.handleOps([built.signed], walletAddress, {
    gasLimit: 2_500_000n,
  });
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("UserOperation reverted.");
  const receiverEventFound = receipt.logs.some(
    (log: { topics: string[]; data: string }) => {
      try {
        const parsed = RECEIVER_INTERFACE.parseLog(log);
        return (
          parsed?.name === "TestExecuted" &&
          getAddress(parsed.args.account) === deployment.account
        );
      } catch {
        return false;
      }
    },
  );
  const replayRejected = await rejects(() => estimate(built.signed));
  if (!receiverEventFound || !replayRejected) {
    throw new Error("Receiver evidence or replay rejection was not confirmed.");
  }
  return {
    userOpHash: built.userOpHash,
    transactionHash: receipt.hash,
    receiverEventFound,
    modifiedTargetRejected,
    modifiedCalldataRejected,
    modifiedValueRejected,
    modifiedNonceRejected,
    replayRejected,
    directEoaExecutionRejected,
  };
}

export async function validateEvolutionFlow(
  passkeys: PasskeySet,
  deployment: AccountDeployment,
): Promise<EvolutionResult> {
  const nextImplementation = requireAddress(
    "Next implementation",
    config.nextImplementation,
  );
  const { provider, signer, walletAddress } = await connectWallet();
  const nextCode = await provider.getCode(nextImplementation);
  if (nextCode === "0x") throw new Error("Next implementation has no code.");
  const controller = new Contract(
    deployment.evolutionController,
    CONTROLLER_ABI,
    signer,
  );
  const account = new Contract(deployment.account, ACCOUNT_ABI, signer);
  const entryPoint = new Contract(ENTRYPOINT_V08_ADDRESS, ENTRYPOINT_ABI, signer);
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Latest BSC Testnet block is unavailable.");
  const request = [
    nextImplementation,
    keccak256(nextCode),
    2,
    0,
    latest.timestamp + 7 * 24 * 60 * 60,
    id(`phase3a-browser-evolution-${Date.now()}`),
  ];
  const requestId = request[5] as string;
  const upgradeDigest = await controller.getUpgradeDigest(
    deployment.account,
    request,
  );
  const transactionAuthorization = await signDigest(
    passkeys.transaction,
    upgradeDigest,
  );
  const evolutionAuthorization = await signDigest(
    passkeys.evolution,
    upgradeDigest,
  );
  const requestCall = account.interface.encodeFunctionData("requestUpgrade", [
    request,
    transactionAuthorization,
    evolutionAuthorization,
  ]);
  const requestBuilt = await signUserOperation(
    entryPoint,
    await buildUserOperation(entryPoint, deployment.account, requestCall),
    passkeys.transaction,
  );
  const requestTx = await entryPoint.handleOps(
    [requestBuilt.signed],
    walletAddress,
    { gasLimit: 2_500_000n },
  );
  const requestReceipt = await requestTx.wait();
  if (!requestReceipt || requestReceipt.status !== 1) {
    throw new Error("Upgrade request reverted.");
  }
  const pending = await controller.pendingUpgrade(deployment.account);
  if (pending.requestId !== requestId) {
    throw new Error("Pending upgrade does not match the signed request.");
  }
  const earlyFinalizationRejected = await rejects(() =>
    controller.finalizeUpgrade.staticCall(deployment.account),
  );
  const unauthorizedCancellationRejected = await rejects(() =>
    controller.cancelUpgrade.staticCall(deployment.account, requestId, "0x"),
  );
  const cancellationDigest = await controller.getCancellationDigest(
    deployment.account,
    requestId,
  );
  const cancellationAuthorization = await signDigest(
    passkeys.transaction,
    cancellationDigest,
  );
  const cancelCall = account.interface.encodeFunctionData("cancelUpgrade", [
    requestId,
    cancellationAuthorization,
  ]);
  const cancelBuilt = await signUserOperation(
    entryPoint,
    await buildUserOperation(entryPoint, deployment.account, cancelCall),
    passkeys.transaction,
  );
  const cancelTx = await entryPoint.handleOps(
    [cancelBuilt.signed],
    walletAddress,
    { gasLimit: 2_500_000n },
  );
  const cancelReceipt = await cancelTx.wait();
  if (!cancelReceipt || cancelReceipt.status !== 1) {
    throw new Error("Authorized cancellation reverted.");
  }
  const cleared = await controller.pendingUpgrade(deployment.account);
  const authorizedCancellationSucceeded = cleared.requestId === zeroPadValue("0x", 32);
  const canceledRequestFinalizationRejected = await rejects(() =>
    controller.finalizeUpgrade.staticCall(deployment.account),
  );
  if (
    !earlyFinalizationRejected ||
    !unauthorizedCancellationRejected ||
    !authorizedCancellationSucceeded ||
    !canceledRequestFinalizationRejected
  ) {
    throw new Error("One or more Evolution boundary checks failed.");
  }
  return {
    requestId,
    requestTransactionHash: requestReceipt.hash,
    cancelTransactionHash: cancelReceipt.hash,
    executableAt: pending.executableAt.toString(),
    earlyFinalizationRejected,
    unauthorizedCancellationRejected,
    authorizedCancellationSucceeded,
    canceledRequestFinalizationRejected,
  };
}

export class AccountFlowError extends Error {
  constructor(
    message: string,
    readonly debug: AccountFlowDebug,
  ) {
    super(message);
    this.name = "AccountFlowError";
  }
}