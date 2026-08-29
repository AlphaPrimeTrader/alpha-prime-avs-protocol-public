import {
  createECDH,
  createHash,
  createPrivateKey,
  sign as signWithNode,
} from "node:crypto";
import { expect } from "chai";
import { network } from "hardhat";

import {
  ENTRYPOINT_V08_ADDRESS,
  getEntryPointV08RuntimeBytecode,
} from "../fixtures/entrypoint-v08-runtime";

const { ethers } = await network.create();

type P256Key = {
  qx: string;
  qy: string;
  privateScalar: bigint;
};

const ENTRYPOINT_ABI = [
  "function getNonce(address sender,uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address payable beneficiary)",
];

const ENTRYPOINT = new ethers.Contract(
  ENTRYPOINT_V08_ADDRESS,
  ENTRYPOINT_ABI,
  ethers.provider,
);

const EXECUTE_MODE =
  "0x0100000000000000000000000000000000000000000000000000000000000000";

const USER_SALT = ethers.id("phase-3a-account");
const RP_ID_HASH = `0x${createHash("sha256")
  .update("localhost")
  .digest("hex")}`;

function deriveKey(privateScalar: bigint): P256Key {
  const scalar = Buffer.from(privateScalar.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const publicKey = ecdh.getPublicKey(undefined, "uncompressed");
  return {
    qx: `0x${publicKey.subarray(1, 33).toString("hex")}`,
    qy: `0x${publicKey.subarray(33, 65).toString("hex")}`,
    privateScalar,
  };
}

const TRANSACTION_KEY = deriveKey(1n);
const RECOVERY_KEY = deriveKey(2n);
const EVOLUTION_KEY = deriveKey(3n);
const ATTACKER_KEY = deriveKey(4n);

const toBase64Url = (value: Uint8Array): string =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const hexToBuffer = (value: string): Buffer =>
  Buffer.from(value.replace(/^0x/, ""), "hex");

function parseDerSignature(signature: Buffer): { r: string; s: string } {
  if (signature[0] !== 0x30) throw new Error("Expected a DER signature.");
  let cursor = 2;
  if (signature[cursor] === 0x81) cursor += 1;
  if (signature[cursor] === 0x82) cursor += 2;
  if (signature[cursor++] !== 0x02) throw new Error("DER r is missing.");
  const rLength = signature[cursor++];
  const r = signature.subarray(cursor, cursor + rLength);
  cursor += rLength;
  if (signature[cursor++] !== 0x02) throw new Error("DER s is missing.");
  const sLength = signature[cursor++];
  const s = signature.subarray(cursor, cursor + sLength);
  const normalize = (value: Buffer): string =>
    ethers.zeroPadValue(
      `0x${(value[0] === 0 ? value.subarray(1) : value).toString("hex")}`,
      32,
    );
  const curveOrder =
    0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const rawS = BigInt(normalize(s));
  const lowS = rawS > curveOrder / 2n ? curveOrder - rawS : rawS;
  return {
    r: normalize(r),
    s: ethers.zeroPadValue(ethers.toBeHex(lowS), 32),
  };
}

function signWebAuthn(
  digest: string,
  key: P256Key,
  rpIdHash = RP_ID_HASH,
): string {
  const challenge = toBase64Url(hexToBuffer(digest));
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"http://localhost"}`;
  const authenticatorData = Buffer.concat([
    hexToBuffer(rpIdHash),
    Buffer.from([0x05]),
    Buffer.alloc(4),
  ]);
  const signingPayload = Buffer.concat([
    authenticatorData,
    createHash("sha256").update(clientDataJSON).digest(),
  ]);
  const privateKey = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: toBase64Url(
        Buffer.from(
          key.privateScalar.toString(16).padStart(64, "0"),
          "hex",
        ),
      ),
      x: toBase64Url(hexToBuffer(key.qx)),
      y: toBase64Url(hexToBuffer(key.qy)),
    },
    format: "jwk",
  });
  const derSignature = signWithNode("sha256", signingPayload, {
    key: privateKey,
    dsaEncoding: "der",
  });
  const { r, s } = parseDerSignature(derSignature);
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "uint256", "uint256", "bytes", "string"],
    [
      r,
      s,
      clientDataJSON.indexOf('"challenge":"'),
      clientDataJSON.indexOf('"type":"webauthn.get"'),
      authenticatorData,
      clientDataJSON,
    ],
  );
}

function packUint128Pair(first: bigint, second: bigint): string {
  return ethers.concat([
    ethers.zeroPadValue(ethers.toBeHex(first), 16),
    ethers.zeroPadValue(ethers.toBeHex(second), 16),
  ]);
}

async function installEntryPoint() {
  await ethers.provider.send("hardhat_setCode", [
    ENTRYPOINT_V08_ADDRESS,
    getEntryPointV08RuntimeBytecode(),
  ]);
}

async function deployFoundation() {
  await installEntryPoint();
  const [deployer, bundler, outsider] = await ethers.getSigners();
  const factory = await ethers.deployContract("AVSAccountKernelFactory");
  await factory.waitForDeployment();
  const authority = await ethers.getContractAt(
    "AVSAccountAuthority",
    await factory.authority(),
  );
  const controller = await ethers.getContractAt(
    "AVSEvolutionController",
    await factory.evolutionController(),
  );
  const logicV1 = await ethers.deployContract("BoundedLogicMock", [1]);
  await logicV1.waitForDeployment();
  const receiver = await ethers.deployContract("TestReceiver");
  await receiver.waitForDeployment();

  return {
    deployer,
    bundler,
    outsider,
    authority,
    controller,
    factory,
    logicV1,
    receiver,
  };
}

async function makeInitialization(
  foundation: Awaited<ReturnType<typeof deployFoundation>>,
  overrides: Record<string, unknown> = {},
) {
  const factoryAddress = await foundation.factory.getAddress();
  const logicAddress = await foundation.logicV1.getAddress();
  const logicCodehash = ethers.keccak256(
    await ethers.provider.getCode(logicAddress),
  );
  return {
    transactionKey: {
      qx: TRANSACTION_KEY.qx,
      qy: TRANSACTION_KEY.qy,
    },
    recoveryKey: {
      qx: RECOVERY_KEY.qx,
      qy: RECOVERY_KEY.qy,
    },
    evolutionKey: {
      qx: EVOLUTION_KEY.qx,
      qy: EVOLUTION_KEY.qy,
    },
    rpIdHash: RP_ID_HASH,
    factory: factoryAddress,
    userSalt: USER_SALT,
    initialImplementation: logicAddress,
    initialImplementationCodehash: logicCodehash,
    initialStandardVersion: 1,
    ...overrides,
  };
}

async function createAccount(
  foundation: Awaited<ReturnType<typeof deployFoundation>>,
  providedInitialization?: Awaited<ReturnType<typeof makeInitialization>>,
) {
  const initialization =
    providedInitialization ?? (await makeInitialization(foundation));
  const predicted = await foundation.factory.predictAccount(
    initialization.transactionKey.qx,
    initialization.transactionKey.qy,
    initialization.userSalt,
  );
  const creationDigest = await foundation.authority.getCreationDigest(
    predicted,
    initialization,
  );
  const creationSignature = signWebAuthn(creationDigest, TRANSACTION_KEY);
  await (
    await foundation.factory.createAccount(
      initialization,
      creationSignature,
    )
  ).wait();
  await (
    await foundation.deployer.sendTransaction({
      to: predicted,
      value: ethers.parseEther("2"),
    })
  ).wait();
  const account = await ethers.getContractAt(
    "AVSAccountSecurityKernel",
    predicted,
  );
  return { account, predicted, initialization, creationSignature };
}

async function buildUserOperation(
  account: Awaited<ReturnType<typeof ethers.getContractAt>>,
  callData: string,
  signer = TRANSACTION_KEY,
) {
  const sender = await account.getAddress();
  const userOp = {
    sender,
    nonce: await ENTRYPOINT.getNonce(sender, 0),
    initCode: "0x",
    callData,
    accountGasLimits: packUint128Pair(1_200_000n, 1_200_000n),
    preVerificationGas: 80_000n,
    gasFees: packUint128Pair(1_000_000_000n, 2_000_000_000n),
    paymasterAndData: "0x",
    signature: "0x",
  };
  const userOpHash = await ENTRYPOINT.getUserOpHash(userOp);
  return {
    userOpHash,
    signed: {
      ...userOp,
      signature: signWebAuthn(userOpHash, signer),
    },
  };
}

async function submitUserOperation(
  bundler: Awaited<ReturnType<typeof ethers.getSigner>>,
  built: Awaited<ReturnType<typeof buildUserOperation>>,
) {
  return ENTRYPOINT.connect(bundler).handleOps(
    [built.signed],
    await bundler.getAddress(),
    { gasLimit: 2_500_000n },
  );
}

describe("Phase 3A AVS Account Security Kernel", function () {
  it("derives the stable identity from the primary key and user salt", async function () {
    const foundation = await deployFoundation();
    const initialization = await makeInitialization(foundation);
    const predicted = await foundation.factory.predictAccount(
      initialization.transactionKey.qx,
      initialization.transactionKey.qy,
      initialization.userSalt,
    );
    const alteredRecovery = {
      ...initialization,
      recoveryKey: { qx: ATTACKER_KEY.qx, qy: ATTACKER_KEY.qy },
    };
    const sameIdentity = await foundation.factory.predictAccount(
      alteredRecovery.transactionKey.qx,
      alteredRecovery.transactionKey.qy,
      alteredRecovery.userSalt,
    );

    expect(sameIdentity).to.equal(predicted);
  });

  it("atomically creates and initializes all security roles", async function () {
    const foundation = await deployFoundation();
    const { account, predicted, initialization } =
      await createAccount(foundation);

    expect(await account.getAddress()).to.equal(predicted);
    expect(await account.authority()).to.equal(
      await foundation.authority.getAddress(),
    );
    expect(await account.evolutionController()).to.equal(
      await foundation.controller.getAddress(),
    );
    expect(await account.entryPoint()).to.equal(ENTRYPOINT_V08_ADDRESS);
    expect(await foundation.authority.transactionKey(predicted)).to.deep.equal([
      initialization.transactionKey.qx,
      initialization.transactionKey.qy,
    ]);
    expect(await foundation.authority.recoveryKey(predicted)).to.deep.equal([
      initialization.recoveryKey.qx,
      initialization.recoveryKey.qy,
    ]);
    expect(await foundation.authority.evolutionKey(predicted)).to.deep.equal([
      initialization.evolutionKey.qx,
      initialization.evolutionKey.qy,
    ]);
    expect(await foundation.authority.rpIdHash(predicted)).to.equal(RP_ID_HASH);
    expect(
      await foundation.controller.currentImplementation(predicted),
    ).to.equal(initialization.initialImplementation);
    expect(await foundation.factory.isAVSAccount(predicted)).to.equal(true);
  });

  it("is idempotent for repeated creation parameters", async function () {
    const foundation = await deployFoundation();
    const created = await createAccount(foundation);
    const originalCode = await ethers.provider.getCode(created.predicted);

    expect(
      await foundation.factory.createAccount.staticCall(
        created.initialization,
        created.creationSignature,
      ),
    ).to.equal(created.predicted);
    await (
      await foundation.factory.createAccount(
        created.initialization,
        created.creationSignature,
      )
    ).wait();

    expect(await ethers.provider.getCode(created.predicted)).to.equal(
      originalCode,
    );
  });

  it("blocks attacker pre-initialization of predicted shared state", async function () {
    const foundation = await deployFoundation();
    const initialization = await makeInitialization(foundation);
    const predicted = await foundation.factory.predictAccount(
      initialization.transactionKey.qx,
      initialization.transactionKey.qy,
      initialization.userSalt,
    );

    await expect(
      foundation.authority.initializeAccount(predicted, initialization, "0x"),
    )
      .to.be.revertedWithCustomError(
        foundation.authority,
        "InvalidInitializationCaller",
      )
      .withArgs(await foundation.deployer.getAddress(), predicted);

    await expect(
      foundation.controller.initializeAccount(
        predicted,
        initialization.initialImplementation,
        initialization.initialImplementationCodehash,
        initialization.initialStandardVersion,
      ),
    )
      .to.be.revertedWithCustomError(
        foundation.controller,
        "UnauthorizedAccountCaller",
      )
      .withArgs(await foundation.deployer.getAddress(), predicted);
  });

  it("rejects front-running with altered security configuration", async function () {
    const foundation = await deployFoundation();
    const intended = await makeInitialization(foundation);
    const alternateLogicV1 = await ethers.deployContract("BoundedLogicMock", [1]);
    await alternateLogicV1.waitForDeployment();
    const predicted = await foundation.factory.predictAccount(
      intended.transactionKey.qx,
      intended.transactionKey.qy,
      intended.userSalt,
    );
    const digest = await foundation.authority.getCreationDigest(
      predicted,
      intended,
    );
    const intendedSignature = signWebAuthn(digest, TRANSACTION_KEY);
    const alternateLogicAddress = await alternateLogicV1.getAddress();
    const alterations = [
      {
        label: "Recovery key",
        initialization: {
          ...intended,
          recoveryKey: { qx: ATTACKER_KEY.qx, qy: ATTACKER_KEY.qy },
        },
      },
      {
        label: "Evolution key",
        initialization: {
          ...intended,
          evolutionKey: { qx: ATTACKER_KEY.qx, qy: ATTACKER_KEY.qy },
        },
      },
      {
        label: "RP-ID hash",
        initialization: {
          ...intended,
          rpIdHash: ethers.id("attacker-rp-id"),
        },
      },
      {
        label: "initial implementation",
        initialization: {
          ...intended,
          initialImplementation: alternateLogicAddress,
          initialImplementationCodehash: ethers.keccak256(
            await ethers.provider.getCode(alternateLogicAddress),
          ),
        },
      },
      {
        label: "initial standard version",
        initialization: {
          ...intended,
          initialStandardVersion: 2,
        },
      },
    ];

    for (const alteration of alterations) {
      await expect(
        foundation.factory
          .connect(foundation.outsider)
          .createAccount(alteration.initialization, intendedSignature),
        alteration.label,
      ).to.be.revertedWithCustomError(
        foundation.authority,
        "InvalidCreationSignature",
      );
      expect(await ethers.provider.getCode(predicted)).to.equal("0x");
      expect(await foundation.authority.isInitialized(predicted)).to.equal(
        false,
      );
      expect(
        await foundation.controller.currentImplementation(predicted),
      ).to.equal(ethers.ZeroAddress);
    }

    const replayedOnAnotherAccount = {
      ...intended,
      userSalt: ethers.id("copied-creation-authorization"),
    };
    const otherPredicted = await foundation.factory.predictAccount(
      replayedOnAnotherAccount.transactionKey.qx,
      replayedOnAnotherAccount.transactionKey.qy,
      replayedOnAnotherAccount.userSalt,
    );
    await expect(
      foundation.factory
        .connect(foundation.outsider)
        .createAccount(replayedOnAnotherAccount, intendedSignature),
    ).to.be.revertedWithCustomError(
      foundation.authority,
      "InvalidCreationSignature",
    );
    expect(await ethers.provider.getCode(otherPredicted)).to.equal("0x");
    expect(await foundation.authority.isInitialized(otherPredicted)).to.equal(
      false,
    );
    expect(
      await foundation.controller.currentImplementation(otherPredicted),
    ).to.equal(ethers.ZeroAddress);

    await (
      await foundation.factory.createAccount(intended, intendedSignature)
    ).wait();
    expect(await ethers.provider.getCode(predicted)).not.to.equal("0x");
  });

  it("executes a valid WebAuthn UserOperation through EntryPoint only", async function () {
    const foundation = await deployFoundation();
    const { account, predicted } = await createAccount(foundation);
    const receiverCall = foundation.receiver.interface.encodeFunctionData(
      "emitTest",
      [ethers.toUtf8Bytes("phase-3a-proof")],
    );
    const executionData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address target,uint256 value,bytes callData)[]"],
      [[{
        target: await foundation.receiver.getAddress(),
        value: 0n,
        callData: receiverCall,
      }]],
    );
    const callData = account.interface.encodeFunctionData("execute", [
      EXECUTE_MODE,
      executionData,
    ]);
    const built = await buildUserOperation(account, callData);
    const receipt = await (
      await submitUserOperation(foundation.bundler, built)
    ).wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return foundation.receiver.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TestExecuted");

    expect(event?.args.account).to.equal(predicted);
    expect(event?.args.data).to.equal(
      ethers.hexlify(ethers.toUtf8Bytes("phase-3a-proof")),
    );
  });

  it("rejects direct EOA execution and an arbitrary account self-call", async function () {
    const foundation = await deployFoundation();
    const { account, predicted } = await createAccount(foundation);

    await expect(
      account
        .connect(foundation.outsider)
        .execute(EXECUTE_MODE, ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address target,uint256 value,bytes callData)[]"],
          [[]],
        )),
    ).to.be.revertedWithCustomError(account, "AccountUnauthorized");

    await ethers.provider.send("hardhat_setBalance", [
      predicted,
      "0x56BC75E2D63100000",
    ]);
    await ethers.provider.send("hardhat_impersonateAccount", [predicted]);
    const accountSigner = await ethers.getSigner(predicted);
    await expect(
      account
        .connect(accountSigner)
        .execute(EXECUTE_MODE, ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address target,uint256 value,bytes callData)[]"],
          [[]],
        )),
    )
      .to.be.revertedWithCustomError(account, "AccountUnauthorized")
      .withArgs(predicted);
  });

  it("rejects wrong Passkey, tampered calldata, and replay", async function () {
    const foundation = await deployFoundation();
    const { account } = await createAccount(foundation);
    const receiverCall = foundation.receiver.interface.encodeFunctionData(
      "emitTest",
      [ethers.toUtf8Bytes("authorized")],
    );
    const executionData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address target,uint256 value,bytes callData)[]"],
      [[{
        target: await foundation.receiver.getAddress(),
        value: 0n,
        callData: receiverCall,
      }]],
    );
    const callData = account.interface.encodeFunctionData("execute", [
      EXECUTE_MODE,
      executionData,
    ]);

    const wrongSigner = await buildUserOperation(
      account,
      callData,
      RECOVERY_KEY,
    );
    await expect(
      submitUserOperation(foundation.bundler, wrongSigner),
    ).to.revert(ethers);

    const wrongRpBuilt = await buildUserOperation(account, callData);
    wrongRpBuilt.signed.signature = signWebAuthn(
      wrongRpBuilt.userOpHash,
      TRANSACTION_KEY,
      ethers.id("wrong-rp-id"),
    );
    await expect(
      submitUserOperation(foundation.bundler, wrongRpBuilt),
    ).to.revert(ethers);

    const built = await buildUserOperation(account, callData);
    const tamperedCallData = ethers.getBytes(built.signed.callData);
    tamperedCallData[tamperedCallData.length - 1] ^= 0x01;
    await expect(
      ENTRYPOINT.connect(foundation.bundler).handleOps(
        [{
          ...built.signed,
          callData: ethers.hexlify(tamperedCallData),
        }],
        await foundation.bundler.getAddress(),
        { gasLimit: 2_500_000n },
      ),
    ).to.revert(ethers);

    await (await submitUserOperation(foundation.bundler, built)).wait();
    await expect(
      submitUserOperation(foundation.bundler, built),
    ).to.revert(ethers);
  });

  it("requires both transaction and Evolution Passkeys for upgrades", async function () {
    const foundation = await deployFoundation();
    const { account, predicted } = await createAccount(foundation);
    const logicV2 = await ethers.deployContract("BoundedLogicMock", [2]);
    await logicV2.waitForDeployment();
    const latest = await ethers.provider.getBlock("latest");
    const request = {
      implementation: await logicV2.getAddress(),
      codehash: ethers.keccak256(
        await ethers.provider.getCode(await logicV2.getAddress()),
      ),
      standardVersion: 2,
      validAfter: 0,
      deadline: Number(latest!.timestamp) + 7 * 24 * 60 * 60,
      requestId: ethers.id("phase-3a-upgrade-2"),
    };
    const digest = await foundation.controller.getUpgradeDigest(
      predicted,
      request,
    );
    const transactionSignature = signWebAuthn(digest, TRANSACTION_KEY);
    const wrongEvolutionSignature = signWebAuthn(digest, RECOVERY_KEY);
    const callData = account.interface.encodeFunctionData("requestUpgrade", [
      request,
      transactionSignature,
      wrongEvolutionSignature,
    ]);
    const built = await buildUserOperation(account, callData);

    await (await submitUserOperation(foundation.bundler, built)).wait();
    expect(
      (await foundation.controller.pendingUpgrade(predicted)).requestId,
    ).to.equal(ethers.ZeroHash);
  });

  it("queues an exact user-authorized upgrade with a 48-hour timelock", async function () {
    const foundation = await deployFoundation();
    const { account, predicted } = await createAccount(foundation);
    const logicV2 = await ethers.deployContract("BoundedLogicMock", [2]);
    await logicV2.waitForDeployment();
    const latest = await ethers.provider.getBlock("latest");
    const request = {
      implementation: await logicV2.getAddress(),
      codehash: ethers.keccak256(
        await ethers.provider.getCode(await logicV2.getAddress()),
      ),
      standardVersion: 2,
      validAfter: 0,
      deadline: Number(latest!.timestamp) + 7 * 24 * 60 * 60,
      requestId: ethers.id("phase-3a-upgrade-success"),
    };
    const digest = await foundation.controller.getUpgradeDigest(
      predicted,
      request,
    );
    const callData = account.interface.encodeFunctionData("requestUpgrade", [
      request,
      signWebAuthn(digest, TRANSACTION_KEY),
      signWebAuthn(digest, EVOLUTION_KEY),
    ]);

    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(account, callData),
      )
    ).wait();

    const pending = await foundation.controller.pendingUpgrade(predicted);
    expect(pending.implementation).to.equal(request.implementation);
    expect(pending.codehash).to.equal(request.codehash);
    expect(pending.standardVersion).to.equal(2);
    expect(pending.executableAt - pending.requestedAt).to.equal(48n * 60n * 60n);
    await expect(
      foundation.controller.finalizeUpgrade(predicted),
    ).to.be.revertedWithCustomError(
      foundation.controller,
      "UpgradeNotReady",
    );
  });

  it("allows transaction-authorized cancellation but not outsider cancellation", async function () {
    const foundation = await deployFoundation();
    const { account, predicted } = await createAccount(foundation);
    const logicV2 = await ethers.deployContract("BoundedLogicMock", [2]);
    await logicV2.waitForDeployment();
    const latest = await ethers.provider.getBlock("latest");
    const request = {
      implementation: await logicV2.getAddress(),
      codehash: ethers.keccak256(
        await ethers.provider.getCode(await logicV2.getAddress()),
      ),
      standardVersion: 2,
      validAfter: 0,
      deadline: Number(latest!.timestamp) + 7 * 24 * 60 * 60,
      requestId: ethers.id("phase-3a-cancel"),
    };
    const upgradeDigest = await foundation.controller.getUpgradeDigest(
      predicted,
      request,
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(
          account,
          account.interface.encodeFunctionData("requestUpgrade", [
            request,
            signWebAuthn(upgradeDigest, TRANSACTION_KEY),
            signWebAuthn(upgradeDigest, EVOLUTION_KEY),
          ]),
        ),
      )
    ).wait();

    await expect(
      foundation.controller
        .connect(foundation.outsider)
        .cancelUpgrade(predicted, request.requestId, "0x"),
    ).to.be.revertedWithCustomError(
      foundation.controller,
      "UnauthorizedAccountCaller",
    );

    const cancellationDigest =
      await foundation.controller.getCancellationDigest(
        predicted,
        request.requestId,
      );
    const cancellationCall = account.interface.encodeFunctionData(
      "cancelUpgrade",
      [request.requestId, signWebAuthn(cancellationDigest, TRANSACTION_KEY)],
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(account, cancellationCall),
      )
    ).wait();

    expect(
      (await foundation.controller.pendingUpgrade(predicted)).requestId,
    ).to.equal(ethers.ZeroHash);
    await expect(
      foundation.controller.finalizeUpgrade(predicted),
    ).to.be.revertedWithCustomError(
      foundation.controller,
      "NoUpgradePending",
    );
  });

  it("permissionlessly finalizes the exact implementation after the delay", async function () {
    const foundation = await deployFoundation();
    const { account, predicted } = await createAccount(foundation);
    const logicV2 = await ethers.deployContract("BoundedLogicMock", [2]);
    await logicV2.waitForDeployment();
    const latest = await ethers.provider.getBlock("latest");
    const request = {
      implementation: await logicV2.getAddress(),
      codehash: ethers.keccak256(
        await ethers.provider.getCode(await logicV2.getAddress()),
      ),
      standardVersion: 2,
      validAfter: 0,
      deadline: Number(latest!.timestamp) + 7 * 24 * 60 * 60,
      requestId: ethers.id("phase-3a-finalize"),
    };
    const digest = await foundation.controller.getUpgradeDigest(
      predicted,
      request,
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(
          account,
          account.interface.encodeFunctionData("requestUpgrade", [
            request,
            signWebAuthn(digest, TRANSACTION_KEY),
            signWebAuthn(digest, EVOLUTION_KEY),
          ]),
        ),
      )
    ).wait();

    await ethers.provider.send("evm_increaseTime", [48 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await (
      await foundation.controller
        .connect(foundation.outsider)
        .finalizeUpgrade(predicted)
    ).wait();

    expect(
      await foundation.controller.currentImplementation(predicted),
    ).to.equal(request.implementation);
    expect(
      await foundation.controller.currentImplementationCodehash(predicted),
    ).to.equal(request.codehash);
    expect(
      await foundation.controller.currentStandardVersion(predicted),
    ).to.equal(2);
    expect(await foundation.controller.upgradeNonce(predicted)).to.equal(1);
  });

  it("rejects incompatible, wrong-codehash, and non-monotonic implementations", async function () {
    const foundation = await deployFoundation();
    const { account, predicted } = await createAccount(foundation);
    const latest = await ethers.provider.getBlock("latest");
    const requestBase = {
      validAfter: 0,
      deadline: Number(latest!.timestamp) + 7 * 24 * 60 * 60,
    };
    const incompatibleAddress = await foundation.receiver.getAddress();
    const incompatibleRequest = {
      ...requestBase,
      implementation: incompatibleAddress,
      codehash: ethers.keccak256(
        await ethers.provider.getCode(incompatibleAddress),
      ),
      standardVersion: 2,
      requestId: ethers.id("incompatible"),
    };

    const incompatibleCall = account.interface.encodeFunctionData(
      "requestUpgrade",
      [
        incompatibleRequest,
        signWebAuthn(
          await foundation.controller.getUpgradeDigest(
            predicted,
            incompatibleRequest,
          ),
          TRANSACTION_KEY,
        ),
        signWebAuthn(
          await foundation.controller.getUpgradeDigest(
            predicted,
            incompatibleRequest,
          ),
          EVOLUTION_KEY,
        ),
      ],
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(account, incompatibleCall),
      )
    ).wait();
    expect(
      (await foundation.controller.pendingUpgrade(predicted)).requestId,
    ).to.equal(ethers.ZeroHash);

    const logicV2 = await ethers.deployContract("BoundedLogicMock", [2]);
    await logicV2.waitForDeployment();
    const wrongHashRequest = {
      ...requestBase,
      implementation: await logicV2.getAddress(),
      codehash: ethers.id("wrong-codehash"),
      standardVersion: 2,
      requestId: ethers.id("wrong-hash"),
    };
    const wrongHashDigest = await foundation.controller.getUpgradeDigest(
      predicted,
      wrongHashRequest,
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(
          account,
          account.interface.encodeFunctionData("requestUpgrade", [
            wrongHashRequest,
            signWebAuthn(wrongHashDigest, TRANSACTION_KEY),
            signWebAuthn(wrongHashDigest, EVOLUTION_KEY),
          ]),
        ),
      )
    ).wait();
    expect(
      (await foundation.controller.pendingUpgrade(predicted)).requestId,
    ).to.equal(ethers.ZeroHash);

    const sameVersionRequest = {
      ...requestBase,
      implementation: await foundation.logicV1.getAddress(),
      codehash: ethers.keccak256(
        await ethers.provider.getCode(await foundation.logicV1.getAddress()),
      ),
      standardVersion: 1,
      requestId: ethers.id("same-version"),
    };
    const sameVersionDigest = await foundation.controller.getUpgradeDigest(
      predicted,
      sameVersionRequest,
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(
          account,
          account.interface.encodeFunctionData("requestUpgrade", [
            sameVersionRequest,
            signWebAuthn(sameVersionDigest, TRANSACTION_KEY),
            signWebAuthn(sameVersionDigest, EVOLUTION_KEY),
          ]),
        ),
      )
    ).wait();
    expect(
      (await foundation.controller.pendingUpgrade(predicted)).requestId,
    ).to.equal(ethers.ZeroHash);
  });

  it("keeps an approved malicious bounded implementation outside security boundaries", async function () {
    const foundation = await deployFoundation();
    const { account, predicted, initialization } = await createAccount(foundation);
    const malicious = await ethers.deployContract("MaliciousBoundedLogicMock", [2]);
    await malicious.waitForDeployment();

    const latest = await ethers.provider.getBlock("latest");
    const maliciousRequest = {
      implementation: await malicious.getAddress(),
      codehash: ethers.keccak256(
        await ethers.provider.getCode(await malicious.getAddress()),
      ),
      standardVersion: 2,
      validAfter: 0,
      deadline: Number(latest!.timestamp) + 7 * 24 * 60 * 60,
      requestId: ethers.id("malicious-implementation"),
    };
    const upgradeDigest = await foundation.controller.getUpgradeDigest(
      predicted,
      maliciousRequest,
    );
    const requestUpgradeCall = account.interface.encodeFunctionData(
      "requestUpgrade",
      [
        maliciousRequest,
        signWebAuthn(upgradeDigest, TRANSACTION_KEY),
        signWebAuthn(upgradeDigest, EVOLUTION_KEY),
      ],
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(account, requestUpgradeCall),
      )
    ).wait();

    await ethers.provider.send("evm_increaseTime", [48 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await (
      await foundation.controller
        .connect(foundation.outsider)
        .finalizeUpgrade(predicted)
    ).wait();

    expect(
      await foundation.controller.currentImplementation(predicted),
    ).to.equal(await malicious.getAddress());
    expect(
      await foundation.controller.isImplementationApproved(
        predicted,
        maliciousRequest.codehash,
      ),
    ).to.equal(true);

    const receiverPayload = foundation.receiver.interface.encodeFunctionData(
      "emitTest",
      [ethers.toUtf8Bytes("malicious-external-call")],
    );
    await expect(
      malicious
        .connect(foundation.outsider)
        .attemptExternalCall(
          await foundation.receiver.getAddress(),
          receiverPayload,
        ),
    )
      .to.emit(foundation.receiver, "TestExecuted")
      .withArgs(
        await malicious.getAddress(),
        0,
        ethers.toUtf8Bytes("malicious-external-call"),
      );

    const authorityMutation = foundation.authority.interface.encodeFunctionData(
      "initializeAccount",
      [predicted, initialization, "0x"],
    );
    const controllerMutation = foundation.controller.interface.encodeFunctionData(
      "requestUpgrade",
      [predicted, maliciousRequest, "0x", "0x"],
    );
    const cancellationMutation = foundation.controller.interface.encodeFunctionData(
      "cancelUpgrade",
      [predicted, maliciousRequest.requestId, "0x"],
    );
    const kernelExecution = account.interface.encodeFunctionData("execute", [
      EXECUTE_MODE,
      "0x",
    ]);
    const emptyUserOp = {
      sender: predicted,
      nonce: 0n,
      initCode: "0x",
      callData: "0x",
      accountGasLimits: packUint128Pair(0n, 0n),
      preVerificationGas: 0n,
      gasFees: packUint128Pair(0n, 0n),
      paymasterAndData: "0x",
      signature: "0x",
    };
    const entryPointMutation = account.interface.encodeFunctionData(
      "validateUserOp",
      [emptyUserOp, ethers.ZeroHash, 0n],
    );
    const unknownSelector = "0xdeadbeef";

    for (const [target, data] of [
      [await foundation.authority.getAddress(), authorityMutation],
      [await foundation.controller.getAddress(), controllerMutation],
      [await foundation.controller.getAddress(), cancellationMutation],
      [predicted, kernelExecution],
      [predicted, entryPointMutation],
      [predicted, unknownSelector],
    ]) {
      const [success] = await malicious
        .connect(foundation.outsider)
        .attemptExternalCall.staticCall(target, data);
      expect(success, `${target} accepted hostile bounded-logic call`).to.equal(
        false,
      );
    }

    const [delegatecallSuccess] = await malicious
      .connect(foundation.outsider)
      .attemptDelegatecall.staticCall(predicted, kernelExecution);
    expect(delegatecallSuccess).to.equal(false);

    const logicV3 = await ethers.deployContract("BoundedLogicMock", [3]);
    await logicV3.waitForDeployment();
    const nextRequest = {
      implementation: await logicV3.getAddress(),
      codehash: ethers.keccak256(
        await ethers.provider.getCode(await logicV3.getAddress()),
      ),
      standardVersion: 3,
      validAfter: 0,
      deadline: Number((await ethers.provider.getBlock("latest"))!.timestamp) +
        7 * 24 * 60 * 60,
      requestId: ethers.id("malicious-timelock-target"),
    };
    const nextDigest = await foundation.controller.getUpgradeDigest(
      predicted,
      nextRequest,
    );
    await (
      await submitUserOperation(
        foundation.bundler,
        await buildUserOperation(
          account,
          account.interface.encodeFunctionData("requestUpgrade", [
            nextRequest,
            signWebAuthn(nextDigest, TRANSACTION_KEY),
            signWebAuthn(nextDigest, EVOLUTION_KEY),
          ]),
        ),
      )
    ).wait();

    const finalizePayload = foundation.controller.interface.encodeFunctionData(
      "finalizeUpgrade",
      [predicted],
    );
    const [earlyFinalizeSuccess] = await malicious
      .connect(foundation.outsider)
      .attemptExternalCall.staticCall(
        await foundation.controller.getAddress(),
        finalizePayload,
      );
    expect(earlyFinalizeSuccess).to.equal(false);
    expect(
      (await foundation.controller.pendingUpgrade(predicted)).requestId,
    ).to.equal(nextRequest.requestId);
  });
});