import { createECDH, createHash, createPrivateKey, sign as nodeSign } from "node:crypto";
import { p256 } from "@noble/curves/p256";
import { expect } from "chai";
import { network } from "hardhat";

import { ENTRYPOINT_V08_ADDRESS, getEntryPointV08RuntimeBytecode } from "../fixtures/entrypoint-v08-runtime";

const { ethers } = await network.create();
const ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const RP_ID_HASH = `0x${createHash("sha256").update("localhost").digest("hex")}`;

type Key = { qx: string; qy: string; scalar: bigint };
const key = (scalar: bigint): Key => {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(scalar.toString(16).padStart(64, "0"), "hex"));
  const point = ecdh.getPublicKey(undefined, "uncompressed");
  return { qx: `0x${point.subarray(1, 33).toString("hex")}`, qy: `0x${point.subarray(33).toString("hex")}`, scalar };
};
const A = key(1n), R1 = key(2n), B = key(3n), R2 = key(4n), C = key(5n), R3 = key(6n), EVOLUTION = key(7n);

const b64url = (v: Uint8Array) => Buffer.from(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function rawSign(digest: string, signer: Key) {
  return `0x${Buffer.from(p256.sign(Buffer.from(digest.slice(2), "hex"), Buffer.from(signer.scalar.toString(16).padStart(64, "0"), "hex"), { lowS: true }).toCompactRawBytes()).toString("hex")}`;
}
function highS(signature: string) {
  const bytes = ethers.getBytes(signature);
  return ethers.concat([bytes.slice(0, 32), ethers.zeroPadValue(ethers.toBeHex(ORDER - BigInt(ethers.hexlify(bytes.slice(32)))), 32)]);
}
function webAuthn(digest: string, signer: Key) {
  const challenge = b64url(Buffer.from(digest.slice(2), "hex"));
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"http://localhost"}`;
  const authenticatorData = Buffer.concat([Buffer.from(RP_ID_HASH.slice(2), "hex"), Buffer.from([5]), Buffer.alloc(4)]);
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: b64url(Buffer.from(signer.scalar.toString(16).padStart(64, "0"), "hex")), x: b64url(Buffer.from(signer.qx.slice(2), "hex")), y: b64url(Buffer.from(signer.qy.slice(2), "hex")) }, format: "jwk" });
  const raw = nodeSign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]), { key: privateKey, dsaEncoding: "ieee-p1363" });
  const s = BigInt(`0x${raw.subarray(32).toString("hex")}`);
  return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32", "uint256", "uint256", "bytes", "string"], [`0x${raw.subarray(0, 32).toString("hex")}`, ethers.zeroPadValue(ethers.toBeHex(s > ORDER / 2n ? ORDER - s : s), 32), clientDataJSON.indexOf('"challenge":"'), clientDataJSON.indexOf('"type":"webauthn.get"'), authenticatorData, clientDataJSON]);
}
async function impersonate(address: string) {
  await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  return ethers.getSigner(address);
}
const asPublic = (k: Key) => ({ qx: k.qx, qy: k.qy });
const keyHash = (k: Key) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32", "bytes32"], [ethers.id("AVSP256PublicKey(bytes32 qx,bytes32 qy)"), k.qx, k.qy]));

async function fixture() {
  const [deployer, outsider] = await ethers.getSigners();
  const authority = await ethers.deployContract("AVSAccountRecoveryAuthority");
  const account = ethers.Wallet.createRandom().address;
  const accountSigner = await impersonate(account);
  const initialization = { transactionKey: asPublic(A), recoveryKey: asPublic(R1), evolutionKey: asPublic(EVOLUTION), rpIdHash: RP_ID_HASH, factory: await deployer.getAddress(), userSalt: ethers.id(account), initialImplementation: await outsider.getAddress(), initialImplementationCodehash: ethers.ZeroHash, initialStandardVersion: 1n };
  await (await authority.connect(accountSigner).initializeAccount(account, initialization, webAuthn(await authority.getCreationDigest(account, initialization), A))).wait();
  return { authority, account, accountSigner, deployer, outsider };
}
function request(transaction: Key, recovery: Key, nonce: bigint, id = ethers.id(`request-${nonce}-${transaction.qx}`)) {
  return { newTransactionKey: asPublic(transaction), newRecoveryKey: asPublic(recovery), recoveryNonce: nonce, requestId: id };
}
async function signed(f: Awaited<ReturnType<typeof fixture>>, r: ReturnType<typeof request>, signer: Key) {
  return rawSign(await f.authority.getRecoveryDigest(f.account, r), signer);
}
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return [await f.authority.transactionKey(f.account), await f.authority.recoveryKey(f.account), await f.authority.transactionKeyVersion(f.account), await f.authority.recoveryKeyVersion(f.account), await f.authority.recoveryNonce(f.account)];
}

describe("Phase 3B atomic root rotation authority", function () {
  it("starts at 1/1 and atomically rotates A/R1 to B/R2, then B/R2 to C/R3", async function () {
    const f = await fixture();
    expect(await state(f)).to.deep.equal([[A.qx, A.qy], [R1.qx, R1.qy], 1n, 1n, 0n]);
    const first = request(B, R2, 0n);
    await (await f.authority.connect(f.accountSigner).requestRecovery(f.account, first, await signed(f, first, R1))).wait();
    expect(await state(f)).to.deep.equal([[B.qx, B.qy], [R2.qx, R2.qy], 2n, 2n, 1n]);
    const digest = ethers.id("immediate-authorization");
    expect(await f.authority.validateTransactionSignature(f.account, digest, webAuthn(digest, A))).to.equal(false);
    expect(await f.authority.validateTransactionSignature(f.account, digest, webAuthn(digest, B))).to.equal(true);
    const second = request(C, R3, 1n);
    await (await f.authority.connect(f.accountSigner).requestRecovery(f.account, second, await signed(f, second, R2))).wait();
    expect(await state(f)).to.deep.equal([[C.qx, C.qy], [R3.qx, R3.qy], 3n, 3n, 2n]);
    expect(await f.authority.validateTransactionSignature(f.account, digest, webAuthn(digest, B))).to.equal(false);
    expect(await f.authority.validateTransactionSignature(f.account, digest, webAuthn(digest, C))).to.equal(true);
    const third = request(A, R1, 2n);
    await expect(f.authority.connect(f.accountSigner).requestRecovery(f.account, third, await signed(f, third, R2))).to.be.revertedWithCustomError(f.authority, "InvalidRecoverySignature");
    expect(await f.authority.recoveryKey(f.account)).to.deep.equal([R3.qx, R3.qy]);
  });

  it("uses the exact ABI-encoded digest and rejects every substituted binding", async function () {
    const f = await fixture(), r = request(B, R2, 0n);
    const net = await ethers.provider.getNetwork();
    const typehash = await f.authority.RECOVERY_TYPEHASH(), domain = await f.authority.RECOVERY_DOMAIN(), action = await f.authority.RECOVERY_ACTION_ROTATE_TRANSACTION_AND_RECOVERY_KEYS();
    const digest = (o: Record<string, unknown> = {}) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","bytes32","address","address","uint256","bytes32","uint64","bytes32","uint64","bytes32","bytes32","bytes32","uint256","bytes32"],
      [typehash, domain, f.account, f.authority.target, net.chainId, keyHash(A), 1n, keyHash(R1), 1n, keyHash(B), keyHash(R2), action, 0n, r.requestId].map((v, i) => (Object.values(o)[0] !== undefined && i === Number(Object.keys(o)[0]) ? Object.values(o)[0] : v)),
    ));
    expect(await f.authority.getRecoveryDigest(f.account, r)).to.equal(digest());
    for (const [index, value] of [[2, await f.outsider.getAddress()], [3, await f.outsider.getAddress()], [4, net.chainId + 1n], [5, keyHash(B)], [6, 2n], [7, keyHash(R2)], [8, 2n], [9, keyHash(C)], [10, keyHash(R3)], [11, ethers.id("wrong-action")], [12, 1n], [13, ethers.id("other")]] as const) {
      await expect(f.authority.connect(f.accountSigner).requestRecovery(f.account, r, rawSign(digest({ [index]: value }), R1))).to.be.revertedWithCustomError(f.authority, "InvalidRecoverySignature");
    }
  });

  it("rejects replay, substitutions, invalid requests and signatures without changing either root", async function () {
    const f = await fixture(), good = request(B, R2, 0n), goodSig = await signed(f, good, R1);
    const unchanged = async (call: () => Promise<unknown>) => { const before = await state(f); await expect(call()).to.be.revert(ethers); expect(await state(f)).to.deep.equal(before); };
    await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, { ...good, requestId: ethers.ZeroHash }, goodSig));
    await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, request(A, R2, 0n), goodSig));
    await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, request(B, R1, 0n), goodSig));
    await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, { ...good, newTransactionKey: { qx: ethers.ZeroHash, qy: ethers.ZeroHash } }, goodSig));
    await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, { ...good, newRecoveryKey: { qx: ethers.ZeroHash, qy: ethers.ZeroHash } }, goodSig));
    for (const signature of [rawSign(await f.authority.getRecoveryDigest(f.account, good), B), rawSign(await f.authority.getRecoveryDigest(f.account, good), EVOLUTION), "0x1234", highS(goodSig)]) await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, good, signature));
    await (await f.authority.connect(f.accountSigner).requestRecovery(f.account, good, goodSig)).wait();
    await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, good, goodSig));
    await unchanged(() => f.authority.connect(f.accountSigner).requestRecovery(f.account, request(C, R3, 1n), rawSign(ethers.id("old-R1-cannot-authorize"), R1)));
  });
});

async function kernelFixture() {
  await ethers.provider.send("hardhat_setCode", [ENTRYPOINT_V08_ADDRESS, getEntryPointV08RuntimeBytecode()]);
  const [deployer, relayer, outsider] = await ethers.getSigners();
  const factory = await ethers.deployContract("AVSAccountRecoveryKernelFactory");
  const authority = await ethers.getContractAt("AVSAccountRecoveryAuthority", await factory.authority());
  const controller = await ethers.getContractAt("AVSEvolutionController", await factory.evolutionController());
  const logic = await ethers.deployContract("BoundedLogicMock", [1n]);
  const initialization = { transactionKey: asPublic(A), recoveryKey: asPublic(R1), evolutionKey: asPublic(EVOLUTION), rpIdHash: RP_ID_HASH, factory: await factory.getAddress(), userSalt: ethers.id("atomic-kernel"), initialImplementation: await logic.getAddress(), initialImplementationCodehash: ethers.keccak256(await ethers.provider.getCode(await logic.getAddress())), initialStandardVersion: 1n };
  const account = await factory.predictAccount(initialization);
  await (await factory.createAccount(initialization, webAuthn(await authority.getCreationDigest(account, initialization), A))).wait();
  return { deployer, relayer, outsider, factory, authority, controller, account, kernel: await ethers.getContractAt("AVSAccountRecoverySecurityKernel", account) };
}
describe("Phase 3B atomic root rotation kernel", function () {
  it("allows permissionless kernel relay, rejects direct authority callers, and preserves all kernel assets", async function () {
    const f = await kernelFixture(), r = request(B, R2, 0n);
    await f.deployer.sendTransaction({ to: f.account, value: ethers.parseEther("1") });
    const before = [await f.kernel.authority(), await f.kernel.evolutionController(), await f.kernel.creationFactory(), await f.controller.currentImplementation(f.account), await ethers.provider.getCode(f.account), await ethers.provider.getBalance(f.account)];
    const sig = rawSign(await f.authority.getRecoveryDigest(f.account, r), R1);
    for (const signer of [f.deployer, f.relayer, f.outsider]) await expect(f.authority.connect(signer).requestRecovery(f.account, r, sig)).to.be.revertedWithCustomError(f.authority, "UnauthorizedAccountCaller");
    await (await f.kernel.connect(f.relayer).requestRecovery(r, sig)).wait();
    expect([await f.kernel.authority(), await f.kernel.evolutionController(), await f.kernel.creationFactory(), await f.controller.currentImplementation(f.account), await ethers.provider.getCode(f.account), await ethers.provider.getBalance(f.account)]).to.deep.equal(before);
    expect(await f.authority.recoveryKey(f.account)).to.deep.equal([R2.qx, R2.qy]);
  });

  it("stales an A-authorized upgrade after rotation and lets B cancel it through the EntryPoint account path", async function () {
    const f = await kernelFixture();
    const entryPoint = await impersonate(ENTRYPOINT_V08_ADDRESS);
    const v2 = await ethers.deployContract("BoundedLogicMock", [2n]);
    await v2.waitForDeployment();
    const latest = await ethers.provider.getBlock("latest");
    const upgrade = {
      implementation: await v2.getAddress(),
      codehash: ethers.keccak256(await ethers.provider.getCode(await v2.getAddress())),
      standardVersion: 2n,
      validAfter: 0n,
      deadline: BigInt(latest!.timestamp) + 7n * 24n * 60n * 60n,
      requestId: ethers.id("must-stale-after-root-rotation"),
    };
    const upgradeDigest = await f.controller.getUpgradeDigest(f.account, upgrade);
    await (
      await f.kernel.connect(entryPoint).requestUpgrade(
        upgrade,
        webAuthn(upgradeDigest, A),
        webAuthn(upgradeDigest, EVOLUTION),
      )
    ).wait();
    const pending = await f.controller.pendingUpgrade(f.account);
    expect(pending.transactionKeyVersion).to.equal(1n);

    const recovery = request(B, R2, 0n);
    await (
      await f.kernel.connect(f.relayer).requestRecovery(
        recovery,
        rawSign(await f.authority.getRecoveryDigest(f.account, recovery), R1),
      )
    ).wait();
    expect(await f.authority.transactionKeyVersion(f.account)).to.equal(2n);

    // R1 has no authority over the exact digest formed from the new B/R2 roots.
    const postRotation = request(C, R3, 1n);
    const postRotationDigest = await f.authority.getRecoveryDigest(f.account, postRotation);
    await expect(
      f.kernel.connect(f.relayer).requestRecovery(postRotation, rawSign(postRotationDigest, R1)),
    ).to.be.revertedWithCustomError(f.authority, "InvalidRecoverySignature");
    expect(await f.authority.validateEvolutionAuthorization(
      f.account,
      ethers.id("evolution-semantics-survive-recovery"),
      webAuthn(ethers.id("evolution-semantics-survive-recovery"), B),
      webAuthn(ethers.id("evolution-semantics-survive-recovery"), EVOLUTION),
    )).to.equal(true);
    expect(await f.authority.validateEvolutionAuthorization(
      f.account,
      ethers.id("evolution-semantics-survive-recovery"),
      webAuthn(ethers.id("evolution-semantics-survive-recovery"), A),
      webAuthn(ethers.id("evolution-semantics-survive-recovery"), EVOLUTION),
    )).to.equal(false);

    const implementationBefore = await f.controller.currentImplementation(f.account);
    const versionBefore = await f.controller.currentStandardVersion(f.account);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(pending.executableAt)]);
    await expect(f.controller.connect(f.outsider).finalizeUpgrade(f.account))
      .to.be.revertedWithCustomError(f.controller, "StaleTransactionKeyVersion")
      .withArgs(1n, 2n);
    expect(await f.controller.currentImplementation(f.account)).to.equal(implementationBefore);
    expect(await f.controller.currentStandardVersion(f.account)).to.equal(versionBefore);

    const cancellationDigest = await f.controller.getCancellationDigest(f.account, upgrade.requestId);
    await (
      await f.kernel.connect(entryPoint).cancelUpgrade(
        upgrade.requestId,
        webAuthn(cancellationDigest, B),
      )
    ).wait();
    expect((await f.controller.pendingUpgrade(f.account)).requestId).to.equal(ethers.ZeroHash);
  });
});