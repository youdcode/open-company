#!/usr/bin/env node
// Search the UK company register (Companies House). Free, but needs a key:
//   1. create an account and a LIVE application: https://developer.company-information.service.gov.uk/manage-applications/add
//   2. create a REST key, then add this line to workspace/.env (never committed):
//        COMPANIES_HOUSE_API_KEY=your_key
// Only active companies. With --officers, current officers are added (names and roles only:
// birth dates, addresses and nationalities are dropped on purpose).
//
// Usage: node tools/registry-uk.mjs --q "physio" [--sic 86900,86220] [--location Leeds]
//                                   [--incorporated-from 2015-01-01] [--limit 20] [--officers]
import { args, fail, isMain, loadEnv } from './lib/common.mjs';

const API = 'https://api.company-information.service.gov.uk';

async function get(path, key) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, accept: 'application/json' } });
  if (res.status === 401) fail('Companies House rejected the key. Check COMPANIES_HOUSE_API_KEY (it must be a key of a LIVE application).');
  if (res.status === 429) fail('Companies House rate limit reached (600 requests per 5 minutes). Wait and retry.');
  if (res.status === 404) return null;
  if (!res.ok) fail(`Companies House answered HTTP ${res.status}`);
  return res.json();
}

export async function searchUK(o) {
  loadEnv();
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) fail('missing COMPANIES_HOUSE_API_KEY. Get a free key at https://developer.company-information.service.gov.uk/manage-applications/add (live application, REST key), then add COMPANIES_HOUSE_API_KEY=... to workspace/.env');
  if (!o.q && !o.sic && !o.location) fail('give at least --q, --sic or --location');
  const qs = new URLSearchParams({ company_status: 'active', size: String(Math.min(100, +o.limit || 20)) });
  if (o.q) qs.set('company_name_includes', o.q);
  if (o.sic) qs.set('sic_codes', o.sic);
  if (o.location) qs.set('location', o.location);
  if (o['incorporated-from']) qs.set('incorporated_from', o['incorporated-from']);
  const json = await get(`/advanced-search/companies?${qs}`, key) || { items: [] };
  const results = [];
  for (const c of json.items || []) {
    const a = c.registered_office_address || {};
    const r = {
      company: c.company_name,
      registry_id: c.company_number,
      country: 'UK',
      city: a.locality || '',
      address: [a.address_line_1, a.address_line_2, a.locality, a.postal_code].filter(Boolean).join(', '),
      industry: (c.sic_codes || []).join(' '),
      employees: '',
      created: c.date_of_creation || '',
      sources: `https://find-and-update.company-information.service.gov.uk/company/${c.company_number}`,
    };
    if (o.officers) {
      const off = await get(`/company/${c.company_number}/officers?items_per_page=20`, key);
      r.leaders = (off?.items || []).filter(x => !x.resigned_on).slice(0, 3).map(x => ({ name: x.name, role: x.officer_role }));
    }
    results.push(r);
  }
  return { total: Number(json.hits) || results.length, results };
}

if (isMain(import.meta.url)) {
  searchUK(args()).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => fail(e.message));
}
