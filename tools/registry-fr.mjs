#!/usr/bin/env node
// Search the official French company registry (free, no key): recherche-entreprises.api.gouv.fr
// Returns compact JSON with a source URL for every company, ready for tools/leads.mjs.
// Only active companies. Birth dates of directors are dropped on purpose (data minimisation).
//
// Usage:
//   node tools/registry-fr.mjs --q "logiciel" [--naf 62.01Z] [--dept 75] [--postal 75011]
//                              [--size 11,12,21] [--category PME] [--limit 20] [--page 1]
// Size codes (INSEE): 01=1-2 02=3-5 03=6-9 11=10-19 12=20-49 21=50-99 22=100-199
//                     31=200-249 32=250-499 41=500-999 42=1000-1999 51=2000-4999
import { args, fail, isMain } from './lib/common.mjs';

export const SIZE = {
  NN: '', '00': '0', '01': '1-2', '02': '3-5', '03': '6-9', 11: '10-19', 12: '20-49', 21: '50-99',
  22: '100-199', 31: '200-249', 32: '250-499', 41: '500-999', 42: '1000-1999', 51: '2000-4999',
  52: '5000-9999', 53: '10000+',
};

export async function searchFR(o) {
  const qs = new URLSearchParams({ etat_administratif: 'A', per_page: String(Math.min(25, +o.limit || 20)), page: String(o.page || 1) });
  if (o.q) qs.set('q', o.q);
  if (o.naf) qs.set('activite_principale', o.naf);
  if (o.dept) qs.set('departement', o.dept);
  if (o.postal) qs.set('code_postal', o.postal);
  if (o.size) qs.set('tranche_effectif_salarie', o.size);
  if (o.category) qs.set('categorie_entreprise', o.category);
  if (!o.q && !o.naf) fail('give at least --q or --naf');
  const url = `https://recherche-entreprises.api.gouv.fr/search?${qs}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 429) fail('rate limited by the registry, wait a few seconds and retry');
  if (!res.ok) fail(`registry answered HTTP ${res.status}`);
  const json = await res.json();
  return {
    query: url,
    total: json.total_results,
    results: (json.results || []).map(r => ({
      company: r.nom_complet,
      registry_id: r.siren,
      country: 'FR',
      city: r.siege?.libelle_commune || '',
      address: r.siege?.adresse || '',
      industry: r.activite_principale || '',
      employees: SIZE[r.tranche_effectif_salarie] ?? '',
      category: r.categorie_entreprise || '',
      created: r.date_creation || '',
      leaders: (r.dirigeants || [])
        .filter(d => d.type_dirigeant === 'personne physique')
        .slice(0, 3)
        .map(d => ({ name: `${d.prenoms || ''} ${d.nom || ''}`.trim(), role: d.qualite || '' })),
      sources: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`,
    })),
  };
}

if (isMain(import.meta.url)) {
  const a = args();
  searchFR(a).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => fail(e.message));
}
