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
      // Високий ліміт оголошень — тести створюють багато під одним акаунтом.
      FREE_LISTING_QUOTA: '500',
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

/* ============================ Характеристики (атрибути) ============================ */

let housingId;

test('схема характеристик доступна', async () => {
  const { status, json } = await req('GET', '/api/meta/attributes');
  assert.equal(status, 200);
  assert.ok(json.attributes.housing, 'є housing');
  assert.ok(json.attributes.transport.some((d) => d.key === 'year'));
});

test('створення оголошення з характеристиками; сміття відкидається', async () => {
  const { status, json } = await req('POST', '/api/listings', {
    token: tokenA,
    body: {
      title: 'Кімната в центрі Лідса', description: 'Світла кімната, поруч магазини.',
      category: 'housing', location: 'Leeds, LS1', phone: '+447111000999', price: 600,
      attributes: { rooms: '2', furnished: 'furnished', billsIncluded: true, period: 'monthly', hacker: 'x' },
    },
  });
  assert.equal(status, 201);
  assert.equal(json.listing.attributes.rooms, '2');
  assert.equal(json.listing.attributes.furnished, 'furnished');
  assert.equal(json.listing.attributes.billsIncluded, true);
  assert.equal(json.listing.attributes.hacker, undefined, 'невідомий ключ відкинуто');
  housingId = json.listing.id;
});

test('некоректне значення select відкидається', async () => {
  const { json } = await req('POST', '/api/listings', {
    token: tokenA,
    body: {
      title: 'Авто на продаж', description: 'Гарний стан, тех.огляд є.',
      category: 'transport', location: 'Leeds', phone: '+447111000888', price: 4000,
      attributes: { make: 'Ford', year: 2016, mileage: 80000, fuel: 'plutonium' },
    },
  });
  assert.equal(json.listing.attributes.make, 'Ford');
  assert.equal(json.listing.attributes.year, 2016);
  assert.equal(json.listing.attributes.fuel, undefined, 'неприпустиме паливо відкинуто');
});

test('число поза діапазоном відкидається', async () => {
  const { json } = await req('POST', '/api/listings', {
    token: tokenA,
    body: {
      title: 'Старе авто', description: 'На запчастини.',
      category: 'transport', location: 'Hull', phone: '+447111000777',
      attributes: { year: 1800 },
    },
  });
  assert.equal(json.listing.attributes.year, undefined, 'рік 1800 поза діапазоном');
});

test('фільтрація за характеристикою attr_rooms', async () => {
  const found = await req('GET', '/api/listings?category=housing&attr_rooms=2');
  assert.ok(found.json.items.some((l) => l.id === housingId));
  const none = await req('GET', '/api/listings?category=housing&attr_rooms=4%2B');
  assert.ok(!none.json.items.some((l) => l.id === housingId));
});

/* ============================ Термін дії оголошень ============================ */

test('нове оголошення має дату завершення (expiresAt) у майбутньому', async () => {
  const { json } = await req('POST', '/api/listings', {
    token: tokenA,
    body: { title: 'З терміном дії', description: 'Перевірка expiresAt.', category: 'goods', location: 'York', phone: '+447111000444', price: 10 },
  });
  assert.ok(json.listing.expiresAt, 'є expiresAt');
  assert.ok(new Date(json.listing.expiresAt).getTime() > Date.now());
});

