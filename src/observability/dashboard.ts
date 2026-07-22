// src/observability/dashboard.ts — premium portfolio + audit dashboard.
//
// Serves a single-page UI showing:
//   • Portfolio overview (ETH, USDC, total value, current vs target allocation)
//   • Strategy panel (targets, drift threshold, current drift %)
//   • Agent status (running, last decision, last action)
//   • Transaction history (real onchain tx hashes + explorer links)
//   • x402 gateway info
//   • Live audit trail feed (SSE)

import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AuditLog } from './audit.js';

export interface DashboardContext {
  audit: AuditLog;
  strategy?: {
    targetEthPct: number;
    targetUsdcPct: number;
    driftThresholdPct: number;
  };
  network?: string;
  walletAddress?: string;
  x402Port?: number;
}

export function createDashboard(ctx: DashboardContext) {
  const { audit } = ctx;
  const app = express();

  app.use(express.json());

  // ── Portfolio API: reconstruct state from latest audit reads ──
  app.get('/api/portfolio', (_req, res) => {
    const entries = audit.list(200);
    const stateEntries = entries.filter((e) => e.kind === 'read' && e.data && (e.data as any).eth !== undefined);
    const latest = stateEntries[0];
    const eth = latest ? Number((latest.data as any).eth) : 0;
    const usdc = latest ? Number((latest.data as any).usdc) : 0;
    const ethPrice = latest ? Number((latest.data as any).ethPriceUsd) : 3000;
    const ethValue = eth * ethPrice;
    const usdcValue = usdc;
    const total = ethValue + usdcValue;
    const ethPct = total > 0 ? (ethValue / total) * 100 : 0;
    const usdcPct = total > 0 ? (usdcValue / total) * 100 : 0;

    const targetEth = ctx.strategy?.targetEthPct ?? 50;
    const targetUsdc = ctx.strategy?.targetUsdcPct ?? 50;
    const drift = Math.abs(ethPct - targetEth);

    res.json({
      eth: eth.toFixed(4),
      usdc: usdc.toFixed(2),
      ethPrice: ethPrice.toFixed(2),
      ethValue: ethValue.toFixed(2),
      usdcValue: usdcValue.toFixed(2),
      total: total.toFixed(2),
      allocation: { eth: ethPct.toFixed(1), usdc: usdcPct.toFixed(1) },
      targets: { eth: targetEth, usdc: targetUsdc },
      drift: drift.toFixed(1),
      driftThreshold: ctx.strategy?.driftThresholdPct ?? 5,
      wallet: ctx.walletAddress || '—',
      network: ctx.network || '11155111',
    });
  });

  // ── Transactions API: extract all onchain txs from audit ──
  app.get('/api/transactions', (_req, res) => {
    const entries = audit.list(500);
    const txs = entries
      .filter((e) => e.transactionHash)
      .map((e) => ({
        hash: e.transactionHash,
        link: e.transactionLink,
        kind: e.kind,
        message: e.message,
        ts: e.ts,
        network: e.network,
        status: (e.data as any)?.status,
        gasUsedWei: (e.data as any)?.gasUsedWei,
      }));
    res.json({ count: txs.length, transactions: txs });
  });

  // ── Agent Status API ──
  app.get('/api/agent', (_req, res) => {
    const entries = audit.list(50);
    const systemEntries = entries.filter((e) => e.kind === 'system');
    const lastDecision = entries.find((e) => e.kind === 'decision');
    const lastExecute = entries.find((e) => e.kind === 'execute');
    res.json({
      status: 'active',
      network: ctx.network || '11155111',
      startedAt: systemEntries[systemEntries.length - 1]?.ts || null,
      lastDecision: lastDecision?.message || null,
      lastDecisionTs: lastDecision?.ts || null,
      lastExecution: lastExecute?.message || null,
      lastExecutionTs: lastExecute?.ts || null,
    });
  });

  // ── Audit entries (JSON) ──
  app.get('/api/audit', (_req, res) => {
    res.json(audit.list(200));
  });

  // ── SSE: live updates ──
  app.get('/api/audit/stream', (req, res) => {
    res.set('Content-Type', 'text/event-stream');
    res.set('Cache-Control', 'no-cache');
    res.set('Connection', 'keep-alive');
    res.flushHeaders?.();
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
    const unsub = audit.subscribe((entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });
    req.on('close', () => {
      clearInterval(keepAlive);
      unsub();
    });
  });

  // ── Dashboard HTML ──
  app.get('/', (_req, res) => {
    res.type('html').send(DASHBOARD_HTML);
  });

  // ── Architecture diagram ──
  app.get('/architecture.html', (_req, res) => {
    try {
      // Try multiple paths (local dev vs Docker build)
      const here = dirname(fileURLToPath(import.meta.url));
      const candidates = [
        join(process.cwd(), 'public', 'architecture.html'),
        join(process.cwd(), 'docs', 'architecture.html'),
        join(here, '..', '..', '..', 'public', 'architecture.html'),
      ];
      for (const p of candidates) {
        try {
          const html = readFileSync(p, 'utf-8');
          res.type('html').send(html);
          return;
        } catch { /* try next */ }
      }
      res.status(404).send('Architecture diagram not found');
    } catch (e) {
      res.status(500).send('Error loading architecture diagram');
    }
  });

  // ── Pitch deck ──
  app.get('/pitch-deck.html', (_req, res) => {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const candidates = [
        join(process.cwd(), 'public', 'pitch-deck.html'),
        join(here, '..', '..', '..', 'public', 'pitch-deck.html'),
      ];
      for (const p of candidates) {
        try {
          const html = readFileSync(p, 'utf-8');
          res.type('html').send(html);
          return;
        } catch { /* try next */ }
      }
      res.status(404).send('Pitch deck not found');
    } catch (e) {
      res.status(500).send('Error loading pitch deck');
    }
  });

  return app;
}

