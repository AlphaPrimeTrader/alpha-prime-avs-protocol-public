import { p256 } from "@noble/curves/p256";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ARGON2ID_MEMORY_KIB,
  RECOVERY_KIT_VERSION,
  canProceedToPhase3BAccountCreation,
  createRecoveryKit,
  createRecoveryKitDraft,
  openRecoveryKit,
  parseRecoveryKit,
  type RecoveryKit,
} from "./recovery-kit";

const account = {
  address: "0x1111111111111111111111111111111111111111",
  authority: "0x2222222222222222222222222222222222222222",
  chainId: "97",
  rpIdHash:
    "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763",
};
const password = "correct horse battery staple";

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
};

const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

const fromBase64Url = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, "base64url"));

const toHex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString("hex")}`;

const withoutChecksum = (kit: RecoveryKit) => ({
  format: kit.format,
  version: kit.version,
  createdAt: kit.createdAt,
  account: kit.account,
  recoveryPublicKey: kit.recoveryPublicKey,
  kdf: kit.kdf,
  encryption: kit.encryption,
});

const aadObject = (kit: RecoveryKit) => ({
  format: kit.format,
  version: kit.version,
  createdAt: kit.createdAt,
  account: kit.account,
  recoveryPublicKey: kit.recoveryPublicKey,
  kdf: kit.kdf,
  encryption: {
    name: kit.encryption.name,
    iv: kit.encryption.iv,
  },
});

async function recalculateUnkeyedEnvelope(
  kit: RecoveryKit,
  updateAad = false,
): Promise<string> {
  if (updateAad) {
    kit.encryption.aad = toBase64Url(
      new TextEncoder().encode(canonicalize(aadObject(kit))),
    );
  }
  kit.checksum.value = toBase64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalize(withoutChecksum(kit))),
      ),
    ),
  );
  return JSON.stringify(kit);
}

const clone = (serialized: string): RecoveryKit =>
  JSON.parse(serialized) as RecoveryKit;

describe("Offline Recovery Kit cryptography", () => {
  let serialized: string;
  let original: RecoveryKit;

  beforeAll(async () => {
    const created = await createRecoveryKit(account, password);
    serialized = created.serialized;
    original = parseRecoveryKit(serialized);
  }, 60_000);

  it("round-trips locally and signs the exact 32-byte recovery digest", async () => {
    const session = await openRecoveryKit(serialized, password);
    try {
      const digest = new Uint8Array(32);
      digest[31] = 9;
      const signature = session.signRecoveryDigest(toHex(digest));
      const publicPoint = Uint8Array.from([
        4,
        ...Buffer.from(session.recoveryPublicKey.qx.slice(2), "hex"),
        ...Buffer.from(session.recoveryPublicKey.qy.slice(2), "hex"),
      ]);
      expect(p256.verify(signature.slice(2), digest, publicPoint)).to.equal(true);
      expect(session.account).to.deep.equal(account);
    } finally {
      session.destroy();
    }
  }, 60_000);

  it("rejects a wrong password", async () => {
    await expect(
      openRecoveryKit(serialized, "wrong password that is long"),
    ).rejects.toThrow("authentication failed");
  }, 60_000);

  it("rejects corrupted ciphertext even after checksum recalculation", async () => {
    const kit = clone(serialized);
    const ciphertext = fromBase64Url(kit.encryption.ciphertext);
    ciphertext[Math.floor(ciphertext.length / 2)] ^= 1;
    kit.encryption.ciphertext = toBase64Url(ciphertext);
    await expect(
      openRecoveryKit(await recalculateUnkeyedEnvelope(kit), password),
    ).rejects.toThrow("authentication failed");
  }, 60_000);

  it("rejects a corrupted GCM tag even after checksum recalculation", async () => {
    const kit = clone(serialized);
    const ciphertextAndTag = fromBase64Url(kit.encryption.ciphertext);
    ciphertextAndTag[ciphertextAndTag.length - 1] ^= 1;
    kit.encryption.ciphertext = toBase64Url(ciphertextAndTag);
    await expect(
      openRecoveryKit(await recalculateUnkeyedEnvelope(kit), password),
    ).rejects.toThrow("authentication failed");
  }, 60_000);

  it("rejects modified salt and IV even when unkeyed AAD/checksum are recalculated", async () => {
    for (const field of ["salt", "iv"] as const) {
      const kit = clone(serialized);
      const bytes =
        field === "salt"
          ? fromBase64Url(kit.kdf.salt)
          : fromBase64Url(kit.encryption.iv);
      bytes[0] ^= 1;
      if (field === "salt") kit.kdf.salt = toBase64Url(bytes);
      else kit.encryption.iv = toBase64Url(bytes);
      await expect(
        openRecoveryKit(
          await recalculateUnkeyedEnvelope(kit, true),
          password,
        ),
      ).rejects.toThrow("authentication failed");
    }
  }, 120_000);

  it("rejects a modified checksum", async () => {
    const kit = clone(serialized);
    const checksum = fromBase64Url(kit.checksum.value);
    checksum[0] ^= 1;
    kit.checksum.value = toBase64Url(checksum);
    await expect(openRecoveryKit(JSON.stringify(kit), password)).rejects.toThrow(
      "checksum validation failed",
    );
  });

  it.each([
    ["account", "address", "0x3333333333333333333333333333333333333333"],
    ["account", "authority", "0x4444444444444444444444444444444444444444"],
    ["account", "chainId", "56"],
    [
      "account",
      "rpIdHash",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
  ])(
    "rejects modified %s.%s after attacker recalculates AAD and checksum",
    async (section, field, value) => {
      const kit = clone(serialized);
      (kit[section as "account"] as unknown as Record<string, string>)[field] =
        value;
      await expect(
        openRecoveryKit(
          await recalculateUnkeyedEnvelope(kit, true),
          password,
        ),
      ).rejects.toThrow("authentication failed");
    },
    60_000,
  );

  it("rejects a modified but valid P-256 recovery public key after envelope recalculation", async () => {
    const kit = clone(serialized);
    const privateKey = new Uint8Array(32);
    privateKey[31] = 7;
    const point = p256.getPublicKey(privateKey, false);
    kit.recoveryPublicKey = {
      qx: toHex(point.subarray(1, 33)),
      qy: toHex(point.subarray(33, 65)),
    };
    await expect(
      openRecoveryKit(
        await recalculateUnkeyedEnvelope(kit, true),
        password,
      ),
    ).rejects.toThrow("authentication failed");
  }, 60_000);

  it("rejects unsupported KDF parameters and format versions", () => {
    const badKdf = clone(serialized);
    (badKdf.kdf as { name: string }).name = "pbkdf2";
    expect(() => parseRecoveryKit(JSON.stringify(badKdf))).toThrow(
      "Unsupported Recovery Kit KDF",
    );

    const badVersion = clone(serialized);
    (badVersion as { version: number }).version = RECOVERY_KIT_VERSION + 1;
    expect(() => parseRecoveryKit(JSON.stringify(badVersion))).toThrow(
      "Unsupported Recovery Kit version",
    );
  });

  it("rejects malformed JSON and truncated ciphertext", () => {
    expect(() => parseRecoveryKit("{not-json")).toThrow(
      "Recovery Kit JSON is malformed",
    );
    const truncated = clone(serialized);
    truncated.encryption.ciphertext = toBase64Url(new Uint8Array(8));
    expect(() => parseRecoveryKit(JSON.stringify(truncated))).toThrow(
      "encrypted data is truncated",
    );
  });

  it("exports no plaintext private scalar and records the approved Argon2id cost", () => {
    expect(serialized).not.toContain("recoveryPrivateScalar");
    expect(original.kdf.memoryKiB).to.equal(ARGON2ID_MEMORY_KIB);
    expect(original.kdf.iterations).to.equal(3);
    expect(original.kdf.parallelism).to.equal(1);
    expect(original.kdf.outputBytes).to.equal(32);
  });

  it("blocks account creation after generation, encryption, export, or confirmation failure", () => {
    expect(
      canProceedToPhase3BAccountCreation({
        kitGenerated: false,
        exportSucceeded: false,
        backupConfirmed: false,
      }),
    ).to.equal(false);
    expect(
      canProceedToPhase3BAccountCreation({
        kitGenerated: true,
        exportSucceeded: false,
        backupConfirmed: false,
      }),
    ).to.equal(false);
    expect(
      canProceedToPhase3BAccountCreation({
        kitGenerated: true,
        exportSucceeded: true,
        backupConfirmed: false,
      }),
    ).to.equal(false);
    expect(
      canProceedToPhase3BAccountCreation({
        kitGenerated: true,
        exportSucceeded: true,
        backupConfirmed: true,
      }),
    ).to.equal(true);
  });

  it("keeps a prediction draft opaque while encrypting the same public key for bound metadata", async () => {
    const draft = createRecoveryKitDraft();
    try {
      const created = await draft.encryptForAccount(account, password);
      expect(created.recoveryPublicKey).to.deep.equal(draft.recoveryPublicKey);
      const session = await openRecoveryKit(created.serialized, password);
      try {
        expect(session.recoveryPublicKey).to.deep.equal(draft.recoveryPublicKey);
      } finally {
        session.destroy();
      }
    } finally {
      draft.destroy();
    }
  }, 60_000);
});