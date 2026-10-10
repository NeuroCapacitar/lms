/**
 * Conversão de cores e contraste WCAG 2.x, só para testes. Sem dependência externa: o CSS do
 * projeto declara tokens em OKLCH (e hex nas poucas exceções), e o teste de contraste calcula o
 * que o navegador renderizaria.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** OKLCH → sRGB (0–1, já com recorte ao gamut). Referência: css-color-4 / Björn Ottosson. */
export function oklchToRgb(lightness: number, chroma: number, hueDegrees: number): Rgb {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: clamp01(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  };
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) {
    throw new Error(`hex inválido: ${hex}`);
  }
  const value = Number.parseInt(match[1], 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

/** Aceita `oklch(L C H)` (L em 0–1 ou %) e `#rrggbb`. */
export function parseColor(input: string): Rgb {
  const text = input.trim();
  if (text.startsWith('#')) {
    return hexToRgb(text);
  }
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(text);
  if (!match?.[1] || !match[3] || !match[4]) {
    throw new Error(`cor não suportada pelo teste de contraste: ${input}`);
  }
  const lightness = Number(match[1]) / (match[2] === '%' ? 100 : 1);
  return oklchToRgb(lightness, Number(match[3]), Number(match[4]));
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}
