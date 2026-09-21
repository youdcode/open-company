---
name: proposal
description: Tailored proposal for a lead after a meeting, with the matching quote drafted by finance. Use when the human types "proposal <company>".
---

# Proposal

Roles: **consultant** writes, **finance** prices, **auditor** checks.

1. Inputs: the account file, the meeting brief and the human's notes from the meeting. Ask the human
   for the notes if they are not in the workspace: never invent what was said.
2. Consultant writes `workspace/departments/consulting/<date>-proposal-<id>.md`: their problem in their
   words, scope, deliverables, timeline, what we need from them, price (from finance), next step.
3. Finance drafts the matching quote with the quote-invoice skill and gives its id.
4. Auditor checks claims against the profile and the numbers against the quote.
5. Tell the human: proposal and quote are drafts, the quote is issued from the Finance tab.
