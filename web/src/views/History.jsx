import { useNav } from '../nav.js';
import { fmtDate, plural } from '../format.js';
import { AiChip, Header, LineChart } from '../components/ui.jsx';

export default function History({ audit }) {
  const { openAudit } = useNav();
  const hist = (audit.history || []).filter((h) => h.v === 2);

  return (
    <>
      <Header audit={audit} title="History" sub={plural(hist.length, 'crawl')} />
      <div className="row cols-2">
        <div className="card">
          <div className="card-h"><h2>Average keyword visibility</h2><AiChip>AI estimate</AiChip></div>
          <div className="chart">
            <LineChart name="Visibility" color="var(--s4)" yMax={100} points={hist.map((h) => ({ t: h.time, v: h.visibility }))} />
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Indexable pages</h2><span className="note">Measured</span></div>
          <div className="chart">
            <LineChart name="Indexable" color="var(--s3)" points={hist.map((h) => ({ t: h.time, v: h.indexed }))} />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="table-h"><h3>All crawls</h3></div>
        <table>
          <thead>
            <tr><th>When</th><th className="num">Pages</th><th className="num">Indexable</th><th className="num hide-sm">Keywords</th><th className="num">Avg. visibility</th></tr>
          </thead>
          <tbody>
            {hist.slice().reverse().map((h) => (
              <tr key={h.id} className="click" onClick={() => openAudit(h.id)}>
                <td>{fmtDate(h.time)} {h.id === audit.id && <span className="chip neutral">viewing</span>}</td>
                <td className="num">{h.pages}</td>
                <td className="num">{h.indexed}</td>
                <td className="num hide-sm">{h.keywords ?? '–'}</td>
                <td className="num">{h.visibility ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
