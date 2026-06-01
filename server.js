/**
 * ОголошенняUK — сервер без зовнішніх залежностей.
 *
 * Працює лише на вбудованих модулях Node.js (http, fs, path, crypto).
 * Нічого не треба встановлювати: `node server.js` і готово.
 *
 *   • Віддає статику з /public
 *   • REST API: оголошення, акаунти/сесії, повідомлення (чат), скарги
 *   • Зберігає дані у data/db.runtime.json (JSON-сховище)
 *   • Приймає фото як base64 і кладе їх у public/uploads
 */

import http from 'node:http';
import { promises as fs } from 'node:fs';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  sendMail, mailEnabled,
  passwordResetEmail, welcomeEmail, newMessageEmail,
} from './mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const SEED_FILE = path.join(DATA_DIR, 'listings.json');
const DB_FILE = path.join(DATA_DIR, 'db.runtime.json');

const MAX_BODY = 20 * 1024 * 1024; // 20 МБ — вистачає на кілька стиснених фото
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 днів

// Публічна адреса (для канонічних URL у sitemap.xml). Можна задати через SITE_URL.
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

/* ----------------------------------------------------------------------------
 * Обмеження частоти запитів (rate limiting) — у пам'яті, ковзне вікно.
 * Захищає від брутфорсу логіну/реєстрації та спаму записами.
 * ------------------------------------------------------------------------- */
const RATE_BUCKETS = new Map(); // key -> [timestamps]
const RATE_DISABLED = process.env.DISABLE_RATE_LIMIT === '1'; // зручно для тестів

function rateLimit(key, limit, windowMs) {
  if (RATE_DISABLED) return true;
  const now = Date.now();
  const arr = (RATE_BUCKETS.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { RATE_BUCKETS.set(key, arr); return false; }
  arr.push(now);
  RATE_BUCKETS.set(key, arr);
  return true;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// Періодичне прибирання порожніх кошиків, щоб мапа не росла безмежно.
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of RATE_BUCKETS) {
    if (!arr.some((t) => now - t < 60 * 60 * 1000)) RATE_BUCKETS.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/* ----------------------------------------------------------------------------
 * Сховище даних (проста JSON-база з кешем у пам'яті)
 * ------------------------------------------------------------------------- */

let DB = {
  listings: [],
  users: [],
  sessions: {},   // token -> { userId, createdAt }
  messages: [],   // { id, listingId, threadId, fromUserId, toUserId, text, createdAt, readBy:[] }
  reports: [],    // { id, listingId, reason, text, createdAt, resolved }
  reviews: [],    // { id, sellerId, authorId, rating, text, createdAt }
  resets: {},     // token -> { userId, expiresAt }
};

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function loadDB() {
  await ensureDirs();
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    Object.assign(DB, JSON.parse(raw));
  } catch {
    // Перший запуск — беремо демо-дані оголошень із seed-файлу.
    try {
      const seed = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
      DB.listings = seed.listings || [];
    } catch {
      DB.listings = [];
    }
    await saveDB();
  }
  // Гарантуємо наявність усіх колекцій (міграція старих баз).
  DB.listings ||= [];
  DB.users ||= [];
  DB.sessions ||= {};
  DB.messages ||= [];
  DB.reports ||= [];
  DB.reviews ||= [];
  DB.resets ||= {};
  // Дефолтні поля для старих оголошень.
  for (const l of DB.listings) {
    l.status ||= 'active';
    l.bumpedAt ||= l.createdAt;
    if (!('userId' in l)) l.userId = null;
  }
  pruneSessions();
}

let saveQueue = Promise.resolve();
function saveDB() {
  saveQueue = saveQueue.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(DB), 'utf8');
    await fs.rename(tmp, DB_FILE);
  }).catch((e) => console.error('Помилка збереження бази:', e));
  return saveQueue;
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, s] of Object.entries(DB.sessions)) {
    if (now - new Date(s.createdAt).getTime() > SESSION_TTL) delete DB.sessions[token];
  }
}

/* ----------------------------------------------------------------------------
 * Утиліти
 * ------------------------------------------------------------------------- */

const uid = (n = 10) => crypto.randomBytes(16).toString('hex').slice(0, n);

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash: derived };
}
function verifyPassword(password, salt, hash) {
  try {
    const d = crypto.scryptSync(String(password), salt, 32);
    return crypto.timingSafeEqual(d, Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function clampStr(v, max) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

function sanitizePhone(v) {
  if (!v) return '';
  const s = String(v).trim();
  const plus = s.startsWith('+') ? '+' : '';
  return plus + s.replace(/[^\d]/g, '').slice(0, 18);
}

function sanitizeTelegram(v) {
  if (!v) return '';
  return String(v).trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body)
    ? body
    : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Тіло запиту завелике'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Некоректний JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const ALLOWED_IMG = {
  '/9j/': '.jpg',
  'iVBOR': '.png',
  'UklGR': '.webp',
  'R0lGO': '.gif',
};

async function saveImages(images, ownerId) {
  const out = [];
  if (!Array.isArray(images)) return out;
  for (let i = 0; i < images.length && i < 8; i++) {
    const dataUrl = images[i];
    if (typeof dataUrl !== 'string') continue;
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
    if (!m) {
      if (dataUrl.startsWith('/uploads/')) out.push(dataUrl);
      continue;
    }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) continue;
    let ext = '.jpg';
    const head = buf.toString('base64').slice(0, 5);
    for (const sig in ALLOWED_IMG) {
      if (head.startsWith(sig)) { ext = ALLOWED_IMG[sig]; break; }
    }
    const name = `${ownerId}-${i}-${uid(6)}${ext}`;
    await fs.writeFile(path.join(UPLOADS_DIR, name), buf);
    out.push(`/uploads/${name}`);
  }
  return out;
}

async function removeImageFiles(paths) {
  for (const p of paths || []) {
    if (typeof p === 'string' && p.startsWith('/uploads/')) {
      try { await fs.unlink(path.join(PUBLIC_DIR, p)); } catch { /* ignore */ }
    }
  }
}

/* ----------------------------------------------------------------------------
 * Автентифікація
 * ------------------------------------------------------------------------- */

function getToken(req, url) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return url.searchParams.get('token') || null;
}

