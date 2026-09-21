#!/usr/bin/env node
// A handoff is how one role passes work to another: a short message file in workspace/org/messages/.
// Keep it short (5 lines max) and point to the file, never paste the whole document.
// Usage: node tools/handoff.mjs --from researcher --to sales --subject "12 accounts ready" \
//          --body "Top 5 are hot, see leads.csv" [--link workspace/prospecting/leads.csv]
import path from 'node:path';
import { P, args, fail, requireWorkspace, stringifyFrontMatter, writeText, logEvent, slugify, now, isMain, helpIfAsked } from './lib/common.mjs';

export function writeHandoff({ from, to, subject, body = '', link = '' }) {
  if (!from || !to || !subject) throw new Error('from, to and subject are required');
  if (body.split('\n').length > 8) throw new Error('a handoff is 5 lines max: link to a file instead of pasting it');
  const stamp = now().slice(0, 19).replace(/[-:T]/g, '');
  const file = path.join(P.messages, `${stamp}-${from}-to-${to}-${slugify(subject).slice(0, 30)}.md`);
  writeText(file, stringifyFrontMatter({ from, to, subject, created: now(), link }, body + '\n'));
  logEvent(from, 'handoff', `→ ${to}: ${subject}`, file);
  return file;
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) {
  requireWorkspace();
  const a = args();
  for (const k of ['from', 'to', 'subject']) if (typeof a[k] !== 'string') fail(`--${k} is required`);
  try {
    const file = writeHandoff({ from: a.from, to: a.to, subject: a.subject, body: typeof a.body === 'string' ? a.body : '', link: typeof a.link === 'string' ? a.link : '' });
    console.log(path.relative(process.cwd(), file));
  } catch (e) { fail(e.message); }
}
