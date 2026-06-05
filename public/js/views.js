// Рендер екранів. Кожен експорт має render(ctx) і опційно mount(root, ctx).

import { api, store, session } from './api.js';
import { CATEGORIES, CITIES, sorts, catLabel, formatPrice, timeAgo, esc } from './data.js';
import { t } from './i18n.js';
import { attrFieldLabel, attrValueLabel, attrSummary } from './attributes.js';

/* ============================ Дрібні частини ============================ */

const pinSvg = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>`;
const camSvg = `<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3z"/><circle cx="12" cy="13" r="3.2" fill="#fff"/></svg>`;
const starSvg = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z"/></svg>`;

// Картка БЕЗ фото — фото показуємо лише на сторінці оголошення.
export function cardHTML(l) {
  const fav = store.isFav(l.id);
  const hasPhoto = l.images && l.images.length;
  const sold = l.status === 'sold';
  const chips = attrSummary(l.category, l.attributes).slice(0, 3);
  return `
  <article class="card ${sold ? 'is-sold' : ''}">
    ${sold ? `<span class="sold-badge">${esc(t('detail.sold'))}</span>` : ''}
    <div class="card-top">
      <a class="card-cat" href="#/c/${l.category}" data-link>${esc(catLabel(l.category))}</a>
      <button class="card-fav ${fav ? 'on' : ''}" data-fav="${l.id}" aria-label="${esc(t('save.add'))}">${starSvg}</button>
    </div>
    <a href="#/l/${l.id}" data-link style="display:flex;flex-direction:column;flex:1">
      <h3 class="card-title">${esc(l.title)}</h3>
      <p class="card-desc">${esc(l.description)}</p>
      ${chips.length ? `<div class="card-chips">${chips.map((c) => `<span class="card-chip">${esc(c)}</span>`).join('')}</div>` : ''}
      <div class="card-foot">
        <span class="price ${l.isFree || l.price === 0 ? 'free' : ''}">${formatPrice(l)}</span>
        <span class="card-loc">${pinSvg}<span>${esc(l.location)}</span></span>
      </div>
      <div class="card-time">${timeAgo(l.bumpedAt || l.createdAt)}${hasPhoto ? ` · ${camSvg} ${l.images.length}` : ''}</div>
    </a>
  </article>`;
}

export function gridSkeleton(n = 8) {
  return `<div class="grid">${Array.from({ length: n }).map(() => `
    <div class="skeleton"><div class="sk-line w40"></div><div class="sk-line w90"></div><div class="sk-line w70"></div><div class="sk-line w40" style="margin-top:24px"></div></div>`).join('')}</div>`;
}

function emptyHTML(title, sub, cta = '') {
  return `<div class="empty"><div class="big">🗂️</div><h3>${esc(title)}</h3><p>${esc(sub)}</p>${cta}</div>`;
}

function footerHTML() {
  return `<footer class="footer"><div class="container">
    <p><b>ОголошенняUK</b> — ${esc(t('footer.about'))}</p>
    <p class="muted">${esc(t('footer.safety'))}</p>
  </div></footer>`;
}

function avatarHTML(user, size = 40) {
  if (!user) return '';
  const initials = (user.name || '?').trim().slice(0, 1).toUpperCase();
  if (user.avatar) return `<span class="avatar" style="width:${size}px;height:${size}px"><img src="${esc(user.avatar)}" alt=""></span>`;
  return `<span class="avatar avatar-letter" style="width:${size}px;height:${size}px;font-size:${size * 0.42}px">${esc(initials)}</span>`;
}

// Зорі рейтингу. rating = {avg, count}. interactive=true → клікабельні для вводу.
function starsHTML(avg, { interactive = false } = {}) {
  let out = '';
  for (let i = 1; i <= 5; i++) {
    const cls = i <= Math.round(avg) ? 'star on' : 'star';
    out += interactive
      ? `<button type="button" class="${cls}" data-star="${i}" aria-label="${i}">★</button>`
      : `<span class="${cls}">★</span>`;
  }
  return `<span class="stars ${interactive ? 'stars-input' : ''}">${out}</span>`;
}

function ratingBadgeHTML(rating) {
  if (!rating || !rating.count) return `<span class="rating-badge muted">${starsHTML(0)} <small>${esc(t('rev.noRating'))}</small></span>`;
  return `<span class="rating-badge">${starsHTML(rating.avg)} <b>${rating.avg}</b> <small>(${t('rev.count', { n: rating.count })})</small></span>`;
}

// Чи може поточний користувач керувати оголошенням (власник, токен, або адмін).
function canManageListing(l) {
  if (session.isAuthed && session.user.isAdmin) return true;
  if (session.isAuthed && l.owner && l.owner.id === session.user.id) return true;
  return !!store.tokenFor(l.id);
}

// Текст про термін дії для власника.
function expiryText(l) {
  if (l.status === 'expired') return t('expiry.expired');
  if (!l.expiresAt) return '';
  const days = Math.ceil((new Date(l.expiresAt).getTime() - Date.now()) / 86400000);
  if (days <= 0) return t('expiry.today');
  return t('expiry.left', { n: days });
}

// Таблиця характеристик на сторінці оголошення.
function attrsTable(attributes) {
  const entries = Object.entries(attributes || {}).filter(([, v]) => v !== '' && v != null && v !== false);
  if (!entries.length) return '';
  return `<div class="detail-card mt24"><h2 class="dc-title">${esc(t('attr.section'))}</h2>
    <dl class="attr-table">${entries.map(([k, v]) => `
      <div class="attr-row"><dt>${esc(attrFieldLabel(k))}</dt><dd>${v === true ? '✓' : esc(attrValueLabel(v))}</dd></div>`).join('')}
    </dl></div>`;
}

/* ============================ Головна ============================ */

export const HomeView = {
  async render() {
    return `
    <section class="hero"><div class="container hero-inner">
      <h1>${esc(t('app.tagline'))} 🇺🇦🇬🇧</h1>
      <p>${esc(t('app.subtitle'))}</p>
      <div class="hero-actions">
        <a class="btn btn-primary btn-lg" href="#/new" data-link>+ ${esc(t('nav.add'))}</a>
        <a class="btn btn-lg" href="#/search" data-link>${esc(t('common.allListings'))}</a>
      </div>
    </div></section>

    <div class="container">
      <div class="section-head"><h2>${esc(t('common.categories'))}</h2><a class="muted" href="#/search" data-link>${esc(t('common.allListings'))} →</a></div>
      <div class="cat-grid" id="catGrid">
        ${CATEGORIES.map((c) => `
          <a class="cat-tile" href="#/c/${c.slug}" data-link>
            <span class="emoji">${c.emoji}</span>
            <span class="name">${esc(catLabel(c.slug).replace(/^\S+\s/, ''))}</span>
            <span class="n" data-cat-count="${c.slug}">—</span>
          </a>`).join('')}
      </div>

      <div class="section-head"><h2>${esc(t('common.fresh'))}</h2><span class="count" id="freshCount"></span></div>
      <div id="freshGrid">${gridSkeleton(8)}</div>
    </div>
    ${footerHTML()}`;
  },
  async mount(root) {
    try {
      const { items, total } = await api.list({ perPage: 8, sort: 'new' });
      const grid = root.querySelector('#freshGrid');
      grid.innerHTML = items.length
        ? `<div class="grid">${items.map(cardHTML).join('')}</div>
           <div class="pagination"><a class="btn" href="#/search" data-link>${esc(t('common.viewAll'))}</a></div>`
        : emptyHTML(t('empty.title'), t('app.subtitle'),
            `<a class="btn btn-primary mt16" href="#/new" data-link>+ ${esc(t('nav.add'))}</a>`);
      root.querySelector('#freshCount').textContent = t('common.total', { n: total });
    } catch (e) {
      root.querySelector('#freshGrid').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    }
    try {
      const all = await api.list({ perPage: 48 });
      const counts = {};
      all.items.forEach((l) => { counts[l.category] = (counts[l.category] || 0) + 1; });
      root.querySelectorAll('[data-cat-count]').forEach((el) => {
        el.textContent = counts[el.dataset.catCount] || 0;
      });
    } catch { /* не критично */ }
  },
};

/* ============================ Пошук / Список ============================ */