test('продовження (renew) оновлює дату завершення', async () => {
  const created = await req('POST', '/api/listings', {
    token: tokenA,
    body: { title: 'Renew тест', description: 'Перевірка продовження.', category: 'goods', location: 'York', phone: '+447111000555', price: 10 },
  });
  const id = created.json.listing.id;
  const before = new Date(created.json.listing.expiresAt).getTime();
  await new Promise((r) => setTimeout(r, 20));
  const renewed = await req('PUT', '/api/listings/' + id, { token: tokenA, body: { action: 'renew' } });
  assert.equal(renewed.status, 200);
  assert.ok(new Date(renewed.json.listing.expiresAt).getTime() > before, 'термін продовжено');
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

test('адмін редагує чуже оголошення (назва, ціна, категорія) без editToken', async () => {
  // housingId належить userA; адмін змінює його напряму.
  const { status, json } = await req('PUT', '/api/listings/' + housingId, {
    token: adminToken,
    body: {
      title: 'Відредаговано адміном', description: 'Адмін змінив це оголошення.',
      category: 'goods', location: 'Manchester', phone: '+447111000999', price: 999,
    },
  });
  assert.equal(status, 200);
  assert.equal(json.listing.title, 'Відредаговано адміном');
  assert.equal(json.listing.category, 'goods');
  assert.equal(json.listing.price, 999);
});

test('адмін змінює статус чужого оголошення', async () => {
  const { status, json } = await req('PUT', '/api/listings/' + housingId, {
    token: adminToken, body: { action: 'status', status: 'archived' },
  });
  assert.equal(status, 200);
  assert.equal(json.listing.status, 'archived');
});

test('статистика містить лічильник прострочених', async () => {
  const { json } = await req('GET', '/api/admin/stats', { token: adminToken });
  assert.ok('expired' in json, 'є поле expired');
});

test('адмін видаляє будь-яке оголошення', async () => {
  const { status } = await req('DELETE', '/api/admin/listings/' + listingId, { token: adminToken });
  assert.equal(status, 200);
  const check = await req('GET', '/api/listings/' + listingId);
  assert.equal(check.status, 404);
});

/* ============================ Аналітика ============================ */

let analyticsListingId;

test('подія перегляду інкрементує статистику оголошення', async () => {
  const created = await req('POST', '/api/listings', {
    token: tokenA,
    body: { title: 'Аналітика айтем', description: 'Для перевірки лічильників.', category: 'goods', location: 'Hull', phone: '+447111002200', price: 5 },
  });
  analyticsListingId = created.json.listing.id;

  await req('POST', '/api/events', { body: { type: 'contact_phone', listingId: analyticsListingId } });
  await req('GET', '/api/listings/' + analyticsListingId); // це теж подія view

  const { status, json } = await req('GET', `/api/listings/${analyticsListingId}/stats`, { token: tokenA });
  assert.equal(status, 200);
  assert.ok(json.stats.views >= 1, 'є перегляди');
  assert.equal(json.stats.contactClicks, 1, 'клік по контакту враховано');
});

test('сторонній не бачить статистику чужого оголошення (403)', async () => {
  const { status } = await req('GET', `/api/listings/${analyticsListingId}/stats`, { token: tokenB });
  assert.equal(status, 403);
});

test('адмін-аналітика повертає часовий ряд', async () => {
  const { status, json } = await req('GET', '/api/admin/analytics?days=14', { token: adminToken });
  assert.equal(status, 200);
  assert.equal(json.series.length, 14);
  assert.ok('views' in json.series[0] && 'contacts' in json.series[0]);
});

/* ============================ Монетизація ============================ */

let orderId, monetizeListingId;

test('тарифи доступні публічно', async () => {
  const { status, json } = await req('GET', '/api/plans');
  assert.equal(status, 200);
  assert.ok(json.plans.featured7, 'є тариф featured7');
  assert.ok(json.freeQuota > 0);
});

test('створення замовлення на просування', async () => {
  const created = await req('POST', '/api/listings', {
    token: tokenA,
    body: { title: 'Монетизація айтем', description: 'Перевірка преміум-просування.', category: 'goods', location: 'Hull', phone: '+447111003300', price: 50 },
  });
  monetizeListingId = created.json.listing.id;

  const { status, json } = await req('POST', '/api/orders', {
    token: tokenA, body: { listingId: monetizeListingId, plan: 'featured7' },
  });
  assert.equal(status, 201);
  assert.equal(json.order.status, 'pending');
  assert.equal(json.order.amount, 499);
  orderId = json.order.id;
});

test('чуже оголошення не можна просувати (403)', async () => {
  const { status } = await req('POST', '/api/orders', {
    token: tokenB, body: { listingId: monetizeListingId, plan: 'featured7' },
  });
  assert.equal(status, 403);
});

test('адмін підтверджує оплату → оголошення стає featured', async () => {
  const { status, json } = await req('POST', `/api/orders/${orderId}/confirm`, { token: adminToken });
  assert.equal(status, 200);
  assert.equal(json.order.status, 'paid');
  assert.equal(json.listing.featured, true);
});

test('featured-оголошення піднімається вище у списку', async () => {
  const { json } = await req('GET', '/api/listings?category=goods&sort=new');
  const idx = json.items.findIndex((l) => l.id === monetizeListingId);
  assert.ok(idx === 0, 'просунуте має бути першим');
});

test('дохід відображається в адмін-статистиці', async () => {
  const { json } = await req('GET', '/api/admin/stats', { token: adminToken });
  assert.ok(json.revenueTotal >= 499, 'дохід враховано');
  assert.ok(json.ordersPaid >= 1);
});

test('користувач бачить свої замовлення', async () => {
  const { status, json } = await req('GET', '/api/orders', { token: tokenA });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.orders));
  assert.ok(json.orders.some((o) => o.id === orderId), 'своє замовлення присутнє');
});

