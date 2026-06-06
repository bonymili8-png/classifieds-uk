/**
 * Тести інтеграції Stripe (без мережі): перевірка підпису вебхука.
 * Підписуємо payload тим самим секретом і переконуємось, що verifyWebhook
 * приймає валідний підпис і відхиляє підроблений/застарілий.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = pathToFileURL(path.join(ROOT, 'stripe.js')).href;
const SECRET = 'whsec_testsecret123';

let stripe;

function sign(body, ts, secret = SECRET) {
  const payload = `${ts}.${body}`;
  const v1 = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${ts},v1=${v1}`;
}

before(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  stripe = await import(MOD + '?webhook');
});

test('verifyWebhook приймає валідний підпис', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { metadata: { orderId: 'o1' } } } });
  const ts = Math.floor(Date.now() / 1000);
  const event = stripe.verifyWebhook(Buffer.from(body), sign(body, ts));
  assert.equal(event.type, 'checkout.session.completed');
  assert.equal(event.data.object.metadata.orderId, 'o1');
});

test('verifyWebhook відхиляє підроблений підпис', () => {
  const body = JSON.stringify({ type: 'x' });
  const ts = Math.floor(Date.now() / 1000);
  const bad = sign(body, ts, 'whsec_wrong');
  assert.throws(() => stripe.verifyWebhook(Buffer.from(body), bad), /не збігається|Підпис/);
});

test('verifyWebhook відхиляє застарілу позначку часу', () => {
  const body = JSON.stringify({ type: 'x' });
  const oldTs = Math.floor(Date.now() / 1000) - 10000;
  assert.throws(() => stripe.verifyWebhook(Buffer.from(body), sign(body, oldTs)), /застарів/);
});

test('verifyWebhook відхиляє відсутній підпис', () => {
  assert.throws(() => stripe.verifyWebhook(Buffer.from('{}'), ''), /Немає підпису/);
});

test('stripeEnabled false без ключа', () => {
  // STRIPE_SECRET_KEY не задано в тестовому середовищі.
  assert.equal(stripe.stripeEnabled, false);
});
