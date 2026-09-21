#!/usr/bin/env node
// End-to-end checks in a temporary workspace. No AI, no network except the optional registry test.
// Usage: npm test            (add --online to also query the French registry)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The workspace deliberately lives under a folder named "tmp" (regression: paths containing /tmp/).
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'open-company-test-'));
const TMP = path.join(BASE, 'tmp', 'workspace');
process.env.OPEN_COMPANY_WORKSPACE = TMP;
process.env.OPEN_COMPANY_NO_OPEN = '1';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
const run = (script, argv, input) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, script), ...argv], { env: process.env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};
const leads = () => fs.readFileSync(path.join(TMP, 'prospecting', 'leads.csv'), 'utf8');

console.log('workspace');
run('tools/init.mjs', []);
ok('init creates the workspace', fs.existsSync(path.join(TMP, 'company', 'profile.md')) && fs.existsSync(path.join(TMP, 'org', 'messages')));
ok('init never overwrites', (fs.writeFileSync(path.join(TMP, 'org', 'journal.md'), 'mine'), run('tools/init.mjs', []), fs.readFileSync(path.join(TMP, 'org', 'journal.md'), 'utf8') === 'mine'));

console.log('rules enforced by code');
let r = run('tools/leads.mjs', ['add', '--as', 'researcher', '--json', JSON.stringify({ company: 'No Source Ltd' })]);
ok('a lead without a source is rejected', r.code !== 0 && !leads().includes('No Source'));
r = run('tools/leads.mjs', ['add', '--json', JSON.stringify({ company: 'Guess Co', sources: 'https://guess.example', contact_channel: 'jane@guess.example' })]);
ok('a contact without contact_source is rejected', r.code !== 0 && /contact_source/.test(r.out));
r = run('tools/leads.mjs', ['add', '--json', JSON.stringify({ company: 'Bad Signal', sources: 'https://bad.example', signals: 'hiring last week' })]);
ok('an undated signal is rejected', r.code !== 0);
r = run('tools/leads.mjs', ['add', '--as', 'researcher', '--json', JSON.stringify([
  { company: 'Acme Software', website: 'https://acme.example', country: 'FR', city: 'Lyon', industry: 'software 62.01Z', employees: '20-49', signals: `hiring@${new Date().toISOString().slice(0, 10)}`, sources: 'https://acme.example/about' },
  { company: 'Beta Bakery', website: 'beta.example', country: 'BE', industry: 'bakery', employees: '3-5', sources: 'https://beta.example' },
  { company: 'Acme Software SAS', website: 'https://www.acme.example/', sources: 'https://acme.example' },
])]);
const rep = JSON.parse(r.out);
ok('valid leads are added', rep.added.length === 2);
ok('duplicates (same website) are skipped', rep.skipped.length === 1 && rep.skipped[0].existing === 'acme-software');

console.log('scoring');
r = run('tools/score.mjs', ['--as', 'researcher']);
const rows = leads().split('\n');
const acme = rows.find(l => l.startsWith('acme-software'));
const beta = rows.find(l => l.startsWith('beta-bakery'));
ok('fit + fresh signal makes a hot lead', /,75,hot,industry\+size\+geo\+hiring,/.test(acme), acme);
ok('no fit makes a cold lead', /,0,cold,no match,/.test(beta), beta);

