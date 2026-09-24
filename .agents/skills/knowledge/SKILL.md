---
name: knowledge
description: Reads the owner's own documents (a folder added under "Readable folders") and writes a knowledge base in workspace/company/knowledge/: one index plus short digests, every fact carrying the path of its source file. Use when the owner says "read my documents", "learn my company", "use my folder", or when the team keeps missing context.
---

# Knowledge base

Goal: after this, any role can start working without reading gigabytes again, and every fact can be
traced back to the owner's own file.

1. Check the folder is readable: it must be in the chat's "Readable folders" (the chat note lists
   them). If not, ask the owner to add it; never guess a path.
2. Map before reading: list the folders, then open the files that decide things first (a brief, a
   journal or decision log, the current business plan, the go-to-market, the product doc). Skip code
   directories, media, and anything over a few hundred kilobytes unless the owner asks.
3. Write in `workspace/company/knowledge/` (front matter `author`, `updated`, `source`):
   - `INDEX.md`: the map. For each folder: what it is for, which 2 or 3 files to open first, what is
     out of date. Ends with "Where to find what": one line per subject pointing to a file.
   - Digests, one per subject that matters, for example `brief.md` (positioning and wording rules,
     including what must never be said), `product.md`, `market.md`, `gtm.md`, `numbers.md` (every
     figure with its status: fact, hypothesis, scenario, external benchmark, and its source),
     `history.md` (dated decisions), `open-questions.md`.
4. Rules: every fact carries its source file path. Never invent a number. When two files contradict
   each other, write both with their dates and say which one wins if a file says so. Keep the owner's
   exact wording for validated sentences (taglines, message templates). Dense lists and tables, no
   filler. Write in the owner's language.
5. Keep it cheap to use: the index stays under 120 lines, each digest under 200. At session start the
   team reads only the index; it opens a digest or a source file when the request needs it.
6. Tell the owner what you wrote, the contradictions you found, and what you could not read.
