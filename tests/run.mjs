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

console.log('claude local permissions');
{
  const { writeClaudeLocalSettings } = await import('../tools/lib/common.mjs');
  const fake = path.join(BASE, 'fake project');
  fs.mkdirSync(path.join(fake, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(fake, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, model: 'x' }));
  writeClaudeLocalSettings(fake); writeClaudeLocalSettings(fake);
  const st = JSON.parse(fs.readFileSync(path.join(fake, '.claude', 'settings.local.json'), 'utf8'));
  const abs = fake.split(path.sep).join('/');
  ok('absolute tool paths are allowed for this folder only, escapes denied, user settings kept', st.model === 'x' && st.permissions.allow.includes('Bash(npm test)') && st.permissions.allow.includes(`Bash(node ${abs}/tools/*)`) && st.permissions.deny.includes(`Bash(node ${abs}/tools/..*)`) && st.permissions.allow.length === 4);
}

console.log('--help never does anything');
{
  const before = fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8');
  const tools = ['artifact', 'board', 'drafts', 'export', 'handoff', 'init', 'invoice', 'leads', 'log', 'memory', 'registry-fr', 'registry-no', 'registry-uk', 'replies', 'say', 'score', 'sync-adapters'];
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
{
  // Chat with the team, using a fake "claude" that answers like the real one in headless mode.
  process.env.PATH = path.join(ROOT, 'tests', 'fake-bin') + path.delimiter + process.env.PATH;
  const H = { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` };
  const sleep = ms => new Promise(r4 => setTimeout(r4, ms));
  const info = async () => (await fetch(`${base}/api/chat`)).json();
  const idle = async () => { for (let i = 0; i < 150; i++) { const j = await info(); if (!j.busy) return j; await sleep(100); } return info(); };
  // Collects the chat stream (as the page does) until the request is done.
  const stream = () => new Promise(resolve => {
    const ctrl = new AbortController(); const events = []; let first = null;
    const tm = setTimeout(() => { ctrl.abort(); resolve({ events, first }); }, 15000);
    fetch(`${base}/api/chat/stream`, { signal: ctrl.signal }).then(async r5 => {
      const reader = r5.body.getReader(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += new TextDecoder().decode(value);
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k); buf = buf.slice(k + 2);
          const ev = /^event: (\w+)/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (!data) continue;
          const d = JSON.parse(data);
          if (ev === 'job' && !first) first = d;
          if (ev === 'chat') { events.push(d); if (d.type === 'done') { clearTimeout(tm); ctrl.abort(); resolve({ events, first }); return; } }
        }
      }
    }).catch(() => {});
  });
  const send = (message, to = 'auto', lang = 'en') => fetch(`${base}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ message, to, lang }) });
  let st = stream(); await sleep(150);
  let r6 = await send('status');
  const first = await st;
  ok('a chat request starts in the background and answers at once', r6.ok && (await r6.json()).job);
  ok('the page receives the actions and the answer live', first.events.some(e => e.type === 'tool' && /leads\.mjs list/.test(e.text)) && first.events.some(e => e.type === 'text' && /Got it/.test(e.text) && /status/.test(e.text)) && first.events.at(-1).type === 'done');
  await idle();
  await send('prospect 5'); let j1 = await idle();
  ok('the next message continues the same conversation', /resumed fake-session-1/.test(j1.history.at(-1).text));
  ok('the conversation is saved and shown again after a reload', j1.engine === 'claude' && j1.history.filter(m => m.from === 'you').length === 2 && j1.history.filter(m => m.from === 'director').length === 2);

  // Leave and come back: a slow request keeps running on the server and can be picked up again.
  process.env.FAKE_DELAY_MS = '1500';
  await send('a long job');
  await sleep(300);
  const during = await info();
  const again = stream(); const back = await again;
  delete process.env.FAKE_DELAY_MS;
  ok('you can leave the chat: the request keeps running on the server', during.busy && during.job && during.job.events.some(e => e.type === 'tool'));
  ok('coming back shows the work in progress, then the answer', back.first && back.first.job && back.first.job.events.some(e => e.type === 'start') && back.events.some(e => e.type === 'text' && /a long job/.test(e.text)));
  await idle();

  await send('Un one-pager pour les cliniques ?', 'marketer', 'fr'); const j2 = await idle();
  const lastReply = j2.history.at(-1), lastYou = j2.history.filter(m => m.from === 'you').at(-1);
  ok('a message sent directly to Marketing is answered by Marketing, in French', lastYou.to === 'marketer' && lastReply.from === 'marketer' && /one-pager/.test(lastReply.text) && /\(fr\)/.test(lastReply.text) && !/^\[/.test(lastReply.text));
  ok('the live feed shows who the owner wrote to', /You → marketer/.test(fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8')));
  ok('a message to a role that does not exist is refused', (await send('hi', 'janitor')).status === 409);

  const refDir = path.join(BASE, 'company docs');
  fs.mkdirSync(refDir, { recursive: true });
  const setDirs = dirs => fetch(`${base}/api/chat/dirs`, { method: 'POST', headers: H, body: JSON.stringify({ dirs }) });
  ok('a folder that does not exist cannot be added', (await setDirs([path.join(BASE, 'nope')])).status === 400);
  ok('a real folder can be added as a readable folder', (await setDirs([refDir])).ok);
  await send('What is in our docs?'); const j3 = await idle();
  ok('the AI gets read access to that folder and is told to only read it', j3.history.at(-1).text.includes(`can read: ${refDir}`) && j3.readDirs[0] === refDir);
  await setDirs([]);

  const { splitByRole } = await import('../viewer/chat.mjs');
  const parts = splitByRole('[director]\nI give this to Marketing.\n[marketer] Here is the plan.\n- point 1\n[nobody]\nstays', 'director');
  ok('a reply with several voices is split by role', parts.length === 2 && parts[0].role === 'director' && parts[1].role === 'marketer' && /point 1/.test(parts[1].text) && /\[nobody\]/.test(parts[1].text));

  const { routingNote } = await import('../viewer/chat.mjs');
  const note = routingNote('auto', 'en', []);
  ok('the AI is told where the workspace is, so it never writes in the wrong one', note.includes(`${TMP.split(path.sep).join('/')}/org/memory.md`));

  const sess = path.join(TMP, '.session.json');
  const keep = fs.existsSync(sess) ? fs.readFileSync(sess, 'utf8') : null;
  fs.writeFileSync(sess, JSON.stringify({ engine: 'demo', demo: true }));
  ok('the chat is off in demo mode', (await send('hi')).status === 403);
  if (keep === null) fs.unlinkSync(sess); else fs.writeFileSync(sess, keep);
  const evil = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"message":"delete everything"}' });
  ok('another website cannot talk to your team', evil.status === 403);
}
{
  // Artifacts
  r = run('tools/artifact.mjs', ['prospects', '--title', 'Fichier de prospection', '--lang', 'fr', '--as', 'sales']);
  const arts = await (await fetch(`${base}/api/artifacts`)).json();
  const a1 = arts.find(a => a.title === 'Fichier de prospection');
  const page = a1 && fs.readFileSync(path.join(TMP, 'artifacts', a1.file), 'utf8');
  ok('an interactive prospecting file is built from the real leads', r.code === 0 && a1 && a1.kind === 'html' && /Acme Software/.test(page) && /Exporter en CSV/.test(page) && /acme\.example\/about/.test(page));
  const served = await fetch(`${base}/artifacts/${a1.file}`);
  ok('artifacts are served in a sandbox (no access to your data or your team)', served.ok && /sandbox/.test(served.headers.get('content-security-policy') || '') && /connect-src 'none'/.test(served.headers.get('content-security-policy') || ''));
  fs.writeFileSync(path.join(TMP, 'tmp', 'evil.html'), '<html><script src="https://evil.example/x.js"></script></html>');
  r = run('tools/artifact.mjs', ['new', '--title', 'Evil', '--file', path.join(TMP, 'tmp', 'evil.html')]);
  ok('a page loading scripts from an unknown site is refused', r.code !== 0 && /self-contained/.test(r.out));
  fs.writeFileSync(path.join(TMP, 'tmp', 'chart.html'), '<html><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><body>ok</body></html>');
  r = run('tools/artifact.mjs', ['new', '--title', 'Chart', '--file', path.join(TMP, 'tmp', 'chart.html'), '--as', 'strategist']);
  ok('a page using a known CDN is accepted', r.code === 0);
  const csv = run('tools/artifact.mjs', ['csv', '--title', 'Leads CSV']);
  ok('leads can be delivered as a CSV artifact', csv.code === 0 && fs.readdirSync(path.join(TMP, 'artifacts')).some(f => f.startsWith('leads-csv') && f.endsWith('.csv')));
  const ev2 = fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8');
  ok('each new artifact appears in the live feed (and in the chat)', (ev2.match(/"type":"artifact"/g) || []).length >= 3);
}
{
  // What the team remembers from one day to the next
  r = run('tools/memory.mjs', ['remember', 'The owner validates every message himself']);
  run('tools/memory.mjs', ['remember', 'The owner validates every message himself']);
  r = run('tools/memory.mjs', ['remember', 'Seven security controls, never nine', '--as', 'auditor']);
  const mem = fs.readFileSync(path.join(TMP, 'org', 'memory.md'), 'utf8');
  ok('the team can remember a lasting fact, without duplicates', r.code === 0 && (mem.match(/validates every message/g) || []).length === 1 && /Seven security controls/.test(mem));
  ok('a memory line stays short', run('tools/memory.mjs', ['remember', 'x'.repeat(400)]).code !== 0);
  run('tools/memory.mjs', ['forget', '1']);
  const mem2 = fs.readFileSync(path.join(TMP, 'org', 'memory.md'), 'utf8');
  ok('the owner can make the team forget a line', !/validates every message/.test(mem2) && /Seven security controls/.test(mem2));
  ok('memory is kept in the workspace, so it survives a closed conversation', fs.existsSync(path.join(TMP, 'org', 'memory.md')));
}
{
  // The team talks
  r = run('tools/say.mjs', ['--from', 'marketer', '--to', 'sales', 'Can we open on the hiring signal?']);
  const said = fs.readFileSync(path.join(TMP, 'org', 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.type === 'say').at(-1);
  ok('a role can talk to another role', r.code === 0 && said && said.role === 'marketer' && said.to === 'sales' && /hiring signal/.test(said.text));
  ok('talk from an unknown role is refused', run('tools/say.mjs', ['--from', 'janitor', '--to', 'sales', 'hi']).code !== 0);
  ok('team messages stay short', run('tools/say.mjs', ['--from', 'sales', '--to', 'team', 'x'.repeat(800)]).code !== 0);
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