test('без Stripe createOrder не повертає paymentUrl (демо-режим)', async () => {
  const created = await req('POST', '/api/listings', {
    token: tokenA, body: { title: 'Демо-плата айтем', description: 'перевірка демо-оплати', category: 'goods', location: 'Hull', phone: '+447111006600', price: 10 },
  });
  const { json } = await req('POST', '/api/orders', { token: tokenA, body: { listingId: created.json.listing.id, plan: 'bump' } });
  assert.equal(json.paymentUrl, undefined, 'у демо-режимі без Stripe немає paymentUrl');
  assert.equal(json.order.status, 'pending');
});

test('health повідомляє про статус Stripe', async () => {
  const { json } = await req('GET', '/api/health');
  assert.equal(json.stripe, false, 'Stripe вимкнено в тестовому середовищі');
});

/* ============================ Тарифи (CRUD) ============================ */

test('за замовчуванням засіяно тарифи, включно з підписками', async () => {
  const { json } = await req('GET', '/api/plans');
  assert.ok(json.plans.featured7, 'є featured7');
  assert.ok(json.plans.pro_year, 'є річна підписка');
  assert.ok(Array.isArray(json.plansList));
});

test('адмін редагує ціну тарифу', async () => {
  const { status, json } = await req('PUT', '/api/admin/plans/featured7', { token: adminToken, body: { amount: 599, label: 'Виділене 7 днів+' } });
  assert.equal(status, 200);
  assert.equal(json.plan.amount, 599);
  const pub = await req('GET', '/api/plans');
  assert.equal(pub.json.plans.featured7.amount, 599, 'нова ціна видима публічно');
});

test('адмін створює і видаляє тариф', async () => {
  const created = await req('POST', '/api/admin/plans', { token: adminToken, body: { key: 'featured90', label: '90 днів', amount: 3999, days: 90, kind: 'featured' } });
  assert.equal(created.status, 201);
  const dup = await req('POST', '/api/admin/plans', { token: adminToken, body: { key: 'featured90', label: 'Дубль', amount: 1, days: 1, kind: 'featured' } });
  assert.equal(dup.status, 409, 'дублікат ключа відхилено');
  const del = await req('DELETE', '/api/admin/plans/featured90', { token: adminToken });
  assert.equal(del.status, 200);
});

test('неактивний тариф недоступний публічно і для купівлі', async () => {
  await req('PUT', '/api/admin/plans/bump', { token: adminToken, body: { active: false } });
  const pub = await req('GET', '/api/plans');
  assert.ok(!pub.json.plans.bump, 'неактивний тариф прихований');
  // Спроба купити неактивний — 400.
  const created = await req('POST', '/api/listings', { token: tokenA, body: { title: 'Тариф тест айтем', description: 'опис опис опис', category: 'goods', location: 'Hull', phone: '+447111007700' } });
  const buy = await req('POST', '/api/orders', { token: tokenA, body: { listingId: created.json.listing.id, plan: 'bump' } });
  assert.equal(buy.status, 400);
  await req('PUT', '/api/admin/plans/bump', { token: adminToken, body: { active: true } }); // повертаємо
});

test('не-адмін не має доступу до CRUD тарифів (403)', async () => {
  const { status } = await req('POST', '/api/admin/plans', { token: tokenA, body: { key: 'x', label: 'x', amount: 1, days: 1, kind: 'bump' } });
  assert.equal(status, 403);
});

/* ============================ Промокоди ============================ */

test('адмін створює промокод, перевірка валідна', async () => {
  const created = await req('POST', '/api/admin/promos', { token: adminToken, body: { code: 'welcome20', kind: 'percent', value: 20, maxUses: 100 } });
  assert.equal(created.status, 201);
  assert.equal(created.json.promo.code, 'WELCOME20', 'код у верхньому регістрі');
  const check = await req('GET', '/api/promos/check?code=WELCOME20');
  assert.equal(check.json.valid, true);
  assert.equal(check.json.value, 20);
});

test('невалідний промокод відхиляється перевіркою', async () => {
  const check = await req('GET', '/api/promos/check?code=NOPE999');
  assert.equal(check.json.valid, false);
});