export async function startDashboard(ctx: DashboardContext, port: number) {
  const app = createDashboard(ctx);
  const server = app.listen(port, () => {
    ctx.audit.record({ kind: 'system', level: 'info', message: `PaaS server on :${port} (dashboard + x402 combined)` });
  });
  return server;
}

const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%237c3aed'/%3E%3Ctext x='16' y='23' font-size='18' text-anchor='middle'%3E%F0%9F%9B%A1%EF%B8%8F%3C/text%3E%3C/svg%3E"/>
<title>KeeperPilot — Onchain Portfolio Agent</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
  :root{
    --bg:#f5f6f9;
    --bg-grad:radial-gradient(1200px 600px at 80% -10%,#eef2ff 0%,rgba(238,242,255,0) 55%),radial-gradient(900px 500px at -10% 10%,#f0fdf4 0%,rgba(240,253,244,0) 50%),#f5f6f9;
    --card:#fff;--card-2:#fbfcfe;
    --border:#e8eaf0;--border-s:#d6dae3;
    --text:#14171f;--text-2:#565f70;--text-3:#8a93a3;
    --purple:#7c3aed;--purple-s:#f3eeff;
    --acc:#059669;--acc-s:#d1fae5;
    --warn:#d97706;--warn-s:#fef3c7;
    --err:#dc2626;--err-s:#fee2e2;
    --blue:#2563eb;--blue-s:#dbeafe;
    --shadow-sm:0 1px 2px rgba(20,24,35,.04),0 2px 6px rgba(20,24,35,.05);
    --shadow-md:0 4px 14px rgba(20,24,35,.07),0 2px 4px rgba(20,24,35,.04);
    --r:16px;--r-sm:10px;--ease:cubic-bezier(.22,.61,.36,1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;background:var(--bg-grad);background-attachment:fixed;color:var(--text);-webkit-font-smoothing:antialiased;font-size:14px;min-height:100vh}
  .mono{font-family:'JetBrains Mono',monospace}

  header{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;background:rgba(255,255,255,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:20}
  .brand{display:flex;align-items:center;gap:14px}
  .logo{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,var(--purple),#a78bfa);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 4px 12px rgba(124,58,237,.3)}
  .brand h1{font-size:19px;font-weight:800;letter-spacing:-.02em}
  .brand .sub{font-size:12px;color:var(--text-3);font-weight:500}
  .header-right{display:flex;align-items:center;gap:10px}
  .badge-live{display:flex;align-items:center;gap:7px;background:var(--acc-s);color:var(--acc);font-size:12px;font-weight:700;padding:6px 14px;border-radius:999px;border:1px solid #6ee7b7}
  .live-dot{width:8px;height:8px;border-radius:50%;background:var(--acc);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  .net-pill{background:var(--blue-s);color:var(--blue);font-size:11px;font-weight:700;padding:5px 12px;border-radius:999px}

  main{padding:24px 32px 48px;max-width:1200px;margin:0 auto}
  .section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:12px;display:flex;align-items:center;gap:8px}

  .p-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}
  .p-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:20px;box-shadow:var(--shadow-sm);transition:transform .2s var(--ease),box-shadow .2s var(--ease)}
  .p-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
  .p-card .icon{font-size:22px;margin-bottom:10px}
  .p-card .label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px}
  .p-card .value{font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;letter-spacing:-.02em}
  .p-card .sub{font-size:12px;color:var(--text-2);margin-top:3px}
  .v-purple{color:var(--purple)}.v-green{color:var(--acc)}.v-blue{color:var(--blue)}.v-orange{color:var(--warn)}

  .wallet-card{background:linear-gradient(135deg,#1e1b4b,#312e81);color:#fff;border-radius:var(--r);padding:24px;box-shadow:var(--shadow-md);margin-bottom:24px}
  .wallet-card .label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#a5b4fc;margin-bottom:6px}
  .wallet-card .addr{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;word-break:break-all}
  .wallet-card .net{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.15);padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;margin-top:10px}

  .panels{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
  .panel{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:24px;box-shadow:var(--shadow-sm)}
  .panel h3{font-size:15px;font-weight:700;margin-bottom:16px}

  .alloc-bar{display:flex;height:32px;border-radius:10px;overflow:hidden;border:1px solid var(--border);margin-bottom:8px}
  .alloc-seg{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;transition:width .5s var(--ease)}
  .alloc-seg.eth{background:linear-gradient(135deg,#6366f1,#818cf8)}
  .alloc-seg.usdc{background:linear-gradient(135deg,#059669,#34d399)}
  .alloc-target{display:flex;height:8px;border-radius:5px;overflow:hidden;margin-top:6px}
  .at-seg{transition:width .5s var(--ease)}
  .at-seg.eth{background:#c7d2fe}.at-seg.usdc{background:#a7f3d0}
  .alloc-labels{display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);margin-top:6px;font-weight:600}

  .drift-bar{height:8px;background:var(--border);border-radius:5px;overflow:hidden;margin:12px 0;position:relative}
  .drift-fill{height:100%;border-radius:5px;transition:width .5s var(--ease);background:linear-gradient(90deg,var(--acc),var(--warn),var(--err))}
  .drift-thresh{position:absolute;top:-2px;width:2px;height:12px;background:var(--err);border-radius:1px}
  .drift-val{font-size:28px;font-weight:800;font-family:'JetBrains Mono',monospace}
  .drift-val.ok{color:var(--acc)}.drift-val.warn{color:var(--warn)}.drift-val.danger{color:var(--err)}

  .t-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
  .t-row:last-child{border:none}
  .t-label{font-size:13px;font-weight:600;color:var(--text-2)}
  .t-value{font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace}

  .a-row{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}
  .a-row:last-child{border:none}
  .a-icon{font-size:16px;flex-shrink:0;margin-top:1px}
  .a-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3);margin-bottom:2px}
  .a-value{font-size:13px;color:var(--text);word-break:break-word}

  .tx-item{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--border);border-radius:var(--r-sm);transition:border-color .15s,background .15s}
  .tx-item:hover{border-color:var(--blue);background:var(--card-2)}
  .tx-icon{width:36px;height:36px;border-radius:10px;background:var(--acc-s);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
  .tx-info{flex:1;min-width:0}
  .tx-hash{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tx-msg{font-size:13px;font-weight:600}
  .tx-link{display:inline-flex;align-items:center;gap:4px;color:var(--blue);text-decoration:none;font-size:12px;font-weight:700;padding:6px 12px;border-radius:8px;background:var(--blue-s);transition:background .15s;flex-shrink:0}
  .tx-link:hover{background:#bfdbfe}

  .feed-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow-sm)}
  .feed-row{display:grid;grid-template-columns:auto 130px 1fr auto;gap:14px;padding:12px 24px;border-bottom:1px solid var(--border);align-items:center;transition:background .15s;animation:slideIn .3s var(--ease)}
  .feed-row:last-child{border:none}.feed-row:hover{background:var(--card-2)}
  @keyframes slideIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
  .fi{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
  .fi-execute{background:var(--acc-s)}.fi-decision{background:var(--purple-s)}.fi-read{background:#f0f2f5}.fi-system{background:#f0f2f5}.fi-retry{background:var(--warn-s)}
  .feed-kind{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-2);font-family:'JetBrains Mono',monospace}
  .feed-msg{font-size:12px;word-break:break-word}
  .feed-msg.err{color:var(--err)}.feed-msg.ok{color:var(--acc)}
  .feed-ts{font-size:10px;color:var(--text-3);font-family:'JetBrains Mono',monospace}
  .empty{padding:40px;text-align:center;color:var(--text-3)}

  footer{text-align:center;padding:24px;color:var(--text-3);font-size:13px;border-top:1px solid var(--border)}
  .fb-list{display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap}
  .fb{font-size:11px;font-weight:600;padding:4px 12px;border-radius:999px}
  .fb-keeper{background:var(--purple);color:#fff}.fb-sepolia{background:var(--blue);color:#fff}.fb-x402{background:var(--acc);color:#fff}

  @media(max-width:900px){.p-grid{grid-template-columns:1fr 1fr}.panels{grid-template-columns:1fr}main{padding:16px}}
</style></head>
<body>

<header>
  <div class="brand"><div class="logo">🛡️</div><div><h1>KeeperPilot</h1><div class="sub">Autonomous Onchain Rebalancing Agent</div></div></div>
  <div class="header-right">
    <a href="https://github.com/ubongn/keeperpilot" target="_blank" style="text-decoration:none;color:var(--text-2);font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--card);transition:all .2s" onmouseover="this.style.borderColor='var(--purple)';this.style.color='var(--purple)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-2)'">📦 GitHub</a>
    <a href="https://x.com/ubong_dev" target="_blank" style="text-decoration:none;color:var(--text-2);font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--card);transition:all .2s" onmouseover="this.style.borderColor='var(--blue)';this.style.color='var(--blue)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-2)'">🐦 X</a>
    <a href="/architecture.html" target="_blank" style="text-decoration:none;color:var(--text-2);font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--card);transition:all .2s" onmouseover="this.style.borderColor='var(--acc)';this.style.color='var(--acc)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-2)'">🏗️ Architecture</a>
    <span class="net-pill" id="net-pill">Sepolia</span>
    <div class="badge-live"><span class="live-dot"></span> Agent Active</div>
  </div>
</header>

<main>
  <div class="section-title">💰 Portfolio Overview</div>
  <div class="p-grid">
    <div class="p-card"><div class="icon">⚡</div><div class="label">ETH Balance</div><div class="value v-purple" id="p-eth">—</div><div class="sub" id="p-eth-usd">—</div></div>
    <div class="p-card"><div class="icon">💵</div><div class="label">USDC Balance</div><div class="value v-green" id="p-usdc">—</div><div class="sub">Stablecoin</div></div>
    <div class="p-card"><div class="icon">📊</div><div class="label">Total Value</div><div class="value v-blue" id="p-total">—</div><div class="sub" id="p-price">ETH @ $—</div></div>
    <div class="p-card"><div class="icon">🛰️</div><div class="label">ETH Price</div><div class="value v-orange" id="p-ethprice">—</div><div class="sub">Oracle / Fallback</div></div>
  </div>

  <div class="wallet-card">
    <div class="label">🔗 KeeperHub Wallet</div>
    <div class="addr mono" id="wallet-addr"><a href="https://sepolia.etherscan.io/address/" target="_blank" id="wallet-link" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--purple);transition:color .2s" onmouseover="this.style.color='var(--purple)'" onmouseout="this.style.color='inherit'">Loading…</a></div>
    <div class="net" id="wallet-net"><a href="https://sepolia.etherscan.io/" target="_blank" style="color:var(--blue);text-decoration:none;font-weight:600">Sepolia Testnet (11155111) →</a></div>
  </div>

  <div class="panels">
    <div class="panel">
      <h3>🎯 Allocation vs Target</h3>
      <div class="alloc-bar" id="alloc-bar">
        <div class="alloc-seg eth" id="alloc-eth" style="width:0%">ETH 0%</div>
        <div class="alloc-seg usdc" id="alloc-usdc" style="width:0%">USDC 0%</div>
      </div>
      <div style="font-size:11px;color:var(--text-3);font-weight:600;margin-top:8px">TARGET ALLOCATION</div>
      <div class="alloc-target" id="alloc-target">
        <div class="at-seg eth" id="target-eth" style="width:50%"></div>
        <div class="at-seg usdc" id="target-usdc" style="width:50%"></div>
      </div>
      <div class="alloc-labels"><span>ETH <span id="target-eth-label">50%</span></span><span>USDC <span id="target-usdc-label">50%</span></span></div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:13px;font-weight:600;color:var(--text-2)">Drift from Target</span>
          <span class="drift-val ok" id="drift-val">—</span>
        </div>
        <div class="drift-bar"><div class="drift-fill" id="drift-fill" style="width:0%"></div><div class="drift-thresh" id="drift-thresh" style="left:5%"></div></div>
        <div style="font-size:11px;color:var(--text-3);display:flex;justify-content:space-between"><span>0%</span><span id="drift-thresh-label">Threshold: 5%</span><span>50%</span></div>
      </div>
    </div>

    <div class="panel">
      <h3>🧠 Agent Status</h3>
      <div class="a-row"><div class="a-icon">🟢</div><div style="flex:1"><div class="a-label">Status</div><div class="a-value">Active — monitoring portfolio</div></div></div>
      <div class="a-row"><div class="a-icon">🧠</div><div style="flex:1"><div class="a-label">Last Decision</div><div class="a-value" id="agent-decision">—</div></div></div>
      <div class="a-row"><div class="a-icon">⚡</div><div style="flex:1"><div class="a-label">Last Execution</div><div class="a-value mono" id="agent-exec">—</div></div></div>
      <div class="a-row"><div class="a-icon">🕐</div><div style="flex:1"><div class="a-label">Started</div><div class="a-value mono" id="agent-started">—</div></div></div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div class="section-title" style="margin-bottom:8px">⚙️ Strategy Config</div>
        <div class="t-row"><span class="t-label">Target ETH</span><span class="t-value v-purple" id="s-eth">50%</span></div>
        <div class="t-row"><span class="t-label">Target USDC</span><span class="t-value v-green" id="s-usdc">50%</span></div>
        <div class="t-row"><span class="t-label">Drift Threshold</span><span class="t-value v-orange" id="s-threshold">5%</span></div>
      </div>
    </div>
  </div>

  <div class="section-title" style="margin-top:28px">🔗 Onchain Transactions</div>
  <div class="panel" style="margin-bottom:24px"><div id="tx-list"><div class="empty">No transactions yet</div></div></div>

  <div class="section-title">📋 Live Audit Trail</div>
  <div class="feed-card" id="feed-card"><div class="empty">Loading audit trail…</div></div>
</main>

<footer>
  <p style="margin-bottom:8px">Built for <a href="https://dorahacks.io" target="_blank" style="color:var(--purple);text-decoration:none;font-weight:600">KeeperHub Agents Onchain Hackathon</a> · DoraHacks</p>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:10px">
    <a href="https://github.com/ubongn/keeperpilot" target="_blank" style="color:var(--text-2);text-decoration:none;font-size:12px;font-weight:600">📦 GitHub</a>
    <a href="/architecture.html" target="_blank" style="color:var(--text-2);text-decoration:none;font-size:12px;font-weight:600">🏗️ Architecture</a>
    <a href="https://x.com/ubong_dev" target="_blank" style="color:var(--text-2);text-decoration:none;font-size:12px;font-weight:600">🐦 X</a>
    <a href="https://docs.keeperhub.com" target="_blank" style="color:var(--text-2);text-decoration:none;font-size:12px;font-weight:600">📚 Docs</a>
  </div>
  <div class="fb-list"><span class="fb fb-keeper">KeeperHub SDK</span><span class="fb fb-sepolia">Sepolia Testnet</span><span class="fb fb-x402">x402 Protocol</span><span class="fb fb-x402">Gas-Sponsored</span></div>
</footer>

<script>
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function shortHash(h){return h?h.slice(0,10)+'…'+h.slice(-6):'—'}
function tAgo(iso){if(!iso)return'—';return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}

async function loadPortfolio(){
  try{
    const r=await fetch('/api/portfolio');const d=await r.json();
    document.getElementById('p-eth').textContent=parseFloat(d.eth).toFixed(4)+' ETH';
    document.getElementById('p-eth-usd').textContent='$'+parseFloat(d.ethValue).toFixed(2);
    document.getElementById('p-usdc').textContent=parseFloat(d.usdc).toFixed(2)+' USDC';
    document.getElementById('p-total').textContent='$'+parseFloat(d.total).toFixed(2);
    document.getElementById('p-price').textContent='ETH @ $'+d.ethPrice;
    document.getElementById('p-ethprice').textContent='$'+d.ethPrice;
    // Make wallet address clickable (Etherscan link)
    const walletLink=document.getElementById('wallet-link');
    if(walletLink){walletLink.textContent=d.wallet;walletLink.href='https://sepolia.etherscan.io/address/'+d.wallet;}
    document.getElementById('wallet-net').innerHTML='<a href="https://sepolia.etherscan.io/" target="_blank" style="color:var(--blue);text-decoration:none;font-weight:600">Sepolia Testnet ('+d.network+') →</a>';
    const eP=parseFloat(d.allocation.eth),uP=parseFloat(d.allocation.usdc);
    document.getElementById('alloc-eth').style.width=Math.max(eP,eP>0?8:0)+'%';
    document.getElementById('alloc-usdc').style.width=Math.max(uP,uP>0?8:0)+'%';
    document.getElementById('alloc-eth').textContent='ETH '+eP.toFixed(1)+'%';
    document.getElementById('alloc-usdc').textContent='USDC '+uP.toFixed(1)+'%';
    document.getElementById('target-eth').style.width=d.targets.eth+'%';
    document.getElementById('target-usdc').style.width=d.targets.usdc+'%';
    document.getElementById('target-eth-label').textContent=d.targets.eth+'%';
    document.getElementById('target-usdc-label').textContent=d.targets.usdc+'%';
    const dr=parseFloat(d.drift),th=parseFloat(d.driftThreshold);
    const dv=document.getElementById('drift-val');
    dv.textContent=dr.toFixed(1)+'%';
    dv.className='drift-val '+(dr>th?'danger':dr>th/2?'warn':'ok');
    document.getElementById('drift-fill').style.width=Math.min(dr*2,100)+'%';
    document.getElementById('drift-thresh').style.left=(th*2)+'%';
    document.getElementById('drift-thresh-label').textContent='Threshold: '+th+'%';
    document.getElementById('s-eth').textContent=d.targets.eth+'%';
    document.getElementById('s-usdc').textContent=d.targets.usdc+'%';
    document.getElementById('s-threshold').textContent=th+'%';
  }catch(e){console.error('portfolio',e)}
}

async function loadAgent(){
  try{
    const r=await fetch('/api/agent');const d=await r.json();
    document.getElementById('agent-decision').textContent=d.lastDecision||'Waiting for first tick…';
    document.getElementById('agent-exec').textContent=d.lastExecution||'No executions yet';
    document.getElementById('agent-started').textContent=d.startedAt?new Date(d.startedAt).toLocaleString():'—';
  }catch(e){console.error('agent',e)}
}

async function loadTx(){
  try{
    const r=await fetch('/api/transactions');const d=await r.json();
    const list=document.getElementById('tx-list');
    if(!d.transactions||d.transactions.length===0){list.innerHTML='<div class="empty">No onchain transactions yet</div>';return}
    list.innerHTML=d.transactions.map(t=>{
      const gas=t.gasUsedWei?(parseInt(t.gasUsedWei)/1e9).toFixed(2)+' gwei':'';
      return '<div class="tx-item">'+
        '<div class="tx-icon">'+(t.status==='failed'?'❌':'✅')+'</div>'+
        '<div class="tx-info"><div class="tx-msg">'+esc(t.message)+'</div>'+
        '<div class="tx-hash mono">'+esc(shortHash(t.hash))+(gas?' · '+gas:'')+' · '+tAgo(t.ts)+'</div></div>'+
        '<a class="tx-link" target="_blank" href="'+esc(t.link)+'">View ↗</a></div>';
    }).join('');
  }catch(e){console.error('tx',e)}
}

const kIcons={execute:'⚡',execute_status:'✅',decision:'🧠',read:'👁️',system:'⚙️',retry:'🔄',x402_payment:'💰'};
let feedN=0;
function addFeed(e){
  const card=document.getElementById('feed-card');
  if(feedN===0)card.innerHTML='';
  feedN++;
  const icon=kIcons[e.kind]||'•';
  const row=document.createElement('div');row.className='feed-row';
  const isErr=e.level==='error'||(e.data&&e.data.status==='failed');
  const isOk=e.data&&e.data.status==='success';
  let txL='';
  if(e.transactionLink)txL=' <a href="'+esc(e.transactionLink)+'" target="_blank" style="color:var(--blue);font-weight:600">tx↗</a>';
  row.innerHTML='<div class="fi fi-'+e.kind+'">'+icon+'</div>'+
    '<div class="feed-kind">'+e.kind.replace(/_/g,' ')+'</div>'+
    '<div class="feed-msg '+(isErr?'err':isOk?'ok':'')+'">'+esc(e.message)+txL+'</div>'+
    '<div class="feed-ts">'+tAgo(e.ts)+'</div>';
  card.prepend(row);
  while(card.children.length>100)card.removeChild(card.lastChild);
  if(e.kind==='read'||e.kind==='execute'||e.kind==='decision'||e.kind==='execute_status'){loadPortfolio();loadAgent();loadTx();}
}

async function init(){
  loadPortfolio();loadAgent();loadTx();
  try{const r=await fetch('/api/audit');const a=await r.json();a.forEach(addFeed);}catch(e){}
  const es=new EventSource('/api/audit/stream');
  es.onmessage=ev=>{try{addFeed(JSON.parse(ev.data))}catch(e){}};
}
init();
</script>
</body></html>`;
