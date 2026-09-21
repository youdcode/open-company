---
name: setup
description: First-run interview. Asks the human about their company and ideal customers, then writes workspace/company/profile.md and workspace/prospecting/icp.md (including the scoring rules). Use when the profile says setup pending, or when the human types "setup".
---

# Setup

Goal: in about 5 minutes of the human's time, know enough to prospect without asking again.

1. `node tools/init.mjs` then `node tools/log.mjs director "Setting up the company"`.
2. If the human gives a website, read it first and pre-fill what you can. Show what you understood.
3. Ask the questions below in 2 or 3 short batches (not one giant list). Skip what the website answered.
   - Company name, website, country, language for client messages.
   - What you sell, in one sentence, and the price range.
   - Who buys it: industry, company size, place, the job title of the buyer.
   - What problem it solves for them, and what they use today instead.
   - Proof you are allowed to use (real clients, numbers, awards). "None yet" is a fine answer.
   - Tone (formal, friendly, direct) and anything we must never say.
   - Which events make a company likely to buy now (hiring, funding, new manager, expansion...).
4. Write `workspace/company/profile.md` from its template: keep the front matter, set `name`,
   `website`, `country`, `language`, `setup: done`, `author: director`, `updated`.
   Proof section: only what the human confirmed.
5. Write `workspace/prospecting/icp.md` (`author: strategist`): segments, buyer roles, signals, and the
   scoring JSON block. Adapt `industries.match` (keywords and, for France, NAF codes like `62.01Z`),
   `size`, `geography` and signal weights to the answers. Keep it valid JSON. Keep the sum of the fit
   weights below `threshold.hot`, so "hot" always needs a fresh signal.
6. Board: add 3 starter tasks, for example `prospect 10 in <segment>` (@researcher),
   `qualify new leads` (@researcher), `draft first messages` (@sales).
7. Journal: one dated line with the main choices. Log `node tools/log.mjs director "Company set up"`.
8. Tell the human in 4 lines what you understood and suggest the next command: `prospect 10`.
