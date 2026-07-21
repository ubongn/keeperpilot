// src/keeperhub/types.ts — type definitions for the KeeperHub Direct Execution API

/** A network can be referenced by name or numeric chainId (KeeperHub accepts both). */
export type NetworkRef = string;

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'queued';

export type ExecutionType = 'transfer' | 'contract-call' | 'check-and-execute' | 'protocol-action' | string;

/** POST /api/execute/transfer request body. */
export interface TransferRequest {
  network: NetworkRef;
  recipientAddress: string;
  amount: string;
  /** ERC-20 token address. Omit for native (ETH/MATIC) transfer. */
  tokenAddress?: string;
  gasLimitMultiplier?: string;
  /** Dry-run: estimate + validate without broadcasting. */
  simulate?: boolean;
}

export interface ContractCallRequest {
  network: NetworkRef;
  contractAddress: string;
  /** ABI fragment of the function to call. */
  abi: unknown[];
  /** Function name (e.g. "balanceOf"). */
  functionName: string;
  /** Positional args as JSON string (e.g. "[\"0x...\"]"). */
  functionArgs?: string;
  /** Provide a value for payable calls (native sent). */
  value?: string;
  gasLimitMultiplier?: string;
  simulate?: boolean;
}

export interface CheckAndExecuteRequest {
  network: NetworkRef;
  // read -> condition -> write. Exact field set varies; we pass it through.
  [k: string]: unknown;
}

export interface ProtocolActionRequest {
  network: NetworkRef;
  /** e.g. "aave-v3/supply", "uniswap/swap". */
  action: string;
  [k: string]: unknown;
}

/** Synchronous response from a POST /api/execute/* call. */
export interface ExecuteResponse {
  executionId: string;
  status: ExecutionStatus;
  [k: string]: unknown;
}

/** GET /api/execute/{id}/status response. This is where the real tx hash lives. */
export interface ExecutionStatusResponse {
  executionId: string;
  status: ExecutionStatus;
  type?: ExecutionType;
  /** The real onchain transaction hash — submit this as hackathon proof. */
  transactionHash?: string | null;
  /** Etherscan/explorer link to the real tx. */
  transactionLink?: string | null;
  gasUsedWei?: string | null;
  result?: unknown;
  error?: string | null;
  createdAt?: string;
  completedAt?: string;
}

export interface ChainInfo {
  id: string;
  chainId: number;
  name: string;
  symbol: string;
  chainType: string;
  isTestnet: boolean;
  isEnabled: boolean;
  usePrivateMempoolRpc: boolean;
  explorerUrl?: string;
}

/** Options passed to every client call (merge of call + global defaults). */
export interface CallOptions {
  /** Client-chosen idempotency key; enables safe retries. Auto-generated if omitted. */
  idempotencyKey?: string;
  /** Force a dry-run for this call. */
  simulate?: boolean;
  /** Per-call abort signal. */
  signal?: AbortSignal;
  /** Override max retry attempts for this call. */
  maxRetries?: number;
}

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  /** When true, every write is forced to simulate:true (never broadcasts). */
  dryRun?: boolean;
  /** Max retries on transient failures (429/5xx/network). */
  maxRetries?: number;
  /** Base backoff in ms for exponential retry. */
  baseBackoffMs?: number;
  /** Hard cap on how long we poll a single execution (ms). */
  pollTimeoutMs?: number;
  /** Inject a custom fetch (testing). */
  fetchImpl?: typeof fetch;
}
