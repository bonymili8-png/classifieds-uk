/**
 * ОголошенняUK — сервер без зовнішніх залежностей.
 *
 * Працює лише на вбудованих модулях Node.js (http, fs, path, crypto).
 * Нічого не треба встановлювати: `node server.js` і готово.
 *
 *   • Віддає статику з /public
 *   • REST API для оголошень (/api/...)
 *   • Зберігає дані у data/listings.runtime.json (JSON-сховище)
 *   • Приймає фото як base64 і кладе їх у public/uploads
 */

import http from 'node:http';
import { promises as fs } from 'node:fs';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const SEED_FILE = path.join(DATA_DIR, 'listings.json');
const DB_FILE = path.join(DATA_DIR, 'listings.runtime.json');

const MAX_BODY = 20 * 1024 * 1024; // 20 МБ — вистачає на кілька стиснених фото

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

let DB = { listings: [] };

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function loadDB() {
  await ensureDirs();
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    DB = JSON.parse(raw);
  } catch {
    // Перший запуск — беремо демо-дані з seed-файлу.
    try {
      const seed = await fs.readFile(SEED_FILE, 'utf8');
      DB = JSON.parse(seed);
    } catch {
      DB = { listings: [] };
    }
    await saveDB();
  }
  if (!Array.isArray(DB.listings)) DB.listings = [];
}

let saveQueue = Promise.resolve();
function saveDB() {
  // Серіалізуємо записи, щоб уникнути гонок під час паралельних запитів.
  saveQueue = saveQueue.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(DB, null, 2), 'utf8');
    await fs.rename(tmp, DB_FILE);
  }).catch((e) => console.error('Помилка збереження бази:', e));
  return saveQueue;
}

/* ----------------------------------------------------------------------------
 * Утиліти
 * ------------------------------------------------------------------------- */

const uid = (n = 10) => crypto.randomBytes(16).toString('hex').slice(0, n);

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function clampStr(v, max) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

function sanitizePhone(v) {
  if (!v) return '';
  // Лишаємо цифри та провідний +
  const s = String(v).trim();
  const plus = s.startsWith('+') ? '+' : '';
  return plus + s.replace(/[^\d]/g, '').slice(0, 18);
}

function sanitizeTelegram(v) {
  if (!v) return '';
  return String(v).trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
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
  '/9j/': '.jpg', // jpeg
  'iVBOR': '.png',
  'UklGR': '.webp',
  'R0lGO': '.gif',
};

/** Зберігає масив data-URL зображень як файли, повертає масив відносних шляхів. */
async function saveImages(images, listingId) {
  const out = [];
  if (!Array.isArray(images)) return out;
  for (let i = 0; i < images.length && i < 8; i++) {
    const dataUrl = images[i];
    if (typeof dataUrl !== 'string') continue;
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
    if (!m) {
      // Можливо, це вже збережений шлях (під час редагування) — лишаємо як є.
      if (dataUrl.startsWith('/uploads/')) out.push(dataUrl);
      continue;
    }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) continue; // окреме фото не більше 6 МБ
    let ext = '.jpg';
    const head = buf.toString('base64').slice(0, 5);
    for (const sig in ALLOWED_IMG) {
      if (head.startsWith(sig)) { ext = ALLOWED_IMG[sig]; break; }
    }
    const name = `${listingId}-${i}-${uid(6)}${ext}`;
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
 * Робота з оголошеннями
 * ------------------------------------------------------------------------- */

function publicListing(l) {
  // Не віддаємо назовні токен редагування.
  const { editTokenHash, ...rest } = l;
  return rest;
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
    },
  };
}

async function createListing(body) {
  const { errors, value } = validateListing(body);
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };

  const id = uid(12);
  const token = uid(32);
  const images = await saveImages(body.images, id);

  const now = new Date().toISOString();
  const listing = {
    id,
    ...value,
    images,
    createdAt: now,
    updatedAt: now,
    views: 0,
    editTokenHash: sha256(token),
  };
  DB.listings.unshift(listing);
  await saveDB();
  return { status: 201, body: { listing: publicListing(listing), editToken: token } };
}

