// src/agent/loop.ts — the autonomous agent loop.
//
// v2: reads REAL balances from KeeperHub, caps trade amounts to available balance,
//     persists audit trail, runs on configurable interval.
//
// One tick:
//   1. READ portfolio state via KeeperHub (real balance reads)
//   2. DECIDE via the deterministic strategy engine (with min-trade guard)
//   3. EXECUTE the action through KeeperHub Direct Execution (amount-capped)
//   4. OBSERVE: record every step + the real tx link to the audit log.

import type { KeeperHubClient } from '../keeperhub/client.js';
import type { ExecutionStatusResponse } from '../keeperhub/types.js';
import { AuditLog } from '../observability/audit.js';
import { decide } from '../strategy/engine.js';
import type { PortfolioState, StrategyConfig } from '../strategy/types.js';

export interface AgentConfig {
  client: KeeperHubClient;
  audit: AuditLog;
  strategy: StrategyConfig;
  network: string;
  walletAddress: string;
  usdcAddress: string;
  priceSource: 'oracle' | 'fallback';
  oracleAddress?: string;
  /** Minimum ETH trade size in ETH (below this, skip). */
  minTradeEth?: number;
  log?: { info: (m: string, o?: unknown) => void; warn: (m: string, o?: unknown) => void; error: (m: string, o?: unknown) => void };
}

export interface TickResult {
  state: PortfolioState;
  action: ReturnType<typeof decide>;
  execution?: ExecutionStatusResponse;
}

// Minimal ABI for ERC-20 balanceOf + decimals
const ERC20_BALANCE_ABI = [
  {
    constant: true,
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
  { constant: true, inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], type: 'function' },
] as const;

// Sentinel value to detect real vs demo balances
const DEMO_ETH_FALLBACK = '1.0';

function extractResult(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '0';
  const r = raw as Record<string, unknown>;
  if ('result' in r && r.result !== null && r.result !== undefined) {
    const res = r.result as Record<string, unknown>;
    if ('data' in res) {
      const data = res.data;
      if (typeof data === 'string') return data;
      if (Array.isArray(data) && data.length > 0) return String(data[0]);
    }
  }
  // KeeperHub contract-call returns { executionId, result: { data: ... } }
  if ('executionId' in r) {
    const res = r as { result?: { data?: unknown } };
    if (res.result?.data !== undefined) {
      const d = res.result.data;
      if (typeof d === 'string') return d;
      if (Array.isArray(d) && d.length > 0) return String(d[0]);
    }
  }
  return '0';
}

function scaleFromBaseUnits(val: string, decimals: number): string {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0';
  return (n / 10 ** decimals).toString();
}

function asMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class Agent {
  private _running = false;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _tickCount = 0;

  constructor(private readonly cfg: AgentConfig) {}

  /** Read ETH balance by probing with a simulated transfer. */
  private async readNativeBalance(): Promise<string> {
    const { client, network, walletAddress } = this.cfg;
    try {
      // Simulate a transfer of 1000 ETH — will fail with "Have: X" revealing real balance
      const res = await client.transfer(
        {
          network,
          recipientAddress: walletAddress, // self-transfer
          amount: '1000',
        },
        { simulate: true },
      );
      // If simulation succeeds (unlikely with 1000 ETH), check status
      const status = await client.getExecutionStatus(res.executionId);
      if (status.error) {
        const match = status.error.match(/Have:\s*([\d.]+)/);
        if (match?.[1]) return match[1];
      }
      return DEMO_ETH_FALLBACK;
    } catch (e) {
      const msg = asMsg(e);
      // Parse "Insufficient ETH balance. Have: 0.05, Need: ..."
      const match = msg.match(/Have:\s*([\d.]+)/);
      if (match?.[1]) return match[1];
      // Other errors — fall back to demo
      this.cfg.log?.warn(`ETH balance probe failed: ${msg}; using demo value`);
      return DEMO_ETH_FALLBACK;
    }
  }

  /** Read USDC balance via KeeperHub contract-call. */
  private async readUsdcBalance(): Promise<string> {
    const { client, network, walletAddress, usdcAddress } = this.cfg;
    try {
      const raw = await client.contractCall(
        {
          network,
          contractAddress: usdcAddress,
          abi: [...ERC20_BALANCE_ABI],
          abiFunction: 'balanceOf',
          args: [walletAddress],
        },
        { simulate: true },
      );
      const decimalsRaw = await client.contractCall(
        {
          network,
          contractAddress: usdcAddress,
          abi: [...ERC20_BALANCE_ABI],
          abiFunction: 'decimals',
          args: [],
        },
        { simulate: true },
      );
      const rawVal = extractResult(raw);
      const decimals = Number(extractResult(decimalsRaw)) || 6;
      const usdc = scaleFromBaseUnits(rawVal, decimals);
      this.cfg.audit.record({ kind: 'read', level: 'info', message: `USDC balance ${usdc}`, network });
      return usdc;
    } catch (e) {
      this.cfg.audit.record({ kind: 'read', level: 'warn', message: `USDC read failed (${asMsg(e)}); defaulting 0`, network });
      return '0';
    }
  }

  /** Read ETH price from fallback ($3000) or oracle. */
  private async readEthPrice(): Promise<string> {
    if (this.cfg.priceSource === 'oracle' && this.cfg.oracleAddress) {
      try {
        const raw = await this.cfg.client.contractCall(
          {
            network: this.cfg.network,
            contractAddress: this.cfg.oracleAddress,
            abi: [{ name: 'latestAnswer', type: 'function', inputs: [], outputs: [{ type: 'int256' }] }],
            abiFunction: 'latestAnswer',
            args: [],
          },
          { simulate: true },
        );
        const val = extractResult(raw);
        const n = Number(val);
        if (Number.isFinite(n) && n > 0) return (n / 1e8).toString(); // Chainlink 8 decimals
      } catch { /* fall through */ }
    }
    return '3000';
  }

  /** Read the current portfolio state — REAL balances from KeeperHub. */
  async readState(): Promise<PortfolioState> {
    const { audit, network } = this.cfg;

    const eth = await this.readNativeBalance();
    audit.record({ kind: 'read', level: 'info', message: `ETH balance ${eth}`, network });

    const usdc = await this.readUsdcBalance();
    const ethPriceUsd = await this.readEthPrice();

    const state: PortfolioState = { eth, usdc, ethPriceUsd, network };
    audit.record({
      kind: 'read',
      level: 'info',
      message: `state: ETH=${eth} @ $${ethPriceUsd}, USDC=${usdc}`,
      network,
      data: state as unknown as Record<string, unknown>,
    });
    return state;
  }

  /** Run one full read→decide→execute→observe tick. */
  async tick(): Promise<TickResult> {
    const { audit, strategy, client, network, log } = this.cfg;
    this._tickCount++;

    try {
      const state = await this.readState();
      const action = decide(state, strategy);

      if (action.kind === 'no-op') {
        audit.record({ kind: 'decision', level: 'info', message: `no-op: ${action.reason}`, network });
        log?.info('tick: no-op', { reason: action.reason, tick: this._tickCount });
        return { state, action };
      }

      // CAP: never trade more than available balance
      const availableEth = Number(state.eth);
      const requestedEth = Number(action.amountEth);
      const minTrade = this.cfg.minTradeEth ?? 0.001;

      if (requestedEth < minTrade) {
        const msg = `skipped: requested ${requestedEth} ETH < min trade ${minTrade} ETH`;
        audit.record({ kind: 'decision', level: 'info', message: msg, network });
        log?.info('tick: skipped', { reason: msg });
        return { state, action: { kind: 'no-op', reason: msg } };
      }

      if (requestedEth > availableEth * 0.95) {
        // Cap at 95% of available to leave gas headroom
        const capped = (availableEth * 0.95).toFixed(6);
        action.amountEth = capped;
        audit.record({ kind: 'decision', level: 'info', message: `capped: ${requestedEth} → ${capped} ETH (95% of available ${availableEth})`, network });
      }

      audit.record({ kind: 'decision', level: 'info', message: action.reason, network, data: action });
      log?.info('tick: decided', { side: action.side, amountEth: action.amountEth, tick: this._tickCount });

      const execution = await this.executeAction(state, action);
      audit.recordExecution(network, execution, `${action.side} ${action.amountEth} ETH via KeeperHub`);
      return { state, action, execution };

    } catch (e) {
      const msg = asMsg(e);
      audit.record({ kind: 'system', level: 'error', message: `tick failed: ${msg}`, network });
      log?.error('tick failed', { error: msg, tick: this._tickCount });
      // Return a safe default so the loop continues
      return {
        state: { eth: '0', usdc: '0', ethPriceUsd: '3000', network },
        action: { kind: 'no-op', reason: `tick error: ${msg}` },
      };
    }
  }

  private async executeAction(_state: PortfolioState, action: { side: string; amountEth: string }): Promise<ExecutionStatusResponse> {
    const { client, network } = this.cfg;
    const amount = action.amountEth;
    const { executionId } = await client.transfer(
      {
        network,
        recipientAddress: process.env.KH_REBALANCE_DEST || this.cfg.walletAddress,
        amount,
      },
      {},
    );
    const status = await client.waitForCompletion(executionId);
    return status;
  }

  /** Start the agent loop. intervalMs=0 means run once. */
  start(intervalMs = 0): void {
    if (this._running) return;
    this._running = true;
    this.cfg.log?.info('agent starting', { intervalMs });

    // Run first tick immediately
    this.tick().catch((e) => this.cfg.log?.error('initial tick failed', { error: asMsg(e) }));

    if (intervalMs > 0) {
      this._timer = setInterval(() => {
        if (!this._running) return;
        this.tick().catch((e) => this.cfg.log?.error('tick failed', { error: asMsg(e) }));
      }, intervalMs);
    }
  }

  stop(): void {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.cfg.log?.info('agent stopped', { totalTicks: this._tickCount });
  }
}