export const SearchView = {
  async render(ctx) {
    const p = ctx.query;
    const activeCat = ctx.params.cat || p.category || '';
    const catTitle = activeCat ? catLabel(activeCat) : t('common.allListings');

    return `
    <div class="container">
      <div class="section-head"><h2>${esc(catTitle)}</h2><span class="count" id="resCount"></span></div>

      <div class="cat-scroll" id="catScroll">
        <button class="chip ${!activeCat ? 'active' : ''}" data-cat="">${esc(t('common.all'))}</button>
        ${CATEGORIES.map((c) => `<button class="chip ${activeCat === c.slug ? 'active' : ''}" data-cat="${c.slug}"><span class="emoji">${c.emoji}</span>${esc(catLabel(c.slug).replace(/^\S+\s/, ''))}</button>`).join('')}
      </div>

      <div class="toolbar mt8">
        <div class="field" style="flex:1;min-width:160px">
          <input class="input" id="fQ" placeholder="${esc(t('search.placeholder'))}" value="${esc(p.q || '')}">
        </div>
        <div class="field"><select class="select" id="fCity">
          <option value="">${esc(t('filter.anyCity'))}</option>
          ${CITIES.map((c) => `<option ${p.city === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select></div>
        <div class="field"><input class="input" id="fMin" type="number" inputmode="numeric" placeholder="${esc(t('price.from'))}" value="${esc(p.min || '')}" style="width:120px"></div>
        <div class="field"><input class="input" id="fMax" type="number" inputmode="numeric" placeholder="${esc(t('price.to'))}" value="${esc(p.max || '')}" style="width:110px"></div>
        <div class="field"><select class="select" id="fSort">
          ${sorts().map((s) => `<option value="${s.value}" ${p.sort === s.value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select></div>
        <label class="switch"><input type="checkbox" id="fFree" ${p.free === '1' ? 'checked' : ''}><span class="track"></span><span>${esc(t('filter.free'))}</span></label>
        <label class="switch"><input type="checkbox" id="fPhoto" ${p.photo === '1' ? 'checked' : ''}><span class="track"></span><span>${esc(t('filter.photo'))}</span></label>
        <button class="btn btn-ghost" id="fReset">${esc(t('common.reset'))}</button>
      </div>

      <div id="results" class="mt16">${gridSkeleton()}</div>
      <div class="pagination" id="pager"></div>
    </div>`;
  },

  async mount(root, ctx) {
    const activeCat = ctx.params.cat || ctx.query.category || '';
    const get = (id) => root.querySelector(id);
    let page = Number(ctx.query.page) || 1;

    const collect = () => ({
      q: get('#fQ').value.trim(), city: get('#fCity').value,
      min: get('#fMin').value, max: get('#fMax').value,
      sort: get('#fSort').value, free: get('#fFree').checked ? '1' : '',
      photo: get('#fPhoto').checked ? '1' : '', category: activeCat,
    });

    async function load() {
      const results = get('#results');
      results.innerHTML = gridSkeleton(6);
      try {
        const data = await api.list({ ...collect(), page, perPage: 24 });
        get('#resCount').textContent = t('common.found', { n: data.total });
        results.innerHTML = data.items.length
          ? `<div class="grid">${data.items.map(cardHTML).join('')}</div>`
          : emptyHTML(t('empty.title'), t('empty.sub'));
        renderPager(data);
      } catch (e) {
        results.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
      }
    }

    function renderPager(data) {
      const pager = get('#pager');
      if (data.pages <= 1) { pager.innerHTML = ''; return; }
      const btn = (n, label, dis = false, cur = false) =>
        `<button class="btn ${cur ? 'btn-primary' : ''}" data-page="${n}" ${dis ? 'disabled' : ''}>${label}</button>`;
      let html = btn(page - 1, '‹', page <= 1);
      for (let i = 1; i <= data.pages; i++) {
        if (i === 1 || i === data.pages || Math.abs(i - page) <= 1) html += btn(i, i, false, i === page);
        else if (Math.abs(i - page) === 2) html += `<span class="muted" style="align-self:center">…</span>`;
      }
      html += btn(page + 1, '›', page >= data.pages);
      pager.innerHTML = html;
      pager.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
        page = Number(b.dataset.page); window.scrollTo({ top: 0, behavior: 'smooth' }); load();
      }));
    }

    let tm;
    const debounced = () => { clearTimeout(tm); tm = setTimeout(() => { page = 1; load(); }, 350); };
    get('#fQ').addEventListener('input', debounced);
    ['#fCity', '#fMin', '#fMax', '#fSort', '#fFree', '#fPhoto'].forEach((s) =>
      get(s).addEventListener('change', () => { page = 1; load(); }));
    get('#fReset').addEventListener('click', () => {
      get('#fQ').value = ''; get('#fCity').value = ''; get('#fMin').value = '';
      get('#fMax').value = ''; get('#fSort').value = 'new'; get('#fFree').checked = false; get('#fPhoto').checked = false;
      page = 1; load();
    });
    root.querySelectorAll('#catScroll .chip').forEach((c) => c.addEventListener('click', () => {
      const slug = c.dataset.cat;
      location.hash = slug ? `#/c/${slug}` : '#/search';
    }));

    load();
  },
};

/* ============================ Деталі ============================ */

