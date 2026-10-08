import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { NavContext } from './nav.js';
import Sidebar from './components/Sidebar.jsx';
import { Icon } from './components/ui.jsx';
import Performance from './views/Performance.jsx';
import Inspect from './views/Inspect.jsx';
import History from './views/History.jsx';
import AddProperty, { CrawlProgress } from './views/AddProperty.jsx';

const VIEWS = ['performance', 'inspect', 'history'];
const THEME_KEY = 'sc-theme-v2';

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [modelGroups, setModelGroups] = useState([]);
  const [sites, setSites] = useState([]);
  const [audit, setAudit] = useState(null);
  const [view, setView] = useState('performance');
  const [tab, setTab] = useState('keywords');
  const [inspection, setInspection] = useState(null);
  const [job, setJob] = useState(null);
  const [crawlError, setCrawlError] = useState('');
  const [sideOpen, setSideOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  const polling = useRef(false);
  const inspectionRef = useRef(null);
  const updateInspection = useCallback((next) => {
    inspectionRef.current = next;
    setInspection(next);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }, [theme]);

  // Keep the URL hash in sync so views can be bookmarked: #<auditId>/<view>
  useEffect(() => {
    if (audit && VIEWS.includes(view)) history.replaceState(null, '', `#${audit.id}/${view}`);
  }, [audit, view]);

  const loadSites = useCallback(async () => {
    const list = await api.sites().catch(() => []);
    setSites(list);
    return list;
  }, []);

  const openAudit = useCallback(async (id, nextView) => {
    try {
      const a = await api.audit(id);
      setAudit(a);
      updateInspection(null);
      setView((v) => nextView || (VIEWS.includes(v) ? v : 'performance'));
      window.scrollTo(0, 0);
    } catch {
      setView('add');
    }
  }, [updateInspection]);

  useEffect(() => {
    (async () => {
      setConfig(await api.config().catch(() => null));
      api.models().then((m) => setModelGroups(m.groups || [])).catch(() => {});
      const list = await loadSites();
      const [id, hashView] = location.hash.slice(1).split('/');
      if (id) await openAudit(id, VIEWS.includes(hashView) ? hashView : 'performance');
      else if (list.length) await openAudit(list[0].latest.id, 'performance');
      else setView('add');
      setReady(true);
    })();
  }, [loadSites, openAudit]);

  const go = useCallback((next, opts = {}) => {
    if (opts.tab) setTab(opts.tab);
    setView(next);
    setSideOpen(false);
    window.scrollTo(0, 0);
  }, []);

  const inspect = useCallback(async (rawUrl, opts = {}) => {
    if (!audit || !rawUrl) return;
    let url;
    try { url = new URL(rawUrl, `https://${audit.site}`).href; } catch { return; }
    setView('inspect');
    window.scrollTo(0, 0);
    // Keep an earlier live test / AI answer for the same URL when running the other one.
    const cur = inspectionRef.current;
    const previous = cur && cur.url === url && !cur.loading ? cur : null;
    updateInspection({ url, loading: opts.live ? 'Running live test…' : opts.ai ? 'Asking AI…' : 'Retrieving data…' });
    const res = await api.inspect(audit.id, url, opts).catch((e) => ({ error: e.message }));
    updateInspection({ ...(previous || {}), ...res, url, loading: null });
  }, [audit, updateInspection]);

  // Show a job's progress until it finishes, then open the audit it produced.
  const followJob = useCallback(async (jobId, meta, doneView) => {
    const t0 = Date.now();
    setJob({ stage: 'Starting', progress: 0, ...meta });
    polling.current = true;
    while (polling.current) {
      await new Promise((r) => setTimeout(r, 1000));
      const j = await api.job(jobId).catch(() => null);
      if (!j) continue;
      if (j.status === 'done') {
        polling.current = false;
        setJob(null);
        await loadSites();
        await openAudit(j.auditId, doneView);
        return;
      }
      if (j.status === 'error') {
        polling.current = false;
        setJob(null);
        setCrawlError(`${meta.analyzeOnly ? 'Analysis' : 'Crawl'} failed: ${j.error}`);
        setView('add');
        return;
      }
      setJob({ ...j, ...meta, elapsed: Math.round((Date.now() - t0) / 1000) });
    }
  }, [loadSites, openAudit]);

  const startCrawl = useCallback(async (url, useAi) => {
    setCrawlError('');
    let jobId;
    try {
      ({ job: jobId } = await api.startAudit(url, useAi));
    } catch (e) {
      setCrawlError(e.message);
      setView('add');
      return;
    }
    await followJob(jobId, { url, ai: useAi }, 'performance');
  }, [followJob]);

  // Run the AI analysis on an existing crawl with the selected model.
  const analyze = useCallback(async (auditId) => {
    let jobId;
    try {
      ({ job: jobId } = await api.analyze(auditId));
    } catch (e) {
      alert(`Couldn't start the analysis: ${e.message}`);
      return;
    }
    await followJob(jobId, { url: audit?.url || '', analyzeOnly: true }, 'performance');
  }, [followJob, audit]);

  useEffect(() => () => { polling.current = false; }, []);

  const nav = useMemo(() => ({ go, inspect, openAudit, analyze }), [go, inspect, openAudit, analyze]);
  const model = config?.model || '';

  const changeModel = useCallback(async (next) => {
    let previous;
    // Show the pick right away; the server confirms it (or we roll back).
    setConfig((c) => { previous = c?.model; return { ...c, model: next }; });
    try {
      const { active } = await api.setModel(next);
      setConfig((c) => ({ ...c, model: active }));
    } catch (e) {
      setConfig((c) => ({ ...c, model: previous }));
      alert(`Couldn't switch model: ${e.message}`);
    }
  }, []);

  let content;
  if (!ready) content = null;
  else if (job) content = <CrawlProgress job={job} />;
  else if (view === 'add' || !audit) {
    content = (
      <AddProperty config={config} hasAudit={!!audit} error={crawlError} onStart={startCrawl}
        onCancel={() => go('performance')} />
    );
  } else if (view === 'inspect') content = <Inspect audit={audit} config={config} state={inspection} />;
  else if (view === 'history') content = <History audit={audit} />;
  else content = <Performance audit={audit} config={config} tab={tab} setTab={setTab} />;

  return (
    <NavContext.Provider value={nav}>
      <div className="app">
        <Sidebar open={sideOpen} view={job ? 'add' : view} sites={sites} audit={audit} model={model}
          modelGroups={modelGroups} onModelChange={changeModel}
          onNavigate={go} onSelectSite={(id) => { setSideOpen(false); openAudit(id, 'performance'); }}
          onAdd={() => { setCrawlError(''); go('add'); }} />
        <div className="main">
          <div className="top">
            <button className="icon-btn menu-btn" aria-label="Menu" onClick={() => setSideOpen((o) => !o)}><Icon id="menu" /></button>
            <form className="search" onSubmit={(e) => { e.preventDefault(); inspect(query.trim()); setQuery(''); }}>
              <Icon id="search" />
              <input aria-label="Inspect URL" autoComplete="off" disabled={!audit} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={audit ? `Inspect any URL in “${audit.site}”` : 'Add a property first'} />
            </form>
            <div className="spacer" />
            <button className="btn" title="Re-crawl this property" disabled={!audit || !!job}
              onClick={() => startCrawl(audit.url, !!config?.aiEnabled)}>
              <Icon id="refresh" /><span>Re-crawl</span>
            </button>
            <button className="icon-btn" aria-label="Toggle dark mode" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
              <Icon id="moon" />
            </button>
          </div>
          <div className="content">{content}</div>
        </div>
      </div>
    </NavContext.Provider>
  );
}
