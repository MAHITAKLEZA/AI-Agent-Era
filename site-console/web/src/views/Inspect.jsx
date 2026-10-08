import { useNav } from '../nav.js';
import { fmtDate, fmtKB, fmtMs, n, plural } from '../format.js';
import { keywords, searchOrPrevious, sortedSuggestions, vis } from '../search.js';
import { CheckChip, Chip, Coverage, Header, Icon, ImpactChip, Level, Msg, VisBar } from '../components/ui.jsx';

const Section = ({ icon, color, title, note, open, children }) => (
  <details className="sect" open={open}>
    <summary>
      <Icon id={icon} style={{ color: color || 'var(--ink-2)' }} />
      {title} {note && <span className="sum-note">{note}</span>}
    </summary>
    {children}
  </details>
);

const InspectLink = ({ url, block }) => {
  const { inspect } = useNav();
  return (
    <a href="#" style={block ? { display: 'block' } : undefined} onClick={(e) => { e.preventDefault(); inspect(url); }}>{url}</a>
  );
};

export default function Inspect({ audit, config, state }) {
  const { inspect } = useNav();
  const header = <Header audit={audit} title="URL inspection" />;

  if (!state) {
    const top = audit.report.pages.slice().sort((a, b) => b.inlinks - a.inlinks).slice(0, 12);
    return (
      <>
        {header}
        <div className="card">
          <div className="table-h"><h3>Type a URL in the search bar above, or pick a page</h3></div>
          <table>
            <thead><tr><th>URL</th><th className="num hide-sm">Last crawled</th></tr></thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.url} className="click" onClick={() => inspect(p.url)}>
                  <td><span className="url" title={p.url}>{p.url}</span></td>
                  <td className="num dim hide-sm">{fmtDate(p.crawledAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (state.loading) {
    return (
      <>
        {header}
        <div className="card">
          <div className="pad" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="sp" />{state.loading} <span className="muted url">{state.url}</span>
          </div>
        </div>
      </>
    );
  }

  const p = state.page;
  let v, title, desc;
  if (state.error) [v, title, desc] = ['bad', 'Inspection failed', state.error];
  else if (p?.indexable) [v, title, desc] = ['good', 'URL can be indexed', 'It was crawled, returned 200, and nothing blocks indexing.'];
  else if (p) [v, title, desc] = ['bad', 'URL is not indexable', p.reasonText || 'See details below.'];
  else if (state.discovered) [v, title, desc] = ['warn', 'URL was discovered but not crawled', `The crawl stopped at ${config?.maxPages} pages. Use “Test live URL”.`];
  else [v, title, desc] = ['warn', 'URL is not in this crawl', 'No crawled page links to it and it is not in the sitemap. Use “Test live URL”.'];

  return (
    <>
      {header}
      <div className="card">
        <div className="pad" style={{ paddingBottom: 0 }}>
          <div className="url" style={{ fontSize: 13, color: 'var(--ink-2)', maxWidth: '100%', marginBottom: 10 }}>{state.url}</div>
          <div className={`verdict ${v}`}>
            <Icon id={v === 'good' ? 'ok' : v === 'bad' ? 'bad' : 'warn'} />
            <div><h2>{title}</h2><p>{desc}</p></div>
          </div>
        </div>
        <div className="pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => inspect(state.url, { live: true })}><Icon id="refresh" />Test live URL</button>
          <button className="btn" disabled={!config?.aiEnabled} title={config?.aiEnabled ? '' : 'Set GEMINI_API_KEY or BOA_API_KEY in .env'} onClick={() => inspect(state.url, { ai: true })}>
            <Icon id="ai" />Explain with AI
          </button>
          <a className="btn" href={state.url} target="_blank" rel="noopener">Open page ↗</a>
        </div>

        {state.ai && <AiExplanation ai={state.ai} />}
        <SearchVisibility audit={audit} model={config?.model} url={state.url} />
        {p && <Indexing page={p} />}
        {p && p.title !== undefined && <OnPage page={p} />}
        {state.live && <LiveTest live={state.live} />}
      </div>
    </>
  );
}

function AiExplanation({ ai }) {
  return (
    <Section icon="ai" color="var(--accent)" title="AI explanation" open>
      <div className="pad" style={{ paddingTop: 0 }}>
        {ai.error ? <Msg kind="bad" icon="bad">AI: {ai.error}</Msg> : (
          <>
            <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{ai.verdict}</p>
            <p style={{ margin: '0 0 10px', color: 'var(--ink-2)' }}>{ai.explanation}</p>
            {ai.steps?.length > 0 && (
              <ol style={{ margin: 0, paddingLeft: 20 }}>{ai.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ol>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function SearchVisibility({ audit, model, url }) {
  const search = searchOrPrevious(audit, model);
  if (!search) return null;
  const ks = keywords(search).filter((k) => k.page === url);
  const sug = sortedSuggestions(search).filter((x) => x.page === url);
  const qs = (search.questions || []).filter((q) => q.page === url);
  return (
    <Section icon="perf" color="var(--accent)" title="Search visibility" note={`${plural(ks.length, 'keyword')} · ${plural(sug.length + qs.length, 'recommendation')}`} open>
      {ks.length ? (
        <table>
          <thead><tr><th>Keyword</th><th>Demand</th><th className="hide-sm">On-page (measured)</th><th className="num">Visibility</th></tr></thead>
          <tbody>
            {ks.map((k) => (
              <tr key={k.keyword}>
                <td style={{ fontWeight: 500 }}>{k.keyword}</td><td><Level value={k.demand} /></td>
                <td className="hide-sm"><Coverage value={k.coverage} /></td><td className="num"><VisBar value={vis(k)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="pad muted" style={{ paddingTop: 0 }}>The AI didn't map any keywords to this URL.</div>}
      {sug.length > 0 && (
        <>
          <div className="table-h"><h3>Suggestions for this page</h3></div>
          <table><tbody>
            {sug.map((x, i) => (
              <tr key={i}>
                <td>{x.title}{x.suggested && <div className="muted" style={{ fontSize: 12 }}>→ {x.suggested}</div>}</td>
                <td className="num"><ImpactChip impact={x.impact} /></td>
              </tr>
            ))}
          </tbody></table>
        </>
      )}
      {qs.length > 0 && (
        <>
          <div className="table-h"><h3>Questions to answer here</h3></div>
          <table><tbody>{qs.map((q, i) => <tr key={i}><td>{q.question}</td></tr>)}</tbody></table>
        </>
      )}
    </Section>
  );
}

function Indexing({ page: p }) {
  const fetchChip = p.status === 200 ? <Chip kind="good">Successful</Chip>
    : p.status ? <Chip kind={p.status < 400 ? 'warn' : 'bad'}>{`HTTP ${p.status}`}</Chip>
    : <Chip kind="bad">{p.error || 'Failed'}</Chip>;
  return (
    <Section icon={p.indexable ? 'ok' : 'bad'} color={p.indexable ? 'var(--good-ink)' : 'var(--bad-ink)'} title="Page indexing" note={p.indexable ? 'Page is indexable' : p.reasonText}>
      <div className="kv">
        <div className="sec">Discovery</div>
        <div>Sitemaps</div><div>{p.inSitemap ? 'Listed in sitemap' : 'Not in any sitemap'}</div>
        <div>Referring pages</div>
        <div>
          {p.referrers?.length ? p.referrers.slice(0, 5).map((u) => <InspectLink key={u} url={u} block />) : 'None detected'}
          {p.inlinks > 5 && <span className="muted">+{p.inlinks - 5} more</span>}
        </div>
        <div>Click depth from start</div><div>{p.depth}</div>
        <div className="sec">Crawl</div>
        <div>Last crawl</div><div>{fmtDate(p.crawledAt)}</div>
        <div>Crawl allowed?</div><div>{p.blockedByRobots ? <Chip kind="bad">No: blocked by robots.txt</Chip> : 'Yes'}</div>
        <div>Page fetch</div><div>{fetchChip}{p.redirectTo && <> → <InspectLink url={p.redirectTo} /></>}</div>
        <div>Indexing allowed?</div><div>{p.noindex ? <Chip kind="bad">No: 'noindex' detected</Chip> : 'Yes'}</div>
        <div className="sec">Indexing</div>
        <div>User-declared canonical</div><div>{p.canonical || 'None'}</div>
        {p.duplicateOf && <><div>Duplicate of</div><div><InspectLink url={p.duplicateOf} /></div></>}
        <div>Response</div><div>{fmtMs(p.ms)} · {fmtKB(p.bytes)} · {p.contentType || '–'}</div>
      </div>
    </Section>
  );
}

function OnPage({ page: p }) {
  return (
    <Section icon="pages" title="On-page" note={`${n(p.words)} words`}>
      <div className="kv">
        <div>Title</div><div>{p.title || <Chip kind="bad">Missing</Chip>}</div>
        <div>Description</div><div>{p.description || <Chip kind="warn">Missing</Chip>}</div>
        <div>H1</div><div>{(p.h1 || []).join(' · ') || <Chip kind="warn">Missing</Chip>}</div>
        <div>Language</div><div>{p.lang || '–'}</div>
        <div>Mobile viewport</div><div>{p.viewport ? 'Yes' : <Chip kind="bad">No</Chip>}</div>
        <div>Images without alt</div><div>{p.imagesNoAlt} of {p.images}</div>
      </div>
    </Section>
  );
}

function LiveTest({ live }) {
  const ok = !live.error;
  const checks = ok ? [...live.checks.filter((c) => c.status !== 'pass'), ...live.checks.filter((c) => c.status === 'pass')] : [];
  return (
    <Section icon="refresh" title="Live test" note={ok ? `${live.checks.filter((c) => c.status === 'pass').length}/${live.checks.length} checks pass` : 'failed'} open>
      {ok ? (
        <table><tbody>
          {checks.map((c) => (
            <tr key={c.id}><td style={{ width: 130 }}><CheckChip status={c.status} /></td><td>{c.title}</td><td className="dim hide-sm">{c.detail}</td></tr>
          ))}
        </tbody></table>
      ) : <div className="pad"><Msg kind="bad" icon="bad">Live test: {live.error}</Msg></div>}
    </Section>
  );
}
