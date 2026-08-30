import { Contract, Interface, getAddress, keccak256, sha256, toUtf8Bytes } from "ethers";

import {
  BSC_TESTNET_CHAIN_ID,
  ENTRYPOINT_V08_ADDRESS,
  buildUserOperation,
  signDigest,
  signUserOperation,
  type AccountDeployment,
  type PasskeyMaterial,
  type PasskeySet,
} from "./phase3a";
import {
  connectPhase3BRelay,
  relayPhase3BTransaction,
} from "./phase3b-relay-client";
import type { RecoveryKitAccount, RecoveryKitSession, RecoveryPublicKey } from "./recovery-kit";

const INITIALIZATION_TUPLE =
  "((bytes32,bytes32),(bytes32,bytes32),(bytes32,bytes32),bytes32,address,bytes32,address,bytes32,uint64)";
const FACTORY_ABI = [
  "function authority() view returns (address)",
  "function evolutionController() view returns (address)",
  "function entryPoint() view returns (address)",
  `function predictAccount(${INITIALIZATION_TUPLE} initialization) view returns (address)`,
  `function createAccount(${INITIALIZATION_TUPLE} initialization,bytes signature) returns (address)`,
];
const AUTHORITY_ABI = [
  `function getCreationDigest(address account,${INITIALIZATION_TUPLE} initialization) view returns (bytes32)`,
  "function transactionKey(address account) view returns (bytes32 qx,bytes32 qy)",
  "function recoveryKey(address account) view returns (bytes32 qx,bytes32 qy)",
  "function evolutionKey(address account) view returns (bytes32 qx,bytes32 qy)",
  "function rpIdHash(address account) view returns (bytes32)",
  "function recoveryNonce(address account) view returns (uint256)",
  "function transactionKeyVersion(address account) view returns (uint64)",
  "function recoveryKeyVersion(address account) view returns (uint64)",
  "function getRecoveryDigest(address account,((bytes32,bytes32),(bytes32,bytes32),uint256,bytes32) request) view returns (bytes32)",
];
const ACCOUNT_ABI = [
  "function authority() view returns (address)",
  "function evolutionController() view returns (address)",
  "function entryPoint() view returns (address)",
  "function requestRecovery(((bytes32,bytes32),(bytes32,bytes32),uint256,bytes32) request,bytes recoverySignature)",
  "function requestUpgrade((address,bytes32,uint64,uint48,uint48,bytes32) request,bytes transactionSignature,bytes evolutionSignature)",
  "function cancelUpgrade(bytes32 requestId,bytes transactionSignature)",
];
const ENTRYPOINT_ABI = [
  "function getNonce(address sender,uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address payable beneficiary)",
  "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash,address indexed sender,uint256 nonce,bytes revertReason)",
];
const CONTROLLER_ABI = [
  "function currentImplementation(address account) view returns(address)",
  "function currentImplementationCodehash(address account) view returns(bytes32)",
  "function currentStandardVersion(address account) view returns(uint64)",
  "function getUpgradeDigest(address account,(address,bytes32,uint64,uint48,uint48,bytes32) request) view returns(bytes32)",
  "function getCancellationDigest(address account,bytes32 requestId) view returns(bytes32)",
  "function pendingUpgrade(address account) view returns(address implementation,bytes32 codehash,uint64 standardVersion,uint48 requestedAt,uint48 executableAt,uint48 deadline,bytes32 requestId,uint256 nonce,uint64 transactionKeyVersion)",
  "function finalizeUpgrade(address account)",
  "error StaleTransactionKeyVersion(uint64 expected,uint64 current)",
];
const CONTROLLER_INTERFACE = new Interface(CONTROLLER_ABI);

export const decodeStaleFinalizeError = (data: string): string | null => {
  try {
    return CONTROLLER_INTERFACE.parseError(data)?.name ?? null;
  } catch {
    return null;
  }
};

export const PHASE3B_FACTORY_ADDRESS = import.meta.env.VITE_PHASE3B_FACTORY_ADDRESS ?? "";
export const PHASE3B_INITIAL_IMPLEMENTATION_ADDRESS =
  import.meta.env.VITE_PHASE3B_INITIAL_IMPLEMENTATION_ADDRESS ?? "";
