# KeeperHub Technical Reference (verified live, 2026-07-15)

> Source of truth gathered from https://docs.keeperhub.com/ and live API probes.
> All endpoints confirmed reachable; `GET /api/chains` returns real data.

## 1. Platform model
KeeperHub = an **execution & reliability layer** for onchain automation. You describe
*what* to do (transfer / contract call / DeFi protocol action) and KeeperHub executes it
with: smart gas estimation, MEV-protected private routing, gas sponsorship, audit trail,
idempotent retries. Two ways to drive it:

- **Workflows** — visual trigger→action graphs (Manual/Schedule/Webhook/Block/Event triggers)
- **Direct Execution API** — one-shot transactions without a workflow

Both produce **real onchain transactions** with a transaction hash + explorer link. This
tx link is the hackathon's hard requirement.

## 2. Authentication — two key types (NOT interchangeable)
| Prefix | Scope | Managed at | Use for |
|---|---|---|---|
| `kh_` | Organization | `/api/keys` (Settings → API Keys) | REST API, MCP server, Claude Code plugin, **Direct Execution** |
| `wfb_` | User | `/api/api-keys` | Webhook trigger authentication |

All execution uses: `Authorization: Bearer kh_<org_key>`

## 3. Direct Execution API  (base `https://app.keeperhub.com`)
The cleanest path to a real tx. All require a `kh_` key.

### POST /api/execute/transfer
Transfer native (ETH/MATIC) OR ERC-20.
```json
{
  "network": "base",                 // chain name OR chainId
  "recipientAddress": "0x...",
  "amount": "0.1",
  "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // omit => native
  "gasLimitMultiplier": "1.2",
  "simulate": true                    // optional dry-run (no broadcast)
}
```
Returns `{ executionId, status }` synchronously. `simulate:true` returns revert reason +
gas estimate without broadcasting.

### POST /api/execute/contract-call
Read OR write any contract function (ABI-based). `simulate:true` = eth_call dry-run.

### POST /api/execute/check-and-execute
Atomic conditional: read → evaluate condition → write. Best for "execute only if X".

### GET /api/execute/{executionId}/status  ← THE TX HASH SOURCE
```json
{
  "executionId": "direct_123",
  "status": "completed",              // pending | running | completed | failed
  "type": "transfer",
  "transactionHash": "0x...",
  "transactionLink": "https://etherscan.io/tx/0x...",   // <-- submit THIS as the proof
  "gasUsedWei": "21000000000000",
  "result": {...},
  "error": null
}
```
**Poll using `X-Poll-Interval-Hint` response header** (seconds to wait; 0 = terminal).

### Reliability features (judging criterion #3)
- **Idempotency-Key** header (UUID) — safe retries, 24h window, 409 on conflict.
- **simulate:true** — dry-run before broadcasting.
- **gasLimitMultiplier** — buffer over eth_estimateGas (defaults: ETH 2.0x, L2 1.5x).
- Rate limit 60/min per key; 429 carries `Retry-After`.
- Spending caps per org (403 `Daily spending cap exceeded`).

## 4. MCP Server  (`https://app.keeperhub.com/mcp`)
Agent-facing tools over Model Context Protocol.
```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp \
  --header "Authorization: Bearer kh_..."
```
- Per-workflow servers at `/mcp/w/<slug>` (typed tool per workflow — better LLM selection).
- Key tools: `execute_transfer`, `execute_contract_call`, `execute_check_and_execute`,
  `execute_protocol_action` (DeFi, e.g. `aave-v3/supply`), `search_protocol_actions`,
  `get_direct_execution_status`, `search_workflows`, `call_workflow`, `ai_generate_workflow`.
- Paid marketplace workflows return **HTTP 402** (x402 challenge); the agentic wallet
  auto-pays and retries.

## 5. x402 / MPP payment (the monetization surface)
- KeeperHub **paid workflows** settle via **x402 on Base USDC** OR **MPP on Tempo USDC.e**.
- First-party agentic wallet: `npx -p @keeperhub/wallet keeperhub-wallet skill install`
  then `keeperhub-wallet add`. Writes `~/.keeperhub/wallet.json` (subOrgId, EVM address,
  HMAC secret — **no private key**; custody server-side in Turnkey enclave).
- PreToolUse safety hook reads `~/.keeperhub/safety.json` (auto/ask/block tiers).
- Server-side hard limits: contract allowlist (Base USDC + Tempo USDC.e), ≤100 USDC/tx,
  ≤200 USDC/day, chain allowlist.
- Official libs: `@x402/express`, `@x402/evm`, `@x402/core` (x402-foundation/Coinbase).
  `@x402/core` ships only `HTTPFacilitatorClient` (no local facilitator) — for our own
  service we self-verify (EIP-3009 signature), as we did in NarrativeRadar.

## 6. Gas sponsorship
- KeeperHub sponsors the tx fee via **Turnkey Gas Station** on Ethereum, Base, Polygon,
  Arbitrum (+ testnets). Pays GAS ONLY, not the assets moved.
- **Testnet usage is NOT charged** against the gas credit cap → hack freely on Sepolia.
- Conditions: supported network, direct wallet sender (not Safe), public mempool OK.

## 7. Live chain registry (from GET /api/chains, 2026-07-15)
| chainId | name | symbol | testnet | privateMempool |
|---|---|---|---|---|
| 1 | Ethereum Mainnet | ETH | no | **yes (MEV-prot)** |
| 11155111 | Ethereum Sepolia | ETH | yes | **yes (MEV-prot)** |
| 8453 | Base | BASE | no | no |
| 84532 | Base Sepolia | BASE | yes | no |
| 42161 | Arbitrum One | ETH | no | no |
| 421614 | Arbitrum Sepolia | ETH | yes | no |
| 137 | Polygon | MATIC | no | no |
| 80002 | Polygon Amoy | MATIC | yes | no |
| 10 | Optimism | ETH | no | no |
| 11155420 | Optimism Sepolia | ETH | yes | no |
| 4217 | Tempo | TEMPO | no | no |  <- MPP/x402 settlement |
| 42431 | Tempo Testnet | TEMPO | yes | no |
| 101 / 103 | Solana / Devnet | SOL | - | - |
| (+ BNB, Avalanche, 0G, Plasma) |

USDC addresses: Sepolia `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`,
Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`,
Ethereum `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`,
Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

## 8. DeFi protocol plugins (= execute_protocol_action targets)
Aave V3/V4, Aerodrome, Compound V3, Curve, Uniswap, CoW Swap, Morpho, Pendle, Lido,
Rocket Pool, Ethena, Sky, Spark, Ajna, Chainlink, Chronicle, Frax Ether, Superfluid,
Wrapped, Yearn V3, Hyperliquid (perps), + notifications (Discord/Slack/Telegram/SendGrid).

## 9. MCP node/action types (for workflows)
- Read actions (no wallet): `web3/check-balance`, `web3/check-token-balance`, `web3/read-contract`
- Write actions (need wallet integration): `web3/transfer-funds`, `web3/transfer-token`, `web3/write-contract`
- Triggers: Manual, Schedule, Webhook, Event, Block
- Conditions: dual true/false handles, operators incl. `>`,`<`,`==`,`contains`,`exists`...
- Templating: `{{@nodeId:Label.field}}` references prior node outputs
