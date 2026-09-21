#!/usr/bin/env node
// Exports APPROVED drafts to a CSV you can import into your own email tool or mail merge.
// This project never sends anything by itself.
// Usage: node tools/export.mjs
import path from 'node:path';
import {
  P, readLeads, writeLeads, toCSV, writeText, readText, parseFrontMatter, stringifyFrontMatter,
  logEvent, requireWorkspace, today, now,
} from './lib/common.mjs';
import { listDrafts } from './drafts.mjs';

requireWorkspace();
const approved = listDrafts().filter(d => d.status === 'approved');
if (!approved.length) { console.log('nothing to export: approve drafts first (local page or tools/drafts.mjs set <id> approved)'); process.exit(0); }

const leads = readLeads();
const rows = approved.map(d => {
  const l = leads.find(x => x.id === (d.lead || d.id)) || {};
  return { company: l.company || d.company, contact_name: l.contact_name, contact_role: l.contact_role, channel: d.channel, contact: l.contact_channel, subject: d.subject, body: d.body };
});
const file = path.join(P.exports, `outreach-${today()}.csv`);
writeText(file, toCSV(rows, ['company', 'contact_name', 'contact_role', 'channel', 'contact', 'subject', 'body']));

for (const d of approved) {
  const f = path.join(P.drafts, `${d.id}.md`);
  const { data, body } = parseFrontMatter(readText(f));
  data.status = 'exported'; data.exported = now();
  writeText(f, stringifyFrontMatter(data, body));
  const l = leads.find(x => x.id === (d.lead || d.id));
  if (l) { l.next_action = `send (exported ${today()}), then set status=contacted`; l.updated = today(); }
}
writeLeads(leads);
logEvent('sales', 'export', `Exported ${rows.length} approved message${rows.length > 1 ? 's' : ''} for sending`, file);
console.log(`${rows.length} messages exported to ${path.relative(process.cwd(), file)}`);
