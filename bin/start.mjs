#!/usr/bin/env node
// One command to open the company: prepares the workspace, opens the live office in the browser,
// then launches the AI tool you already use (logged in with your own subscription) in this folder.
//
// Usage: ./start [claude|codex|opencode|agy] [--viewer-only] [--no-open] [--port 4747]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { ROOT, P, WS, args, logEvent, writeText, readText, now } from '../tools/lib/common.mjs';
import { init } from '../tools/init.mjs';
import { startServer } from '../viewer/server.mjs';
import { ping, openBrowser } from '../viewer/ensure.mjs';

const ENGINES = {
  claude: { bin: 'claude', name: 'Claude Code', args: p => [p], install: 'npm install -g @anthropic-ai/claude-code   (log in with your Claude plan)' },
  codex: { bin: 'codex', name: 'Codex (ChatGPT)', args: p => [p], install: 'npm install -g @openai/codex   (choose "Sign in with ChatGPT")' },
  opencode: { bin: 'opencode', name: 'OpenCode (DeepSeek, local models, others)', args: p => ['--prompt', p], install: 'see https://opencode.ai  (connect DeepSeek with an API key, or other providers)' },
  agy: { bin: 'agy', name: 'Antigravity CLI (Gemini)', args: () => [], hint: 'Type "start" once it opens.', install: 'see https://antigravity.google  (sign in with your Google account)' },
};

const c = { b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m` };

function which(bin) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext.toLowerCase());
      const P2 = path.join(dir, bin + ext);
      if (fs.existsSync(p)) return p;
      if (fs.existsSync(P2)) return P2;
    }
  }
  return null;
}

async function pickEngine(requested) {
  const installed = Object.keys(ENGINES).filter(k => which(ENGINES[k].bin));
  if (requested) {
    if (!ENGINES[requested]) throw new Error(`unknown AI "${requested}". Choose one of: ${Object.keys(ENGINES).join(', ')}`);
    if (!installed.includes(requested)) throw new Error(`${ENGINES[requested].name} is not installed. Install: ${ENGINES[requested].install}`);
    return requested;
  }
  if (!installed.length) return null;
  const saved = readText(path.join(WS, '.engine')).trim();
  if (installed.length === 1) return installed[0];
  if (saved && installed.includes(saved) && !process.stdin.isTTY) return saved;
  console.log(c.b('\nWhich AI should run your company?'));
  installed.forEach((k, i) => console.log(`  ${i + 1}. ${ENGINES[k].name}${k === saved ? c.d('  (last used)') : ''}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const def = Math.max(1, installed.indexOf(saved) + 1);
  const answer = (await rl.question(`Choose 1-${installed.length} [${def}]: `)).trim();
  rl.close();
  const n = Number(answer || def);
  return installed[n - 1] || installed[def - 1];
}

async function main() {
  const a = args();
  const port = Number(a.port) || Number(process.env.OPEN_COMPANY_PORT) || 4747;
  process.env.OPEN_COMPANY_PORT = String(port);
  const url = `http://localhost:${port}`;

  init({ quiet: true });
  const tmp = path.join(WS, 'tmp');
  for (const f of fs.existsSync(tmp) ? fs.readdirSync(tmp) : []) if (f !== '.gitkeep') fs.rmSync(path.join(tmp, f), { recursive: true, force: true });

  let engine = null;
  if (!a['viewer-only']) {
    try { engine = await pickEngine(a._[0]); } catch (e) { console.error(`\n${e.message}\n`); process.exit(1); }
    if (!engine) {
      console.log(c.b('\nNo supported AI tool found on this computer. Install one of these, then run ./start again:\n'));
      for (const k of Object.keys(ENGINES)) console.log(`  ${ENGINES[k].name.padEnd(42)} ${ENGINES[k].install}`);
      console.log(c.d('\nOr open the live office alone with: ./start --viewer-only\n'));
      process.exit(1);
    }
  }

  // Live office: reuse it if it already runs, otherwise serve it from this process.
  let server = null;
  if (!(await ping())) {
    try { server = await startServer(port); } catch (e) {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} is used by another program. Try: ./start --port 4848` : e.message);
      process.exit(1);
    }
  }
  if (!a['no-open']) openBrowser(url);

  if (!engine) {
    console.log(`${c.g('●')} Live office: ${c.b(url)}  ${c.d('(Ctrl+C to stop)')}`);
    return;
  }

  const E = ENGINES[engine];
  writeText(path.join(WS, '.engine'), engine);
  writeText(P.session, JSON.stringify({ engine, started: now() }));
  logEvent('director', 'system', `Company opened with ${E.name}`);
  console.log(`\n${c.g('●')} Live office: ${c.b(url)}`);
  console.log(`${c.g('●')} Starting ${c.b(E.name)}${E.hint ? `. ${E.hint}` : ''}\n`);

  const child = spawn(which(E.bin), E.args('start'), {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, OPEN_COMPANY_ENGINE: engine },
    shell: process.platform === 'win32',
  });
  process.on('SIGINT', () => {}); // the AI tool handles Ctrl+C itself
  child.on('exit', code => {
    try {
      const s = JSON.parse(readText(P.session, '{}'));
      writeText(P.session, JSON.stringify({ ...s, ended: now() }));
    } catch {}
    logEvent('director', 'system', `${E.name} session closed`);
    if (server) server.close();
    console.log(c.d('\nThe company is saved in workspace/. Run ./start to continue.'));
    process.exit(code ?? 0);
  });
}

main();
