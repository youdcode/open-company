#!/usr/bin/env node
// The live office: a local web page that shows the company working.
// It only READS workspace/ (plus one write: approving/rejecting a draft when you click).
// It never calls an AI, so it costs zero tokens. Binds to 127.0.0.1 only.
//
// Usage: node viewer/server.mjs [--port 4747]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, WS, P, readText, readLeads, parseFrontMatter, logEvent, args, isMain,
} from '../tools/lib/common.mjs';
import { parseBoard } from '../tools/board.mjs';
import { listDrafts, setDraftStatus } from '../tools/drafts.mjs';
import { listDocs, setDocStatus, htmlOf, billing } from '../tools/invoice.mjs';
import { chatInfo, sendChat, checkChat, setEngine, setReadDirs, newConversation, stopChat, onChat, currentJob, setModel } from './chat.mjs';
import { listArtifacts } from '../tools/artifact.mjs';

export const DEFAULT_PORT = Number(process.env.OPEN_COMPANY_PORT) || 4747;
const HTML = path.join(ROOT, 'viewer', 'index.html');
export const VERSION = (() => { try { return JSON.parse(readText(path.join(ROOT, 'package.json'))).version; } catch { return ''; } })();
const IGNORE = /(\.tmp-\d+$|\.lock$|\.meta\.json$|\.DS_Store$|events\.jsonl$|\.session\.json$|\.chat\.json$|chat\.jsonl$)/;

