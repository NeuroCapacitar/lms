/**
 * Dinheiro na interface (M2-03): o preço é digitado em reais e vai ao servidor em CENTAVOS INTEIROS
 * (nunca `float`). Puro. Aceita `197`, `197,5`, `197,50`, `1.234,56` e `R$ 197,00`; recusa negativo,
 * mais de duas casas, letras e separadores fora de lugar.
 */
const PATTERN = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;

export function parseBrlToCents(input: string): number | null {
  const cleaned = input.replace(/^R\$\s*/, '').trim();
  if (!PATTERN.test(cleaned)) return null;
  const [whole = '', fraction = ''] = cleaned.replaceAll('.', '').split(',');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos em reais para exibir: `19700` vira `R$ 197,00`. */
export function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/** Centavos como texto editável (`19700` vira `197,00`), sem símbolo. */
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole},${fraction}`;
}
