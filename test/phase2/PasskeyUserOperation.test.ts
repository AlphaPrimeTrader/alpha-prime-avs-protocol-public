import { createHash, createPrivateKey, sign as signWithNode } from "node:crypto";
import { expect } from "chai";
import { network } from "hardhat";

import {
  ENTRYPOINT_V08_ADDRESS,
  ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH,
  getEntryPointV08RuntimeHash,
  getEntryPointV08RuntimeBytecode,
} from "../fixtures/entrypoint-v08-runtime";

const { ethers } = await network.create();

const KEY_A = {
  qx: "0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
  qy: "0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
};

const KEY_B = {
  qx: "0x7cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978",
  qy: "0x07775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d1",
};

const ENTRYPOINT_ABI = [
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address payable beneficiary)",
];

const ENTRYPOINT = new ethers.Contract(
  ENTRYPOINT_V08_ADDRESS,
  ENTRYPOINT_ABI,
  ethers.provider,
);

const toBase64Url = (value: Uint8Array): string =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const hexToBuffer = (value: string): Buffer =>
  Buffer.from(value.replace(/^0x/, ""), "hex");

function installEntryPoint() {
  return ethers.provider.send("hardhat_setCode", [
    ENTRYPOINT_V08_ADDRESS,
    getEntryPointV08RuntimeBytecode(),
  ]);
}

async function deploySystem() {
  await installEntryPoint();
  const [deployer, bundler] = await ethers.getSigners();
  const implementation = await ethers.deployContract("AVSAccount");
  await implementation.waitForDeployment();
  const factory = await ethers.deployContract("AVSAccountFactory", [
    await implementation.getAddress(),
  ]);
  await factory.waitForDeployment();
  const receiver = await ethers.deployContract("TestReceiver");
  await receiver.waitForDeployment();

  const predicted = await factory.predictAccount(
    KEY_A.qx,
    KEY_A.qy,
    ethers.id("phase-2-account"),
  );
  await (
    await factory.createAccount(
      KEY_A.qx,
      KEY_A.qy,
      ethers.id("phase-2-account"),
    )
  ).wait();
  const account = await ethers.getContractAt("AVSAccount", predicted);
  const predictedB = await factory.predictAccount(
    KEY_B.qx,
    KEY_B.qy,
    ethers.id("phase-2-account-b"),
  );
  await (
    await factory.createAccount(
      KEY_B.qx,
      KEY_B.qy,
      ethers.id("phase-2-account-b"),
    )
  ).wait();
  const accountB = await ethers.getContractAt("AVSAccount", predictedB);
  await (
    await deployer.sendTransaction({
      to: predicted,
      value: ethers.parseEther("2"),
    })
  ).wait();
  await (
    await deployer.sendTransaction({
      to: predictedB,
      value: ethers.parseEther("2"),
    })
  ).wait();

  return { deployer, bundler, account, accountB, receiver };
}

function packUint128Pair(first: bigint, second: bigint): string {
  return ethers.concat([
    ethers.zeroPadValue(ethers.toBeHex(first), 16),
    ethers.zeroPadValue(ethers.toBeHex(second), 16),
  ]);
}

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

