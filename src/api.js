async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listProjects: () => request('/api/projects'),
  createProject: (data) => request('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  getProject: (id) => request(`/api/projects/${id}`),

  createSpace: (projectId, data) =>
    request(`/api/projects/${projectId}/spaces`, { method: 'POST', body: JSON.stringify(data) }),
  updateSpace: (id, data) => request(`/api/spaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Resolves to { spaces, adjacencies } — the removed subtree, so a delete can
  // be undone by handing it straight back to restoreSpaces.
  deleteSpace: (id) => request(`/api/spaces/${id}`, { method: 'DELETE' }),
  restoreSpaces: (projectId, data) =>
    request(`/api/projects/${projectId}/spaces/restore`, { method: 'POST', body: JSON.stringify(data) }),

  // Independent Brief tree (the "Brief" tab), separate from diagram `spaces`.
  createBriefSpace: (projectId, data) =>
    request(`/api/projects/${projectId}/brief-spaces`, { method: 'POST', body: JSON.stringify(data) }),
  updateBriefSpace: (id, data) => request(`/api/brief-spaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBriefSpace: (id) => request(`/api/brief-spaces/${id}`, { method: 'DELETE' }),
  // Reconcile the Brief onto the diagram (preview, then apply) / snapshot it.
  briefDiff: (projectId) => request(`/api/projects/${projectId}/brief-diff`),
  applyBrief: (projectId, opts) =>
    request(`/api/projects/${projectId}/apply-brief`, { method: 'POST', body: JSON.stringify(opts || {}) }),
  pullToBrief: (projectId, spaceId) =>
    request(`/api/projects/${projectId}/pull-to-brief`, { method: 'POST', body: JSON.stringify({ spaceId }) }),
  briefMilestone: (projectId, data) =>
    request(`/api/projects/${projectId}/brief-milestone`, { method: 'POST', body: JSON.stringify(data || {}) }),
  briefFromDesign: (projectId) =>
    request(`/api/projects/${projectId}/brief-from-design`, { method: 'POST' }),

  // Brief revisions (dated copies of the whole Brief tree).
  briefRevisions: (projectId) => request(`/api/projects/${projectId}/brief-revisions`),
  saveBriefRevision: (projectId, data) =>
    request(`/api/projects/${projectId}/brief-revisions`, { method: 'POST', body: JSON.stringify(data || {}) }),
  briefRevision: (id) => request(`/api/brief-revisions/${id}`),
  deleteBriefRevision: (id) => request(`/api/brief-revisions/${id}`, { method: 'DELETE' }),

  // Brief adjacency requirements (scored against the diagram's links).
  createBriefAdjacency: (projectId, data) =>
    request(`/api/projects/${projectId}/brief-adjacencies`, { method: 'POST', body: JSON.stringify(data) }),
  deleteBriefAdjacency: (id) => request(`/api/brief-adjacencies/${id}`, { method: 'DELETE' }),

  // Change log (programme edits audit trail).
  changes: (projectId, limit = 50) => request(`/api/projects/${projectId}/changes?limit=${limit}`),

  // Design options (Option A / B schemes).
  options: (projectId) => request(`/api/projects/${projectId}/options`),
  saveOption: (projectId, name) =>
    request(`/api/projects/${projectId}/options`, { method: 'POST', body: JSON.stringify({ name }) }),
  loadOption: (projectId, optionId, opts) =>
    request(`/api/projects/${projectId}/options/${optionId}/load`, { method: 'POST', body: JSON.stringify(opts || {}) }),
  deleteOption: (id) => request(`/api/options/${id}`, { method: 'DELETE' }),

  getSettings: () => request('/api/settings'),
  saveSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  geocode: (q) => request(`/api/geocode?q=${encodeURIComponent(q)}`),

  createAdjacency: (projectId, data) =>
    request(`/api/projects/${projectId}/adjacencies`, { method: 'POST', body: JSON.stringify(data) }),
  updateAdjacency: (id, data) =>
    request(`/api/adjacencies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdjacency: (id) => request(`/api/adjacencies/${id}`, { method: 'DELETE' }),

  createImage: (projectId, data) =>
    request(`/api/projects/${projectId}/images`, { method: 'POST', body: JSON.stringify(data) }),
  updateImage: (id, data) => request(`/api/images/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteImage: (id) => request(`/api/images/${id}`, { method: 'DELETE' }),
  getImageData: (id) => request(`/api/images/${id}/data`),

  createSnapshot: (projectId, data) =>
    request(`/api/projects/${projectId}/snapshots`, { method: 'POST', body: JSON.stringify(data) }),
  updateSnapshot: (id, data) => request(`/api/snapshots/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSnapshot: (id) => request(`/api/snapshots/${id}`, { method: 'DELETE' }),
};
