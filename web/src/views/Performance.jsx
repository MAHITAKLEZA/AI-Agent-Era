import { useState } from 'react';
import { useNav } from '../nav.js';
import { fmtDate, short } from '../format.js';
import { analysisOf, keywords, searchOrPrevious, searchStats, sortedSuggestions, topPages, vis, visBand } from '../search.js';
import { Coverage, Header, Icon, ImpactChip, Level, PageLink, SegBar, VIS_PARTS, VisBar } from '../components/ui.jsx';
import { SearchMissing } from './shared.jsx';

const TABS = [
  ['keywords', 'Keyword visibility'],
  ['pages', 'Top pages'],
  ['suggestions', 'Suggestions'],
  ['questions', 'Questions'],
  ['appearance', 'Search appearance'],
];

export default function Performance({ audit, config, tab, setTab }) {
  const search = searchOrPrevious(audit, config?.model);
  const modelName = (config?.model || 'AI').replace(/^google\//, '');
  const analysis = search?.fromAudit ? search : analysisOf(audit, config?.model);
  // Older analyses have no saved time; show the date only when it's known rather than guessing.
  // An earlier crawl's analysis (shown when this crawl's failed) gets no label.
  const sub = search?.fromAudit
    ? null
    : analysis
      ? `${analysis.error ? `${modelName} analysis failed` : `Analysis by ${modelName}`}${analysis.time ? ` on ${fmtDate(analysis.time)}` : ''}`
      : `No ${modelName} analysis yet`;
  const header = <Header audit={audit} title="Search performance" sub={sub} />;
  if (!search) {
    return (<>{header}<div className="card"><div className="pad"><SearchMissing audit={audit} config={config} /></div></div></>);
  }
  const st = searchStats(search, audit.report.pages);
  const Body = { keywords: KeywordsTab, pages: PagesTab, suggestions: SuggestionsTab, questions: QuestionsTab, appearance: AppearanceTab }[tab] || KeywordsTab;

  return (
    <>
      {header}
      <div className="card">
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <Body audit={audit} search={search} stats={st} />
      </div>
    </>
  );
}

const FILTERS = [['all', null, 'All'], ['good', 'ok', 'Strong'], ['warn', 'warn', 'Moderate'], ['bad', 'bad', 'Weak']];

function KeywordsTab({ search, stats }) {
  const { inspect } = useNav();
  const [band, setBand] = useState('all');
  const [query, setQuery] = useState('');
  const q = query.toLowerCase();
  const rows = keywords(search).filter(
    (k) => (!q || `${k.keyword} ${k.page}`.toLowerCase().includes(q)) && (band === 'all' || visBand(vis(k)) === band),
  );
  const counts = { all: stats.keywords, good: stats.bands[0], warn: stats.bands[1], bad: stats.bands[2] };

  return (
    <>
      <div className="pad" style={{ paddingBottom: 8 }}>
        <SegBar parts={VIS_PARTS(stats.bands)} />
        <div className="filters" style={{ marginTop: 12 }}>
          {FILTERS.map(([id, icon, label]) => (
            <button key={id} className={`fbtn ${band === id ? 'on' : ''}`} onClick={() => setBand(id)}>
              {icon && <Icon id={icon} />}{label} {counts[id]}
            </button>
          ))}
          <input className="search-in" placeholder="Filter keywords…" aria-label="Filter keywords" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Keyword</th><th className="hide-sm">Ranking page</th><th className="hide-sm">Intent</th><th>Demand</th>
              <th className="hide-sm">Competition</th><th className="hide-sm">On-page (measured)</th><th className="num">Visibility</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.keyword + k.page} className="click" onClick={() => inspect(k.page)}>
                <td style={{ fontWeight: 500 }}>{k.keyword}</td>
                <td className="hide-sm"><PageLink url={k.page} /></td>
                <td className="dim hide-sm">{k.intent}</td>
                <td><Level value={k.demand} /></td>
                <td className="hide-sm"><span className="chip neutral">{k.competition || '–'}</span></td>
                <td className="hide-sm"><Coverage value={k.coverage} /></td>
                <td className="num"><VisBar value={vis(k)} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted">No keywords match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PagesTab({ audit, search }) {
  const { inspect } = useNav();
  return (
    <>
      <table>
        <thead><tr><th>Page</th><th className="hide-sm">Top keyword</th><th className="num">Keywords</th><th className="num">Visibility</th></tr></thead>
        <tbody>
          {topPages(search, audit.report.pages).map((p) => (
            <tr key={p.url} className="click" onClick={() => inspect(p.url)}>
              <td>
                <span className="url" style={{ maxWidth: 380, fontWeight: 500 }}>{p.title || short(p.url)}</span>
                <div className="muted url" style={{ fontSize: 12, maxWidth: 380 }}>{p.url}</div>
              </td>
              <td className="dim hide-sm">{p.ks[0].keyword}</td>
              <td className="num">{p.ks.length}</td>
              <td className="num"><VisBar value={p.score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pad muted" style={{ fontSize: 12 }}>Page visibility is the demand-weighted average visibility of its keywords.</div>
    </>
  );
}

function SuggestionsTab({ search }) {
  const items = sortedSuggestions(search);
  if (!items.length) return <div className="empty">No suggestions.</div>;
  return items.map((x, i) => (
    <details key={i} className="action" open={i < 2}>
      <summary>
        <span className="n">{i + 1}</span>
        <span className="t">{x.title}</span>
        <ImpactChip impact={x.impact} />
        <span className="chip neutral">{x.type}</span>
      </summary>
      <div className="body">
        <div className="meta-row">
          <span className="muted">Page</span><PageLink url={x.page} />
          <span className="muted">Keyword</span><b style={{ fontWeight: 500 }}>{x.keyword}</b>
        </div>
        {x.current && (
          <div className="ba">
            <div className="k">Current <span className="muted">({x.current.length} chars)</span></div>
            <div className="old">{x.current}</div>
          </div>
        )}
        <div className="ba">
          <div className="k">Suggested{x.current && <span className="muted"> ({(x.suggested || '').length} chars)</span>}</div>
          <div className="new">{x.suggested}</div>
        </div>
        <p className="why" style={{ marginTop: 8 }}>{x.why}</p>
      </div>
    </details>
  ));
}

function QuestionsTab({ search }) {
  return (
    <>
      <table>
        <thead><tr><th>Question searchers ask</th><th className="hide-sm">Keyword</th><th>Answer it on</th></tr></thead>
        <tbody>
          {(search.questions || []).map((q, i) => (
            <tr key={i}>
              <td><span style={{ fontWeight: 500 }}>{q.question}</span><div className="muted" style={{ fontSize: 12 }}>{q.why}</div></td>
              <td className="dim hide-sm">{q.keyword}</td>
              <td><PageLink url={q.page} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pad muted" style={{ fontSize: 12 }}>
        Answering these as headings or in an FAQ section (with FAQPage markup) can win “People also ask” spots.
      </div>
    </>
  );
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 2)}…` : text);

function AppearanceTab({ audit }) {
  const pages = audit.report.pages.filter((p) => p.indexable).sort((a, b) => b.inlinks - a.inlinks).slice(0, 30);
  return (
    <>
      <div className="pad muted" style={{ fontSize: 12, paddingBottom: 4 }}>
        How your pages may look in Google results. Google cuts titles near 60 characters and descriptions near 160.
      </div>
      {pages.map((p) => (
        <div key={p.url} className="serp">
          <div className="su">{p.url}</div>
          <div className="st">{p.title ? clip(p.title, 60) : <span className="miss">Missing title</span>}</div>
          <div className="sd">
            {p.description ? clip(p.description, 160) : <span className="miss">No meta description: Google will pick text from the page.</span>}
          </div>
        </div>
      ))}
    </>
  );
}
