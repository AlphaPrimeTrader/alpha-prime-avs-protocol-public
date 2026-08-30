import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
  parseEther,
} from "ethers";
import type { Plugin } from "vite";

const CHAIN_ID = 97n;
const ENTRYPOINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const APPROVED_RELAYER = "0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9";
const RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const MIN_ACCOUNT_BALANCE = parseEther("0.01");
const MAX_BODY_BYTES = 180_000;
const READ_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "net_version",
]);
const INITIALIZATION_TUPLE =
  "((bytes32,bytes32),(bytes32,bytes32),(bytes32,bytes32),bytes32,address,bytes32,address,bytes32,uint64)";
const FACTORY_INTERFACE = new Interface([
  `function createAccount(${INITIALIZATION_TUPLE} initialization,bytes creationSignature) returns (address)`,
  "function isAVSAccount(address account) view returns (bool)",
  "function evolutionController() view returns (address)",
]);
const ENTRYPOINT_INTERFACE = new Interface([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address payable beneficiary)",
]);
const ACCOUNT_INTERFACE = new Interface([
  "function execute(bytes32 mode,bytes executionData)",
  "function requestUpgrade((address,bytes32,uint64,uint48,uint48,bytes32) request,bytes transactionSignature,bytes evolutionSignature)",
  "function cancelUpgrade(bytes32 requestId,bytes transactionSignature)",
  "function requestRecovery(((bytes32,bytes32),(bytes32,bytes32),uint256,bytes32) request,bytes recoverySignature)",
  "function creationFactory() view returns (address)",
]);

type RelayKind = "createAccount" | "userOperation" | "recovery";
type RelayRequest = { kind: RelayKind; to: string; data: string };

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const isHexData = (value: unknown): value is string =>
  typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);

