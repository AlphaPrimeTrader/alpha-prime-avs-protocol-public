import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  Cpu,
  Download,
  FileKey2,
  Fingerprint,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  TimerReset,
  Trash2,
  Upload,
} from "lucide-react";
import {
  DEMO_CHAIN_ID,
  DEMO_FACTORY_ADDRESS,
  DEMO_NETWORK_NAME,
  ENTRYPOINT_V08_ADDRESS,
  AccountFlowError,
  createAvsAccount,
  createBrowserPasskey,
  reconnectBrowserPasskey,
  signAndSubmitTestOperation,
  validateEvolutionFlow,
  type AccountDeployment,
  type AccountFlowDebug,
  type CredentialRole,
  type PasskeyMaterial,
  type PasskeySet,
} from "./lib/phase3a";
import {
  ARGON2ID_ITERATIONS,
  ARGON2ID_MEMORY_KIB,
  ARGON2ID_OUTPUT_BYTES,
  benchmarkArgon2id,
  canProceedToPhase3BAccountCreation,
  createRecoveryKitDraft,
  downloadRecoveryKit,
  openRecoveryKit,
  type RecoveryKitAccount,
  type RecoveryPublicKey,
  type RecoveryKitSession,
  type RecoveryKitDraft,
} from "./lib/recovery-kit";
import {
  cancelPhase3BStaleUpgrade,
  createPhase3BAccount,
  loadPhase3BAccount,
  preparePhase3BAccount,
  recoveryKitMatchesPrepared,
  requestPhase3BStaleUpgrade,
  requestPhase3BRecovery,
  type Phase3BPrepared,
  type Phase3BRecoveryResult,
  type Phase3BStaleUpgradeRequest,
} from "./lib/phase3b";

type ActionKey =
  | CredentialRole
  | "kit"
  | "account"
  | "operation"
  | "evolutionTest";
type ActionState = Record<ActionKey, boolean>;

const steps: Array<{
  number: string;
  title: string;
  description: string;
  action: ActionKey;
  actionLabel: string;
}> = [
  {
    number: "01",
    title: "Create Transaction Passkey",
    description: "Used for normal account authorization.",
    action: "transaction",
    actionLabel: "Create Transaction Passkey",
  },
  {
    number: "02",
    title: "Create Evolution Passkey",
    description: "Reserved for approving future account upgrades. Not needed for daily use or Recovery.",
    action: "evolution",
    actionLabel: "Create Evolution Passkey",
  },
  {
    number: "03",
    title: "Create Offline Recovery Kit R1",
    description: "Your emergency recovery credential. Generate it locally, download it, and confirm your backup.",
    action: "kit",
    actionLabel: "Open Recovery Kit setup",
  },
  {
    number: "04",
    title: "Create AVS Smart Account",
    description: "Deploy one permanent account after the setup materials are ready.",
    action: "account",
    actionLabel: "Create AVS Smart Account",
  },
  {
    number: "05",
    title: "Test Account Operation",
    description: "Prove ordinary account use with the Transaction Passkey.",
    action: "operation",
    actionLabel: "Test Account Operation",
  },
];

const initialActions: ActionState = {
  transaction: false,
  recovery: false,
  evolution: false,
  kit: false,
  account: false,
  operation: false,
  evolutionTest: false,
};

const short = (value: string | null | undefined) => {
  if (!value) return "—";
  return value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value;
};