function currentUser(req, url) {
  const token = getToken(req, url);
  if (!token) return null;
  const s = DB.sessions[token];
  if (!s) return null;
  if (Date.now() - new Date(s.createdAt).getTime() > SESSION_TTL) {
    delete DB.sessions[token];
    return null;
  }
  return DB.users.find((u) => u.id === s.userId) || null;
}

// Адміни визначаються змінною оточення ADMIN_EMAILS (через кому).
// Якщо її немає — адміном стає найперший зареєстрований користувач (зручно для self-host).
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);

function isAdmin(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (ADMIN_EMAILS.size) return ADMIN_EMAILS.has((user.email || '').toLowerCase());
  return false;
}

// Зведений рейтинг продавця: середнє і кількість відгуків.
function sellerRating(sellerId) {
  const rs = DB.reviews.filter((r) => r.sellerId === sellerId);
  if (!rs.length) return { avg: 0, count: 0 };
  const sum = rs.reduce((a, r) => a + r.rating, 0);
  return { avg: Math.round((sum / rs.length) * 10) / 10, count: rs.length };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, city: u.city || '', avatar: u.avatar || '',
    createdAt: u.createdAt, rating: sellerRating(u.id),
  };
}
function selfUser(u) {
  if (!u) return null;
  return { ...publicUser(u), email: u.email, phone: u.phone || '', isAdmin: isAdmin(u) };
}

async function registerUser(body) {
  const name = clampStr(body.name, 40);
  const email = clampStr(body.email, 120).toLowerCase();
  const password = String(body.password || '');
  if (name.length < 2) return { status: 400, body: { error: "Вкажіть ім'я (мін. 2 символи)." } };
  if (!validEmail(email)) return { status: 400, body: { error: 'Некоректний email.' } };
  if (password.length < 6) return { status: 400, body: { error: 'Пароль має містити мінімум 6 символів.' } };
  if (DB.users.some((u) => u.email === email)) return { status: 409, body: { error: 'Користувач із таким email вже існує.' } };

  const { salt, hash } = hashPassword(password);
  const user = {
    id: uid(12), name, email, salt, hash,
    phone: sanitizePhone(body.phone), city: clampStr(body.city, 60),
    avatar: '', createdAt: new Date().toISOString(),
    // Перший користувач стає адміном, якщо не задано ADMIN_EMAILS.
    isAdmin: !ADMIN_EMAILS.size && DB.users.length === 0,
  };
  DB.users.push(user);
  const token = issueSession(user.id);
  await saveDB();
  // Вітальний лист (необов'язковий — лише якщо налаштовано SMTP).
  const w = welcomeEmail(user.name);
  sendMail({ to: user.email, subject: w.subject, text: w.text, html: w.html });
  return { status: 201, body: { token, user: selfUser(user) } };
}

async function loginUser(body) {
  const email = clampStr(body.email, 120).toLowerCase();
  const password = String(body.password || '');
  const user = DB.users.find((u) => u.email === email);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    return { status: 401, body: { error: 'Невірний email або пароль.' } };
  }
  const token = issueSession(user.id);
  await saveDB();
  return { status: 200, body: { token, user: selfUser(user) } };
}

function issueSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  DB.sessions[token] = { userId, createdAt: new Date().toISOString() };
  return token;
}

async function updateProfile(user, body) {
  if (body.name != null) user.name = clampStr(body.name, 40) || user.name;
  if (body.phone != null) user.phone = sanitizePhone(body.phone);
  if (body.city != null) user.city = clampStr(body.city, 60);
  if (typeof body.avatar === 'string' && body.avatar.startsWith('data:image/')) {
    const [saved] = await saveImages([body.avatar], 'avatar-' + user.id);
    if (saved) { await removeImageFiles([user.avatar]); user.avatar = saved; }
  }
  await saveDB();
  return { status: 200, body: { user: selfUser(user) } };
}

/* ----------------------------------------------------------------------------
 * Оголошення
 * ------------------------------------------------------------------------- */

