import { useNav } from '../nav.js';
import { analysisOf } from '../search.js';
import { Icon, Msg } from '../components/ui.jsx';

/** Shown when the selected model has no usable analysis of this crawl: its error, or a button to run it. */
export function SearchMissing({ audit, config }) {
  const { analyze } = useNav();
  const model = (config?.model || '').replace(/^google\//, '');  // display name
  if (!config?.aiEnabled) return <Msg icon="ai">Add GEMINI_API_KEY (Gemini) or BOA_API_KEY (Claude Haiku, Routeriva) to .env to enable AI.</Msg>;
  const failed = analysisOf(audit, config?.model)?.error;
  return (
    <>
      {failed
        ? <Msg kind="bad" icon="bad">{model} analysis failed: {failed}</Msg>
        : <Msg icon="ai">{model} hasn't analyzed this crawl yet.</Msg>}
      <button className="btn" style={{ marginTop: 12 }} onClick={() => analyze(audit.id)}>
        <Icon id="ai" />{failed ? 'Try again' : 'Run analysis'} with {model}
      </button>
    </>
  );
}
