/**
 * Мінімальний SMTP-клієнт без зовнішніх залежностей.
 *
 * Підтримує:
 *   • пряме TLS-з'єднання (порт 465, SMTP_SECURE=1)
 *   • STARTTLS (порт 587/25)
 *   • AUTH LOGIN та AUTH PLAIN
 *
 * Налаштування через змінні оточення:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE=1
 *   MAIL_FROM   — адреса відправника, напр. "ОголошенняUK <no-reply@example.com>"
 *
 * Якщо SMTP_HOST не заданий — пошта працює в режимі "лог у консоль"
 * (нічого нікуди не надсилається), що зручно для розробки/демо/тестів.
 */

import net from 'node:net';
import tls from 'node:tls';

const CFG = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  secure: process.env.SMTP_SECURE === '1' || Number(process.env.SMTP_PORT) === 465,
  from: process.env.MAIL_FROM || 'ОголошенняUK <no-reply@localhost>',
};

export const mailEnabled = !!CFG.host;

/** Просте читання SMTP-відповідей: збирає рядки до повного коду відповіді. */
function smtpDialog(socket) {
  let buffer = '';
  const waiters = [];

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    // Відповідь завершена, коли є рядок виду "250 ..." (пробіл після коду).
    while ((idx = buffer.indexOf('\r\n')) !== -1) {
      // нічого — нам потрібен повний блок; перевіряємо нижче
      break;
    }
    flush();
  });

  function flush() {
    if (!waiters.length) return;
    const lines = buffer.split('\r\n').filter(Boolean);
    if (!lines.length) return;
    const last = lines[lines.length - 1];
    // Останній рядок відповіді має формат "NNN текст" (а не "NNN-текст").
    if (/^\d{3} /.test(last)) {
      const code = Number(last.slice(0, 3));
      const text = lines.join('\n');
      buffer = '';
      const w = waiters.shift();
      w.resolve({ code, text });
    }
  }

  return {
    read() {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        flush();
      });
    },
    write(line) {
      socket.write(line + '\r\n');
    },
  };
}

async function expect(dlg, okCodes) {
  const res = await dlg.read();
  if (!okCodes.includes(res.code)) {
    throw new Error(`SMTP ${res.code}: ${res.text}`);
  }
  return res;
}

function encodeHeader(value) {
  // RFC 2047 для не-ASCII (наприклад, кирилиці) у темі/іменах.
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return '=?UTF-8?B?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
}

