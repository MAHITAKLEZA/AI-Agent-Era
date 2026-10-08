async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

export const api = {
  config: () => request('/api/config'),
  models: () => request('/api/models'),
  setModel: (model) => request('/api/model', { method: 'POST', body: JSON.stringify({ model }) }),
  sites: () => request('/api/sites'),
  audit: (id) => request(`/api/audit/${id}`),
  startAudit: (url, ai) => request('/api/audit', { method: 'POST', body: JSON.stringify({ url, ai }) }),
  analyze: (auditId) => request('/api/analyze', { method: 'POST', body: JSON.stringify({ auditId }) }),
  job: (id) => request(`/api/job/${id}`),
  inspect: (auditId, url, opts = {}) =>
    request('/api/inspect', { method: 'POST', body: JSON.stringify({ auditId, url, live: !!opts.live, ai: !!opts.ai }) }),
};
