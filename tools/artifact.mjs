#!/usr/bin/env node
// Artifacts: files made for the owner (interactive pages, tables, one-pagers) that open in the
// Artifacts tab of the live office and appear as cards in the chat.
//
// Usage:
//   node tools/artifact.mjs prospects --title "Prospecting file" [--tier hot,warm] [--status qualified,drafted] [--lang fr] [--as sales]
//        builds an interactive prospecting page from the real data (leads, account files, drafts):
//        search, filters, sort, sources, notes, CSV export. Numbers and sources come from the files, not from the AI.
//   node tools/artifact.mjs csv --title "Leads" [--tier ...] [--status ...] [--as sales]     (leads as a CSV for Excel)
//   node tools/artifact.mjs new --title "Market map" --file workspace/tmp/map.html [--as strategist]
//        publishes a file you wrote (.html, .md, .csv, .json, .svg, .txt). HTML must be self-contained:
//        scripts only from cdn.jsdelivr.net, cdnjs.cloudflare.com or unpkg.com, no calls to other sites.
//   node tools/artifact.mjs list
import fs from 'node:fs';
import path from 'node:path';
import {
  P, readLeads, readText, writeText, parseFrontMatter, logEvent, args, fail, requireWorkspace, isMain, helpIfAsked, slugify, now, toCSV, LEAD_COLUMNS,
} from './lib/common.mjs';
import { listDrafts } from './drafts.mjs';

const KINDS = { html: 'html', htm: 'html', md: 'md', csv: 'csv', json: 'json', svg: 'svg', txt: 'txt' };
const CDNS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'];