export const DetailView = {
  async render() {
    return `<div class="container"><a class="back-link" href="javascript:history.back()">‹ ${esc(t('common.back'))}</a><div id="detailRoot">${gridSkeleton(2)}</div></div>`;
  },
  async mount(root, ctx) {
    const el = root.querySelector('#detailRoot');
    try {
      const { listing: l } = await api.get(ctx.params.id);
      const fav = store.isFav(l.id);
      const isOwner = canManageListing(l);

      const images = l.images || [];
      const gallery = images.length ? `
        <div class="main"><img id="mainImg" src="${esc(images[0])}" alt="${esc(l.title)}" data-lightbox="0"></div>
        ${images.length > 1 ? `<div class="strip">${images.map((src, i) =>
          `<img class="${i === 0 ? 'active' : ''}" data-i="${i}" src="${esc(src)}" alt="фото ${i + 1}">`).join('')}</div>` : ''}`
      : `<div class="main"><div class="ph"><div class="big">📷</div><div>${esc(t('detail.noPhotos'))}</div></div></div>`;

      const phoneDigits = (l.phone || '').replace(/[^\d+]/g, '');
      const waDigits = (l.whatsapp || '').replace(/[^\d]/g, '');
      const contacts = [];
      if (l.phone) contacts.push(`<a class="contact-btn c-call" href="tel:${esc(phoneDigits)}">
        <span class="ic">📞</span><span>${esc(t('detail.call'))}<small class="phone-reveal">${esc(l.phone)}</small></span></a>`);
      if (waDigits) contacts.push(`<a class="contact-btn c-wa" href="https://wa.me/${esc(waDigits)}" target="_blank" rel="noopener">
        <span class="ic">💬</span><span>WhatsApp<small>${esc(l.whatsapp)}</small></span></a>`);
      if (l.telegram) contacts.push(`<a class="contact-btn c-tg" href="https://t.me/${esc(l.telegram)}" target="_blank" rel="noopener">
        <span class="ic">✈️</span><span>Telegram<small>@${esc(l.telegram)}</small></span></a>`);
      if (l.owner && !isOwner) contacts.push(`<button class="contact-btn c-msg" id="msgBtn">
        <span class="ic">✉️</span><span>${esc(t('detail.message'))}<small>${esc(l.owner.name)}</small></span></button>`);

      const freeCls = l.isFree || l.price === 0;
      const sellerCard = l.owner ? `
        <div class="detail-card">
          <h2 class="dc-title">${esc(t('detail.seller'))}</h2>
          <a class="seller-row" href="#/u/${l.owner.id}" data-link>
            ${avatarHTML(l.owner, 46)}
            <span><b>${esc(l.owner.name)}</b><small class="muted">${l.owner.city ? esc(l.owner.city) + ' · ' : ''}${esc(timeAgo(l.owner.createdAt))}</small></span>
          </a>
          <div class="mt8">${ratingBadgeHTML(l.owner.rating)}</div>
        </div>` : '';

      el.innerHTML = `
      <div class="detail">
        <div class="gallery">${gallery}</div>
        <div class="detail-side">
          <div class="detail-card">
            <div class="dc-head">
              <a class="card-cat" href="#/c/${l.category}" data-link>${esc(catLabel(l.category))}</a>
              ${l.status === 'sold' ? `<span class="sold-badge static">${esc(t('detail.sold'))}</span>` : ''}
              ${l.status === 'expired' ? `<span class="sold-badge static" style="background:var(--muted)">${esc(t('status.expired'))}</span>` : ''}
            </div>
            <h1>${esc(l.title)}</h1>
            <div class="price-lg" style="${freeCls ? 'color:var(--success)' : ''}">${formatPrice(l)}</div>
            <div class="meta">
              <span>${pinSvg}${esc(l.location)}</span>
              <span>🕒 ${timeAgo(l.createdAt)}</span>
              <span>👁️ ${l.views || 0} ${esc(t('detail.views'))}</span>
            </div>
            <div class="row-gap">
              <button class="btn ${fav ? 'btn-primary' : ''}" id="favBtn">${fav ? esc(t('save.added')) : esc(t('save.add'))}</button>
              <button class="btn btn-ghost" id="shareBtn">↗ ${esc(t('detail.share'))}</button>
              <button class="btn btn-ghost" id="reportBtn">⚑ ${esc(t('detail.report'))}</button>
            </div>
          </div>

          <div class="detail-card">
            <h2 class="dc-title">${esc(t('detail.contacts'))}</h2>
            <div class="contact-list">${contacts.join('') || `<p class="muted">${esc(t('detail.noContacts'))}</p>`}</div>
            <p class="hint mt16">${esc(t('detail.warn'))}</p>
          </div>

          ${sellerCard}

          ${isOwner ? `<div class="detail-card">
            <h2 class="dc-title">${esc(t('detail.manage'))}</h2>
            ${expiryText(l) ? `<p class="expiry-note ${l.status === 'expired' ? 'is-expired' : ''}">⏳ ${esc(expiryText(l))}</p>` : ''}
            <div class="row-gap">
              <a class="btn" href="#/edit/${l.id}" data-link>✏️ ${esc(t('common.edit'))}</a>
              ${l.status === 'sold'
                ? `<button class="btn" id="statusBtn" data-status="active">${esc(t('detail.markActive'))}</button>`
                : `<button class="btn" id="statusBtn" data-status="sold">${esc(t('detail.markSold'))}</button>`}
              <button class="btn" id="bumpBtn">⤴ ${l.status === 'expired' ? esc(t('expiry.renew')) : esc(t('detail.bump'))}</button>
              <button class="btn btn-danger" id="delBtn">🗑️ ${esc(t('common.delete'))}</button>
            </div></div>` : ''}
        </div>
      </div>

      <div class="container" style="padding:0;max-width:980px">
        ${attrsTable(l.attributes)}
        <div class="detail-card mt24"><h2 class="dc-title">${esc(t('detail.description'))}</h2>
          <div class="desc">${esc(l.description)}</div></div>
      </div>`;

      // Галерея + лайтбокс
      const setMain = (src) => { el.querySelector('#mainImg').src = src; };
      el.querySelectorAll('.strip img').forEach((img) => img.addEventListener('click', () => {
        setMain(img.src);
        el.querySelectorAll('.strip img').forEach((x) => x.classList.remove('active'));
        img.classList.add('active');
      }));
      const lb = el.querySelector('#mainImg');
      if (lb) lb.addEventListener('click', () => openLightbox(images, images.indexOf(lb.src.replace(location.origin, '')) >= 0 ? images.indexOf(lb.src.replace(location.origin, '')) : 0));

      el.querySelector('#favBtn').addEventListener('click', (e) => {
        const on = store.toggleFav(l.id);
        e.target.textContent = on ? t('save.added') : t('save.add');
        e.target.classList.toggle('btn-primary', on);
        ctx.toast(on ? t('save.added') : t('save.add'));
      });

      el.querySelector('#shareBtn').addEventListener('click', async () => {
        // Ділимося справжнім індексованим URL, а не hash-маршрутом.
        const url = location.origin + '/listing/' + l.id;
        try {
          if (navigator.share) await navigator.share({ title: l.title, url });
          else { await navigator.clipboard.writeText(url); ctx.toast('🔗 ' + url); }
        } catch { /* скасовано */ }
      });

      el.querySelector('#reportBtn').addEventListener('click', () => openReport(l.id, ctx));

      const msgBtn = el.querySelector('#msgBtn');
      if (msgBtn) msgBtn.addEventListener('click', () => openMessageComposer(l, ctx));

      const statusBtn = el.querySelector('#statusBtn');
      if (statusBtn) statusBtn.addEventListener('click', async () => {
        try {
          await api.setStatus(l.id, statusBtn.dataset.status, store.tokenFor(l.id));
          ctx.toast('✓'); render();
        } catch (e) { ctx.toast(e.message); }
      });
      const bumpBtn = el.querySelector('#bumpBtn');
      if (bumpBtn) bumpBtn.addEventListener('click', async () => {
        try {
          await api.bump(l.id, store.tokenFor(l.id));
          ctx.toast(l.status === 'expired' ? t('expiry.renewed') : '⤴ ' + t('detail.bump'));
          render();
        } catch (e) { ctx.toast(e.message); }
      });
      const delBtn = el.querySelector('#delBtn');
      if (delBtn) delBtn.addEventListener('click', async () => {
        if (!confirm(t('common.delete') + '?')) return;
        try {
          await api.remove(l.id, store.tokenFor(l.id));
          store.removeMine(l.id);
          ctx.toast(t('common.delete') + ' ✓');
          location.hash = '#/mine';
        } catch (e) { ctx.toast(e.message); }
      });
    } catch (e) {
      el.innerHTML = emptyHTML(t('empty.title'), e.message,
        `<a class="btn btn-primary mt16" href="#/search" data-link>${esc(t('common.allListings'))}</a>`);
    }
  },
};

function render() { window.dispatchEvent(new HashChangeEvent('hashchange')); }

/* ============================ Форма ============================ */

