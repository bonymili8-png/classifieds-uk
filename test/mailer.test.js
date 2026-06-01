/**
 * Тести SMTP-клієнта (mailer.js) проти мок-сервера.
 * Перевіряємо протокол, кодування кирилиці й режим "без SMTP".
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAILER = pathToFileURL(path.join(ROOT, 'mailer.js')).href;
const PORT = 2500 + Math.floor(Math.random() * 200);

let server;
const received = { mailFrom: '', rcptTo: '', data: '', sessions: 0 };

before(async () => {
  server = net.createServer((sock) => {
    received.sessions++;
    let mode = 'cmd'; let buf = '';
    sock.write('220 mock ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (mode === 'data') {
          if (line === '.') { mode = 'cmd'; sock.write('250 OK queued\r\n'); }
          else received.data += line + '\n';
          continue;
        }
        const up = line.toUpperCase();
        if (up.startsWith('EHLO') || up.startsWith('HELO')) sock.write('250 mock\r\n');
        else if (up.startsWith('MAIL FROM')) { received.mailFrom = line; sock.write('250 OK\r\n'); }
        else if (up.startsWith('RCPT TO')) { received.rcptTo = line; sock.write('250 OK\r\n'); }
        else if (up === 'DATA') { mode = 'data'; sock.write('354 send data\r\n'); }
        else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
});

after(() => { if (server) server.close(); });

test('без SMTP_HOST — режим логування, нічого не надсилається', async () => {
  delete process.env.SMTP_HOST;
  const mod = await import(MAILER + '?nohost');
  assert.equal(mod.mailEnabled, false);
  const res = await mod.sendMail({ to: 'x@y.dev', subject: 'Привіт', text: 'hi' });
  assert.equal(res.skipped, true);
});

test('SMTP-надсилання: протокол, кодування теми, base64-тіло', async () => {
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(PORT);
  process.env.SMTP_SECURE = '0';
  process.env.MAIL_FROM = 'ОголошенняUK <no-reply@test.dev>';
  // Свіжий імпорт модуля, щоб підхопив нові env.
  const mod = await import(MAILER + '?smtp');
  assert.equal(mod.mailEnabled, true);

  const res = await mod.sendMail({
    to: 'user@example.com', subject: 'Тест кирилиця ✓',
    text: 'Привіт!', html: '<b>Привіт!</b>',
  });
  assert.equal(res.ok, true);
  assert.match(received.mailFrom, /no-reply@test\.dev/);
  assert.match(received.rcptTo, /user@example\.com/);
  assert.ok(received.data.includes('=?UTF-8?B?'), 'тема в RFC2047');
  assert.ok(/Content-Transfer-Encoding: base64/.test(received.data), 'base64 MIME');
});

test('шаблон листа скидання містить посилання з токеном', async () => {
  const mod = await import(MAILER + '?tpl');
  const tpl = mod.passwordResetEmail('abc123');
  assert.match(tpl.subject, /парол/i);
  assert.ok(tpl.text.includes('abc123'));
  assert.ok(tpl.html.includes('abc123'));
});
