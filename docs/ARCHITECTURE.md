# KeeperPilot — Build Plan & Architecture

> Status: **Phase 1** (pre-build, before Jul 27 submission open). Repo scaffolded so we
> can ship on Day 1. API verified LIVE.

## What we're building (one line)
An **autonomous onchain agent** that executes real transactions through KeeperHub —
bundled with an **x402 pay-per-execution gateway** and a live **audit-trail dashboard**.

## Why it wins (mapped to judging criteria)
| Criterion | How KeeperPilot scores |
|---|---|
| 1. Real onchain txs via KeeperHub | Direct Execution API → real `transactionLink` every time. Demo tx on Sepolia. |
| 2. KeeperHub surfaces (MCP/x402/audit) | MCP for natural-language driving; x402 gateway monetizes per-call; audit dashboard surfaces every run. **All three.** |
| 3. Reliability & observability | Client SDK: idempotency keys, dry-run simulate, retry+backoff, gas multiplier, poll-interval-honoring, structured audit log. |
| 4. Originality / usefulness | Autonomous strategy engine + x402 monetization = a *runnable onchain business*, not a demo script. |
| 5. Integration quality & DX | Typed TS SDK, CLI, docker-compose, .env.example, full tests, polished README. |

## The three layers

### Layer A — Strategy Engine (deterministic, the brain)
A portfolio **rebalance / DCA** loop. Deterministic rules so the demo never depends on an
LLM not hallucinating:
- READ state via KeeperHub (`web3/check-balance`, `web3/read-contract`) — free, no wallet.
- DECIDE: drift bands, thresholds, target allocation.
- EXECUTE: swaps (uniswap/aerodrome), supplies (aave-v3), transfers — all via KeeperHub
  Direct Execution API / protocol actions, MEV-protected, gas-sponsored.
- Optional LLM layer to *translate* natural-language strategies into rule config via MCP.

### Layer B — x402 Pay-Per-Execution Gateway (monetization)
An HTTP service: external clients request an execution ("swap 0.01 ETH→USDC on Base") and
pay per-call via **x402** (USDC on Base) or **MPP** (Tempo USDC.e). On 402 challenge we
verify the EIP-3009 payment, then fulfill via KeeperHub. Demonstrates the x402 surface
end-to-end (we've shipped this 4× before).

### Layer C — Audit-Trail Dashboard (observability)
Live web UI: every execution with real tx hash + explorer link, gas (sponsored), status,
retry attempts, strategy decisions, x402 payments collected. Backed by a durable audit log.

## Repo structure
```
keeperpilot/
  README.md  docker-compose.yml  Dockerfile  package.json  tsconfig.json
  .env.example  .gitignore
  docs/  KEEPERHUB_REFERENCE.md  ARCHITECTURE.md (this)
  src/
    keeperhub/  client.ts chains.ts types.ts errors.ts    # core SDK (hard part)
    strategy/   engine.ts rebalance.ts types.ts           # Layer A
    agent/      loop.ts runner.ts                         # autonomous loop
    x402/       gateway.ts verify.ts facilitator.ts       # Layer B
    observability/ audit.ts dashboard.ts                  # Layer C
    index.ts
  tests/   client.test.ts strategy.test.ts x402.test.ts
  scripts/ demo-execution.ts  demo-x402.ts                # demo tx producers
  web/     dashboard static assets
```

## Build order (each step independently testable)
1. **Client SDK** (`src/keeperhub/*`) — typed wrapper over Direct Execution API with all
   reliability primitives. Unit-tested with a mock fetch (works WITHOUT a key).
2. **Audit log** (`src/observability/audit.ts`) — append-only store; the spine Layer A/B/C report to.
3. **Strategy engine** (`src/strategy/*`) — pure functions, fully unit-tested.
4. **Agent loop** (`src/agent/*`) — wires read→decide→execute→observe; dry-run by default.
5. **Dashboard** (`src/observability/dashboard.ts`) — serves audit log + static UI.
6. **x402 gateway** (`src/x402/*`) — pay-per-call fulfillment.
7. **Demo scripts** — `demo-execution.ts` fires ONE real tx (the submission proof);
   `demo-x402.ts` shows a paid call.
8. **Polish** — README (badges, screenshots, tx proof), docker-compose, .env.example.

## Credentials needed (BLOCKERS — flagged to HICLAW_MANAGER)
To move from "scaffolded + unit-tested" to "real onchain txs on Sepolia":
1. A `kh_` **organization API key** (Settings → API Keys on app.keeperhub.com).
2. A **KeeperHub wallet provisioned** (agentic wallet `add`, or org wallet in dashboard).
3. **Testnet funds** from a faucet (Sepolia ETH + Sepolia USDC) sent to that wallet.
4. (For x402 demo) a small amount of **Base USDC** in the payment wallet.

Until these land, the SDK runs in `simulate:true` / mock mode and all unit tests pass.

## Day-1 (Jul 27) checklist
- [ ] drop `KH_API_KEY` + `KH_BASE_URL` into `.env`
- [ ] `npm test` green, `npm run demo:exec` prints a real `transactionLink` on Sepolia
- [ ] record demo video, paste tx link into submission
- [ ] push to GitHub, submit on DoraHacks