export const FormView = {
  async render(ctx) {
    const editing = ctx.name === 'edit';
    return `<div class="container"><a class="back-link" href="javascript:history.back()">‹ ${esc(t('common.back'))}</a>
      <div class="form-card">
        <h1 style="margin:0 0 4px;font-size:1.4rem">${editing ? esc(t('form.editTitle')) : esc(t('form.newTitle'))}</h1>
        <p class="muted" style="margin:0 0 18px">${esc(t('form.intro'))}</p>
        ${!session.isAuthed && !editing ? `<div class="alert alert-info">${esc(t('auth.needLogin'))} <a href="#/login" data-link><b>${esc(t('auth.login'))}</b></a> — ${esc(t('chats.about'))} ${esc(t('detail.message'))}.</div>` : ''}
        <div id="formAlert"></div>
        <form id="adForm">
          <div class="form-grid">
            <div class="field">
              <div class="help-row"><label class="lbl">${esc(t('form.name'))} <span class="req">*</span></label><span class="counter"><span id="cTitle">0</span>/80</span></div>
              <input class="input" id="title" maxlength="80" required>
            </div>
            <div class="form-grid two">
              <div class="field"><label class="lbl">${esc(t('form.category'))} <span class="req">*</span></label>
                <select class="select" id="category" required>
                  <option value="">${esc(t('form.chooseCategory'))}</option>
                  ${CATEGORIES.map((c) => `<option value="${c.slug}">${esc(catLabel(c.slug))}</option>`).join('')}
                </select></div>
              <div class="field"><label class="lbl">${esc(t('form.location'))} <span class="req">*</span></label>
                <input class="input" id="location" list="cityList" maxlength="80" placeholder="London, E1 6AN" required>
                <datalist id="cityList">${CITIES.map((c) => `<option value="${c}">`).join('')}</datalist>
                <span class="hint">${esc(t('form.locationHint'))}</span></div>
            </div>
            <div class="form-grid two">
              <div class="field"><label class="lbl">${esc(t('form.price'))}</label>
                <input class="input" id="price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="650">
                <label class="switch mt8"><input type="checkbox" id="isFree"><span class="track"></span><span>${esc(t('form.freeToggle'))}</span></label></div>
              <div class="field"><label class="lbl">${esc(t('form.phone'))} <span class="req">*</span></label>
                <input class="input" id="phone" type="tel" maxlength="20" placeholder="+44 7700 900000" required>
                <label class="switch mt8"><input type="checkbox" id="waSame" checked><span class="track"></span><span>${esc(t('form.waSame'))}</span></label></div>
            </div>
            <div class="form-grid two">
              <div class="field" id="waWrap" style="display:none"><label class="lbl">${esc(t('form.waOther'))}</label>
                <input class="input" id="whatsapp" type="tel" maxlength="20" placeholder="+44 …"></div>
              <div class="field"><label class="lbl">${esc(t('form.telegram'))}</label>
                <input class="input" id="telegram" maxlength="40" placeholder="username"></div>
            </div>
            <div id="attrSection" hidden>
              <h3 class="attr-heading">${esc(t('attr.section'))}</h3>
              <div class="form-grid two" id="attrFields"></div>
            </div>
            <div class="field">
              <div class="help-row"><label class="lbl">${esc(t('form.description'))} <span class="req">*</span></label><span class="counter"><span id="cDesc">0</span>/1200</span></div>
              <textarea class="textarea" id="description" maxlength="1200" placeholder="${esc(t('form.descPlaceholder'))}" required></textarea>
            </div>
            <div class="field"><label class="lbl">${esc(t('form.photos'))}</label>
              <div class="dropzone" id="dz">
                <div class="dz-ico">📷</div>
                <div class="dz-title">${esc(t('form.dzTitle'))}</div>
                <div class="dz-sub">${esc(t('form.dzSub'))}</div>
                <input type="file" id="files" accept="image/*" multiple hidden>
              </div>
              <div class="thumbs" id="thumbs"></div>
            </div>
          </div>
          <button class="btn btn-primary btn-lg btn-block mt24" id="submitBtn" type="submit">${editing ? esc(t('form.saveChanges')) : esc(t('form.publish'))}</button>
        </form>
      </div></div>`;
  },

  async mount(root, ctx) {
    const editing = ctx.name === 'edit';
    const $ = (id) => root.querySelector(id);
    let images = [];

    const bindCounter = (inputId, outId) => {
      const inp = $(inputId), out = $(outId);
      const upd = () => { out.textContent = inp.value.length; };
      inp.addEventListener('input', upd); upd();
    };
    bindCounter('#title', '#cTitle');
    bindCounter('#description', '#cDesc');

    $('#waSame').addEventListener('change', (e) => { $('#waWrap').style.display = e.target.checked ? 'none' : ''; });
    $('#isFree').addEventListener('change', (e) => { $('#price').disabled = e.target.checked; if (e.target.checked) $('#price').value = ''; });

    /* -------- Характеристики, що залежать від категорії -------- */
    let attrSchema = {};
    try { attrSchema = await api.attributesSchema(); } catch { attrSchema = {}; }
    let pendingAttrs = {}; // значення для передзаповнення (редагування/чернетка)

    function renderAttrFields() {
      const cat = $('#category').value;
      const defs = attrSchema[cat] || [];
      const section = $('#attrSection');
      const box = $('#attrFields');
      if (!defs.length) { section.hidden = true; box.innerHTML = ''; return; }
      section.hidden = false;
      box.innerHTML = defs.map((d) => {
        const id = 'attr_' + d.key;
        const cur = pendingAttrs[d.key];
        const label = esc(attrFieldLabel(d.key));
        if (d.type === 'bool') {
          return `<label class="switch attr-switch"><input type="checkbox" id="${id}" ${cur === true ? 'checked' : ''}><span class="track"></span><span>${label}</span></label>`;
        }
        if (d.type === 'select') {
          return `<div class="field"><label class="lbl">${label}</label>
            <select class="select" id="${id}"><option value="">${esc(t('attr.choose'))}</option>
            ${d.options.map((o) => `<option value="${esc(o)}" ${String(cur) === o ? 'selected' : ''}>${esc(attrValueLabel(o))}</option>`).join('')}
            </select></div>`;
        }
        if (d.type === 'number') {
          return `<div class="field"><label class="lbl">${label}</label>
            <input class="input" id="${id}" type="number" inputmode="numeric" ${d.min != null ? `min="${d.min}"` : ''} ${d.max != null ? `max="${d.max}"` : ''} value="${cur != null ? esc(cur) : ''}"></div>`;
        }
        return `<div class="field"><label class="lbl">${label}</label>
          <input class="input" id="${id}" maxlength="${d.max || 60}" value="${cur != null ? esc(cur) : ''}"></div>`;
      }).join('');
    }

    function collectAttributes() {
      const cat = $('#category').value;
      const defs = attrSchema[cat] || [];
      const out = {};
      for (const d of defs) {
        const el = $('#attr_' + d.key);
        if (!el) continue;
        if (d.type === 'bool') { if (el.checked) out[d.key] = true; }
        else if (el.value !== '') out[d.key] = d.type === 'number' ? Number(el.value) : el.value;
      }
      return out;
    }

    $('#category').addEventListener('change', () => { pendingAttrs = {}; renderAttrFields(); });
    renderAttrFields();

    /* -------- Автозбереження чернетки (лише для нового оголошення) -------- */
    const DRAFT_KEY = 'ouk:draft';
    const TEXT_FIELDS = ['#title', '#description', '#category', '#location', '#price', '#phone', '#telegram'];
    const clearDraft = () => localStorage.removeItem(DRAFT_KEY);
    const saveDraft = () => {
      if (editing) return;
      const d = {};
      TEXT_FIELDS.forEach((f) => { d[f] = $(f).value; });
      d.isFree = $('#isFree').checked;
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* quota */ }
    };
    if (!editing) {
      let draft = null;
      try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { draft = null; }
      const hasContent = draft && (draft['#title'] || draft['#description']);
      if (hasContent) {
        TEXT_FIELDS.forEach((f) => { if (draft[f] != null) $(f).value = draft[f]; });
        $('#isFree').checked = !!draft.isFree;
        $('#price').disabled = !!draft.isFree;
        $('#cTitle').textContent = $('#title').value.length;
        $('#cDesc').textContent = $('#description').value.length;
        $('#formAlert').innerHTML = `<div class="alert alert-info">${esc(t('draft.restored'))} · <a href="#" id="clearDraft"><b>${esc(t('draft.clear'))}</b></a></div>`;
        const cd = $('#clearDraft');
        if (cd) cd.addEventListener('click', (e) => {
          e.preventDefault();
          clearDraft();
          TEXT_FIELDS.forEach((f) => { $(f).value = ''; });
          $('#isFree').checked = false; $('#price').disabled = false;
          $('#cTitle').textContent = 0; $('#cDesc').textContent = 0;
          $('#formAlert').innerHTML = '';
        });
      }
      TEXT_FIELDS.forEach((f) => $(f).addEventListener('input', saveDraft));
      $('#isFree').addEventListener('change', saveDraft);
    }

    function renderThumbs() {
      $('#thumbs').innerHTML = images.map((src, i) => `
        <div class="thumb">
          <img src="${src}" alt="">
          ${i === 0 ? `<span class="cover-badge">${esc(t('form.cover'))}</span>` : ''}
          <button type="button" class="rm" data-rm="${i}" aria-label="✕">✕</button>
        </div>`).join('');
      $('#thumbs').querySelectorAll('[data-rm]').forEach((b) =>
        b.addEventListener('click', () => { images.splice(Number(b.dataset.rm), 1); renderThumbs(); }));
    }

    function compress(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const MAX = 1280;
            let { width: w, height: h } = img;
            if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.onerror = reject; img.src = reader.result;
        };
        reader.onerror = reject; reader.readAsDataURL(file);
      });
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      for (const f of files) {
        if (images.length >= 8) { ctx.toast(t('form.maxPhotos')); break; }
        try { images.push(await compress(f)); } catch { ctx.toast('⚠️'); }
      }
      renderThumbs();
    }

    $('#dz').addEventListener('click', () => $('#files').click());
    $('#files').addEventListener('change', (e) => addFiles(e.target.files));
    ['dragover', 'dragenter'].forEach((ev) => $('#dz').addEventListener(ev, (e) => { e.preventDefault(); $('#dz').classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => $('#dz').addEventListener(ev, (e) => { e.preventDefault(); $('#dz').classList.remove('drag'); }));
    $('#dz').addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

    if (editing) {
      try {
        const { listing: l } = await api.get(ctx.params.id);
        const isOwner = canManageListing(l);
        if (!isOwner) $('#formAlert').innerHTML = `<div class="alert alert-error">${esc(t('detail.manage'))} ✗</div>`;
        $('#title').value = l.title; $('#description').value = l.description;
        $('#category').value = l.category; $('#location').value = l.location;
        $('#phone').value = l.phone || ''; $('#telegram').value = l.telegram || '';
        $('#isFree').checked = !!l.isFree;
        $('#price').value = (l.price != null && !l.isFree) ? l.price : '';
        $('#price').disabled = !!l.isFree;
        const sameWa = l.whatsapp && l.whatsapp.replace(/\D/g, '') === (l.phone || '').replace(/\D/g, '');
        if (!sameWa && l.whatsapp) { $('#waSame').checked = false; $('#waWrap').style.display = ''; $('#whatsapp').value = l.whatsapp; }
        images = (l.images || []).slice();
        renderThumbs();
        $('#cTitle').textContent = l.title.length; $('#cDesc').textContent = l.description.length;
        pendingAttrs = l.attributes || {}; renderAttrFields();
      } catch (e) { $('#formAlert').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
    }

    $('#adForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#submitBtn');
      const payload = {
        title: $('#title').value, description: $('#description').value,
        category: $('#category').value, location: $('#location').value,
        phone: $('#phone').value, telegram: $('#telegram').value,
        isFree: $('#isFree').checked, price: $('#isFree').checked ? '' : $('#price').value,
        whatsappSame: $('#waSame').checked,
        whatsapp: $('#waSame').checked ? $('#phone').value : $('#whatsapp').value,
        attributes: collectAttributes(),
        images,
      };
      btn.disabled = true; btn.textContent = t('form.saving');
      $('#formAlert').innerHTML = '';
      try {
        if (editing) {
          const { listing } = await api.update(ctx.params.id, { ...payload, editToken: store.tokenFor(ctx.params.id) });
          ctx.toast(t('form.saveChanges') + ' ✓');
          location.hash = '#/l/' + listing.id;
        } else {
          const { listing, editToken } = await api.create(payload);
          if (editToken) store.addMine(listing.id, editToken, listing.title);
          clearDraft();
          ctx.toast(t('form.publish') + ' ✓');
          location.hash = '#/l/' + listing.id;
        }
      } catch (err) {
        $('#formAlert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = editing ? t('form.saveChanges') : t('form.publish');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  },
};

/* ============================ Збережені ============================ */

export const SavedView = {
  async render() {
    return `<div class="container"><div class="section-head"><h2>${esc(t('saved.title'))}</h2></div><div id="savedGrid">${gridSkeleton(4)}</div></div>`;
  },
  async mount(root) {
    const ids = store.favs();
    const el = root.querySelector('#savedGrid');
    if (!ids.length) {
      el.innerHTML = emptyHTML(t('saved.empty'), t('saved.emptySub'),
        `<a class="btn btn-primary mt16" href="#/search" data-link>${esc(t('common.allListings'))}</a>`);
      return;
    }
    const results = await Promise.allSettled(ids.map((id) => api.get(id)));
    const items = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.listing);
    el.innerHTML = items.length
      ? `<div class="grid">${items.map(cardHTML).join('')}</div>`
      : emptyHTML(t('saved.empty'), t('saved.emptySub'));
  },
};

/* ============================ Мої / Профіль ============================ */

export const MineView = {
  async render() {
    if (session.isAuthed) { location.hash = '#/profile'; return ''; }
    return `<div class="container"><div class="section-head"><h2>👤 ${esc(t('nav.mine'))}</h2>
      <a class="btn btn-primary" href="#/new" data-link>+ ${esc(t('nav.add'))}</a></div>
      <div class="alert alert-info">${esc(t('auth.needLogin'))} <a href="#/login" data-link><b>${esc(t('auth.login'))}</b></a></div>
      <div id="mineGrid">${gridSkeleton(4)}</div></div>`;
  },
  async mount(root) {
    if (session.isAuthed) return;
    const mine = store.mine();
    const ids = Object.keys(mine);
    const el = root.querySelector('#mineGrid');
    if (!ids.length) {
      el.innerHTML = emptyHTML(t('nav.mine'), t('app.subtitle'),
        `<a class="btn btn-primary mt16" href="#/new" data-link>+ ${esc(t('nav.add'))}</a>`);
      return;
    }
    const results = await Promise.allSettled(ids.map((id) => api.get(id)));
    const items = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.listing);
    ids.forEach((id, i) => { if (results[i].status === 'rejected') store.removeMine(id); });
    el.innerHTML = items.length ? `<div class="grid">${items.map(cardHTML).join('')}</div>` : emptyHTML(t('nav.mine'), '');
  },
};

export const ProfileView = {
  async render() {
    if (!session.isAuthed) { location.hash = '#/login'; return ''; }
    const u = session.user;
    return `<div class="container">
      <div class="profile-head">
        ${avatarHTML(u, 72)}
        <div class="profile-meta">
          <h1>${esc(u.name)}</h1>
          <p class="muted">${u.city ? esc(u.city) + ' · ' : ''}${esc(t('profile.memberSince'))} ${esc(timeAgo(u.createdAt))}</p>
        </div>
        <div class="spacer"></div>
        <button class="btn" id="editProfileBtn">⚙ ${esc(t('profile.settings'))}</button>
        <button class="btn btn-danger" id="logoutBtn">${esc(t('auth.logout'))}</button>
      </div>
      <div id="profileSettings"></div>
      <div class="section-head"><h2>${esc(t('profile.myListings'))}</h2>
        <a class="btn btn-primary" href="#/new" data-link>+ ${esc(t('nav.add'))}</a></div>
      <div id="myGrid">${gridSkeleton(4)}</div>
    </div>`;
  },
  async mount(root, ctx) {
    if (!session.isAuthed) return;
    root.querySelector('#logoutBtn').addEventListener('click', async () => {
      try { await api.logout(); } catch { /* ignore */ }
      session.clear(); ctx.toast('👋'); location.hash = '#/';
    });
    root.querySelector('#editProfileBtn').addEventListener('click', () => {
      const box = root.querySelector('#profileSettings');
      if (box.innerHTML) { box.innerHTML = ''; return; }
      const u = session.user;
      box.innerHTML = `<div class="detail-card mb16">
        <div class="form-grid two">
          <div class="field"><label class="lbl">${esc(t('auth.name'))}</label><input class="input" id="pName" value="${esc(u.name)}"></div>
          <div class="field"><label class="lbl">${esc(t('auth.city'))}</label><input class="input" id="pCity" value="${esc(u.city || '')}"></div>
          <div class="field"><label class="lbl">${esc(t('form.phone'))}</label><input class="input" id="pPhone" value="${esc(u.phone || '')}"></div>
          <div class="field"><label class="lbl">Avatar</label><input class="input" id="pAvatar" type="file" accept="image/*"></div>
        </div>
        <button class="btn btn-primary mt16" id="saveProfile">${esc(t('common.save'))}</button>
      </div>`;
      box.querySelector('#saveProfile').addEventListener('click', async () => {
        const payload = { name: box.querySelector('#pName').value, city: box.querySelector('#pCity').value, phone: box.querySelector('#pPhone').value };
        const file = box.querySelector('#pAvatar').files[0];
        const finish = async () => {
          try {
            const { user } = await api.updateProfile(payload);
            session.set(session.token, user); ctx.toast(t('common.save') + ' ✓');
            box.innerHTML = ''; render();
          } catch (e) { ctx.toast(e.message); }
        };
        if (file) { const r = new FileReader(); r.onload = () => { payload.avatar = r.result; finish(); }; r.readAsDataURL(file); }
        else finish();
      });
    });

    try {
      const { items } = await api.list({ owner: session.user.id, status: 'all', perPage: 48 });
      root.querySelector('#myGrid').innerHTML = items.length
        ? `<div class="grid">${items.map(cardHTML).join('')}</div>`
        : emptyHTML(t('profile.myListings'), '', `<a class="btn btn-primary mt16" href="#/new" data-link>+ ${esc(t('nav.add'))}</a>`);
    } catch (e) {
      root.querySelector('#myGrid').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    }
  },
};

// Публічний профіль користувача
export const UserView = {
  async render() {
    return `<div class="container"><a class="back-link" href="javascript:history.back()">‹ ${esc(t('common.back'))}</a><div id="userRoot">${gridSkeleton(3)}</div></div>`;
  },
  async mount(root, ctx) {
    const el = root.querySelector('#userRoot');
    const sellerId = ctx.params.id;
    try {
      const { user, stats } = await api.userProfile(sellerId);
      const { items } = await api.list({ owner: sellerId, perPage: 48 });
      const isSelf = session.isAuthed && session.user.id === sellerId;

      el.innerHTML = `
        <div class="profile-head">
          ${avatarHTML(user, 64)}
          <div class="profile-meta"><h1>${esc(user.name)}</h1>
            <p class="muted">${user.city ? esc(user.city) + ' · ' : ''}${stats.active} ${esc(t('profile.activeAds'))} · ${esc(t('profile.memberSince'))} ${esc(timeAgo(user.createdAt))}</p>
            <div class="mt8">${ratingBadgeHTML(user.rating)}</div></div>
        </div>

        <div class="section-head"><h2>${esc(t('rev.title'))}</h2>
          ${!isSelf ? `<button class="btn btn-sm" id="reviewBtn">★ ${esc(t('rev.leave'))}</button>` : ''}</div>
        <div id="reviewsBox">${gridSkeleton(2)}</div>

        <div class="section-head" style="margin-top:26px"><h2>${esc(t('detail.otherAds'))}</h2></div>
        ${items.length ? `<div class="grid">${items.map(cardHTML).join('')}</div>` : emptyHTML(t('empty.title'), '')}`;

      async function loadReviews() {
        const box = el.querySelector('#reviewsBox');
        try {
          const { reviews } = await api.reviews(sellerId);
          box.innerHTML = reviews.length
            ? `<div class="review-list">${reviews.map((r) => `
                <div class="review-card">
                  <div class="review-head">
                    <a class="review-author" href="#/u/${r.author ? r.author.id : ''}" data-link>${avatarHTML(r.author, 34)}<b>${esc(r.author ? r.author.name : '—')}</b></a>
                    <span class="muted">${esc(timeAgo(r.createdAt))}</span>
                  </div>
                  ${starsHTML(r.rating)}
                  ${r.text ? `<p class="review-text">${esc(r.text)}</p>` : ''}
                </div>`).join('')}</div>`
            : emptyHTML(t('rev.none'), '');
        } catch (e) { box.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
      }
      loadReviews();

      const reviewBtn = el.querySelector('#reviewBtn');
      if (reviewBtn) reviewBtn.addEventListener('click', () => {
        if (!session.isAuthed) { ctx.toast(t('rev.loginFirst')); location.hash = '#/login'; return; }
        openReviewModal(sellerId, ctx, loadReviews);
      });
    } catch (e) {
      el.innerHTML = emptyHTML(t('empty.title'), e.message);
    }
  },
};

/* ============================ Авторизація ============================ */

export const AuthView = {
  async render(ctx) {
    const isRegister = ctx.name === 'register';
    return `<div class="container narrow">
      <div class="form-card auth-card">
        <h1 style="margin:0 0 18px;font-size:1.5rem;text-align:center">${isRegister ? esc(t('auth.register')) : esc(t('auth.login'))}</h1>
        <div id="authAlert"></div>
        <form id="authForm" class="form-grid">
          ${isRegister ? `<div class="field"><label class="lbl">${esc(t('auth.name'))}</label><input class="input" id="aName" required></div>` : ''}
          <div class="field"><label class="lbl">${esc(t('auth.email'))}</label><input class="input" id="aEmail" type="email" autocomplete="email" required></div>
          <div class="field"><label class="lbl">${esc(t('auth.password'))}</label><input class="input" id="aPass" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required></div>
          ${isRegister ? `<div class="field"><label class="lbl">${esc(t('auth.city'))}</label><input class="input" id="aCity" list="cityList2"><datalist id="cityList2">${CITIES.map((c) => `<option value="${c}">`).join('')}</datalist></div>` : ''}
          <button class="btn btn-primary btn-lg btn-block" id="authBtn" type="submit">${isRegister ? esc(t('auth.register')) : esc(t('auth.login'))}</button>
        </form>
        ${!isRegister ? `<p class="center mt8"><a href="#/forgot" data-link class="muted">${esc(t('pwd.forgot'))}</a></p>` : ''}
        <p class="center mt16"><a href="#/${isRegister ? 'login' : 'register'}" data-link>${isRegister ? esc(t('auth.haveAccount')) : esc(t('auth.noAccount'))}</a></p>
      </div></div>`;
  },
  async mount(root, ctx) {
    const isRegister = ctx.name === 'register';
    const $ = (s) => root.querySelector(s);
    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#authBtn'); btn.disabled = true;
      $('#authAlert').innerHTML = '';
      try {
        const payload = { email: $('#aEmail').value, password: $('#aPass').value };
        let res;
        if (isRegister) { payload.name = $('#aName').value; payload.city = $('#aCity').value; res = await api.register(payload); }
        else res = await api.login(payload);
        session.set(res.token, res.user);
        ctx.toast(isRegister ? t('auth.registered') : t('auth.welcome'));
        location.hash = '#/profile';
      } catch (err) {
        $('#authAlert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    });
  },
};

// Запит на відновлення пароля
export const ForgotView = {
  async render() {
    return `<div class="container narrow">
      <div class="form-card auth-card">
        <h1 style="margin:0 0 8px;font-size:1.5rem;text-align:center">${esc(t('pwd.forgotTitle'))}</h1>
        <p class="muted center" style="margin:0 0 18px">${esc(t('pwd.forgotIntro'))}</p>
        <div id="fpAlert"></div>
        <form id="fpForm" class="form-grid">
          <div class="field"><label class="lbl">${esc(t('auth.email'))}</label><input class="input" id="fpEmail" type="email" autocomplete="email" required></div>
          <button class="btn btn-primary btn-lg btn-block" id="fpBtn" type="submit">${esc(t('pwd.sendLink'))}</button>
        </form>
        <p class="center mt16"><a href="#/login" data-link>‹ ${esc(t('auth.login'))}</a></p>
      </div></div>`;
  },
  async mount(root, ctx) {
    const $ = (s) => root.querySelector(s);
    $('#fpForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#fpBtn'); btn.disabled = true;
      try {
        const res = await api.forgotPassword($('#fpEmail').value);
        // Демо-режим: сервер може повернути resetToken (EXPOSE_RESET_TOKEN=1).
        const demo = res.resetToken
          ? `<div class="alert alert-info mt16">${esc(t('pwd.demoToken'))}<br><a href="#/reset?token=${encodeURIComponent(res.resetToken)}" data-link><b>${esc(t('pwd.resetTitle'))} →</b></a></div>`
          : '';
        $('#fpAlert').innerHTML = `<div class="alert alert-success">${esc(t('pwd.sent'))}</div>${demo}`;
      } catch (err) {
        $('#fpAlert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      } finally { btn.disabled = false; }
    });
  },
};

// Встановлення нового пароля за токеном
export const ResetView = {
  async render(ctx) {
    const token = ctx.query.token || '';
    return `<div class="container narrow">
      <div class="form-card auth-card">
        <h1 style="margin:0 0 18px;font-size:1.5rem;text-align:center">${esc(t('pwd.resetTitle'))}</h1>
        <div id="rpAlert"></div>
        <form id="rpForm" class="form-grid">
          <div class="field"><label class="lbl">${esc(t('pwd.newPassword'))}</label><input class="input" id="rpPass" type="password" autocomplete="new-password" required></div>
          <input type="hidden" id="rpToken" value="${esc(token)}">
          <button class="btn btn-primary btn-lg btn-block" id="rpBtn" type="submit">${esc(t('pwd.setPassword'))}</button>
        </form>
      </div></div>`;
  },
  async mount(root, ctx) {
    const $ = (s) => root.querySelector(s);
    $('#rpForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#rpBtn'); btn.disabled = true;
      try {
        const res = await api.resetPassword($('#rpToken').value, $('#rpPass').value);
        session.set(res.token, res.user);
        ctx.toast(t('pwd.done'));
        location.hash = '#/profile';
      } catch (err) {
        $('#rpAlert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    });
  },
};

/* ============================ Чати ============================ */

export const ChatsView = {
  async render() {
    if (!session.isAuthed) { location.hash = '#/login'; return ''; }
    return `<div class="container"><div class="section-head"><h2>${esc(t('chats.title'))}</h2></div><div id="threads">${gridSkeleton(3)}</div></div>`;
  },
  async mount(root) {
    if (!session.isAuthed) return;
    const el = root.querySelector('#threads');
    try {
      const { threads } = await api.threads();
      if (!threads.length) { el.innerHTML = emptyHTML(t('chats.empty'), t('chats.emptySub')); return; }
      el.innerHTML = `<div class="thread-list">${threads.map((th) => `
        <a class="thread-item" href="#/chat/${th.threadId}" data-link>
          ${avatarHTML(th.other, 48)}
          <div class="thread-main">
            <div class="thread-top"><b>${esc(th.other ? th.other.name : '—')}</b><span class="muted thread-time">${esc(timeAgo(th.lastAt))}</span></div>
            <div class="thread-sub muted">${th.lastFromMe ? esc(t('chats.you')) : ''}${esc(th.lastText)}</div>
            <div class="thread-listing muted">${th.listing ? '📦 ' + esc(th.listing.title) : ''}</div>
          </div>
          ${th.unread ? `<span class="badge">${th.unread}</span>` : ''}
        </a>`).join('')}</div>`;
    } catch (e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
  },
};

export const ChatView = {
  async render() {
    if (!session.isAuthed) { location.hash = '#/login'; return ''; }
    return `<div class="container narrow"><a class="back-link" href="#/chats" data-link>‹ ${esc(t('chats.title'))}</a>
      <div id="chatRoot" class="chat-wrap">${gridSkeleton(2)}</div></div>`;
  },
  async mount(root, ctx) {
    if (!session.isAuthed) return;
    const el = root.querySelector('#chatRoot');
    async function load(scroll = true) {
      try {
        const data = await api.thread(ctx.params.id);
        el.innerHTML = `
          <div class="chat-head">
            ${avatarHTML(data.other, 42)}
            <div><b>${esc(data.other ? data.other.name : '—')}</b>
            ${data.listing ? `<a class="muted chat-listing" href="#/l/${data.listing.id}" data-link>📦 ${esc(data.listing.title)} · ${esc(formatPrice(data.listing))}</a>` : ''}</div>
          </div>
          <div class="chat-msgs" id="chatMsgs">
            ${data.messages.map((m) => `<div class="msg ${m.fromUserId === data.me ? 'mine' : 'theirs'}">
              <div class="msg-bubble">${esc(m.text)}</div>
              <div class="msg-time">${esc(timeAgo(m.createdAt))}</div></div>`).join('')}
          </div>
          <form class="chat-input" id="chatForm">
            <input class="input" id="chatText" placeholder="${esc(t('chats.placeholder'))}" autocomplete="off" required>
            <button class="btn btn-primary" type="submit">${esc(t('common.send'))}</button>
          </form>`;
        const msgs = el.querySelector('#chatMsgs');
        if (scroll) msgs.scrollTop = msgs.scrollHeight;
        el.querySelector('#chatForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const inp = el.querySelector('#chatText');
          const text = inp.value.trim(); if (!text) return;
          inp.value = '';
          try { await api.reply(ctx.params.id, text); await load(); }
          catch (err) { ctx.toast(err.message); }
        });
      } catch (e) { el.innerHTML = emptyHTML(t('empty.title'), e.message); }
    }
    load();
  },
};

/* ============================ Адмін / модерація ============================ */

const REPORT_REASONS = {
  spam: () => t('report.spam'), prohibited: () => t('report.prohibited'),
  wrong: () => t('report.wrong'), other: () => t('report.other'),
};

const ADMIN_STATUSES = ['active', 'sold', 'expired', 'archived'];

export const AdminView = {
  async render() {
    if (!session.isAuthed || !session.user.isAdmin) { location.hash = '#/'; return ''; }
    return `<div class="container">
      <div class="section-head"><h2>🛡️ ${esc(t('admin.title'))}</h2>
        <a class="btn btn-sm" href="${api.adminBackupUrl()}" download>${esc(t('admin.backup'))}</a></div>

      <div class="seg admin-tabs" id="adminTabs">
        <button class="seg-btn active" data-tab="stats">${esc(t('admin.tabStats'))}</button>
        <button class="seg-btn" data-tab="listings">${esc(t('admin.tabListings'))}</button>
        <button class="seg-btn" data-tab="reports">${esc(t('admin.tabReports'))}</button>
      </div>

      <section data-pane="stats">
        <div class="admin-stats mt16" id="adminStats">${gridSkeleton(4)}</div>
      </section>

      <section data-pane="listings" hidden>
        <div class="toolbar mt16">
          <input class="input" id="alQ" placeholder="${esc(t('admin.searchListings'))}" style="flex:1;min-width:160px">
          <select class="select" id="alStatus" style="width:auto">
            <option value="all">${esc(t('admin.allStatuses'))}</option>
            ${ADMIN_STATUSES.map((s) => `<option value="${s}">${esc(t('status.' + s))}</option>`).join('')}
          </select>
          <a class="btn btn-primary" href="#/new" data-link>+ ${esc(t('nav.add'))}</a>
        </div>
        <div id="adminListings" class="mt16">${gridSkeleton(3)}</div>
        <div class="pagination" id="alPager"></div>
      </section>

      <section data-pane="reports" hidden>
        <div class="section-head" style="margin-top:18px">
          <h2>${esc(t('admin.reports'))}</h2>
          <div class="seg" id="repSeg">
            <button class="seg-btn active" data-resolved="0">${esc(t('admin.open'))}</button>
            <button class="seg-btn" data-resolved="1">${esc(t('admin.resolved'))}</button>
          </div>
        </div>
        <div id="adminReports">${gridSkeleton(2)}</div>
      </section>
    </div>`;
  },
  async mount(root, ctx) {
    if (!session.isAuthed || !session.user.isAdmin) return;
    let showResolved = false;

    /* -------- Перемикання вкладок -------- */
    root.querySelectorAll('#adminTabs .seg-btn').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('#adminTabs .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      const tab = b.dataset.tab;
      root.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
      if (tab === 'listings') loadListings();
      if (tab === 'reports') loadReports();
    }));

    /* -------- Управління оголошеннями -------- */
    let alPage = 1;
    async function loadListings() {
      const box = root.querySelector('#adminListings');
      box.innerHTML = gridSkeleton(3);
      try {
        const data = await api.list({
          q: root.querySelector('#alQ').value.trim(),
          status: root.querySelector('#alStatus').value,
          page: alPage, perPage: 24,
        });
        if (!data.items.length) { box.innerHTML = emptyHTML(t('empty.title'), ''); root.querySelector('#alPager').innerHTML = ''; return; }
        box.innerHTML = `<div class="admin-listing-list">${data.items.map(adminListingRow).join('')}</div>`;
        bindListingRowActions(box);
        renderAlPager(data);
      } catch (e) { box.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
    }

    function adminListingRow(l) {
      return `<div class="al-row">
        <div class="al-main">
          <a href="#/l/${l.id}" data-link class="al-title">${esc(l.title)}</a>
          <div class="al-meta muted">${esc(catLabel(l.category))} · ${esc(formatPrice(l))} · ${esc(l.location)}
            <span class="status-pill status-${esc(l.status)}">${esc(t('status.' + l.status) || l.status)}</span></div>
        </div>
        <div class="al-actions">
          <a class="btn btn-sm" href="#/edit/${l.id}" data-link>✏️</a>
          <select class="select al-status" data-id="${l.id}" title="status">
            ${ADMIN_STATUSES.map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${esc(t('status.' + s))}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-danger" data-del="${l.id}">🗑</button>
        </div>
      </div>`;
    }

    function bindListingRowActions(box) {
      box.querySelectorAll('.al-status').forEach((sel) => sel.addEventListener('change', async () => {
        try { await api.setStatus(sel.dataset.id, sel.value); ctx.toast(t('admin.statusChanged')); loadListings(); loadStats(); }
        catch (e) { ctx.toast(e.message); }
      }));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm(t('admin.delete') + '?')) return;
        try { await api.adminDeleteListing(b.dataset.del); ctx.toast(t('admin.deleted')); loadListings(); loadStats(); }
        catch (e) { ctx.toast(e.message); }
      }));
    }

    function renderAlPager(data) {
      const pager = root.querySelector('#alPager');
      if (data.pages <= 1) { pager.innerHTML = ''; return; }
      const btn = (n, label, dis, cur) => `<button class="btn ${cur ? 'btn-primary' : ''}" data-p="${n}" ${dis ? 'disabled' : ''}>${label}</button>`;
      let html = btn(alPage - 1, '‹', alPage <= 1);
      html += `<span class="muted" style="align-self:center">${alPage}/${data.pages}</span>`;
      html += btn(alPage + 1, '›', alPage >= data.pages);
      pager.innerHTML = html;
      pager.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { alPage = Number(b.dataset.p); loadListings(); }));
    }

    let alTimer;
    root.querySelector('#alQ').addEventListener('input', () => { clearTimeout(alTimer); alTimer = setTimeout(() => { alPage = 1; loadListings(); }, 350); });
    root.querySelector('#alStatus').addEventListener('change', () => { alPage = 1; loadListings(); });

    async function loadStats() {
      try {
        const s = await api.adminStats();
        const tiles = [
          ['admin.statListings', s.listings], ['admin.statActive', s.active],
          ['admin.statSold', s.sold], ['admin.statExpired', s.expired ?? 0],
          ['admin.statUsers', s.users], ['admin.statMessages', s.messages],
          ['admin.statReports', s.reportsOpen], ['admin.statToday', s.newListingsToday],
        ];
        root.querySelector('#adminStats').innerHTML = tiles.map(([k, v]) =>
          `<div class="stat-tile"><div class="stat-n">${v}</div><div class="stat-l">${esc(t(k))}</div></div>`).join('');
      } catch (e) { root.querySelector('#adminStats').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
    }

    async function loadReports() {
      const box = root.querySelector('#adminReports');
      box.innerHTML = gridSkeleton(2);
      try {
        const { reports } = await api.adminReports(showResolved);
        if (!reports.length) { box.innerHTML = emptyHTML(t('admin.noReports'), ''); return; }
        box.innerHTML = `<div class="report-list">${reports.map((r) => {
          const reason = (REPORT_REASONS[r.reason] || REPORT_REASONS.other)();
          return `<div class="report-card ${r.resolved ? 'is-resolved' : ''}">
            <div class="report-head">
              <span class="report-reason reason-${esc(r.reason)}">⚑ ${esc(reason)}</span>
              <span class="muted">${esc(timeAgo(r.createdAt))}${r.resolved ? ' · ✓' : ''}</span>
            </div>
            ${r.text ? `<p class="report-text">${esc(r.text)}</p>` : ''}
            ${r.listing
              ? `<a class="report-listing" href="#/l/${r.listing.id}" data-link>📦 <b>${esc(r.listing.title)}</b> · ${esc(formatPrice(r.listing))} · ${esc(r.listing.location)}</a>`
              : `<p class="muted">— ${esc(t('empty.title'))} —</p>`}
            <div class="row-gap mt8">
              ${r.listing ? `<a class="btn btn-sm" href="#/l/${r.listing.id}" data-link>${esc(t('admin.openListing'))}</a>` : ''}
              ${!r.resolved ? `<button class="btn btn-sm" data-resolve="${r.id}">✓ ${esc(t('admin.resolve'))}</button>` : ''}
              ${r.listing ? `<button class="btn btn-sm btn-danger" data-del="${r.listing.id}">🗑 ${esc(t('admin.delete'))}</button>` : ''}
            </div></div>`;
        }).join('')}</div>`;

        box.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
          try { await api.adminResolveReport(b.dataset.resolve); ctx.toast(t('admin.resolvedOk')); loadReports(); loadStats(); }
          catch (e) { ctx.toast(e.message); }
        }));
        box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
          if (!confirm(t('admin.delete') + '?')) return;
          try { await api.adminDeleteListing(b.dataset.del); ctx.toast(t('admin.deleted')); loadReports(); loadStats(); }
          catch (e) { ctx.toast(e.message); }
        }));
      } catch (e) { box.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
    }

    root.querySelectorAll('#repSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('#repSeg .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      showResolved = b.dataset.resolved === '1';
      loadReports();
    }));

    loadStats();
    loadReports();
  },
};

