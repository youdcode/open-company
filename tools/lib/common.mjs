// Shared helpers for every tool and for the viewer. Zero dependencies, Node >= 20.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WS = process.env.OPEN_COMPANY_WORKSPACE ? path.resolve(process.env.OPEN_COMPANY_WORKSPACE) : path.join(ROOT, 'workspace');
export const TEMPLATES = path.join(ROOT, 'templates', 'workspace');

export const P = {
  company: path.join(WS, 'company', 'profile.md'),
  icp: path.join(WS, 'prospecting', 'icp.md'),
  leads: path.join(WS, 'prospecting', 'leads.csv'),
  accounts: path.join(WS, 'prospecting', 'accounts'),
  drafts: path.join(WS, 'prospecting', 'drafts'),
  exports: path.join(WS, 'prospecting', 'exports'),
  board: path.join(WS, 'org', 'board.md'),
  journal: path.join(WS, 'org', 'journal.md'),
  messages: path.join(WS, 'org', 'messages'),
  events: path.join(WS, 'org', 'events.jsonl'),
  session: path.join(WS, '.session.json'),
};

export const LEAD_COLUMNS = [
  'id', 'company', 'website', 'country', 'city', 'industry', 'employees', 'registry_id',
  'contact_name', 'contact_role', 'contact_channel', 'contact_source',
  'signals', 'sources', 'score', 'tier', 'score_why',
  'status', 'owner', 'next_action', 'next_action_date', 'updated',
];

export const LEAD_STATUSES = [
  'new', 'researched', 'qualified', 'drafted', 'approved', 'contacted',
  'replied', 'meeting', 'won', 'lost', 'do_not_contact',
];

export const today = () => new Date().toISOString().slice(0, 10);
export const now = () => new Date().toISOString();

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  // Windows can refuse a rename for a moment while another process reads the file: retry briefly.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      sleepSync(20);
    }
  }
}

// Several agents can run at the same time. Every read-modify-write of a shared file goes
// through this lock, so two agents adding leads at once never lose a row.
export function withLock(file, fn, { timeout = 15000, stale = 30000 } = {}) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > stale) { fs.unlinkSync(lock); continue; } } catch {}
      if (Date.now() - start > timeout) throw new Error(`${path.basename(file)} is busy (delete ${lock} if no agent is running)`);
      sleepSync(15 + Math.random() * 35);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch {} }
}

// ---------- CSV (RFC 4180) ----------
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows.shift();
  return rows.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ''])));
}

const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(objects, columns) {
  return [columns.join(','), ...objects.map(o => columns.map(c => esc(o[c])).join(','))].join('\n') + '\n';
}

export const readLeads = () => parseCSV(readText(P.leads));
export const writeLeads = leads => writeText(P.leads, toCSV(leads, LEAD_COLUMNS));

// ---------- Front matter (flat "key: value" subset) ----------
export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (k) data[k[1]] = k[2].replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(m[0].length) };
}

export function stringifyFrontMatter(data, body) {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${String(v ?? '').replace(/\n/g, ' ')}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

// ---------- Events (the live feed) ----------
export function logEvent(role, type, text, file = '') {
  const rel = file ? path.relative(ROOT, path.resolve(file)).split(path.sep).join('/') : '';
  const line = JSON.stringify({ ts: now(), role: role || 'director', type, text, path: rel });
  fs.mkdirSync(path.dirname(P.events), { recursive: true });
  fs.appendFileSync(P.events, line + '\n');
}

// ---------- Tiny argv parser: --key value, --flag, positionals ----------
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) out[k] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

// Optional secrets (API keys for data sources) live in workspace/.env, which is never committed.
export function loadEnv() {
  for (const line of readText(path.join(WS, '.env')).split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Every tool answers --help (or -h) with its usage, the comment at the top of its file, and exits
// before doing anything. Weaker models call --help first: it must never have side effects.
export function helpIfAsked(url) {
  const argv = process.argv.slice(2);
  if (!url || (!argv.includes('--help') && !argv.includes('-h'))) return;
  const lines = [];
  for (const l of fs.readFileSync(fileURLToPath(url), 'utf8').split('\n')) {
    if (l.startsWith('#!')) continue;
    if (!l.startsWith('//')) break;
    lines.push(l.replace(/^\/\/ ?/, ''));
  }
  console.log(lines.join('\n').trim());
  process.exit(0);
}

export const isMain = url => !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function requireWorkspace() {
  if (!fs.existsSync(WS)) fail('workspace/ does not exist yet. Run: node tools/init.mjs');
}
