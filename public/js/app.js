// Точка входу: хеш-роутер, тема, мова, сесія, тости, делегування подій.

import { store, session, bootstrapSession, api } from './api.js';
import {
  HomeView, SearchView, DetailView, FormView, SavedView, MineView,
  ProfileView, UserView, AuthView, ChatsView, ChatView, AdminView,
  ForgotView, ResetView,
} from './views.js';
import { t, getLang, setLang } from './i18n.js';

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
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
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

/* ----------------------------- Мова ----------------------------- */
const langBtn = document.getElementById('langBtn');
function refreshLangBtn() { if (langBtn) langBtn.textContent = getLang() === 'uk' ? 'EN' : 'UA'; }
refreshLangBtn();
if (langBtn) langBtn.addEventListener('click', () => {
  setLang(getLang() === 'uk' ? 'en' : 'uk');
  refreshLangBtn();
  applyStaticText();
  render();
});

// Оновлення статичних підписів у шапці/таб-барі під час зміни мови.
function applyStaticText() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  const si = document.getElementById('searchInput');
  if (si) si.placeholder = t('search.placeholder');
  const sb = document.querySelector('.search-btn');
  if (sb) sb.textContent = t('search.btn');
}

/* ----------------------------- Роутер ----------------------------- */
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
    case 'u':      return { name: 'user', params: { id: segs[1] }, query };
    case 'new':    return { name: 'new', params: {}, query };
    case 'edit':   return { name: 'edit', params: { id: segs[1] }, query };
    case 'saved':  return { name: 'saved', params: {}, query };
    case 'mine':   return { name: 'mine', params: {}, query };
    case 'profile': return { name: 'profile', params: {}, query };
    case 'login':  return { name: 'login', params: {}, query };
    case 'register': return { name: 'register', params: {}, query };
    case 'forgot': return { name: 'forgot', params: {}, query };
    case 'reset':  return { name: 'reset', params: {}, query };
    case 'chats':  return { name: 'chats', params: {}, query };
    case 'chat':   return { name: 'chat', params: { id: segs[1] }, query };
    case 'admin':  return { name: 'admin', params: {}, query };
    default:       return { name: 'home', params: {}, query };
  }
}

const VIEWS = {
  home: HomeView, search: SearchView, detail: DetailView,
  new: FormView, edit: FormView, saved: SavedView, mine: MineView,
  profile: ProfileView, user: UserView, login: AuthView, register: AuthView,
  forgot: ForgotView, reset: ResetView,
  chats: ChatsView, chat: ChatView, admin: AdminView,
};

let renderId = 0;
async function render() {
  const ctx = parseHash();
  ctx.toast = toast;
  const view = VIEWS[ctx.name] || HomeView;
  const myId = ++renderId;

  const si = document.getElementById('searchInput');
  if (ctx.name === 'search') si.value = ctx.query.q || '';

  try {
    const html = await view.render(ctx);
    if (myId !== renderId) return;
    if (html != null) {
      viewEl.innerHTML = html;
      window.scrollTo(0, 0);
      if (view.mount) await view.mount(viewEl, ctx);
    }
  } catch (e) {
    viewEl.innerHTML = `<div class="container"><div class="alert alert-error mt24">${e.message}</div></div>`;
  }
  updateTabbar(ctx);
}

function updateTabbar(ctx) {
  const map = { home: 'home', search: 'search', new: 'new', edit: 'new', saved: 'saved',
    mine: 'profile', profile: 'profile', chats: 'chats', chat: 'chats', login: 'profile',
    register: 'profile', forgot: 'profile', reset: 'profile', user: 'search' };
  const active = map[ctx.name];
  document.querySelectorAll('.tab').forEach((tb) => tb.classList.toggle('active', tb.dataset.tab === active));
}

window.addEventListener('hashchange', render);

/* ----------------------- Сесія в інтерфейсі ----------------------- */
function renderAuthArea() {
  const area = document.getElementById('authArea');
  if (!area) return;
  if (session.isAuthed) {
    const initials = (session.user.name || '?').slice(0, 1).toUpperCase();
    const adminLink = session.user.isAdmin
      ? `<a class="icon-btn" href="#/admin" data-link title="${t('admin.nav')}" aria-label="${t('admin.nav')}">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/></svg></a>`
      : '';
    area.innerHTML = `${adminLink}
      <a class="icon-btn" href="#/chats" data-link title="${t('chats.title')}" style="position:relative">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M21 11.5a8.4 8.4 0 0 1-12 7.6L3 21l1.9-6A8.4 8.4 0 1 1 21 11.5Z"/></svg>
        <span class="nav-badge" id="navUnread" hidden></span></a>
      <a class="avatar-btn" href="#/profile" data-link title="${t('nav.profile')}">${session.user.avatar
        ? `<img src="${session.user.avatar}" alt="">` : initials}</a>`;
    refreshUnread();
  } else {
    area.innerHTML = `<a class="btn btn-ghost btn-sm" href="#/login" data-link>${t('auth.login')}</a>`;
  }
}

let lastUnread = 0;
async function refreshUnread() {
  if (!session.isAuthed) return;
  try {
    const { unread } = await api.unread();
    const badge = document.getElementById('navUnread');
    const tabBadge = document.getElementById('tabUnread');
    [badge, tabBadge].forEach((b) => { if (b) { b.hidden = !unread; b.textContent = unread > 9 ? '9+' : unread; } });
    // Локальне сповіщення, якщо непрочитаних побільшало і вкладка не активна.
    if (unread > lastUnread && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(t('notif.title'), {
          body: t('app.tagline'), icon: '/icons/icon-192.png', tag: 'ouk-msg', renotify: true,
        });
        n.onclick = () => { window.focus(); location.hash = '#/chats'; n.close(); };
      } catch { /* ignore */ }
    }
    lastUnread = unread;
  } catch { /* ignore */ }
}

// Запитуємо дозвіл на сповіщення (одноразово після входу).
function maybeRequestNotifications() {
  if (!session.isAuthed || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

window.addEventListener('auth-changed', renderAuthArea);

/* ----------------------- Делегування подій ----------------------- */
document.addEventListener('click', (e) => {
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    e.preventDefault();
    const on = store.toggleFav(fav.dataset.fav);
    fav.classList.toggle('on', on);
    toast(on ? t('save.added') : t('save.add'));
  }
});

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  location.hash = '#/search?' + new URLSearchParams(q ? { q } : {}).toString();
});

/* ----------------------------- Старт ----------------------------- */
applyStaticText();
renderAuthArea();
render();
bootstrapSession().then(() => { renderAuthArea(); maybeRequestNotifications(); });
// Періодично оновлюємо лічильник непрочитаних.
setInterval(refreshUnread, 20000);

// Реєстрація service worker (винесено з inline-скрипта заради CSP).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}
