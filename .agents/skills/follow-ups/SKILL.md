---
name: follow-ups
description: Lists the follow-ups due today and drafts them for approval. Use when the human types "followups", or at the start of a session when follow-ups are due.
---

# Follow-ups

Role: **sales**.

1. `node tools/leads.mjs list --due`.
2. For each lead, by status:
   - `approved` or `contacted` with no answer: draft follow-up 1 or 2 with
     `node tools/drafts.mjs new <id> --followup ...` (shorter, adds something new, no guilt).
     After follow-up 2: set `next_action="close the loop"`.
   - `replied`: do not write. Summarize the reply for the human if it is in the workspace, ask what to do.
   - `meeting`: ask the consultant for a meeting brief in `workspace/departments/consulting/`.
3. Update `next_action` and `next_action_date` (suggest 4 to 7 working days) with `tools/leads.mjs update`.
4. Report in 5 lines.

The human sets `status=contacted` (or asks you to) once a message is really sent.
