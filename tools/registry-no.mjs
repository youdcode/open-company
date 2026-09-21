#!/usr/bin/env node
// Search the Norwegian register of legal entities (Brønnøysund, free, no key).
// Only active companies (not bankrupt, not being wound up). With --leaders, current roles are
// added (names and roles only: birth dates are dropped on purpose).
// Privacy rule of the register: employee filters are only allowed from 5 employees.
//
// Usage: node tools/registry-no.mjs --q "fysioterapi" [--nace 86.950] [--municipality 0301]
//                                   [--min-employees 5] [--max-employees 50] [--limit 20] [--leaders]
import { args, fail, isMain, helpIfAsked } from './lib/common.mjs';

const API = 'https://data.brreg.no/enhetsregisteret/api';

async function get(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = (j.valideringsfeil || []).map(v => v.feilmelding).join('; ') || j.feilmelding || msg; } catch {}
    fail(`the Norwegian register refused the query: ${msg}`);
  }
  return res.json();
}

export async function searchNO(o) {
  if (!o.q && !o.nace) fail('give at least --q or --nace');
  const qs = new URLSearchParams({ konkurs: 'false', underAvvikling: 'false', size: String(Math.min(100, +o.limit || 20)) });
  if (o.q) qs.set('navn', o.q);
  if (o.nace) qs.set('naeringskode', o.nace);
  if (o.municipality) qs.set('kommunenummer', o.municipality);
  let note = '';
  if (o['min-employees'] || o['max-employees']) {
    const min = Math.max(5, Number(o['min-employees']) || 5);
    if (Number(o['min-employees']) < 5) note = 'The register does not allow employee filters below 5 (privacy rule): minimum set to 5.';
    qs.set('fraAntallAnsatte', String(min));
    if (o['max-employees']) qs.set('tilAntallAnsatte', String(o['max-employees']));
  }
  const json = await get(`${API}/enheter?${qs}`);
  const results = [];
  for (const e of json._embedded?.enheter || []) {
    const a = e.forretningsadresse || e.postadresse || {};
    const r = {
      company: e.navn,
      registry_id: e.organisasjonsnummer,
      country: 'NO',
      city: a.poststed || '',
      address: [...(a.adresse || []), a.postnummer, a.poststed].filter(Boolean).join(', '),
      industry: e.naeringskode1 ? `${e.naeringskode1.kode} ${e.naeringskode1.beskrivelse}` : '',
      employees: e.antallAnsatte != null ? String(e.antallAnsatte) : '',
      website: e.hjemmeside || '',
      created: e.stiftelsesdato || e.registreringsdatoEnhetsregisteret || '',
      sources: `https://virksomhet.brreg.no/nb/oppslag/enheter/${e.organisasjonsnummer}`,
    };
    if (o.leaders) {
      const roles = await get(`${API}/enheter/${e.organisasjonsnummer}/roller`);
      r.leaders = (roles.rollegrupper || []).flatMap(g => g.roller || [])
        .filter(x => x.person && !x.fratraadt && !x.avregistrert)
        .slice(0, 3)
        .map(x => ({ name: `${x.person.navn?.fornavn || ''} ${x.person.navn?.etternavn || ''}`.trim(), role: x.type?.beskrivelse || '' }));
    }
    results.push(r);
  }
  return { total: json.page?.totalElements ?? results.length, note, results };
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) {
  searchNO(args()).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => fail(e.message));
}
