// Клієнт API + локальне сховище (сесія, збережені, токени редагування).

const TOKEN_KEY = 'ouk:token';

export const session = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null, // заповнюється після auth.me()
  set(token, user) {
    this.token = token; this.user = user;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new CustomEvent('auth-changed'));
  },
  clear() { this.set(null, null); },
  get isAuthed() { return !!this.token && !!this.user; },
};

async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session.token) headers.Authorization = 'Bearer ' + session.token;
  const res = await fetch(url, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch { /* порожня відповідь */ }
  if (res.status === 401 && session.token && url.includes('/auth/me')) {
    session.clear(); // протухла сесія
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Помилка ${res.status}`);
  }
  return data;
}

export const api = {
  // -- Оголошення --
  list(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v); });
    return request('/api/listings?' + q.toString());
  },
  get(id) { return request('/api/listings/' + encodeURIComponent(id)); },
  _attrCache: null,
  async attributesSchema() {
    if (!this._attrCache) { const { attributes } = await request('/api/meta/attributes'); this._attrCache = attributes; }
    return this._attrCache;
  },
  create(payload) { return request('/api/listings', { method: 'POST', body: JSON.stringify(payload) }); },
  update(id, payload) { return request('/api/listings/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) }); },
  setStatus(id, status, editToken) { return request('/api/listings/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ action: 'status', status, editToken }) }); },
  bump(id, editToken) { return request('/api/listings/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ action: 'bump', editToken }) }); },
  remove(id, editToken) { return request('/api/listings/' + encodeURIComponent(id), { method: 'DELETE', body: JSON.stringify({ editToken }) }); },

  // -- Авторизація --
  register(payload) { return request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }); },
  login(payload) { return request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }); },
  logout() { return request('/api/auth/logout', { method: 'POST' }); },
  me() { return request('/api/auth/me'); },
  updateProfile(payload) { return request('/api/auth/me', { method: 'PUT', body: JSON.stringify(payload) }); },
  forgotPassword(email) { return request('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }); },
  resetPassword(token, password) { return request('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }); },
  userProfile(id) { return request('/api/users/' + encodeURIComponent(id)); },

  // -- Відгуки --
  reviews(sellerId) { return request('/api/users/' + encodeURIComponent(sellerId) + '/reviews'); },
  addReview(sellerId, rating, text) { return request('/api/users/' + encodeURIComponent(sellerId) + '/reviews', { method: 'POST', body: JSON.stringify({ rating, text }) }); },

  // -- Повідомлення --
  threads() { return request('/api/messages'); },
  thread(id) { return request('/api/messages/' + encodeURIComponent(id)); },
  startMessage(listingId, text) { return request('/api/messages', { method: 'POST', body: JSON.stringify({ listingId, text }) }); },
  reply(threadId, text) { return request('/api/messages/' + encodeURIComponent(threadId), { method: 'POST', body: JSON.stringify({ text }) }); },
  unread() { return request('/api/messages/unread'); },

  // -- Скарги --
  report(listingId, reason, text) { return request('/api/reports', { method: 'POST', body: JSON.stringify({ listingId, reason, text }) }); },

  // -- Адмін --
  adminStats() { return request('/api/admin/stats'); },
  adminReports(resolved = false) { return request('/api/admin/reports' + (resolved ? '?resolved=1' : '')); },
  adminResolveReport(id, resolved = true) { return request('/api/admin/reports/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ resolved }) }); },
  adminDeleteListing(id) { return request('/api/admin/listings/' + encodeURIComponent(id), { method: 'DELETE' }); },
  adminBackupUrl() { return '/api/admin/backup' + (session.token ? '?token=' + encodeURIComponent(session.token) : ''); },
};

// Підвантажити поточного користувача за збереженим токеном.
export async function bootstrapSession() {
  if (!session.token) return;
  try {
    const { user } = await api.me();
    if (user) session.set(session.token, user);
    else session.clear();
  } catch { session.clear(); }
}

/* -------------------- Локальне сховище -------------------- */
const FAV_KEY = 'ouk:favs';
const MINE_KEY = 'ouk:mine'; // { [id]: { editToken, title } } — для гостьових оголошень

export const store = {
  favs() { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; } },
  isFav(id) { return this.favs().includes(id); },
  toggleFav(id) {
    const f = this.favs();
    const i = f.indexOf(id);
    if (i === -1) f.push(id); else f.splice(i, 1);
    localStorage.setItem(FAV_KEY, JSON.stringify(f));
    return i === -1;
  },
  mine() { try { return JSON.parse(localStorage.getItem(MINE_KEY)) || {}; } catch { return {}; } },
  addMine(id, editToken, title) {
    const m = this.mine();
    m[id] = { editToken, title, createdAt: new Date().toISOString() };
    localStorage.setItem(MINE_KEY, JSON.stringify(m));
  },
  tokenFor(id) { const m = this.mine(); return m[id] && m[id].editToken; },
  removeMine(id) { const m = this.mine(); delete m[id]; localStorage.setItem(MINE_KEY, JSON.stringify(m)); },
};