/* ============================ Модалки ============================ */

function modal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  requestAnimationFrame(() => back.classList.add('show'));
  return { back, close };
}

function openReport(listingId, ctx) {
  const { back, close } = modal(`
    <h2 style="margin:0 0 14px">${esc(t('report.title'))}</h2>
    <div class="field"><label class="lbl">${esc(t('report.reason'))}</label>
      <select class="select" id="rReason">
        <option value="spam">${esc(t('report.spam'))}</option>
        <option value="prohibited">${esc(t('report.prohibited'))}</option>
        <option value="wrong">${esc(t('report.wrong'))}</option>
        <option value="other">${esc(t('report.other'))}</option>
      </select></div>
    <div class="field mt16"><label class="lbl">${esc(t('report.details'))}</label>
      <textarea class="textarea" id="rText" maxlength="500"></textarea></div>
    <div class="row-gap mt16"><button class="btn btn-ghost" id="rCancel">${esc(t('common.cancel'))}</button>
      <button class="btn btn-primary" id="rSubmit">${esc(t('report.submit'))}</button></div>`);
  back.querySelector('#rCancel').addEventListener('click', close);
  back.querySelector('#rSubmit').addEventListener('click', async () => {
    try {
      await api.report(listingId, back.querySelector('#rReason').value, back.querySelector('#rText').value);
      ctx.toast(t('report.thanks')); close();
    } catch (e) { ctx.toast(e.message); }
  });
}

