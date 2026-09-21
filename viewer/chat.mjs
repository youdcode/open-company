// Chat with the Director from the live office.
// Each message runs your AI tool in this folder, in headless mode, with your own login, and
// continues the same conversation. Replies and actions stream back to the page.
// Nothing here uses an API key: it is the same tool you would use in a terminal.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, WS, P, readText, writeText, logEvent, now } from '../tools/lib/common.mjs';

const STATE = path.join(WS, '.chat.json');
const HISTORY = path.join(WS, 'org', 'chat.jsonl');
const abs = ROOT.split(path.sep).join('/');

// Claude Code in headless mode ignores the project's permissions until the folder is trusted,
// so the same allow list is passed explicitly.
const CLAUDE_TOOLS = [
  'Edit(workspace/**)', 'Edit(/workspace/**)', 'Write(workspace/**)', 'WebSearch', 'WebFetch',
  'Bash(node tools/*)', 'Bash(node viewer/*)', `Bash(node ${abs}/tools/*)`, `Bash(node ${abs}/viewer/*)`,
];

const short = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 140);

export const CHAT_ENGINES = {
  claude: {
    name: 'Claude Code', bin: 'claude',
    args: sid => ['-p', '--output-format', 'stream-json', '--verbose', ...(sid ? ['--resume', sid] : []), '--allowedTools', ...CLAUDE_TOOLS],
    parse(ev, emit) {
      if (ev.session_id) emit({ type: 'session', id: ev.session_id });
      if (ev.type === 'assistant') for (const c of ev.message?.content || []) {
        if (c.type === 'text' && c.text.trim()) emit({ type: 'text', text: c.text });
        if (c.type === 'tool_use') emit({ type: 'tool', text: c.name === 'Bash' ? short(c.input?.command) : `${c.name} ${short(c.input?.file_path || c.input?.query || c.input?.url || c.input?.description || '')}` });
      }
      if (ev.type === 'result' && ev.is_error) emit({ type: 'error', text: short(ev.result || 'the AI tool stopped with an error') });
    },
  },
  codex: {
    name: 'Codex', bin: 'codex',
    // Values that are not valid TOML are read as plain strings by Codex, so no inner quotes are needed.
    args: sid => ['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=workspace-write',
      '-c', 'sandbox_workspace_write.network_access=true', '-c', 'web_search=live', ...(sid ? ['resume', sid] : []), '-'],
    parse(ev, emit) {
      if (ev.type === 'thread.started') emit({ type: 'session', id: ev.thread_id });
      const it = ev.item || {};
      if (ev.type === 'item.completed' && it.type === 'agent_message' && it.text) emit({ type: 'text', text: it.text });
      if (ev.type === 'item.started' && it.type === 'command_execution') emit({ type: 'tool', text: short(String(it.command).replace(/^\/bin\/\w+ -lc '?|'$/g, '')) });
      if (ev.type === 'item.started' && it.type === 'web_search') emit({ type: 'tool', text: `web search ${short(it.query)}` });
      if (ev.type === 'error' || ev.type === 'turn.failed') emit({ type: 'error', text: short(ev.message || ev.error?.message || 'Codex stopped with an error') });
    },
  },
  opencode: {
    name: 'OpenCode', bin: 'opencode',
    args: (sid, msg) => ['run', '--format', 'json', ...(process.env.OPEN_COMPANY_OPENCODE_MODEL ? ['-m', process.env.OPEN_COMPANY_OPENCODE_MODEL] : []), ...(sid ? ['-s', sid] : []), msg],
    promptAsArg: true,
    parse(ev, emit) {
      if (ev.sessionID) emit({ type: 'session', id: ev.sessionID });
      const p = ev.part || {};
      if (ev.type === 'text' && p.text?.trim()) emit({ type: 'text', text: p.text });
      if (p.type === 'tool') emit({ type: 'tool', text: `${p.tool} ${short(p.state?.input?.command || p.state?.input?.filePath || '')}` });
      if (ev.type === 'error') emit({ type: 'error', text: short(ev.error?.data?.message || ev.error?.name || 'OpenCode stopped with an error') });
    },
  },
};