export const PHASE3B_NEXT_IMPLEMENTATION_ADDRESS =
  import.meta.env.VITE_PHASE3B_NEXT_IMPLEMENTATION_ADDRESS ??
  "0x0ed2097B83F91D25005c0892b6Ee32d4bBD43dE3";

export type Phase3BPrepared = {
  factory: string; authority: string; controller: string; account: string;
  rpIdHash: string; initialization: readonly unknown[]; chainId: bigint;
  recoveryPublicKey: RecoveryPublicKey;
};
export type RecoveryRequest = {
  newTransactionKey: readonly [string, string]; newRecoveryKey: readonly [string, string]; recoveryNonce: bigint; requestId: string;
};
export type Phase3BRecoveryResult = {
  recoveryTransactionHash: string; requestId: string; nonce: string;
  transactionKeyVersion: string; recoveryKeyVersion: string;
};
export type Phase3BStaleUpgradeRequest = {
  requestId: string;
  requestTransactionHash: string;
  preRecoveryTransactionKeyVersion: string;
  proposedImplementation: string;
  proposedVersion: string;
  implementationBefore: string;
  implementationVersionBefore: string;
  executableAt: string;
};
export type Phase3BRecoveryLiveState = {
  factory: string;
  factoryAuthority: string;
  factoryController: string;
  factoryEntryPoint: string;
  account: string;
  accountDeployed: boolean;
  accountAuthority: string;
  accountController: string;
  accountEntryPoint: string;
  registeredRecoveryKey: RecoveryPublicKey;
  rpIdHash: string;
  chainId: bigint;
};

export async function loadPhase3BAccount(accountAddress: string): Promise<{
  deployment: AccountDeployment;
  transactionKey: { qx: string; qy: string };
  evolutionKey: { qx: string; qy: string };
}> {
  const factoryAddress = configuredAddress("Phase 3B Factory", PHASE3B_FACTORY_ADDRESS);
  const { provider, chainId, relayerAddress, factoryAddress: relayFactory } =
    await connectPhase3BRelay();
  if (!same(relayFactory, factoryAddress)) throw new Error("Relay Factory binding is incorrect.");
  const factory = new Contract(factoryAddress, FACTORY_ABI, provider);
  const authorityAddress = getAddress(await factory.authority());
  const controllerAddress = getAddress(await factory.evolutionController());
  const accountAddressChecked = getAddress(accountAddress);
  const account = new Contract(accountAddressChecked, ACCOUNT_ABI, provider);
  const authority = new Contract(authorityAddress, AUTHORITY_ABI, provider);
  if (await provider.getCode(accountAddressChecked) === "0x" ||
      !same(await account.authority(), authorityAddress) ||
      !same(await account.evolutionController(), controllerAddress) ||
      !same(await account.entryPoint(), ENTRYPOINT_V08_ADDRESS)) {
    throw new Error("Phase 3B account live bindings are invalid.");
  }
  const key = await authority.transactionKey(accountAddressChecked);
  const evolutionKey = await authority.evolutionKey(accountAddressChecked);
  const rpIdHash = await authority.rpIdHash(accountAddressChecked);
  return {
    transactionKey: { qx: key[0], qy: key[1] },
    evolutionKey: { qx: evolutionKey[0], qy: evolutionKey[1] },
    deployment: {
      predictedAddress: accountAddressChecked,
      deployedAddress: accountAddressChecked,
      account: accountAddressChecked,
      authority: authorityAddress,
      evolutionController: controllerAddress,
      rpIdHash,
      userSalt: "",
      chainId,
      status: "PASS",
      debug: {
        walletConnected: "NO",
        walletAddress: relayerAddress,
        chainId: chainId.toString(),
        tBNBBalance: `${await provider.getBalance(accountAddressChecked)} wei`,
        factoryAddress,
        authorityAddress,
        controllerAddress,
        userSalt: "",
        rpIdHash,
        predictedAddress: accountAddressChecked,
        estimateGas: "server bounded",
        sendTransactionStatus: "reconnected",
        txHash: "not applicable",
        receiptStatus: "live",
      },
    },
  };
}

