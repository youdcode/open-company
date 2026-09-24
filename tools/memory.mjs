#!/usr/bin/env node
// What the team remembers from one day to the next: the owner's preferences, standing decisions,
// things not to do again. Read at the start of every session, so nothing is lost when a
// conversation ends. Long content belongs in a file; this is one line per fact.
//
// Usage:
//   node tools/memory.mjs remember "The owner never wants a message sent without his click" [--as director]
//   node tools/memory.mjs forget 3          (drops line 3, shown by list)
//   node tools/memory.mjs list
import { P, WS, readText, writeText, logEvent, args, fail, requireWorkspace, isMain, helpIfAsked, today, withLock } from './lib/common.mjs';
import path from 'node:path';

const FILE = path.join(WS, 'org', 'memory.md');
const HEAD = /^---[\s\S]*?---\s*/;

const lines = () => readText(FILE).replace(HEAD, '').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());

function write(list, role) {
  const head = (readText(FILE).match(HEAD) || [`---\nauthor: director\nupdated: ${today()}\n---\n\n`])[0].replace(/updated:.*/, `updated: ${today()}`);
  const intro = readText(FILE).replace(HEAD, '').split('\n').filter(l => !l.startsWith('- ')).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  writeText(FILE, `${head}${intro}\n\n${list.map(l => `- ${l}`).join('\n')}\n`);
  logEvent(role, 'memory', `Memory updated (${list.length} lines)`, FILE);
}

export function remember(text, role = 'director') {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) throw new Error('empty memory');
  if (t.length > 300) throw new Error('one line per fact (300 characters max): put long content in a file');
  return withLock(FILE, () => {
    const list = lines();
    const bare = l => l.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '').toLowerCase();
    if (list.some(l => bare(l) === t.toLowerCase())) return list; // already remembered
    list.push(`${today()}: ${t}`);
    if (list.length > 60) list.splice(0, list.length - 60);
    write(list, role);
    return list;
  });
}

function main() {
  requireWorkspace();
  const a = args();
  const [cmd, ...rest] = a._;
  const role = typeof a.as === 'string' ? a.as : 'director';
  try {
    if (cmd === 'remember') { const l = remember(rest.join(' '), role); return console.log(`remembered (${l.length} lines)`); }
    if (cmd === 'forget') {
      const n = Number(rest[0]);
      withLock(FILE, () => {
        const list = lines();
        if (!(n >= 1 && n <= list.length)) fail(`give a line number between 1 and ${list.length}`);
        list.splice(n - 1, 1);
        write(list, role);
      });
      return console.log('forgotten');
    }
    if (cmd === 'list' || !cmd) {
      const list = lines();
      if (!list.length) return console.log('(nothing remembered yet)');
      list.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}. ${l}`));
      return;
    }
    fail('commands: remember, forget, list');
  } catch (e) { fail(e.message); }
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) main();
