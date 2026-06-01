# Розгортання ОголошенняUK у продакшені

Три типові способи. Усі ведуть до одного: застосунок слухає `127.0.0.1:3000`,
а зовні стоїть HTTPS-проксі.

## Змінні оточення

| Змінна | Призначення |
|---|---|
| `PORT`, `HOST` | де слухати застосунок (за проксі — `HOST=127.0.0.1`) |
| `SITE_URL` | публічна адреса (канонічні URL у `sitemap.xml` і листах) |
| `ADMIN_EMAILS` | адміни через кому (інакше адмін — перший зареєстрований) |
| `SMTP_HOST`,`SMTP_PORT`,`SMTP_USER`,`SMTP_PASS`,`SMTP_SECURE`,`MAIL_FROM` | надсилання листів (вітання, скидання пароля, нові повідомлення). Без них пошта лише логуватиметься |

> Без `SMTP_HOST` застосунок повністю працює — листи просто не надсилаються
> (зручно для розробки). Задайте `EXPOSE_RESET_TOKEN=1`, щоб токен скидання
> показувався прямо в інтерфейсі (демо без пошти).

## Спосіб 1 — Caddy (найпростіший HTTPS)

```bash
node server.js &                     # або: docker compose up -d
caddy run --config ./deploy/Caddyfile
```

Caddy автоматично отримає й оновлюватиме TLS-сертифікат Let's Encrypt.
Відредагуйте домен у `deploy/Caddyfile`.

## Спосіб 2 — nginx + certbot

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ogoloshennia
sudo ln -s /etc/nginx/sites-available/ogoloshennia /etc/nginx/sites-enabled/
sudo certbot certonly --nginx -d example.com -d www.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Застосунок запускайте через systemd (`deploy/ogoloshennia.service`) або Docker.

## Спосіб 3 — Docker Compose

```bash
docker compose up -d --build
```

Дані й фото — у томах `ouk-data` та `ouk-uploads`. Перед Caddy/nginx
застосунок усередині все одно віддає `:3000`.

## SMTP: приклади

**Gmail (App Password):**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=you@gmail.com
SMTP_PASS=app-password
MAIL_FROM=ОголошенняUK <you@gmail.com>
```

**Звичайний провайдер (STARTTLS):**
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=no-reply@example.com
SMTP_PASS=secret
MAIL_FROM=ОголошенняUK <no-reply@example.com>
```

## Резервне копіювання

- Стан: `data/db.runtime.json` (база) + `public/uploads/` (фото).
- Адмін може завантажити дамп без секретів: кнопка «⤓ Завантажити бекап»
  у панелі модерації або `GET /api/admin/backup`.
