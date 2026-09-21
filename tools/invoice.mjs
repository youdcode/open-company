#!/usr/bin/env node
// Quotes and invoices. The AI prepares DRAFTS; only a human issues them, from the live office
// (Finance tab). Issuing assigns the next number in an unbroken sequence (INV-2026-0001...),
// which is why this script has no "issue" command.
// Amounts are computed in cents, VAT per line, so totals are exact.
//
// Usage:
//   node tools/invoice.mjs new --file workspace/tmp/doc.json [--as finance]
//        doc.json: {"type":"quote"|"invoice","client":{"name":"...","address":"...","vat_id":"...","lead":"<lead id>"},
//                   "lines":[{"description":"...","qty":2,"unit_price":450,"vat_rate":20}],"notes":"..."}
//   node tools/invoice.mjs from-quote <quote-id>      (invoice draft from an accepted quote)
//   node tools/invoice.mjs list
//   node tools/invoice.mjs show <id>
//   node tools/invoice.mjs render <id>                (rewrite the printable HTML)
import fs from 'node:fs';
import path from 'node:path';
import {
  WS, readText, writeText, parseFrontMatter, logEvent, args, fail, requireWorkspace, isMain, withLock, slugify, today, now,
} from './lib/common.mjs';

export const DIR = path.join(WS, 'departments', 'finance', 'documents');
const NUMBERING = path.join(WS, 'departments', 'finance', 'numbering.json');
export const BILLING = path.join(WS, 'company', 'billing.md');
export const STATUSES = { quote: ['draft', 'issued', 'accepted', 'declined'], invoice: ['draft', 'issued', 'paid', 'void'] };

const jsonOf = id => path.join(DIR, `${id}.json`);
export const htmlOf = id => path.join(DIR, `${id}.html`);

