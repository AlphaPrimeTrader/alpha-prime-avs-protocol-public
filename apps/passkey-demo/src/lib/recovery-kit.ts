import { p256 } from "@noble/curves/p256";
import { argon2id } from "hash-wasm";

export const RECOVERY_KIT_FORMAT = "alpha-prime-offline-recovery-kit";
export const RECOVERY_KIT_VERSION = 1;
export const ARGON2ID_IMPLEMENTATION = "hash-wasm";
export const ARGON2ID_VERSION = "4.12.0";
export const ARGON2ID_MEMORY_KIB = 65_536;
export const ARGON2ID_ITERATIONS = 3;
export const ARGON2ID_PARALLELISM = 1;
export const ARGON2ID_OUTPUT_BYTES = 32;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type RecoveryPublicKey = {
  qx: string;
  qy: string;
};

export type RecoveryKitAccount = {
  address: string;
  authority: string;
  chainId: string;
  rpIdHash: string;
};

export type RecoveryKit = {
  format: typeof RECOVERY_KIT_FORMAT;
  version: typeof RECOVERY_KIT_VERSION;
  createdAt: string;
  account: RecoveryKitAccount;
  recoveryPublicKey: RecoveryPublicKey;
  kdf: {
    name: "argon2id";
    implementation: typeof ARGON2ID_IMPLEMENTATION;
    implementationVersion: typeof ARGON2ID_VERSION;
    argonVersion: 19;
    memoryKiB: typeof ARGON2ID_MEMORY_KIB;
    iterations: typeof ARGON2ID_ITERATIONS;
    parallelism: typeof ARGON2ID_PARALLELISM;
    outputBytes: typeof ARGON2ID_OUTPUT_BYTES;
    salt: string;
  };
  encryption: {
    name: "AES-256-GCM";
    iv: string;
    aad: string;
    ciphertext: string;
  };
  checksum: {
    name: "SHA-256";
    value: string;
  };
};

type RecoveryKitPlaintext = {
  type: "alpha-prime-recovery-secret";
  version: 1;
  createdAt: string;
  account: RecoveryKitAccount;
  recoveryPublicKey: RecoveryPublicKey;
  recoveryPrivateScalar: string;
};

export type RecoveryKitSession = {
  account: RecoveryKitAccount;
  recoveryPublicKey: RecoveryPublicKey;
  signRecoveryDigest: (digest: string) => string;
  destroy: () => void;
};

/** Holds a scalar only inside this module's closure until it is encrypted or destroyed. */
export type RecoveryKitDraft = {
  recoveryPublicKey: RecoveryPublicKey;
  encryptForAccount: (
    account: RecoveryKitAccount,
    password: string,
  ) => Promise<{ serialized: string; recoveryPublicKey: RecoveryPublicKey; derivationMilliseconds: number }>;
  destroy: () => void;
};

export type RecoveryCreationGate = {
  kitGenerated: boolean;
  exportSucceeded: boolean;
  backupConfirmed: boolean;
};

export const canProceedToPhase3BAccountCreation = (
  gate: RecoveryCreationGate,
): boolean =>
  gate.kitGenerated && gate.exportSucceeded && gate.backupConfirmed;

export class RecoveryKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryKitError";
  }
}

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
};

const bytesToBase64Url = (value: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const base64UrlToBytes = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RecoveryKitError("Recovery Kit contains invalid binary data.");
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new RecoveryKitError("Recovery Kit contains invalid binary data.");
  }
};

