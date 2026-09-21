#!/usr/bin/env node
// The mini-CRM. Every write goes through here so the rules are enforced by code, not by hope:
//   - no source, no lead (at least one http(s) URL in `sources`)
//   - a named contact or a contact channel needs its own `contact_source` URL
//   - no duplicates (same id, registry id or website)
//
// Usage:
//   node tools/leads.mjs add --as researcher --json '{"company":"...","sources":"https://..."}'
//   node tools/leads.mjs add --as researcher --file workspace/tmp/batch.json   (object or array)
//   node tools/leads.mjs update <id> status=qualified next_action="call" --as sales
//   node tools/leads.mjs list [--status new] [--tier hot] [--due]
//   node tools/leads.mjs get <id>
//   node tools/leads.mjs stats
import fs from 'node:fs';
import {
  LEAD_COLUMNS, LEAD_STATUSES, readLeads, writeLeads, slugify, today, logEvent,
  args, fail, requireWorkspace, P, isMain, withLock, helpIfAsked
} from './lib/common.mjs';

const URL_RE = /https?:\/\/[^\s;,]+/g;
const urls = v => (Array.isArray(v) ? v.join(' ') : String(v || '')).match(URL_RE) || [];
const host = u => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return ''; } };

function normalize(input) {
  const lead = {};
  for (const [k, v] of Object.entries(input)) {
    if (!LEAD_COLUMNS.includes(k)) { console.error(`warning: ignored unknown field "${k}"`); continue; }
    lead[k] = Array.isArray(v) ? v.join(k === 'signals' ? '; ' : ' ') : String(v ?? '').trim();
  }
  // "unknown", "none", "n/a"... are not websites: keep the field empty instead.
  if (lead.website && !/^(https?:\/\/)?[^\s/]+\.[a-z]{2,}/i.test(lead.website)) lead.website = '';
  return lead;
}

export function validate(lead) {
  const errors = [];
  if (!lead.company) errors.push('company is required');
  if (!urls(lead.sources).length) errors.push('no source, no lead: `sources` needs at least one http(s) URL');
  if ((lead.contact_name || lead.contact_channel) && !urls(lead.contact_source).length)
    errors.push('a contact needs `contact_source` (the URL where this person or channel was found). Never guess emails.');
  if (lead.status && !LEAD_STATUSES.includes(lead.status)) errors.push(`status must be one of: ${LEAD_STATUSES.join(', ')}`);
  if (lead.signals) for (const s of lead.signals.split(/;\s*/).filter(Boolean))
    if (!/^[a-z_]+@\d{4}-\d{2}-\d{2}$/.test(s.trim())) errors.push(`signal "${s}" must look like type@YYYY-MM-DD (e.g. hiring@2026-09-01)`);
  if (lead.next_action_date && !/^\d{4}-\d{2}-\d{2}$/.test(lead.next_action_date)) errors.push('next_action_date must be YYYY-MM-DD');
  return errors;
}

function findDuplicate(leads, lead) {
  const h = host(lead.website);
  return leads.find(l =>
    l.id === lead.id ||
    (lead.registry_id && l.registry_id === lead.registry_id) ||
    (h && host(l.website) === h));
}

export function addLeads(items, role = 'researcher') {
  return withLock(P.leads, () => addLeadsUnlocked(items, role));
}

function addLeadsUnlocked(items, role) {
  const leads = readLeads();
  const report = { added: [], skipped: [], rejected: [] };
  for (const raw of items) {
    const lead = normalize(raw);
    lead.id = lead.id || slugify(lead.company);
    lead.status = lead.status || 'new';
    lead.owner = lead.owner || role;
    lead.updated = today();
    const errors = validate(lead);
    if (errors.length) { report.rejected.push({ company: lead.company || '(no name)', errors }); continue; }
    const dup = findDuplicate(leads, lead);
    if (dup) { report.skipped.push({ company: lead.company, existing: dup.id }); continue; }
    leads.push(lead);
    report.added.push(lead.id);
  }
  if (report.added.length) {
    writeLeads(leads);
    logEvent(role, 'lead', `Added ${report.added.length} lead${report.added.length > 1 ? 's' : ''}: ${report.added.slice(0, 5).join(', ')}${report.added.length > 5 ? '…' : ''}`, P.leads);
  }
  return report;
}

