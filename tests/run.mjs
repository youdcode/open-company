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

console.log('live office');
const { startServer } = await import('../viewer/server.mjs');
const port = 47000 + Math.floor(Math.random() * 1000);
const server = await startServer(port);
const base = `http://127.0.0.1:${port}`;
const state = await (await fetch(`${base}/api/state`)).json();
ok('state API returns roles, leads, drafts, events', state.roles.length === 9 && state.leads.length === 2 && state.drafts.length === 2 && state.events.length > 5);
ok('files are listed even when the folder lives under a path containing "tmp"', state.files.some(f => f.path.endsWith('prospecting/leads.csv')));
let res = await fetch(`${base}/api/drafts/acme-software-f1/status`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"status":"approved"}' });
ok('another website cannot approve a draft', res.status === 403);
res = await fetch(`${base}/api/drafts/acme-software-f1/status`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: '{"status":"approved"}' });
ok('the page can approve a draft', res.ok);
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
await new Promise(r3 => setTimeout(r3, 1200));
const feed = fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8');
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
}

fs.rmSync(BASE, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