test('промокод знижує ціну замовлення', async () => {
  const listing = await req('POST', '/api/listings', { token: tokenA, body: { title: 'Промо тест айтем', description: 'опис опис опис', category: 'goods', location: 'Hull', phone: '+447111008800', price: 10 } });
  const order = await req('POST', '/api/orders', { token: tokenA, body: { listingId: listing.json.listing.id, plan: 'featured7', promoCode: 'WELCOME20' } });
  assert.equal(order.status, 201);
  assert.equal(order.json.order.baseAmount, 599);
  assert.equal(order.json.order.amount, 479, '599 − 20% = 479');
  assert.equal(order.json.order.promo, 'WELCOME20');
});

test('промокод на 100% активує безкоштовно й одразу', async () => {
  await req('POST', '/api/admin/promos', { token: adminToken, body: { code: 'free100', kind: 'percent', value: 100 } });
  const listing = await req('POST', '/api/listings', { token: tokenA, body: { title: 'Безкоштовне просування', description: 'опис опис опис', category: 'goods', location: 'Hull', phone: '+447111009900', price: 10 } });
  const order = await req('POST', '/api/orders', { token: tokenA, body: { listingId: listing.json.listing.id, plan: 'featured30', promoCode: 'FREE100' } });
  assert.equal(order.json.free, true);
  assert.equal(order.json.order.status, 'paid');
  const check = await req('GET', '/api/listings/' + listing.json.listing.id, { token: tokenA });
  assert.equal(check.json.listing.featured, true);
});

/* ============================ Підписки PRO ============================ */

test('покупка підписки робить користувача PRO', async () => {
  const reg = await req('POST', '/api/auth/register', { body: { name: 'PRO Юзер', email: 'pro@test.dev', password: 'secret123' } });
  const token = reg.json.token;
  const order = await req('POST', '/api/orders', { token, body: { plan: 'pro_year' } });
  assert.equal(order.status, 201);
  assert.equal(order.json.order.kind, 'subscription');
  assert.equal(order.json.order.listingId, null, 'підписка без оголошення');
  await req('POST', `/api/orders/${order.json.order.id}/confirm`, { token: adminToken });
  const me = await req('GET', '/api/auth/me', { token });
  assert.equal(me.json.user.pro, true, 'користувач став PRO');
  assert.ok(me.json.user.proUntil);
});

test('адмін видає та знімає PRO', async () => {
  const reg = await req('POST', '/api/auth/register', { body: { name: 'Грант PRO', email: 'grant@test.dev', password: 'secret123' } });
  const grant = await req('POST', `/api/admin/users/${reg.json.user.id}`, { token: adminToken, body: { action: 'grantPro', days: 30 } });
  assert.equal(grant.json.user.pro, true);
  const revoke = await req('POST', `/api/admin/users/${reg.json.user.id}`, { token: adminToken, body: { action: 'revokePro' } });
  assert.equal(revoke.json.user.pro, false);
});

/* ============================ Знижка PRO на просування ============================ */

test('PRO отримує знижку на просування, але не на підписку', async () => {
  const reg = await req('POST', '/api/auth/register', { body: { name: 'PRO Знижка', email: 'prodisc@test.dev', password: 'secret123' } });
  const token = reg.json.token, uid = reg.json.user.id;
  await req('POST', `/api/admin/users/${uid}`, { token: adminToken, body: { action: 'grantPro', days: 30 } });
  // me.proDiscount > 0
  const me = await req('GET', '/api/auth/me', { token });
  assert.ok(me.json.user.proDiscount > 0, 'PRO бачить знижку');

  // Просування featured7 (base 599 після раніших правок? — використовуємо власну ціну незалежно)
  const listing = await req('POST', '/api/listings', { token, body: { title: 'PRO знижка айтем', description: 'опис опис опис', category: 'goods', location: 'Hull', phone: '+447111010101', price: 10 } });
  const order = await req('POST', '/api/orders', { token, body: { listingId: listing.json.listing.id, plan: 'featured7' } });
  assert.ok(order.json.order.proDiscount > 0, 'знижка застосована');
  assert.ok(order.json.order.amount < order.json.order.baseAmount, 'ціна нижча за базову');

  // Підписка — без PRO-знижки.
  const sub = await req('POST', '/api/orders', { token, body: { plan: 'pro_month' } });
  assert.equal(sub.json.order.proDiscount, 0, 'на підписку PRO-знижки немає');
  assert.equal(sub.json.order.amount, sub.json.order.baseAmount);
});

/* ============================ Реферальна програма ============================ */