function openReviewModal(sellerId, ctx, onDone) {
  let chosen = 0;
  const { back, close } = modal(`
    <h2 style="margin:0 0 14px">${esc(t('rev.leave'))}</h2>
    <div class="field"><label class="lbl">${esc(t('rev.yourRating'))}</label>
      <div id="starInput">${starsHTML(0, { interactive: true })}</div></div>
    <div class="field mt16"><label class="lbl">${esc(t('rev.comment'))}</label>
      <textarea class="textarea" id="revText" maxlength="600"></textarea></div>
    <div class="row-gap mt16"><button class="btn btn-ghost" id="revCancel">${esc(t('common.cancel'))}</button>
      <button class="btn btn-primary" id="revSubmit" disabled>${esc(t('rev.submit'))}</button></div>`);

  const starWrap = back.querySelector('#starInput');
  const paint = (val) => starWrap.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('on', i < val));
  starWrap.querySelectorAll('[data-star]').forEach((s) => {
    s.addEventListener('mouseenter', () => paint(Number(s.dataset.star)));
    s.addEventListener('click', () => { chosen = Number(s.dataset.star); paint(chosen); back.querySelector('#revSubmit').disabled = false; });
  });
  starWrap.addEventListener('mouseleave', () => paint(chosen));

  back.querySelector('#revCancel').addEventListener('click', close);
  back.querySelector('#revSubmit').addEventListener('click', async () => {
    if (!chosen) return;
    try {
      await api.addReview(sellerId, chosen, back.querySelector('#revText').value);
      ctx.toast(t('rev.thanks')); close();
      if (onDone) onDone();
    } catch (e) { ctx.toast(e.message); }
  });
}

