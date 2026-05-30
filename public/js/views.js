// Рендер екранів. Кожен експорт повертає { render, mount? }.
// mount(root, ctx) викликається після вставки HTML — там навішуються події.

import { api, store } from './api.js';
import {
  CATEGORIES, CITIES, SORTS,
  catLabel, formatPrice, timeAgo, esc,
} from './data.js';

/* ============================ Дрібні частини ============================ */

const pinSvg = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>`;
const camSvg = `<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3z"/><circle cx="12" cy="13" r="3.2" fill="#fff"/></svg>`;
const starSvg = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z"/></svg>`;

// Картка БЕЗ фото — фото показуємо лише на сторінці оголошення.
export function cardHTML(l) {
  const fav = store.isFav(l.id);
  const hasPhoto = l.images && l.images.length;
  const photoTag = hasPhoto
    ? `<span class="card-cat has-photo" title="Є фото">${camSvg} ${l.images.length}</span>` : '';
  return `
  <article class="card">
    <div class="card-top">
      <a class="card-cat" href="#/c/${l.category}" data-link>${esc(catLabel(l.category))}</a>
      <button class="card-fav ${fav ? 'on' : ''}" data-fav="${l.id}" aria-label="Зберегти">${starSvg}</button>
    </div>
    <a href="#/l/${l.id}" data-link style="display:flex;flex-direction:column;flex:1">
      <h3 class="card-title">${esc(l.title)}</h3>
      <p class="card-desc">${esc(l.description)}</p>
      <div class="card-foot">
        <span class="price ${l.isFree || l.price === 0 ? 'free' : ''}">${formatPrice(l)}</span>
        <span class="card-loc">${pinSvg}<span>${esc(l.location)}</span></span>
      </div>
      <div class="card-time">${timeAgo(l.createdAt)}${hasPhoto ? ' · 📷 фото' : ''}</div>
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
    <p><b>ОголошенняUK</b> — безкоштовна дошка оголошень для української спільноти у Великій Британії.</p>
    <p class="muted">Будьте обережні: не переказуйте гроші наперед незнайомцям і перевіряйте інформацію особисто.</p>
  </div></footer>`;
}

/* ============================ Головна ============================ */

export const HomeView = {
  async render() {
    return `
    <section class="hero"><div class="container hero-inner">
      <h1>Оголошення для українців у Британії 🇺🇦🇬🇧</h1>
      <p>Робота, житло, послуги, речі та підвезення — швидко і безкоштовно.</p>
    </div></section>

    <div class="container">
      <div class="section-head"><h2>Категорії</h2><a class="muted" href="#/search" data-link>Усі оголошення →</a></div>
      <div class="cat-grid" id="catGrid">
        ${CATEGORIES.map((c) => `
          <a class="cat-tile" href="#/c/${c.slug}" data-link>
            <span class="emoji">${c.emoji}</span>
            <span class="name">${esc(c.name)}</span>
            <span class="n" data-cat-count="${c.slug}">—</span>
          </a>`).join('')}
      </div>

      <div class="section-head"><h2>Свіжі оголошення</h2><span class="count" id="freshCount"></span></div>
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
           <div class="pagination"><a class="btn" href="#/search" data-link>Дивитися всі оголошення →</a></div>`
        : emptyHTML('Поки що порожньо', 'Станьте першим — додайте оголошення.',
            '<a class="btn btn-primary mt16" href="#/new" data-link>Додати оголошення</a>');
      root.querySelector('#freshCount').textContent = `всього ${total}`;
    } catch (e) {
      root.querySelector('#freshGrid').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    }
    // Лічильники по категоріях
    try {
      const all = await api.list({ perPage: 48 });
      const counts = {};
      all.items.forEach((l) => { counts[l.category] = (counts[l.category] || 0) + 1; });
      root.querySelectorAll('[data-cat-count]').forEach((el) => {
        const n = counts[el.dataset.catCount] || 0;
        el.textContent = n ? `${n} оголош.` : 'немає';
      });
    } catch { /* лічильники не критичні */ }
  },
};

