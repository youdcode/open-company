---
name: sprint
description: The whole company works on one goal given by the human (for example "launch in Belgium" or "prepare the pitch for bakeries"). The Director plans, each needed role delivers one document, the auditor reviews, and the Director reports. Use when the human types sprint "<goal>".
---

# Sprint

1. Restate the goal in one line and list the roles needed (not all roles every time). Ask the human
   only if the goal is ambiguous.
2. Board: one card per role with a precise deliverable and its path in `workspace/departments/<dept>/`.
3. Order (each output feeds the next): strategist, then marketer, then sales, then finance,
   then consultant or tech if needed. Independent roles may run in parallel if your tool supports it.
4. Each role: one document, front matter `author`, sources for facts, handoff to the next role.
5. The auditor reviews every sprint document and writes `workspace/departments/audit/<date>-sprint.md`.
   Fix what it blocks before reporting.
6. Journal: decisions taken. Report to the human in 8 lines max with the paths to read.

Budget: one deliverable per role per sprint unless the human asks for more.
