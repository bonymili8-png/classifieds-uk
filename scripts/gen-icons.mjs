// Генерує PNG-іконки (192 і 512) без зовнішніх залежностей.
// Малюємо ту саму композицію, що й у icon.svg, через прямі заливки пікселів.
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
const BLUE = hex('#0057b7'), BLUE2 = hex('#0b65d4'), WHITE = [255, 255, 255], YELLOW = hex('#ffd700');

function draw(S) {
  const k = S / 512;
  const px = new Uint8ClampedArray(S * S * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const af = a / 255, ia = 1 - af;
    px[i] = px[i] * ia + r * af; px[i + 1] = px[i + 1] * ia + g * af;
    px[i + 2] = px[i + 2] * ia + b * af; px[i + 3] = 255;
  };
  const inRound = (x, y, X, Y, W, H, R) => {
    if (x < X || y < Y || x >= X + W || y >= Y + H) return false;
    const cx = Math.min(Math.max(x, X + R), X + W - R);
    const cy = Math.min(Math.max(y, Y + R), Y + H - R);
    return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
  };
  const rect = (X, Y, W, H, R, col, a = 255) => {
    for (let y = Math.floor(Y); y < Y + H; y++)
      for (let x = Math.floor(X); x < X + W; x++)
        if (inRound(x, y, X, Y, W, H, R)) set(x, y, col, a);
  };
  // фон-градієнт
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inRound(x, y, 0, 0, S, S, 112 * k)) continue;
    const t = (x + y) / (2 * S);
    set(x, y, [BLUE[0] + (BLUE2[0] - BLUE[0]) * t, BLUE[1] + (BLUE2[1] - BLUE[1]) * t, BLUE[2] + (BLUE2[2] - BLUE[2]) * t]);
  }
  rect(120 * k, 120 * k, 272 * k, 272 * k, 36 * k, WHITE, 30);
  rect(150 * k, 170 * k, 212 * k, 26 * k, 13 * k, YELLOW);
  rect(150 * k, 222 * k, 160 * k, 22 * k, 11 * k, WHITE);
  rect(150 * k, 266 * k, 190 * k, 22 * k, 11 * k, WHITE);
  rect(150 * k, 310 * k, 120 * k, 22 * k, 11 * k, WHITE, 180);
  // кружок
  const cx = 338 * k, cy = 321 * k, r = 22 * k;
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, YELLOW);
  return px;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function encodePNG(S, px) {
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter none
    for (let i = 0; i < S * 4; i++) raw[y * (S * 4 + 1) + 1 + i] = px[y * S * 4 + i];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const S of [192, 512]) {
  const png = encodePNG(S, draw(S));
  await fs.writeFile(path.join(dir, `icon-${S}.png`), png);
  console.log(`icon-${S}.png — ${png.length} байт`);
}