export default function App() {
  const [actions, setActions] = useState(initialActions);
  const [busyAction, setBusyAction] = useState<ActionKey | null>(null);
  const [passkeys, setPasskeys] = useState<
    Partial<Record<CredentialRole, PasskeyMaterial>>
  >({});
  const [deployment, setDeployment] = useState<AccountDeployment | null>(null);
  const [accountDebug, setAccountDebug] = useState<AccountFlowDebug | null>(null);
  const [operationStatus, setOperationStatus] = useState("Not attempted");
  const [evolutionStatus, setEvolutionStatus] = useState("Not attempted");
  const [userOpHash, setUserOpHash] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [evolutionRequestHash, setEvolutionRequestHash] = useState<string | null>(null);
  const [evolutionCancelHash, setEvolutionCancelHash] = useState<string | null>(null);
  const [traceMessage, setTraceMessage] = useState("Ready for the first key");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [kitAccount, setKitAccount] = useState<RecoveryKitAccount>({
    address: "",
    authority: "",
    chainId: DEMO_CHAIN_ID.toString(),
    rpIdHash: "",
  });
  const [kitPassword, setKitPassword] = useState("");
  const [kitPasswordConfirm, setKitPasswordConfirm] = useState("");
  const [kitGenerated, setKitGenerated] = useState(false);
  const [kitRecoveryPublicKey, setKitRecoveryPublicKey] = useState<RecoveryPublicKey | null>(null);
  const [phase3bPrepared, setPhase3bPrepared] = useState<Phase3BPrepared | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<Phase3BRecoveryResult | null>(null);
  const [staleUpgradeRequest, setStaleUpgradeRequest] =
    useState<Phase3BStaleUpgradeRequest | null>(null);
  const [staleFinalizeError, setStaleFinalizeError] = useState<string | null>(null);
  const [reconnectCredentialHint, setReconnectCredentialHint] = useState("");
  const [nextKitExportSucceeded, setNextKitExportSucceeded] = useState(false);
  const [nextKitBackupConfirmed, setNextKitBackupConfirmed] = useState(false);
  const [nextRecoveryPublicKey, setNextRecoveryPublicKey] = useState<RecoveryPublicKey | null>(null);
  const [kitExportSucceeded, setKitExportSucceeded] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [kitBusy, setKitBusy] = useState<"create" | "open" | "passkey" | "sign" | "benchmark" | null>(null);
  const [kitStatus, setKitStatus] = useState("No Recovery Kit generated");
  const [kitError, setKitError] = useState<string | null>(null);
  const [openedSession, setOpenedSession] = useState<RecoveryKitSession | null>(null);
  const [importedAccount, setImportedAccount] = useState<RecoveryKitAccount | null>(null);
  const [importedPublicKey, setImportedPublicKey] = useState<{ qx: string; qy: string } | null>(null);
  const [replacementPasskey, setReplacementPasskey] = useState<PasskeyMaterial | null>(null);
  const [digest, setDigest] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [benchmarkMs, setBenchmarkMs] = useState<number | null>(null);
  const sessionRef = useRef<RecoveryKitSession | null>(null);
  const initialDraftRef = useRef<RecoveryKitDraft | null>(null);
  const nextDraftRef = useRef<RecoveryKitDraft | null>(null);

  useEffect(() => () => {
    sessionRef.current?.destroy();
    initialDraftRef.current?.destroy();
    nextDraftRef.current?.destroy();
    sessionRef.current = null;
  }, []);

  const replaceSession = (session: RecoveryKitSession | null) => {
    sessionRef.current?.destroy();
    sessionRef.current = session;
    setOpenedSession(session);
  };

  const updateKitAccount = (field: keyof RecoveryKitAccount, value: string) => {
    setKitAccount((current) => ({ ...current, [field]: value }));
    setKitGenerated(false);
    setKitExportSucceeded(false);
    setBackupConfirmed(false);
  };

  const updateKitPassword = (value: string) => {
    setKitPassword(value);
    setKitGenerated(false);
    setKitExportSucceeded(false);
    setBackupConfirmed(false);
  };

  const accountCreationGateReady = canProceedToPhase3BAccountCreation({
    kitGenerated,
    exportSucceeded: kitExportSucceeded,
    backupConfirmed,
  });

  const handleCreateKit = async () => {
    setKitBusy("create");
    setKitError(null);
    setKitStatus("Generating and encrypting locally…");
    try {
      if (kitPassword.length < 12) throw new Error("Use at least 12 characters for the Recovery Kit password.");
      if (kitPassword !== kitPasswordConfirm) throw new Error("The password confirmation does not match.");
       if (!passkeys.transaction || !passkeys.evolution) {
         throw new Error("Create transaction and evolution Passkeys before preparing the account-bound Recovery Kit.");
       }
       initialDraftRef.current?.destroy();
       const draft = createRecoveryKitDraft();
       initialDraftRef.current = draft;
       const prepared = await preparePhase3BAccount(passkeys as PasskeySet, draft.recoveryPublicKey);
       const boundAccount = {
         address: prepared.account, authority: prepared.authority,
         chainId: prepared.chainId.toString(), rpIdHash: prepared.rpIdHash,
       };
       const result = await draft.encryptForAccount(boundAccount, kitPassword);
       setKitRecoveryPublicKey(result.recoveryPublicKey);
       setPhase3bPrepared(prepared);
       setKitAccount(boundAccount);
      setKitGenerated(true);
       downloadRecoveryKit(result.serialized, boundAccount.address);
       draft.destroy();
       initialDraftRef.current = null;
      setKitExportSucceeded(true);
      setKitStatus(`Generated and downloaded · key derivation ${result.derivationMilliseconds.toFixed(0)} ms`);
      setBackupConfirmed(false);
      setKitPassword("");
      setKitPasswordConfirm("");
    } catch (error) {
      setKitExportSucceeded(false);
      setBackupConfirmed(false);
      setKitError(error instanceof Error ? error.message : String(error));
      setKitStatus("Generation stopped");
    } finally {
      setKitBusy(null);
    }
  };

  const handleCreateNextKit = async () => {
    if (!openedSession) return;
    setKitBusy("create"); setKitError(null);
    try {
      if (kitPassword.length < 12 || kitPassword !== kitPasswordConfirm) {
        throw new Error("Use and confirm a new Recovery Kit password of at least 12 characters.");
      }
      nextDraftRef.current?.destroy();
      const draft = createRecoveryKitDraft();
      nextDraftRef.current = draft;
      const result = await draft.encryptForAccount(openedSession.account, kitPassword);
      downloadRecoveryKit(result.serialized, openedSession.account.address);
      setNextRecoveryPublicKey(result.recoveryPublicKey);
      draft.destroy();
      nextDraftRef.current = null;
      setNextKitExportSucceeded(true); setNextKitBackupConfirmed(false);
      setKitPassword(""); setKitPasswordConfirm("");
      setKitStatus("Fresh R2 Recovery Kit generated and downloaded locally");
    } catch (error) { setKitError(error instanceof Error ? error.message : String(error)); }
    finally { setKitBusy(null); }
  };

  const handleImportKit = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setKitBusy("open");
    setKitError(null);
    setKitStatus("Opening and decrypting locally…");
    replaceSession(null);
    setImportedAccount(null);
    setImportedPublicKey(null);
    setReplacementPasskey(null);
    setNextRecoveryPublicKey(null);
    setNextKitExportSucceeded(false);
    setNextKitBackupConfirmed(false);
    nextDraftRef.current?.destroy();
    nextDraftRef.current = null;
    setSignature(null);
    try {
      const serialized = await file.text();
      const session = await openRecoveryKit(serialized, importPassword);
      replaceSession(session);
      setImportedAccount(session.account);
      setImportedPublicKey(session.recoveryPublicKey);
      setSignature(null);
      try {
        const live = await loadPhase3BAccount(session.account.address);
        setDeployment(live.deployment);
        setAccountDebug(live.deployment.debug);
        setActions((value) => ({ ...value, account: true }));
        setTraceMessage(`Existing account restored at ${short(live.deployment.account)}`);
        setKitStatus("Recovery Kit opened locally · existing account restored");
      } catch {
        setKitStatus("Recovery Kit opened locally · account metadata restored");
      }
    } catch (error) {
      setKitError(error instanceof Error ? error.message : String(error));
      setKitStatus("Import stopped");
    } finally {
      setImportPassword("");
      setKitBusy(null);
    }
  };

  const handleCreateReplacementPasskey = async () => {
    if (!openedSession || kitBusy) return;
    setKitBusy("passkey");
    setKitError(null);
    try {
      const passkey = await createBrowserPasskey("transaction");
      setReplacementPasskey(passkey);
      setSignature(null);
      setKitStatus("NEW Transaction Passkey created for atomic root rotation");
    } catch (error) {
      setKitError(error instanceof Error ? error.message : String(error));
    } finally {
      setKitBusy(null);
    }
  };

  const handleReconnectCurrentTransaction = async () => {
    if (!openedSession || kitBusy) return;
    setKitBusy("passkey");
    setKitError(null);
    try {
      const live = await loadPhase3BAccount(openedSession.account.address);
      const current = await reconnectBrowserPasskey(
        "transaction",
        live.transactionKey,
        reconnectCredentialHint || undefined,
      );
      setReconnectCredentialHint("");
      setPasskeys((value) => ({ ...value, transaction: current }));
      setDeployment(live.deployment);
      setAccountDebug(live.deployment.debug);
      setActions((value) => ({ ...value, account: true, transaction: true }));
      setKitStatus("Current Transaction Passkey reconnected; prove it with a UserOperation");
    } catch (error) {
      setKitError(error instanceof Error ? error.message : String(error));
    } finally {
      setKitBusy(null);
    }
  };

  const handleReconnectEvolution = async () => {
    if (!openedSession || kitBusy) return;
    setKitBusy("passkey");
    setKitError(null);
    try {
      const live = await loadPhase3BAccount(openedSession.account.address);
      const current = await reconnectBrowserPasskey(
        "evolution",
        live.evolutionKey,
        reconnectCredentialHint || undefined,
      );
      setReconnectCredentialHint("");
      setPasskeys((value) => ({ ...value, evolution: current }));
      setDeployment(live.deployment);
      setAccountDebug(live.deployment.debug);
      setActions((value) => ({ ...value, account: true, evolution: true }));
      setKitStatus("Current Evolution Passkey reconnected");
    } catch (error) {
      setKitError(error instanceof Error ? error.message : String(error));
    } finally {
      setKitBusy(null);
    }
  };

  const handleSignDigest = async () => {
    if (!openedSession || !replacementPasskey || !nextRecoveryPublicKey || !nextKitExportSucceeded || !nextKitBackupConfirmed) return;
    setKitError(null);
    setKitBusy("sign");
    try {
      const result = await requestPhase3BRecovery(
        openedSession,
        replacementPasskey,
        nextRecoveryPublicKey,
      );
      setRecoveryResult(result);
      setPasskeys((value) => ({ ...value, transaction: replacementPasskey }));
      setSignature("Submitted locally signed atomic rotation");
      replaceSession(null);
      nextDraftRef.current?.destroy();
      nextDraftRef.current = null;
      setImportedAccount(null); setImportedPublicKey(null);
      setKitStatus(staleUpgradeRequest
        ? `Atomic rotation verified; stale finalize becomes testable at ${new Date(Number(staleUpgradeRequest.executableAt) * 1000).toISOString()}`
        : "Atomic rotation verified; old Recovery session destroyed");
    } catch (error) {
      setKitError(error instanceof Error ? error.message : String(error));
    } finally {
      setKitBusy(null);
    }
  };

  const handleBenchmark = async () => {
    setKitBusy("benchmark");
    setKitError(null);
    setKitStatus("Benchmarking Argon2id locally…");
    try {
      const measured = await benchmarkArgon2id();
      setBenchmarkMs(measured);
      setKitStatus("Argon2id benchmark complete");
    } catch (error) {
      setKitError(error instanceof Error ? error.message : String(error));
      setKitStatus("Benchmark failed");
    } finally {
      setKitBusy(null);
    }
  };

  const handleAction = async (action: ActionKey) => {
    if (busyAction) return;
    setBusyAction(action);
    setErrorMessage(null);
    try {
      if (
        action === "transaction" ||
        action === "recovery" ||
        action === "evolution"
      ) {
        const passkey = await createBrowserPasskey(action);
        setPasskeys((current) => ({ ...current, [action]: passkey }));
        setActions((current) => ({ ...current, [action]: true }));
        setTraceMessage(`${action} credential registered`);
      } else if (action === "kit") {
        document.getElementById("recovery-kit")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setTraceMessage("Recovery Kit setup is ready below");
      } else if (action === "account") {
        if (!passkeys.transaction || !passkeys.evolution || !kitRecoveryPublicKey) {
          throw new Error("Create transaction/evolution Passkeys and generate the offline Recovery Kit first.");
        }
        const prepared = phase3bPrepared ?? await preparePhase3BAccount(passkeys as PasskeySet, kitRecoveryPublicKey);
        setPhase3bPrepared(prepared);
        if (!recoveryKitMatchesPrepared(kitAccount, prepared)) throw new Error("Initial Recovery Kit is not authenticated to the predicted Phase 3B account.");
        if (!accountCreationGateReady) {
          throw new Error("Generate, download, and confirm the account-bound Recovery Kit before deployment.");
        }
        const next = await createPhase3BAccount(prepared, passkeys.transaction);
        initialDraftRef.current?.destroy();
        initialDraftRef.current = null;
        setDeployment(next);
        setAccountDebug(next.debug);
        setActions((current) => ({ ...current, account: true }));
        setTraceMessage(`Account deployed at ${short(next.account)}`);
      } else if (action === "operation") {
        if (!passkeys.transaction || !deployment) {
          throw new Error("Create the account before running operation tests.");
        }
        setOperationStatus("WebAuthn ceremony in progress");
        const result = await signAndSubmitTestOperation(
          passkeys.transaction,
          deployment,
        );
        setUserOpHash(result.userOpHash);
        setTransactionHash(result.transactionHash);
        setOperationStatus("PASS · valid execution plus six adversarial rejections");
        setActions((current) => ({ ...current, operation: true }));
        setTraceMessage("UserOperation boundary validation passed");
      } else {
        if (
          !passkeys.transaction ||
          !passkeys.evolution ||
          !deployment
        ) {
          throw new Error("Create all credentials and the account first.");
        }
        setEvolutionStatus("WebAuthn ceremonies in progress");
        const result = deployment.debug.walletConnected === "NO"
          ? await requestPhase3BStaleUpgrade(
              passkeys as Pick<PasskeySet, "transaction" | "evolution">,
              deployment,
            )
          : await validateEvolutionFlow(passkeys as PasskeySet, deployment);
        setEvolutionRequestHash(result.requestTransactionHash);
        if ("preRecoveryTransactionKeyVersion" in result) {
          setStaleUpgradeRequest(result);
          setEvolutionStatus(`REQUESTED · key version ${result.preRecoveryTransactionKeyVersion}`);
          setTraceMessage(`Evolution request ${short(result.requestId)} queued; Recovery required`);
        } else {
          setEvolutionCancelHash(result.cancelTransactionHash);
          setEvolutionStatus("PASS · requested, bounded, and canceled");
          setActions((current) => ({ ...current, evolutionTest: true }));
          setTraceMessage(`Evolution request ${short(result.requestId)} canceled`);
        }
      }
    } catch (error) {
      if (error instanceof AccountFlowError) setAccountDebug(error.debug);
      if (action === "operation") setOperationStatus("Failed");
      if (action === "evolutionTest") setEvolutionStatus("Failed");
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setTraceMessage(`${action} failed · ${message}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleFinalizeStaleAndCancel = async () => {
    if (!staleUpgradeRequest || !recoveryResult || !replacementPasskey || !deployment || kitBusy) return;
    setKitBusy("sign");
    setKitError(null);
    try {
      const result = await cancelPhase3BStaleUpgrade(
        replacementPasskey,
        deployment,
        staleUpgradeRequest,
      );
      setStaleFinalizeError(result.staleFinalizeError);
      setEvolutionCancelHash(result.cancellationTransactionHash);
      setEvolutionStatus("PASS · stale finalize rejected and new key canceled");
      setActions((value) => ({ ...value, evolutionTest: true }));
      const operation = await signAndSubmitTestOperation(replacementPasskey, deployment);
      setUserOpHash(operation.userOpHash);
      setTransactionHash(operation.transactionHash);
      setOperationStatus("PASS · new Transaction Passkey remains operational");
      setActions((value) => ({ ...value, operation: true }));
      setKitStatus("LIVE STALE EVOLUTION PROOF: PASS");
    } catch (error) {
      setKitError(error instanceof Error ? error.message : String(error));
    } finally {
      setKitBusy(null);
    }
  };

  const readouts = [
    ["RP-ID hash", short(deployment?.rpIdHash)],
    ["predicted", short(deployment?.predictedAddress)],
    ["deployed", short(deployment?.deployedAddress)],
    ["create tx hash", short(accountDebug?.txHash)],
    ["userOp hash", short(userOpHash)],
    ["operation tx", short(transactionHash)],
    ["evolution request", short(evolutionRequestHash)],
    ["evolution cancel", short(evolutionCancelHash)],
    ["stale finalize", staleFinalizeError ?? "—"],
    ["recovery tx", short(recoveryResult?.recoveryTransactionHash)],
    ["recovery request", short(recoveryResult?.requestId)],
    ["recovery nonce", recoveryResult?.nonce ?? "—"],
    ["transaction key version", recoveryResult?.transactionKeyVersion ?? "—"],
    ["recovery key version", recoveryResult?.recoveryKeyVersion ?? "—"],
  ];

  const kitReady = kitGenerated && kitExportSucceeded && backupConfirmed;
  const accountReady = Boolean(deployment);

  return (
    <main className="site-shell">
      <header className="topbar">
          <a className="wordmark" href="#top" aria-label="Alpha Prime home" data-testid="link-alpha-prime-home">
          <span className="wordmark-glyph">α</span>
          <span>ALPHA PRIME</span>
          <span className="wordmark-suffix">/ PHASE 3B</span>
        </a>
        <div className="network-state" data-testid="status-network">
          <span className="network-dot" />
          {DEMO_NETWORK_NAME} · chain {DEMO_CHAIN_ID.toString()}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">Live testnet acceptance · Phase 3B</span>
          <h1>
            The right key
            <br />
            for every action.
          </h1>
          <p className="hero-lede">
            A guided browser Passkey flow for creating, using, and recovering one
            permanent account on BSC Testnet.
          </p>
          <div className="hero-meta">
            <span><Fingerprint size={15} /> WebAuthn / P-256</span>
            <span><ShieldCheck size={15} /> Atomic key rotation</span>
          </div>
        </div>
        <details className="proof-card">
          <summary className="proof-card-header">
            <span>PROTOCOL DIAGNOSTICS</span>
            <Cpu size={17} />
          </summary>
          <dl>
            <div><dt>EntryPoint</dt><dd>{short(ENTRYPOINT_V08_ADDRESS)}</dd></div>
            <div><dt>Factory</dt><dd>{short(accountDebug?.factoryAddress ?? DEMO_FACTORY_ADDRESS)}</dd></div>
            <div><dt>Authority</dt><dd>{short(deployment?.authority)}</dd></div>
            <div><dt>Evolution</dt><dd>{short(deployment?.evolutionController)}</dd></div>
          </dl>
        </details>
      </section>

      <section className="demo-section" id="demo">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Live protocol trace</span>
            <h2>Perform the authorized sequence</h2>
          </div>
          <span className="panel-number">
              5 steps / {actions.operation ? "1 proof" : "0 proofs"}
          </span>
        </div>

        <div className="demo-grid">
          <div className="action-panel">
            {steps.map((step) => {
              const complete = step.action === "kit" ? kitReady : actions[step.action];
              const busy = busyAction === step.action;
              const blocked =
                (step.action === "evolution" && !passkeys.transaction) ||
                (step.action === "kit" && (!passkeys.transaction || !passkeys.evolution)) ||
                (step.action === "account" && !accountCreationGateReady) ||
                (step.action === "operation" && !deployment);
              return (
                <article className={`flow-step ${complete ? "complete" : ""}`} key={step.action}>
                  <div className="step-number">{step.number}</div>
                  <div className="step-copy">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                  <button
                    className={`action-button ${complete ? "complete" : ""}`}
                    onClick={() => void handleAction(step.action)}
                    disabled={busyAction !== null || blocked}
                    data-testid={`button-${step.action}`}
                  >
                    {busy ? <Loader2 className="spin" size={14} /> : complete ? <Check size={14} /> : step.action.includes("evolution") ? <ShieldCheck size={14} /> : <KeyRound size={14} />}
                    {busy ? "Waiting…" : complete ? "Complete" : step.actionLabel}
                    {!busy && !complete && <ArrowUpRight size={13} />}
                  </button>
                </article>
              );
            })}
          </div>

          <aside className="readout-panel">
            <div className="readout-header">
              <div><Activity size={15} /><span>TEST STATUS</span></div>
              <span className={actions.operation ? "status-pass" : "status-idle"}>
                {actions.operation ? "READY" : "NOT RUN"}
              </span>
            </div>
            <div className="readout-footer">
              <span>account operation</span><strong>{operationStatus}</strong>
            </div>
            <details className="diagnostics-panel">
              <summary>Developer diagnostics</summary>
              <div className="readout-body">
                {readouts.map(([label, value]) => (
                  <div className="readout-row" key={label}>
                    <span>{label}</span>
                    <code title={value}>{value}</code>
                  </div>
                ))}
              </div>
            </details>
          </aside>
        </div>

        <div className="trace-strip">
          <span className="trace-label">latest activity</span>
          <span className={`trace-value ${errorMessage ? "error" : "ready"}`}>{traceMessage}</span>
        </div>
      </section>

      {accountReady && deployment && (
        <section className="account-ready-panel" data-testid="status-account-ready" aria-labelledby="account-ready-title">
          <div className="account-ready-copy">
            <span className="eyebrow">Your permanent account</span>
            <h2 id="account-ready-title">ACCOUNT READY</h2>
            <code>{deployment.account}</code>
          </div>
          <div className="account-ready-statuses">
            <span><Check size={14} /> BSC Testnet</span>
            <span><Check size={14} /> Transaction Passkey · ACTIVE</span>
            <span><Check size={14} /> Recovery Kit · BACKED UP</span>
            <span><Check size={14} /> Evolution Passkey · READY</span>
          </div>
        </section>
      )}

      <section className="recovery-section" id="recovery-kit" aria-labelledby="recovery-title">
        <div className="section-heading recovery-heading">
          <div>
            <span className="eyebrow">Local-only custody workflow</span>
            <h2 id="recovery-title">RECOVERY</h2>
          </div>
          <span className="panel-number">R1 → R2 · SAME ACCOUNT</span>
        </div>
        <div className="recovery-notice">
          <LockKeyhole size={17} />
          <p><strong>RECOVERY IS IMMEDIATE.</strong> Import the encrypted kit, create a replacement Transaction Passkey, make a new R2 kit, and submit one atomic rotation. There is no Recovery delay, pending Recovery, or Recovery finalization step. Recovery stays local and the relay has zero account authority.</p>
        </div>
        <div className="recovery-grid">
          <article className="recovery-card">
            <div className="card-topline"><span className="card-index">01</span><span>SET UP R1</span></div>
            <h3>Create Offline Recovery Kit R1</h3>
            <p className="card-copy">This is your emergency recovery credential. It is generated and encrypted locally, then downloaded for your own backup.</p>
            <details className="technical-details">
              <summary>Show account binding details</summary>
              <div className="field-grid">
              {([
                ["address", "Account address", "0x…"],
                ["authority", "Authority address", "0x…"],
                ["chainId", "Chain ID", "97"],
                ["rpIdHash", "RP-ID hash", "0x…"],
              ] as const).map(([field, label, placeholder]) => (
                <label className="field" key={field}>
                  <span>{label}</span>
                  <input data-testid={`input-kit-${field}`} value={kitAccount[field]} placeholder={placeholder} onChange={(event) => updateKitAccount(field, event.target.value)} />
                </label>
              ))}
              </div>
            </details>
            <div className="field-grid password-grid">
              <label className="field"><span>Kit password <b>12+ chars</b></span><input data-testid="input-kit-password" type="password" value={kitPassword} onChange={(event) => updateKitPassword(event.target.value)} autoComplete="new-password" /></label>
              <label className="field"><span>Confirm password</span><input data-testid="input-kit-password-confirm" type="password" value={kitPasswordConfirm} onChange={(event) => { setKitPasswordConfirm(event.target.value); setKitGenerated(false); setKitExportSucceeded(false); setBackupConfirmed(false); }} autoComplete="new-password" /></label>
            </div>
            <button className="action-button recovery-action" data-testid="button-create-recovery-kit" onClick={() => void handleCreateKit()} disabled={!passkeys.transaction || !passkeys.evolution || kitBusy !== null}>
              {kitBusy === "create" ? <Loader2 className="spin" size={14} /> : <Download size={14} />} {kitBusy === "create" ? "Encrypting locally…" : "Generate & download kit"}
            </button>
            <label className={`confirm-line ${!kitExportSucceeded ? "is-disabled" : ""}`}>
              <input data-testid="checkbox-backup-confirmed" type="checkbox" checked={backupConfirmed} disabled={!kitExportSucceeded} onChange={(event) => setBackupConfirmed(event.target.checked)} />
              <span>I confirm I have completed my own backup procedure for the downloaded file.</span>
            </label>
            <p className="stopped-note">After the kit is downloaded and backed up, return to the setup steps above to create the Smart Account.</p>
          </article>

          <article className="recovery-card">
            <div className="card-topline"><span className="card-index">02</span><span>RECOVER EXISTING ACCOUNT</span></div>
            <h3>Restore an existing account</h3>
            <p className="card-copy">Import R1 and enter its password locally. The permanent Smart Account address never changes.</p>
            <label className="field"><span>Kit password</span><input data-testid="input-import-password" type="password" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} autoComplete="off" /></label>
            <label className="file-picker" data-testid="label-import-recovery-kit"><Upload size={15} /><span>{kitBusy === "open" ? "Opening locally…" : "Choose Recovery Kit JSON"}</span><input data-testid="input-import-recovery-kit" type="file" accept="application/json,.json" onChange={(event) => void handleImportKit(event)} disabled={kitBusy !== null} /></label>
            {importedAccount && <div className="metadata-readout" data-testid="status-imported-metadata">
              <div><span>account</span><code>{short(importedAccount.address)}</code></div>
              <div><span>authority</span><code>{short(importedAccount.authority)}</code></div>
              <div><span>chain / RP</span><code>{importedAccount.chainId} · {short(importedAccount.rpIdHash)}</code></div>
            </div>}
            <details className="technical-details">
              <summary>Advanced Passkey selection</summary>
              <label className="field">
                <span>Credential ID hint <b>optional</b></span>
                <input
                  data-testid="input-reconnect-credential-id"
                  value={reconnectCredentialHint}
                  onChange={(event) => setReconnectCredentialHint(event.target.value.trim())}
                  placeholder="base64url credential ID"
                  autoComplete="off"
                />
              </label>
            </details>
            <button className="action-button recovery-action secondary-action" data-testid="button-reconnect-current-transaction" onClick={() => void handleReconnectCurrentTransaction()} disabled={!openedSession || kitBusy !== null}>
              <Fingerprint size={14} /> Use Existing Transaction Passkey
            </button>
            <button className="action-button recovery-action secondary-action" data-testid="button-reconnect-evolution" onClick={() => void handleReconnectEvolution()} disabled={!openedSession || kitBusy !== null}>
              <Fingerprint size={14} /> Use Existing Evolution Passkey
            </button>
            <button className="action-button recovery-action secondary-action" data-testid="button-create-new-transaction-passkey" onClick={() => void handleCreateReplacementPasskey()} disabled={!openedSession || busyAction !== null || kitBusy !== null}>
              <KeyRound size={14} /> {kitBusy === "passkey" ? "Creating Passkey…" : replacementPasskey ? "NEW Transaction Passkey created" : "Create NEW Transaction Passkey"}
            </button>
            {replacementPasskey && <div className="metadata-readout" data-testid="status-replacement-passkey"><div><span>new transaction qx</span><code>{short(replacementPasskey.qx)}</code></div><div><span>credential</span><code>{short(replacementPasskey.credentialId)}</code></div></div>}
            <button className="action-button recovery-action secondary-action" data-testid="button-create-next-recovery-kit" onClick={() => void handleCreateNextKit()} disabled={!openedSession || kitBusy !== null}>
              <Download size={14} /> Generate & download fresh R2 Recovery Kit
            </button>
            <label className={`confirm-line ${!nextKitExportSucceeded ? "is-disabled" : ""}`}>
              <input data-testid="checkbox-next-kit-backup-confirmed" type="checkbox" checked={nextKitBackupConfirmed} disabled={!nextKitExportSucceeded} onChange={(event) => setNextKitBackupConfirmed(event.target.checked)} />
              <span>I separately confirm my backup procedure for the new R2 kit.</span>
            </label>
            <button className="action-button recovery-action secondary-action" data-testid="button-sign-recovery-digest" onClick={() => void handleSignDigest()} disabled={!openedSession || !replacementPasskey || !nextRecoveryPublicKey || !nextKitExportSucceeded || !nextKitBackupConfirmed || kitBusy !== null}>
               <FileKey2 size={14} /> {kitBusy === "sign" ? "Rotating…" : "Sign R1 & rotate B + R2"}
            </button>
            {signature && <div className="signature-result" data-testid="status-recovery-signature"><span>authorization</span><strong>completed locally</strong></div>}
            {recoveryResult && <div className="recovery-success" data-testid="status-atomic-rotation">
              <span className="eyebrow">Atomic rotation verified from chain</span>
              <h3>ACCOUNT RECOVERED</h3>
              <code>{deployment?.account ?? "Same permanent Smart Account"}</code>
              <div className="metadata-readout">
                <div><span>OLD TRANSACTION PASSKEY</span><code>INVALID</code></div>
                <div><span>OLD RECOVERY KIT</span><code>INVALID</code></div>
                <div><span>NEW TRANSACTION PASSKEY</span><code>ACTIVE</code></div>
                <div><span>NEW RECOVERY KIT</span><code>ACTIVE</code></div>
              </div>
              <p>To recover again later, import the newest kit and repeat the same steps: R2 → R3, then R3 → R4.</p>
              <button className="action-button recovery-action" data-testid="button-test-recovered-account" onClick={() => void handleAction("operation")} disabled={!passkeys.transaction || !deployment || busyAction !== null}>
                <KeyRound size={14} /> Test Recovered Account
              </button>
            </div>}
          </article>
        </div>
        <details className="technical-details benchmark-details">
          <summary>Recovery Kit diagnostics</summary>
          <div className="benchmark-card">
            <div><TimerReset size={16} /><div><strong>Argon2id calibration</strong><span>64 MiB memory · t=3 · p=1 · 32-byte output</span></div></div>
            <button className="benchmark-button" data-testid="button-benchmark-argon2id" onClick={() => void handleBenchmark()} disabled={kitBusy !== null}>{kitBusy === "benchmark" ? "Measuring…" : "Run benchmark"} <ArrowUpRight size={13} /></button>
            {benchmarkMs !== null && <strong className="benchmark-result" data-testid="status-argon2id-benchmark">{benchmarkMs.toFixed(0)} ms</strong>}
          </div>
        </details>
        <div className={`recovery-status ${kitError ? "has-error" : ""}`} data-testid="status-recovery-kit" role="status"><span>{kitError ? "ERROR" : "LOCAL STATUS"}</span><strong>{kitError ?? kitStatus}</strong><button data-testid="button-destroy-recovery-session" disabled={!openedSession} onClick={() => { replaceSession(null); setImportedAccount(null); setImportedPublicKey(null); setReplacementPasskey(null); setImportPassword(""); setDigest(""); setSignature(null); setKitStatus("Recovery session destroyed"); }}><Trash2 size={13} /> {openedSession ? "Destroy session" : "No recovery session in memory"}</button></div>
      </section>

      <section className="evolution-section" id="evolution" aria-labelledby="evolution-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Advanced account maintenance</span>
            <h2 id="evolution-title">ACCOUNT EVOLUTION / UPGRADE</h2>
          </div>
          <span className="panel-number">OPTIONAL · TWO PASSKEYS</span>
        </div>
        <div className="evolution-panel">
          <div className="evolution-copy">
            <p className="evolution-warning"><strong>This is not Recovery.</strong> Evolution is not withdrawal protection and is not normal account usage.</p>
            <p>Use the Evolution Passkey and Transaction Passkey to queue a future Smart Account implementation upgrade. The existing 48-hour security timelock applies to Evolution only; Recovery does not use it.</p>
          </div>
          <button className="action-button evolution-action" data-testid="button-evolutionTest" onClick={() => void handleAction("evolutionTest")} disabled={!passkeys.transaction || !passkeys.evolution || !deployment || busyAction !== null}>
            <ShieldCheck size={14} /> {busyAction === "evolutionTest" ? "Testing Evolution…" : "Run Evolution test"}
          </button>
          <button className="action-button evolution-action secondary-action" data-testid="button-finalize-stale-and-cancel" onClick={() => void handleFinalizeStaleAndCancel()} disabled={!staleUpgradeRequest || !recoveryResult || !replacementPasskey || kitBusy !== null}>
            <ShieldCheck size={14} /> Prove stale upgrade rejection and cancel
          </button>
          <div className="evolution-state">
            <span>status</span><strong>{evolutionStatus}</strong>
            <span>request</span><code>{short(evolutionRequestHash)}</code>
            <span>cancel</span><code>{short(evolutionCancelHash)}</code>
          </div>
        </div>
      </section>
    </main>
  );
}