// Додаткові характеристики за категоріями. Тип: select | number | text | bool.
// Клієнт рендерить ті самі поля (public/js/attributes.js тримає підписи/мовність).
const CATEGORY_ATTRS = {
  housing: [
    { key: 'rooms', type: 'select', options: ['studio', '1', '2', '3', '4+'] },
    { key: 'furnished', type: 'select', options: ['furnished', 'unfurnished', 'partly'] },
    { key: 'billsIncluded', type: 'bool' },
    { key: 'period', type: 'select', options: ['monthly', 'weekly', 'daily'] },
  ],
  jobs: [
    { key: 'employment', type: 'select', options: ['fulltime', 'parttime', 'temporary', 'oneoff'] },
    { key: 'schedule', type: 'select', options: ['day', 'night', 'shift', 'flexible'] },
    { key: 'payPeriod', type: 'select', options: ['hour', 'day', 'week', 'month'] },
    { key: 'remote', type: 'bool' },
  ],
  transport: [
    { key: 'make', type: 'text', max: 40 },
    { key: 'year', type: 'number', min: 1950, max: 2030 },
    { key: 'mileage', type: 'number', min: 0, max: 2000000 },
    { key: 'fuel', type: 'select', options: ['petrol', 'diesel', 'hybrid', 'electric', 'other'] },
  ],
  electronics: [
    { key: 'condition', type: 'select', options: ['new', 'likenew', 'good', 'used', 'parts'] },
    { key: 'warranty', type: 'bool' },
  ],
  furniture: [
    { key: 'condition', type: 'select', options: ['new', 'likenew', 'good', 'used'] },
    { key: 'delivery', type: 'bool' },
  ],
  kids: [
    { key: 'condition', type: 'select', options: ['new', 'likenew', 'good', 'used'] },
  ],
  goods: [
    { key: 'condition', type: 'select', options: ['new', 'likenew', 'good', 'used', 'parts'] },
  ],
};

// Дозволені значення select-полів — для серверної валідації.
const ATTR_OPTION_SET = {};
for (const [cat, defs] of Object.entries(CATEGORY_ATTRS)) {
  ATTR_OPTION_SET[cat] = {};
  for (const d of defs) if (d.type === 'select') ATTR_OPTION_SET[cat][d.key] = new Set(d.options);
}

// Очищає атрибути відповідно до схеми категорії. Невідомі ключі відкидаються.
function sanitizeAttributes(category, raw) {
  const defs = CATEGORY_ATTRS[category];
  if (!defs || raw == null || typeof raw !== 'object') return {};
  const out = {};
  for (const d of defs) {
    const v = raw[d.key];
    if (v == null || v === '') continue;
    if (d.type === 'bool') { if (v === true || v === 'true' || v === 1) out[d.key] = true; }
    else if (d.type === 'number') {
      const n = Number(v);
      if (Number.isFinite(n) && (d.min == null || n >= d.min) && (d.max == null || n <= d.max)) out[d.key] = n;
    } else if (d.type === 'select') {
      if (ATTR_OPTION_SET[category][d.key].has(String(v))) out[d.key] = String(v);
    } else { // text
      const s = clampStr(v, d.max || 60);
      if (s) out[d.key] = s;
    }
  }
  return out;
}

function publicListing(l) {
  const { editTokenHash, ...rest } = l;
  const owner = l.userId ? DB.users.find((u) => u.id === l.userId) : null;
  return { ...rest, owner: owner ? publicUser(owner) : null };
}

function validateListing(b) {
  const errors = [];
  const title = clampStr(b.title, 80);
  const description = clampStr(b.description, 1200);
  const category = clampStr(b.category, 40);
  const location = clampStr(b.location, 80);
  const phone = sanitizePhone(b.phone);

  if (title.length < 3) errors.push('Вкажіть назву (мін. 3 символи).');
  if (description.length < 5) errors.push('Додайте короткий опис.');
  if (!category) errors.push('Оберіть категорію.');
  if (!location) errors.push('Вкажіть місто або поштовий індекс.');
  if (phone.replace(/\D/g, '').length < 7) errors.push('Вкажіть коректний номер телефону.');

  let price = null;
  if (b.price !== '' && b.price != null) {
    const n = Number(b.price);
    if (!Number.isFinite(n) || n < 0) errors.push('Ціна має бути числом.');
    else price = Math.round(n * 100) / 100;
  }

  return {
    errors,
    value: {
      title, description, category, location, phone, price,
      currency: clampStr(b.currency || 'GBP', 4),
      isFree: !!b.isFree,
      whatsapp: b.whatsapp === false ? '' : sanitizePhone(b.whatsapp || (b.whatsappSame ? phone : '')),
      telegram: sanitizeTelegram(b.telegram),
      attributes: sanitizeAttributes(category, b.attributes),
    },
  };
}

// Чи має право користувач/токен керувати оголошенням.
function canManage(listing, user, body, url) {
  if (isAdmin(user)) return true; // адмін може все
  if (user && listing.userId && listing.userId === user.id) return true;
  const tok = (body && body.editToken) || (url && url.searchParams.get('token'));
  if (tok && listing.editTokenHash && sha256(tok) === listing.editTokenHash) return true;
  return false;
}

async function createListing(body, user) {
  const { errors, value } = validateListing(body);
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };

  const id = uid(12);
  const token = uid(32);
  const images = await saveImages(body.images, id);

  const now = new Date().toISOString();
  const listing = {
    id, ...value, images,
    userId: user ? user.id : null,
    status: 'active',
    createdAt: now, updatedAt: now, bumpedAt: now,
    views: 0,
    editTokenHash: sha256(token),
  };
  DB.listings.unshift(listing);
  await saveDB();
  return { status: 201, body: { listing: publicListing(listing), editToken: token } };
}