function signWebAuthnChallenge(
  userOpHash: string,
  challengeHash = userOpHash,
  key = KEY_A,
  privateScalar = 1n,
): string {
  const challenge = toBase64Url(hexToBuffer(challengeHash));
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"http://localhost"}`;
  const authenticatorData = Buffer.concat([
    Buffer.alloc(32),
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
        Buffer.from(privateScalar.toString(16).padStart(64, "0"), "hex"),
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
  const challengeIndex = clientDataJSON.indexOf('"challenge":"');
  const typeIndex = clientDataJSON.indexOf('"type":"webauthn.get"');
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "bytes32",
      "uint256",
      "uint256",
      "bytes",
      "string",
    ],
    [r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON],
  );
}

async function buildUserOperation(
  account: Awaited<ReturnType<typeof deploySystem>>["account"],
  receiver: Awaited<ReturnType<typeof deploySystem>>["receiver"],
  key = KEY_A,
  privateScalar = 1n,
) {
  const receiverCallData = receiver.interface.encodeFunctionData("emitTest", [
    ethers.toUtf8Bytes("phase-2-proof"),
  ]);
  const executionData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address target,uint256 value,bytes callData)[]"],
    [[
      {
        target: await receiver.getAddress(),
        value: 0n,
        callData: receiverCallData,
      },
    ]],
  );
  const mode =
    "0x0100000000000000000000000000000000000000000000000000000000000000";
  const callData = account.interface.encodeFunctionData("execute", [
    mode,
    executionData,
  ]);
  const userOp = {
    sender: await account.getAddress(),
    nonce: await ENTRYPOINT.getNonce(await account.getAddress(), 0),
    initCode: "0x",
    callData,
    accountGasLimits: packUint128Pair(900_000n, 900_000n),
    preVerificationGas: 60_000n,
    gasFees: packUint128Pair(1_000_000_000n, 2_000_000_000n),
    paymasterAndData: "0x",
    signature: "0x",
  };
  const userOpHash = await ENTRYPOINT.getUserOpHash(userOp);
  return {
    userOp,
    userOpHash,
    receiverCallData,
    signature: signWebAuthnChallenge(
      userOpHash,
      userOpHash,
      key,
      privateScalar,
    ),
  };
}

function encodeAccountExecution(
  account: Awaited<ReturnType<typeof deploySystem>>["account"],
  target: string,
  value: bigint,
  targetCallData: string,
): string {
  const executionData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address target,uint256 value,bytes callData)[]"],
    [[{ target, value, callData: targetCallData }]],
  );
  const mode =
    "0x0100000000000000000000000000000000000000000000000000000000000000";
  return account.interface.encodeFunctionData("execute", [mode, executionData]);
}

describe("Phase 2 Passkey UserOperations", function () {
  it("installs canonical EntryPoint v0.8 and executes a valid WebAuthn operation", async function () {
    const { bundler, account, receiver } = await deploySystem();
    const built = await buildUserOperation(account, receiver);
    const signed = { ...built.userOp, signature: built.signature };
    const harness = await ethers.deployContract("WebAuthnHarness");
    const [r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON] =
      ethers.AbiCoder.defaultAbiCoder().decode(
      [
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "bytes",
        "string",
      ],
      built.signature,
    );
    const authValue = {
      r,
      s,
      challengeIndex,
      typeIndex,
      authenticatorData,
      clientDataJSON,
    };
    const clientDataHash = createHash("sha256")
      .update(clientDataJSON)
      .digest();
    const signatureHash = createHash("sha256")
      .update(Buffer.concat([hexToBuffer(authenticatorData), clientDataHash]))
      .digest();
    expect(
      await harness.verifyP256(
        signatureHash,
        r,
        s,
        KEY_A.qx,
        KEY_A.qy,
      ),
    ).to.equal(true);
    expect(
      await harness.verifyWebAuthn(
        built.userOpHash,
        authValue,
        KEY_A.qx,
        KEY_A.qy,
      ),
    ).to.equal(true);
    expect(await ENTRYPOINT.getUserOpHash(signed)).to.equal(built.userOpHash);
    await ethers.provider.send("hardhat_setBalance", [
      ENTRYPOINT_V08_ADDRESS,
      "0x56BC75E2D63100000",
    ]);
    await ethers.provider.send("hardhat_impersonateAccount", [
      ENTRYPOINT_V08_ADDRESS,
    ]);
    const entryPointSigner = await ethers.getSigner(ENTRYPOINT_V08_ADDRESS);
    expect(
      await account
        .connect(entryPointSigner)
        .validateUserOp.staticCall(signed, built.userOpHash, 0),
    ).to.equal(0n);

    const receipt = await (
      await ENTRYPOINT.connect(bundler).handleOps(
        [signed],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      )
    ).wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return receiver.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TestExecuted");

    expect(
      ethers.keccak256(await ethers.provider.getCode(ENTRYPOINT_V08_ADDRESS)),
    ).to.equal(getEntryPointV08RuntimeHash());
    expect(getEntryPointV08RuntimeHash(97n)).to.equal(
      ENTRYPOINT_V08_BSC_TESTNET_RUNTIME_HASH,
    );
    expect(event?.args.account).to.equal(await account.getAddress());
    expect(event?.args.data).to.equal(
      ethers.hexlify(ethers.toUtf8Bytes("phase-2-proof")),
    );
  });

  it("executes independently for a second account with a different Passkey", async function () {
    const { bundler, accountB, receiver } = await deploySystem();
    const built = await buildUserOperation(accountB, receiver, KEY_B, 2n);
    const receipt = await (
      await ENTRYPOINT.connect(bundler).handleOps(
        [{ ...built.userOp, signature: built.signature }],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      )
    ).wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return receiver.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TestExecuted");

    expect(event?.args.account).to.equal(await accountB.getAddress());
    expect(await accountB.signer()).to.deep.equal([KEY_B.qx, KEY_B.qy]);
  });

  for (const mutation of ["target", "calldata", "value", "nonce"] as const) {
    it(`rejects a signed UserOperation after its ${mutation} is modified`, async function () {
      const { bundler, account, receiver } = await deploySystem();
      const built = await buildUserOperation(account, receiver);
      let callData = built.userOp.callData;
      let nonce = built.userOp.nonce;

      if (mutation === "target") {
        callData = encodeAccountExecution(
          account,
          ethers.ZeroAddress,
          0n,
          built.receiverCallData,
        );
      } else if (mutation === "calldata") {
        callData = encodeAccountExecution(
          account,
          await receiver.getAddress(),
          0n,
          receiver.interface.encodeFunctionData("emitTest", [
            ethers.toUtf8Bytes("tampered-payload"),
          ]),
        );
      } else if (mutation === "value") {
        callData = encodeAccountExecution(
          account,
          await receiver.getAddress(),
          1n,
          built.receiverCallData,
        );
      } else {
        nonce += 1n;
      }

      await expect(
        ENTRYPOINT.connect(bundler).handleOps(
          [{
            ...built.userOp,
            callData,
            nonce,
            signature: built.signature,
          }],
          await bundler.getAddress(),
          { gasLimit: 1_500_000n },
        ),
      ).to.revert(ethers);
    });
  }

  it("rejects a replay with the already-consumed nonce", async function () {
    const { bundler, account, receiver } = await deploySystem();
    const built = await buildUserOperation(account, receiver);
    const signed = { ...built.userOp, signature: built.signature };
    await (
      await ENTRYPOINT.connect(bundler).handleOps(
        [signed],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      )
    ).wait();

    await expect(
      ENTRYPOINT.connect(bundler).handleOps(
        [signed],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      ),
    ).to.revert(ethers);
  });

  it("rejects random P-256 signatures and malformed WebAuthn data", async function () {
    const { bundler, account, receiver } = await deploySystem();
    const built = await buildUserOperation(account, receiver);
    const randomSignature = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "bytes",
        "string",
      ],
      [
        ethers.keccak256(ethers.toUtf8Bytes("random-r")),
        ethers.keccak256(ethers.toUtf8Bytes("random-s")),
        1,
        1,
        "0x",
        "{}",
      ],
    );

    await expect(
      ENTRYPOINT.connect(bundler).handleOps(
        [{ ...built.userOp, signature: randomSignature }],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      ),
    ).to.revert(ethers);

    await expect(
      ENTRYPOINT.connect(bundler).handleOps(
        [{ ...built.userOp, signature: "0x1234" }],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      ),
    ).to.revert(ethers);
  });

  it("rejects a valid P-256 signature with the wrong WebAuthn challenge", async function () {
    const { bundler, account, receiver } = await deploySystem();
    const built = await buildUserOperation(account, receiver);
    const wrongChallenge = signWebAuthnChallenge(
      built.userOpHash,
      ethers.keccak256(ethers.toUtf8Bytes("wrong-challenge")),
    );

    await expect(
      ENTRYPOINT.connect(bundler).handleOps(
        [{ ...built.userOp, signature: wrongChallenge }],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      ),
    ).to.revert(ethers);
  });

  it("allows a bundler-only EOA to submit without becoming the account signer", async function () {
    const { bundler, account, receiver } = await deploySystem();
    const built = await buildUserOperation(account, receiver);

    await (
      await ENTRYPOINT.connect(bundler).handleOps(
        [{ ...built.userOp, signature: built.signature }],
        await bundler.getAddress(),
        { gasLimit: 1_500_000n },
      )
    ).wait();
    expect(await account.signer()).to.deep.equal([KEY_A.qx, KEY_A.qy]);
  });
});