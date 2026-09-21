#!/usr/bin/env node
// Demo mode: replays a session of a FICTIONAL company so you can see the live office without any AI.
// Nothing here is real and nothing is sent. The demo lives in .demo/ and is recreated at each run.
//
// Usage: ./start --demo   or   node bin/demo.mjs [--port 4747] [--speed 1] [--no-open] [--exit]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, '.demo');
process.env.OPEN_COMPANY_WORKSPACE = DEMO; // must be set before the tools are loaded

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const port = Number(opt('port', process.env.OPEN_COMPANY_PORT || 4747));
const speed = Math.max(0.1, Number(opt('speed', 1)) || 1);

fs.rmSync(DEMO, { recursive: true, force: true });
const { init } = await import('../tools/init.mjs');
const { P, logEvent, writeText, now } = await import('../tools/lib/common.mjs');
const { addLeads } = await import('../tools/leads.mjs');
const { scoreAll } = await import('../tools/score.mjs');
const { addTask, moveTask } = await import('../tools/board.mjs');
const { writeHandoff } = await import('../tools/handoff.mjs');
const { createDraft } = await import('../tools/drafts.mjs');
const { startServer } = await import('../viewer/server.mjs');
const { openBrowser } = await import('../viewer/ensure.mjs');
const S = await import('../templates/demo/scenario.mjs');

init({ quiet: true });
fs.copyFileSync(path.join(ROOT, 'templates', 'demo', 'profile.md'), P.company);
fs.copyFileSync(path.join(ROOT, 'templates', 'demo', 'icp.md'), P.icp);
writeText(P.session, JSON.stringify({ engine: 'demo', demo: true, started: now() }));

const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const api = {
  log: (role, text) => logEvent(role, 'work', text),
  addTask: (t, r) => addTask(t, r, 'director'),
  moveTask: (t, to, as) => moveTask(t, to, as),
  account: id => {
    const file = path.join(P.accounts, `${id}.md`);
    writeText(file, S.accounts[id](day));
    logEvent('researcher', 'file', `Wrote the account file for ${id.replace(/-/g, ' ')}`, file);
  },
  addLeads: i => addLeads(S.batches(day)[i], 'researcher'),
  score: () => scoreAll({ as: 'researcher', quiet: true }),
  handoff: h => writeHandoff(h),
  draft: i => { const [id, subject, body] = S.drafts[i]; createDraft(id, { subject, body, author: 'sales' }); },
  audit: () => {
    const file = path.join(P.events, '..', '..', 'departments', 'audit', `${day(0)}-first-messages.md`);
    writeText(file, S.audit(day));
    logEvent('auditor', 'file', 'Audit report: the 3 drafts pass, one suggestion', file);
  },
};

let server;
try { server = await startServer(port); } catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy (is the company already open?). Try: ./start --demo --port 4848` : e.message);
  process.exit(1);
}
const url = `http://localhost:${port}`;
console.log(`\n● Demo (fictional company, no AI): ${url}`);
if (!opt('no-open', false)) openBrowser(url);

const t0 = Date.now();
for (const [at, step] of S.script) {
  const wait = t0 + (at * 1000) / speed - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  step(api);
}
console.log('● Replay finished. Try Approve or Reject in the Outreach tab. Ctrl+C to stop.');
if (opt('exit', false)) { server.close(); setTimeout(() => process.exit(0), 50); }
