#!/usr/bin/env node
// Team talk: one role speaks to another (or to the whole team) in a few lines. The owner reads it
// live in the Chat tab. Use it to discuss: propose, disagree, ask, answer, decide. 4 lines max.
// Usage: node tools/say.mjs --from marketer --to sales "Your angle is too generic, can we open on the hiring signal?"
//        node tools/say.mjs --from director --to team "Meeting: how do we attack clinics? Strategist first."
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, args, fail, requireWorkspace, logEvent, isMain, helpIfAsked } from './lib/common.mjs';

const roles = () => { try { return fs.readdirSync(path.join(ROOT, 'roles')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)); } catch { return []; } };

export function say(from, to, text) {
  const ids = roles();
  if (!ids.includes(from)) throw new Error(`unknown role "${from}". Roles: ${ids.join(', ')}`);
  if (to !== 'team' && to !== 'you' && !ids.includes(to)) throw new Error(`unknown recipient "${to}". Use a role, "team" or "you"`);
  const t = String(text || '').trim();
  if (!t) throw new Error('empty message');
  if (t.split('\n').length > 6 || t.length > 700) throw new Error('team messages are short (4 lines, 700 characters max): put long content in a file');
  logEvent(from, 'say', t, '', { to });
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) {
  requireWorkspace();
  const a = args();
  if (typeof a.from !== 'string' || typeof a.to !== 'string') fail('usage: node tools/say.mjs --from <role> --to <role|team|you> "message"');
  try { say(a.from, a.to, a._.join(' ')); console.log('said'); } catch (e) { fail(e.message); }
}