export async function requestPhase3BStaleUpgrade(
  passkeys: Pick<PasskeySet, "transaction" | "evolution">,
  deployment: AccountDeployment,
): Promise<Phase3BStaleUpgradeRequest> {
  const { provider, relayerAddress } = await connectPhase3BRelay();
  const authority = new Contract(deployment.authority, AUTHORITY_ABI, provider);
  const controller = new Contract(deployment.evolutionController, CONTROLLER_ABI, provider);
  const account = new Contract(deployment.account, ACCOUNT_ABI, provider);
  const entryPoint = new Contract(ENTRYPOINT_V08_ADDRESS, ENTRYPOINT_ABI, provider);
  const implementationBefore = getAddress(await controller.currentImplementation(deployment.account));
  const implementationVersionBefore = BigInt(await controller.currentStandardVersion(deployment.account));
  const pendingBefore = await controller.pendingUpgrade(deployment.account);
  if (pendingBefore.requestId !== `0x${"00".repeat(32)}`) {
    const proposedImplementation = configuredAddress(
      "Phase 3B next implementation",
      PHASE3B_NEXT_IMPLEMENTATION_ADDRESS,
    );
    if (
      getAddress(pendingBefore.implementation) !== proposedImplementation ||
      BigInt(pendingBefore.standardVersion) !== implementationVersionBefore + 1n
    ) {
      throw new Error("A different live Evolution upgrade is already pending.");
    }
    return {
      requestId: pendingBefore.requestId,
      requestTransactionHash: "resumed from pendingUpgrade",
      preRecoveryTransactionKeyVersion:
        BigInt(pendingBefore.transactionKeyVersion).toString(),
      proposedImplementation,
      proposedVersion: BigInt(pendingBefore.standardVersion).toString(),
      implementationBefore,
      implementationVersionBefore: implementationVersionBefore.toString(),
      executableAt: BigInt(pendingBefore.executableAt).toString(),
    };
  }
  const proposedImplementation = configuredAddress(
    "Phase 3B next implementation",
    PHASE3B_NEXT_IMPLEMENTATION_ADDRESS,
  );
  const code = await provider.getCode(proposedImplementation);
  if (code === "0x") throw new Error("Phase 3B next implementation is not deployed.");
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Latest BSC Testnet block is unavailable.");
  const request = [
    proposedImplementation,
    keccak256(code),
    implementationVersionBefore + 1n,
    0,
    latest.timestamp + 7 * 24 * 60 * 60,
    randomRequestId(),
  ] as const;
  const digest = await controller.getUpgradeDigest(deployment.account, request);
  const transactionSignature = await signDigest(passkeys.transaction, digest);
  const evolutionSignature = await signDigest(passkeys.evolution, digest);
  const callData = account.interface.encodeFunctionData("requestUpgrade", [
    request,
    transactionSignature,
    evolutionSignature,
  ]);
  const built = await signUserOperation(
    entryPoint,
    await buildUserOperation(entryPoint, deployment.account, callData),
    passkeys.transaction,
  );
  const relayed = await relayPhase3BTransaction(
    "userOperation",
    ENTRYPOINT_V08_ADDRESS,
    entryPoint.interface.encodeFunctionData("handleOps", [[built.signed], relayerAddress]),
  );
  const receipt = await provider.getTransactionReceipt(relayed.transactionHash);
  const userOperationEvent = receipt?.logs
    .map((log) => {
      try {
        return getAddress(log.address) === ENTRYPOINT_V08_ADDRESS
          ? entryPoint.interface.parseLog(log)
          : null;
      } catch { return null; }
    })
    .find((event) =>
      event?.name === "UserOperationEvent" &&
      event.args.userOpHash === built.userOpHash &&
      getAddress(event.args.sender) === deployment.account
    );
  if (!userOperationEvent?.args.success) {
    const revertEvent = receipt?.logs
      .map((log) => {
        try { return entryPoint.interface.parseLog(log); } catch { return null; }
      })
      .find((event) => event?.name === "UserOperationRevertReason");
    throw new Error(
      `Evolution request UserOperation failed${revertEvent ? `: ${revertEvent.args.revertReason}` : "."}`,
    );
  }
  const fresh = await connectPhase3BRelay();
  const freshController = new Contract(deployment.evolutionController, CONTROLLER_ABI, fresh.provider);
  const pending = await freshController.pendingUpgrade(deployment.account);
  if (pending.requestId !== request[5] ||
      getAddress(pending.implementation) !== proposedImplementation ||
      BigInt(pending.transactionKeyVersion) !==
        BigInt(await authority.transactionKeyVersion(deployment.account))) {
    throw new Error("Live pending upgrade does not match the signed request.");
  }
  return {
    requestId: request[5],
    requestTransactionHash: relayed.transactionHash,
    preRecoveryTransactionKeyVersion:
      BigInt(pending.transactionKeyVersion).toString(),
    proposedImplementation,
    proposedVersion: (implementationVersionBefore + 1n).toString(),
    implementationBefore,
    implementationVersionBefore: implementationVersionBefore.toString(),
    executableAt: BigInt(pending.executableAt).toString(),
  };
}

