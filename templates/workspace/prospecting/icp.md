---
author: strategist
updated:
---

# Ideal customer profile

Filled during `setup`, refined by the strategist. The researcher searches from this page.

## Segments
1. (industry, size, place, buyer job title, main pain)

## Buying signals that mean "now"
- hiring: job posts for roles our product helps
- funding: a round raised in the last 12 months
- new_leader: a new manager in the buyer's department
- expansion: new office, new market, new product line
- press: coverage that shows the pain we solve
- tech_change: moving away from a tool we replace

## Excluded
(companies or sectors we never target)

## Scoring (used by tools/score.mjs, keep it valid JSON)

Fit points (industries + size + geography) should stay below `threshold.hot`, so that a lead is only
hot when it also has a fresh buying signal. Otherwise every company that fits is "hot".

```json
{
  "fit": {
    "industries": { "weight": 30, "match": ["software", "62.01Z"] },
    "size": { "weight": 20, "min": 10, "max": 200 },
    "geography": { "weight": 10, "match": ["FR"] }
  },
  "signals": { "hiring": 15, "funding": 20, "new_leader": 10, "expansion": 10, "press": 5, "tech_change": 10 },
  "signal_half_life_days": 60,
  "threshold": { "hot": 70, "warm": 40 }
}
```
