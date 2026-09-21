#!/usr/bin/env node
// Replies from prospects, without giving anyone your mailbox password: drag the reply emails
// (.eml files, "Save as" or drag-and-drop from Apple Mail, Outlook, Thunderbird, Gmail "Download
// message") into workspace/prospecting/inbox/, then run this script (or type "replies").
//   - each reply is matched to a lead (exact email first, then the company's domain)
//   - the lead becomes "replied", the reply is added to its account file
//   - a reply asking not to be contacted again marks the lead "do_not_contact" (final)
//   - processed files move to inbox/processed/, unmatched ones stay where they are
// Usage: node tools/replies.mjs [--as sales]
import fs from 'node:fs';
import path from 'node:path';
import { WS, P, readLeads, readText, writeText, logEvent, args, requireWorkspace, isMain, today, helpIfAsked } from './lib/common.mjs';
import { updateLead } from './leads.mjs';

export const INBOX = path.join(WS, 'prospecting', 'inbox');

// ---------- minimal MIME reading ----------
const decodeWord = s => s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
  const bytes = /b/i.test(enc) ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  return decodeBytes(bytes, cs);
});

function decodeBytes(buf, charset = 'utf-8') {
  try { return new TextDecoder(String(charset).toLowerCase().replace(/^iso-8859-1$/, 'latin1')).decode(buf); } catch { return buf.toString('utf8'); }
}

function splitHeaders(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i);
  const body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { headers, body };
}

const param = (h, name) => (new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, 'i').exec(h || '') || [])[1];

function decodeBody(body, headers) {
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
  const charset = param(headers['content-type'], 'charset') || 'utf-8';
  let buf;
  if (enc === 'base64') buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (enc === 'quoted-printable') buf = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  else buf = Buffer.from(body, 'latin1');
  return decodeBytes(buf, charset);
}

function textOf(part) {
  const type = (part.headers['content-type'] || 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = param(part.headers['content-type'], 'boundary');
    if (!boundary) return '';
    const parts = part.body.split(`--${boundary}`).slice(1).filter(p => !p.startsWith('--')).map(p => splitHeaders(p.replace(/^\r?\n/, '')));
    const plain = parts.find(p => (p.headers['content-type'] || 'text/plain').toLowerCase().startsWith('text/plain'));
    for (const p of plain ? [plain] : parts) { const t = textOf(p); if (t.trim()) return t; }
    return '';
  }
  const text = decodeBody(part.body, part.headers);
  return type.startsWith('text/html') ? text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') : text;
}

export function parseEml(raw) {
  const top = splitHeaders(raw);
  const from = decodeWord(top.headers.from || '');
  const email = ((/<([^>]+)>/.exec(from) || [])[1] || (/[\w.+-]+@[\w.-]+/.exec(from) || [])[0] || '').toLowerCase();
  let text = textOf(top).replace(/\r/g, '');
  // keep only the new message, not the quoted conversation below it
  const cut = text.search(/^(>|On .+wrote:|Le .+a écrit\s*:|-----Original Message-----|De\s*:|From\s*:)/m);
  if (cut > 0) text = text.slice(0, cut);
  return {
    from, email, domain: email.split('@')[1] || '',
    subject: decodeWord(top.headers.subject || ''),
    date: (() => { const d = new Date(top.headers.date || ''); return isNaN(d) ? today() : d.toISOString().slice(0, 10); })(),
    text: text.trim().replace(/\n{3,}/g, '\n\n'),
  };
}

const OPT_OUT = /(unsubscribe|remove me|take me off|not interested|no longer (contact|email)|stop (emailing|contacting|writing)|do not (contact|email)|don't (contact|email)|d[ée]sinscri|d[ée]sabonn|ne (plus )?(me )?(recontacter|contacter|[ée]crire)|merci de ne plus|pas int[ée]ress|no me (contacte|escriba)|kein interesse|abmelden)/i;
export const isOptOut = text => OPT_OUT.test(text) || /^\s*stop\s*[.!]?\s*$/im.test(text.split('\n')[0] || '');

const host = u => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

export function matchLead(leads, mail) {
  if (!mail.email) return null;
  const exact = leads.find(l => String(l.contact_channel).toLowerCase().includes(mail.email));
  if (exact) return exact;
  const free = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|orange|free|sfr|laposte|wanadoo|gmx|proton|protonmail)\./;
  if (free.test(mail.domain)) return null; // a personal mailbox says nothing about the company
  return leads.find(l => (l.website && host(l.website) === mail.domain) ||
    (/@/.test(l.contact_channel) && String(l.contact_channel).toLowerCase().split('@')[1]?.split(/[\s>,;]/)[0] === mail.domain)) || null;
}

function appendReply(lead, mail, optOut) {
  const file = path.join(P.accounts, `${lead.id}.md`);
  let md = readText(file) || `---\nid: ${lead.id}\ncompany: ${lead.company}\nauthor: sales\nupdated: ${today()}\n---\n\n# ${lead.company}\n`;
  if (!/^## Replies/m.test(md)) md = md.replace(/\s*$/, '\n\n## Replies\n');
  const quote = mail.text.slice(0, 600).split('\n').map(l => `> ${l}`).join('\n');
  md = md.replace(/\s*$/, `\n\n- ${mail.date}, from ${mail.email}${optOut ? ' (asked not to be contacted again)' : ''}: "${mail.subject}"\n${quote}\n`);
  writeText(file, md);
  return file;
}

export function processInbox(role = 'sales') {
  const report = { matched: [], optedOut: [], unmatched: [] };
  if (!fs.existsSync(INBOX)) return report;
  const files = fs.readdirSync(INBOX).filter(f => f.toLowerCase().endsWith('.eml'));
  for (const f of files) {
    const mail = parseEml(fs.readFileSync(path.join(INBOX, f), 'latin1'));
    const lead = matchLead(readLeads(), mail);
    if (!lead) { report.unmatched.push({ file: f, from: mail.email }); continue; }
    const optOut = isOptOut(`${mail.subject}\n${mail.text}`);
    const acc = appendReply(lead, mail, optOut);
    if (optOut) {
      updateLead(lead.id, { status: 'do_not_contact', next_action: 'asked not to be contacted: never write again', next_action_date: '' }, role);
      logEvent(role, 'reply', `${lead.company} asked not to be contacted again: marked do_not_contact`, acc);
      report.optedOut.push(lead.id);
    } else {
      if (lead.status !== 'do_not_contact') updateLead(lead.id, { status: 'replied', next_action: 'read the reply and decide the next step', next_action_date: today() }, role);
      logEvent(role, 'reply', `Reply from ${lead.company}: "${mail.subject}"`, acc);
      report.matched.push(lead.id);
    }
    fs.mkdirSync(path.join(INBOX, 'processed'), { recursive: true });
    fs.renameSync(path.join(INBOX, f), path.join(INBOX, 'processed', f));
  }
  return report;
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) {
  requireWorkspace();
  const a = args();
  const r = processInbox(typeof a.as === 'string' ? a.as : 'sales');
  console.log(JSON.stringify(r, null, 2));
  if (!r.matched.length && !r.optedOut.length && !r.unmatched.length) console.log(`no .eml file in ${path.relative(process.cwd(), INBOX)}`);
}
