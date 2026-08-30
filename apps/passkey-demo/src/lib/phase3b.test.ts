import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import {
  decodeStaleFinalizeError,
  buildRecoveryRequest,
  recoveryGatesReady,
  recoveryKitMatchesPrepared,
  verifyPhase3BRecoveryLiveState,
  type Phase3BRecoveryLiveState,
} from "./phase3b";
import { ENTRYPOINT_V08_ADDRESS } from "./phase3a";
import { createRecoveryKitDraft, openRecoveryKit } from "./recovery-kit";

const prepared = { account: "0x1111111111111111111111111111111111111111", authority: "0x2222222222222222222222222222222222222222", chainId: 97n, rpIdHash: `0x${"33".repeat(32)}` };
const session = { account: { address: prepared.account, authority: prepared.authority, chainId: "97", rpIdHash: prepared.rpIdHash }, recoveryPublicKey: { qx: `0x${"44".repeat(32)}`, qy: `0x${"55".repeat(32)}` }, signRecoveryDigest: () => "0x", destroy: () => {} };
const replacement = { qx: `0x${"66".repeat(32)}`, qy: `0x${"77".repeat(32)}` };
const liveState: Phase3BRecoveryLiveState = {
  factory: "0x3333333333333333333333333333333333333333",
  factoryAuthority: prepared.authority,
  factoryController: "0x4444444444444444444444444444444444444444",
  factoryEntryPoint: ENTRYPOINT_V08_ADDRESS,
  account: prepared.account,
  accountDeployed: true,
  accountAuthority: prepared.authority,
  accountController: "0x4444444444444444444444444444444444444444",
  accountEntryPoint: ENTRYPOINT_V08_ADDRESS,
  registeredRecoveryKey: session.recoveryPublicKey,
  rpIdHash: prepared.rpIdHash,
  chainId: 97n,
};
describe("Phase 3B request and gates", () => {
  const nextRecovery = { qx: `0x${"88".repeat(32)}`, qy: `0x${"99".repeat(32)}` };
  it("constructs the canonical deterministic atomic rotation request", () => expect(buildRecoveryRequest(replacement, nextRecovery, 7n, `0x${"01".repeat(32)}`)).toEqual({ newTransactionKey: [replacement.qx, replacement.qy], newRecoveryKey: [nextRecovery.qx, nextRecovery.qy], recoveryNonce: 7n, requestId: `0x${"01".repeat(32)}` }));
  it("requires nonzero request identifiers", () => expect(() => buildRecoveryRequest(replacement, nextRecovery, 0n, `0x${"00".repeat(32)}`)).toThrow("non-zero"));
  it("decodes the exact stale Transaction-key-version custom error", () => {
    const controller = new Interface([
      "error StaleTransactionKeyVersion(uint64 expected,uint64 current)",
    ]);
    expect(decodeStaleFinalizeError(
      controller.encodeErrorResult("StaleTransactionKeyVersion", [3n, 4n]),
    )).toBe("StaleTransactionKeyVersion");
  });
  it("binds metadata and enforces every recovery gate", () => {
    expect(recoveryKitMatchesPrepared(session.account, prepared)).toBe(true);
    expect(recoveryGatesReady({ kitExported: true, backupConfirmed: true, session: session as never, replacement: replacement as never })).toBe(true);
    expect(recoveryGatesReady({ kitExported: true, backupConfirmed: false, session: session as never, replacement: replacement as never })).toBe(false);
  });
  it("allows an imported-only session to pass recovery gates without transient creation state", () => {
    const importedAfterReload = {
      ...session,
      account: { ...session.account },
      recoveryPublicKey: { ...session.recoveryPublicKey },
    };
    expect(recoveryGatesReady({
      kitExported: true,
      backupConfirmed: true,
      session: importedAfterReload as never,
      replacement: replacement as never,
    })).toBe(true);
  });
  it("opens a real encrypted kit after reload and constructs the next atomic rotation without prepared state", async () => {
    const draft = createRecoveryKitDraft();
    try {
      const encrypted = await draft.encryptForAccount(session.account, "import-only recovery password");
      const imported = await openRecoveryKit(encrypted.serialized, "import-only recovery password");
      try {
        expect(imported.account).toEqual(session.account);
        expect(imported.recoveryPublicKey).toEqual(encrypted.recoveryPublicKey);
        expect(recoveryGatesReady({
          kitExported: true,
          backupConfirmed: true,
          session: imported,
          replacement: replacement as never,
        })).toBe(true);
        expect(buildRecoveryRequest(
          replacement,
          nextRecovery,
          11n,
          `0x${"ab".repeat(32)}`,
        )).toEqual({
          newTransactionKey: [replacement.qx, replacement.qy],
          newRecoveryKey: [nextRecovery.qx, nextRecovery.qy],
          recoveryNonce: 11n,
          requestId: `0x${"ab".repeat(32)}`,
        });
      } finally {
        imported.destroy();
      }
    } finally {
      draft.destroy();
    }
  }, 60_000);
  it("reconstructs the recovery context from authenticated kit metadata and verified live state", () => {
    expect(verifyPhase3BRecoveryLiveState(session as never, liveState)).toMatchObject({
      account: prepared.account,
      authority: prepared.authority,
      controller: liveState.factoryController,
      chainId: 97n,
      recoveryPublicKey: session.recoveryPublicKey,
    });
  });
  it.each([
    ["chain", { chainId: 56n }],
    ["factory EntryPoint", { factoryEntryPoint: prepared.account }],
    ["Authority", { factoryAuthority: liveState.factory }],
    ["undeployed account", { accountDeployed: false }],
    ["Recovery root", { registeredRecoveryKey: nextRecovery }],
    ["RP ID", { rpIdHash: `0x${"ff".repeat(32)}` }],
    ["account Authority", { accountAuthority: liveState.factory }],
    ["EvolutionController", { accountController: liveState.factory }],
    ["account EntryPoint", { accountEntryPoint: prepared.account }],
  ])("rejects a live %s mismatch before recovery", (_name, mutation) => {
    expect(() => verifyPhase3BRecoveryLiveState(
      session as never,
      { ...liveState, ...mutation } as Phase3BRecoveryLiveState,
    )).toThrow();
  });
});