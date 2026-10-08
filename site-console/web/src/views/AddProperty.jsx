import { useState } from 'react';
import { Icon, Msg } from '../components/ui.jsx';

export function CrawlProgress({ job }) {
  const stages = job.analyzeOnly ? ['AI analysis'] : ['Crawling site', 'Building reports', ...(job.ai ? ['AI analysis'] : [])];
  const cur = stages.findIndex((s) => (job.stage || '').startsWith(s));
  const pct = Math.round((job.progress || 0) * 100);
  return (
    <div className="card add">
      <h1>{job.analyzeOnly ? 'Analyzing' : 'Crawling'} {job.url.replace(/^https?:\/\//, '')}</h1>
      <p>{job.stage}{job.detail && <span className="muted"> · {job.detail}</span>}</p>
      <div className="pbar"><span style={{ width: `${pct}%` }} /></div>
      <div className="muted" style={{ fontSize: 12 }}>{pct}% · {job.elapsed || 0}s</div>
      <div className="stages">
        {stages.map((s, i) => (
          <div key={s} className={i < cur ? 'done' : i === cur ? 'now' : ''}>
            {i < cur ? <Icon id="ok" /> : i === cur ? <span className="sp" /> : <span style={{ width: 15, display: 'inline-block' }} />}
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AddProperty({ config, hasAudit, error, onStart, onCancel }) {
  const [url, setUrl] = useState('');
  const [useAi, setUseAi] = useState(true);
  const aiEnabled = !!config?.aiEnabled;

  return (
    <div className="card add">
      <h1>{hasAudit ? 'Add a property' : 'Welcome to Site Console'}</h1>
      <p>Enter a website to crawl. AI (Gemini or Claude Haiku) estimates its keyword visibility and top pages, and recommends suggestions and questions to target.</p>
      <form onSubmit={(e) => { e.preventDefault(); onStart(url, aiEnabled && useAi); }}>
        <div className="field">
          <Icon id="globe" />
          <input placeholder="https://example.com" required autoFocus aria-label="Website URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="opts">
          <label className="toggle" title={aiEnabled ? '' : 'Set GEMINI_API_KEY or BOA_API_KEY in .env'}>
            <input type="checkbox" checked={aiEnabled && useAi} disabled={!aiEnabled} onChange={(e) => setUseAi(e.target.checked)} /> AI analysis
          </label>
          <span className="muted" style={{ fontSize: 12 }}>Up to {config?.maxPages ?? 50} pages · about 1–2 minutes</span>
        </div>
        <button className="btn primary">Start crawl</button>
        {hasAudit && <> <button type="button" className="btn" onClick={onCancel}>Cancel</button></>}
      </form>
      {error && <div style={{ marginTop: 14 }}><Msg kind="bad" icon="bad">{error}</Msg></div>}
    </div>
  );
}