const bytesToHex = (value: Uint8Array): string =>
  `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

const isHexBytes = (value: unknown, bytes: number): value is string =>
  typeof value === "string" &&
  new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.slice().buffer as ArrayBuffer;

const digestSha256 = async (value: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(value)),
  );

const validateAccount = (account: RecoveryKitAccount): void => {
  if (
    !account ||
    !isHexBytes(account.address, 20) ||
    !isHexBytes(account.authority, 20) ||
    !/^[1-9][0-9]*$/.test(account.chainId) ||
    !isHexBytes(account.rpIdHash, 32)
  ) {
    throw new RecoveryKitError("Recovery Kit account metadata is invalid.");
  }
};

const validatePublicKey = (key: RecoveryPublicKey): void => {
  if (!key || !isHexBytes(key.qx, 32) || !isHexBytes(key.qy, 32)) {
    throw new RecoveryKitError("Recovery Kit public key is invalid.");
  }
  const point = Uint8Array.from([
    4,
    ...hexToBytes(key.qx),
    ...hexToBytes(key.qy),
  ]);
  try {
    p256.ProjectivePoint.fromHex(point).assertValidity();
  } catch {
    throw new RecoveryKitError("Recovery Kit public key is not on P-256.");
  }
};

const hexToBytes = (value: string): Uint8Array =>
  Uint8Array.from(value.slice(2).match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );

const makeAadObject = (
  kit: Pick<
    RecoveryKit,
    "format" | "version" | "createdAt" | "account" | "recoveryPublicKey" | "kdf"
  > & { encryption: Pick<RecoveryKit["encryption"], "name" | "iv"> },
) => ({
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

const withoutChecksum = (kit: RecoveryKit) => ({
  format: kit.format,
  version: kit.version,
  createdAt: kit.createdAt,
  account: kit.account,
  recoveryPublicKey: kit.recoveryPublicKey,
  kdf: kit.kdf,
  encryption: kit.encryption,
});

const deriveEncryptionKey = async (
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> => {
  if (!password) {
    throw new RecoveryKitError("A Recovery Kit password is required.");
  }
  const passwordBytes = encoder.encode(password);
  try {
    const derived = await argon2id({
      password: passwordBytes,
      salt,
      iterations: ARGON2ID_ITERATIONS,
      parallelism: ARGON2ID_PARALLELISM,
      memorySize: ARGON2ID_MEMORY_KIB,
      hashLength: ARGON2ID_OUTPUT_BYTES,
      outputType: "binary",
    });
    return new Uint8Array(derived);
  } finally {
    passwordBytes.fill(0);
  }
};

const assertKitShape = (value: unknown): RecoveryKit => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RecoveryKitError("Recovery Kit JSON is malformed.");
  }
  const kit = value as RecoveryKit;
  if (kit.format !== RECOVERY_KIT_FORMAT) {
    throw new RecoveryKitError("Unsupported Recovery Kit format.");
  }
  if (kit.version !== RECOVERY_KIT_VERSION) {
    throw new RecoveryKitError("Unsupported Recovery Kit version.");
  }
  if (!kit.createdAt || Number.isNaN(Date.parse(kit.createdAt))) {
    throw new RecoveryKitError("Recovery Kit creation time is invalid.");
  }
  validateAccount(kit.account);
  validatePublicKey(kit.recoveryPublicKey);
  if (
    !kit.kdf ||
    kit.kdf.name !== "argon2id" ||
    kit.kdf.implementation !== ARGON2ID_IMPLEMENTATION ||
    kit.kdf.implementationVersion !== ARGON2ID_VERSION ||
    kit.kdf.argonVersion !== 19 ||
    kit.kdf.memoryKiB !== ARGON2ID_MEMORY_KIB ||
    kit.kdf.iterations !== ARGON2ID_ITERATIONS ||
    kit.kdf.parallelism !== ARGON2ID_PARALLELISM ||
    kit.kdf.outputBytes !== ARGON2ID_OUTPUT_BYTES
  ) {
    throw new RecoveryKitError("Unsupported Recovery Kit KDF parameters.");
  }
  if (
    !kit.encryption ||
    kit.encryption.name !== "AES-256-GCM" ||
    !kit.encryption.iv ||
    !kit.encryption.aad ||
    !kit.encryption.ciphertext
  ) {
    throw new RecoveryKitError("Unsupported Recovery Kit encryption.");
  }
  if (
    !kit.checksum ||
    kit.checksum.name !== "SHA-256" ||
    !/^[A-Za-z0-9_-]+$/.test(kit.checksum.value)
  ) {
    throw new RecoveryKitError("Recovery Kit checksum is invalid.");
  }
  const salt = base64UrlToBytes(kit.kdf.salt);
  const iv = base64UrlToBytes(kit.encryption.iv);
  const ciphertext = base64UrlToBytes(kit.encryption.ciphertext);
  if (
    salt.length !== SALT_BYTES ||
    iv.length !== IV_BYTES ||
    ciphertext.length <= 16
  ) {
    throw new RecoveryKitError("Recovery Kit encrypted data is truncated.");
  }
  return kit;
};

export const parseRecoveryKit = (serialized: string): RecoveryKit => {
  try {
    return assertKitShape(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof RecoveryKitError) throw error;
    throw new RecoveryKitError("Recovery Kit JSON is malformed.");
  }
};

async function encryptRecoveryKit(
  account: RecoveryKitAccount,
  password: string,
  sourcePrivateScalar: Uint8Array,
): Promise<{
  serialized: string;
  recoveryPublicKey: RecoveryPublicKey;
  derivationMilliseconds: number;
}> {
  validateAccount(account);
  if (password.length < 12) {
    throw new RecoveryKitError(
      "Use a Recovery Kit password with at least 12 characters.",
    );
  }

  const privateScalar = sourcePrivateScalar.slice();
  const publicPoint = p256.getPublicKey(privateScalar, false);
  const recoveryPublicKey = {
    qx: bytesToHex(publicPoint.subarray(1, 33)),
    qy: bytesToHex(publicPoint.subarray(33, 65)),
  };
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  let derivedKey: Uint8Array | undefined;
  let plaintextBytes: Uint8Array | undefined;

  try {
    const createdAt = new Date().toISOString();
    const kdf: RecoveryKit["kdf"] = {
      name: "argon2id",
      implementation: ARGON2ID_IMPLEMENTATION,
      implementationVersion: ARGON2ID_VERSION,
      argonVersion: 19,
      memoryKiB: ARGON2ID_MEMORY_KIB,
      iterations: ARGON2ID_ITERATIONS,
      parallelism: ARGON2ID_PARALLELISM,
      outputBytes: ARGON2ID_OUTPUT_BYTES,
      salt: bytesToBase64Url(salt),
    };
    const encryptionHeader = {
      name: "AES-256-GCM" as const,
      iv: bytesToBase64Url(iv),
    };
    const aadBytes = encoder.encode(
      canonicalize(
        makeAadObject({
          format: RECOVERY_KIT_FORMAT,
          version: RECOVERY_KIT_VERSION,
          createdAt,
          account,
          recoveryPublicKey,
          kdf,
          encryption: encryptionHeader,
        }),
      ),
    );
    const plaintext: RecoveryKitPlaintext = {
      type: "alpha-prime-recovery-secret",
      version: 1,
      createdAt,
      account,
      recoveryPublicKey,
      recoveryPrivateScalar: bytesToBase64Url(privateScalar),
    };
    plaintextBytes = encoder.encode(canonicalize(plaintext));

    const startedAt = performance.now();
    derivedKey = await deriveEncryptionKey(password, salt);
    const derivationMilliseconds = performance.now() - startedAt;
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(derivedKey),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(iv),
          additionalData: toArrayBuffer(aadBytes),
          tagLength: 128,
        },
        cryptoKey,
        toArrayBuffer(plaintextBytes),
      ),
    );

    const kitWithoutChecksum: Omit<RecoveryKit, "checksum"> = {
      format: RECOVERY_KIT_FORMAT,
      version: RECOVERY_KIT_VERSION,
      createdAt,
      account,
      recoveryPublicKey,
      kdf,
      encryption: {
        ...encryptionHeader,
        aad: bytesToBase64Url(aadBytes),
        ciphertext: bytesToBase64Url(ciphertext),
      },
    };
    const checksum = await digestSha256(
      encoder.encode(canonicalize(kitWithoutChecksum)),
    );
    const kit: RecoveryKit = {
      ...kitWithoutChecksum,
      checksum: {
        name: "SHA-256",
        value: bytesToBase64Url(checksum),
      },
    };
    return {
      serialized: `${JSON.stringify(kit, null, 2)}\n`,
      recoveryPublicKey,
      derivationMilliseconds,
    };
  } finally {
    privateScalar.fill(0);
    salt.fill(0);
    iv.fill(0);
    derivedKey?.fill(0);
    plaintextBytes?.fill(0);
  }
}

export async function createRecoveryKit(
  account: RecoveryKitAccount,
  password: string,
): Promise<{
  serialized: string;
  recoveryPublicKey: RecoveryPublicKey;
  derivationMilliseconds: number;
}> {
  const privateScalar = p256.utils.randomPrivateKey();
  try {
    return await encryptRecoveryKit(account, password, privateScalar);
  } finally {
    privateScalar.fill(0);
  }
}

/** Creates a non-serializable draft so CREATE2 prediction can precede account-bound encryption. */
export function createRecoveryKitDraft(): RecoveryKitDraft {
  const privateScalar = p256.utils.randomPrivateKey();
  const point = p256.getPublicKey(privateScalar, false);
  const recoveryPublicKey = {
    qx: bytesToHex(point.subarray(1, 33)),
    qy: bytesToHex(point.subarray(33, 65)),
  };
  let destroyed = false;
  return {
    recoveryPublicKey,
    encryptForAccount: async (account, password) => {
      if (destroyed) throw new RecoveryKitError("Recovery Kit draft was destroyed.");
      return encryptRecoveryKit(account, password, privateScalar);
    },
    destroy: () => {
      if (!destroyed) {
        privateScalar.fill(0);
        destroyed = true;
      }
    },
  };
}

export async function openRecoveryKit(
  serialized: string,
  password: string,
): Promise<RecoveryKitSession> {
  const kit = parseRecoveryKit(serialized);
  const expectedChecksum = await digestSha256(
    encoder.encode(canonicalize(withoutChecksum(kit))),
  );
  const suppliedChecksum = base64UrlToBytes(kit.checksum.value);
  if (!equalBytes(expectedChecksum, suppliedChecksum)) {
    throw new RecoveryKitError("Recovery Kit checksum validation failed.");
  }

  const expectedAad = encoder.encode(
    canonicalize(makeAadObject(kit)),
  );
  const suppliedAad = base64UrlToBytes(kit.encryption.aad);
  if (!equalBytes(expectedAad, suppliedAad)) {
    throw new RecoveryKitError("Recovery Kit authentication failed.");
  }

  const salt = base64UrlToBytes(kit.kdf.salt);
  const iv = base64UrlToBytes(kit.encryption.iv);
  const ciphertext = base64UrlToBytes(kit.encryption.ciphertext);
  let derivedKey: Uint8Array | undefined;
  let plaintextBytes: Uint8Array | undefined;
  try {
    derivedKey = await deriveEncryptionKey(password, salt);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(derivedKey),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    try {
      plaintextBytes = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: toArrayBuffer(iv),
            additionalData: toArrayBuffer(suppliedAad),
            tagLength: 128,
          },
          cryptoKey,
          toArrayBuffer(ciphertext),
        ),
      );
    } catch {
      throw new RecoveryKitError("Recovery Kit authentication failed.");
    }

    let plaintext: RecoveryKitPlaintext;
    try {
      plaintext = JSON.parse(decoder.decode(plaintextBytes));
    } catch {
      throw new RecoveryKitError("Recovery Kit plaintext is invalid.");
    }
    if (
      plaintext.type !== "alpha-prime-recovery-secret" ||
      plaintext.version !== 1 ||
      canonicalize(plaintext.account) !== canonicalize(kit.account) ||
      canonicalize(plaintext.recoveryPublicKey) !==
        canonicalize(kit.recoveryPublicKey)
    ) {
      throw new RecoveryKitError("Recovery Kit authentication failed.");
    }
    const privateScalar = base64UrlToBytes(plaintext.recoveryPrivateScalar);
    const privateScalarValue =
      privateScalar.length === 32 ? BigInt(bytesToHex(privateScalar)) : 0n;
    if (
      privateScalar.length !== 32 ||
      privateScalarValue === 0n ||
      privateScalarValue >= P256_ORDER
    ) {
      privateScalar.fill(0);
      throw new RecoveryKitError("Recovery Kit secret is invalid.");
    }
    const derivedPublicPoint = p256.getPublicKey(privateScalar, false);
    const derivedPublicKey = {
      qx: bytesToHex(derivedPublicPoint.subarray(1, 33)),
      qy: bytesToHex(derivedPublicPoint.subarray(33, 65)),
    };
    if (
      derivedPublicKey.qx.toLowerCase() !==
        kit.recoveryPublicKey.qx.toLowerCase() ||
      derivedPublicKey.qy.toLowerCase() !==
        kit.recoveryPublicKey.qy.toLowerCase()
    ) {
      privateScalar.fill(0);
      throw new RecoveryKitError("Recovery Kit authentication failed.");
    }

    let destroyed = false;
    return {
      account: kit.account,
      recoveryPublicKey: kit.recoveryPublicKey,
      signRecoveryDigest: (digest: string) => {
        if (destroyed) {
          throw new RecoveryKitError("Recovery Kit session was destroyed.");
        }
        if (!isHexBytes(digest, 32)) {
          throw new RecoveryKitError("Recovery digest must be 32 bytes.");
        }
        const signature = p256.sign(hexToBytes(digest), privateScalar, {
          lowS: true,
        });
        return bytesToHex(signature.toCompactRawBytes());
      },
      destroy: () => {
        if (!destroyed) {
          privateScalar.fill(0);
          destroyed = true;
        }
      },
    };
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
    derivedKey?.fill(0);
    plaintextBytes?.fill(0);
  }
}

export function downloadRecoveryKit(
  serialized: string,
  _accountAddress: string,
): void {
  const blob = new Blob([serialized], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "avs-recovery-kit.json";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

export async function benchmarkArgon2id(): Promise<number> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  let derived: Uint8Array | undefined;
  try {
    const startedAt = performance.now();
    derived = await deriveEncryptionKey(
      "alpha-prime-phase-3b-benchmark-only",
      salt,
    );
    return performance.now() - startedAt;
  } finally {
    salt.fill(0);
    derived?.fill(0);
  }
}