// src/index.ts — KeeperPilot entry point.
//
// Boots the three layers:
//   A. Strategy agent loop (reads → decides → executes via KeeperHub)
//   B. x402 pay-per-execution gateway
//   C. Audit-trail dashboard
//
// Default mode is DRY-RUN (KH_DRY_RUN=true) so nothing broadcasts until you drop in a
// real kh_ key and flip it off. See .env.example.

import 'dotenv/config';
import { KeeperHubClient } from './keeperhub/client.js';
import { resolveNetwork, USDC_BY_CHAIN } from './keeperhub/chains.js';
import { AuditLog } from './observability/audit.js';
import { startDashboard } from './observability/dashboard.js';
import { Agent } from './agent/loop.js';
import { startGateway } from './x402/gateway.js';
import pino from 'pino';

function env(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}
function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main() {
  const log = pino({ level: env('LOG_LEVEL', 'info'), name: 'keeperpilot' });
  const audit = new AuditLog();

  const dryRun = env('KH_DRY_RUN', 'true').toLowerCase() !== 'false';
  const apiKey = env('KH_API_KEY');
  const network = resolveNetwork(env('KH_NETWORK', 'sepolia'));
  const chainId = Number(network);

  const client = new KeeperHubClient({
    baseUrl: env('KH_BASE_URL', 'https://app.keeperhub.com'),
    apiKey: apiKey || 'kh_missing',
    dryRun,
    maxRetries: 4,
  });

  // Layer C: dashboard
  await startDashboard(audit, envInt('DASH_PORT', 3000));

  // Layer B: x402 gateway (only meaningful with a real key, but harmless otherwise)
  await startGateway({
    client,
    audit,
    port: envInt('X402_PORT', 8787),
    settlement: (env('X402_SETTLE', 'base-usdc') as 'base-usdc' | 'tempo-usdce'),
    payTo: (env('X402_RECEIVER', '0x0000000000000000000000000000000000000000') as `0x${string}`),
    priceCents: envInt('X402_PRICE_CENTS', 1),
  });

  // Layer A: strategy agent
  const agent = new Agent({
    client,
    audit,
    network,
    walletAddress: env('KH_WALLET_ADDRESS'),
    usdcAddress: USDC_BY_CHAIN[chainId] ?? env('KH_USDC_ADDRESS', '0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    strategy: {
      target: { ethPct: envInt('AGENT_TARGET_ETH', 50), usdcPct: envInt('AGENT_TARGET_USDC', 50) },
      driftThresholdPct: envInt('AGENT_DRIFT_THRESHOLD_PCT', 5),
    },
    priceSource: 'fallback',
    oracleAddress: env('KH_ORACLE_ADDRESS') as `0x${string}` | undefined,
    log: { info: (m, o) => log.info(o, m), warn: (m, o) => log.warn(o, m), error: (m, o) => log.error(o, m) },
  });

  audit.record({
    kind: 'system',
    level: 'info',
    message: `KeeperPilot up — network=${network} dryRun=${dryRun} key=${apiKey ? 'set' : 'MISSING'}`,
  });

  const loopMs = envInt('AGENT_LOOP_MS', 0);
  const runOnce = async () => {
    try {
      await agent.tick();
    } catch (e) {
      audit.record({ kind: 'system', level: 'error', message: `tick failed: ${e instanceof Error ? e.message : e}` });
      log.error({ err: e }, 'tick failed');
    }
  };

  if (loopMs > 0) {
    log.info({ loopMs }, 'agent loop enabled');
    await runOnce();
    setInterval(runOnce, loopMs);
  } else {
    log.info('agent loop disabled (AGENT_LOOP_MS=0); run a single tick then idle');
    await runOnce();
    log.info('idle. dashboard + x402 gateway still serving.');
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', e);
  process.exit(1);
});
