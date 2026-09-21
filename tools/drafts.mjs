#!/usr/bin/env node
// Outreach drafts: one file per lead in workspace/prospecting/drafts/<lead-id>.md.
// Nothing is ever sent from here. A human approves in the local page (or with `set`), then
// `node tools/export.mjs` produces a CSV for whatever sending tool the human already uses.
//
// Usage:
//   node tools/drafts.mjs new <lead-id> --subject "..." [--channel email] --body "..." | --body-file path
//   node tools/drafts.mjs new <lead-id> --followup --subject "..." --body "..."     (creates <lead-id>-f1, -f2...)
//   node tools/drafts.mjs set <lead-id> approved|rejected|draft [--as you]
//   node tools/drafts.mjs list [--status approved]
import fs from 'node:fs';
import path from 'node:path';
import {
  P, readLeads, writeLeads, readText, writeText, parseFrontMatter, stringifyFrontMatter,
  logEvent, args, fail, requireWorkspace, today, now, isMain,
} from './lib/common.mjs';

export const DRAFT_STATUSES = ['draft', 'approved', 'rejected', 'exported'];
const fileOf = id => path.join(P.drafts, `${id}.md`);

export function listDrafts() {
  if (!fs.existsSync(P.drafts)) return [];
  return fs.readdirSync(P.drafts).filter(f => f.endsWith('.md')).map(f => {
    const { data, body } = parseFrontMatter(readText(path.join(P.drafts, f)));
    return { id: f.slice(0, -3), ...data, body: body.trim() };
  });
}

export function setDraftStatus(id, status, role = 'you') {
  if (!DRAFT_STATUSES.includes(status)) throw new Error(`status must be one of ${DRAFT_STATUSES.join(', ')}`);
  const file = fileOf(id);
  if (!fs.existsSync(file)) throw new Error(`no draft for "${id}"`);
  const { data, body } = parseFrontMatter(readText(file));
  data.status = status;
  data.reviewed = now();
  writeText(file, stringifyFrontMatter(data, body));
  const leads = readLeads();
  const lead = leads.find(l => l.id === (data.lead || id));
  if (lead && status === 'approved') { lead.status = 'approved'; lead.updated = today(); writeLeads(leads); }
  if (lead && status === 'rejected') { lead.next_action = 'rewrite draft'; lead.updated = today(); writeLeads(leads); }
  logEvent(role, 'review', `${status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Reopened'} the draft for ${data.company || id}`, file);
  return data;
}

function main() {
  requireWorkspace();
  const a = args();
  const [cmd, id, status] = a._;
  if (cmd === 'new') {
    if (!id || typeof a.subject !== 'string') fail('usage: new <lead-id> --subject "..." --body "..."');
    const leads = readLeads();
    const lead = leads.find(l => l.id === id);
    if (!lead) fail(`no lead with id "${id}" (add it with tools/leads.mjs first)`);
    if (lead.status === 'do_not_contact') fail(`${lead.company} asked not to be contacted`);
    let draftId = id;
    if (a.followup) {
      let k = 1;
      while (fs.existsSync(fileOf(`${id}-f${k}`))) k++;
      draftId = `${id}-f${k}`;
    } else if (fs.existsSync(fileOf(id))) {
      const prev = parseFrontMatter(readText(fileOf(id))).data.status;
      if (['approved', 'exported'].includes(prev)) fail(`the first message to ${lead.company} is already ${prev}. Use --followup for the next one.`);
    }
    let body = typeof a.body === 'string' ? a.body : '';
    if (!body && typeof a['body-file'] === 'string') body = fs.readFileSync(a['body-file'], 'utf8');
    if (!body && !process.stdin.isTTY) body = fs.readFileSync(0, 'utf8');
    if (!body.trim()) fail('empty body');
    const data = {
      lead: id, kind: a.followup ? 'followup' : 'first', company: lead.company, to: [lead.contact_name, lead.contact_role].filter(Boolean).join(', '),
      channel: typeof a.channel === 'string' ? a.channel : 'email', subject: a.subject,
      status: 'draft', author: typeof a.as === 'string' ? a.as : 'sales', created: now(),
    };
    writeText(fileOf(draftId), stringifyFrontMatter(data, body.trim() + '\n'));
    if (!a.followup) lead.status = 'drafted';
    lead.next_action = `${a.followup ? 'follow-up' : 'first message'} waiting for approval`; lead.updated = today();
    writeLeads(leads);
    logEvent(data.author, 'draft', `Drafted a ${a.followup ? 'follow-up ' : ''}${data.channel} for ${lead.company}: "${a.subject}"`, fileOf(draftId));
    return console.log(path.relative(process.cwd(), fileOf(draftId)));
  }
  if (cmd === 'set') {
    try { setDraftStatus(id, status, typeof a.as === 'string' ? a.as : 'you'); } catch (e) { fail(e.message); }
    return console.log(`${id}: ${status}`);
  }
  if (cmd === 'list' || !cmd) {
    const rows = listDrafts().filter(d => !a.status || d.status === a.status);
    if (!rows.length) return console.log('(no drafts)');
    rows.forEach(d => console.log(`${d.status.padEnd(9)} ${d.id.padEnd(30)} ${d.subject || ''}`));
    return;
  }
  fail('commands: new, set, list');
}

if (isMain(import.meta.url)) main();