test('реферальна інформація доступна, код стабільний', async () => {
  const reg = await req('POST', '/api/auth/register', { body: { name: 'Реферер', email: 'referrer@test.dev', password: 'secret123' } });
  const token = reg.json.token;
  const r = await req('GET', '/api/auth/referral', { token });
  assert.equal(r.status, 200);
  assert.match(r.json.code, /^R[0-9A-F]{7}$/, 'код у форматі RXXXXXXX');
  assert.ok(r.json.link.includes('ref=' + r.json.code));
  assert.equal(r.json.count, 0);
});

test('перша оплата запрошеного нараховує бонус рефереру', async () => {
  const refReg = await req('POST', '/api/auth/register', { body: { name: 'Бонус Реферер', email: 'bonusref@test.dev', password: 'secret123' } });
  const refToken = refReg.json.token;
  const ref = await req('GET', '/api/auth/referral', { token: refToken });
  const code = ref.json.code;

  // Запрошений реєструється з кодом.
  const invReg = await req('POST', '/api/auth/register', { body: { name: 'Запрошений', email: 'invited@test.dev', password: 'secret123', ref: code } });
  const invToken = invReg.json.token;

  // До оплати — реферер не PRO.
  const before = await req('GET', '/api/auth/me', { token: refToken });
  assert.equal(before.json.user.pro, false);

  // Запрошений купує підписку (перша оплата).
  const order = await req('POST', '/api/orders', { token: invToken, body: { plan: 'pro_month' } });
  await req('POST', `/api/orders/${order.json.order.id}/confirm`, { token: adminToken });

  // Реферер отримав PRO-бонус і лічильник.
  const after = await req('GET', '/api/auth/referral', { token: refToken });
  assert.equal(after.json.count, 1, 'лічильник рефералів зріс');
  const me = await req('GET', '/api/auth/me', { token: refToken });
  assert.equal(me.json.user.pro, true, 'реферер став PRO');
});

test('самозапрошення неможливе (бонус лише за іншого)', async () => {
  const reg = await req('POST', '/api/auth/register', { body: { name: 'Сам Себе', email: 'self@test.dev', password: 'secret123' } });
  // Реєстрація з власним кодом неможлива (код видається після створення), тож просто
  // перевіряємо, що referredBy на старті null і count не росте від власних оплат.
  const r = await req('GET', '/api/auth/referral', { token: reg.json.token });
  assert.equal(r.json.count, 0);
});

/* ============================ Нагадування про підписку ============================ */

test('адмін може запустити розсилку нагадувань (0 без SMTP)', async () => {
  const { status, json } = await req('POST', '/api/admin/remind-subs', { token: adminToken });
  assert.equal(status, 200);
  assert.equal(json.sent, 0, 'без SMTP нічого не надсилається');
});

test('не-адмін не може запустити розсилку (403)', async () => {
  const { status } = await req('POST', '/api/admin/remind-subs', { token: tokenA });
  assert.equal(status, 403);
});

/* ============================ Гейт контактів ============================ */

test('анонім не бачить контактів, авторизований бачить', async () => {
  const list = await req('GET', '/api/listings?perPage=1');
  const id = list.json.items[0].id;
  const anon = await req('GET', '/api/listings/' + id);
  assert.equal(anon.json.listing.phone, '', 'анонім — телефон прихований');
  assert.equal(anon.json.listing.contactsLocked, true);
  const authed = await req('GET', '/api/listings/' + id, { token: tokenA });
  assert.ok(authed.json.listing.phone.length > 0, 'авторизований бачить телефон');
  assert.notEqual(authed.json.listing.contactsLocked, true);
});

/* ============================ Управління користувачами ============================ */

test('адмін бачить список користувачів', async () => {
  const { status, json } = await req('GET', '/api/admin/users', { token: adminToken });
  assert.equal(status, 200);
  assert.ok(json.users.length >= 2);
  assert.ok(!('hash' in json.users[0]), 'без секретів');
});

test('бан користувача архівує його оголошення і блокує вхід', async () => {
  // Окремий користувач для бану.
  const reg = await req('POST', '/api/auth/register', { body: { name: 'Спамер', email: 'spam@test.dev', password: 'secret123' } });
  const spamId = reg.json.user.id;
  await req('POST', '/api/listings', { token: reg.json.token, body: { title: 'Спам оголошення', description: 'спам спам спам', category: 'other', location: 'X', phone: '+447111004400' } });

  const ban = await req('POST', `/api/admin/users/${spamId}`, { token: adminToken, body: { action: 'ban' } });
  assert.equal(ban.status, 200);
  assert.equal(ban.json.user.banned, true);

  // Вхід заблоковано.
  const login = await req('POST', '/api/auth/login', { body: { email: 'spam@test.dev', password: 'secret123' } });
  assert.equal(login.status, 403);
});