export async function cancelPhase3BStaleUpgrade(
  transactionPasskey: PasskeyMaterial,
  deployment: AccountDeployment,
  request: Phase3BStaleUpgradeRequest,
): Promise<{
  staleFinalizeError: string;
  cancellationTransactionHash: string;
  implementationAfter: string;
  implementationVersionAfter: string;
  cleared: boolean;
}> {
  const { provider, relayerAddress } = await connectPhase3BRelay();
  const controller = new Contract(deployment.evolutionController, CONTROLLER_ABI, provider);
  let staleFinalizeError = "";
  try {
    await controller.finalizeUpgrade.staticCall(deployment.account);
  } catch (error) {
    const data = (error as { data?: string }).data;
    staleFinalizeError = data
      ? decodeStaleFinalizeError(data) ?? String(error)
      : String(error);
  }
  if (staleFinalizeError !== "StaleTransactionKeyVersion") {
    throw new Error(`Stale finalization is not yet observable: ${staleFinalizeError}`);
  }
  const digest = await controller.getCancellationDigest(deployment.account, request.requestId);
  const authorization = await signDigest(transactionPasskey, digest);
  const account = new Contract(deployment.account, ACCOUNT_ABI, provider);
  const entryPoint = new Contract(ENTRYPOINT_V08_ADDRESS, ENTRYPOINT_ABI, provider);
  const callData = account.interface.encodeFunctionData("cancelUpgrade", [
    request.requestId,
    authorization,
  ]);
  const built = await signUserOperation(
    entryPoint,
    await buildUserOperation(entryPoint, deployment.account, callData),
    transactionPasskey,
  );
  const relayed = await relayPhase3BTransaction(
    "userOperation",
    ENTRYPOINT_V08_ADDRESS,
    entryPoint.interface.encodeFunctionData("handleOps", [[built.signed], relayerAddress]),
  );
  const fresh = await connectPhase3BRelay();
  const freshController = new Contract(deployment.evolutionController, CONTROLLER_ABI, fresh.provider);
  const pending = await freshController.pendingUpgrade(deployment.account);
  const cleared = pending.requestId === `0x${"00".repeat(32)}`;
  const implementationAfter = getAddress(await freshController.currentImplementation(deployment.account));
  const implementationVersionAfter =
    BigInt(await freshController.currentStandardVersion(deployment.account)).toString();
  if (!cleared ||
      implementationAfter !== request.implementationBefore ||
      implementationVersionAfter !== request.implementationVersionBefore) {
    throw new Error("Post-cancellation Evolution invariants failed.");
  }
  return {
    staleFinalizeError,
    cancellationTransactionHash: relayed.transactionHash,
    implementationAfter,
    implementationVersionAfter,
    cleared,
  };
}

const configuredAddress = (name: string, value: string): string => {
  if (!value) throw new Error(`${name} is not configured.`);
  return getAddress(value);
};
const keyTuple = (key: { qx: string; qy: string }): [string, string] => [key.qx, key.qy];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Pure, canonical request shape expected by AVSAccountRecoveryAuthority. */
export const buildRecoveryRequest = (
  replacement: Pick<PasskeyMaterial, "qx" | "qy">,
  nextRecoveryKey: RecoveryPublicKey,
  recoveryNonce: bigint,
  requestId: string,
): RecoveryRequest => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(requestId) || /^0x0{64}$/i.test(requestId)) {
    throw new Error("Recovery requestId must be a non-zero bytes32.");
  }
  return { newTransactionKey: [replacement.qx, replacement.qy], newRecoveryKey: keyTuple(nextRecoveryKey), recoveryNonce, requestId };
};