async function updateListing(id, body, user, url) {
  const l = DB.listings.find((x) => x.id === id);
  if (!l) return { status: 404, body: { error: 'Оголошення не знайдено.' } };
  if (!canManage(l, user, body, url)) return { status: 403, body: { error: 'Немає прав на редагування.' } };

  // Зміна лише статусу (продано / активне) або підняття.
  if (body.action === 'status' && typeof body.status === 'string') {
    if (['active', 'sold', 'archived'].includes(body.status)) {
      l.status = body.status; l.updatedAt = new Date().toISOString();
      await saveDB();
      return { status: 200, body: { listing: publicListing(l) } };
    }
    return { status: 400, body: { error: 'Невідомий статус.' } };
  }
  if (body.action === 'bump') {
    l.bumpedAt = new Date().toISOString();
    await saveDB();
    return { status: 200, body: { listing: publicListing(l) } };
  }

  const { errors, value } = validateListing(body);
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };

  const keep = (body.images || []).filter((s) => typeof s === 'string' && s.startsWith('/uploads/'));
  const removed = (l.images || []).filter((p) => !keep.includes(p));
  const fresh = await saveImages(body.images, id);
  await removeImageFiles(removed);

  Object.assign(l, value, { images: fresh, updatedAt: new Date().toISOString() });
  await saveDB();
  return { status: 200, body: { listing: publicListing(l) } };
}

async function deleteListing(id, body, user, url) {
  const idx = DB.listings.findIndex((x) => x.id === id);
  if (idx === -1) return { status: 404, body: { error: 'Оголошення не знайдено.' } };
  const l = DB.listings[idx];
  if (!canManage(l, user, body, url)) return { status: 403, body: { error: 'Немає прав на видалення.' } };
  await removeImageFiles(l.images);
  DB.listings.splice(idx, 1);
  await saveDB();
  return { status: 200, body: { ok: true } };
}

function queryListings(params, user) {
  let items = DB.listings.slice();

  const q = (params.get('q') || '').trim().toLowerCase();
  const category = (params.get('category') || '').trim();
  const city = (params.get('city') || '').trim().toLowerCase();
  const min = params.get('min');
  const max = params.get('max');
  const free = params.get('free');
  const sort = params.get('sort') || 'new';
  const ownerId = params.get('owner');
  const status = params.get('status'); // active|sold|all
  const withPhoto = params.get('photo');

  // За замовчуванням показуємо лише активні (крім фільтра за власником/статусом).
  if (ownerId) items = items.filter((l) => l.userId === ownerId);
  else if (status === 'all') { /* усі */ }
  else if (status) items = items.filter((l) => l.status === status);
  else items = items.filter((l) => l.status === 'active');

  if (q) {
    items = items.filter((l) =>
      (l.title + ' ' + l.description + ' ' + l.location).toLowerCase().includes(q));
  }
  if (category) items = items.filter((l) => l.category === category);
  if (city) items = items.filter((l) => (l.location || '').toLowerCase().includes(city));
  if (free === '1') items = items.filter((l) => l.isFree || l.price === 0);
  if (withPhoto === '1') items = items.filter((l) => l.images && l.images.length);
  if (min) items = items.filter((l) => (l.price ?? Infinity) >= Number(min));
  if (max) items = items.filter((l) => (l.price ?? 0) <= Number(max));

  // Фільтри за характеристиками: ?attr_rooms=2&attr_furnished=furnished
  for (const [k, v] of params) {
    if (!k.startsWith('attr_') || v === '') continue;
    const key = k.slice(5);
    items = items.filter((l) => l.attributes && String(l.attributes[key]) === String(v));
  }

  switch (sort) {
    case 'cheap': items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)); break;
    case 'expensive': items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1)); break;
    case 'popular': items.sort((a, b) => (b.views || 0) - (a.views || 0)); break;
    default: items.sort((a, b) => ((b.bumpedAt || b.createdAt) > (a.bumpedAt || a.createdAt) ? 1 : -1));
  }

  const page = Math.max(1, Number(params.get('page')) || 1);
  const perPage = Math.min(48, Math.max(1, Number(params.get('perPage')) || 24));
  const total = items.length;
  const pageItems = items.slice((page - 1) * perPage, page * perPage).map(publicListing);

  return { items: pageItems, total, page, perPage, pages: Math.ceil(total / perPage) || 1 };
}

/* ----------------------------------------------------------------------------
 * Повідомлення (чат)
 * ------------------------------------------------------------------------- */

function threadIdFor(listingId, userA, userB) {
  // Стабільний ідентифікатор діалогу: оголошення + пара користувачів.
  const pair = [userA, userB].sort().join(':');
  return sha256(listingId + ':' + pair).slice(0, 16);
}

// Email-сповіщення про нове повідомлення — з антиспам-логікою:
// надсилаємо лише якщо у одержувача в цьому діалозі не було інших непрочитаних
// (окрім щойно створеного). Тобто серія повідомлень = один лист, поки не прочитають.
function notifyNewMessage(newMsg) {
  if (!mailEnabled) return;
  const priorUnread = DB.messages.some((m) =>
    m.threadId === newMsg.threadId && m.id !== newMsg.id &&
    m.toUserId === newMsg.toUserId && !m.readBy.includes(newMsg.toUserId));
  if (priorUnread) return; // лист уже надсилався, користувач ще не прочитав

  const to = DB.users.find((u) => u.id === newMsg.toUserId);
  const from = DB.users.find((u) => u.id === newMsg.fromUserId);
  const listing = DB.listings.find((x) => x.id === newMsg.listingId);
  if (!to || !from) return;
  const tpl = newMessageEmail({
    toName: to.name, fromName: from.name,
    listingTitle: listing ? listing.title : '—', threadId: newMsg.threadId,
  });
  sendMail({ to: to.email, subject: tpl.subject, text: tpl.text, html: tpl.html });
}

