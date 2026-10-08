import { useRef, useState, useLayoutEffect } from 'react';
import { useNav } from '../nav.js';
import { fmtDate, short } from '../format.js';

export const Icon = ({ id, style }) => (
  <svg style={style} aria-hidden="true">
    <use href={`#i-${id}`} />
  </svg>
);

const STATUS = { good: ['ok', 'Good'], warn: ['warn', 'Needs improvement'], bad: ['bad', 'Poor'] };

/** Status pill: always an icon plus a label, never colour alone. */
export const Chip = ({ kind, children }) => (
  <span className={`chip ${kind}`}>
    {STATUS[kind] && <Icon id={STATUS[kind][0]} />}
    {children ?? STATUS[kind]?.[1]}
  </span>
);

export const AiChip = ({ children = 'AI' }) => (
  <span className="chip ai">
    <Icon id="ai" />
    {children}
  </span>
);

export const CheckChip = ({ status }) =>
  status === 'pass' ? <Chip kind="good">Pass</Chip> : status === 'error' ? <Chip kind="bad">Error</Chip> : <Chip kind="warn">Warning</Chip>;

export const ImpactChip = ({ impact }) => (
  <Chip kind={impact === 'high' ? 'bad' : impact === 'medium' ? 'warn' : 'good'}>{`${impact || '?'} impact`}</Chip>
);

export const Level = ({ value }) =>
  value === 'high' ? <Chip kind="good">High</Chip> : value === 'medium' ? <Chip kind="warn">Medium</Chip> : <span className="chip neutral">Low</span>;

export const VisBar = ({ value }) => (
  <div className="match">
    <span>{value}</span>
    <div className="mb">
      <span style={{ width: `${value}%` }} />
    </div>
  </div>
);

const COVERAGE = [['title', 'Title'], ['h1', 'H1'], ['description', 'Desc'], ['url', 'URL']];

/** Measured on-page checks: is the keyword in the title, H1, description and URL? */
export function Coverage({ value }) {
  if (!value) return <span className="muted">–</span>;
  return (
    <span className="cov">
      {COVERAGE.map(([k, label]) => (
        <span key={k} className={value[k] ? 'on' : ''} title={`${label}: keyword ${value[k] ? 'present' : 'missing'}`}>
          {value[k] ? '✓' : '✗'} {label}
        </span>
      ))}
    </span>
  );
}

export function SegBar({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="seg-bar" role="img" aria-label={parts.map((p) => `${p.name}: ${p.value}`).join(', ')}>
      {parts.filter((p) => p.value).map((p) => (
        <span key={p.name} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.name}: ${p.value}`} />
      ))}
    </div>
  );
}

export const VIS_PARTS = (bands) => [
  { name: 'Strong', value: bands[0], color: 'var(--good)' },
  { name: 'Moderate', value: bands[1], color: 'var(--warn)' },
  { name: 'Weak', value: bands[2], color: 'var(--bad)' },
];

/** Opens URL inspection for a page, or marks a suggestion for a page that doesn't exist yet. */
export function PageLink({ url, maxWidth = 260 }) {
  const { inspect } = useNav();
  if (!url || url === 'new page') return <AiChip>New page</AiChip>;
  return (
    <a href="#" className="url" style={{ maxWidth }} title={url} onClick={(e) => { e.preventDefault(); e.stopPropagation(); inspect(url); }}>
      {short(url) === '/' ? 'Homepage' : short(url)}
    </a>
  );
}

export const Msg = ({ kind = 'info', icon, children }) => (
  <div className={`msg ${kind}`}>
    {icon && <Icon id={icon} />}
    <span>{children}</span>
  </div>
);

export function Header({ audit, title, sub }) {
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `site-console-${audit.site}-${audit.id}.json`,
    });
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <div className="page-h">
      <div>
        <h1>{title}</h1>
        <div className="sub">
          {audit.site} · crawled {fmtDate(audit.time)}
          {sub ? ` · ${sub}` : ''}
        </div>
      </div>
      <button className="btn sm" onClick={exportJson}>
        <Icon id="dl" />
        Export
      </button>
    </div>
  );
}

export const CardFooter = ({ onClick, children }) => (
  <div className="card-f">
    <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}>{children}</a>
  </div>
);

/* ---------- Line chart with crosshair tooltip ---------- */

const niceTop = (raw) => {
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw);
};

export function LineChart({ points, color, name, yMax, height = 180 }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) {
    return <div ref={ref}><Msg>Crawl this property at least twice to see a trend.</Msg></div>;
  }
  const W = width, H = height, L = 48, R = 64, T = 10, B = 24;
  const top = yMax ?? niceTop(Math.max(...points.map((p) => p.v ?? 0)) * 1.1 || 1);
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const sameDay = points[points.length - 1].t - points[0].t < 86400;
  const label = (t) =>
    new Date(t * 1000).toLocaleString([], sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  const step = Math.ceil(points.length / 6);
  const line = points.map((p, i) => (p.v == null ? null : `${x(i)},${y(p.v)}`)).filter(Boolean).join(' ');
  const last = points[points.length - 1];

  const onMove = (e) => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    const i = Math.max(0, Math.min(points.length - 1, Math.round((px - L) / ((W - L - R) / (points.length - 1)))));
    setHover({ i, cx: e.clientX, cy: e.clientY });
  };

  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} height={H} style={{ display: 'block', width: '100%', overflow: 'visible' }}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v}</text>
          </g>
        ))}
        {points.map((p, i) => (i % step && i !== points.length - 1 ? null : (
          <text key={p.t} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{label(p.t)}</text>
        )))}
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {last.v != null && (
          <>
            <circle cx={x(points.length - 1)} cy={y(last.v)} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
            <text x={x(points.length - 1) + 8} y={y(last.v) + 4} fontSize="11" fill="var(--ink-2)">{name}</text>
          </>
        )}
        {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={T} y2={H - B} stroke="var(--axis)" />}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover && (
        <div className="tip" style={{ display: 'block', left: Math.min(window.innerWidth - 170, hover.cx + 14), top: hover.cy - 60 }}>
          <div className="tt">{fmtDate(points[hover.i].t)}</div>
          <div className="tr">
            <i style={{ background: color }} />
            <b>{points[hover.i].v ?? '–'}</b>
            <span>{name}</span>
          </div>
        </div>
      )}
    </div>
  );
}
