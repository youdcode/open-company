// Chat with the Director from the live office.
// Each message runs your AI tool in this folder, in headless mode, with your own login, and
// continues the same conversation. Replies and actions stream back to the page.
// Nothing here uses an API key: it is the same tool you would use in a terminal.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
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
    ? 'The owner wrote to the company: as the Director (CEO), decide which role should handle it. If it is the job of a role, do not answer it yourself: say in one line who you are giving it to, hand it off with tools/handoff.mjs (from director to that role, 3 lines max), then let that role do the work and answer with its own [role] tag. Answer directly only for questions about the company itself or a one-line answer.'
    : to === 'director'
      ? 'The owner is talking directly to you, the CEO (director).'
      : `The owner is talking directly to the ${roleTitle(to)} (${to}): answer as that role, following roles/${to}.md (use its subagent if your tool has one). If another role is needed, hand off with tools/handoff.mjs.`;
  const language = lang === 'fr'
    ? 'Reply in French, the owner\'s language, and write the board tasks, handoffs and log lines of this request in French too.'
    : 'Reply in English.';
  const refs = dirs.length ? ` Read-only reference folders the owner gave you: ${dirs.join(', ')}. Read them when useful, never write there, and cite the file path as the source of any fact taken from them.` : '';
  const rel = path.relative(ROOT, WS).split(path.sep).join('/');
  const ws = !rel ? 'workspace' : rel.startsWith('..') ? WS : rel; // absolute when the workspace is outside the project
  const memory = ` Before answering, read ${ws}/org/memory.md and the last lines of ${ws}/org/journal.md (cheap, always). What must survive this conversation goes into files: tools/memory.mjs for a lasting fact, journal.md for a decision.`;
  const where = ws === 'workspace' ? '' : ` The workspace of this company is \`${ws}\` and not \`workspace\`: read and write the company files there (\`${ws}/company/profile.md\`, \`${ws}/org/memory.md\`, and so on). The tools already write there.`;
  const team = ' When several roles are involved, let them discuss with tools/say.mjs (short messages to each other, which the owner reads live): proposals, objections, answers, then a decision. When the owner asks for a file, a list, a table, a dashboard or a page, deliver it as an artifact with tools/artifact.mjs (skill artifact).';
  return `\n\n---\n(Sent from the Chat tab of the live office. ${route} ${language}${refs}${where}${team}${memory} Start each part of your reply with the id of the role speaking, in brackets, on its own line: [director] when you answer as the CEO, [marketer], [sales], and so on. Every delegation between roles goes through tools/handoff.mjs, so the owner sees the team talk.)`;
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

