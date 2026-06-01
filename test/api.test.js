/**
 * Інтеграційні тести API ОголошенняUK.
 *
 * Запускають сервер як окремий процес із тимчасовою директорією даних,
 * б'ють реальні HTTP-запити і перевіряють поведінку.
 *
 *   node --test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Каталог тестів і корінь репозиторію (на рівень вище).
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, '..');
const PORT = 3900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let tmpData;

before(async () => {
  // Тимчасова копія робочого каталогу даних, щоб не чіпати реальну базу.
  tmpData = await fs.mkdtemp(path.join(os.tmpdir(), 'ouk-test-'));
  // Сервер читає data/ відносно свого розташування, тож працюємо з копією репо
  // через змінні оточення нам недоступно — натомість використовуємо чистий старт:
  // видаляємо runtime-базу перед запуском (seed підхопиться автоматично).
  await fs.rm(path.join(ROOT, 'data', 'db.runtime.json'), { force: true });

  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
      ADMIN_EMAILS: 'admin@test.dev', EXPOSE_RESET_TOKEN: '1',
      // Вимикаємо rate-limit, щоб численні тестові логіни не впиралися в ліміт.
      DISABLE_RATE_LIMIT: '1',
    },
    stdio: 'ignore',
  });

  // Чекаємо, поки сервер підніметься.
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* ще не готовий */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустився вчасно');
});

after(async () => {
  if (child) child.kill('SIGKILL');
  await fs.rm(path.join(ROOT, 'data', 'db.runtime.json'), { force: true });
  if (tmpData) await fs.rm(tmpData, { recursive: true, force: true });
});

// Хелпер для запитів.
async function req(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + urlPath, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* без тіла */ }
  return { status: res.status, json };
}

// 1px PNG як data-URL.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ============================ Здоров'я / seed ============================ */

