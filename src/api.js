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
  deleteSpace: (id) => request(`/api/spaces/${id}`, { method: 'DELETE' }),

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