export function billing() {
  const { data, body } = parseFrontMatter(readText(BILLING));
  return { ...data, footer: body.replace(/^#.*\n/m, '').trim(), vat_rate: data.vat_rate === '' || data.vat_rate == null ? 20 : Number(data.vat_rate) };
}

const cents = x => Math.round(Number(x) * 100);
export function computeTotals(doc, defaultVat = 20) {
  let net = 0, vat = 0;
  const lines = (doc.lines || []).map(l => {
    const qty = Number(l.qty ?? 1);
    const rate = l.vat_rate === undefined || l.vat_rate === '' ? defaultVat : Number(l.vat_rate);
    const lineNet = Math.round(qty * cents(l.unit_price));
    const lineVat = Math.round(lineNet * rate / 100);
    net += lineNet; vat += lineVat;
    return { ...l, qty, vat_rate: rate, net: lineNet / 100 };
  });
  return { lines, totals: { net: net / 100, vat: vat / 100, gross: (net + vat) / 100 } };
}

export function validateDoc(doc) {
  const errors = [];
  if (!['quote', 'invoice'].includes(doc.type)) errors.push('type must be "quote" or "invoice"');
  if (!doc.client?.name) errors.push('client.name is required');
  if (!Array.isArray(doc.lines) || !doc.lines.length) errors.push('at least one line is required');
  for (const [i, l] of (doc.lines || []).entries()) {
    if (!l.description) errors.push(`line ${i + 1}: description is required`);
    if (!Number.isFinite(Number(l.unit_price))) errors.push(`line ${i + 1}: unit_price must be a number`);
    if (l.qty !== undefined && !(Number(l.qty) > 0)) errors.push(`line ${i + 1}: qty must be positive`);
  }
  return errors;
}

export function readDoc(id) {
  try { return JSON.parse(readText(jsonOf(id))); } catch { return null; }
}

export function listDocs() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => readDoc(f.slice(0, -5))).filter(Boolean)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function save(doc) {
  const b = billing();
  const { lines, totals } = computeTotals(doc, b.vat_rate);
  const full = { ...doc, lines, totals, currency: doc.currency || b.currency || 'EUR' };
  writeText(jsonOf(full.id), JSON.stringify(full, null, 2) + '\n');
  writeText(htmlOf(full.id), renderHTML(full, b));
  return full;
}

export function createDoc(input, author = 'finance') {
  const errors = validateDoc(input);
  if (errors.length) throw new Error(errors.join('\n'));
  const id = `${input.type === 'quote' ? 'q' : 'i'}-${today().replace(/-/g, '')}-${slugify(input.client.name).slice(0, 30)}-${Math.random().toString(36).slice(2, 6)}`;
  const doc = save({
    id, type: input.type, status: 'draft', number: '', client: input.client, lines: input.lines,
    notes: input.notes || '', currency: input.currency, created: now(), author, from_quote: input.from_quote || '',
  });
  logEvent(author, 'finance', `Drafted a ${doc.type} for ${doc.client.name}: ${fmt(doc.totals.gross, doc.currency)} incl. VAT`, jsonOf(id));
  return doc;
}

// Human-only transitions (called by the live office server).
export function setDocStatus(id, status, role = 'you') {
  return withLock(NUMBERING, () => {
    const doc = readDoc(id);
    if (!doc) throw new Error(`no document "${id}"`);
    if (!STATUSES[doc.type].includes(status)) throw new Error(`a ${doc.type} cannot be "${status}"`);
    const allowed = { draft: ['issued'], issued: doc.type === 'quote' ? ['accepted', 'declined'] : ['paid', 'void'] };
    if (!(allowed[doc.status] || []).includes(status)) throw new Error(`cannot go from ${doc.status} to ${status}`);
    if (status === 'issued') {
      const b = billing();
      const missing = ['legal_name', 'address'].filter(k => !b[k]);
      if (missing.length) throw new Error(`fill ${missing.join(' and ')} in workspace/company/billing.md before issuing`);
      let counters = {};
      try { counters = JSON.parse(readText(NUMBERING, '{}')); } catch {}
      const prefix = doc.type === 'quote' ? (b.quote_prefix || 'QUO') : (b.invoice_prefix || 'INV');
      const year = today().slice(0, 4);
      const n = (counters[prefix]?.[year] || 0) + 1;
      counters[prefix] = { ...(counters[prefix] || {}), [year]: n };
      writeText(NUMBERING, JSON.stringify(counters, null, 2) + '\n');
      doc.number = `${prefix}-${year}-${String(n).padStart(4, '0')}`;
      doc.issue_date = today();
      const days = Number(b.payment_terms_days) || 30;
      if (doc.type === 'invoice') doc.due_date = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      else doc.valid_until = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    }
    doc.status = status;
    doc[`${status}_at`] = now();
    const saved = save(doc);
    const label = status === 'issued' ? `Issued ${saved.type} ${saved.number}` : `Marked ${saved.number || saved.id} as ${status}`;
    logEvent(role, 'finance', `${label} for ${saved.client.name} (${fmt(saved.totals.gross, saved.currency)})`, jsonOf(id));
    return saved;
  });
}

export function fromQuote(qid, author = 'finance') {
  const q = readDoc(qid);
  if (!q || q.type !== 'quote') throw new Error(`no quote "${qid}"`);
  if (q.status !== 'accepted') throw new Error(`quote ${q.number || qid} is ${q.status}: only an accepted quote becomes an invoice`);
  return createDoc({ type: 'invoice', client: q.client, lines: q.lines.map(({ description, qty, unit_price, vat_rate }) => ({ description, qty, unit_price, vat_rate })), notes: q.notes, currency: q.currency, from_quote: q.number }, author);
}

export function fmt(amount, currency = 'EUR', locale = 'en-GB') {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount); } catch { return `${amount.toFixed(2)} ${currency}`; }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');

export function renderHTML(d, b = billing()) {
  const loc = b.locale || 'en-GB';
  const money = x => esc(fmt(x, d.currency, loc));
  const title = d.type === 'quote' ? 'Quote' : 'Invoice';
  const draft = d.status === 'draft';
  const rows = d.lines.map(l => `<tr><td>${nl(l.description)}</td><td class="n">${esc(l.qty)}</td><td class="n">${money(Number(l.unit_price))}</td><td class="n">${esc(l.vat_rate)}%</td><td class="n">${money(l.net)}</td></tr>`).join('');
  const dates = [
    d.number ? `<div><span>${title} number</span><b>${esc(d.number)}</b></div>` : `<div><span>${title}</span><b>DRAFT, not issued</b></div>`,
    d.issue_date ? `<div><span>Date</span><b>${esc(d.issue_date)}</b></div>` : '',
    d.due_date ? `<div><span>Due date</span><b>${esc(d.due_date)}</b></div>` : '',
    d.valid_until ? `<div><span>Valid until</span><b>${esc(d.valid_until)}</b></div>` : '',
    d.from_quote ? `<div><span>Quote</span><b>${esc(d.from_quote)}</b></div>` : '',
  ].join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.number || `${title} draft`)} · ${esc(d.client.name)}</title>