test('health повертає ok і seed-оголошення', async () => {
  const { status, json } = await req('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.listings >= 12, 'мають бути seed-оголошення');
});

test('список оголошень повертає сторінку', async () => {
  const { status, json } = await req('GET', '/api/listings?perPage=5');
  assert.equal(status, 200);
  assert.equal(json.items.length, 5);
  assert.ok(json.total >= 12);
  assert.ok(json.pages >= 3);
});

/* ============================ Авторизація ============================ */

let tokenA, userA, tokenB;

test('реєстрація створює акаунт і повертає токен', async () => {
  const { status, json } = await req('POST', '/api/auth/register', {
    body: { name: 'Олена', email: 'olena@test.dev', password: 'secret123', city: 'London' },
  });
  assert.equal(status, 201);
  assert.ok(json.token);
  assert.equal(json.user.name, 'Олена');
  assert.equal(json.user.isAdmin, false);
  tokenA = json.token; userA = json.user.id;
});

test('реєстрація з коротким паролем відхиляється', async () => {
  const { status } = await req('POST', '/api/auth/register', {
    body: { name: 'Боб', email: 'bob@test.dev', password: '123' },
  });
  assert.equal(status, 400);
});

test('дублікат email відхиляється (409)', async () => {
  const { status } = await req('POST', '/api/auth/register', {
    body: { name: 'Інша', email: 'olena@test.dev', password: 'secret123' },
  });
  assert.equal(status, 409);
});

test('логін з невірним паролем — 401', async () => {
  const { status } = await req('POST', '/api/auth/login', {
    body: { email: 'olena@test.dev', password: 'wrong' },
  });
  assert.equal(status, 401);
});

test('/auth/me без токена повертає null', async () => {
  const { status, json } = await req('GET', '/api/auth/me');
  assert.equal(status, 200);
  assert.equal(json.user, null);
});

test('реєстрація другого користувача', async () => {
  const { status, json } = await req('POST', '/api/auth/register', {
    body: { name: 'Іван', email: 'ivan@test.dev', password: 'secret123' },
  });
  assert.equal(status, 201);
  tokenB = json.token;
});

/* ============================ Оголошення ============================ */

let listingId, guestId, guestToken;

test('створення оголошення авторизованим користувачем', async () => {
  const { status, json } = await req('POST', '/api/listings', {
    token: tokenA,
    body: {
      title: 'Велотренажер майже новий',
      description: 'Користувались пару разів, відмінний стан.',
      category: 'goods', location: 'London, E14',
      phone: '+447111222333', price: 120, images: [PNG],
    },
  });
  assert.equal(status, 201);
  assert.equal(json.listing.owner.name, 'Олена');
  assert.equal(json.listing.status, 'active');
  assert.equal(json.listing.images.length, 1);
  assert.ok(json.listing.images[0].startsWith('/uploads/'));
  listingId = json.listing.id;
});

test('перегляд оголошення збільшує лічильник переглядів', async () => {
  const { json } = await req('GET', '/api/listings/' + listingId);
  assert.ok(json.listing.views >= 1);
  assert.equal(json.listing.editTokenHash, undefined, 'токен не має витікати');
});

test('валідація: порожнє оголошення відхиляється', async () => {
  const { status } = await req('POST', '/api/listings', { token: tokenA, body: { title: 'ab' } });
  assert.equal(status, 400);
});

test('гостьове оголошення повертає editToken', async () => {
  const { status, json } = await req('POST', '/api/listings', {
    body: {
      title: 'Дитячий велосипед', description: 'Для дитини 5-7 років.',
      category: 'kids', location: 'Leeds', phone: '+447000000001',
    },
  });
  assert.equal(status, 201);
  assert.ok(json.editToken, 'гість отримує editToken');
  assert.equal(json.listing.owner, null);
  guestId = json.listing.id; guestToken = json.editToken;
});

test('гість редагує своє оголошення за токеном', async () => {
  const { status, json } = await req('PUT', '/api/listings/' + guestId, {
    body: {
      title: 'Дитячий велосипед (оновлено)', description: 'Оновлений опис тут.',
      category: 'kids', location: 'Leeds', phone: '+447000000001', editToken: guestToken,
    },
  });
  assert.equal(status, 200);
  assert.equal(json.listing.title, 'Дитячий велосипед (оновлено)');
});

test('чужий токен не дає редагувати (403)', async () => {
  const { status } = await req('PUT', '/api/listings/' + guestId, {
    body: { title: 'Зламано', description: 'хакер', category: 'kids', location: 'X', phone: '+447000000001', editToken: 'WRONG' },
  });
  assert.equal(status, 403);
});

test('інший користувач не може редагувати чуже (403)', async () => {
  const { status } = await req('PUT', '/api/listings/' + listingId, {
    token: tokenB,
    body: { title: 'Зламано', description: 'хакер', category: 'goods', location: 'X', phone: '+447111222333' },
  });
  assert.equal(status, 403);
});

test('зміна статусу на "продано" власником', async () => {
  const { status, json } = await req('PUT', '/api/listings/' + listingId, {
    token: tokenA, body: { action: 'status', status: 'sold' },
  });
  assert.equal(status, 200);
  assert.equal(json.listing.status, 'sold');
});

test('продані ховаються з типового пошуку, але видно з status=all', async () => {
  const def = await req('GET', '/api/listings?category=goods');
  assert.ok(!def.json.items.some((l) => l.id === listingId), 'продане приховано');
  const all = await req('GET', '/api/listings?category=goods&status=all');
  assert.ok(all.json.items.some((l) => l.id === listingId), 'видно зі status=all');
});

test('фільтр owner повертає всі статуси власника', async () => {
  const { json } = await req('GET', `/api/listings?owner=${userA}&status=all`);
  assert.ok(json.items.some((l) => l.id === listingId));
});

/* ============================ Чат ============================ */

let threadId;

test('користувач B пише власнику A — створюється діалог', async () => {
  const { status, json } = await req('POST', '/api/messages', {
    token: tokenB, body: { listingId, text: 'Привіт! Ще актуально?' },
  });
  assert.equal(status, 201);
  assert.ok(json.message.threadId);
  threadId = json.message.threadId;
});

test('власник не може писати на власне оголошення (400)', async () => {
  const { status } = await req('POST', '/api/messages', {
    token: tokenA, body: { listingId, text: 'сам собі' },
  });
  assert.equal(status, 400);
});

test('A бачить 1 непрочитане', async () => {
  const { json } = await req('GET', '/api/messages/unread', { token: tokenA });
  assert.equal(json.unread, 1);
});

test('A читає діалог — непрочитані обнуляються', async () => {
  await req('GET', '/api/messages/' + threadId, { token: tokenA });
  const { json } = await req('GET', '/api/messages/unread', { token: tokenA });
  assert.equal(json.unread, 0);
});

test('A відповідає, B отримує непрочитане', async () => {
  const r = await req('POST', '/api/messages/' + threadId, { token: tokenA, body: { text: 'Так, актуально!' } });
  assert.equal(r.status, 201);
  const { json } = await req('GET', '/api/messages/unread', { token: tokenB });
  assert.equal(json.unread, 1);
});

test('сторонній не має доступу до чужого діалогу (404)', async () => {
  // Реєструємо третього і пробуємо відкрити thread.
  const { json } = await req('POST', '/api/auth/register', {
    body: { name: 'Третій', email: 'third@test.dev', password: 'secret123' },
  });
  const { status } = await req('GET', '/api/messages/' + threadId, { token: json.token });
  assert.equal(status, 404);
});

/* ============================ Скарги + Адмін ============================ */

let adminToken, reportId;

test('будь-хто може подати скаргу', async () => {
  const { status } = await req('POST', '/api/reports', {
    body: { listingId, reason: 'spam', text: 'підозріло' },
  });
  assert.equal(status, 201);
});

test('не-адмін не має доступу до /api/admin (403)', async () => {
  const { status } = await req('GET', '/api/admin/stats', { token: tokenA });
  assert.equal(status, 403);
});

test('адмін (за ADMIN_EMAILS) отримує доступ', async () => {
  const reg = await req('POST', '/api/auth/register', {
    body: { name: 'Адмін', email: 'admin@test.dev', password: 'secret123' },
  });
  assert.equal(reg.json.user.isAdmin, true);
  adminToken = reg.json.token;

  const stats = await req('GET', '/api/admin/stats', { token: adminToken });
  assert.equal(stats.status, 200);
  assert.ok(stats.json.reportsOpen >= 1);
  assert.ok(stats.json.users >= 4);
});

test('адмін бачить відкриті скарги', async () => {
  const { status, json } = await req('GET', '/api/admin/reports', { token: adminToken });
  assert.equal(status, 200);
  assert.ok(json.reports.length >= 1);
  assert.ok(json.reports[0].listing, 'скарга має прикріплене оголошення');
  reportId = json.reports[0].id;
});

test('адмін закриває скаргу', async () => {
  const { status } = await req('POST', '/api/admin/reports/' + reportId, { token: adminToken, body: { resolved: true } });
  assert.equal(status, 200);
  const open = await req('GET', '/api/admin/reports', { token: adminToken });
  assert.ok(!open.json.reports.some((r) => r.id === reportId), 'закрита скарга зникла з відкритих');
});

test('адмін видаляє будь-яке оголошення', async () => {
  const { status } = await req('DELETE', '/api/admin/listings/' + listingId, { token: adminToken });
  assert.equal(status, 200);
  const check = await req('GET', '/api/listings/' + listingId);
  assert.equal(check.status, 404);
});

/* ============================ Відгуки ============================ */

test('покупець залишає відгук про продавця', async () => {
  const { status, json } = await req('POST', `/api/users/${userA}/reviews`, {
    token: tokenB, body: { rating: 5, text: 'Чудовий продавець!' },
  });
  assert.equal(status, 201);
  assert.equal(json.rating.count, 1);
  assert.equal(json.rating.avg, 5);
  assert.equal(json.review.author.name, 'Іван');
});

test('не можна оцінити власний профіль (400)', async () => {
  const { status } = await req('POST', `/api/users/${userA}/reviews`, { token: tokenA, body: { rating: 5 } });
  assert.equal(status, 400);
});

test('некоректна оцінка відхиляється (400)', async () => {
  const { status } = await req('POST', `/api/users/${userA}/reviews`, { token: tokenB, body: { rating: 9 } });
  assert.equal(status, 400);
});

test('анонімний відгук відхиляється (401)', async () => {
  const { status } = await req('POST', `/api/users/${userA}/reviews`, { body: { rating: 3 } });
  assert.equal(status, 401);
});

test('повторний відгук оновлює, а не дублює', async () => {
  await req('POST', `/api/users/${userA}/reviews`, { token: tokenB, body: { rating: 4, text: 'Оновлено' } });
  const { json } = await req('GET', `/api/users/${userA}/reviews`);
  assert.equal(json.rating.count, 1);
  assert.equal(json.rating.avg, 4);
});

test('профіль містить агрегований рейтинг', async () => {
  const { json } = await req('GET', '/api/users/' + userA);
  assert.equal(json.user.rating.count, 1);
  assert.equal(json.user.rating.avg, 4);
});

/* ============================ Скидання пароля ============================ */

test('forgot для невідомого email — узагальнена 200 без токена', async () => {
  const { status, json } = await req('POST', '/api/auth/forgot', { body: { email: 'nobody@test.dev' } });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.resetToken, undefined);
});