console.log('drafts, approval, export');
r = run('tools/drafts.mjs', ['new', 'acme-software', '--subject', 'Your new sales hires', '--body', 'Hello, I saw you are hiring.']);
ok('a draft is created', fs.existsSync(path.join(TMP, 'prospecting', 'drafts', 'acme-software.md')));
ok('lead moves to drafted', /,drafted,/.test(leads()));
r = run('tools/export.mjs', []);
ok('nothing exported before approval', /nothing to export/.test(r.out));
run('tools/drafts.mjs', ['set', 'acme-software', 'approved']);
r = run('tools/export.mjs', []);
const exp = path.join(TMP, 'prospecting', 'exports', `outreach-${new Date().toISOString().slice(0, 10)}.csv`);
ok('approved drafts are exported to CSV', fs.existsSync(exp) && fs.readFileSync(exp, 'utf8').includes('Your new sales hires'));
r = run('tools/drafts.mjs', ['new', 'acme-software', '--subject', 'x', '--body', 'y']);
ok('an exported first message cannot be overwritten', r.code !== 0 && /followup/.test(r.out));
r = run('tools/drafts.mjs', ['new', 'acme-software', '--followup', '--subject', 'One more thing', '--body', 'Short follow-up.']);
ok('follow-ups get their own file', fs.existsSync(path.join(TMP, 'prospecting', 'drafts', 'acme-software-f1.md')));
run('tools/leads.mjs', ['update', 'beta-bakery', 'status=do_not_contact']);
r = run('tools/drafts.mjs', ['new', 'beta-bakery', '--subject', 'x', '--body', 'y']);
ok('opt-outs cannot be drafted', r.code !== 0);