function which(bin) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter))
    for (const e of exts) { const p = path.join(dir, bin + e); if (fs.existsSync(p)) return p; }
  return null;
}

export const installedEngines = () => Object.keys(CHAT_ENGINES).filter(k => which(CHAT_ENGINES[k].bin));

function readState() { try { return JSON.parse(readText(STATE, '{}')); } catch { return {}; } }
function saveState(s) { writeText(STATE, JSON.stringify(s, null, 2)); }

export function chatInfo() {
  const installed = installedEngines();
  const st = readState();
  let session = {};
  try { session = JSON.parse(readText(P.session, '{}')); } catch {}
  const engine = [st.engine, session.engine].find(e => e && installed.includes(e)) || installed[0] || '';
  const history = readText(HISTORY).split('\n').filter(Boolean).slice(-200).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { engine, installed: installed.map(k => ({ id: k, name: CHAT_ENGINES[k].name })), history, busy: !!running };
}

export function setEngine(engine) {
  if (!installedEngines().includes(engine)) throw new Error(`${engine} is not installed`);
  saveState({ ...readState(), engine });
}

export function newConversation() {
  const st = readState();
  delete st.sessions;
  saveState(st);
  fs.appendFileSync(HISTORY, JSON.stringify({ ts: now(), from: 'system', text: 'New conversation' }) + '\n');
}

let running = null;
export const stopChat = () => { if (running) { running.kill('SIGTERM'); return true; } return false; };

// Runs one message. `emit` receives {type: text|tool|error|done, text}.
export function sendChat(message, emit) {
  if (running) throw new Error('the Director is still working on your previous message');
  const text = String(message || '').trim();
  if (!text) throw new Error('empty message');
  const { engine } = chatInfo();
  if (!engine) throw new Error('no AI tool found: install Claude Code, Codex or OpenCode, then log in once in a terminal');
  const E = CHAT_ENGINES[engine];
  const st = readState();
  const sid = st.sessions?.[engine];
  fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
  fs.appendFileSync(HISTORY, JSON.stringify({ ts: now(), from: 'you', text }) + '\n');
  logEvent('you', 'chat', `You: ${short(text)}`);

  let argv = E.promptAsArg ? E.args(sid, text) : E.args(sid);
  // On Windows the AI tools are .cmd files, which only start through the shell: quote every argument.
  const win = process.platform === 'win32';
  if (win) argv = argv.map(a => /[\s"^&|<>()%!*]/.test(a) ? `"${String(a).replace(/"/g, "'").replace(/%/g, '%%')}"` : a);
  const child = spawn(win ? E.bin : (which(E.bin) || E.bin), argv, {
    cwd: ROOT, env: { ...process.env, OPEN_COMPANY_NO_OPEN: '1' }, stdio: ['pipe', 'pipe', 'pipe'], shell: win,
  });
  running = child;
  if (!E.promptAsArg) child.stdin.end(text); else child.stdin.end();

  const replies = [];
  let buf = '', errText = '';
  const onEvent = ev => {
    if (ev.type === 'session') {
      const s = readState();
      s.sessions = { ...(s.sessions || {}), [engine]: ev.id };
      saveState(s);
      return;
    }
    if (ev.type === 'text') replies.push(ev.text);
    emit(ev);
  };
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try { E.parse(JSON.parse(line), onEvent); } catch {}
    }
  });
  child.stderr.on('data', d => { errText += d; });
  child.on('error', e => { running = null; emit({ type: 'error', text: e.message }); emit({ type: 'done' }); });
  child.on('close', code => {
    running = null;
    const reply = replies.join('\n\n').trim();
    if (reply) fs.appendFileSync(HISTORY, JSON.stringify({ ts: now(), from: 'director', engine, text: reply }) + '\n');
    if (!reply && code !== 0) {
      const hint = /log ?in|auth|unauthori|credential/i.test(errText) ? `Log in once: open a terminal in this folder and run "${E.bin}".` : short(errText.split('\n').filter(Boolean).pop() || `the AI tool stopped (code ${code})`);
      emit({ type: 'error', text: hint });
    }
    emit({ type: 'done' });
  });
  return engine;
}