async function sendMessage(body, user) {
  if (!user) return { status: 401, body: { error: 'Увійдіть, щоб писати повідомлення.' } };
  const listing = DB.listings.find((x) => x.id === body.listingId);
  if (!listing) return { status: 404, body: { error: 'Оголошення не знайдено.' } };
  if (!listing.userId) return { status: 400, body: { error: 'У цього оголошення немає зареєстрованого власника. Скористайтеся телефоном/WhatsApp.' } };
  if (listing.userId === user.id) return { status: 400, body: { error: 'Це ваше власне оголошення.' } };
  const text = clampStr(body.text, 2000);
  if (text.length < 1) return { status: 400, body: { error: 'Порожнє повідомлення.' } };

  const toUserId = listing.userId;
  const threadId = threadIdFor(listing.id, user.id, toUserId);
  const msg = {
    id: uid(14), listingId: listing.id, threadId,
    fromUserId: user.id, toUserId, text,
    createdAt: new Date().toISOString(), readBy: [user.id],
  };
  DB.messages.push(msg);
  await saveDB();
  notifyNewMessage(msg);
  return { status: 201, body: { message: msg } };
}

function listThreads(user) {
  if (!user) return { status: 401, body: { error: 'Увійдіть, щоб бачити повідомлення.' } };
  const mine = DB.messages.filter((m) => m.fromUserId === user.id || m.toUserId === user.id);
  const byThread = new Map();
  for (const m of mine) {
    const prev = byThread.get(m.threadId);
    if (!prev || m.createdAt > prev.createdAt) byThread.set(m.threadId, m);
  }
  const threads = [...byThread.values()].map((last) => {
    const listing = DB.listings.find((x) => x.id === last.listingId);
    const otherId = last.fromUserId === user.id ? last.toUserId : last.fromUserId;
    const other = DB.users.find((u) => u.id === otherId);
    const unread = mine.filter((m) => m.threadId === last.threadId && !m.readBy.includes(user.id)).length;
    return {
      threadId: last.threadId,
      listing: listing ? { id: listing.id, title: listing.title, images: listing.images, price: listing.price, isFree: listing.isFree, status: listing.status } : null,
      other: publicUser(other),
      lastText: last.text, lastAt: last.createdAt,
      lastFromMe: last.fromUserId === user.id,
      unread,
    };
  }).sort((a, b) => (b.lastAt > a.lastAt ? 1 : -1));
  return { status: 200, body: { threads } };
}

async function getThread(threadId, user) {
  if (!user) return { status: 401, body: { error: 'Увійдіть.' } };
  const msgs = DB.messages.filter((m) => m.threadId === threadId &&
    (m.fromUserId === user.id || m.toUserId === user.id));
  if (!msgs.length) return { status: 404, body: { error: 'Діалог не знайдено.' } };
  let changed = false;
  for (const m of msgs) {
    if (!m.readBy.includes(user.id)) { m.readBy.push(user.id); changed = true; }
  }
  if (changed) await saveDB();
  const first = msgs[0];
  const listing = DB.listings.find((x) => x.id === first.listingId);
  const otherId = first.fromUserId === user.id ? first.toUserId : first.fromUserId;
  const other = DB.users.find((u) => u.id === otherId);
  return {
    status: 200,
    body: {
      threadId,
      listing: listing ? publicListing(listing) : null,
      other: publicUser(other),
      messages: msgs.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1)),
      me: user.id,
    },
  };
}

async function replyThread(threadId, body, user) {
  if (!user) return { status: 401, body: { error: 'Увійдіть.' } };
  const existing = DB.messages.find((m) => m.threadId === threadId &&
    (m.fromUserId === user.id || m.toUserId === user.id));
  if (!existing) return { status: 404, body: { error: 'Діалог не знайдено.' } };
  const text = clampStr(body.text, 2000);
  if (text.length < 1) return { status: 400, body: { error: 'Порожнє повідомлення.' } };
  const toUserId = existing.fromUserId === user.id ? existing.toUserId : existing.fromUserId;
  const msg = {
    id: uid(14), listingId: existing.listingId, threadId,
    fromUserId: user.id, toUserId, text,
    createdAt: new Date().toISOString(), readBy: [user.id],
  };
  DB.messages.push(msg);
  await saveDB();
  notifyNewMessage(msg);
  return { status: 201, body: { message: msg } };
}

function unreadCount(user) {
  if (!user) return { status: 200, body: { unread: 0 } };
  const n = DB.messages.filter((m) => m.toUserId === user.id && !m.readBy.includes(user.id)).length;
  return { status: 200, body: { unread: n } };
}

/* ----------------------------------------------------------------------------
 * Скарги
 * ------------------------------------------------------------------------- */

async function createReport(body) {
  const listing = DB.listings.find((x) => x.id === body.listingId);
  if (!listing) return { status: 404, body: { error: 'Оголошення не знайдено.' } };
  const report = {
    id: uid(12), listingId: listing.id,
    reason: clampStr(body.reason, 40) || 'other',
    text: clampStr(body.text, 500),
    createdAt: new Date().toISOString(), resolved: false,
  };
  DB.reports.push(report);
  await saveDB();
  return { status: 201, body: { ok: true } };
}

/* ----------------------------------------------------------------------------
 * Відгуки про продавців
 * ------------------------------------------------------------------------- */