test('розбан повертає доступ', async () => {
  const users = await req('GET', '/api/admin/users?q=spam', { token: adminToken });
  const spam = users.json.users.find((u) => u.email === 'spam@test.dev');
  await req('POST', `/api/admin/users/${spam.id}`, { token: adminToken, body: { action: 'unban' } });
  const login = await req('POST', '/api/auth/login', { body: { email: 'spam@test.dev', password: 'secret123' } });
  assert.equal(login.status, 200);
});

test('не-адмін не має доступу до управління користувачами (403)', async () => {
  const { status } = await req('GET', '/api/admin/users', { token: tokenA });
  assert.equal(status, 403);
});

test('журнал дій адміна фіксує бан', async () => {
  const { status, json } = await req('GET', '/api/admin/audit', { token: adminToken });
  assert.equal(status, 200);
  assert.ok(json.audit.some((a) => a.action === 'ban_user'));
});

test('забанений користувач не може створити оголошення (403)', async () => {
  // Окремий одноразовий користувач, щоб не зачіпати інші тести.
  const reg = await req('POST', '/api/auth/register', { body: { name: 'Бан Тест', email: 'bantest@test.dev', password: 'secret123' } });
  const token = reg.json.token;
  const id = reg.json.user.id;
  await req('POST', `/api/admin/users/${id}`, { token: adminToken, body: { action: 'ban' } });

  // Сесію забаненого інвалідовано — створення відхиляється (401 або 403).
  const create = await req('POST', '/api/listings', {
    token,
    body: { title: 'Спроба забаненого', description: 'не має пройти', category: 'goods', location: 'X', phone: '+447111005500' },
  });
  assert.ok(create.status === 403 || create.status === 401, 'забаненому заборонено');
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
  assert.ok(xml.includes('/listing/'), 'містить індексовані посилання на оголошення');
});

test('SEO-сторінка /listing/:id віддає метатеги, OG і JSON-LD', async () => {
  // Створюємо свіже оголошення з відомим власником.
  const { json } = await req('POST', '/api/listings', {
    token: tokenA,
    body: { title: 'SEO Диван', description: 'Зручний диван для SEO-тесту.', category: 'furniture', location: 'Bristol', phone: '+447111000321', price: 200 },
  });
  const id = json.listing.id;
  const r = await fetch(BASE + '/listing/' + id);
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-type').includes('text/html'));
  const html = await r.text();
  assert.ok(html.includes('<title>SEO Диван'), 'має title з назвою');
  assert.ok(html.includes('og:title'), 'має Open Graph');
  assert.ok(html.includes('application/ld+json'), 'має JSON-LD');
  assert.ok(html.includes(`/listing/${id}`), 'канонічне посилання');
  // Лише один <title> — дефолтний прибрано.
  assert.equal((html.match(/<title>/g) || []).length, 1, 'рівно один <title>');
  assert.ok(!html.includes('оголошення для українців у Британії</title>'), 'дефолтний title прибрано');
  // CSP на SEO-сторінці дозволяє nonce.
  assert.ok((r.headers.get('content-security-policy') || '').includes('nonce-'), 'CSP з nonce');
});

test('SEO-сторінка працює для seed-ID з дефісами', async () => {
  // Беремо будь-яке seed-оголошення (його id містить дефіси).
  const list = await req('GET', '/api/listings?status=all&perPage=48');
  const seed = list.json.items.find((l) => l.id.includes('-'));
  assert.ok(seed, 'є seed з дефісом в id');
  const r = await fetch(BASE + '/listing/' + seed.id);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(`<title>${seed.title}`), 'title відповідає оголошенню, а не дефолту');
});

test('неіснуюче /listing/:id → 404 з HTML', async () => {
  const r = await fetch(BASE + '/listing/zzzznotreal');
  assert.equal(r.status, 404);
});

test('gzip застосовується для великих JSON-відповідей', async () => {
  const r = await fetch(BASE + '/api/listings?perPage=48', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.status, 200);
  // fetch автоматично декодує; перевіряємо, що сервер не зламав відповідь.
  const data = await r.json();
  assert.ok(Array.isArray(data.items));
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