console.log('board and handoffs');
run('tools/board.mjs', ['add', 'Prospect 10 in Lyon', '--role', 'researcher']);
run('tools/board.mjs', ['move', 'Prospect 10', '--to', 'done']);
ok('board card moves to Done', /## Done\n- \[x\] Prospect 10 in Lyon \(@researcher\)/.test(fs.readFileSync(path.join(TMP, 'org', 'board.md'), 'utf8')));
r = run('tools/handoff.mjs', ['--from', 'researcher', '--to', 'sales', '--subject', '2 leads ready', '--body', 'Acme is hot.']);
ok('handoff file is written', fs.readdirSync(path.join(TMP, 'org', 'messages')).some(f => f.includes('researcher-to-sales')));
r = run('tools/handoff.mjs', ['--from', 'a', '--to', 'b', '--subject', 's', '--body', 'x\n'.repeat(12)]);
ok('long handoffs are refused', r.code !== 0);
const events = fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
ok('every step reached the live feed', events.some(e => e.type === 'lead') && events.some(e => e.type === 'draft') && events.some(e => e.type === 'review') && events.some(e => e.type === 'handoff'));

console.log('--help never does anything');
{
  const before = fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8');
  const tools = ['board', 'drafts', 'export', 'handoff', 'init', 'invoice', 'leads', 'log', 'registry-fr', 'registry-no', 'registry-uk', 'replies', 'score', 'sync-adapters'];
  const outs = tools.map(t => run(`tools/${t}.mjs`, ['--help']));
  ok('every tool answers --help with its usage', outs.every(o => o.code === 0 && o.out.trim().length > 20));
  ok('--help has no side effect (no event, no export)', fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8') === before);
}

console.log('several agents at the same time');
{
  const { spawn } = await import('node:child_process');
  const runAsync = (script, argv) => new Promise(res => {
    const c = spawn(process.execPath, [path.join(ROOT, script), ...argv], { env: process.env, stdio: 'ignore' });
    c.on('exit', code => res(code));
  });
  const codes = await Promise.all(Array.from({ length: 10 }, (_, i) => runAsync('tools/leads.mjs',
    ['add', '--as', 'researcher', '--json', JSON.stringify({ company: `Parallel Co ${i}`, sources: `https://parallel-${i}.example` })])));
  const all = leads();
  ok('10 agents adding leads at once: no row lost', codes.every(c => c === 0) && Array.from({ length: 10 }, (_, i) => all.includes(`Parallel Co ${i},`)).every(Boolean));
  await Promise.all(Array.from({ length: 8 }, (_, i) => runAsync('tools/board.mjs', ['add', `Parallel task ${i}`, '--role', 'researcher'])));
  const board = fs.readFileSync(path.join(TMP, 'org', 'board.md'), 'utf8');
  ok('8 agents adding tasks at once: no task lost', Array.from({ length: 8 }, (_, i) => board.includes(`Parallel task ${i} (@researcher)`)).every(Boolean));
  ok('no lock file left behind', !fs.readdirSync(path.join(TMP, 'prospecting')).some(f => f.endsWith('.lock')) && !fs.readdirSync(path.join(TMP, 'org')).some(f => f.endsWith('.lock')));
  // keep the later checks independent of these extra leads
  const kept = all.split('\n').filter(l => !l.startsWith('parallel-co-')).join('\n');
  fs.writeFileSync(path.join(TMP, 'prospecting', 'leads.csv'), kept);
}

console.log('quotes and invoices');
{
  const doc = { type: 'invoice', client: { name: 'Acme Software', address: '1 Main St, Lyon' }, notes: 'Thank you.',
    lines: [{ description: 'Setup', qty: 1.5, unit_price: 400 }, { description: 'Licence', qty: 2, unit_price: 99.99, vat_rate: 20 }] };
  r = run('tools/invoice.mjs', ['new', '--json', JSON.stringify(doc)]);
  const id = (r.out.match(/^(i-[a-z0-9-]+)/m) || [])[1];
  const inv = id && JSON.parse(fs.readFileSync(path.join(TMP, 'departments', 'finance', 'documents', `${id}.json`), 'utf8'));
  ok('invoice totals are exact (cents, VAT per line)', inv && inv.totals.net === 799.98 && inv.totals.vat === 160 && inv.totals.gross === 959.98, JSON.stringify(inv?.totals));
  ok('a new invoice is a draft without number', inv && inv.status === 'draft' && inv.number === '');
  ok('the printable HTML is written, marked DRAFT', id && /DRAFT/.test(fs.readFileSync(path.join(TMP, 'departments', 'finance', 'documents', `${id}.html`), 'utf8')));
  r = run('tools/invoice.mjs', ['issue', id]);
  ok('the AI cannot issue an invoice', r.code !== 0 && /human/.test(r.out));
  r = run('tools/invoice.mjs', ['new', '--json', JSON.stringify({ type: 'invoice', client: { name: 'X' }, lines: [] })]);
  ok('an invoice without lines is refused', r.code !== 0);
  globalThis.__invoiceId = id;
}

console.log('replies from prospects');
{
  const inbox = path.join(TMP, 'prospecting', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  run('tools/leads.mjs', ['add', '--json', JSON.stringify({ company: 'Reply Co', website: 'https://reply-co.example', contact_name: 'Ana', contact_channel: 'ana@reply-co.example', contact_source: 'https://reply-co.example/team', sources: 'https://reply-co.example' })]);
  run('tools/leads.mjs', ['add', '--json', JSON.stringify({ company: 'Nope Ltd', website: 'https://nope.example', sources: 'https://nope.example' })]);
  fs.writeFileSync(path.join(inbox, 'r1.eml'), 'From: Ana <ana@reply-co.example>\r\nSubject: =?utf-8?Q?Re=3A_Your_new_hires_=E2=9C=93?=\r\nDate: Mon, 21 Sep 2026 10:00:00 +0200\r\nContent-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHello, yes let=E2=80=99s talk next Tuesday.\r\n\r\nOn Mon, you wrote:\r\n> old text\r\n--b1\r\nContent-Type: text/html\r\n\r\n<p>html</p>\r\n--b1--\r\n');
  fs.writeFileSync(path.join(inbox, 'r2.eml'), 'From: boss@nope.example\r\nSubject: Re: hello\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from('Merci de ne plus me contacter.').toString('base64') + '\r\n');
  fs.writeFileSync(path.join(inbox, 'r3.eml'), 'From: someone@gmail.com\r\nSubject: hi\r\n\r\nhello\r\n');
  r = run('tools/replies.mjs', []);
  const rep2 = JSON.parse(r.out.slice(0, r.out.lastIndexOf('}') + 1));
  const L = leads();
  ok('a reply is matched by email and the lead becomes "replied"', rep2.matched.includes('reply-co') && /reply-co,Reply Co,.*,replied,/.test(L));
  ok('the reply text is decoded and stored without the quoted history', /let’s talk next Tuesday/.test(fs.readFileSync(path.join(TMP, 'prospecting', 'accounts', 'reply-co.md'), 'utf8')) && !/old text/.test(fs.readFileSync(path.join(TMP, 'prospecting', 'accounts', 'reply-co.md'), 'utf8')));
  ok('"do not contact me" (French, base64, matched by domain) marks the lead do_not_contact', rep2.optedOut.includes('nope-ltd') && /nope-ltd,.*,do_not_contact,/.test(L));
  ok('a personal mailbox that matches no lead stays in the inbox', rep2.unmatched.length === 1 && fs.existsSync(path.join(inbox, 'r3.eml')) && fs.existsSync(path.join(inbox, 'processed', 'r1.eml')));
}

console.log('live office');
const { startServer } = await import('../viewer/server.mjs');
const port = 47000 + Math.floor(Math.random() * 1000);
const server = await startServer(port);
const base = `http://127.0.0.1:${port}`;
const state = await (await fetch(`${base}/api/state`)).json();
ok('state API returns roles, leads, drafts, events, finance', state.roles.length === 9 && state.leads.length === 4 && state.drafts.length === 2 && state.events.length > 5 && state.finance.length === 1);
ok('files are listed even when the folder lives under a path containing "tmp"', state.files.some(f => f.path.endsWith('prospecting/leads.csv')));
let res = await fetch(`${base}/api/drafts/acme-software-f1/status`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"status":"approved"}' });
ok('another website cannot approve a draft', res.status === 403);
res = await fetch(`${base}/api/drafts/acme-software-f1/status`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: '{"status":"approved"}' });
ok('the page can approve a draft', res.ok);
{
  const iid = globalThis.__invoiceId;
  const post = st => fetch(`${base}/api/finance/${iid}/status`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ status: st }) });
  let fr = await post('issued');
  ok('issuing needs the billing details first', fr.status === 400 && /billing\.md/.test((await fr.json()).error));
  fs.writeFileSync(path.join(TMP, 'company', 'billing.md'), '---\nlegal_name: Test Co SAS\naddress: 2 rue Test, Paris\ncurrency: EUR\nvat_rate: 20\npayment_terms_days: 30\ninvoice_prefix: INV\nquote_prefix: QUO\n---\n\n# Legal mentions\n\nLate payment penalty: 3 times the legal rate.\n');
  fr = await post('issued');
  const issued = JSON.parse(fs.readFileSync(path.join(TMP, 'departments', 'finance', 'documents', `${iid}.json`), 'utf8'));
  const year = new Date().toISOString().slice(0, 4);
  ok('the human issues it from the page: next number in the sequence', fr.ok && issued.number === `INV-${year}-0001` && issued.status === 'issued' && issued.due_date);
  fr = await post('issued');
  ok('an issued invoice cannot be issued twice', fr.status === 400);
  const html = await (await fetch(`${base}/finance/${iid}.html`)).text();
  ok('the issued invoice shows its number, seller, totals and legal mentions', html.includes(`INV-${year}-0001`) && html.includes('Test Co SAS') && /959[.,]98/.test(html) && html.includes('Late payment penalty') && !html.includes('class="draft"'));
  fr = await post('paid');
  ok('then it can be marked paid', fr.ok);
  const b2 = fs.readFileSync(path.join(TMP, 'company', 'billing.md'), 'utf8').replace('payment_terms_days: 30', 'payment_terms_days: 30\nlocale: fr-FR').replace('Late payment penalty', '<!-- note for me only -->\nLate payment penalty');
  fs.writeFileSync(path.join(TMP, 'company', 'billing.md'), b2);
  run('tools/invoice.mjs', ['render', iid]);
  const htmlFr = await (await fetch(`${base}/finance/${iid}.html`)).text();
  ok('French invoices use French labels and hide the notes written for the owner', /Facture n°/.test(htmlFr) && /Total TTC/.test(htmlFr) && /Délai de paiement/.test(htmlFr) && !/note for me only/.test(htmlFr));
}
res = await fetch(`${base}/api/file?path=${encodeURIComponent('../../etc/passwd')}`);
ok('files outside the workspace are not served', res.status === 404);
const got = await new Promise(resolve => {
  const ctrl = new AbortController();
  const t = setTimeout(() => { ctrl.abort(); resolve(false); }, 5000);
  fetch(`${base}/api/stream`, { signal: ctrl.signal }).then(async r2 => {
    setTimeout(() => fs.writeFileSync(path.join(TMP, 'departments', 'marketing', 'one-pager.md'), '---\nauthor: marketer\n---\n# One pager\n'), 1200);
    const reader = r2.body.getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      if (buf.includes('event: change')) { clearTimeout(t); ctrl.abort(); resolve(true); break; }
    }
  }).catch(() => {});
});
ok('a file written by an agent is pushed live', got);
let feed = '';
for (let i = 0; i < 60 && !/"role":"marketer","type":"file"/.test(feed); i++) {
  await new Promise(r3 => setTimeout(r3, 100));
  feed = fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8');
}
ok('direct file edits appear in the feed with their author', /"role":"marketer","type":"file"/.test(feed));
server.close();

