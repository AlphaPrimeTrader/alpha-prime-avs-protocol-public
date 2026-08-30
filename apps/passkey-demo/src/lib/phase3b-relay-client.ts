import { JsonRpcProvider, getAddress } from "ethers";

export type Phase3BRelayStatus = {
  enabled: true;
  chainId: string;
  relayer: string;
  factory: string;
  entryPoint: string;
};

export type Phase3BRelayResult = {
  transactionHash: string;
  blockNumber: number;
  status: number;
  relayer: string;
  createdAccount?: string;
  funding?: {
    transactionHash: string;
    blockNumber: number;
    amountWei: string;
  };
};

const endpoint = (path: string) =>
  new URL(`__phase3b-testnet/${path}`, document.baseURI).toString();

const parseResponse = async <T>(response: Response): Promise<T> => {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Phase 3B test harness request failed.");
  return body;
};

export const connectPhase3BRelay = async () => {
  const status = await parseResponse<Phase3BRelayStatus>(
    await fetch(endpoint("status"), { cache: "no-store", credentials: "same-origin" }),
  );
  if (
    status.chainId !== "97" ||
    getAddress(status.relayer) !== "0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9" ||
    getAddress(status.entryPoint) !== "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"
  ) {
    throw new Error("Phase 3B test harness identity is invalid.");
  }
  const provider = new JsonRpcProvider(endpoint("rpc"), 97, { staticNetwork: true });
  return {
    provider,
    chainId: 97n,
    relayerAddress: getAddress(status.relayer),
    factoryAddress: getAddress(status.factory),
  };
};

export const relayPhase3BTransaction = async (
  kind: "createAccount" | "userOperation" | "recovery",
  to: string,
  data: string,
): Promise<Phase3BRelayResult> =>
  parseResponse<Phase3BRelayResult>(
    await fetch(endpoint("relay"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, to, data }),
    }),
  );