export function phase3BTestnetRelayPlugin(input: {
  factory: string;
  implementation: string;
  nextImplementation: string;
  testReceiver: string;
}): Plugin {
  const factoryAddress = getAddress(input.factory);
  const implementationAddress = getAddress(input.implementation);
  const nextImplementationAddress = getAddress(input.nextImplementation);
  const testReceiverAddress = getAddress(input.testReceiver);
  let accountCreations = 0;
  let relays = 0;

  return {
    name: "phase3b-testnet-relay",
    apply: "serve",
    configureServer(server) {
      const configuredHost = server.config.server.host;
      const loopbackBound =
        configuredHost === "127.0.0.1" || configuredHost === "localhost";
      const publicUntil = Number(
        process.env.PHASE3B_LIVE_RELAY_PUBLIC_UNTIL ?? "0",
      );
      const now = Math.floor(Date.now() / 1000);
      const temporaryPublicWindow =
        Number.isInteger(publicUntil) &&
        publicUntil > now &&
        publicUntil <= now + 24 * 60 * 60;
      if (!loopbackBound && !temporaryPublicWindow) {
        throw new Error(
          "Phase 3B live relay may only run on a loopback-bound Vite server.",
        );
      }
      if (!loopbackBound) {
        server.config.logger.warn(
          `Phase 3B manual acceptance relay is public until ${new Date(publicUntil * 1000).toISOString()}.`,
        );
      }
      const privateKey = process.env.BSC_TESTNET_DEPLOYER_PRIVATE_KEY;
      if (!privateKey) {
        server.config.logger.warn("Phase 3B relay disabled: deployer secret unavailable.");
        return;
      }
      const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), {
        staticNetwork: true,
      });
      const wallet = new Wallet(privateKey, provider);
      const factory = new Contract(factoryAddress, FACTORY_INTERFACE, provider);

      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (!pathname.endsWith("/__phase3b-testnet/status") &&
            !pathname.endsWith("/__phase3b-testnet/rpc") &&
            !pathname.endsWith("/__phase3b-testnet/relay")) {
          next();
          return;
        }
        try {
          if (!loopbackBound && Math.floor(Date.now() / 1000) >= publicUntil) {
            sendJson(response, 503, {
              error: "The manual acceptance relay window has expired.",
            });
            return;
          }
          const origin = request.headers.origin;
          const host = request.headers.host;
          if (request.headers["sec-fetch-site"] !== "same-origin") {
            throw new Error("Only same-origin Phase 3B relay access is allowed.");
          }
          // A reverse proxy may strip Origin from same-origin POSTs.
          // Sec-Fetch-Site remains browser-controlled and is required above;
          // when Origin survives the proxy, still verify it strictly.
          if (
            origin &&
            (!host || new URL(origin).host !== host)
          ) {
            throw new Error("Cross-origin Phase 3B relay access is not allowed.");
          }
          const network = await provider.getNetwork();
          const relayer = getAddress(await wallet.getAddress());
          if (network.chainId !== CHAIN_ID || relayer !== APPROVED_RELAYER) {
            throw new Error("Phase 3B relay identity or chain is not approved.");
          }

          if (pathname.endsWith("/status")) {
            sendJson(response, 200, {
              enabled: true,
              chainId: network.chainId.toString(),
              relayer,
              factory: factoryAddress,
              entryPoint: ENTRYPOINT,
            });
            return;
          }

          if (request.method !== "POST") {
            sendJson(response, 405, { error: "POST required." });
            return;
          }
          const body = await readJson(request);

          if (pathname.endsWith("/rpc")) {
            type RpcRequest = { id?: unknown; method?: unknown; params?: unknown };
            const isBatch = Array.isArray(body);
            const rpcRequests = (isBatch ? body : [body]) as RpcRequest[];
            if (rpcRequests.length === 0 || rpcRequests.length > 20) {
              throw new Error("RPC batch size is outside the Phase 3B harness bounds.");
            }
            for (const rpc of rpcRequests) {
              if (typeof rpc.method !== "string" || !READ_METHODS.has(rpc.method)) {
                throw new Error("RPC method is not allowed by the Phase 3B harness.");
              }
            }
            const results = await Promise.all(rpcRequests.map(async (rpc) => {
              try {
                const params = Array.isArray(rpc.params) ? rpc.params : [];
                const result = await provider.send(rpc.method as string, params);
                return { jsonrpc: "2.0", id: rpc.id ?? null, result };
              } catch (error) {
                return {
                  jsonrpc: "2.0",
                  id: rpc.id ?? null,
                  error: {
                    code: -32000,
                    message: error instanceof Error ? error.message : "BSC Testnet RPC request failed.",
                  },
                };
              }
            }));
            sendJson(response, 200, isBatch ? results : results[0]);
            return;
          }

          const relay = body as Partial<RelayRequest>;
          if (!relay.kind || !relay.to || !isHexData(relay.data)) {
            throw new Error("Malformed relay request.");
          }
          const to = getAddress(relay.to);
          if (relays >= 24) throw new Error("Phase 3B relay transaction limit reached.");
          relays += 1;
          let gasLimit: bigint;
          let createdAccount: string | undefined;

          if (relay.kind === "createAccount") {
            if (accountCreations >= 2 || to !== factoryAddress) {
              throw new Error("Account creation relay is not allowed.");
            }
            accountCreations += 1;
            if (!relay.data.startsWith(FACTORY_INTERFACE.getFunction("createAccount")!.selector)) {
              throw new Error("Only Factory.createAccount may be relayed.");
            }
            const decoded = FACTORY_INTERFACE.decodeFunctionData("createAccount", relay.data);
            const initialization = decoded[0];
            if (
              getAddress(initialization[4]) !== factoryAddress ||
              getAddress(initialization[6]) !== implementationAddress ||
              BigInt(initialization[8]) !== 1n ||
              !isHexData(decoded[1]) ||
              decoded[1] === "0x"
            ) {
              throw new Error("Account initialization is outside the approved harness bounds.");
            }
            const result = await provider.call({ from: relayer, to, data: relay.data });
            [createdAccount] = FACTORY_INTERFACE.decodeFunctionResult("createAccount", result);
            createdAccount = getAddress(createdAccount!);
            gasLimit = 6_500_000n;
          } else if (relay.kind === "userOperation") {
            if (to !== ENTRYPOINT ||
                !relay.data.startsWith(ENTRYPOINT_INTERFACE.getFunction("handleOps")!.selector)) {
              throw new Error("Only canonical EntryPoint.handleOps may be relayed.");
            }
            const [operations, beneficiary] =
              ENTRYPOINT_INTERFACE.decodeFunctionData("handleOps", relay.data);
            if (operations.length !== 1 || getAddress(beneficiary) !== relayer) {
              throw new Error("Exactly one UserOperation with the relayer beneficiary is required.");
            }
            const operation = operations[0];
            if (
              operation.initCode !== "0x" ||
              operation.paymasterAndData !== "0x" ||
              operation.signature === "0x" ||
              !(await factory.isAVSAccount(getAddress(operation.sender)))
            ) {
              throw new Error("UserOperation is outside the approved account bounds.");
            }
            const selector = operation.callData.slice(0, 10);
            const executeSelector = ACCOUNT_INTERFACE.getFunction("execute")!.selector;
            const requestSelector = ACCOUNT_INTERFACE.getFunction("requestUpgrade")!.selector;
            const cancelSelector = ACCOUNT_INTERFACE.getFunction("cancelUpgrade")!.selector;
            if (selector === executeSelector) {
              const [, executionData] =
                ACCOUNT_INTERFACE.decodeFunctionData("execute", operation.callData);
              const executions = AbiCoder.defaultAbiCoder().decode(
                ["tuple(address target,uint256 value,bytes callData)[]"],
                executionData,
              )[0];
              if (executions.length !== 1 ||
                  BigInt(executions[0].value) !== 0n ||
                  getAddress(executions[0].target) !== testReceiverAddress) {
                throw new Error("Account execution is outside the approved TestReceiver bounds.");
              }
            } else if (selector === requestSelector) {
              const [upgrade, transactionSignature, evolutionSignature] =
                ACCOUNT_INTERFACE.decodeFunctionData("requestUpgrade", operation.callData);
              const code = await provider.getCode(nextImplementationAddress);
              if (getAddress(upgrade[0]) !== nextImplementationAddress ||
                  upgrade[1] !== keccak256(code) ||
                  BigInt(upgrade[2]) !== 2n ||
                  transactionSignature === "0x" ||
                  evolutionSignature === "0x") {
                throw new Error("Evolution request is outside the approved v2 bounds.");
              }
            } else if (selector === cancelSelector) {
              const [requestId, transactionSignature] =
                ACCOUNT_INTERFACE.decodeFunctionData("cancelUpgrade", operation.callData);
              if (requestId === `0x${"00".repeat(32)}` || transactionSignature === "0x") {
                throw new Error("Evolution cancellation authorization is missing.");
              }
            } else {
              throw new Error("UserOperation account selector is not allowlisted.");
            }
            gasLimit = 2_500_000n;
          } else if (relay.kind === "recovery") {
            if (!relay.data.startsWith(ACCOUNT_INTERFACE.getFunction("requestRecovery")!.selector) ||
                !(await factory.isAVSAccount(to))) {
              throw new Error("Recovery target is not an approved Phase 3B account.");
            }
            const account = new Contract(to, ACCOUNT_INTERFACE, provider);
            if (getAddress(await account.creationFactory()) !== factoryAddress) {
              throw new Error("Recovery account Factory binding is invalid.");
            }
            const decoded = ACCOUNT_INTERFACE.decodeFunctionData("requestRecovery", relay.data);
            if (!isHexData(decoded[1]) || decoded[1] === "0x") {
              throw new Error("Recovery authorization is missing.");
            }
            gasLimit = 1_500_000n;
          } else {
            throw new Error("Unknown relay operation.");
          }

          await provider.call({ from: relayer, to, data: relay.data });
          const transaction = await wallet.sendTransaction({
            to,
            data: relay.data,
            value: 0n,
            gasLimit,
          });
          const receipt = await transaction.wait();
          if (!receipt || receipt.status !== 1) throw new Error("Relayed transaction reverted.");
          let funding:
            | { transactionHash: string; blockNumber: number; amountWei: string }
            | undefined;
          if (createdAccount) {
            const balance = await provider.getBalance(createdAccount);
            if (balance < MIN_ACCOUNT_BALANCE) {
              const amount = MIN_ACCOUNT_BALANCE - balance;
              const fundingTransaction = await wallet.sendTransaction({
                to: createdAccount,
                value: amount,
                gasLimit: 50_000n,
              });
              const fundingReceipt = await fundingTransaction.wait();
              if (!fundingReceipt || fundingReceipt.status !== 1) {
                throw new Error("Minimal account funding failed.");
              }
              funding = {
                transactionHash: fundingReceipt.hash,
                blockNumber: fundingReceipt.blockNumber,
                amountWei: amount.toString(),
              };
            }
          }
          sendJson(response, 200, {
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            status: receipt.status,
            relayer,
            createdAccount,
            funding,
          });
        } catch (error) {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : "Phase 3B relay failed.",
          });
        }
      });
    },
  };
}