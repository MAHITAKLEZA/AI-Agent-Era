// Derived views of the AI search analysis stored on an audit.

const IMPACT = { high: 0, medium: 1, low: 2 };
const DEMAND_WEIGHT = { high: 3, medium: 2, low: 1 };

/** The analysis made by `model` (each model's analysis of a crawl is kept separately); null if missing or failed. */
export const analysisOf = (audit, model) => audit?.searches?.[model] || null;
export const searchOf = (audit, model) => {
  const s = analysisOf(audit, model);
  return s && !s.error ? s : null;
};
/** This crawl's analysis by `model`, or else that model's latest working analysis of an earlier crawl
 *  (marked with fromAudit / fromCrawl). */
export const searchOrPrevious = (audit, model) => searchOf(audit, model) || audit?.previous?.[model] || null;
export const vis = (k) => Math.max(0, Math.min(100, Math.round(+k.visibility || 0)));
export const visBand = (v) => (v >= 60 ? 'good' : v >= 30 ? 'warn' : 'bad');

export const keywords = (search) => (search?.keywords || []).slice().sort((a, b) => vis(b) - vis(a));

export const sortedSuggestions = (search) =>
  (search?.suggestions || []).slice().sort((a, b) => (IMPACT[a.impact] ?? 3) - (IMPACT[b.impact] ?? 3));

/** Pages ranked by the demand-weighted average visibility of their keywords. */
export function topPages(search, pages) {
  const byUrl = {};
  for (const k of keywords(search)) (byUrl[k.page] ||= []).push(k);
  const titles = Object.fromEntries((pages || []).map((p) => [p.url, p.title]));
  return Object.entries(byUrl)
    .map(([url, ks]) => {
      const weight = ks.reduce((s, k) => s + (DEMAND_WEIGHT[k.demand] || 1), 0);
      const score = Math.round(ks.reduce((s, k) => s + vis(k) * (DEMAND_WEIGHT[k.demand] || 1), 0) / weight);
      return { url, ks, score, title: titles[url] };
    })
    .sort((a, b) => b.score - a.score || b.ks.length - a.ks.length);
}

export function searchStats(search, pages) {
  const ks = keywords(search);
  return {
    keywords: ks.length,
    pages: topPages(search, pages).length,
    avg: ks.length ? Math.round(ks.reduce((s, k) => s + vis(k), 0) / ks.length) : 0,
    page1: ks.filter((k) => vis(k) >= 60).length,
    suggestions: (search?.suggestions || []).length,
    questions: (search?.questions || []).length,
    bands: ['good', 'warn', 'bad'].map((b) => ks.filter((k) => visBand(vis(k)) === b).length),
  };
}
