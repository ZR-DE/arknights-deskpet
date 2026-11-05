'use strict';

/**
 * 生成托盘图标（无第三方依赖，手写 PNG 编码）。
 * 产物：assets/brand/tray.png —— 白色圆环，深浅任务栏都能看清。
 *
 * 用法：npm run icon
 */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 32;
const OUTER = 13;
const INNER = 9.5;
const RGB = [232, 240, 238];

let crcTable = null;

function table() {
  if (crcTable) return crcTable;
  crcTable = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }
  return crcTable;
}

function crc32(buf) {
  const t = table();
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const center = SIZE / 2;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const dist = Math.hypot(dx, dy);

      const edge = Math.min(OUTER - dist, dist - INNER);
      const alpha = Math.max(0, Math.min(1, edge + 0.5));

      const i = (y * SIZE + x) * 4;
      pixels[i] = RGB[0];
      pixels[i + 1] = RGB[1];
      pixels[i + 2] = RGB[2];
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

function encodePng(pixels) {
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);

  for (let y = 0; y < SIZE; y += 1) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'assets', 'brand');
fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'tray.png');
fs.writeFileSync(outPath, encodePng(buildPixels()));
console.log('已生成', outPath);
