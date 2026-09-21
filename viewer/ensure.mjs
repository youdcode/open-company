#!/usr/bin/env node
// Makes sure the live office is running, then opens it in the browser. Idempotent and fast:
// safe to call from any AI tool's "session start" hook, or by hand.
// Usage: node viewer/ensure.mjs [--no-open] [--engine claude|codex|opencode|agy]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, P, args, readText, writeText, now } from '../tools/lib/common.mjs';
import { init } from '../tools/init.mjs';

const PORT = Number(process.env.OPEN_COMPANY_PORT) || 4747;
const URL_ = `http://localhost:${PORT}`;

export async function ping() {
  try {
    const r = await fetch(`${URL_}/api/ping`, { signal: AbortSignal.timeout(600) });
    return r.ok && (await r.json()).app === 'open-company';
  } catch { return false; }
}

export function openBrowser(url) {
  if (process.env.OPEN_COMPANY_NO_OPEN) return;
  const [cmd, argv] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try { spawn(cmd, argv, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

// Records which AI opened the company, when a tool's session hook calls us directly.
function markSession(engine) {
  if (!engine) return;
  let s = {};
  try { s = JSON.parse(readText(P.session, '{}')); } catch {}
  if (s.engine === engine && !s.ended) return;
  writeText(P.session, JSON.stringify({ engine, started: now() }));
}

export async function ensure({ open = true, engine = '' } = {}) {
  init({ quiet: true });
  markSession(engine);
  if (await ping()) return { started: false, url: URL_ };
  const child = spawn(process.execPath, [path.join(ROOT, 'viewer', 'server.mjs'), '--port', String(PORT)], {
    cwd: ROOT, stdio: 'ignore', detached: true,
  });
  child.unref();
  for (let i = 0; i < 30 && !(await ping()); i++) await new Promise(r => setTimeout(r, 100));
  if (open) openBrowser(URL_);
  return { started: true, url: URL_ };
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('viewer', 'ensure.mjs'))) {
  const a = args();
  ensure({ open: !a['no-open'], engine: typeof a.engine === 'string' ? a.engine : '' }).then(r => {
    console.log(`Live office ${r.started ? 'started' : 'already running'}: ${r.url}`);
  });
}