function reviewView(r) {
  const author = DB.users.find((u) => u.id === r.authorId);
  return {
    id: r.id, sellerId: r.sellerId, rating: r.rating, text: r.text,
    createdAt: r.createdAt, author: publicUserLite(author),
  };
}
// Полегшена версія без рейтингу (щоб уникнути рекурсії sellerRating).
function publicUserLite(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, avatar: u.avatar || '' };
}

function listReviews(sellerId) {
  const reviews = DB.reviews
    .filter((r) => r.sellerId === sellerId)
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .map(reviewView);
  return { status: 200, body: { reviews, rating: sellerRating(sellerId) } };
}

async function createReview(sellerId, body, user) {
  if (!user) return { status: 401, body: { error: 'Увійдіть, щоб залишити відгук.' } };
  const seller = DB.users.find((u) => u.id === sellerId);
  if (!seller) return { status: 404, body: { error: 'Продавця не знайдено.' } };
  if (seller.id === user.id) return { status: 400, body: { error: 'Не можна оцінювати власний профіль.' } };

  const rating = Math.round(Number(body.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { status: 400, body: { error: 'Оцінка має бути від 1 до 5.' } };
  }
  const text = clampStr(body.text, 600);

  // Один відгук на пару (автор → продавець): оновлюємо наявний.
  let review = DB.reviews.find((r) => r.sellerId === sellerId && r.authorId === user.id);
  if (review) {
    review.rating = rating; review.text = text; review.createdAt = new Date().toISOString();
  } else {
    review = { id: uid(12), sellerId, authorId: user.id, rating, text, createdAt: new Date().toISOString() };
    DB.reviews.push(review);
  }
  await saveDB();
  return { status: 201, body: { review: reviewView(review), rating: sellerRating(sellerId) } };
}

/* ----------------------------------------------------------------------------
 * Скидання пароля (одноразовий токен)
 * ------------------------------------------------------------------------- */

const RESET_TTL = 1000 * 60 * 30; // 30 хвилин

async function requestPasswordReset(body) {
  const email = clampStr(body.email, 120).toLowerCase();
  const user = DB.users.find((u) => u.email === email);
  // Завжди відповідаємо однаково, щоб не розкривати наявність акаунта.
  const generic = { ok: true, message: 'Якщо такий email існує, ми надішлемо інструкції.' };
  if (!user) return { status: 200, body: generic };

  // Чистимо протухлі токени.
  const now = Date.now();
  for (const [tok, r] of Object.entries(DB.resets)) {
    if (r.expiresAt < now) delete DB.resets[tok];
  }
  const token = crypto.randomBytes(24).toString('hex');
  DB.resets[token] = { userId: user.id, expiresAt: now + RESET_TTL };
  await saveDB();

  // Надсилаємо лист зі скиданням (асинхронно, не блокуючи відповідь).
  const tpl = passwordResetEmail(token);
  sendMail({ to: user.email, subject: tpl.subject, text: tpl.text, html: tpl.html });
  if (!mailEnabled) console.log(`[reset] токен для ${email}: ${token}`);

  const out = { ...generic };
  // resetToken у відповіді — лише в демо-режимі без пошти (EXPOSE_RESET_TOKEN=1).
  if (process.env.EXPOSE_RESET_TOKEN === '1') out.resetToken = token;
  return { status: 200, body: out };
}

async function performPasswordReset(body) {
  const token = String(body.token || '');
  const password = String(body.password || '');
  const entry = DB.resets[token];
  if (!entry || entry.expiresAt < Date.now()) {
    return { status: 400, body: { error: 'Посилання недійсне або застаріле.' } };
  }
  if (password.length < 6) return { status: 400, body: { error: 'Пароль має містити мінімум 6 символів.' } };
  const user = DB.users.find((u) => u.id === entry.userId);
  if (!user) return { status: 400, body: { error: 'Користувача не знайдено.' } };

  const { salt, hash } = hashPassword(password);
  user.salt = salt; user.hash = hash;
  delete DB.resets[token];
  // Інвалідовуємо всі активні сесії користувача задля безпеки.
  for (const [tok, s] of Object.entries(DB.sessions)) {
    if (s.userId === user.id) delete DB.sessions[tok];
  }
  const newToken = issueSession(user.id);
  await saveDB();
  return { status: 200, body: { token: newToken, user: selfUser(user) } };
}

/* ----------------------------------------------------------------------------
 * Адмін / модерація
 * ------------------------------------------------------------------------- */

function adminStats() {
  const now = Date.now();
  const dayAgo = now - 1000 * 60 * 60 * 24;
  const newToday = DB.listings.filter((l) => new Date(l.createdAt).getTime() > dayAgo).length;
  return {
    listings: DB.listings.length,
    active: DB.listings.filter((l) => l.status === 'active').length,
    sold: DB.listings.filter((l) => l.status === 'sold').length,
    users: DB.users.length,
    messages: DB.messages.length,
    reportsOpen: DB.reports.filter((r) => !r.resolved).length,
    reportsTotal: DB.reports.length,
    newListingsToday: newToday,
  };
}

// Список скарг із прикріпленим оголошенням (для адмінки).
function adminReports(params) {
  const showResolved = params.get('resolved') === '1';
  const reports = DB.reports
    .filter((r) => showResolved || !r.resolved)
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .map((r) => {
      const listing = DB.listings.find((x) => x.id === r.listingId);
      return { ...r, listing: listing ? publicListing(listing) : null };
    });
  return { status: 200, body: { reports } };
}

async function resolveReport(id, body) {
  const r = DB.reports.find((x) => x.id === id);
  if (!r) return { status: 404, body: { error: 'Скаргу не знайдено.' } };
  r.resolved = body.resolved !== false;
  r.resolvedAt = new Date().toISOString();
  await saveDB();
  return { status: 200, body: { ok: true, report: r } };
}

// Адмін видаляє оголошення + закриває пов'язані скарги.
async function adminDeleteListing(id) {
  const idx = DB.listings.findIndex((x) => x.id === id);
  if (idx === -1) return { status: 404, body: { error: 'Оголошення не знайдено.' } };
  await removeImageFiles(DB.listings[idx].images);
  DB.listings.splice(idx, 1);
  for (const r of DB.reports) {
    if (r.listingId === id && !r.resolved) { r.resolved = true; r.resolvedAt = new Date().toISOString(); }
  }
  await saveDB();
  return { status: 200, body: { ok: true } };
}

// Експорт бази для бекапу. Прибираємо секрети (паролі, сесії, токени скидання,
// хеші редагування). Лишаємо контент і метадані, придатні для відновлення.
function adminBackup() {
  return {
    exportedAt: new Date().toISOString(),
    listings: DB.listings.map(({ editTokenHash, ...rest }) => rest),
    users: DB.users.map((u) => ({
      id: u.id, name: u.name, email: u.email, phone: u.phone || '',
      city: u.city || '', avatar: u.avatar || '', createdAt: u.createdAt, isAdmin: !!u.isAdmin,
    })),
    messages: DB.messages,
    reviews: DB.reviews,
    reports: DB.reports,
  };
}

/* ----------------------------------------------------------------------------
 * SEO: robots.txt та sitemap.xml
 * ------------------------------------------------------------------------- */

function baseUrl(req) {
  if (SITE_URL) return SITE_URL;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host || 'localhost'}`;
}

function serveRobots(req, res, url) {
  const body = `User-agent: *\nAllow: /\nSitemap: ${baseUrl(req)}/sitemap.xml\n`;
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.end(body);
}

function serveSitemap(req, res, url) {
  const base = baseUrl(req);
  const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const urls = [
    { loc: `${base}/`, priority: '1.0' },
    { loc: `${base}/#/search`, priority: '0.8' },
  ];
  // Активні оголошення — як хеш-маршрути.
  for (const l of DB.listings) {
    if (l.status !== 'active') continue;
    urls.push({ loc: `${base}/#/l/${l.id}`, lastmod: (l.updatedAt || l.createdAt).slice(0, 10), priority: '0.6' });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>` +
      (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
      `<priority>${u.priority}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.end(xml);
}

