// Chat with the Director from the live office.
// Each message runs your AI tool in this folder, in headless mode, with your own login, and
// continues the same conversation. Replies and actions stream back to the page.
// Nothing here uses an API key: it is the same tool you would use in a terminal.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

// The roles of the company (roles/*.md), used to route a chat message to one of them.
export function roleIds() {
  try { return fs.readdirSync(path.join(ROOT, 'roles')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)); } catch { return ['director']; }
}
function roleTitle(id) {
  const m = /^title:\s*(.+)$/m.exec(readText(path.join(ROOT, 'roles', `${id}.md`)));
  return m ? m[1].trim() : id;
}

// What the AI receives in addition to the owner's words: who should answer, in which language,
// and how to show which role is speaking and how they hand work to each other.
export function routingNote(to = 'auto', lang = 'en', dirs = []) {
  const route = to === 'auto'
    ? 'The owner wrote to the company: as the Director (CEO), decide which role should handle it. If it is work for a role, hand it off with tools/handoff.mjs (from director to that role, 3 lines max) and let that role do the work and answer.'
    : to === 'director'
      ? 'The owner is talking directly to you, the CEO (director).'
      : `The owner is talking directly to the ${roleTitle(to)} (${to}): answer as that role, following roles/${to}.md (use its subagent if your tool has one). If another role is needed, hand off with tools/handoff.mjs.`;
  const language = lang === 'fr'
    ? 'Reply in French, the owner\'s language, and write the board tasks, handoffs and log lines of this request in French too.'
    : 'Reply in English.';
  const refs = dirs.length ? ` Read-only reference folders the owner gave you: ${dirs.join(', ')}. Read them when useful, never write there, and cite the file path as the source of any fact taken from them.` : '';
  return `\n\n---\n(Sent from the Chat tab of the live office. ${route} ${language}${refs} Start each part of your reply with the id of the role speaking, in brackets, on its own line: [director] when you answer as the CEO, [marketer], [sales], and so on. Every delegation between roles goes through tools/handoff.mjs, so the owner sees the team talk.)`;
}

// "[marketer]\nHello\n[director]\nDone" -> [{role: 'marketer', text: 'Hello'}, {role: 'director', text: 'Done'}]
export function splitByRole(text, fallback = 'director') {
  const ids = roleIds();
  const parts = [];
  let role = fallback, buf = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) parts.push({ role, text: t }); buf = []; };
  for (const line of String(text).split('\n')) {
    const m = /^\s*\[([a-z-]+)\][ \t]*(.*)$/.exec(line);
    if (m && ids.includes(m[1])) { flush(); role = m[1]; if (m[2].trim()) buf.push(m[2]); } else buf.push(line);
  }
  flush();
  return parts;
}

export const CHAT_ENGINES = {
  claude: {
    name: 'Claude Code', bin: 'claude',
    // Reference folders are added for reading only: the allow list never lets Claude write outside workspace/.
    args: (sid, _msg, dirs = []) => ['-p', '--output-format', 'stream-json', '--verbose', ...(sid ? ['--resume', sid] : []),
      ...(dirs.length ? ['--add-dir', ...dirs] : []), '--allowedTools', ...CLAUDE_TOOLS],
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
  return { engine, installed: installed.map(k => ({ id: k, name: CHAT_ENGINES[k].name })), history, busy: !!running, readDirs: st.readDirs || [] };
}

// Folders the team may READ (never write): for example the documents of your company.
export function setReadDirs(list) {
  const dirs = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, 10)) {
    const p = path.resolve(String(raw || '').trim().replace(/^~(?=$|[\\/])/, os.homedir()));
    if (!String(raw || '').trim()) continue;
    let ok = false;
    try { ok = fs.statSync(p).isDirectory(); } catch {}
    if (!ok) throw new Error(`not a folder on this computer: ${raw}`);
    if (!dirs.includes(p)) dirs.push(p);
  }
  saveState({ ...readState(), readDirs: dirs });
  return dirs;
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
// Throws before anything starts, so the server can answer with a clear error.
export function checkChat(message, to = 'auto') {
  if (running) throw new Error('the team is still working on your previous message');
  if (!String(message || '').trim()) throw new Error('empty message');
  if (to !== 'auto' && !roleIds().includes(to)) throw new Error(`unknown role "${to}"`);
  if (!chatInfo().engine) throw new Error('no AI tool found: install Claude Code, Codex or OpenCode, then log in once in a terminal');
}

export function sendChat(message, emit, { to = 'auto', lang = 'en' } = {}) {
  checkChat(message, to);
  const text = String(message || '').trim();
  const { engine } = chatInfo();
  if (!engine) throw new Error('no AI tool found: install Claude Code, Codex or OpenCode, then log in once in a terminal');
  const E = CHAT_ENGINES[engine];
  const st = readState();
  const sid = st.sessions?.[engine];
  fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
  fs.appendFileSync(HISTORY, JSON.stringify({ ts: now(), from: 'you', to, text }) + '\n');
  logEvent('you', 'chat', to === 'auto' ? `You: ${short(text)}` : `You → ${to}: ${short(text)}`);
  const dirs = (st.readDirs || []).filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const prompt = text + routingNote(to, lang, dirs);

  let argv = E.args(sid, prompt, dirs);
  // On Windows the AI tools are .cmd files, which only start through the shell: quote every argument.
  const win = process.platform === 'win32';
  if (win) argv = argv.map(a => /[\s"^&|<>()%!*]/.test(a) ? `"${String(a).replace(/"/g, "'").replace(/%/g, '%%')}"` : a);
  const child = spawn(win ? E.bin : (which(E.bin) || E.bin), argv, {
    cwd: ROOT, env: { ...process.env, OPEN_COMPANY_NO_OPEN: '1' }, stdio: ['pipe', 'pipe', 'pipe'], shell: win,
  });
  running = child;
  if (!E.promptAsArg) child.stdin.end(prompt); else child.stdin.end();

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
    for (const part of reply ? splitByRole(reply, to === 'auto' ? 'director' : to) : [])
      fs.appendFileSync(HISTORY, JSON.stringify({ ts: now(), from: part.role, engine, text: part.text }) + '\n');
    if (!reply && code !== 0) {
      const hint = /log ?in|auth|unauthori|credential/i.test(errText) ? `Log in once: open a terminal in this folder and run "${E.bin}".` : short(errText.split('\n').filter(Boolean).pop() || `the AI tool stopped (code ${code})`);
      emit({ type: 'error', text: hint });
    }
    emit({ type: 'done' });
  });
  return engine;
}
