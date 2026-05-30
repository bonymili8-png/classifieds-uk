// Клієнт API + локальне сховище (збережені оголошення та токени редагування).

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* порожня відповідь */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `Помилка ${res.status}`);
  }
  return data;
}

export const api = {
  list(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== '' && v != null) q.set(k, v);
    });
    return request('/api/listings?' + q.toString());
  },
  get(id) {
    return request('/api/listings/' + encodeURIComponent(id));
  },
  create(payload) {
    return request('/api/listings', { method: 'POST', body: JSON.stringify(payload) });
  },
  update(id, payload) {
    return request('/api/listings/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) });
  },
  remove(id, editToken) {
    return request('/api/listings/' + encodeURIComponent(id), {
      method: 'DELETE', body: JSON.stringify({ editToken }),
    });
  },
};

/* -------------------- Локальне сховище -------------------- */
const FAV_KEY = 'ouk:favs';
const MINE_KEY = 'ouk:mine'; // { [id]: { editToken, title, createdAt } }

export const store = {
  favs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
  },
  isFav(id) { return this.favs().includes(id); },
  toggleFav(id) {
    const f = this.favs();
    const i = f.indexOf(id);
    if (i === -1) f.push(id); else f.splice(i, 1);
    localStorage.setItem(FAV_KEY, JSON.stringify(f));
    return i === -1;
  },
  mine() {
    try { return JSON.parse(localStorage.getItem(MINE_KEY)) || {}; } catch { return {}; }
  },
  addMine(id, editToken, title) {
    const m = this.mine();
    m[id] = { editToken, title, createdAt: new Date().toISOString() };
    localStorage.setItem(MINE_KEY, JSON.stringify(m));
  },
  tokenFor(id) {
    const m = this.mine();
    return m[id] && m[id].editToken;
  },
  removeMine(id) {
    const m = this.mine();
    delete m[id];
    localStorage.setItem(MINE_KEY, JSON.stringify(m));
  },
};