export const recoveryKitMatchesPrepared = (
  account: RecoveryKitAccount,
  prepared: Pick<Phase3BPrepared, "account" | "authority" | "chainId" | "rpIdHash">,
) => same(account.address, prepared.account) && same(account.authority, prepared.authority) &&
  account.chainId === prepared.chainId.toString() && same(account.rpIdHash, prepared.rpIdHash);

export const recoveryGatesReady = (input: {
  kitExported: boolean; backupConfirmed: boolean; session: RecoveryKitSession | null;
  replacement: PasskeyMaterial | null;
}) => Boolean(input.kitExported && input.backupConfirmed && input.session && input.replacement &&
  input.session.account.address && input.session.account.authority);

export const verifyPhase3BRecoveryLiveState = (
  session: RecoveryKitSession,
  live: Phase3BRecoveryLiveState,
): Phase3BPrepared => {
  if (live.chainId !== BSC_TESTNET_CHAIN_ID ||
    session.account.chainId !== live.chainId.toString()) {
    throw new Error("Imported Recovery Kit chain does not match the connected wallet.");
  }
  if (!same(live.factoryEntryPoint, ENTRYPOINT_V08_ADDRESS)) {
    throw new Error("Factory EntryPoint binding is not canonical v0.8.");
  }
  if (!same(session.account.authority, live.factoryAuthority)) {
    throw new Error("Imported Recovery Kit Authority does not match the configured Phase 3B Factory.");
  }
  if (!live.accountDeployed) {
    throw new Error("Imported Recovery Kit account is not deployed.");
  }
  if (!same(live.registeredRecoveryKey.qx, session.recoveryPublicKey.qx) ||
      !same(live.registeredRecoveryKey.qy, session.recoveryPublicKey.qy)) {
    throw new Error("Imported Recovery Kit root is not the account's current Recovery root.");
  }
  if (!same(live.rpIdHash, session.account.rpIdHash)) {
    throw new Error("Imported Recovery Kit RP-ID does not match the account.");
  }
  if (!same(live.accountAuthority, live.factoryAuthority)) {
    throw new Error("Account Authority binding differs from the Factory.");
  }
  if (!same(live.accountController, live.factoryController)) {
    throw new Error("Account EvolutionController binding differs from the Factory.");
  }
  if (!same(live.accountEntryPoint, ENTRYPOINT_V08_ADDRESS)) {
    throw new Error("Account EntryPoint binding is not canonical v0.8.");
  }
  return {
    factory: getAddress(live.factory),
    authority: getAddress(live.factoryAuthority),
    controller: getAddress(live.factoryController),
    account: getAddress(live.account),
    rpIdHash: live.rpIdHash,
    initialization: [],
    chainId: live.chainId,
    recoveryPublicKey: session.recoveryPublicKey,
  };
};

