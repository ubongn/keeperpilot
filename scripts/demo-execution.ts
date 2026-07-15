// scripts/demo-execution.ts — fire ONE real onchain transaction through KeeperHub.
//
// This is the script that produces the hackathon submission proof: a real tx hash +
// explorer link executed via KeeperHub's Direct Execution API (MEV-protected, gas-sponsored).
//
// Usage:
//   KH_API_KEY=kh_... KH_NETWORK=sepolia KH_DEMO_DEST=0xRecipient npm run demo:exec
//
// In dry-run mode it validates the request without broadcasting, so you can sanity-check
// wiring safely. Flip KH_DRY_RUN=false + supply a funded wallet to broadcast for real.

import 'dotenv/config';
import { KeeperHubClient } from '../src/keeperhub/client.js';
import { resolveNetwork } from '../src/keeperhub/chains.js';
import { ExecutionFailedError } from '../src/keeperhub/errors.js';

async function main() {
  const apiKey = process.env.KH_API_KEY;
  const network = resolveNetwork(process.env.KH_NETWORK || 'sepolia');
  const dest = process.env.KH_DEMO_DEST || process.env.KH_WALLET_ADDRESS || '';
  const amount = process.env.KH_DEMO_AMOUNT || '0.001';
  const dryRun = (process.env.KH_DRY_RUN ?? 'true').toLowerCase() !== 'false';

  if (!apiKey) {
    console.error('✗ Set KH_API_KEY (a kh_ org key from app.keeperhub.com → Settings → API Keys)');
    process.exit(2);
  }
  if (!dest) {
    console.error('✗ Set KH_DEMO_DEST (recipient) or KH_WALLET_ADDRESS');
    process.exit(2);
  }

  const client = new KeeperHubClient({
    baseUrl: process.env.KH_BASE_URL || 'https://app.keeperhub.com',
    apiKey,
    dryRun,
  });

  console.log(`▶ ${dryRun ? 'DRY-RUN (simulate)' : 'BROADCAST'} transfer ${amount} native on ${network} → ${dest}`);

  const final = await client.transferAndConfirm({ network, recipientAddress: dest, amount }, {});

  if (final.status !== 'completed') {
    throw new ExecutionFailedError(`execution did not complete: ${final.status} — ${final.error ?? ''}`, final);
  }

  console.log('\n✅ ONCHAIN EXECUTION VIA KEEPERHUB\n');
  console.log(`  executionId   : ${final.executionId}`);
  console.log(`  transactionHash: ${final.transactionHash}`);
  console.log(`  transactionLink: ${final.transactionLink}`);
  console.log(`  gasUsedWei     : ${final.gasUsedWei ?? '(sponsored)'}`);
  console.log('\n→ Paste the transactionLink above into your DoraHacks submission.\n');
}

main().catch((e) => {
  console.error('✗ demo:exec failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