/* ----------------------------------------------------------------------------
 * Статика
 * ------------------------------------------------------------------------- */

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, { error: 'Заборонено' });
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) throw new Error('dir');
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const immutable = rel.startsWith('/uploads/') || rel.startsWith('/icons/');
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    });
    fssync.createReadStream(filePath).pipe(res);
  } catch {
    if (!path.extname(rel)) {
      try {
        const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        return res.end(html);
      } catch { /* fallthrough */ }
    }
    send(res, 404, { error: 'Не знайдено' });
  }
}

/* ----------------------------------------------------------------------------
 * Маршрутизація API
 * ------------------------------------------------------------------------- */

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', resource, ...]
  const resource = parts[1];
  const user = currentUser(req, url);

  try {
    if (resource === 'health') {
      return send(res, 200, { ok: true, listings: DB.listings.length, users: DB.users.length, mail: mailEnabled, time: new Date().toISOString() });
    }

    // Схема додаткових характеристик за категоріями (джерело істини на сервері).
    if (resource === 'meta' && parts[2] === 'attributes') {
      return send(res, 200, { attributes: CATEGORY_ATTRS }, { 'Cache-Control': 'public, max-age=3600' });
    }

    /* ---- Авторизація ---- */
    if (resource === 'auth') {
      const action = parts[2];
      const ip = clientIp(req);
      // Жорсткий ліміт на чутливі дії: 10 спроб за 5 хв з однієї адреси.
      if (req.method === 'POST' && ['register', 'login', 'forgot', 'reset'].includes(action)) {
        if (!rateLimit(`auth:${action}:${ip}`, 10, 5 * 60 * 1000)) {
          return send(res, 429, { error: 'Забагато спроб. Зачекайте кілька хвилин.' });
        }
      }
      if (req.method === 'POST' && action === 'register') {
        const r = await registerUser(await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === 'POST' && action === 'login') {
        const r = await loginUser(await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === 'POST' && action === 'logout') {
        const token = getToken(req, url);
        if (token) { delete DB.sessions[token]; await saveDB(); }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && action === 'me') {
        return send(res, 200, { user: selfUser(user) });
      }
      if (req.method === 'PUT' && action === 'me') {
        if (!user) return send(res, 401, { error: 'Не авторизовано.' });
        const r = await updateProfile(user, await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === 'POST' && action === 'forgot') {
        const r = await requestPasswordReset(await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === 'POST' && action === 'reset') {
        const r = await performPasswordReset(await readBody(req));
        return send(res, r.status, r.body);
      }
    }

    /* ---- Публічний профіль + відгуки ---- */
    if (resource === 'users' && parts[2]) {
      const sellerId = parts[2];
      const sub = parts[3];

      // /api/users/:id/reviews
      if (sub === 'reviews') {
        if (req.method === 'GET') {
          const r = listReviews(sellerId);
          return send(res, r.status, r.body);
        }
        if (req.method === 'POST') {
          const r = await createReview(sellerId, await readBody(req), user);
          return send(res, r.status, r.body);
        }
      }

      const u = DB.users.find((x) => x.id === sellerId);
      if (!u) return send(res, 404, { error: 'Користувача не знайдено.' });
      const active = DB.listings.filter((l) => l.userId === u.id && l.status === 'active').length;
      return send(res, 200, { user: publicUser(u), stats: { active } });
    }

    /* ---- Оголошення ---- */
    if (resource === 'listings') {
      const id = parts[2];
      if (req.method === 'GET' && !id) {
        return send(res, 200, queryListings(url.searchParams, user));
      }
      if (req.method === 'GET' && id) {
        const l = DB.listings.find((x) => x.id === id);
        if (!l) return send(res, 404, { error: 'Оголошення не знайдено.' });
        l.views = (l.views || 0) + 1;
        saveDB();
        return send(res, 200, { listing: publicListing(l) });
      }
      if (req.method === 'POST' && !id) {
        // Анти-спам: не більше 20 нових оголошень за годину з адреси.
        if (!rateLimit('newlisting:' + clientIp(req), 20, 60 * 60 * 1000)) {
          return send(res, 429, { error: 'Забагато оголошень за короткий час. Спробуйте пізніше.' });
        }
        const r = await createListing(await readBody(req), user);
        return send(res, r.status, r.body);
      }
      if ((req.method === 'PUT' || req.method === 'PATCH') && id) {
        const r = await updateListing(id, await readBody(req), user, url);
        return send(res, r.status, r.body);
      }
      if (req.method === 'DELETE' && id) {
        const body = await readBody(req).catch(() => ({}));
        const r = await deleteListing(id, body, user, url);
        return send(res, r.status, r.body);
      }
    }

    /* ---- Повідомлення ---- */
    if (resource === 'messages') {
      const sub = parts[2];
      if (req.method === 'GET' && sub === 'unread') {
        return send(res, 200, unreadCount(user).body);
      }
      if (req.method === 'GET' && !sub) {
        const r = listThreads(user);
        return send(res, r.status, r.body);
      }
      if (req.method === 'POST' && !sub) {
        if (user && !rateLimit('newchat:' + user.id, 30, 60 * 60 * 1000)) {
          return send(res, 429, { error: 'Забагато нових діалогів. Спробуйте пізніше.' });
        }
        const r = await sendMessage(await readBody(req), user);
        return send(res, r.status, r.body);
      }
      if (req.method === 'GET' && sub) {
        const r = await getThread(sub, user);
        return send(res, r.status, r.body);
      }
      if (req.method === 'POST' && sub) {
        const r = await replyThread(sub, await readBody(req), user);
        return send(res, r.status, r.body);
      }
    }

    /* ---- Скарги ---- */
    if (resource === 'reports' && req.method === 'POST') {
      const r = await createReport(await readBody(req));
      return send(res, r.status, r.body);
    }

    /* ---- Адмін / модерація ---- */
    if (resource === 'admin') {
      if (!isAdmin(user)) return send(res, 403, { error: 'Доступ лише для адміністратора.' });
      const sub = parts[2];

      if (req.method === 'GET' && sub === 'stats') {
        return send(res, 200, adminStats());
      }
      if (req.method === 'GET' && sub === 'reports') {
        const r = adminReports(url.searchParams);
        return send(res, r.status, r.body);
      }
      if (req.method === 'POST' && sub === 'reports' && parts[3]) {
        const r = await resolveReport(parts[3], await readBody(req));
        return send(res, r.status, r.body);
      }
      if (req.method === 'DELETE' && sub === 'listings' && parts[3]) {
        const r = await adminDeleteListing(parts[3]);
        return send(res, r.status, r.body);
      }
      // Бекап усієї бази (без паролів/токенів) — для збереження адміном.
      if (req.method === 'GET' && sub === 'backup') {
        const dump = adminBackup();
        return send(res, 200, dump, {
          'Content-Disposition': `attachment; filename="ouk-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        });
      }
    }

    return send(res, 404, { error: 'Невідомий маршрут API.' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('API error:', err);
    return send(res, status, { error: err.message || 'Внутрішня помилка сервера.' });
  }
}

/* ----------------------------------------------------------------------------
 * Сервер
 * ------------------------------------------------------------------------- */

// Заголовки безпеки для всіх відповідей.
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // CSP: дозволяємо лише власні ресурси + data:/blob: для зображень (фото як data-URL),
  // та зовнішні переходи на tel:/wa.me/t.me відкриваються браузером поза CSP.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  securityHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // robots.txt та sitemap.xml — для пошукових систем.
  if (url.pathname === '/robots.txt') return serveRobots(req, res, url);
  if (url.pathname === '/sitemap.xml') return serveSitemap(req, res, url);

  if (url.pathname.startsWith('/api/')) {
    // Базовий ліміт на всі API-запити з однієї адреси.
    if (!rateLimit('api:' + clientIp(req), 600, 60 * 1000)) {
      return send(res, 429, { error: 'Забагато запитів. Спробуйте за хвилину.' });
    }
    return handleApi(req, res, url);
  }
  return serveStatic(req, res, url.pathname);
});

loadDB().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`\n  ОголошенняUK ▸ http://localhost:${PORT}`);
    console.log(`  Оголошень: ${DB.listings.length} · Користувачів: ${DB.users.length}\n`);
  });
});
