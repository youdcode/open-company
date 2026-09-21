// The demo replay: what a real session looks like, with a FICTIONAL company and FICTIONAL leads.
// Every URL uses the reserved .example domain. Used by `./start --demo` (bin/demo.mjs).

const lead = (o) => ({ country: 'UK', ...o });

export const accounts = {
  'northside-physio': (d) => `---
id: northside-physio
company: Northside Physio
author: researcher
updated: ${d(0)}
---

# Northside Physio

## Snapshot
Independent physiotherapy clinic in Leeds, 10 to 19 people, sports and back pain. https://northside-physio.example/about

## Why it fits
Segment 1: independent clinic, right size, UK. Bookings are taken by phone only.

## Why now
- ${d(9)}, hiring: job post for a front-desk coordinator "to manage phone bookings". https://northside-physio.example/careers/front-desk

## Contact route
Buyer role: practice manager. Named contact: Amira Khan, practice manager, on the team page. https://northside-physio.example/team
Channel: hello@northside-physio.example, published on the contact page. https://northside-physio.example/contact

## Angle
They are hiring someone to answer the phone for bookings: online booking takes part of that load.

## Sources
- https://northside-physio.example/about: size, services
- https://northside-physio.example/careers/front-desk: the job post
- https://northside-physio.example/team: practice manager
`,
  'harbour-physiotherapy': (d) => `---
id: harbour-physiotherapy
company: Harbour Physiotherapy
author: researcher
updated: ${d(0)}
---

# Harbour Physiotherapy

## Snapshot
Physiotherapy clinic in Bristol, 6 to 9 people. https://harbour-physio.example

## Why it fits
Segment 1. Now two sites with one small team.

## Why now
- ${d(21)}, expansion: opened a second clinic in Clifton. https://harbour-physio.example/news/clifton

## Contact route
Buyer role: owner. Named contact: Tom Reeve, founder, on the about page. https://harbour-physio.example/about
Channel: contact form. https://harbour-physio.example/contact

## Angle
Two clinics, two diaries: one booking page for both sites.

## Sources
- https://harbour-physio.example/news/clifton: the new clinic
- https://harbour-physio.example/about: founder
`,
  'kestrel-sports-clinic': (d) => `---
id: kestrel-sports-clinic
company: Kestrel Sports Clinic
author: researcher
updated: ${d(0)}
---

# Kestrel Sports Clinic

## Snapshot
Sports injury clinic in Manchester, 20 to 49 people. https://kestrel-clinic.example

## Why it fits
Segment 1, larger team, many bookings per day.

## Why now
- ${d(30)}, tech_change: blog post saying they will "replace our booking system in Q4". https://kestrel-clinic.example/blog/new-booking-system

## Contact route
Buyer role: clinical director. Named contact: Dr Lena Price, clinical director. https://kestrel-clinic.example/team
Channel: lena.price@kestrel-clinic.example, published on the team page. https://kestrel-clinic.example/team

## Angle
They are comparing booking tools right now.

## Sources
- https://kestrel-clinic.example/blog/new-booking-system: the switch
- https://kestrel-clinic.example/team: clinical director and email
`,
};

export const batches = (d) => [
  [
    lead({ company: 'Northside Physio', website: 'https://northside-physio.example', city: 'Leeds', industry: 'physiotherapy clinic', employees: '10-19',
      contact_name: 'Amira Khan', contact_role: 'Practice manager', contact_channel: 'hello@northside-physio.example', contact_source: 'https://northside-physio.example/contact',
      signals: `hiring@${d(9)}`, sources: 'https://northside-physio.example/about https://northside-physio.example/careers/front-desk' }),
    lead({ company: 'Harbour Physiotherapy', website: 'https://harbour-physio.example', city: 'Bristol', industry: 'physiotherapy clinic', employees: '6-9',
      contact_name: 'Tom Reeve', contact_role: 'Founder', contact_channel: 'https://harbour-physio.example/contact', contact_source: 'https://harbour-physio.example/about',
      signals: `expansion@${d(21)}`, sources: 'https://harbour-physio.example/news/clifton' }),
    lead({ company: 'Kestrel Sports Clinic', website: 'https://kestrel-clinic.example', city: 'Manchester', industry: 'sports physiotherapy', employees: '20-49',
      contact_name: 'Dr Lena Price', contact_role: 'Clinical director', contact_channel: 'lena.price@kestrel-clinic.example', contact_source: 'https://kestrel-clinic.example/team',
      signals: `tech_change@${d(30)}`, sources: 'https://kestrel-clinic.example/blog/new-booking-system' }),
    lead({ company: 'Ashgrove Physio', website: 'https://ashgrove-physio.example', city: 'York', industry: 'physiotherapy clinic', employees: '3-5',
      contact_role: 'Owner', sources: 'https://ashgrove-physio.example' }),
  ],
  [
    lead({ company: 'Brightwater Rehab', website: 'https://brightwater-rehab.example', city: 'Glasgow', industry: 'physiotherapy and rehabilitation', employees: '20-49',
      contact_role: 'Practice manager', signals: `press@${d(40)}`, sources: 'https://brightwater-rehab.example https://glasgow-news.example/brightwater' }),
    lead({ company: 'Millbrook Therapy Rooms', website: 'https://millbrook-therapy.example', city: 'Cardiff', industry: 'physiotherapy clinic', employees: '3-5',
      contact_role: 'Owner', signals: `new_leader@${d(110)}`, sources: 'https://millbrook-therapy.example/team' }),
    lead({ company: 'Riverside Wellness', website: 'https://riverside-wellness.example', city: 'Nottingham', industry: 'physiotherapy and massage', employees: '100-199',
      contact_role: 'Operations manager', sources: 'https://riverside-wellness.example' }),
    lead({ company: 'Oakleaf Pilates Studio', website: 'https://oakleaf-pilates.example', city: 'Bath', industry: 'pilates studio', employees: '3-5',
      contact_role: 'Owner', sources: 'https://oakleaf-pilates.example' }),
  ],
];

