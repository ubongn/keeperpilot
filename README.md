# KeeperPilot

> An **autonomous onchain agent** that executes real transactions through **KeeperHub** —
> bundled with an **x402 pay-per-execution gateway** and a live **audit-trail dashboard**.

[![KeeperHub](https://img.shields.io/badge/executes%20via-KeeperHub-6ee7b7?style=flat-square)](https://docs.keeperhub.com)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-27%20passing-22c55e?style=flat-square)](#tests)
[![License](https://img.shields.io/badge/license-MIT-gray?style=flat-square)](#license)

Built for the **KeeperHub Agents Onchain Hackathon** (DoraHacks).

KeeperPilot is an agent that **reads portfolio state, decides an action, and executes it
onchain through KeeperHub's execution layer** — getting you a real, verifiable transaction
hash with MEV-protected routing and sponsored gas. It also exposes itself as an **x402
pay-per-call service**: external clients pay USDC per execution and the agent fulfills it
via KeeperHub. Every step lands in a live audit dashboard.

---

## 🏆 Why it fits the judging criteria

| Criterion | How KeeperPilot delivers |
|---|---|
| **1. Executes onchain via KeeperHub** | Every write goes through the **Direct Execution API** (`/api/execute/transfer`, `/contract-call`, `/protocol-action`) and returns a real `transactionLink`. [Run the demo](#-produce-a-real-transaction). |
| **2. KeeperHub surfaces (MCP / x402 / audit)** | Drivable via the **KeeperHub MCP server**; monetized via **x402** pay-per-call; fully **audit-trailed** in the dashboard. All three. |
| **3. Reliability & observability** | Idempotency keys, `simulate:true` dry-runs, exponential backoff + `Retry-After`, gas-limit multipliers, poll-interval-honoring, typed errors, SSE dashboard. |
| **4. Originality & usefulness** | Not a demo script — a *runnable onchain business*: an autonomous strategy engine that anyone can drive and pay per-call. |
| **5. Integration quality & DX** | Typed SDK, CLI demo scripts, `docker-compose` one-liner, `.env.example`, 27 unit tests, full reference docs. |

---

## 🧠 How it works

```
                 ┌──────────────────────── KeeperHub ────────────────────────┐
   read state ──▶│ /api/execute/transfer  /contract-call  /protocol-action   │──▶ real tx hash
                 │   • MEV-protected private mempool  • sponsored gas         │     + explorer link
                 │   • smart gas estimation  • idempotent  • audit trail      │
                 └───────────────────────────────────────────────────────────┘
        ▲                                    │
        │                                    │
  ┌─────┴───────────┐         ┌──────────────┴───────────────┐    ┌──────────────────┐
  │ Strategy Engine │         │  x402 Pay-Per-Execution       │    │ Audit Dashboard  │
  │  read→decide→   │◀────────│  Gateway (USDC on Base/MPP)   │◀───│  live tx links   │
  │  execute→observe│  fulfill│  client pays → agent executes │    │  SSE updates     │
  └─────────────────┘         └──────────────────────────────┘    └──────────────────┘
```

**The three layers:**

- **Layer A — Strategy Engine.** A deterministic rebalance/DCA loop: read balances + ETH
  price (free KeeperHub reads), decide via drift bands, execute the rebalance through
  KeeperHub. Deterministic so the demo is reproducible; an optional LLM layer translates
  natural-language strategies into config via the MCP server.
- **Layer B — x402 Gateway.** `POST /execute` is paid: no payment → `402` challenge; valid
  x402 USDC payment → the agent fulfills the onchain action via KeeperHub and returns the
  tx link. Settles on **Base USDC** (x402) or **Tempo USDC.e** (MPP).
- **Layer C — Audit Dashboard.** A live web UI at `:3000` streaming every read, decision,
  execution (with real tx link), retry, and x402 payment over SSE.

---

## 🚀 Quick start

```bash
git clone <this-repo> keeperpilot && cd keeperpilot
npm install
cp .env.example .env        # set KH_API_KEY, KH_WALLET_ADDRESS, KH_NETWORK=sepolia
npm test                    # 27 unit tests (no key needed)
npm run agent:once          # one read→decide→execute→observe tick
```

### Produce a real transaction (the submission proof)

```bash
# 1. fund your KeeperHub wallet on Sepolia (faucet ETH/USDC)
# 2. turn broadcasting on:
export KH_DRY_RUN=false
export KH_API_KEY=kh_your_org_key
export KH_NETWORK=sepolia
export KH_DEMO_DEST=0xYourRecipient

npm run demo:exec
```

Output:
```
▶ BROADCAST transfer 0.001 native on 11155111 → 0xYourRecipient
✅ ONCHAIN EXECUTION VIA KEEPERHUB
  transactionHash : 0x…
  transactionLink : https://sepolia.etherscan.io/tx/0x…
  gasUsedWei      : (sponsored)
→ Paste the transactionLink above into your DoraHacks submission.
```

### Drive it from Claude Code via the KeeperHub MCP server

```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp \
  --header "Authorization: Bearer kh_your_key"
# then: "Use KeeperHub to check the ETH balance of 0x… and rebalance my portfolio"
```

### Deploy

```bash
docker compose up --build      # dashboard :3000 · x402 gateway :8787
```

---

## 🔌 The KeeperHub integration surface

This repo ships a typed SDK (`src/keeperhub/`) wrapping the Direct Execution API with
production-grade reliability:

| Feature | Where |
|---|---|
| `transfer` / `contractCall` / `protocolAction` / `checkAndExecute` | `client.ts` |
| Idempotency-Key auto-attach (safe retries) | `client.execute()` |
| `simulate:true` dry-run (validate without broadcast) | global `KH_DRY_RUN` |
| Retry + exponential backoff, honors `Retry-After` | `client.execute()` |
| Polls completion via `X-Poll-Interval-Hint` | `client.waitForCompletion()` |
| Typed errors: `AuthError`, `WalletNotConfiguredError`, `RateLimitError`, `IdempotencyConflictError`, `SpendingCapError`, `PollTimeoutError` | `errors.ts` |
| Live chain registry + MEV-protected flag + USDC addresses | `chains.ts` |

Full technical reference (verified live): [`docs/KEEPERHUB_REFERENCE.md`](docs/KEEPERHUB_REFERENCE.md).

---

## 🧪 Tests

```bash
npm test
```

27 tests across three suites — **all pass with no API key required** (mocked fetch):

- `tests/client.test.ts` — retries (429/500), idempotency, dry-run, error mapping, polling.
- `tests/strategy.test.ts` — rebalance math, drift bands, sell/buy decisions.
- `tests/x402.test.ts` — requirement building, payment verification, replay protection.

---

## 🔐 Credentials & safety

KeeperPilot ships in **dry-run by default** (`KH_DRY_RUN=true`) — it validates requests
without ever broadcasting. To execute real transactions you need (see `.env.example`):

1. A `kh_` **organization API key** from [app.keeperhub.com → Settings → API Keys](https://app.keeperhub.com).
2. A **KeeperHub wallet** (agentic wallet `npx -p @keeperhub/wallet keeperhub-wallet add`, or the org wallet).
3. **Testnet funds** (Sepolia ETH + USDC faucet). Testnet gas is **sponsored and free**.

No private key is ever stored on disk — KeeperHub custody is server-side (Turnkey enclave).

---

## 📁 Project layout

```
src/
  keeperhub/      typed Direct-Execution SDK (client, chains, errors, types)
  strategy/       deterministic rebalance engine (pure functions)
  agent/          autonomous loop: read → decide → execute → observe
  x402/           pay-per-execution gateway + EIP-3009 verification
  observability/  audit log + live SSE dashboard
scripts/
  demo-execution.ts   fires ONE real tx → prints the explorer link
  agent-once.ts       one full agent tick
  smoke-live.ts       proves the SDK against the live API (no key)
docs/
  KEEPERHUB_REFERENCE.md  verified platform reference
  ARCHITECTURE.md         build plan & design
```

## 🛣️ Roadmap (build phase Jul 27 – Aug 13)

- [x] Phase 1 — docs studied, SDK + strategy + x402 + dashboard scaffolded, tests green, live API verified.
- [ ] Day 1 (Jul 27) — drop in key, produce the real Sepolia tx link.
- [ ] Wire `uniswap/swap` + `aave-v3/supply` protocol actions into the rebalance path.
- [ ] LLM natural-language strategy authoring via MCP.
- [ ] Demo video + DoraHacks submission.

---

## License

[MIT](LICENSE) © Ubong — built for the [KeeperHub Agents Onchain Hackathon](https://dorahacks.io/hackathon/keeperhub-agents-onchain).