console.log('demo mode');
{
  const env = { ...process.env }; delete env.OPEN_COMPANY_WORKSPACE;
  const dport = String(46000 + Math.floor(Math.random() * 1000));
  let dr;
  try { dr = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'demo.mjs'), '--port', dport, '--speed', '100', '--no-open', '--exit'], { env, encoding: 'utf8' }); } catch (e) { dr = String(e.stdout || e.message); }
  const demoLeads = fs.readFileSync(path.join(ROOT, '.demo', 'prospecting', 'leads.csv'), 'utf8');
  ok('the demo replays a full session', /Replay finished/.test(dr) && fs.readdirSync(path.join(ROOT, '.demo', 'prospecting', 'drafts')).length === 3);
  ok('demo scores come from the script: 3 hot, 4 warm, 1 cold', (demoLeads.match(/,hot,/g) || []).length === 3 && (demoLeads.match(/,warm,/g) || []).length === 4 && (demoLeads.match(/,cold,/g) || []).length === 1);
  ok('demo data only uses reserved .example domains', !/https?:\/\/(?![a-z0-9.-]+\.example[/\s,"])/i.test(demoLeads));
}

if (process.argv.includes('--online')) {
  console.log('french registry (online)');
  r = run('tools/registry-fr.mjs', ['--q', 'boulangerie', '--dept', '69', '--limit', '3']);
  const j = r.code === 0 ? JSON.parse(r.out) : { results: [] };
  ok('registry returns companies with a source URL', j.results.length > 0 && j.results.every(x => x.sources.startsWith('https://annuaire-entreprises.data.gouv.fr/')));
  ok('registry drops birth dates', !/naissance|birth/i.test(r.out));
  r = run('tools/registry-no.mjs', ['--nace', '86.950', '--min-employees', '3', '--limit', '2', '--leaders']);
  const jn = r.code === 0 ? JSON.parse(r.out) : { results: [] };
  ok('Norwegian registry: active companies with sources, min employees raised to 5', jn.results.length > 0 && jn.results.every(x => x.sources.startsWith('https://virksomhet.brreg.no/')) && /privacy/.test(jn.note));
  ok('Norwegian registry drops birth dates', !/fodselsdato|birth/i.test(r.out));
}
r = run('tools/registry-uk.mjs', ['--q', 'physio']);
ok('UK registry explains how to get a free key when it is missing', r.code !== 0 && /COMPANIES_HOUSE_API_KEY/.test(r.out));

fs.rmSync(BASE, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
