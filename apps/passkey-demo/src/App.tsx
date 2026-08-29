import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  Cpu,
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  DEMO_CHAIN_ID,
  DEMO_FACTORY_ADDRESS,
  DEMO_NETWORK_NAME,
  ENTRYPOINT_V08_ADDRESS,
  AccountFlowError,
  createAvsAccount,
  createBrowserPasskey,
  signAndSubmitTestOperation,
  validateEvolutionFlow,
  type AccountDeployment,
  type AccountFlowDebug,
  type CredentialRole,
  type PasskeyMaterial,
  type PasskeySet,
} from "./lib/phase3a";

type ActionKey =
  | CredentialRole
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
    title: "Create transaction key",
    description: "The key that approves ordinary account actions.",
    action: "transaction",
    actionLabel: "Create transaction key",
  },
  {
    number: "02",
    title: "Create recovery key",
    description: "A separate reserved role, kept inactive in Phase 3A.",
    action: "recovery",
    actionLabel: "Create recovery key",
  },
  {
    number: "03",
    title: "Create evolution key",
    description: "The second signature required before an upgrade can queue.",
    action: "evolution",
    actionLabel: "Create evolution key",
  },
  {
    number: "04",
    title: "Create smart account",
    description: "Sign the full configuration and deploy one deterministic account.",
    action: "account",
    actionLabel: "Create AVS Account",
  },
  {
    number: "05",
    title: "Prove execution boundaries",
    description: "Run once, then reject target, data, value, nonce, replay and direct EOA tampering.",
    action: "operation",
    actionLabel: "Run UserOperation Tests",
  },
  {
    number: "06",
    title: "Test upgrade cancellation",
    description: "Queue a two-key upgrade, reject early finalization, then cancel it.",
    action: "evolutionTest",
    actionLabel: "Run Evolution Tests",
  },
];

const initialActions: ActionState = {
  transaction: false,
  recovery: false,
  evolution: false,
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
      } else if (action === "account") {
        if (!passkeys.transaction || !passkeys.recovery || !passkeys.evolution) {
          throw new Error("Create all three role-specific Passkeys first.");
        }
        const next = await createAvsAccount(passkeys as PasskeySet);
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
          !passkeys.recovery ||
          !passkeys.evolution ||
          !deployment
        ) {
          throw new Error("Create all credentials and the account first.");
        }
        setEvolutionStatus("WebAuthn ceremonies in progress");
        const result = await validateEvolutionFlow(
          passkeys as PasskeySet,
          deployment,
        );
        setEvolutionRequestHash(result.requestTransactionHash);
        setEvolutionCancelHash(result.cancelTransactionHash);
        setEvolutionStatus("PASS · requested, bounded, and canceled");
        setActions((current) => ({ ...current, evolutionTest: true }));
        setTraceMessage(`Evolution request ${short(result.requestId)} canceled`);
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

  const readouts = [
    ["transaction credential", short(passkeys.transaction?.credentialId)],
    ["transaction qx", short(passkeys.transaction?.qx)],
    ["recovery credential", short(passkeys.recovery?.credentialId)],
    ["recovery qx", short(passkeys.recovery?.qx)],
    ["evolution credential", short(passkeys.evolution?.credentialId)],
    ["evolution qx", short(passkeys.evolution?.qx)],
    ["RP-ID hash", short(deployment?.rpIdHash)],
    ["predicted", short(deployment?.predictedAddress)],
    ["deployed", short(deployment?.deployedAddress)],
    ["create tx hash", short(accountDebug?.txHash)],
    ["userOp hash", short(userOpHash)],
    ["operation tx", short(transactionHash)],
    ["evolution request", short(evolutionRequestHash)],
    ["evolution cancel", short(evolutionCancelHash)],
  ];

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Alpha Prime home">
          <span className="wordmark-glyph">α</span>
          <span>ALPHA PRIME</span>
          <span className="wordmark-suffix">/ PHASE 3A</span>
        </a>
        <div className="network-state" data-testid="status-network">
          <span className="network-dot" />
          {DEMO_NETWORK_NAME} · chain {DEMO_CHAIN_ID.toString()}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">Live testnet console · Phase 3A</span>
          <h1>
            The right key
            <br />
            for every action.
          </h1>
          <p className="hero-lede">
            A real browser Passkey flow that creates one deterministic account,
            separates three security roles, and proves each boundary on BSC
            Testnet.
          </p>
          <div className="hero-meta">
            <span><Fingerprint size={15} /> WebAuthn / P-256</span>
            <span><ShieldCheck size={15} /> 48-hour delay intact</span>
          </div>
        </div>
        <aside className="proof-card">
          <div className="proof-card-header">
            <span>SECURITY BOUNDARY</span>
            <Cpu size={17} />
          </div>
          <dl>
            <div><dt>EntryPoint</dt><dd>{short(ENTRYPOINT_V08_ADDRESS)}</dd></div>
            <div><dt>Factory</dt><dd>{short(accountDebug?.factoryAddress ?? DEMO_FACTORY_ADDRESS)}</dd></div>
            <div><dt>Authority</dt><dd>{short(deployment?.authority)}</dd></div>
            <div><dt>Evolution</dt><dd>{short(deployment?.evolutionController)}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="demo-section" id="demo">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Live protocol trace</span>
            <h2>Perform the authorized sequence</h2>
          </div>
          <span className="panel-number">
              6 steps / {actions.operation && actions.evolutionTest ? "2 proofs" : actions.operation ? "1 proof" : "0 proofs"}
          </span>
        </div>

        <div className="demo-grid">
          <div className="action-panel">
            {steps.map((step) => {
              const complete = actions[step.action];
              const busy = busyAction === step.action;
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
                    disabled={busyAction !== null}
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
              <div><Activity size={15} /><span>VERIFIED READOUT</span></div>
              <span className={actions.evolutionTest ? "status-pass" : "status-idle"}>
                {actions.evolutionTest ? "PASS" : "PENDING"}
              </span>
            </div>
            <div className="readout-body">
              {readouts.map(([label, value]) => (
                <div className="readout-row" key={label}>
                  <span>{label}</span>
                  <code title={value}>{value}</code>
                </div>
              ))}
            </div>
            <div className="readout-footer">
              <span>operation</span><strong>{operationStatus}</strong>
              <span>evolution</span><strong>{evolutionStatus}</strong>
            </div>
          </aside>
        </div>

        <div className="trace-strip">
          <span className="trace-label">latest activity</span>
          <span className={`trace-value ${errorMessage ? "error" : "ready"}`}>{traceMessage}</span>
        </div>
      </section>
    </main>
  );
}