// Which role "owns" a file when it has no `author:` front matter.
const OWNER = [
  [/prospecting\/accounts\//, 'researcher'], [/prospecting\/drafts\//, 'sales'], [/prospecting\/icp\.md$/, 'strategist'],
  [/departments\/strategy\//, 'strategist'], [/departments\/marketing\//, 'marketer'], [/departments\/sales\//, 'sales'],
  [/departments\/finance\//, 'finance'], [/departments\/tech\//, 'tech'], [/departments\/consulting\//, 'consultant'],
  [/departments\/audit\//, 'auditor'], [/company\//, 'director'], [/org\/journal\.md$/, 'director'],
];

// ---------- snapshot ----------
function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (!IGNORE.test(p)) out.push(p);
  }
  return out;
}

const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
// True when p is inside workspace/<parts...>/ (compared relative to the workspace, not the full path).
const inWs = (p, ...parts) => path.relative(WS, p).startsWith(path.join(...parts) + path.sep);

function readRoles() {
  const dir = path.join(ROOT, 'roles');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch {}
  return files.map(f => {
    const { data } = parseFrontMatter(readText(path.join(dir, f)));
    return { id: data.name || f.slice(0, -3), title: data.title || data.name, department: data.department || '', reports_to: data.reports_to || 'director', order: Number(data.order) || 99 };
  }).sort((a, b) => a.order - b.order);
}

function readEvents(limit = 300) {
  const lines = readText(P.events).split('\n').filter(Boolean);
  return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function readMessages(limit = 60) {
  let files = [];
  try { files = fs.readdirSync(P.messages).filter(f => f.endsWith('.md')).sort().slice(-limit); } catch {}
  return files.map(f => {
    const { data, body } = parseFrontMatter(readText(path.join(P.messages, f)));
    return { file: rel(path.join(P.messages, f)), ...data, body: body.trim() };
  }).reverse();
}

function listFiles() {
  return walk(WS)
    .filter(p => /\.(md|csv|json|txt)$/.test(p) && !inWs(p, 'org', 'messages') && !inWs(p, 'tmp'))
    .map(p => {
      const st = fs.statSync(p);
      const author = p.endsWith('.md') ? parseFrontMatter(readText(p)).data.author || '' : '';
      return { path: rel(p), mtime: st.mtimeMs, size: st.size, author };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function snapshot() {
  const exists = fs.existsSync(WS);
  const company = parseFrontMatter(readText(P.company)).data;
  let session = {};
  try { session = JSON.parse(readText(P.session, '{}')); } catch {}
  return {
    now: Date.now(),
    initialized: exists,
    company,
    session,
    roles: readRoles(),
    events: readEvents(),
    board: exists ? parseBoard() : { Todo: [], Doing: [], Review: [], Done: [] },
    leads: exists ? readLeads() : [],
    drafts: exists ? listDrafts() : [],
    messages: readMessages(),
    files: exists ? listFiles() : [],
    finance: exists ? listDocs().map(d => ({ id: d.id, type: d.type, number: d.number, status: d.status, client: d.client?.name, totals: d.totals, currency: d.currency, created: d.created, issue_date: d.issue_date, due_date: d.due_date, author: d.author })) : [],
    billingReady: exists && !!(billing().legal_name && billing().address),
    artifacts: exists ? listArtifacts() : [],
  };
}

// ---------- change detection (polling: portable and cheap for a few hundred files) ----------
let stamps = new Map();
function scan() {
  const next = new Map();
  for (const p of walk(WS)) {
    try { const s = fs.statSync(p); next.set(p, `${s.mtimeMs}:${s.size}`); } catch {}
  }
  const changed = [];
  for (const [p, v] of next) if (stamps.get(p) !== v) changed.push(p);
  for (const p of stamps.keys()) if (!next.has(p)) changed.push(p);
  const first = stamps.size === 0;
  stamps = next;
  return first ? [] : changed;
}

let eventsSize = 0;
try { eventsSize = fs.statSync(P.events).size; } catch {}
function eventsGrew() {
  let size = 0;
  try { size = fs.statSync(P.events).size; } catch {}
  const grew = size !== eventsSize;
  eventsSize = size;
  return grew;
}

// Files edited directly by an AI (without a tool) still show up in the feed.
function synthesize(changed) {
  const recent = readEvents(40);
  const since = Date.now() - 5000;
  for (const p of changed) {
    if (!p.startsWith(WS) || /leads\.csv$|board\.md$|\.engine$/.test(p) || inWs(p, 'tmp') || !fs.existsSync(p)) continue;
    const r = rel(p);
    if (recent.some(e => e.path === r && Date.parse(e.ts) > since)) continue;
    let role = p.endsWith('.md') ? parseFrontMatter(readText(p)).data.author : '';
    if (!role) role = (OWNER.find(([re]) => re.test(r)) || [])[1] || 'director';
    logEvent(role, 'file', `Updated ${r.replace(/^workspace\//, '')}`, p);
  }
}

// ---------- http ----------
const clients = new Set();
function broadcast(payload) {
  const data = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function localOnly(req, port) {
  const host = String(req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

export function startServer(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    if (!localOnly(req, port)) return json(res, 403, { error: 'local access only' });
    const url = new URL(req.url, `http://localhost:${port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(readText(HTML));
      }
      if (url.pathname === '/api/ping') return json(res, 200, { ok: true, app: 'open-company', root: ROOT, version: VERSION });
      if (url.pathname === '/api/state') return json(res, 200, snapshot());
      if (url.pathname === '/api/file') {
        const p = path.resolve(ROOT, url.searchParams.get('path') || '');
        if (!p.startsWith(WS + path.sep) || !/\.(md|csv|json|txt)$/.test(p) || !fs.existsSync(p)) return json(res, 404, { error: 'not found' });
        return json(res, 200, { path: rel(p), content: readText(p) });
      }
      if (url.pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/api/chat/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`retry: 2000\nevent: job\ndata: ${JSON.stringify({ job: currentJob() })}\n\n`);
        const off = onChat(ev => res.write(`event: chat\ndata: ${JSON.stringify(ev)}\n\n`));
        const beat = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { off(); clearInterval(beat); });
        return;
      }
      if (url.pathname === '/api/artifacts') return json(res, 200, listArtifacts());
      const art = /^\/artifacts\/([a-z0-9-]+\.(html|md|csv|json|svg|txt))$/.exec(url.pathname);
      if (art && req.method === 'GET') {
        const f = path.join(P.artifacts, art[1]);
        if (!fs.existsSync(f)) return json(res, 404, { error: 'not found' });
        const types = { html: 'text/html', md: 'text/markdown', csv: 'text/csv', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain' };
        res.writeHead(200, {
          'content-type': `${types[art[2]]}; charset=utf-8`, 'cache-control': 'no-store',
          // An artifact runs in its own sandbox: it cannot read your data or talk to the team.
          'content-security-policy': "sandbox allow-scripts allow-downloads allow-popups allow-forms allow-modals; connect-src 'none'; frame-ancestors 'self'",
          'x-content-type-options': 'nosniff',
          ...(url.searchParams.get('download') ? { 'content-disposition': `attachment; filename="${art[1]}"` } : {}),
        });
        return res.end(fs.readFileSync(f));
      }
      if (url.pathname.startsWith('/api/chat')) {
        let session = {};
        try { session = JSON.parse(readText(P.session, '{}')); } catch {}
        if (url.pathname === '/api/chat' && req.method === 'GET') return json(res, 200, { ...chatInfo(), demo: !!session.demo });
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'json only' });
        if (session.demo) return json(res, 403, { error: 'The chat is off in demo mode: nothing here is real. Launch your own company with ./start.' });
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || '{}');
        try {
          if (url.pathname === '/api/chat/engine') { setEngine(data.engine); return json(res, 200, { ok: true }); }
          if (url.pathname === '/api/chat/dirs') { try { return json(res, 200, { dirs: setReadDirs(data.dirs) }); } catch (e) { return json(res, 400, { error: e.message }); } }
          if (url.pathname === '/api/chat/model') { try { return json(res, 200, setModel(chatInfo().engine, data.model, data.effort)); } catch (e) { return json(res, 400, { error: e.message }); } }
          if (url.pathname === '/api/chat/new') { newConversation(); return json(res, 200, { ok: true }); }
          if (url.pathname === '/api/chat/stop') return json(res, 200, { stopped: stopChat() });
          if (url.pathname === '/api/chat') {
            const id = sendChat(data.message, { to: data.to || 'auto', lang: data.lang === 'fr' ? 'fr' : 'en' });
            return json(res, 200, { ok: true, job: id });
          }
        } catch (e) {
          if (res.headersSent) { res.write(JSON.stringify({ type: 'error', text: e.message }) + '\n'); res.end(JSON.stringify({ type: 'done' }) + '\n'); return; }
          return json(res, 409, { error: e.message });
        }
        return json(res, 404, { error: 'not found' });
      }
      const doc = /^\/finance\/([qi]-[a-z0-9-]+)\.html$/.exec(url.pathname);
      if (doc && req.method === 'GET') {
        const f = htmlOf(doc[1]);
        if (!fs.existsSync(f)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(readText(f));
      }
      const fin = /^\/api\/finance\/([qi]-[a-z0-9-]+)\/status$/.exec(url.pathname);
      if (fin && req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'json only' });
        let body = '';
        for await (const chunk of req) body += chunk;
        try { setDocStatus(fin[1], JSON.parse(body || '{}').status, 'you'); } catch (e) { return json(res, 400, { error: e.message }); }
        return json(res, 200, { ok: true });
      }
      const m = /^\/api\/drafts\/([a-z0-9-]+)\/status$/.exec(url.pathname);
      if (m && req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'json only' });
        let body = '';
        for await (const chunk of req) body += chunk;
        const { status } = JSON.parse(body || '{}');
        if (!['approved', 'rejected', 'draft'].includes(status)) return json(res, 400, { error: 'bad status' });
        setDraftStatus(m[1], status, 'you');
        return json(res, 200, { ok: true });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  scan();
  const tick = setInterval(() => {
    const changed = scan();
    if (changed.length) synthesize(changed);
    const grew = eventsGrew();
    if (changed.length || grew) broadcast({ changed: changed.map(rel) });
  }, 1000);
  const beat = setInterval(() => { for (const r of clients) r.write(': ping\n\n'); }, 15000);
  server.on('close', () => { clearInterval(tick); clearInterval(beat); });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (isMain(import.meta.url)) {
  const a = args();
  const port = Number(a.port) || DEFAULT_PORT;
  startServer(port)
    .then(() => console.log(`Live office: http://localhost:${port}`))
    .catch(e => { console.error(e.code === 'EADDRINUSE' ? `port ${port} is busy (already running?)` : e.message); process.exit(1); });
}
