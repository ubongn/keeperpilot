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
<title>KeeperPilot — Audit Trail</title>
<style>
  :root{--bg:#0b0e14;--panel:#121722;--ink:#e6e9ef;--mut:#8b95a7;--acc:#6ee7b7;--warn:#fbbf24;--err:#f87171;--line:#1f2735}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px}
  h1{font-size:16px;margin:0;font-weight:600}
  .badge{font-size:11px;background:#16331f;color:var(--acc);padding:3px 8px;border-radius:999px;border:1px solid #1f4a30}
  .stat{color:var(--mut);font-size:12px}
  main{padding:18px 22px}
  .row{display:grid;grid-template-columns:150px 110px 1fr 120px;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);align-items:center}
  .row:hover{background:var(--panel)}
  .kind{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
  .ts{color:var(--mut);font-size:11px}
  .msg{word-break:break-word}
  .lvl-i{color:var(--ink)} .lvl-w{color:var(--warn)} .lvl-e{color:var(--err)}
  a.tx{color:var(--acc);text-decoration:none} a.tx:hover{text-decoration:underline}
  .pill{font-size:11px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:var(--mut)}
  .empty{color:var(--mut);padding:40px 0;text-align:center}
</style></head>
<body>
<header>
  <h1>KeeperPilot — Live Audit Trail</h1>
  <span class="badge">executed via KeeperHub</span>
  <span class="stat" id="count">0 events</span>
</header>
<main><div id="feed"><div class="empty">waiting for agent activity…</div></div></main>
<script>
  const feed=document.getElementById('feed');const countEl=document.getElementById('count');let n=0;
  const kindColor={execute:'var(--acc)',execute_status:'var(--acc)',x402_payment:'#93c5fd',decision:'var(--mut)',read:'var(--mut)',retry:'var(--warn)',system:'var(--mut)'};
  function add(e){
    if(n===0)feed.innerHTML='';
    n++;countEl.textContent=n+' events';
    const row=document.createElement('div');row.className='row';
    const ts=new Date(e.ts).toLocaleTimeString();
    const lvl='lvl-'+String(e.level||'i').charAt(0);
    const tx=e.transactionLink?' · <a class="tx" target="_blank" href="'+e.transactionLink+'">view tx ↗</a>':'';
    row.innerHTML='<div class="ts">'+ts+'</div>'+
      '<div class="kind" style="color:'+(kindColor[e.kind]||'var(--mut)')+'">'+e.kind+'</div>'+
      '<div class="msg '+lvl+'">'+escapeHtml(e.message)+tx+'</div>'+
      '<div>'+(e.network?'<span class="pill">'+e.network+'</span>':'')+'</div>';
    feed.prepend(row);
  }
  function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  // seed recent
  fetch('/api/audit').then(r=>r.json()).then(arr=>arr.forEach(add)).catch(()=>{});
  // live
  const es=new EventSource('/api/audit/stream');
  es.onmessage=ev=>{try{add(JSON.parse(ev.data))}catch(e){}};
</script>
</body></html>`;
