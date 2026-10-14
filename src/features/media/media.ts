import { z } from 'zod';

/**
 * Mídia (M5-07, ADR 0016). Puro: sem rede nem banco. R2 é a fonte canônica; só capa e banner são PÚBLICOS,
 * o resto é privado. O servidor NUNCA confia no que o navegador diz: confere o tamanho real, a assinatura
 * mágica e as dimensões (lidas do cabeçalho, sem decodificar) contra os limites do propósito.
 */
export type MediaKind = 'jpeg' | 'png' | 'webp' | 'pdf';

export const MIME_BY_KIND: Record<MediaKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export const EXTENSION_BY_KIND: Record<MediaKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  pdf: 'pdf',
};

const MiB = 1024 * 1024;

export interface PurposeRule {
  visibility: 'public' | 'private';
  kinds: readonly MediaKind[];
  maxBytes: number;
  /** Limites das dimensões de imagem (pixels); ignorados para PDF. */
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  /** Proporção exigida (largura/altura), com tolerância de 2%; ausente = livre. */
  aspect?: number;
}

/** Limites por propósito. Banner 4:1 (1680×420) até 5 MiB, como no legado (a confirmar com o cliente). */
export const MEDIA_PURPOSES = {
  course_cover: {
    visibility: 'public',
    kinds: ['jpeg', 'png', 'webp'],
    maxBytes: 3 * MiB,
    maxWidth: 2560,
    maxHeight: 1440,
    minWidth: 320,
    minHeight: 180,
    aspect: 16 / 9,
  },
  course_banner: {
    visibility: 'public',
    kinds: ['jpeg', 'png', 'webp'],
    maxBytes: 5 * MiB,
    maxWidth: 3360,
    maxHeight: 840,
    minWidth: 840,
    minHeight: 210,
    aspect: 4,
  },
  /** Banner do painel do aluno (M5-15): os mesmos limites do banner do curso. */
  panel_banner: {
    visibility: 'public',
    kinds: ['jpeg', 'png', 'webp'],
    maxBytes: 5 * MiB,
    maxWidth: 3360,
    maxHeight: 840,
    minWidth: 840,
    minHeight: 210,
    aspect: 4,
  },
  /** Imagem decorativa da tela de login (M5-15): retrato 3:4. */
  login_media: {
    visibility: 'public',
    kinds: ['jpeg', 'png', 'webp'],
    maxBytes: 3 * MiB,
    maxWidth: 1800,
    maxHeight: 2400,
    minWidth: 450,
    minHeight: 600,
    aspect: 3 / 4,
  },
  lesson_material: {
    visibility: 'private',
    kinds: ['pdf', 'jpeg', 'png', 'webp'],
    maxBytes: 20 * MiB,
    maxWidth: 8000,
    maxHeight: 8000,
    minWidth: 1,
    minHeight: 1,
  },
  certificate_asset: {
    visibility: 'private',
    kinds: ['jpeg', 'png', 'webp'],
    maxBytes: 3 * MiB,
    maxWidth: 4000,
    maxHeight: 4000,
    minWidth: 1,
    minHeight: 1,
  },
} as const satisfies Record<string, PurposeRule>;

export type MediaPurpose = keyof typeof MEDIA_PURPOSES;
const MEDIA_PURPOSE_NAMES = Object.keys(MEDIA_PURPOSES) as MediaPurpose[];

export const createIntentSchema = z.strictObject({
  purpose: z.enum(MEDIA_PURPOSE_NAMES as [MediaPurpose, ...MediaPurpose[]]),
  contentType: z.string().max(100),
  size: z
    .number()
    .int()
    .min(1)
    .max(100 * MiB),
});

/** Validade do PUT pré-assinado (segundos). Curta de propósito. */
export const UPLOAD_URL_SECONDS = 300;
/** Upload não confirmado e objeto sem referência expiram em 24 h. */
export const MEDIA_RETENTION_HOURS = 24;

export type IntentRejection = 'content_type_not_allowed' | 'too_large';

/** O que a Staff declarou cabe no propósito? (A conferência de verdade é a dos bytes, na confirmação.) */
export function checkIntent(
  purpose: MediaPurpose,
  contentType: string,
  size: number,
): { ok: true; kind: MediaKind } | { ok: false; reason: IntentRejection } {
  const rule: PurposeRule = MEDIA_PURPOSES[purpose];
  const kind = kindOfMime(contentType);
  if (!kind || !rule.kinds.includes(kind)) return { ok: false, reason: 'content_type_not_allowed' };
  if (size > rule.maxBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, kind };
}

function kindOfMime(contentType: string): MediaKind | undefined {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return (Object.entries(MIME_BY_KIND).find(([, mime]) => mime === base)?.[0] ?? undefined) as
    | MediaKind
    | undefined;
}

