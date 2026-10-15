// Gera os ícones PROVISÓRIOS do PWA (M8-01): fundo petróleo com um "N" branco geométrico. A arte final da marca é
// PENDENTE do cliente; quando existir, substitua os PNGs de `public/icons/` (os nomes são os do manifesto).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 76, 92];
const FG = [255, 255, 255];

function crc32(buffer: Uint8Array): number {
  let c: number;
  let crc = 0xffffffff;
  for (const byte of buffer) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** O "N": duas hastes e uma diagonal, dentro da zona segura (`inset` = fração da margem; maskable usa 20%). */
function inN(x: number, y: number, inset: number): boolean {
  const left = inset + 0.14 * (1 - 2 * inset);
  const right = 1 - left;
  const top = inset + 0.14 * (1 - 2 * inset);
  const bottom = 1 - top;
  const stroke = 0.12 * (1 - 2 * inset);
  if (y < top || y > bottom) return false;
  if (x >= left && x <= left + stroke) return true;
  if (x >= right - stroke && x <= right) return true;
  // diagonal do canto superior esquerdo ao inferior direito
  const t = (y - top) / (bottom - top);
  const cx = left + t * (right - stroke - left);
  return x >= cx && x <= cx + stroke * 1.2;
}

function png(size: number, inset: number): Buffer {
  const samples = 3;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          if (inN((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size, inset))
            hits += 1;
        }
      }
      const share = hits / (samples * samples);
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        raw[offset + channel] = Math.round(BG[channel] * (1 - share) + FG[channel] * share);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, 0));
writeFileSync('public/icons/icon-512.png', png(512, 0));
writeFileSync('public/icons/icon-maskable-512.png', png(512, 0.2));
writeFileSync('public/icons/apple-touch-icon.png', png(180, 0));
console.log('ícones provisórios gerados em public/icons/');
