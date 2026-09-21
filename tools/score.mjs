#!/usr/bin/env node
// Deterministic lead scoring. The AI never invents a score: it records facts (industry, size,
// place, dated signals) and this script turns them into a 0-100 score using the rules written
// in workspace/prospecting/icp.md (the ```json block under "Scoring").
//
// Usage: node tools/score.mjs [--id <lead id>] [--as qualifier]
import { readLeads, writeLeads, readText, P, logEvent, args, fail, requireWorkspace, isMain, withLock, helpIfAsked } from './lib/common.mjs';

export function loadRules() {
  const md = readText(P.icp);
  const m = /```json\s*\n([\s\S]*?)```/.exec(md);
  if (!m) fail('no ```json scoring block found in workspace/prospecting/icp.md');
  try { return JSON.parse(m[1]); } catch (e) { fail(`scoring block in icp.md is not valid JSON: ${e.message}`); }
}

const lc = s => String(s || '').toLowerCase();
const matchAny = (text, list = []) => list.some(x => x && lc(text).includes(lc(x)));

// "10-19", "45", "200+" -> [min, max]
function range(v) {
  const s = String(v || '').replace(/\s/g, '');
  let m;
  if ((m = /^(\d+)-(\d+)$/.exec(s))) return [+m[1], +m[2]];
  if ((m = /^(\d+)\+$/.exec(s))) return [+m[1], Infinity];
  if ((m = /^(\d+)$/.exec(s))) return [+m[1], +m[1]];
  return null;
}

export function scoreLead(lead, rules, ref = new Date()) {
  const fit = rules.fit || {};
  let score = 0;
  const why = [];

  if (fit.industries && matchAny(`${lead.industry} ${lead.company}`, fit.industries.match)) {
    score += fit.industries.weight || 0; why.push('industry');
  }
  if (fit.size) {
    const r = range(lead.employees);
    const min = fit.size.min ?? 0, max = fit.size.max ?? Infinity;
    if (r && r[1] >= min && r[0] <= max) { score += fit.size.weight || 0; why.push('size'); }
  }
  if (fit.geography && matchAny(`${lead.country} ${lead.city}`, fit.geography.match)) {
    score += fit.geography.weight || 0; why.push('geo');
  }
  const halfLife = rules.signal_half_life_days || 60;
  for (const s of String(lead.signals || '').split(/;\s*/).filter(Boolean)) {
    const [type, date] = s.trim().split('@');
    const w = rules.signals?.[type];
    if (!w || !date) continue;
    const ageDays = Math.max(0, (ref - new Date(date)) / 86400000);
    const pts = w * Math.pow(0.5, ageDays / halfLife);
    if (pts >= 0.5) { score += pts; why.push(type); }
  }
  score = Math.min(100, Math.round(score));
  const t = rules.threshold || { hot: 60, warm: 35 };
  const tier = score >= t.hot ? 'hot' : score >= t.warm ? 'warm' : 'cold';
  return { score, tier, why: why.join('+') || 'no match' };
}

export function scoreAll(opts = {}) {
  return withLock(P.leads, () => scoreAllUnlocked(opts));
}

function scoreAllUnlocked({ id, as = 'researcher', quiet = false } = {}) {
  const rules = loadRules();
  const fitMax = Object.values(rules.fit || {}).reduce((s, f) => s + (f.weight || 0), 0);
  if (!quiet && fitMax >= (rules.threshold?.hot ?? 60))
    console.error(`warning: fit alone gives ${fitMax} points, at or above the hot threshold (${rules.threshold?.hot ?? 60}). Every company that fits will be "hot" even without a buying signal. Raise threshold.hot in icp.md.`);
  const leads = readLeads();
  let n = 0;
  for (const l of leads) {
    if (id && l.id !== id) continue;
    const r = scoreLead(l, rules);
    Object.assign(l, { score: String(r.score), tier: r.tier, score_why: r.why });
    n++;
  }
  if (id && !n) fail(`no lead with id "${id}"`);
  writeLeads(leads);
  const hot = leads.filter(l => l.tier === 'hot').length, warm = leads.filter(l => l.tier === 'warm').length;
  logEvent(as, 'score', `Scored ${n} lead${n > 1 ? 's' : ''}: ${hot} hot, ${warm} warm`, P.leads);
  return { n, hot, warm, cold: leads.length - hot - warm };
}

function main() {
  requireWorkspace();
  const a = args();
  const r = scoreAll({ id: typeof a.id === 'string' ? a.id : '', as: typeof a.as === 'string' ? a.as : 'researcher' });
  console.log(`scored ${r.n} leads (hot ${r.hot}, warm ${r.warm}, cold ${r.cold})`);
}

helpIfAsked(isMain(import.meta.url) ? import.meta.url : null);
if (isMain(import.meta.url)) main();
