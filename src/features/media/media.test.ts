import { describe, expect, it } from 'vitest';

import {
  IMAGE_VARIANTS,
  isVariantName,
  masterUrl,
  publicObjectKey,
  toPublicImage,
  variantUrl,
} from './delivery';
import {
  checkIntent,
  createIntentSchema,
  readImageSize,
  sniffKind,
  verifyUploadedBytes,
  type MediaPurpose,
} from './media';
import { presignUrl, uriEncode } from './sigv4';

/* ---- bytes sintéticos: cabeçalhos mínimos válidos (nenhum arquivo real) ---- */
function png(width: number, height: number, total = 128): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function jpeg(width: number, height: number, total = 256, exifPadding = 0): Uint8Array {
  const bytes = new Uint8Array(total + exifPadding);
  bytes.set([0xff, 0xd8], 0);
  let offset = 2;
  if (exifPadding > 0) {
    // APP1 (EXIF) com `exifPadding` bytes antes do SOF
    bytes.set([0xff, 0xe1], offset);
    new DataView(bytes.buffer).setUint16(offset + 2, exifPadding - 2 + 2);
    offset += 2 + exifPadding;
  }
  bytes.set([0xff, 0xc0], offset); // SOF0
  const view = new DataView(bytes.buffer);
  view.setUint16(offset + 2, 17);
  bytes[offset + 4] = 8;
  view.setUint16(offset + 5, height);
  view.setUint16(offset + 7, width);
  return bytes;
}
function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 255, (w >> 8) & 255, (w >> 16) & 255], 24);
  bytes.set([h & 255, (h >> 8) & 255, (h >> 16) & 255], 27);
  return bytes;
}
function webpVp8l(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  bytes[20] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  bytes.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255], 21);
  return bytes;
}
function webpVp8(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  bytes.set([0x9d, 0x01, 0x2a], 23);
  bytes.set([width & 255, (width >> 8) & 255, height & 255, (height >> 8) & 255], 26);
  return bytes;
}
function pdf(total = 400, withEof = true): Uint8Array {
  const text = `%PDF-1.7\n${'x'.repeat(total - 20)}\n${withEof ? '%%EOF' : 'fim'}\n`;
  return new TextEncoder().encode(text);
}

const verify = (
  purpose: MediaPurpose,
  bytes: Uint8Array,
  declaredType: string,
  declaredSize = bytes.length,
) => verifyUploadedBytes({ purpose, declaredType, declaredSize, bytes });

describe('assinatura mágica e dimensões do cabeçalho', () => {
  it('reconhece o tipo REAL pelos primeiros bytes (e nada além dos permitidos)', () => {
    expect(sniffKind(png(10, 10))).toBe('png');
    expect(sniffKind(jpeg(10, 10))).toBe('jpeg');
    expect(sniffKind(webpVp8x(10, 10))).toBe('webp');
    expect(sniffKind(pdf())).toBe('pdf');
    for (const other of [
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      new TextEncoder().encode('GIF89a......'),
      new TextEncoder().encode('MZ\x90\x00 executável'),
      new Uint8Array(0),
      new Uint8Array([0xff, 0xd8]),
    ]) {
      expect(sniffKind(other)).toBeUndefined();
    }
  });

  it('lê as dimensões de PNG, JPEG (mesmo com EXIF grande antes do SOF) e das três formas de WebP', () => {
    expect(readImageSize(png(1680, 420), 'png')).toEqual({ width: 1680, height: 420 });
    expect(readImageSize(jpeg(1280, 720), 'jpeg')).toEqual({ width: 1280, height: 720 });
    expect(readImageSize(jpeg(1280, 720, 40_000, 30_000), 'jpeg')).toEqual({
      width: 1280,
      height: 720,
    });
    expect(readImageSize(webpVp8x(1680, 420), 'webp')).toEqual({ width: 1680, height: 420 });
    expect(readImageSize(webpVp8l(1280, 720), 'webp')).toEqual({ width: 1280, height: 720 });
    expect(readImageSize(webpVp8(640, 360), 'webp')).toEqual({ width: 640, height: 360 });
  });

  it('cabeçalho truncado ou inválido não tem dimensões (e nunca lança)', () => {
    expect(readImageSize(png(10, 10).subarray(0, 20), 'png')).toBeUndefined();
    expect(readImageSize(jpeg(10, 10).subarray(0, 6), 'jpeg')).toBeUndefined();
    expect(
      readImageSize(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]), 'jpeg'),
    ).toBeUndefined();
    const brokenPng = png(10, 10);
    brokenPng[12] = 0x58;
    expect(readImageSize(brokenPng, 'png')).toBeUndefined();
    expect(readImageSize(new Uint8Array(40), 'webp')).toBeUndefined();
    // um JPEG de marcadores em laço não trava
    const loop = new Uint8Array(64).fill(0xff);
    loop[0] = 0xff;
    loop[1] = 0xd8;
    expect(readImageSize(loop, 'jpeg')).toBeUndefined();
  });
});

