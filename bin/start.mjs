#!/usr/bin/env node
// One command to open the company: prepares the workspace, opens the live office in the browser,
// then launches the AI tool you already use (logged in with your own subscription) in this folder.
//
// Default: the live office opens in your browser and you talk to the Director in its Chat tab.
// --terminal: the AI tool runs in this terminal instead (the page still shows everything).
// Usage: ./start [claude|codex|opencode|agy] [--terminal] [--viewer-only] [--demo] [--doctor] [--no-open] [--port 4747]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { ROOT, P, WS, args, logEvent, writeText, readText, now, writeClaudeLocalSettings } from '../tools/lib/common.mjs';
import { init } from '../tools/init.mjs';
import { startServer } from '../viewer/server.mjs';
import { ping, openBrowser } from '../viewer/ensure.mjs';

const ENGINES = {
  claude: { bin: 'claude', name: 'Claude Code', args: p => [p], install: 'npm install -g @anthropic-ai/claude-code   (log in with your Claude plan)' },
  codex: { bin: 'codex', name: 'Codex (ChatGPT)', args: p => [p], install: 'npm install -g @openai/codex   (choose "Sign in with ChatGPT")' },
  opencode: { bin: 'opencode', name: 'OpenCode (DeepSeek, local models, others)', args: p => ['--prompt', p], install: 'see https://opencode.ai  (connect DeepSeek with an API key, or other providers)' },
  agy: { bin: 'agy', name: 'Antigravity CLI (Gemini)', args: () => [], hint: 'Type "start" once it opens.', install: 'see https://antigravity.google  (sign in with your Google account)' },
};

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = tty
  ? { b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m` }
  : { b: s => s, d: s => s, g: s => s };

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

const portState = port => new Promise(res => {
  const s = net.createServer().once('error', () => res('busy')).once('listening', () => s.close(() => res('free')));
  s.listen(port, '127.0.0.1');
});

// ./start --doctor: checks the setup without launching anything.
async function doctor(port) {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = (good, text) => console.log(`  ${good ? c.g('✓') : '✗'} ${text}`);
  console.log(c.b('\nOpen Company doctor\n'));
  ok(major >= 20, `Node.js ${process.versions.node}${major >= 20 ? '' : ' (version 20 or newer is required: https://nodejs.org)'}`);
  ok(true, `System: ${process.platform} ${process.arch}`);
  const found = Object.keys(ENGINES).filter(k => which(ENGINES[k].bin));
  ok(found.length > 0, found.length ? `AI tools found: ${found.map(k => ENGINES[k].name).join(', ')}` : 'No AI tool found yet (./start will tell you how to install one)');
  const profile = readText(P.company);
  ok(true, fs.existsSync(WS) ? `Workspace: ${/setup:\s*done/.test(profile) ? 'company set up' : 'created, setup not done yet'}` : 'Workspace: will be created on the first ./start');
  const st = await portState(port);
  const ours = st === 'busy' && await ping();
  ok(st === 'free' || ours, st === 'free' ? `Port ${port} is free for the live office` : ours ? `The live office already runs on port ${port}` : `Port ${port} is used by another program (use --port 4848)`);
  console.log('');
  process.exit(major >= 20 ? 0 : 1);
}

async function main() {
  const a = args();
  if (a.doctor) return doctor(Number(a.port) || Number(process.env.OPEN_COMPANY_PORT) || 4747);
  if (a.demo) {
    const rest = process.argv.slice(2).filter(x => x !== '--demo');
    const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'demo.mjs'), ...rest], { stdio: 'inherit' });
    process.on('SIGINT', () => {});
    child.on('exit', code => process.exit(code ?? 0));
    return;
  }
  const port = Number(a.port) || Number(process.env.OPEN_COMPANY_PORT) || 4747;
  process.env.OPEN_COMPANY_PORT = String(port);
  const url = `http://localhost:${port}`;

  init({ quiet: true });
  const tmp = path.join(WS, 'tmp');
  for (const f of fs.existsSync(tmp) ? fs.readdirSync(tmp) : []) if (f !== '.gitkeep') fs.rmSync(path.join(tmp, f), { recursive: true, force: true });

  let engine = null;
  const web = !a.terminal && !a['viewer-only'];
  if (web) {
    // Browser mode: no question here, the AI can be switched in the Chat tab.
    const installed = Object.keys(ENGINES).filter(k => k !== 'agy' && which(ENGINES[k].bin));
    const saved = readText(path.join(WS, '.engine')).trim();
    if (a._[0] && !installed.includes(a._[0])) { console.error(`\n${a._[0]} is not installed or has no chat support yet.\n`); process.exit(1); }
    engine = a._[0] || (installed.includes(saved) ? saved : installed[0]) || null;
    if (!engine) {
      console.log(c.b('\nNo supported AI tool found on this computer. Install one of these, log in once in a terminal, then run ./start again:\n'));
      for (const k of ['claude', 'codex', 'opencode']) console.log(`  ${ENGINES[k].name.padEnd(42)} ${ENGINES[k].install}`);
      console.log(c.d('\nOr see the demo with: ./start --demo\n'));
      process.exit(1);
    }
  } else if (!a['viewer-only']) {
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
  const running = await ping();
  const current = (() => { try { return JSON.parse(readText(path.join(ROOT, 'package.json'))).version; } catch { return ''; } })();
  if (running && running.version !== current) {
    console.error(`\nAn older live office (version ${running.version || 'unknown'}) is still running on port ${port}.\nClose its window (or the terminal where it runs), then run ./start again. Or use another port: ./start --port 4848\n`);
    process.exit(1);
  }
  if (!running) {
    try { server = await startServer(port); } catch (e) {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} is used by another program. Try: ./start --port 4848` : e.message);
      process.exit(1);
    }
  }
  if (web) {
    if (engine === 'claude') writeClaudeLocalSettings();
    writeText(path.join(WS, '.engine'), engine);
    writeText(path.join(WS, '.chat.json'), JSON.stringify({ ...(() => { try { return JSON.parse(readText(path.join(WS, '.chat.json'), '{}')); } catch { return {}; } })(), engine }, null, 2));
    writeText(P.session, JSON.stringify({ engine, started: now(), web: true }));
    logEvent('director', 'system', `Company opened in the browser with ${ENGINES[engine].name}`);
    if (!a['no-open']) openBrowser(`${url}/#chat`);
    console.log(`\n${c.g('●')} Your company is open: ${c.b(`${url}/#chat`)}`);
    console.log(`${c.g('●')} Talk to the Director in the Chat tab (AI: ${ENGINES[engine].name}, switch it in the page).`);
    console.log(c.d('  Keep this window open while you work. Ctrl+C to close the company.\n'));
    return;
  }
  if (!a['no-open']) openBrowser(url);

  if (!engine) {
    console.log(`${c.g('●')} Live office: ${c.b(url)}  ${c.d('(Ctrl+C to stop)')}`);
    return;
  }

  const E = ENGINES[engine];
  if (engine === 'claude') writeClaudeLocalSettings();
  writeText(path.join(WS, '.engine'), engine);
  writeText(P.session, JSON.stringify({ engine, started: now() }));
  logEvent('director', 'system', `Company opened with ${E.name}`);
  console.log(`\n${c.g('●')} Live office: ${c.b(url)}`);
  console.log(`${c.g('●')} Starting ${c.b(E.name)}${E.hint ? `. ${E.hint}` : ''}\n`);

  const env = { ...process.env, OPEN_COMPANY_ENGINE: engine };
  // On Windows the tools are .cmd shims that need a shell; a full path with spaces would break it.
  const child = process.platform === 'win32'
    ? spawn(E.bin, E.args('start'), { cwd: ROOT, stdio: 'inherit', env, shell: true })
    : spawn(which(E.bin), E.args('start'), { cwd: ROOT, stdio: 'inherit', env });
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
