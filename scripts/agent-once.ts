// scripts/agent-once.ts — run a single agent tick (read → decide → execute → observe)
// and print the result + any real tx link. Great for demos / CI smoke checks.

import 'dotenv/config';
import { KeeperHubClient } from '../src/keeperhub/client.js';
import { resolveNetwork, USDC_BY_CHAIN } from '../src/keeperhub/chains.js';
import { AuditLog } from '../src/observability/audit.js';
import { Agent } from '../src/agent/loop.js';

async function main() {
  const apiKey = process.env.KH_API_KEY || 'kh_missing';
  const network = resolveNetwork(process.env.KH_NETWORK || 'sepolia');
  const chainId = Number(network);
  const dryRun = (process.env.KH_DRY_RUN ?? 'true').toLowerCase() !== 'false';

  const client = new KeeperHubClient({
    baseUrl: process.env.KH_BASE_URL || 'https://app.keeperhub.com',
    apiKey,
    dryRun,
  });
  const audit = new AuditLog();
  const agent = new Agent({
    client,
    audit,
    network,
    walletAddress: process.env.KH_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000',
    usdcAddress: USDC_BY_CHAIN[chainId] || '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    strategy: {
      target: { ethPct: Number(process.env.AGENT_TARGET_ETH || 50), usdcPct: Number(process.env.AGENT_TARGET_USDC || 50) },
      driftThresholdPct: Number(process.env.AGENT_DRIFT_THRESHOLD_PCT || 5),
    },
    priceSource: 'fallback',
  });

  const result = await agent.tick();
  console.log('\n── agent tick ──');
  console.log('decision:', result.action.kind === 'swap' ? `${result.action.side} ${result.action.amountEth} ETH` : `no-op: ${result.action.reason}`);
  if (result.execution) {
    console.log('execution status:', result.execution.status);
    console.log('transactionLink:', result.execution.transactionLink);
  }
  console.log('\n── audit trail ──');
  for (const e of audit.list(20)) {
    console.log(`  [${e.kind}] ${e.message}${e.transactionLink ? '  → ' + e.transactionLink : ''}`);
  }
}

main().catch((e) => {
  console.error('✗ agent:once failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