function openMessageComposer(listing, ctx) {
  if (!session.isAuthed) { ctx.toast(t('auth.needLogin')); location.hash = '#/login'; return; }
  const { back, close } = modal(`
    <h2 style="margin:0 0 6px">${esc(t('detail.message'))}</h2>
    <p class="muted" style="margin:0 0 14px">${esc(t('chats.about'))} ${esc(listing.title)}</p>
    <textarea class="textarea" id="mText" placeholder="${esc(t('chats.placeholder'))}" autofocus></textarea>
    <div class="row-gap mt16"><button class="btn btn-ghost" id="mCancel">${esc(t('common.cancel'))}</button>
      <button class="btn btn-primary" id="mSend">${esc(t('common.send'))}</button></div>`);
  back.querySelector('#mCancel').addEventListener('click', close);
  back.querySelector('#mSend').addEventListener('click', async () => {
    const text = back.querySelector('#mText').value.trim();
    if (!text) return;
    try {
      const { message } = await api.startMessage(listing.id, text);
      close(); ctx.toast(t('common.send') + ' ✓');
      location.hash = '#/chat/' + message.threadId;
    } catch (e) { ctx.toast(e.message); }
  });
}

function openLightbox(images, startIndex = 0) {
  if (!images || !images.length) return;
  let i = startIndex;
  const { back, close } = modal(`<div class="lightbox">
    <button class="lb-close" aria-label="✕">✕</button>
    <button class="lb-nav lb-prev" aria-label="‹">‹</button>
    <img id="lbImg" src="${esc(images[i])}" alt="">
    <button class="lb-nav lb-next" aria-label="›">›</button>
    <div class="lb-count" id="lbCount">${i + 1} / ${images.length}</div>
  </div>`);
  back.classList.add('lightbox-back');
  const upd = () => { back.querySelector('#lbImg').src = images[i]; back.querySelector('#lbCount').textContent = `${i + 1} / ${images.length}`; };
  back.querySelector('.lb-prev').addEventListener('click', (e) => { e.stopPropagation(); i = (i - 1 + images.length) % images.length; upd(); });
  back.querySelector('.lb-next').addEventListener('click', (e) => { e.stopPropagation(); i = (i + 1) % images.length; upd(); });
  back.querySelector('.lb-close').addEventListener('click', close);
}