async function updateListing(id, body) {
  const l = DB.listings.find((x) => x.id === id);
  if (!l) return { status: 404, body: { error: 'Оголошення не знайдено.' } };
  if (!body.editToken || sha256(body.editToken) !== l.editTokenHash) {
    return { status: 403, body: { error: 'Немає прав на редагування цього оголошення.' } };
  }
  const { errors, value } = validateListing(body);
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };

  // Перерахунок зображень: лишаємо старі шляхи, додаємо нові data-URL.
  const keep = (body.images || []).filter((s) => typeof s === 'string' && s.startsWith('/uploads/'));
  const removed = (l.images || []).filter((p) => !keep.includes(p));
  const fresh = await saveImages(body.images, id);
  await removeImageFiles(removed);

  Object.assign(l, value, { images: fresh, updatedAt: new Date().toISOString() });
  await saveDB();
  return { status: 200, body: { listing: publicListing(l) } };
}

async function deleteListing(id, token) {
  const idx = DB.listings.findIndex((x) => x.id === id);
  if (idx === -1) return { status: 404, body: { error: 'Оголошення не знайдено.' } };
  const l = DB.listings[idx];
  if (!token || sha256(token) !== l.editTokenHash) {
    return { status: 403, body: { error: 'Немає прав на видалення.' } };
  }
  await removeImageFiles(l.images);
  DB.listings.splice(idx, 1);
  await saveDB();
  return { status: 200, body: { ok: true } };
}

function queryListings(params) {
  let items = DB.listings.slice();

  const q = (params.get('q') || '').trim().toLowerCase();
  const category = (params.get('category') || '').trim();
  const city = (params.get('city') || '').trim().toLowerCase();
  const min = params.get('min');
  const max = params.get('max');
  const free = params.get('free');
  const sort = params.get('sort') || 'new';

  if (q) {
    items = items.filter((l) =>
      (l.title + ' ' + l.description + ' ' + l.location).toLowerCase().includes(q));
  }
  if (category) items = items.filter((l) => l.category === category);
  if (city) items = items.filter((l) => (l.location || '').toLowerCase().includes(city));
  if (free === '1') items = items.filter((l) => l.isFree || l.price === 0);
  if (min) items = items.filter((l) => (l.price ?? Infinity) >= Number(min));
  if (max) items = items.filter((l) => (l.price ?? 0) <= Number(max));

  switch (sort) {
    case 'cheap': items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)); break;
    case 'expensive': items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1)); break;
    case 'popular': items.sort((a, b) => (b.views || 0) - (a.views || 0)); break;
    default: items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  }

  const page = Math.max(1, Number(params.get('page')) || 1);
  const perPage = Math.min(48, Math.max(1, Number(params.get('perPage')) || 24));
  const total = items.length;
  const pageItems = items.slice((page - 1) * perPage, page * perPage).map(publicListing);

  return { items: pageItems, total, page, perPage, pages: Math.ceil(total / perPage) || 1 };
}

/* ----------------------------------------------------------------------------
 * Статика
 * ------------------------------------------------------------------------- */

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Захист від виходу за межі public/
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
    // SPA-фолбек: будь-який невідомий шлях (без розширення) → index.html
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
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'listings', ':id?']
  const resource = parts[1];

  try {
    if (resource === 'health') {
      return send(res, 200, { ok: true, count: DB.listings.length, time: new Date().toISOString() });
    }

    if (resource === 'meta') {
      return send(res, 200, { count: DB.listings.length });
    }

    if (resource === 'listings') {
      const id = parts[2];

      if (req.method === 'GET' && !id) {
        return send(res, 200, queryListings(url.searchParams));
      }

      if (req.method === 'GET' && id) {
        const l = DB.listings.find((x) => x.id === id);
        if (!l) return send(res, 404, { error: 'Оголошення не знайдено.' });
        l.views = (l.views || 0) + 1;
        saveDB();
        return send(res, 200, { listing: publicListing(l) });
      }

      if (req.method === 'POST' && !id) {
        const body = await readBody(req);
        const r = await createListing(body);
        return send(res, r.status, r.body);
      }

      if ((req.method === 'PUT' || req.method === 'PATCH') && id) {
        const body = await readBody(req);
        const r = await updateListing(id, body);
        return send(res, r.status, r.body);
      }

      if (req.method === 'DELETE' && id) {
        const token = url.searchParams.get('token') || (await readBody(req).catch(() => ({}))).editToken;
        const r = await deleteListing(id, token);
        return send(res, r.status, r.body);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS (зручно для розробки / окремого фронтенду)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url);
  }
  return serveStatic(req, res, url.pathname);
});

loadDB().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`\n  ОголошенняUK ▸ http://localhost:${PORT}`);
    console.log(`  Оголошень у базі: ${DB.listings.length}\n`);
  });
});
