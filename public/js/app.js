// Точка входу: хеш-роутер, тема, тости, делегування подій.

import { store } from './api.js';
import {
  HomeView, SearchView, DetailView, FormView, SavedView, MineView,
} from './views.js';

const viewEl = document.getElementById('view');

/* ----------------------------- Тости ----------------------------- */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ----------------------------- Тема ----------------------------- */
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme'); // системна
  }
}
function currentTheme() {
  const saved = localStorage.getItem('ouk:theme');
  if (saved) return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
applyTheme(localStorage.getItem('ouk:theme') || '');
document.getElementById('themeBtn').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ouk:theme', next);
  applyTheme(next);
});

/* ----------------------------- Роутер ----------------------------- */
// #/                -> Home
// #/search          -> Search (з query)
// #/c/:cat          -> Search у категорії
// #/l/:id           -> Detail
// #/new             -> Form (нове)
// #/edit/:id        -> Form (редагування)
// #/saved, #/mine
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));

  if (segs.length === 0) return { name: 'home', params: {}, query };
  switch (segs[0]) {
    case 'search': return { name: 'search', params: {}, query };
    case 'c':      return { name: 'search', params: { cat: segs[1] || '' }, query };
    case 'l':      return { name: 'detail', params: { id: segs[1] }, query };
    case 'new':    return { name: 'new', params: {}, query };
    case 'edit':   return { name: 'edit', params: { id: segs[1] }, query };
    case 'saved':  return { name: 'saved', params: {}, query };
    case 'mine':   return { name: 'mine', params: {}, query };
    default:       return { name: 'home', params: {}, query };
  }
}

const VIEWS = {
  home: HomeView, search: SearchView, detail: DetailView,
  new: FormView, edit: FormView, saved: SavedView, mine: MineView,
};

let renderId = 0;
async function render() {
  const ctx = parseHash();
  ctx.toast = toast;
  const view = VIEWS[ctx.name] || HomeView;
  const myId = ++renderId;

  // Синхронізуємо поле пошуку в шапці
  const si = document.getElementById('searchInput');
  if (ctx.name === 'search') si.value = ctx.query.q || '';

  try {
    const html = await view.render(ctx);
    if (myId !== renderId) return; // встигла прийти новіша навігація
    viewEl.innerHTML = html;
    window.scrollTo(0, 0);
    if (view.mount) await view.mount(viewEl, ctx);
  } catch (e) {
    viewEl.innerHTML = `<div class="container"><div class="alert alert-error mt24">Помилка: ${e.message}</div></div>`;
  }
  updateTabbar(ctx);
}

function updateTabbar(ctx) {
  const map = { home: 'home', search: 'search', new: 'new', edit: 'new', saved: 'saved', mine: 'mine' };
  const active = map[ctx.name];
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === active));
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
render();

/* ----------------------- Делегування подій ----------------------- */

// Кнопка «зберегти» на картках
document.addEventListener('click', (e) => {
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    e.preventDefault();
    const on = store.toggleFav(fav.dataset.fav);
    fav.classList.toggle('on', on);
    toast(on ? 'Додано до збережених ★' : 'Прибрано зі збережених');
  }
});

// Пошук у шапці
document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  location.hash = '#/search?' + new URLSearchParams(q ? { q } : {}).toString();
});