export function updateLead(id, changes, role) {
  return withLock(P.leads, () => {
    const leads = readLeads();
    const lead = leads.find(l => l.id === id);
    if (!lead) throw new Error(`no lead with id "${id}"`);
    const before = lead.status;
    Object.assign(lead, normalize(changes), { updated: today() });
    const errors = validate(lead);
    if (errors.length) throw new Error(errors.join('\n'));
    writeLeads(leads);
    const moved = changes.status && changes.status !== before ? ` (${before} → ${changes.status})` : '';
    logEvent(role || lead.owner, 'lead', `Updated ${lead.company}${moved}`, P.leads);
    return lead;
  });
}

function printTable(rows) {
  if (!rows.length) return console.log('(no leads)');
  const cols = ['id', 'company', 'tier', 'score', 'status', 'next_action_date', 'next_action'];
  const w = cols.map(c => Math.min(28, Math.max(c.length, ...rows.map(r => String(r[c] || '').length))));
  const line = r => cols.map((c, i) => String(r[c] || '').slice(0, w[i]).padEnd(w[i])).join('  ');
  console.log(line(Object.fromEntries(cols.map(c => [c, c]))));
  rows.forEach(r => console.log(line(r)));
}

function main() {
  requireWorkspace();
  const a = args();
  const [cmd, ...rest] = a._;
  const role = typeof a.as === 'string' ? a.as : undefined;

  if (cmd === 'add') {
    let payload = typeof a.json === 'string' ? a.json : '';
    if (!payload && typeof a.file === 'string') payload = fs.readFileSync(a.file, 'utf8');
    if (!payload && !process.stdin.isTTY) payload = fs.readFileSync(0, 'utf8');
    if (!payload) fail('provide --json \'{...}\', --file leads.json, or pipe JSON on stdin');
    let data;
    try { data = JSON.parse(payload); } catch (e) { fail(`invalid JSON: ${e.message}`); }
    const r = addLeads(Array.isArray(data) ? data : [data], role);
    console.log(JSON.stringify(r, null, 2));
    if (r.rejected.length && !r.added.length) process.exit(2);
    return;
  }
  if (cmd === 'update') {
    const [id, ...pairs] = rest;
    if (!id || !pairs.length) fail('usage: update <id> key=value [key=value...]');
    const changes = Object.fromEntries(pairs.map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
    try { console.log(JSON.stringify(updateLead(id, changes, role), null, 2)); } catch (e) { fail(e.message); }
    return;
  }
  if (cmd === 'get') {
    const l = readLeads().find(x => x.id === rest[0]);
    if (!l) fail(`no lead with id "${rest[0]}"`);
    console.log(JSON.stringify(l, null, 2));
    return;
  }
  if (cmd === 'list' || !cmd) {
    let rows = readLeads();
    if (a.status) rows = rows.filter(r => r.status === a.status);
    if (a.tier) rows = rows.filter(r => r.tier === a.tier);
    if (a.due) rows = rows.filter(r => r.next_action_date && r.next_action_date <= today() && !['won', 'lost', 'do_not_contact'].includes(r.status));
    rows.sort((x, y) => (Number(y.score) || 0) - (Number(x.score) || 0));
    printTable(rows);
    return;
  }
  if (cmd === 'stats') {
    const rows = readLeads();
    const by = k => rows.reduce((m, r) => ((m[r[k] || '-'] = (m[r[k] || '-'] || 0) + 1), m), {});
    console.log(JSON.stringify({ total: rows.length, status: by('status'), tier: by('tier') }, null, 2));
    return;
  }
  fail(`unknown command "${cmd}". Commands: add, update, list, get, stats`);
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) main();
