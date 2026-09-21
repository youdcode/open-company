---
name: prospect
description: Finds N new companies matching the ideal customer profile, each verified on its own website and recorded with sources through tools/leads.mjs, then scored. Use when the human types "prospect" or "prospect <n>".
---

# Prospect

Input: a number N (default 10) and optionally a segment. Role: **researcher** (delegate to the
researcher subagent if your tool has one, otherwise follow `roles/researcher.md` yourself).

1. Check `workspace/prospecting/icp.md` exists and is filled. If not, run the setup skill first.
2. `node tools/board.mjs add "Prospect <N>: <segment>" --role researcher` then move it to doing.
3. Budget: about 3 searches per lead found, and stop at N. Tell the human if the segment is too
   narrow instead of lowering the bar.
4. Search (web search, and `node tools/registry-fr.mjs` for France). Collect candidates, remove those
   already in `node tools/leads.mjs list`.
5. For each candidate: confirm on its own website. Write `workspace/prospecting/accounts/<id>.md` from
   `templates/docs/account.md` (id = the slug of the company name, as tools/leads.mjs creates it).
6. Add leads in batches: write a JSON array to `workspace/tmp/batch.json`, then
   `node tools/leads.mjs add --as researcher --file workspace/tmp/batch.json`. Fix and retry rejected ones.
7. `node tools/score.mjs --as researcher`.
8. Move the card to done, handoff to sales with the count of hot and warm leads, log the end.
9. Report to the human in 5 lines max and point to the Pipeline tab of the live page.