/** O tipo REAL pelos primeiros bytes (assinatura mágica); `undefined` se não é nenhum permitido. */
export function sniffKind(bytes: Uint8Array): MediaKind | undefined {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'pdf';
  return undefined;
}

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

/**
 * Dimensões lidas do CABEÇALHO, sem decodificar a imagem (nenhuma "bomba de pixels" chega a um decodificador).
 * PNG: IHDR; JPEG: o primeiro marcador SOF; WebP: VP8, VP8L ou VP8X. Cabeçalho truncado ou inválido: `undefined`.
 */
export function readImageSize(bytes: Uint8Array, kind: MediaKind): ImageSize | undefined {
  if (kind === 'png') {
    if (bytes.length < 24 || u32be(bytes, 8) !== 13) return undefined;
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return undefined;
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (kind === 'jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return undefined;
      let marker = bytes[offset + 1]!;
      while (marker === 0xff && offset + 2 < bytes.length) {
        offset += 1;
        marker = bytes[offset + 1]!;
      }
      // Marcadores sem tamanho (RSTn, SOI, EOI, TEM) não aparecem antes do SOF num JPEG válido.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = u16be(bytes, offset + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
      if (length < 2) return undefined;
      offset += 2 + length;
    }
    return undefined;
  }
  if (kind === 'webp') {
    if (bytes.length < 30) return undefined;
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    if (chunk === 'VP8L') {
      if (bytes[20] !== 0x2f) return undefined;
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') {
      if (!(bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)) return undefined;
      return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    return undefined;
  }
  return undefined;
}

export type ConfirmRejection =
  | 'type_mismatch'
  | 'type_not_allowed'
  | 'too_large'
  | 'size_mismatch'
  | 'bad_dimensions'
  | 'dimensions_out_of_range'
  | 'aspect_mismatch'
  | 'pdf_truncated';

export interface VerifiedMedia {
  kind: MediaKind;
  contentType: string;
  width: number | null;
  height: number | null;
}

/**
 * A conferência da CONFIRMAÇÃO sobre os bytes de verdade: o tipo real bate com o declarado e é permitido ao
 * propósito, o tamanho real é o declarado e cabe no limite, e (imagem) as dimensões do cabeçalho existem, cabem
 * na faixa e têm a proporção exigida. PDF: assinatura `%PDF-` e `%%EOF` perto do fim (arquivo não truncado).
 */
export function verifyUploadedBytes(input: {
  purpose: MediaPurpose;
  declaredType: string;
  declaredSize: number;
  bytes: Uint8Array;
}): { ok: true; media: VerifiedMedia } | { ok: false; reason: ConfirmRejection } {
  const rule: PurposeRule = MEDIA_PURPOSES[input.purpose];
  if (input.bytes.length > rule.maxBytes) return { ok: false, reason: 'too_large' };
  if (input.bytes.length !== input.declaredSize) return { ok: false, reason: 'size_mismatch' };
  const real = sniffKind(input.bytes);
  if (!real) return { ok: false, reason: 'type_mismatch' };
  if (real !== kindOfMime(input.declaredType)) return { ok: false, reason: 'type_mismatch' };
  if (!rule.kinds.includes(real)) return { ok: false, reason: 'type_not_allowed' };

  if (real === 'pdf') {
    const tail = new TextDecoder('latin1').decode(
      input.bytes.subarray(Math.max(0, input.bytes.length - 1100)),
    );
    if (!tail.includes('%%EOF')) return { ok: false, reason: 'pdf_truncated' };
    return {
      ok: true,
      media: { kind: real, contentType: MIME_BY_KIND[real], width: null, height: null },
    };
  }
  const size = readImageSize(input.bytes, real);
  if (!size || size.width < 1 || size.height < 1) return { ok: false, reason: 'bad_dimensions' };
  if (
    size.width > rule.maxWidth ||
    size.height > rule.maxHeight ||
    size.width < rule.minWidth ||
    size.height < rule.minHeight
  ) {
    return { ok: false, reason: 'dimensions_out_of_range' };
  }
  if (rule.aspect !== undefined) {
    const ratio = size.width / size.height;
    if (Math.abs(ratio - rule.aspect) / rule.aspect > 0.02) {
      return { ok: false, reason: 'aspect_mismatch' };
    }
  }
  return {
    ok: true,
    media: {
      kind: real,
      contentType: MIME_BY_KIND[real],
      width: size.width,
      height: size.height,
    },
  };
}

export interface MediaAssetDto {
  id: string;
  purpose: MediaPurpose;
  state: 'pending_upload' | 'ready' | 'rejected' | 'deleted';
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface UploadIntentDto {
  id: string;
  upload: {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
    expiresInSeconds: number;
  };
}