export function checkHtml(html) {
  if (html.length > 3 * 1024 * 1024) throw new Error('an artifact is 3 MB max');
  const external = [...html.matchAll(/<(script|link|img|iframe)[^>]+(?:src|href)\s*=\s*["']?(https?:)?\/\/([^/"'\s>]+)/gi)].map(m => m[3].toLowerCase());
  const bad = external.filter(h => !CDNS.includes(h) && !/^fonts\.(googleapis|gstatic)\.com$/.test(h));
  if (bad.length) throw new Error(`artifacts must be self-contained: external resources only from ${CDNS.join(', ')} or Google Fonts (found ${[...new Set(bad)].join(', ')})`);
  if (/\bfetch\s*\(\s*["'`]https?:|XMLHttpRequest|WebSocket\s*\(/i.test(html)) throw new Error('artifacts must not call other websites: embed the data in the page');
}

function publish({ title, content, kind, author = 'director', description = '' }) {
  if (!title) throw new Error('--title is required');
  if (kind === 'html' || kind === 'svg') checkHtml(content);
  fs.mkdirSync(P.artifacts, { recursive: true });
  const base = slugify(title) || 'artifact';
  let name = `${base}.${kind === 'html' ? 'html' : kind}`, k = 2;
  while (fs.existsSync(path.join(P.artifacts, name))) name = `${base}-${k++}.${kind === 'html' ? 'html' : kind}`;
  const file = path.join(P.artifacts, name);
  writeText(file, content);
  const meta = { title, kind, author, created: now(), description, file: name };
  writeText(`${file}.meta.json`, JSON.stringify(meta, null, 2) + '\n');
  logEvent(author, 'artifact', `New ${kind.toUpperCase()} artifact: ${title}`, file, { artifact: name, title });
  return { ...meta, path: file };
}

export function listArtifacts() {
  if (!fs.existsSync(P.artifacts)) return [];
  return fs.readdirSync(P.artifacts).filter(f => f.endsWith('.meta.json')).map(f => {
    try { return JSON.parse(readText(path.join(P.artifacts, f))); } catch { return null; }
  }).filter(m => m && fs.existsSync(path.join(P.artifacts, m.file))).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function selectLeads(o) {
  const tiers = typeof o.tier === 'string' ? o.tier.split(',') : null;
  const statuses = typeof o.status === 'string' ? o.status.split(',') : null;
  return readLeads().filter(l => (!tiers || tiers.includes(l.tier)) && (!statuses || statuses.includes(l.status)))
    .sort((a, b) => (+b.score || 0) - (+a.score || 0));
}

// Sections of an account file, whatever the language of the headings.
function sections(md) {
  const body = parseFrontMatter(md).body;
  const out = {};
  let cur = null;
  for (const line of body.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      const n = h[1].toLowerCase();
      cur = /snapshot|aperçu|en bref/.test(n) ? 'snapshot' : /why now|pourquoi maintenant/.test(n) ? 'whyNow' : /contact/.test(n) ? 'contact'
        : /angle/.test(n) ? 'angle' : /opening fact|fait d'ouverture/.test(n) ? 'opening' : /repl|réponse/.test(n) ? 'replies' : null;
      if (cur) out[cur] = '';
      continue;
    }
    if (cur) out[cur] += line + '\n';
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim().slice(0, 1500);
  return out;
}

const L10N = {
  en: { search: 'Search a company, a city, a signal…', all: 'All', tier: 'Tier', status: 'Status', company: 'Company', score: 'Score', signals: 'Signals', contact: 'Contact', next: 'Next step',
    export: 'Export CSV', leads: n => `${n} leads`, hot: 'hot', warm: 'warm', cold: 'cold', why: 'Why now', angle: 'Angle', snapshot: 'In short', route: 'Contact route', opening: 'Opening fact',
    sources: 'Sources', draft: 'Draft message', notes: 'My notes (saved in this browser)', done: 'Done', none: 'No lead matches.', generated: d => `Generated on ${d} from the company files. Every fact links to its source.` },
  fr: { search: 'Chercher une entreprise, une ville, un signal…', all: 'Tous', tier: 'Niveau', status: 'Statut', company: 'Entreprise', score: 'Score', signals: 'Signaux', contact: 'Contact', next: 'Prochaine étape',
    export: 'Exporter en CSV', leads: n => `${n} prospects`, hot: 'chaud', warm: 'tiède', cold: 'froid', why: 'Pourquoi maintenant', angle: 'Angle', snapshot: 'En bref', route: 'Accès au contact', opening: "Fait d'ouverture",
    sources: 'Sources', draft: 'Message préparé', notes: 'Mes notes (gardées dans ce navigateur)', done: 'Traité', none: 'Aucun prospect ne correspond.',
    st: { new: 'nouveau', researched: 'recherché', qualified: 'qualifié', drafted: 'rédigé', approved: 'approuvé', contacted: 'contacté', replied: 'a répondu', meeting: 'rendez-vous', won: 'gagné', lost: 'perdu', do_not_contact: 'ne pas contacter', draft: 'brouillon', exported: 'exporté', rejected: 'rejeté' }, generated: d => `Généré le ${d} à partir des fichiers de l'entreprise. Chaque information renvoie à sa source.` },
};

export function prospectsHtml(title, leads, lang = 'en') {
  const T = L10N[lang] || L10N.en;
  const drafts = Object.fromEntries(listDrafts().filter(d => (d.kind || 'first') === 'first').map(d => [d.lead || d.id, { subject: d.subject, body: d.body, status: d.status, channel: d.channel }]));
  const data = leads.map(l => ({ ...Object.fromEntries(LEAD_COLUMNS.map(c => [c, l[c] || ''])), acc: sections(readText(path.join(P.accounts, `${l.id}.md`))), draft: drafts[l.id] || null }));
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const labels = JSON.stringify({ ...T, leads: undefined, generated: undefined }).replace(/</g, '\\u003c');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#f6f6f3;--panel:#fff;--ink:#15171b;--ink2:#3b3f47;--muted:#737883;--line:#e6e4de;--soft:#efeee9;--hot:#c2410c;--hotb:#fde8dc;--warm:#b45309;--warmb:#fdf0dc;--cold:#64748b;--coldb:#eef1f5;--acc:#1f5eff}
@media (prefers-color-scheme:dark){:root{--bg:#0d0e11;--panel:#15171b;--ink:#e9ebef;--ink2:#c3c7cf;--muted:#8b919c;--line:#262930;--soft:#1c1f24;--hotb:#2e1d12;--warmb:#2d2412;--coldb:#1d2229;--hot:#fb923c;--warm:#fbbf24;--acc:#6b93ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{padding:22px 24px 10px}h1{margin:0;font-size:22px;letter-spacing:-.02em}.sub{color:var(--muted);font-size:12.5px;margin-top:4px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 24px 14px}.bar input,.bar select{font:inherit;padding:8px 10px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
.bar input{flex:1;min-width:220px}.btn{border:1px solid var(--ink);background:var(--ink);color:var(--bg);padding:8px 12px;border-radius:9px;font-weight:600;cursor:pointer}
.stats{display:flex;gap:8px;padding:0 24px 12px;flex-wrap:wrap}.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:12.5px;color:var(--muted)}.stat b{color:var(--ink);font-size:16px;margin-right:4px}
.wrap{padding:0 24px 30px;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto}
table{width:100%;border-collapse:collapse}th{position:sticky;top:0;background:var(--panel);text-align:left;font-size:12px;color:var(--muted);padding:9px 10px;border-bottom:1px solid var(--line);cursor:pointer;white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}tr.r{cursor:pointer}tr.r:hover td,tr.sel td{background:var(--soft)}tr.doneRow td{opacity:.55}
.pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px}.hot{background:var(--hotb);color:var(--hot)}.warm{background:var(--warmb);color:var(--warm)}.cold{background:var(--coldb);color:var(--cold)}
.chip{font-size:11px;background:var(--soft);padding:1px 6px;border-radius:6px;margin:0 3px 3px 0;display:inline-block}.muted{color:var(--muted);font-size:12.5px}
.detail{padding:16px 18px}.detail h2{margin:0 0 4px;font-size:18px}.detail h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 0 4px}
.detail p{margin:4px 0;color:var(--ink2);white-space:pre-wrap}.detail a{color:var(--acc);word-break:break-all}textarea{width:100%;min-height:90px;font:inherit;padding:8px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.draft{background:var(--soft);border-radius:10px;padding:10px 12px;white-space:pre-wrap;font-size:13px}
@media (max-width:900px){.wrap{grid-template-columns:1fr}}
</style></head><body>
<header><h1>${esc(title)}</h1><div class="sub">${esc(T.generated(new Date().toISOString().slice(0, 10)))}</div></header>
<div class="bar"><input id="q" placeholder="${esc(T.search)}"><select id="tier"><option value="">${esc(T.tier)}: ${esc(T.all)}</option><option value="hot">${esc(T.hot)}</option><option value="warm">${esc(T.warm)}</option><option value="cold">${esc(T.cold)}</option></select>
<select id="status"></select><button class="btn" id="csv">${esc(T.export)}</button></div>
<div class="stats" id="stats"></div>
<div class="wrap"><div class="card"><table><thead><tr><th data-k="company">${esc(T.company)}</th><th data-k="score">${esc(T.score)}</th><th data-k="tier">${esc(T.tier)}</th><th data-k="status">${esc(T.status)}</th><th>${esc(T.signals)}</th><th data-k="contact_role">${esc(T.contact)}</th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="card detail" id="detail"></div></div>
<script>
const DATA = ${json};
const T = ${labels};
const KEY = 'oc-notes:' + ${JSON.stringify(slugify(title))};
let notes = {}; try { notes = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const links = s => esc(s).replace(/https?:\\/\\/[^\\s<)]+/g, u => '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
let sortK = 'score', sortDir = -1, sel = DATA[0] && DATA[0].id;
const statuses = [...new Set(DATA.map(d => d.status))];
document.getElementById('status').innerHTML = '<option value="">' + esc(T.status) + ': ' + esc(T.all) + '</option>' + statuses.map(s => '<option value="' + esc(s) + '">' + esc((T.st || {})[s] || s) + '</option>').join('');
function filtered() {
  const q = document.getElementById('q').value.toLowerCase(), t = document.getElementById('tier').value, s = document.getElementById('status').value;
  return DATA.filter(d => (!t || d.tier === t) && (!s || d.status === s) && (!q || JSON.stringify(d).toLowerCase().includes(q)))
    .sort((a, b) => { const x = a[sortK], y = b[sortK]; return (sortK === 'score' ? (+x || 0) - (+y || 0) : String(x).localeCompare(String(y))) * sortDir; });
}
function render() {
  const list = filtered();
  const count = k => list.filter(d => d.tier === k).length;
  document.getElementById('stats').innerHTML = '<div class="stat"><b>' + list.length + '</b>/' + DATA.length + '</div>' + ['hot', 'warm', 'cold'].map(k => '<div class="stat"><b>' + count(k) + '</b>' + esc(T[k]) + '</div>').join('');
  document.getElementById('rows').innerHTML = list.map(d => '<tr class="r' + (d.id === sel ? ' sel' : '') + (notes[d.id] && notes[d.id].done ? ' doneRow' : '') + '" data-id="' + esc(d.id) + '"><td><b>' + esc(d.company) + '</b><div class="muted">' + esc([d.city, d.industry].filter(Boolean).join(' · ')) + '</div></td><td><b>' + esc(d.score) + '</b></td><td>' + (d.tier ? '<span class="pill ' + esc(d.tier) + '">' + esc(T[d.tier] || d.tier) + '</span>' : '') + '</td><td class="muted">' + esc((T.st || {})[d.status] || d.status) + '</td><td>' + String(d.signals || '').split(/;\\s*/).filter(Boolean).map(x => '<span class="chip">' + esc(x.replace('@', ' · ')) + '</span>').join('') + '</td><td class="muted">' + esc(d.contact_role) + '</td></tr>').join('') || '<tr><td colspan="6" class="muted">' + esc(T.none) + '</td></tr>';
  document.querySelectorAll('tr.r').forEach(tr => tr.onclick = () => { sel = tr.dataset.id; render(); });
  detail();
}
function detail() {
  const d = DATA.find(x => x.id === sel); const el = document.getElementById('detail');
  if (!d) { el.innerHTML = ''; return; }
  const n = notes[d.id] || {};
  const sec = (k, label) => d.acc && d.acc[k] ? '<h3>' + esc(label) + '</h3><p>' + links(d.acc[k]) + '</p>' : '';
  el.innerHTML = '<h2>' + esc(d.company) + '</h2><div class="muted">' + esc([d.city, d.country, d.employees].filter(Boolean).join(' · ')) + (d.website ? ' · <a href="' + esc(/^https?:/.test(d.website) ? d.website : 'https://' + d.website) + '" target="_blank" rel="noopener">' + esc(d.website) + '</a>' : '') + '</div>'
    + sec('snapshot', T.snapshot) + sec('whyNow', T.why) + sec('opening', T.opening) + sec('angle', T.angle)
    + '<h3>' + esc(T.contact) + '</h3><p>' + esc([d.contact_name, d.contact_role, d.contact_channel].filter(Boolean).join(' · ')) + (d.contact_source ? '\\n' + links(d.contact_source) : '') + '</p>'
    + (d.draft ? '<h3>' + esc(T.draft) + ' (' + esc((T.st || {})[d.draft.status] || d.draft.status) + ')</h3><div class="draft"><b>' + esc(d.draft.subject || '') + '</b>\\n\\n' + esc(d.draft.body || '') + '</div>' : '')
    + '<h3>' + esc(T.sources) + '</h3><p>' + links(String(d.sources || '').split(/\\s+/).join('\\n')) + '</p>'
    + '<h3>' + esc(T.notes) + '</h3><label><input type="checkbox" id="done"' + (n.done ? ' checked' : '') + '> ' + esc(T.done) + '</label><textarea id="note">' + esc(n.text || '') + '</textarea>';
  document.getElementById('note').oninput = e => { notes[d.id] = { ...(notes[d.id] || {}), text: e.target.value }; save(); };
  document.getElementById('done').onchange = e => { notes[d.id] = { ...(notes[d.id] || {}), done: e.target.checked }; save(); render(); };
}
document.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => { const k = th.dataset.k; sortDir = sortK === k ? -sortDir : (k === 'score' ? -1 : 1); sortK = k; render(); });
['q', 'tier', 'status'].forEach(id => document.getElementById(id).oninput = render);
document.getElementById('csv').onclick = () => {
  const cols = ['company', 'score', 'tier', 'status', 'city', 'website', 'contact_name', 'contact_role', 'contact_channel', 'signals', 'next_action', 'sources'];
  const q = v => /[",\\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');
  const lines = [cols.concat(['notes', 'done']).join(','), ...filtered().map(d => cols.map(c => q(d[c])).concat([q((notes[d.id] || {}).text || ''), (notes[d.id] || {}).done ? 'yes' : '']).join(','))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\\ufeff' + lines.join('\\n')], { type: 'text/csv' })); a.download = ${JSON.stringify(slugify(title) || 'prospects')} + '.csv'; a.click();
};
render();
</script></body></html>`;
}

function main() {
  requireWorkspace();
  const a = args();
  const [cmd] = a._;
  const author = typeof a.as === 'string' ? a.as : 'sales';
  try {
    if (cmd === 'prospects') {
      const leads = selectLeads(a);
      if (!leads.length) fail('no lead matches: prospect first, or loosen --tier/--status');
      const lang = a.lang === 'fr' ? 'fr' : 'en';
      const r = publish({ title: a.title, content: prospectsHtml(a.title, leads, lang), kind: 'html', author, description: lang === 'fr' ? `${leads.length} prospects, interactif` : `${leads.length} leads, interactive` });
      return console.log(`${r.file}  (${leads.length} leads)`);
    }
    if (cmd === 'csv') {
      const leads = selectLeads(a);
      const r = publish({ title: a.title, content: '﻿' + toCSV(leads, LEAD_COLUMNS), kind: 'csv', author, description: `${leads.length} leads` });
      return console.log(r.file);
    }
    if (cmd === 'new') {
      if (typeof a.file !== 'string') fail('usage: new --title "..." --file workspace/tmp/x.html');
      const kind = KINDS[path.extname(a.file).slice(1).toLowerCase()];
      if (!kind) fail(`unsupported file type: use ${Object.keys(KINDS).join(', ')}`);
      const r = publish({ title: a.title, content: fs.readFileSync(a.file, 'utf8'), kind, author: typeof a.as === 'string' ? a.as : 'director', description: typeof a.description === 'string' ? a.description : '' });
      return console.log(r.file);
    }
    if (cmd === 'list' || !cmd) {
      const all = listArtifacts();
      if (!all.length) return console.log('(no artifacts)');
      for (const m of all) console.log(`${m.kind.padEnd(5)} ${m.file.padEnd(40)} ${m.title}  (${m.author})`);
      return;
    }
    fail('commands: prospects, csv, new, list');
  } catch (e) { fail(e.message); }
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) main();