/* ============================ Пошук / Список ============================ */

export const SearchView = {
  async render(ctx) {
    const p = ctx.query;
    const activeCat = ctx.params.cat || p.category || '';
    const catTitle = activeCat ? catLabel(activeCat) : 'Усі оголошення';

    return `
    <div class="container">
      <div class="section-head"><h2>${esc(catTitle)}</h2><span class="count" id="resCount"></span></div>

      <div class="cat-scroll" id="catScroll">
        <button class="chip ${!activeCat ? 'active' : ''}" data-cat="">Усі</button>
        ${CATEGORIES.map((c) => `<button class="chip ${activeCat === c.slug ? 'active' : ''}" data-cat="${c.slug}"><span class="emoji">${c.emoji}</span>${esc(c.name)}</button>`).join('')}
      </div>

      <div class="toolbar mt8">
        <div class="field" style="flex:1;min-width:160px">
          <input class="input" id="fQ" placeholder="Слово в оголошенні…" value="${esc(p.q || '')}">
        </div>
        <div class="field"><select class="select" id="fCity">
          <option value="">Будь-яке місто</option>
          ${CITIES.map((c) => `<option ${p.city === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select></div>
        <div class="field"><input class="input" id="fMin" type="number" inputmode="numeric" placeholder="Ціна від £" value="${esc(p.min || '')}" style="width:120px"></div>
        <div class="field"><input class="input" id="fMax" type="number" inputmode="numeric" placeholder="до £" value="${esc(p.max || '')}" style="width:110px"></div>
        <div class="field"><select class="select" id="fSort">
          ${SORTS.map((s) => `<option value="${s.value}" ${p.sort === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select></div>
        <label class="switch"><input type="checkbox" id="fFree" ${p.free === '1' ? 'checked' : ''}><span class="track"></span><span>Безкоштовні</span></label>
        <button class="btn btn-ghost" id="fReset">Скинути</button>
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
      q: get('#fQ').value.trim(),
      city: get('#fCity').value,
      min: get('#fMin').value,
      max: get('#fMax').value,
      sort: get('#fSort').value,
      free: get('#fFree').checked ? '1' : '',
      category: activeCat,
    });

    async function load() {
      const results = get('#results');
      results.innerHTML = gridSkeleton(6);
      try {
        const data = await api.list({ ...collect(), page, perPage: 24 });
        get('#resCount').textContent = `${data.total} знайдено`;
        results.innerHTML = data.items.length
          ? `<div class="grid">${data.items.map(cardHTML).join('')}</div>`
          : emptyHTML('Нічого не знайдено', 'Спробуйте змінити фільтри або пошуковий запит.');
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

    // Події фільтрів
    let t;
    const debounced = () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 350); };
    get('#fQ').addEventListener('input', debounced);
    ['#fCity', '#fMin', '#fMax', '#fSort', '#fFree'].forEach((s) =>
      get(s).addEventListener('change', () => { page = 1; load(); }));
    get('#fReset').addEventListener('click', () => {
      get('#fQ').value = ''; get('#fCity').value = ''; get('#fMin').value = '';
      get('#fMax').value = ''; get('#fSort').value = 'new'; get('#fFree').checked = false;
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
    return `<div class="container"><a class="back-link" href="javascript:history.back()">‹ Назад</a><div id="detailRoot">${gridSkeleton(2)}</div></div>`;
  },
  async mount(root, ctx) {
    const el = root.querySelector('#detailRoot');
    try {
      const { listing: l } = await api.get(ctx.params.id);
      const fav = store.isFav(l.id);
      const owned = !!store.tokenFor(l.id);

      const images = l.images || [];
      const gallery = images.length ? `
        <div class="main"><img id="mainImg" src="${esc(images[0])}" alt="${esc(l.title)}"></div>
        ${images.length > 1 ? `<div class="strip">${images.map((src, i) =>
          `<img class="${i === 0 ? 'active' : ''}" data-i="${i}" src="${esc(src)}" alt="фото ${i + 1}">`).join('')}</div>` : ''}`
      : `<div class="main"><div class="ph"><div class="big">📷</div><div>Світлини не додано</div></div></div>`;

      // Контакти
      const phoneDigits = (l.phone || '').replace(/[^\d+]/g, '');
      const waDigits = (l.whatsapp || '').replace(/[^\d]/g, '');
      const contacts = [];
      if (l.phone) contacts.push(`<a class="contact-btn c-call" href="tel:${esc(phoneDigits)}">
        <span class="ic">📞</span><span>Подзвонити<small class="phone-reveal">${esc(l.phone)}</small></span></a>`);
      if (waDigits) contacts.push(`<a class="contact-btn c-wa" href="https://wa.me/${esc(waDigits)}" target="_blank" rel="noopener">
        <span class="ic">💬</span><span>Написати в WhatsApp<small>${esc(l.whatsapp)}</small></span></a>`);
      if (l.telegram) contacts.push(`<a class="contact-btn c-tg" href="https://t.me/${esc(l.telegram)}" target="_blank" rel="noopener">
        <span class="ic">✈️</span><span>Telegram<small>@${esc(l.telegram)}</small></span></a>`);

      const freeCls = l.isFree || l.price === 0;
      el.innerHTML = `
      <div class="detail">
        <div class="gallery">${gallery}</div>
        <div class="detail-side">
          <div class="detail-card">
            <a class="card-cat" href="#/c/${l.category}" data-link>${esc(catLabel(l.category))}</a>
            <h1>${esc(l.title)}</h1>
            <div class="price-lg" style="${freeCls ? 'color:var(--success)' : ''}">${formatPrice(l)}</div>
            <div class="meta">
              <span>${pinSvg}${esc(l.location)}</span>
              <span>🕒 ${timeAgo(l.createdAt)}</span>
              <span>👁️ ${l.views || 0}</span>
            </div>
            <div class="row-gap">
              <button class="btn ${fav ? 'btn-primary' : ''}" id="favBtn">${fav ? '★ Збережено' : '☆ Зберегти'}</button>
              <button class="btn btn-ghost" id="shareBtn">↗ Поділитися</button>
            </div>
          </div>

          <div class="detail-card">
            <h2 style="margin:0 0 12px;font-size:1.05rem">Контакти</h2>
            <div class="contact-list">${contacts.join('') || '<p class="muted">Контактів не вказано.</p>'}</div>
            <p class="hint mt16">⚠️ Не переказуйте передоплату незнайомим людям.</p>
          </div>

          ${owned ? `<div class="detail-card">
            <h2 style="margin:0 0 12px;font-size:1.05rem">Керування</h2>
            <div class="row-gap">
              <a class="btn" href="#/edit/${l.id}" data-link>✏️ Редагувати</a>
              <button class="btn btn-danger" id="delBtn">🗑️ Видалити</button>
            </div></div>` : ''}
        </div>
      </div>

      <div class="container" style="padding:0;max-width:980px">
        <div class="detail-card mt24"><h2 style="margin:0 0 10px;font-size:1.1rem">Опис</h2>
          <div class="desc">${esc(l.description)}</div></div>
      </div>`;

      // Галерея
      el.querySelectorAll('.strip img').forEach((img) => img.addEventListener('click', () => {
        el.querySelector('#mainImg').src = img.src;
        el.querySelectorAll('.strip img').forEach((x) => x.classList.remove('active'));
        img.classList.add('active');
      }));

      // Збереження
      el.querySelector('#favBtn').addEventListener('click', (e) => {
        const on = store.toggleFav(l.id);
        e.target.textContent = on ? '★ Збережено' : '☆ Зберегти';
        e.target.classList.toggle('btn-primary', on);
        ctx.toast(on ? 'Додано до збережених' : 'Прибрано зі збережених');
      });

      // Поділитися
      el.querySelector('#shareBtn').addEventListener('click', async () => {
        const url = location.href;
        try {
          if (navigator.share) await navigator.share({ title: l.title, url });
          else { await navigator.clipboard.writeText(url); ctx.toast('Посилання скопійовано'); }
        } catch { /* користувач скасував */ }
      });

      // Видалення
      const delBtn = el.querySelector('#delBtn');
      if (delBtn) delBtn.addEventListener('click', async () => {
        if (!confirm('Видалити це оголошення?')) return;
        try {
          await api.remove(l.id, store.tokenFor(l.id));
          store.removeMine(l.id);
          ctx.toast('Оголошення видалено');
          location.hash = '#/mine';
        } catch (e) { ctx.toast(e.message); }
      });
    } catch (e) {
      el.innerHTML = emptyHTML('Оголошення не знайдено', e.message,
        '<a class="btn btn-primary mt16" href="#/search" data-link>До всіх оголошень</a>');
    }
  },
};

/* ============================ Форма (нове / редагування) ============================ */

export const FormView = {
  async render(ctx) {
    const editing = ctx.name === 'edit';
    return `<div class="container"><a class="back-link" href="javascript:history.back()">‹ Назад</a>
      <div class="form-card">
        <h1 style="margin:0 0 4px;font-size:1.4rem">${editing ? 'Редагувати оголошення' : 'Нове оголошення'}</h1>
        <p class="muted" style="margin:0 0 18px">Заповніть коротко й по суті — так швидше відгукнуться.</p>
        <div id="formAlert"></div>
        <form id="adForm">
          <div class="form-grid">
            <div class="field">
              <div class="help-row"><label class="lbl">Назва <span class="req">*</span></label><span class="counter"><span id="cTitle">0</span>/80</span></div>
              <input class="input" id="title" maxlength="80" placeholder="Напр.: Кімната в Лондоні для українки" required>
            </div>

            <div class="form-grid two">
              <div class="field"><label class="lbl">Категорія <span class="req">*</span></label>
                <select class="select" id="category" required>
                  <option value="">Оберіть категорію…</option>
                  ${CATEGORIES.map((c) => `<option value="${c.slug}">${c.emoji} ${esc(c.name)}</option>`).join('')}
                </select></div>
              <div class="field"><label class="lbl">Місто або індекс <span class="req">*</span></label>
                <input class="input" id="location" list="cityList" maxlength="80" placeholder="London, E1 6AN або просто Manchester" required>
                <datalist id="cityList">${CITIES.map((c) => `<option value="${c}">`).join('')}</datalist>
                <span class="hint">Можна повний чи частковий пост-код, або лише місто.</span></div>
            </div>

            <div class="form-grid two">
              <div class="field"><label class="lbl">Ціна, £</label>
                <input class="input" id="price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="напр. 650">
                <label class="switch mt8"><input type="checkbox" id="isFree"><span class="track"></span><span>Безкоштовно / договірна</span></label></div>
              <div class="field"><label class="lbl">Телефон <span class="req">*</span></label>
                <input class="input" id="phone" type="tel" maxlength="20" placeholder="+44 7700 900000" required>
                <label class="switch mt8"><input type="checkbox" id="waSame" checked><span class="track"></span><span>Цей номер у WhatsApp</span></label></div>
            </div>

            <div class="form-grid two">
              <div class="field" id="waWrap" style="display:none"><label class="lbl">WhatsApp (інший номер)</label>
                <input class="input" id="whatsapp" type="tel" maxlength="20" placeholder="+44 …"></div>
              <div class="field"><label class="lbl">Telegram (за бажанням)</label>
                <input class="input" id="telegram" maxlength="40" placeholder="username (без @)"></div>
            </div>

            <div class="field">
              <div class="help-row"><label class="lbl">Опис <span class="req">*</span></label><span class="counter"><span id="cDesc">0</span>/1200</span></div>
              <textarea class="textarea" id="description" maxlength="1200" placeholder="Коротко опишіть: що, в якому стані, умови, коли можна забрати/зустрітися…" required></textarea>
            </div>

            <div class="field"><label class="lbl">Фото (до 8)</label>
              <div class="dropzone" id="dz">
                <div class="dz-ico">📷</div>
                <div class="dz-title">Натисніть або перетягніть фото</div>
                <div class="dz-sub">Показуються тільки на сторінці оголошення. JPG/PNG/WebP.</div>
                <input type="file" id="files" accept="image/*" multiple hidden>
              </div>
              <div class="thumbs" id="thumbs"></div>
            </div>
          </div>

          <button class="btn btn-primary btn-lg btn-block mt24" id="submitBtn" type="submit">${editing ? 'Зберегти зміни' : 'Опублікувати оголошення'}</button>
        </form>
      </div></div>`;
  },

  async mount(root, ctx) {
    const editing = ctx.name === 'edit';
    const $ = (id) => root.querySelector(id);
    let images = []; // масив рядків: data-URL (нові) або /uploads/... (наявні)

    // Лічильники символів
    const bindCounter = (inputId, outId) => {
      const inp = $(inputId), out = $(outId);
      const upd = () => { out.textContent = inp.value.length; };
      inp.addEventListener('input', upd); upd();
    };
    bindCounter('#title', '#cTitle');
    bindCounter('#description', '#cDesc');

    // WhatsApp окремий номер
    $('#waSame').addEventListener('change', (e) => {
      $('#waWrap').style.display = e.target.checked ? 'none' : '';
    });
    // Безкоштовно → блокуємо ціну
    $('#isFree').addEventListener('change', (e) => {
      $('#price').disabled = e.target.checked;
      if (e.target.checked) $('#price').value = '';
    });

    /* -------- Фото: вибір, стиснення, прев'ю -------- */
    function renderThumbs() {
      $('#thumbs').innerHTML = images.map((src, i) => `
        <div class="thumb">
          <img src="${src}" alt="">
          ${i === 0 ? '<span class="cover-badge">Головне</span>' : ''}
          <button type="button" class="rm" data-rm="${i}" aria-label="Видалити">✕</button>
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
            if (w > MAX || h > MAX) {
              const r = Math.min(MAX / w, MAX / h);
              w = Math.round(w * r); h = Math.round(h * r);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.onerror = reject;
          img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      for (const f of files) {
        if (images.length >= 8) { ctx.toast('Максимум 8 фото'); break; }
        try { images.push(await compress(f)); } catch { ctx.toast('Не вдалося обробити фото'); }
      }
      renderThumbs();
    }

    $('#dz').addEventListener('click', () => $('#files').click());
    $('#files').addEventListener('change', (e) => addFiles(e.target.files));
    ['dragover', 'dragenter'].forEach((ev) => $('#dz').addEventListener(ev, (e) => { e.preventDefault(); $('#dz').classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => $('#dz').addEventListener(ev, (e) => { e.preventDefault(); $('#dz').classList.remove('drag'); }));
    $('#dz').addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

    /* -------- Передзаповнення при редагуванні -------- */
    if (editing) {
      try {
        const { listing: l } = await api.get(ctx.params.id);
        if (!store.tokenFor(l.id)) {
          $('#formAlert').innerHTML = `<div class="alert alert-error">Це оголошення створено не з цього пристрою — редагувати не можна.</div>`;
        }
        $('#title').value = l.title; $('#description').value = l.description;
        $('#category').value = l.category; $('#location').value = l.location;
        $('#phone').value = l.phone || ''; $('#telegram').value = l.telegram || '';
        $('#isFree').checked = !!l.isFree;
        $('#price').value = (l.price != null && !l.isFree) ? l.price : '';
        $('#price').disabled = !!l.isFree;
        const sameWa = l.whatsapp && l.whatsapp.replace(/\D/g, '') === (l.phone || '').replace(/\D/g, '');
        if (!sameWa && l.whatsapp) { $('#waSame').checked = false; $('#waWrap').style.display = ''; $('#whatsapp').value = l.whatsapp; }
        else { $('#waSame').checked = true; $('#waWrap').style.display = 'none'; }
        images = (l.images || []).slice();
        renderThumbs();
        $('#cTitle').textContent = l.title.length;
        $('#cDesc').textContent = l.description.length;
      } catch (e) {
        $('#formAlert').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
      }
    }

    /* -------- Надсилання -------- */
    $('#adForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#submitBtn');
      const payload = {
        title: $('#title').value, description: $('#description').value,
        category: $('#category').value, location: $('#location').value,
        phone: $('#phone').value, telegram: $('#telegram').value,
        isFree: $('#isFree').checked,
        price: $('#isFree').checked ? '' : $('#price').value,
        whatsappSame: $('#waSame').checked,
        whatsapp: $('#waSame').checked ? $('#phone').value : $('#whatsapp').value,
        images,
      };
      btn.disabled = true; btn.textContent = 'Зберігаємо…';
      $('#formAlert').innerHTML = '';
      try {
        if (editing) {
          const { listing } = await api.update(ctx.params.id, { ...payload, editToken: store.tokenFor(ctx.params.id) });
          ctx.toast('Зміни збережено ✓');
          location.hash = '#/l/' + listing.id;
        } else {
          const { listing, editToken } = await api.create(payload);
          store.addMine(listing.id, editToken, listing.title);
          ctx.toast('Оголошення опубліковано ✓');
          location.hash = '#/l/' + listing.id;
        }
      } catch (err) {
        $('#formAlert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = editing ? 'Зберегти зміни' : 'Опублікувати оголошення';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  },
};

/* ============================ Збережені ============================ */

export const SavedView = {
  async render() {
    return `<div class="container"><div class="section-head"><h2>★ Збережені оголошення</h2></div><div id="savedGrid">${gridSkeleton(4)}</div></div>`;
  },
  async mount(root) {
    const ids = store.favs();
    const el = root.querySelector('#savedGrid');
    if (!ids.length) {
      el.innerHTML = emptyHTML('Немає збережених', 'Натискайте ☆ на оголошеннях, щоб зберегти їх тут.',
        '<a class="btn btn-primary mt16" href="#/search" data-link>До оголошень</a>');
      return;
    }
    const results = await Promise.allSettled(ids.map((id) => api.get(id)));
    const items = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.listing);
    el.innerHTML = items.length
      ? `<div class="grid">${items.map(cardHTML).join('')}</div>`
      : emptyHTML('Збережені оголошення недоступні', 'Можливо, їх уже видалили.');
  },
};

/* ============================ Мої оголошення ============================ */

export const MineView = {
  async render() {
    return `<div class="container"><div class="section-head"><h2>👤 Мої оголошення</h2>
      <a class="btn btn-primary" href="#/new" data-link>+ Додати</a></div>
      <div class="alert alert-info">Оголошення прив'язані до цього пристрою/браузера через токен редагування.</div>
      <div id="mineGrid">${gridSkeleton(4)}</div></div>`;
  },
  async mount(root) {
    const mine = store.mine();
    const ids = Object.keys(mine);
    const el = root.querySelector('#mineGrid');
    if (!ids.length) {
      el.innerHTML = emptyHTML('Ви ще нічого не додали', 'Опублікуйте перше оголошення — це безкоштовно.',
        '<a class="btn btn-primary mt16" href="#/new" data-link>Додати оголошення</a>');
      return;
    }
    const results = await Promise.allSettled(ids.map((id) => api.get(id)));
    const items = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.listing);
    // Прибираємо з локального списку ті, що зникли
    ids.forEach((id, i) => { if (results[i].status === 'rejected') store.removeMine(id); });
    el.innerHTML = items.length
      ? `<div class="grid">${items.map(cardHTML).join('')}</div>`
      : emptyHTML('Оголошень немає', 'Можливо, їх видалили.');
  },
};
