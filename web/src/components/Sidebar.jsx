import { Icon } from './ui.jsx';

const NAV = [
  ['performance', 'perf', 'Search performance', 'AI'],
  ['inspect', 'search', 'URL inspection'],
  ['history', 'hist', 'History'],
];

export default function Sidebar({ open, view, sites, audit, model, modelGroups, onModelChange, onNavigate, onSelectSite, onAdd }) {
  const current = view === 'add' || !audit ? '__add' : audit.id;
  const siteOptions = sites.map((s) => ({ id: s.host === audit?.site ? audit.id : s.latest.id, host: s.host }));

  return (
    <aside className={open ? 'open' : ''}>
      <div className="brand">
        <svg viewBox="0 0 26 26" aria-hidden="true">
          <rect width="26" height="26" rx="7" fill="var(--accent)" />
          <path d="M6 17a7 7 0 1 1 14 0" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M13 17l3.6-4.4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        Site Console
      </div>
      <label className="prop">
        <Icon id="globe" />
        <select aria-label="Property" value={current} onChange={(e) => (e.target.value === '__add' ? onAdd() : onSelectSite(e.target.value))}>
          {siteOptions.map((s) => <option key={s.host} value={s.id}>{s.host}</option>)}
          <option value="__add">＋ Add property</option>
        </select>
      </label>
      <nav className="nav" style={audit ? undefined : { opacity: 0.4, pointerEvents: 'none' }}>
        {NAV.map(([id, icon, label, tag]) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => onNavigate(id)}>
            <Icon id={icon} />
            {label}
            {tag && <span className="tag">{tag}</span>}
          </button>
        ))}
      </nav>
      <div style={{ marginTop: 'auto', paddingTop: 12 }}>
        <div className="muted" style={{ padding: '0 12px 6px', fontSize: 12 }}>AI model</div>
        {modelGroups?.length ? (
          <label className="prop">
            <Icon id="ai" />
            <select aria-label="AI model" value={model} onChange={(e) => onModelChange(e.target.value)}>
              {!modelGroups.some((g) => g.model === model) && <option value={model}>{model}</option>}
              {modelGroups.map((g) => <option key={g.model} value={g.model}>{g.label} · {g.name || g.model}</option>)}
            </select>
          </label>
        ) : <div className="muted" style={{ padding: '0 12px', fontSize: 12 }}>{model}</div>}
      </div>
    </aside>
  );
}