test('повний цикл скидання пароля', async () => {
  // Окремий користувач, щоб не чіпати інші сесії.
  await req('POST', '/api/auth/register', { body: { name: 'Реset', email: 'reset@test.dev', password: 'oldpass123' } });

  const forgot = await req('POST', '/api/auth/forgot', { body: { email: 'reset@test.dev' } });
  assert.ok(forgot.json.resetToken, 'демо-режим повертає resetToken');
  const rtoken = forgot.json.resetToken;

  // Поганий токен / короткий пароль.
  assert.equal((await req('POST', '/api/auth/reset', { body: { token: 'BAD', password: 'newpass123' } })).status, 400);
  assert.equal((await req('POST', '/api/auth/reset', { body: { token: rtoken, password: '12' } })).status, 400);

  // Успішне скидання → нова сесія.
  const reset = await req('POST', '/api/auth/reset', { body: { token: rtoken, password: 'newpass123' } });
  assert.equal(reset.status, 200);
  assert.ok(reset.json.token);

  // Старий пароль не працює, новий — працює.
  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'reset@test.dev', password: 'oldpass123' } })).status, 401);
  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'reset@test.dev', password: 'newpass123' } })).status, 200);

  // Токен одноразовий.
  assert.equal((await req('POST', '/api/auth/reset', { body: { token: rtoken, password: 'another123' } })).status, 400);
});

