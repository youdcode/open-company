---
name: quote-invoice
description: Prepares a quote or an invoice draft with exact totals (tools/invoice.mjs). Only the human issues it, from the Finance tab of the live office. Use when the human types "quote for <client>", "invoice <client>" or "invoice from quote".
---

# Quote or invoice

Role: **finance** (follow `roles/finance.md`).

1. Collect the facts, never invent them: client legal name and address (from the lead, the account
   file or the human), what is sold, quantities, unit prices (from `workspace/company/profile.md` or the
   human), VAT rate if different from `workspace/company/billing.md`. Ask for anything missing.
2. Write the document as JSON in `workspace/tmp/doc.json`:
   `{"type":"quote","client":{"name":"...","address":"...","vat_id":"","lead":"<lead id>"},"lines":[{"description":"...","qty":1,"unit_price":450}],"notes":"..."}`
3. `node tools/invoice.mjs new --file workspace/tmp/doc.json --as finance`. The script computes the
   totals. Never compute or round them yourself.
4. For an invoice from an accepted quote: `node tools/invoice.mjs from-quote <quote id> --as finance`.
5. If `billing.md` is not filled (legal name, address, legal mentions), tell the human: nothing can be
   issued before that. Do not fill legal mentions yourself.
6. Tell the human: the draft is in the Finance tab, "Issue" gives it its number, then print it to PDF.
   Never say it was sent.
