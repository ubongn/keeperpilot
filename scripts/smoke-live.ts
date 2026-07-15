// scripts/smoke-live.ts — hits the REAL KeeperHub API to prove the client works in prod.
// /api/chains is readable without a key (10/min unauth). Run: npx tsx scripts/smoke-live.ts
import { KeeperHubClient } from '../src/keeperhub/client.js';

const client = new KeeperHubClient({ baseUrl: 'https://app.keeperhub.com', apiKey: 'none' });
const chains = await client.listChains();
const sepolia = chains.find((c) => c.chainId === 11155111);
const base = chains.find((c) => c.chainId === 8453);
console.log(`✓ live GET /api/chains → ${chains.length} chains`);
console.log(`  Ethereum Sepolia (11155111) privateMempool/MEV-prot: ${sepolia?.usePrivateMempoolRpc}`);
console.log(`  Base (8453) enabled: ${base?.isEnabled}`);