const randomRequestId = (): string => {
  const value = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("")}`;
};

export async function preparePhase3BAccount(
  passkeys: PasskeySet,
  recoveryPublicKey: RecoveryPublicKey,
): Promise<Phase3BPrepared> {
  const factoryAddress = configuredAddress("Phase 3B Factory", PHASE3B_FACTORY_ADDRESS);
  const implementation = configuredAddress("Phase 3B initial implementation", PHASE3B_INITIAL_IMPLEMENTATION_ADDRESS);
  const { provider, chainId, factoryAddress: relayFactory } = await connectPhase3BRelay();
  if (chainId !== BSC_TESTNET_CHAIN_ID) throw new Error("Phase 3B requires BSC Testnet (chain 97).");
  if (!same(relayFactory, factoryAddress)) throw new Error("Relay Factory binding is incorrect.");
  const factory = new Contract(factoryAddress, FACTORY_ABI, provider);
  if (!same(await factory.entryPoint(), ENTRYPOINT_V08_ADDRESS)) throw new Error("Factory EntryPoint binding is not canonical v0.8.");
  const code = await provider.getCode(implementation);
  if (code === "0x") throw new Error("Phase 3B initial implementation has no code.");
  const authority = getAddress(await factory.authority());
  const controller = getAddress(await factory.evolutionController());
  const rpIdHash = sha256(toUtf8Bytes(window.location.hostname));
  const initialization = [
    keyTuple(passkeys.transaction), keyTuple(recoveryPublicKey), keyTuple(passkeys.evolution),
    rpIdHash, factoryAddress, keccak256(toUtf8Bytes("alpha-prime-phase3b-passkey-demo")),
    implementation, keccak256(code), 1,
  ] as const;
  return { factory: factoryAddress, authority, controller, account: getAddress(await factory.predictAccount(initialization)),
    rpIdHash, initialization, chainId, recoveryPublicKey };
}

export async function createPhase3BAccount(
  prepared: Phase3BPrepared, transaction: PasskeyMaterial,
): Promise<AccountDeployment> {
  const { provider, chainId, relayerAddress } = await connectPhase3BRelay();
  if (chainId !== prepared.chainId) throw new Error("Relay chain changed after preparation.");
  const factory = new Contract(prepared.factory, FACTORY_ABI, provider);
  const authority = new Contract(prepared.authority, AUTHORITY_ABI, provider);
  const creationSignature = await signDigest(transaction, await authority.getCreationDigest(prepared.account, prepared.initialization));
  if (!same(await factory.createAccount.staticCall(prepared.initialization, creationSignature), prepared.account)) throw new Error("Factory prediction changed.");
  const relayed = await relayPhase3BTransaction(
    "createAccount",
    prepared.factory,
    factory.interface.encodeFunctionData("createAccount", [prepared.initialization, creationSignature]),
  );
  if (relayed.status !== 1 || !same(relayed.createdAccount ?? "", prepared.account) ||
      await provider.getCode(prepared.account) === "0x") throw new Error("Phase 3B account creation reverted.");
  const account = new Contract(prepared.account, ACCOUNT_ABI, provider);
  if (!same(await account.authority(), prepared.authority) || !same(await account.evolutionController(), prepared.controller) || !same(await account.entryPoint(), ENTRYPOINT_V08_ADDRESS)) throw new Error("Phase 3B immutable bindings are incorrect.");
  const registeredRecovery = await authority.recoveryKey(prepared.account);
  if (!same(registeredRecovery[0], prepared.recoveryPublicKey.qx) || !same(registeredRecovery[1], prepared.recoveryPublicKey.qy)) throw new Error("Offline Recovery Kit key was not registered.");
  return { predictedAddress: prepared.account, deployedAddress: prepared.account, account: prepared.account, authority: prepared.authority,
    evolutionController: prepared.controller, rpIdHash: prepared.rpIdHash, userSalt: prepared.initialization[5] as string, chainId,
    status: "PASS", debug: { walletConnected: "NO", walletAddress: relayerAddress, chainId: chainId.toString(), tBNBBalance: relayed.funding ? `${relayed.funding.amountWei} wei funded` : "already funded", factoryAddress: prepared.factory, authorityAddress: prepared.authority, controllerAddress: prepared.controller, userSalt: prepared.initialization[5] as string, rpIdHash: prepared.rpIdHash, predictedAddress: prepared.account, estimateGas: "server bounded", sendTransactionStatus: relayed.funding ? `relayed; funding ${relayed.funding.transactionHash}` : "relayed", txHash: relayed.transactionHash, receiptStatus: String(relayed.status) } };
}

export async function preparePhase3BRecoveryFromKit(
  session: RecoveryKitSession,
): Promise<Phase3BPrepared> {
  const factoryAddress = configuredAddress("Phase 3B Factory", PHASE3B_FACTORY_ADDRESS);
  const { provider, chainId, factoryAddress: relayFactory } = await connectPhase3BRelay();
  if (!same(relayFactory, factoryAddress)) throw new Error("Relay Factory binding is incorrect.");
  const factory = new Contract(factoryAddress, FACTORY_ABI, provider);
  const authorityAddress = getAddress(await factory.authority());
  const controllerAddress = getAddress(await factory.evolutionController());
  const accountAddress = getAddress(session.account.address);
  const account = new Contract(accountAddress, ACCOUNT_ABI, provider);
  const authority = new Contract(authorityAddress, AUTHORITY_ABI, provider);
  const registeredRecovery = await authority.recoveryKey(accountAddress);
  return verifyPhase3BRecoveryLiveState(session, {
    factory: factoryAddress,
    factoryAuthority: authorityAddress,
    factoryController: controllerAddress,
    factoryEntryPoint: await factory.entryPoint(),
    account: accountAddress,
    accountDeployed: await provider.getCode(accountAddress) !== "0x",
    accountAuthority: await account.authority(),
    accountController: await account.evolutionController(),
    accountEntryPoint: await account.entryPoint(),
    registeredRecoveryKey: {
      qx: registeredRecovery[0],
      qy: registeredRecovery[1],
    },
    rpIdHash: await authority.rpIdHash(accountAddress),
    chainId,
  });
}

export async function requestPhase3BRecovery(session: RecoveryKitSession, replacement: PasskeyMaterial, nextRecoveryKey: RecoveryPublicKey): Promise<Phase3BRecoveryResult> {
  const prepared = await preparePhase3BRecoveryFromKit(session);
  const { provider, chainId } = await connectPhase3BRelay();
  if (chainId !== prepared.chainId) throw new Error("Relay chain changed after Recovery Kit verification.");
  const authority = new Contract(prepared.authority, AUTHORITY_ABI, provider);
  const account = new Contract(prepared.account, ACCOUNT_ABI, provider);
  const beforeKey = await authority.transactionKey(prepared.account);
  const beforeRecovery = await authority.recoveryKey(prepared.account);
  const transactionKeyVersion = BigInt(await authority.transactionKeyVersion(prepared.account));
  const recoveryKeyVersion = BigInt(await authority.recoveryKeyVersion(prepared.account));
  const nonce = BigInt(await authority.recoveryNonce(prepared.account));
  const request = buildRecoveryRequest(replacement, nextRecoveryKey, nonce, randomRequestId());
  const requestTuple = [
    request.newTransactionKey,
    request.newRecoveryKey,
    request.recoveryNonce,
    request.requestId,
  ] as const;
  const digest = await authority.getRecoveryDigest(prepared.account, requestTuple);
  const signature = session.signRecoveryDigest(digest);
  const relayed = await relayPhase3BTransaction(
    "recovery",
    prepared.account,
    account.interface.encodeFunctionData("requestRecovery", [requestTuple, signature]),
  );
  if (relayed.status !== 1) throw new Error("Recovery request reverted.");
  const { provider: freshProvider } = await connectPhase3BRelay();
  const freshAuthority = new Contract(prepared.authority, AUTHORITY_ABI, freshProvider);
  const freshAccount = new Contract(prepared.account, ACCOUNT_ABI, freshProvider);
  const afterKey = await freshAuthority.transactionKey(prepared.account);
  const afterRecovery = await freshAuthority.recoveryKey(prepared.account);
  const bindingsOk = same(await freshAccount.authority(), prepared.authority) && same(await freshAccount.evolutionController(), prepared.controller) && same(await freshAccount.entryPoint(), ENTRYPOINT_V08_ADDRESS);
  if (!same(afterKey[0], replacement.qx) || !same(afterKey[1], replacement.qy) ||
    !same(afterRecovery[0], nextRecoveryKey.qx) || !same(afterRecovery[1], nextRecoveryKey.qy) ||
    same(beforeKey[0], afterKey[0]) || same(beforeRecovery[0], afterRecovery[0]) ||
    BigInt(await freshAuthority.recoveryNonce(prepared.account)) !== nonce + 1n ||
    BigInt(await freshAuthority.transactionKeyVersion(prepared.account)) !== transactionKeyVersion + 1n ||
    BigInt(await freshAuthority.recoveryKeyVersion(prepared.account)) !== recoveryKeyVersion + 1n ||
    !bindingsOk) throw new Error("Atomic recovery rotation post-transaction invariants failed.");
  return { recoveryTransactionHash: relayed.transactionHash, requestId: request.requestId, nonce: nonce.toString(), transactionKeyVersion: (transactionKeyVersion + 1n).toString(), recoveryKeyVersion: (recoveryKeyVersion + 1n).toString() };
}