/* ============================ Профіль ============================ */

test('публічний профіль не розкриває email', async () => {
  const { status, json } = await req('GET', '/api/users/' + userA);
  assert.equal(status, 200);
  assert.equal(json.user.email, undefined);
  assert.equal(json.user.name, 'Олена');
});

test('оновлення профілю', async () => {
  const { status, json } = await req('PUT', '/api/auth/me', { token: tokenA, body: { city: 'Bristol' } });
  assert.equal(status, 200);
  assert.equal(json.user.city, 'Bristol');
});

test('logout інвалідовує сесію', async () => {
  await req('POST', '/api/auth/logout', { token: tokenB });
  const { json } = await req('GET', '/api/auth/me', { token: tokenB });
  assert.equal(json.user, null);
});

/* ============================ Статика ============================ */

test('статика віддається з правильними типами', async () => {
  for (const [p, type] of [['/', 'text/html'], ['/css/styles.css', 'text/css'], ['/js/app.js', 'javascript'], ['/manifest.webmanifest', 'manifest']]) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
    assert.ok(r.headers.get('content-type').includes(type), `${p} → ${type}`);
  }
});

test('path traversal заблоковано', async () => {
  const r = await fetch(BASE + '/../server.js');
  assert.ok(r.status === 403 || r.status === 404);
});

/* ============================ Безпека / SEO / бекап ============================ */

test('заголовки безпеки присутні', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(r.headers.get('content-security-policy').includes("default-src 'self'"));
});

test('robots.txt містить посилання на sitemap', async () => {
  const r = await fetch(BASE + '/robots.txt');
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(text.includes('Sitemap:'));
  assert.ok(text.includes('/sitemap.xml'));
});

test('sitemap.xml — валідний XML з оголошеннями', async () => {
  const r = await fetch(BASE + '/sitemap.xml');
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-type').includes('xml'));
  const xml = await r.text();
  assert.ok(xml.startsWith('<?xml'));
  assert.ok(xml.includes('<urlset'));
  assert.ok(xml.includes('/#/l/'), 'містить посилання на оголошення');
});

test('бекап доступний лише адміну і не містить секретів', async () => {
  const denied = await req('GET', '/api/admin/backup', { token: tokenA });
  assert.equal(denied.status, 403);

  const ok = await req('GET', '/api/admin/backup', { token: adminToken });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.json.listings));
  assert.ok(Array.isArray(ok.json.users));
  // Жодних паролів/солей/токенів.
  const dump = JSON.stringify(ok.json);
  assert.ok(!dump.includes('"salt"'), 'без солі');
  assert.ok(!dump.includes('"hash"'), 'без хешу пароля');
  assert.ok(!dump.includes('editTokenHash'), 'без токенів редагування');
});

test('rate-limit повертає 429 при перевищенні (ізольований сервер)', async () => {
  // Піднімаємо окремий екземпляр БЕЗ DISABLE_RATE_LIMIT.
  const p2 = 4600 + Math.floor(Math.random() * 300);
  const c2 = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(p2), HOST: '127.0.0.1', DISABLE_RATE_LIMIT: '0' },
    stdio: 'ignore',
  });
  try {
    const base2 = `http://127.0.0.1:${p2}`;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base2 + '/api/health')).ok) break; } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    // Ліміт логіну — 10 за 5 хв. 12 спроб → останні мають дати 429.
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(base2 + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x@x.dev', password: 'nope' }),
      });
      if (r.status === 429) { got429 = true; break; }
    }
    assert.ok(got429, 'після кількох спроб має спрацювати 429');
  } finally {
    c2.kill('SIGKILL');
  }
});
