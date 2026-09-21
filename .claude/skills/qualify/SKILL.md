---
name: qualify
description: For leads with status new or researched, finds dated buying signals and a published contact route, records them with sources, rescores, and marks leads qualified. Use when the human types "qualify".
---

# Qualify

Role: **researcher**. Work on `node tools/leads.mjs list --status new` (then `--status researched`),
highest score first, 10 leads per run unless the human says otherwise.

For each lead:
1. Search for events from the last 12 months: job posts, funding, new executives, new offices,
   launches, press, technology changes. Keep only what has a date and a URL.
2. Update the account file: "Why now" (date, one line, URL) and "Contact route".
3. Contact route: the buyer's job title from the ICP; a named person only if published on the
   company's own site or a public official source; a published professional channel or the contact
   page. Never guess an email or pattern.
4. `node tools/leads.mjs update <id> signals="hiring@2026-09-02; funding@2026-06-10" contact_role="..." contact_name="..." contact_channel="..." contact_source="<url>" status=qualified --as researcher`
5. After the batch: `node tools/score.mjs --as researcher`, handoff to sales, log, and a 5 line report.
