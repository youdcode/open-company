---
name: draft-outreach
description: Writes short, personal first messages for hot and warm qualified leads, saved as drafts for human approval in the live page. Never sends anything. Use when the human types "draft".
---

# Draft outreach

Role: **sales** (delegate to the sales subagent if available, otherwise follow `roles/sales.md`).

1. List candidates: `node tools/leads.mjs list --tier hot` then `--tier warm`. Keep leads with status
   `qualified` (skip `do_not_contact`, `replied`, and leads that already have a pending draft).
2. For each (max 10 per run): read the lead (`tools/leads.mjs get`) and its account file.
3. Write the message following `roles/sales.md` (120 words max, sourced signal first, one claim from
   the profile at most, soft call to action, opt-out line for email, prospect's language).
4. Save: write the body to `workspace/tmp/<id>.txt`, then
   `node tools/drafts.mjs new <id> --as sales --subject "..." --body-file workspace/tmp/<id>.txt`.
5. Optional but recommended for the first batch: ask the auditor to check the drafts.
6. Tell the human how many drafts wait in the Outreach tab. Remind them that approved messages are
   exported with `export`, never sent by the company.
