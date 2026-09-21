#!/usr/bin/env node
// A handoff is how one role passes work to another: a short message file in workspace/org/messages/.
// Keep it short (5 lines max) and point to the file, never paste the whole document.
// Usage: node tools/handoff.mjs --from researcher --to sales --subject "12 accounts ready" \
//          --body "Top 5 are hot, see leads.csv" [--link workspace/prospecting/leads.csv]
import path from 'node:path';
import { P, args, fail, requireWorkspace, stringifyFrontMatter, writeText, logEvent, slugify, now } from './lib/common.mjs';

requireWorkspace();
const a = args();
for (const k of ['from', 'to', 'subject']) if (typeof a[k] !== 'string') fail(`--${k} is required`);
const body = typeof a.body === 'string' ? a.body : '';
if (body.split('\n').length > 8) fail('a handoff is 5 lines max: link to a file instead of pasting it');
const stamp = now().slice(0, 16).replace(/[-:T]/g, '');
const file = path.join(P.messages, `${stamp}-${a.from}-to-${a.to}-${slugify(a.subject).slice(0, 30)}.md`);
const data = { from: a.from, to: a.to, subject: a.subject, created: now(), link: typeof a.link === 'string' ? a.link : '' };
writeText(file, stringifyFrontMatter(data, body + '\n'));
logEvent(a.from, 'handoff', `→ ${a.to}: ${a.subject}`, file);
console.log(path.relative(process.cwd(), file));