<style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#15171b;margin:0;padding:32px;max-width:820px;margin:auto}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.02em}.top{display:flex;justify-content:space-between;gap:24px;margin-bottom:28px}
.muted{color:#737883}.box{border:1px solid #e6e4de;border-radius:10px;padding:14px 16px;min-width:240px}.box span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#737883}
.meta{display:grid;grid-template-columns:repeat(3,auto);gap:6px 28px;justify-content:start;margin:18px 0 22px}.meta span{display:block;font-size:11px;color:#737883;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse}th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#737883;text-align:left;border-bottom:1px solid #15171b;padding:8px 6px}
td{padding:10px 6px;border-bottom:1px solid #e6e4de;vertical-align:top}.n{text-align:right;white-space:nowrap}
.totals{margin-left:auto;margin-top:14px;width:300px}.totals div{display:flex;justify-content:space-between;padding:4px 6px}.totals .g{border-top:1px solid #15171b;font-weight:700;font-size:15px;margin-top:4px;padding-top:8px}
.foot{margin-top:36px;font-size:11.5px;color:#555a63;border-top:1px solid #e6e4de;padding-top:12px}
.draft{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:120px;font-weight:800;color:rgba(200,40,40,.08);transform:rotate(-18deg);pointer-events:none}
@media print{body{padding:0}}
</style></head><body>
${draft ? '<div class="draft">DRAFT</div>' : ''}
<div class="top"><div><h1>${title}</h1><div class="muted">${nl(b.legal_name || 'Your company (fill workspace/company/billing.md)')}<br>${nl(b.address || '')}${b.vat_id ? `<br>VAT ${esc(b.vat_id)}` : ''}${b.registration ? `<br>${esc(b.registration)}` : ''}</div></div>
<div class="box"><span>${d.type === 'quote' ? 'Prepared for' : 'Bill to'}</span><b>${esc(d.client.name)}</b><br>${nl(d.client.address || '')}${d.client.vat_id ? `<br>VAT ${esc(d.client.vat_id)}` : ''}</div></div>
<div class="meta">${dates}</div>
<table><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">VAT</th><th class="n">Amount</th></tr>${rows}</table>
<div class="totals"><div><span>Total excl. VAT</span><span>${money(d.totals.net)}</span></div><div><span>VAT</span><span>${money(d.totals.vat)}</span></div><div class="g"><span>Total</span><span>${money(d.totals.gross)}</span></div></div>
${d.notes ? `<p>${nl(d.notes)}</p>` : ''}
<div class="foot">${d.type === 'invoice' && b.iban ? `Payment by bank transfer: IBAN ${esc(b.iban)}${b.bic ? ` · BIC ${esc(b.bic)}` : ''}<br>` : ''}${d.type === 'invoice' && b.payment_terms_days ? `Payment terms: ${esc(b.payment_terms_days)} days.<br>` : ''}${nl(b.footer || '')}</div>
</body></html>`;
}

function main() {
  requireWorkspace();
  const a = args();
  const [cmd, id] = a._;
  const as = typeof a.as === 'string' ? a.as : 'finance';
  try {
    if (cmd === 'new') {
      const raw = typeof a.json === 'string' ? a.json : typeof a.file === 'string' ? fs.readFileSync(a.file, 'utf8') : '';
      if (!raw) fail('usage: new --file workspace/tmp/doc.json (or --json \'{...}\')');
      const doc = createDoc(JSON.parse(raw), as);
      return console.log(`${doc.id}  ${doc.type} draft  ${fmt(doc.totals.gross, doc.currency)} incl. VAT\n${path.relative(process.cwd(), htmlOf(doc.id))}`);
    }
    if (cmd === 'from-quote') { const doc = fromQuote(id, as); return console.log(`${doc.id}  invoice draft  ${fmt(doc.totals.gross, doc.currency)}`); }
    if (cmd === 'issue' || cmd === 'paid' || cmd === 'void') fail('issuing and payment status are human decisions: use the Finance tab of the live office');
    if (cmd === 'show') { const d = readDoc(id); if (!d) fail(`no document "${id}"`); return console.log(JSON.stringify(d, null, 2)); }
    if (cmd === 'render') { const d = readDoc(id); if (!d) fail(`no document "${id}"`); save(d); return console.log(path.relative(process.cwd(), htmlOf(id))); }
    if (cmd === 'list' || !cmd) {
      const docs = listDocs();
      if (!docs.length) return console.log('(no quotes or invoices)');
      for (const d of docs) console.log(`${d.type.padEnd(8)}${(d.number || 'draft').padEnd(16)}${d.status.padEnd(10)}${fmt(d.totals.gross, d.currency).padStart(14)}  ${d.client.name}  (${d.id})`);
      return;
    }
    fail('commands: new, from-quote, list, show, render');
  } catch (e) { fail(e.message); }
}

if (isMain(import.meta.url)) main();
