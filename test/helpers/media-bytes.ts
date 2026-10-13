/**
 * Bytes SINTÉTICOS de teste (M5-07): só os cabeçalhos mínimos que o servidor lê (assinatura mágica e dimensões);
 * nenhum arquivo real. Servem para provar a conferência de bytes sem depender de imagens de verdade.
 */
export function pngBytes(width: number, height: number, total = 256): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

export function jpegBytes(width: number, height: number, total = 256): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 17);
  bytes[6] = 8;
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes;
}

export function pdfBytes(total = 600): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${'x'.repeat(total - 20)}\n%%EOF\n`);
}

export function textBytes(text: string, total = 256): Uint8Array {
  return new TextEncoder().encode(text.padEnd(total, ' '));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