// A model id is passed to another program: keep it to the characters model names actually use.
const MODEL_OK = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,63}$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const CHAT_ENGINES = {
  claude: {
    name: 'Claude Code', bin: 'claude',
    // Reference folders are added for reading only: the allow list never lets Claude write outside workspace/.
    // Documented aliases (claude --help); the owner can also type a full model name.
    models: ['opus', 'sonnet', 'fable', 'haiku'], efforts: EFFORTS,
    args: (sid, _msg, dirs = [], o = {}) => ['-p', '--output-format', 'stream-json', '--verbose',
      ...(o.model ? ['--model', o.model] : []), ...(o.effort ? ['--effort', o.effort] : []), ...(sid ? ['--resume', sid] : []),
      ...(dirs.length ? ['--add-dir', ...dirs] : []), '--allowedTools', ...CLAUDE_TOOLS],
    parse(ev, emit) {
      if (ev.session_id) emit({ type: 'session', id: ev.session_id });
      if (ev.message?.model) emit({ type: 'model', text: ev.message.model });
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
    models: [], // Codex has no list command: the owner types the model id
    args: (sid, _msg, _dirs = [], o = {}) => ['exec', '--json', '--skip-git-repo-check', ...(o.model ? ['-m', o.model] : []),
      '-c', 'sandbox_mode=workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-c', 'web_search=live',
      ...(sid ? ['resume', sid] : []), '-'],
    parse(ev, emit) {
      if (ev.type === 'thread.started') emit({ type: 'session', id: ev.thread_id });
      if (ev.model || ev.item?.model) emit({ type: 'model', text: ev.model || ev.item.model });
      const it = ev.item || {};
      if (ev.type === 'item.completed' && it.type === 'agent_message' && it.text) emit({ type: 'text', text: it.text });
      if (ev.type === 'item.started' && it.type === 'command_execution') emit({ type: 'tool', text: short(String(it.command).replace(/^\/bin\/\w+ -lc '?|'$/g, '')) });
      if (ev.type === 'item.started' && it.type === 'web_search') emit({ type: 'tool', text: `web search ${short(it.query)}` });
      if (ev.type === 'error' || ev.type === 'turn.failed') emit({ type: 'error', text: short(ev.message || ev.error?.message || 'Codex stopped with an error') });
    },
  },
  opencode: {
    name: 'OpenCode', bin: 'opencode',
    list: ['models'], // `opencode models` prints what the account can use
    args: (sid, msg, _dirs = [], o = {}) => ['run', '--format', 'json',
      ...((o.model || process.env.OPEN_COMPANY_OPENCODE_MODEL) ? ['-m', o.model || process.env.OPEN_COMPANY_OPENCODE_MODEL] : []),
      ...(sid ? ['-s', sid] : []), msg],
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

// What the page offers in its two selectors. A tool that can list its models is asked once.
export function modelChoices(engine) {
  const E = CHAT_ENGINES[engine];
  if (!E) return { models: [], efforts: [] };
  let models = E.models || [];
  if (E.list) {
    const st = readState();
    const cached = (st.modelLists || {})[engine];
    if (cached) models = cached;
    else {
      try {
        const out = execFileSync(which(E.bin) || E.bin, E.list, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
        models = out.split('\n').map(l => l.trim()).filter(l => MODEL_OK.test(l)).slice(0, 60);
        const s2 = readState(); s2.modelLists = { ...(s2.modelLists || {}), [engine]: models }; saveState(s2);
      } catch { models = []; }
    }
  }
  return { models, efforts: E.efforts || [] };
}

// The owner picks a model (or an effort) for an engine, or clears it to use the tool's own setting.
export function setModel(engine, model, effort) {
  if (!CHAT_ENGINES[engine]) throw new Error(`unknown AI tool "${engine}"`);
  const m = String(model ?? '').trim();
  const e = String(effort ?? '').trim();
  if (m && !MODEL_OK.test(m)) throw new Error('a model name is letters, digits and . _ - / : only');
  if (e && !(CHAT_ENGINES[engine].efforts || []).includes(e)) throw new Error(`effort must be one of: ${(CHAT_ENGINES[engine].efforts || []).join(', ') || 'none for this tool'}`);
  const st = readState();
  st.picks = { ...(st.picks || {}), [engine]: { model: m, effort: e } };
  saveState(st);
  return st.picks[engine];
}

export function chatInfo() {
  const installed = installedEngines();
  const st = readState();
  let session = {};
  try { session = JSON.parse(readText(P.session, '{}')); } catch {}
  const engine = [st.engine, session.engine].find(e => e && installed.includes(e)) || installed[0] || '';
  const history = readText(HISTORY).split('\n').filter(Boolean).slice(-200).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const pick = (st.picks || {})[engine] || {};
  return { engine, model: (st.models || {})[engine] || '', pick: pick.model || '', effort: pick.effort || '', choices: modelChoices(engine), installed: installed.map(k => ({ id: k, name: CHAT_ENGINES[k].name })), history, busy: !!running, job: currentJob(), readDirs: st.readDirs || [] };
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
// The current request runs on the server, not in the page: the owner can leave the chat, reload or
// close the tab, and find the answer (or the work in progress) when coming back.
let job = null;
const listeners = new Set();
export function onChat(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function push(ev) { if (job) job.events.push(ev); for (const fn of listeners) { try { fn(ev); } catch {} } }
export const currentJob = () => (job && !job.done ? { id: job.id, to: job.to, text: job.text, started: job.started, engine: job.engine, events: job.events } : null);
export const stopChat = () => { if (running) { running.kill('SIGTERM'); return true; } return false; };

// Throws before anything starts, so the server can answer with a clear error.
export function checkChat(message, to = 'auto') {
  if (running) throw new Error('the team is still working on your previous message');
  if (!String(message || '').trim()) throw new Error('empty message');
  if (to !== 'auto' && !roleIds().includes(to)) throw new Error(`unknown role "${to}"`);
  if (!chatInfo().engine) throw new Error('no AI tool found: install Claude Code, Codex or OpenCode, then log in once in a terminal');
}

// Starts one request in the background and returns its id. Events (start, tool, text, error, done)
// go to every page subscribed with onChat().
export function sendChat(message, { to = 'auto', lang = 'en' } = {}) {
  checkChat(message, to);
  const text = String(message || '').trim();
  const { engine } = chatInfo();
  const E = CHAT_ENGINES[engine];
  const st = readState();
  const sid = st.sessions?.[engine];
  fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
  fs.appendFileSync(HISTORY, JSON.stringify({ ts: now(), from: 'you', to, text }) + '\n');
  logEvent('you', 'chat', to === 'auto' ? `You: ${short(text)}` : `You → ${to}: ${short(text)}`);
  const dirs = (st.readDirs || []).filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const prompt = text + routingNote(to, lang, dirs);

  const pick = (st.picks || {})[engine] || {};
  let argv = E.args(sid, prompt, dirs, pick);
  // On Windows the AI tools are .cmd files, which only start through the shell: quote every argument.
  const win = process.platform === 'win32';
  if (win) argv = argv.map(a => /[\s"^&|<>()%!*]/.test(a) ? `"${String(a).replace(/"/g, "'").replace(/%/g, '%%')}"` : a);
  const child = spawn(win ? E.bin : (which(E.bin) || E.bin), argv, {
    cwd: ROOT, env: { ...process.env, OPEN_COMPANY_NO_OPEN: '1' }, stdio: ['pipe', 'pipe', 'pipe'], shell: win,
  });
  running = child;
  job = { id: Date.now().toString(36), to, text, started: now(), engine, events: [], done: false };
  push({ type: 'start', id: job.id, to, text });
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
    if (ev.type === 'model') {
      const s = readState();
      if ((s.models || {})[engine] !== ev.text) { s.models = { ...(s.models || {}), [engine]: ev.text }; saveState(s); }
      push(ev);
      return;
    }
    if (ev.type === 'text') replies.push({ ts: now(), text: ev.text });
    push(ev);
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
  const finish = () => { const id = job.id; job.done = true; push({ type: 'done', id }); };
  child.on('error', e => { running = null; push({ type: 'error', text: e.message }); finish(); });
  child.on('close', code => {
    running = null;
    const reply = replies.map(r => r.text).join('\n\n').trim();
    let role = to === 'auto' ? 'director' : to;
    for (const r of replies) for (const part of splitByRole(r.text, role)) {
      fs.appendFileSync(HISTORY, JSON.stringify({ ts: r.ts, from: part.role, engine, text: part.text }) + '\n');
      role = part.role;
    }
    if (!reply && code !== 0) {
      const hint = /log ?in|auth|unauthori|credential/i.test(errText) ? `Log in once: open a terminal in this folder and run "${E.bin}".` : short(errText.split('\n').filter(Boolean).pop() || `the AI tool stopped (code ${code})`);
      push({ type: 'error', text: hint });
      fs.appendFileSync(HISTORY, JSON.stringify({ ts: now(), from: 'system', text: hint }) + '\n');
    }
    finish();
  });
  return job.id;
}
