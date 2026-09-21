---
author: strategist
updated: 2026-01-01
---

# Ideal customer profile (demo)

## Segments
1. Independent physiotherapy clinics, UK, 3 to 50 people. Buyer: owner or practice manager. Pain: phone bookings and no-shows.

## Buying signals that mean "now"
- hiring: front-desk or reception job posts
- expansion: a new clinic or a new site
- tech_change: moving away from a booking tool
- new_leader: a new practice manager
- press: local coverage

## Scoring (used by tools/score.mjs, keep it valid JSON)

```json
{
  "fit": {
    "industries": { "weight": 30, "match": ["physio"] },
    "size": { "weight": 20, "min": 3, "max": 50 },
    "geography": { "weight": 10, "match": ["UK"] }
  },
  "signals": { "hiring": 20, "expansion": 20, "tech_change": 15, "new_leader": 15, "press": 5 },
  "signal_half_life_days": 60,
  "threshold": { "hot": 70, "warm": 40 }
}
```