function buildMessage({ to, subject, text, html }) {
  const boundary = 'b_' + Math.random().toString(36).slice(2);
  const headers = [
    `From: ${CFG.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text || '', 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html || text || '', 'utf8').toString('base64'),
    `--${boundary}--`,
    '',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n');
}

// Екранування крапок на початку рядка (SMTP dot-stuffing).
function dotStuff(message) {
  return message.replace(/\r\n\./g, '\r\n..');
}

function senderAddress() {
  const m = /<([^>]+)>/.exec(CFG.from);
  return m ? m[1] : CFG.from;
}

async function sendViaSmtp({ to, subject, text, html }) {
  const socket = CFG.secure
    ? tls.connect({ host: CFG.host, port: CFG.port, servername: CFG.host })
    : net.connect({ host: CFG.host, port: CFG.port });

  socket.setTimeout(15000);

  await new Promise((resolve, reject) => {
    socket.once(CFG.secure ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('SMTP timeout')));
  });

  let dlg = smtpDialog(socket);
  let activeSocket = socket;

  try {
    await expect(dlg, [220]);
    dlg.write('EHLO ogoloshennia.uk');
    const ehlo = await expect(dlg, [250]);

    // STARTTLS, якщо не пряме TLS і сервер підтримує.
    if (!CFG.secure && /STARTTLS/i.test(ehlo.text)) {
      dlg.write('STARTTLS');
      await expect(dlg, [220]);
      const upgraded = tls.connect({ socket, host: CFG.host, servername: CFG.host });
      await new Promise((resolve, reject) => {
        upgraded.once('secureConnect', resolve);
        upgraded.once('error', reject);
      });
      activeSocket = upgraded;
      dlg = smtpDialog(upgraded);
      dlg.write('EHLO ogoloshennia.uk');
      await expect(dlg, [250]);
    }

    // Автентифікація (AUTH LOGIN), якщо задано користувача.
    if (CFG.user) {
      dlg.write('AUTH LOGIN');
      await expect(dlg, [334]);
      dlg.write(Buffer.from(CFG.user, 'utf8').toString('base64'));
      await expect(dlg, [334]);
      dlg.write(Buffer.from(CFG.pass, 'utf8').toString('base64'));
      await expect(dlg, [235]);
    }

    dlg.write(`MAIL FROM:<${senderAddress()}>`);
    await expect(dlg, [250]);
    dlg.write(`RCPT TO:<${to}>`);
    await expect(dlg, [250, 251]);
    dlg.write('DATA');
    await expect(dlg, [354]);

    const message = dotStuff(buildMessage({ to, subject, text, html }));
    activeSocket.write(message + '\r\n.\r\n');
    await expect(dlg, [250]);

    dlg.write('QUIT');
    try { await expect(dlg, [221]); } catch { /* деякі сервери рвуть з'єднання */ }
  } finally {
    activeSocket.end();
    if (activeSocket !== socket) socket.end();
  }
}

/**
 * Надіслати лист. У режимі без SMTP — лише лог.
 * Ніколи не кидає виняток назовні (помилка пошти не має валити бізнес-логіку).
 */
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled) {
    console.log(`[mail:dev] → ${to} | ${subject}`);
    return { ok: false, skipped: true };
  }
  try {
    await sendViaSmtp({ to, subject, text, html });
    console.log(`[mail] надіслано → ${to} | ${subject}`);
    return { ok: true };
  } catch (e) {
    console.error(`[mail] помилка надсилання → ${to}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/* ----------------------------------------------------------------------------
 * Шаблони листів (UA)
 * ------------------------------------------------------------------------- */

const SITE = (process.env.SITE_URL || '').replace(/\/+$/, '') || 'http://localhost:3000';

function layout(title, bodyHtml) {
  return `<!doctype html><html lang="uk"><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f1729">
    <div style="max-width:520px;margin:0 auto;padding:24px">
      <div style="background:#0057b7;color:#fff;border-radius:14px 14px 0 0;padding:18px 22px;font-weight:800;font-size:18px">ОголошенняUK 🇺🇦🇬🇧</div>
      <div style="background:#fff;border:1px solid #e6e9f0;border-top:0;border-radius:0 0 14px 14px;padding:22px">
        <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
        ${bodyHtml}
      </div>
      <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:16px">Це автоматичний лист, відповідати на нього не потрібно.</p>
    </div></body></html>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#0057b7;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">${label}</a>`;
}

export function passwordResetEmail(resetToken) {
  const link = `${SITE}/#/reset?token=${encodeURIComponent(resetToken)}`;
  return {
    subject: 'Відновлення пароля — ОголошенняUK',
    text: `Щоб встановити новий пароль, перейдіть за посиланням (дійсне 30 хв):\n${link}\n\nЯкщо ви не запитували скидання — проігноруйте цей лист.`,
    html: layout('Відновлення пароля', `
      <p>Ви запросили скидання пароля. Посилання дійсне <b>30 хвилин</b>:</p>
      <p style="margin:18px 0">${button(link, 'Встановити новий пароль')}</p>
      <p style="color:#64748b;font-size:13px">Якщо ви цього не робили — просто проігноруйте лист.</p>`),
  };
}

export function welcomeEmail(name) {
  return {
    subject: 'Вітаємо в ОголошенняUK!',
    text: `Привіт, ${name}! Дякуємо за реєстрацію. Тепер ви можете додавати оголошення, спілкуватися в чаті та лишати відгуки.\n${SITE}`,
    html: layout(`Вітаємо, ${name}!`, `
      <p>Дякуємо за реєстрацію в спільноті українців у Британії.</p>
      <p>Тепер ви можете додавати оголошення, писати продавцям у чаті та лишати відгуки.</p>
      <p style="margin:18px 0">${button(SITE, 'Перейти на сайт')}</p>`),
  };
}

export function newMessageEmail({ toName, fromName, listingTitle, threadId }) {
  const link = `${SITE}/#/chat/${threadId}`;
  return {
    subject: `Нове повідомлення від ${fromName} — ОголошенняUK`,
    text: `${toName}, у вас нове повідомлення від ${fromName} щодо «${listingTitle}».\nВідповісти: ${link}`,
    html: layout('Нове повідомлення', `
      <p><b>${fromName}</b> написав(ла) вам щодо оголошення «${listingTitle}».</p>
      <p style="margin:18px 0">${button(link, 'Відповісти в чаті')}</p>`),
  };
}
