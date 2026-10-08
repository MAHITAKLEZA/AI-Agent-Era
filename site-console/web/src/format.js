export const fmtMs = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const fmtKB = (b) => (b == null ? '–' : b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);
export const fmtDate = (t) =>
  new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const n = (v) => (v ?? 0).toLocaleString();
export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function short(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search || '/';
  } catch {
    return url;
  }
}
