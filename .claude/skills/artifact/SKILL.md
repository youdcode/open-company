---
name: artifact
description: Delivers what the owner asked for as an artifact they can open in the live office: an interactive prospecting file, a CSV, a dashboard, a comparison table, a one-page page. Use whenever the owner asks for "a file", "a list", "a table", "a dashboard", "a page" or "something I can open".
---

# Artifact

1. Understand the request in one line: what, for whom, which data, which filters. If the data does not
   exist yet (for example no leads), say so and propose the command that creates it (`prospect 10`).
2. **Prospecting file** (the most common): run
   `node tools/artifact.mjs prospects --title "<title in the owner's language>" --lang <fr|en> [--tier hot,warm] [--status ...] --as sales`.
   The page is built from the real files: search, filters, sort, sources, draft messages, personal
   notes and CSV export. Never retype leads into a page by hand.
3. **Table for Excel**: `node tools/artifact.mjs csv --title "..." [--tier ...] --as sales`.
4. **Any other page** (dashboard, comparison, map, one-pager, calculator): write one self-contained
   HTML file in `workspace/tmp/<name>.html`, then `node tools/artifact.mjs new --title "..." --file workspace/tmp/<name>.html --as <role>`.
   - All data embedded in the page, taken from the workspace files, with sources shown.
   - Scripts only from cdn.jsdelivr.net, cdnjs.cloudflare.com or unpkg.com; no calls to other sites.
   - Clean and readable: light background, one accent color, system font, works on a phone.
   - Interactive when useful: filters, sort, tabs, a small chart. Numbers computed in the page from the
     embedded data, never typed from memory.
5. Tell the owner in 2 lines what the artifact contains and that it is in the Artifacts tab.
