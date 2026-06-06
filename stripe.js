/**
 * Інтеграція зі Stripe без SDK (на вбудованих модулях Node.js).
 *
 * Використовує глобальний fetch (Node 18+) для REST API Stripe та crypto
 * для перевірки підпису вебхуків. Нічого не треба встановлювати.
 *
 * Налаштування через оточення:
 *   STRIPE_SECRET_KEY      — sk_live_... або sk_test_...
 *   STRIPE_WEBHOOK_SECRET  — whsec_... (для перевірки підпису вебхука)
 *   SITE_URL               — публічна адреса для success/cancel URL
 *
 * Якщо STRIPE_SECRET_KEY не заданий — інтеграція вимкнена, застосунок
 * працює в "ручному/демо" режимі підтвердження оплат.
 */

import crypto from 'node:crypto';

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SITE = (process.env.SITE_URL || '').replace(/\/+$/, '') || 'http://localhost:3000';

export const stripeEnabled = !!SECRET;

// Кодує плаский об'єкт у application/x-www-form-urlencoded зі вкладеними ключами
// у стилі Stripe: line_items[0][price_data][unit_amount]=499
function encodeForm(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) encodeForm(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object') encodeForm(item, `${key}[${i}]`, out);
      else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
    });
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

/**
 * Створює Stripe Checkout Session для замовлення.
 * Повертає { id, url } або кидає помилку.
 */
export async function createCheckoutSession({ order, plan, customerEmail }) {
  if (!stripeEnabled) throw new Error('Stripe не налаштовано.');

  const params = {
    mode: 'payment',
    success_url: `${SITE}/#/orders?status=success&order=${order.id}`,
    cancel_url: `${SITE}/#/orders?status=cancel&order=${order.id}`,
    client_reference_id: order.id,
    'metadata[orderId]': order.id,
    'metadata[listingId]': order.listingId,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': (order.currency || 'gbp').toLowerCase(),
    'line_items[0][price_data][unit_amount]': order.amount,
    'line_items[0][price_data][product_data][name]': plan.label,
  };
  if (customerEmail) params.customer_email = customerEmail;

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || `Stripe ${res.status}`);
  }
  return { id: data.id, url: data.url };
}

/**
 * Перевіряє підпис вебхука Stripe.
 * rawBody — Buffer/рядок сирого тіла запиту (НЕ розпарсений JSON).
 * sigHeader — значення заголовка Stripe-Signature.
 * Повертає розпарсену подію або кидає помилку.
 */
export function verifyWebhook(rawBody, sigHeader, toleranceSec = 300) {
  if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET не задано.');
  if (!sigHeader) throw new Error('Немає підпису.');

  const parts = Object.fromEntries(
    String(sigHeader).split(',').map((p) => p.split('=').map((s) => s.trim()))
  );
  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) throw new Error('Некоректний підпис.');

  // Захист від реплею: позначка часу не старша за допуск.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (age > toleranceSec) throw new Error('Підпис застарів.');

  const payload = `${ts}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Підпис не збігається.');
  }
  return JSON.parse(rawBody.toString('utf8'));
}