describe('conferência dos bytes na confirmação', () => {
  it('aceita capa 16:9, banner 4:1 e PDF íntegro', () => {
    expect(verify('course_cover', png(1280, 720), 'image/png')).toMatchObject({
      ok: true,
      media: { kind: 'png', contentType: 'image/png', width: 1280, height: 720 },
    });
    expect(verify('course_banner', jpeg(1680, 420), 'image/jpeg')).toMatchObject({ ok: true });
    expect(verify('lesson_material', pdf(), 'application/pdf')).toMatchObject({
      ok: true,
      media: { kind: 'pdf', width: null, height: null },
    });
  });

  it('Content-Type certo com bytes errados, e o contrário, são recusados', () => {
    expect(verify('course_cover', png(1280, 720), 'image/jpeg')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    expect(verify('course_cover', jpeg(1280, 720), 'image/png')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    // extensão e MIME de imagem, conteúdo de texto/script
    const fake = new TextEncoder().encode('<script>alert(1)</script>'.padEnd(200, ' '));
    expect(verify('course_cover', fake, 'image/png')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    // SVG nunca (pode carregar script)
    const svg = new TextEncoder().encode('<svg onload="alert(1)"/>'.padEnd(200, ' '));
    expect(verify('course_cover', svg, 'image/svg+xml')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
  });

  it('o tipo real precisa ser permitido ao propósito (PDF como capa não)', () => {
    expect(verify('course_cover', pdf(), 'application/pdf')).toEqual({
      ok: false,
      reason: 'type_not_allowed',
    });
    expect(verify('certificate_asset', pdf(), 'application/pdf')).toEqual({
      ok: false,
      reason: 'type_not_allowed',
    });
  });

  it('tamanho real diferente do declarado ou acima do limite é recusado', () => {
    const image = png(1280, 720, 500);
    expect(verify('course_cover', image, 'image/png', 499)).toEqual({
      ok: false,
      reason: 'size_mismatch',
    });
    const huge = png(1280, 720, 3 * 1024 * 1024 + 1);
    expect(verify('course_cover', huge, 'image/png')).toEqual({ ok: false, reason: 'too_large' });
  });

  it('imagem gigante (pixels), minúscula ou de proporção errada é recusada ANTES de qualquer decodificação', () => {
    expect(verify('course_cover', png(50_000, 28_125), 'image/png')).toEqual({
      ok: false,
      reason: 'dimensions_out_of_range',
    });
    expect(verify('course_cover', png(100, 56), 'image/png')).toEqual({
      ok: false,
      reason: 'dimensions_out_of_range',
    });
    expect(verify('course_cover', png(1000, 1000), 'image/png')).toEqual({
      ok: false,
      reason: 'aspect_mismatch',
    });
    expect(verify('course_banner', png(1680, 840), 'image/png')).toEqual({
      ok: false,
      reason: 'aspect_mismatch',
    });
    expect(verify('course_cover', png(0, 720), 'image/png')).toEqual({
      ok: false,
      reason: 'bad_dimensions',
    });
  });

  it('PDF truncado (sem %%EOF perto do fim) é recusado', () => {
    expect(verify('lesson_material', pdf(400, false), 'application/pdf')).toEqual({
      ok: false,
      reason: 'pdf_truncated',
    });
  });

  it('a proporção aceita 2% de tolerância (recorte do navegador arredonda pixels)', () => {
    expect(verify('course_banner', png(1680, 421), 'image/png')).toMatchObject({ ok: true });
    expect(verify('course_cover', png(1280, 722), 'image/png')).toMatchObject({ ok: true });
  });
});

describe('intenção de upload', () => {
  it('só aceita tipo e tamanho permitidos ao propósito', () => {
    expect(checkIntent('course_cover', 'image/webp', 1000)).toEqual({ ok: true, kind: 'webp' });
    expect(checkIntent('course_cover', 'image/webp; charset=x', 1000)).toMatchObject({ ok: true });
    expect(checkIntent('course_cover', 'image/svg+xml', 1000)).toEqual({
      ok: false,
      reason: 'content_type_not_allowed',
    });
    expect(checkIntent('course_cover', 'application/pdf', 1000)).toEqual({
      ok: false,
      reason: 'content_type_not_allowed',
    });
    expect(checkIntent('course_cover', 'image/png', 4 * 1024 * 1024)).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(checkIntent('lesson_material', 'application/pdf', 20 * 1024 * 1024)).toMatchObject({
      ok: true,
    });
  });

  it('o corpo é estrito: propósito conhecido, tamanho inteiro positivo, sem campos a mais', () => {
    const good = { purpose: 'course_cover', contentType: 'image/png', size: 1000 };
    expect(createIntentSchema.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, purpose: 'avatar' },
      { ...good, size: 0 },
      { ...good, size: 1.5 },
      { ...good, extra: 1 },
      { purpose: 'course_cover' },
    ]) {
      expect(createIntentSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('URL pré-assinada (SigV4)', () => {
  it('confere com o exemplo PUBLICADO pela AWS (GET com consulta, 24 h)', async () => {
    const url = await presignUrl({
      method: 'GET',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 's3',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      expiresSeconds: 86_400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('o PUT assina o Content-Type (mudar o tipo muda a assinatura) e a validade', async () => {
    const base = {
      method: 'PUT' as const,
      accessKeyId: 'chave',
      secretAccessKey: 'segredo',
      region: 'auto',
      service: 's3',
      host: 'conta.r2.cloudflarestorage.com',
      path: '/bucket/m/abc',
      expiresSeconds: 300,
      now: new Date('2026-10-13T12:00:00Z'),
    };
    const png = await presignUrl({ ...base, signedHeaders: { 'content-type': 'image/png' } });
    const jpg = await presignUrl({ ...base, signedHeaders: { 'content-type': 'image/jpeg' } });
    expect(png).toContain('X-Amz-SignedHeaders=content-type%3Bhost');
    expect(png).toContain('X-Amz-Expires=300');
    expect(new URL(png).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(jpg).searchParams.get('X-Amz-Signature'),
    );
    expect(await presignUrl({ ...base, signedHeaders: { 'content-type': 'image/png' } })).toBe(png);
    expect(uriEncode("a b/c!'()*~-_.")).toBe('a%20b%2Fc%21%27%28%29%2A~-_.');
  });
});

describe('entrega pública', () => {
  it('variantes são só as semânticas; largura arbitrária não existe', () => {
    expect(Object.keys(IMAGE_VARIANTS).sort()).toEqual([
      'banner_narrow',
      'banner_wide',
      'cover_card',
      'cover_hero',
    ]);
    expect(isVariantName('cover_card')).toBe(true);
    for (const bad of ['width=99999', '640', 'master', '__proto__', 'constructor', '']) {
      expect(isVariantName(bad), bad).toBe(false);
    }
  });

  it('monta a URL da variante (Images) e o fallback do master estático', () => {
    const key = publicObjectKey('11111111-1111-4111-8111-111111111111', 'webp');
    expect(key).toBe('11111111-1111-4111-8111-111111111111.webp');
    expect(variantUrl('https://midia.exemplo.com.br/', key, 'cover_card')).toBe(
      `https://midia.exemplo.com.br/cdn-cgi/image/width=640,quality=80,format=auto/${key}`,
    );
    expect(masterUrl('https://midia.exemplo.com.br/', key)).toBe(
      `https://midia.exemplo.com.br/${key}`,
    );
    expect(
      toPublicImage({
        baseUrl: 'https://m.test',
        publicKey: key,
        variant: 'banner_wide',
        width: 1680,
        height: 420,
      }),
    ).toEqual({
      src: `https://m.test/cdn-cgi/image/width=1680,quality=80,format=auto/${key}`,
      fallbackSrc: `https://m.test/${key}`,
      width: 1680,
      height: 420,
    });
  });
});
