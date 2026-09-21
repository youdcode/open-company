#!/usr/bin/env node
// The task board: workspace/org/board.md with four columns (Todo, Doing, Review, Done).
// Usage:
//   node tools/board.mjs add "Find 20 accounts in Lyon" --role researcher
//   node tools/board.mjs move "Find 20 accounts" --to doing --as researcher
//   node tools/board.mjs show
import { P, readText, writeText, logEvent, args, fail, requireWorkspace, isMain, withLock, helpIfAsked } from './lib/common.mjs';

export const COLUMNS = ['Todo', 'Doing', 'Review', 'Done'];

export function parseBoard(md = readText(P.board)) {
  const cols = Object.fromEntries(COLUMNS.map(c => [c, []]));
  let cur = null;
  for (const line of md.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = COLUMNS.find(c => c.toLowerCase() === h[1].toLowerCase()) || null; continue; }
    const t = /^\s*-\s+\[( |x)\]\s+(.*?)\s*(?:\(@([a-z-]+)\))?\s*$/.exec(line);
    if (t && cur) cols[cur].push({ text: t[2], role: t[3] || '', done: t[1] === 'x' });
  }
  return cols;
}

export function renderBoard(cols) {
  let out = '# Board\n\nManaged by `node tools/board.mjs`. One line per task, owner in (@role).\n';
  for (const c of COLUMNS) {
    out += `\n## ${c}\n`;
    for (const t of cols[c]) out += `- [${c === 'Done' ? 'x' : ' '}] ${t.text}${t.role ? ` (@${t.role})` : ''}\n`;
  }
  return out;
}

export function addTask(text, role = '', as = 'director') {
  withLock(P.board, () => {
    const cols = parseBoard();
    cols.Todo.push({ text, role });
    writeText(P.board, renderBoard(cols));
  });
  logEvent(as, 'task', `New task${role ? ` for ${role}` : ''}: ${text}`, P.board);
}

export function moveTask(text, toName, as) {
  const to = COLUMNS.find(c => c.toLowerCase() === String(toName || '').toLowerCase());
  if (!to) throw new Error(`column must be one of ${COLUMNS.join('|').toLowerCase()}`);
  const moved = withLock(P.board, () => {
    const cols = parseBoard();
    for (const c of COLUMNS) {
      const i = cols[c].findIndex(t => t.text.toLowerCase().includes(text.toLowerCase()));
      if (i >= 0) {
        const [t] = cols[c].splice(i, 1);
        cols[to].push(t);
        writeText(P.board, renderBoard(cols));
        return t;
      }
    }
    return null;
  });
  if (!moved) throw new Error(`no task matching "${text}"`);
  logEvent(as || moved.role || 'director', 'task', `${to === 'Done' ? 'Done' : `Moved to ${to}`}: ${moved.text}`, P.board);
  return to;
}

function main() {
  requireWorkspace();
  const a = args();
  const [cmd, text] = a._;
  const cols = parseBoard();
  const as = typeof a.as === 'string' ? a.as : undefined;
  if (cmd === 'add') {
    if (!text) fail('usage: add "<task>" --role <role>');
    addTask(text, typeof a.role === 'string' ? a.role : '', as || 'director');
    return console.log('added');
  }
  if (cmd === 'move') {
    if (!text) fail(`usage: move "<part of task text>" --to ${COLUMNS.join('|').toLowerCase()}`);
    try { return console.log(`moved to ${moveTask(text, a.to, as)}`); } catch (e) { fail(e.message); }
  }
  if (cmd === 'show' || !cmd) {
    for (const c of COLUMNS) { console.log(`${c} (${cols[c].length})`); cols[c].forEach(t => console.log(`  - ${t.text}${t.role ? ` @${t.role}` : ''}`)); }
    return;
  }
  fail('commands: add, move, show');
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) main();
