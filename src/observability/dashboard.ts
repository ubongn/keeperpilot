// src/observability/dashboard.ts — live audit-trail dashboard (judging criterion #2/3).
//
// Serves a single-page UI showing every agent action: reads, decisions, real tx hashes +
// explorer links, retries, gas (sponsored), and x402 payments. Backed by the AuditLog,
// with an SSE stream for live updates.

import express from 'express';
import type { AuditLog } from './audit.js';

export function createDashboard(audit: AuditLog) {
  const app = express();

  // recent entries (JSON)
  app.get('/api/audit', (_req, res) => {
    res.json(audit.list(200));
  });

  // Server-Sent Events: push new entries as they happen
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

  // the single-page dashboard
  app.get('/', (_req, res) => {
    res.type('html').send(DASHBOARD_HTML);
  });

  return app;
}

export async function startDashboard(audit: AuditLog, port: number) {
  const app = createDashboard(audit);
  const server = app.listen(port, () => {
    audit.record({ kind: 'system', level: 'info', message: `dashboard on http://localhost:${port}` });
  });
  return server;
}

const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>KeeperPilot — Onchain Agent Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  :root{
    --bg:#f5f6f9;
    --bg-grad:radial-gradient(1200px 600px at 80% -10%,#eef2ff 0%,rgba(238,242,255,0) 55%),radial-gradient(900px 500px at -10% 10%,#f0fdf4 0%,rgba(240,253,244,0) 50%),#f5f6f9;
    --card:#ffffff;
    --card-2:#fbfcfe;
    --border:#e8eaf0;
    --border-strong:#d6dae3;
    --text:#14171f;
    --text-2:#565f70;
    --text-3:#8a93a3;
    --lantern:#7c3aed;
    --lantern-soft:#f3eeff;
    --acc:#059669;
    --acc-soft:#d1fae5;
    --warn:#d97706;
    --warn-soft:#fef3c7;
    --err:#dc2626;
    --err-soft:#fee2e2;
    --blue:#2563eb;
    --blue-soft:#dbeafe;
    --shadow-sm:0 1px 2px rgba(20,24,35,.04),0 2px 6px rgba(20,24,35,.05);
    --shadow-md:0 4px 14px rgba(20,24,35,.07),0 2px 4px rgba(20,24,35,.04);
    --radius:16px;
    --radius-sm:10px;
    --ease:cubic-bezier(.22,.61,.36,1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
    background:var(--bg-grad);background-attachment:fixed;
    color:var(--text);-webkit-font-smoothing:antialiased;
    font-size:14px;line-height:1.5;min-height:100vh;
  }

  /* ── Header ── */
  header{
    display:flex;align-items:center;justify-content:space-between;
    padding:16px 32px;
    background:rgba(255,255,255,.82);
    backdrop-filter:saturate(180%) blur(16px);
    -webkit-backdrop-filter:saturate(180%) blur(16px);
    border-bottom:1px solid var(--border);
    position:sticky;top:0;z-index:20;
  }
  .brand{display:flex;align-items:center;gap:14px}
  .logo{
    width:40px;height:40px;border-radius:12px;
    background:linear-gradient(135deg,var(--lantern),#a78bfa);
    display:flex;align-items:center;justify-content:center;
    font-size:22px;box-shadow:0 4px 12px rgba(124,58,237,.3);
  }
  .brand h1{font-size:19px;font-weight:800;letter-spacing:-.02em}
  .brand .sub{font-size:12px;color:var(--text-3);font-weight:500}
  .header-right{display:flex;align-items:center;gap:12px}
  .status-badge{
    display:flex;align-items:center;gap:7px;
    background:var(--acc-soft);color:var(--acc);
    font-size:12px;font-weight:700;
    padding:5px 14px;border-radius:999px;
    border:1px solid #6ee7b7;
  }
  .live-dot{
    width:8px;height:8px;border-radius:50%;background:var(--acc);
    animation:pulse 2s infinite;
  }
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}

  /* ── Stats Bar ── */
  .stats-bar{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
    gap:14px;padding:24px 32px;
  }
  .stat-card{
    background:var(--card);border:1px solid var(--border);
    border-radius:var(--radius);padding:18px 20px;
    box-shadow:var(--shadow-sm);
    transition:transform .2s var(--ease),box-shadow .2s var(--ease);
  }
  .stat-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
  .stat-icon{font-size:20px;margin-bottom:8px}
  .stat-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px}
  .stat-value{font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;letter-spacing:-.02em}
  .stat-value.green{color:var(--acc)}
  .stat-value.purple{color:var(--lantern)}
  .stat-value.blue{color:var(--blue)}
  .stat-value.orange{color:var(--warn)}

  /* ── Feed Container ── */
  main{padding:0 32px 40px}
  .feed-header{
    display:flex;align-items:center;justify-content:space-between;
    margin-bottom:16px;
  }
  .feed-header h2{font-size:16px;font-weight:700}
  .feed-count{font-size:13px;color:var(--text-3);font-weight:500}

  .feed-card{
    background:var(--card);border:1px solid var(--border);
    border-radius:var(--radius);overflow:hidden;
    box-shadow:var(--shadow-sm);
  }

  /* ── Event Rows ── */
  .row{
    display:grid;grid-template-columns:auto 130px 1fr auto;
    gap:16px;padding:14px 24px;
    border-bottom:1px solid var(--border);
    align-items:center;transition:background .15s var(--ease);
    animation:slideIn .3s var(--ease);
  }
  .row:last-child{border-bottom:none}
  .row:hover{background:var(--card-2)}
  @keyframes slideIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}

  .row-icon{
    width:36px;height:36px;border-radius:10px;
    display:flex;align-items:center;justify-content:center;
    font-size:16px;flex-shrink:0;
  }
  .icon-execute{background:var(--acc-soft)}
  .icon-execute_status{background:var(--acc-soft)}
  .icon-decision{background:var(--lantern-soft)}
  .icon-read{background:#f0f2f5}
  .icon-system{background:#f0f2f5}
  .icon-retry{background:var(--warn-soft)}
  .icon-x402_payment{background:var(--blue-soft)}

  .kind{
    font-size:11px;font-weight:700;text-transform:uppercase;
    letter-spacing:.05em;color:var(--text-2);
    font-family:'JetBrains Mono',monospace;
  }
  .msg{font-size:13px;color:var(--text);word-break:break-word;line-height:1.5}
  .msg.error{color:var(--err)}
  .msg.success{color:var(--acc)}

  .row-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
  .ts{font-size:11px;color:var(--text-3);font-family:'JetBrains Mono',monospace}
  .pill{
    font-size:10px;font-weight:600;
    border:1px solid var(--border-strong);border-radius:6px;
    padding:2px 8px;color:var(--text-2);
    font-family:'JetBrains Mono',monospace;
  }
  .pill.error{background:var(--err-soft);color:var(--err);border-color:#fca5a5}
  .pill.success{background:var(--acc-soft);color:var(--acc);border-color:#6ee7b7}

  a.tx{
    display:inline-flex;align-items:center;gap:4px;
    color:var(--blue);text-decoration:none;font-weight:600;
    font-size:12px;margin-top:3px;
    padding:2px 8px;border-radius:6px;background:var(--blue-soft);
    transition:background .15s var(--ease);
  }
  a.tx:hover{background:#bfdbfe;text-decoration:none}

  .empty{
    padding:60px 32px;text-align:center;color:var(--text-3);
  }
  .empty-icon{font-size:48px;margin-bottom:12px}
  .empty p{font-size:15px;font-weight:500}

  /* ── Footer ── */
  footer{
    text-align:center;padding:24px;
    color:var(--text-3);font-size:13px;
    border-top:1px solid var(--border);margin-top:auto;
  }
  .footer-badges{display:flex;gap:8px;justify-content:center;margin-top:10px}
  .footer-badge{
    font-size:11px;font-weight:600;
    padding:4px 12px;border-radius:999px;
  }
  .fb-keeper{background:var(--lantern);color:white}
  .fb-sepolia{background:var(--blue);color:white}
  .fb-x402{background:var(--acc);color:white}

  @media(max-width:700px){
    header{padding:14px 18px}
    .stats-bar{padding:16px;grid-template-columns:1fr 1fr}
    main{padding:0 16px 24px}
    .row{grid-template-columns:auto 1fr;padding:12px 16px;gap:10px}
    .kind{display:none}
    .row-meta{display:none}
  }
</style></head>
<body>

<header>
  <div class="brand">
    <div class="logo">🛡️</div>
    <div>
      <h1>KeeperPilot</h1>
      <div class="sub">Autonomous Onchain Agent · Powered by KeeperHub</div>
    </div>
  </div>
  <div class="header-right">
    <div class="status-badge">
      <span class="live-dot"></span>
      <span id="net-label">Sepolia · Live</span>
    </div>
  </div>
</header>

<div class="stats-bar">
  <div class="stat-card">
    <div class="stat-icon">⚡</div>
    <div class="stat-label">Total Events</div>
    <div class="stat-value purple" id="stat-events">0</div>
  </div>
  <div class="stat-card">
    <div class="stat-icon">🔥</div>
    <div class="stat-label">Executions</div>
    <div class="stat-value green" id="stat-exec">0</div>
  </div>
  <div class="stat-card">
    <div class="stat-icon">🧠</div>
    <div class="stat-label">Decisions</div>
    <div class="stat-value blue" id="stat-decisions">0</div>
  </div>
  <div class="stat-card">
    <div class="stat-icon">🔗</div>
    <div class="stat-label">Transactions</div>
    <div class="stat-value orange" id="stat-txs">0</div>
  </div>
</div>

<main>
  <div class="feed-header">
    <h2>📋 Live Audit Trail</h2>
    <span class="feed-count" id="feed-count">Real-time agent activity</span>
  </div>
  <div class="feed-card">
    <div id="feed">
      <div class="empty">
        <div class="empty-icon">⏳</div>
        <p>Waiting for agent activity…</p>
      </div>
    </div>
  </div>
</main>

<footer>
  <p>Built for KeeperHub Agents Onchain Hackathon · DoraHacks</p>
  <div class="footer-badges">
    <span class="footer-badge fb-keeper">KeeperHub SDK</span>
    <span class="footer-badge fb-sepolia">Sepolia Testnet</span>
    <span class="footer-badge fb-x402">x402 Protocol</span>
  </div>
</footer>

<script>
  const feed=document.getElementById('feed');
  const countEl=document.getElementById('feed-count');
  const statEvents=document.getElementById('stat-events');
  const statExec=document.getElementById('stat-exec');
  const statDecisions=document.getElementById('stat-decisions');
  const statTxs=document.getElementById('stat-txs');

  let n=0,execCount=0,decisionCount=0,txCount=0;

  const kindIcons={
    execute:'⚡',execute_status:'✅',decision:'🧠',read:'👁️',
    system:'⚙️',retry:'🔄',x402_payment:'💰'
  };

  function add(e){
    if(n===0)feed.innerHTML='';
    n++;
    countEl.textContent=n+' events logged';
    statEvents.textContent=n;

    const icon=kindIcons[e.kind]||'•';
    const row=document.createElement('div');row.className='row';
    const ts=new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});

    // track stats
    if(e.kind==='execute'||e.kind==='execute_status'){execCount++;statExec.textContent=execCount}
    if(e.kind==='decision'){decisionCount++;statDecisions.textContent=decisionCount}
    if(e.transactionHash){txCount++;statTxs.textContent=txCount}

    const isError=e.level==='error'||(e.data&&e.data.status==='failed');
    const isSuccess=e.data&&e.data.status==='success';

    const iconClass='icon-'+e.kind;
    const msgClass=isError?'error':isSuccess?'success':'';
    const pillClass=isError?'error':isSuccess?'success':'';

    let meta='<div class="row-meta"><div class="ts">'+ts+'</div>';
    if(e.network)meta+='<span class="pill '+pillClass+'">'+e.network+'</span>';
    meta+='</div>';

    let tx='';
    if(e.transactionLink){
      tx=' <a class="tx" target="_blank" href="'+e.transactionLink+'">view tx ↗</a>';
    }

    row.innerHTML=
      '<div class="row-icon '+iconClass+'">'+icon+'</div>'+
      '<div class="kind">'+e.kind.replace(/_/g,' ')+'</div>'+
      '<div class="msg '+msgClass+'">'+escapeHtml(e.message)+tx+'</div>'+
      meta;
    feed.prepend(row);

    // keep max 200 rows
    while(feed.children.length>200)feed.removeChild(feed.lastChild);
  }
  function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  // seed recent
  fetch('/api/audit').then(r=>r.json()).then(arr=>arr.forEach(add)).catch(()=>{});
  // live
  const es=new EventSource('/api/audit/stream');
  es.onmessage=ev=>{try{add(JSON.parse(ev.data))}catch(e){}};
</script>
</body></html>`;
