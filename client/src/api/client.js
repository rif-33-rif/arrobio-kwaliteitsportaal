const BASE = '/api';

function getToken() {
  return localStorage.getItem('arro_token');
}

// Als een AUTHENTICATED verzoek (er was al een token) een 401 teruggeeft, is de
// sessie ongeldig geworden (verlopen, account geblokkeerd, etc.). Log dan
// automatisch uit in plaats van de gebruiker vast te laten zitten op een foutmelding.
function handleSessionExpired(hadToken) {
  if (!hadToken) return;
  localStorage.removeItem('arro_token');
  localStorage.removeItem('arro_user');
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) handleSessionExpired(!!token);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `Fout: ${res.status}`), data || {});
  return data;
}

async function postForm(path, formData) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  if (res.status === 401) handleSessionExpired(!!token);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `Fout: ${res.status}`), data || {});
  return data;
}

async function getBlobUrl(path) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401) handleSessionExpired(!!token);
  if (!res.ok) throw new Error(`Fout: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function download(path, suggestedFilename) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401) handleSessionExpired(!!token);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.error || `Fout: ${res.status}`), data || {});
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || suggestedFilename || 'download';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  postForm,
  getBlobUrl,
  download,
};
