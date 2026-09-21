---
name: meeting-brief
description: One-page brief to prepare a meeting with a lead, from the account file and fresh sources. Use when a lead books a call or when the human types "brief <company>".
---

# Meeting brief

Role: **consultant** (follow `roles/consultant.md`).

1. Read the lead (`node tools/leads.mjs get <id>`), its account file and any reply in it.
2. At most 3 web searches for news since the account file was written.
3. Write `workspace/departments/consulting/<date>-brief-<id>.md` (`author: consultant`):
   - Who: company, person, role (sources)
   - Context: what they do, what changed recently (dated, sourced)
   - Hypotheses to check (written as questions, never as facts)
   - 10 discovery questions, the most important first
   - Our offer in 3 lines (only from the profile) and the next step to propose
4. `node tools/leads.mjs update <id> status=meeting next_action="meeting, brief ready" --as consultant`
   if the meeting is confirmed. Log and hand off to the Director with the path.