const optOut = "If this isn't relevant, just tell me and I won't write again.";
export const drafts = [
  ['northside-physio', 'Your new front-desk role', `Hi Amira,

I saw on your careers page that Northside Physio is hiring a front-desk coordinator to manage phone bookings.

Tidewell gives your patients online booking, automatic reminders and a waitlist that fills cancelled slots, so the front desk spends less time on the phone.

Would a 15-minute call next week be useful to see if it fits Northside?

Best,
[Your name]

${optOut}`],
  ['harbour-physiotherapy', 'Two clinics, one diary', `Hi Tom,

Congratulations on opening your second clinic in Clifton, I read the announcement on your site.

Two sites usually means two diaries. Tidewell puts both clinics on one booking page, with automatic reminders and a waitlist for last-minute gaps.

Could I show you how it would look for Harbour in 15 minutes?

Best,
[Your name]

${optOut}`],
  ['kestrel-sports-clinic', 'Your booking system switch', `Hi Dr Price,

Your recent blog post says Kestrel will replace its booking system in Q4.

Tidewell is built for independent clinics: online booking, automatic reminders, a waitlist, and an import of your existing patient list.

If it helps your comparison, I can send a one-page overview or walk you through it in 15 minutes.

Best,
[Your name]

${optOut}`],
];

export const audit = (d) => `---
author: auditor
updated: ${d(0)}
---

# Audit: first messages to the 3 hot leads

**Verdict: pass, one suggestion.**

## Checked
- Sources: the three signal pages (job post, new clinic, blog post) say what the drafts say.
- Claims: every product claim (online booking, reminders, waitlist, patient import) is in the company
  profile. No proof, number or promise is claimed.
- Contacts: each named contact and channel comes from a published page (contact_source present).
  No guessed email.
- Rules: opt-out line present in all 3 emails. Nothing was sent.

## Issues
1. Kestrel: the team page publishes Dr Price's email but does not say she chooses the software.
   Suggest asking in the first reply who owns the booking-system decision.

## Not checked
- Whether the prospects already use a competitor. Worth a question in the first call.
`;

// [seconds, step]. Every step goes through the same functions the agents use.
export const script = [
  [0, a => a.log('director', 'Session started. Demo mode: fictional company, replayed, no AI running.')],
  [2, a => a.addTask('Prospect 8: independent physio clinics, UK', 'researcher')],
  [3, a => a.moveTask('Prospect 8', 'doing', 'researcher')],
  [3.5, a => a.log('director', 'Delegating to the researcher: 8 physio clinics, 3 to 50 people, UK')],
  [6, a => a.log('researcher', 'Looking for 8 companies: independent physiotherapy clinics in the UK')],
  [10, a => a.account('northside-physio')],
  [14, a => a.account('harbour-physiotherapy')],
  [18, a => a.account('kestrel-sports-clinic')],
  [21, a => a.addLeads(0)],
  [25, a => a.addLeads(1)],
  [27, a => a.score()],
  [29, a => a.moveTask('Prospect 8', 'done', 'researcher')],
  [30, a => a.handoff({ from: 'researcher', to: 'sales', subject: '8 leads ready: 3 hot, 4 warm',
    body: 'Hot: Northside (hiring front desk), Harbour (second clinic), Kestrel (replacing its booking tool). Sources in the account files.',
    link: 'workspace/prospecting/leads.csv' })],
  [33, a => a.addTask('Draft first messages for the 3 hot leads', 'sales')],
  [34, a => a.moveTask('Draft first messages', 'doing', 'sales')],
  [36, a => a.log('sales', 'Writing first messages for the 3 hot leads')],
  [40, a => a.draft(0)],
  [45, a => a.draft(1)],
  [50, a => a.draft(2)],
  [52, a => a.addTask('Check the 3 drafts before approval', 'auditor')],
  [53, a => a.moveTask('Check the 3 drafts', 'doing', 'auditor')],
  [54, a => a.moveTask('Draft first messages', 'review', 'sales')],
  [55, a => a.log('auditor', 'Opening the sources and checking every claim in the 3 drafts')],
  [62, a => a.audit()],
  [63, a => a.moveTask('Check the 3 drafts', 'done', 'auditor')],
  [64, a => a.handoff({ from: 'auditor', to: 'director', subject: 'Drafts pass the audit',
    body: 'Sources match, no claim outside the profile, opt-out line in every email.', link: 'workspace/departments/audit/' })],
  [65, a => a.moveTask('Draft first messages', 'done', 'sales')],
  [67, a => a.log('director', '3 messages are waiting for your approval in Outreach. Nothing is sent without you.')],
];
