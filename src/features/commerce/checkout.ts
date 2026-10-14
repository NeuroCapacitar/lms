/**
 * Checkout hospedado do Asaas (M6-02), parte PURA: monta o corpo do pedido ao provider e confere o endereço devolvido.
 * Nada aqui faz rede. Dinheiro em centavos inteiros até a borda: o valor decimal do Asaas sai de `centsToDecimal`.
 * Nenhum dado de cartão passa pelo Hub; `customerData` NÃO é enviado (o Checkout coleta nome e CPF/CNPJ).
 */
import type { OrderSnapshot } from './commerce';

/** O Asaas limita o nome do item a 30 e a descrição a 150 caracteres. */
const ITEM_NAME_MAX = 30;
const ITEM_DESCRIPTION_MAX = 150;
const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

/**
 * Corta em CARACTERES VISÍVEIS (grafemas), nunca no meio de um emoji ou de um acento combinado, e põe `…` quando
 * cortou (o `…` conta no limite). Texto que já cabe volta aparado e intacto.
 */
export function truncateText(input: string, max: number): string {
  const text = input.trim().replaceAll(/\s+/g, ' ');
  const graphemes = [...segmenter.segment(text)].map((part) => part.segment);
  if (graphemes.length <= max) return text;
  return `${graphemes
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/** Centavos inteiros para o valor decimal do Asaas (`19700` vira `197`, `19705` vira `197.05`), sem erro de ponto flutuante. */
export function centsToDecimal(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('cents_invalid');
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return Number(`${whole}.${fraction}`);
}

/** Corpo de `POST /v3/checkouts`: Pix e cartão (sem boleto), à vista e parcelado até o limite do snapshot. */
export interface AsaasCheckoutRequest {
  billingTypes: ['PIX', 'CREDIT_CARD'];
  chargeTypes: ['DETACHED'] | ['DETACHED', 'INSTALLMENT'];
  minutesToExpire: number;
  externalReference: string;
  callback: { successUrl: string; cancelUrl: string; expiredUrl: string };
  items: {
    name: string;
    description: string;
    quantity: 1;
    value: number;
    imageBase64: string;
  }[];
  installment?: { maxInstallmentCount: number };
}

export function buildCheckoutRequest(input: {
  orderId: string;
  snapshot: OrderSnapshot;
  minutesToExpire: number;
  urls: { successUrl: string; cancelUrl: string; expiredUrl: string };
  imageBase64: string;
}): AsaasCheckoutRequest {
  const installments = input.snapshot.maxInstallments;
  return {
    billingTypes: ['PIX', 'CREDIT_CARD'],
    chargeTypes: installments > 1 ? ['DETACHED', 'INSTALLMENT'] : ['DETACHED'],
    minutesToExpire: input.minutesToExpire,
    externalReference: input.orderId,
    callback: input.urls,
    items: [
      {
        name: truncateText(input.snapshot.courseTitle, ITEM_NAME_MAX),
        description: truncateText(input.snapshot.offerName, ITEM_DESCRIPTION_MAX),
        quantity: 1,
        value: centsToDecimal(input.snapshot.priceCents),
        imageBase64: input.imageBase64,
      },
    ],
    ...(installments > 1 ? { installment: { maxInstallmentCount: installments } } : {}),
  };
}

/**
 * Hosts em que o Checkout do Asaas pode ser servido, por ambiente. Production só aceita o domínio real; qualquer outro
 * ambiente aceita só o sandbox. CONFERIR no sandbox (spike 5) antes de ativar: a lista é a allowlist do redirecionamento.
 */
export function checkoutHostsFor(environment: string): readonly string[] {
  return environment === 'production' ? ['www.asaas.com', 'asaas.com'] : ['sandbox.asaas.com'];
}

/**
 * Confere a URL devolvida pelo provider ANTES de guardá-la e de redirecionar a pessoa: `https`, host EXATAMENTE na
 * allowlist (nada de subdomínio nem sufixo parecido), sem credencial nem porta, sem espaço ou controle.
 */
export function isAllowedCheckoutUrl(url: string, hosts: readonly string[]): boolean {
  for (const char of url) {
    const code = char.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f || char === '\\') return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    return false;
  }
  if (parsed.port !== '') return false;
  return hosts.includes(parsed.hostname.toLowerCase());
}

/** As páginas do Hub para onde o Checkout devolve a pessoa (autenticadas; só leem o pedido da dona). */
export function checkoutReturnUrls(
  appBaseUrl: string,
  orderId: string,
): { successUrl: string; cancelUrl: string; expiredUrl: string } {
  const base = appBaseUrl.replace(/\/+$/, '');
  const url = (result: 'sucesso' | 'cancelado' | 'expirado') =>
    `${base}/compra/retorno?pedido=${encodeURIComponent(orderId)}&resultado=${result}`;
  return { successUrl: url('sucesso'), cancelUrl: url('cancelado'), expiredUrl: url('expirado') };
}

/**
 * Imagem do item exigida pelo Asaas: PNG 1x1 neutro de PLACEHOLDER. A arte da marca é PENDENTE (cliente); trocar
 * por uma imagem real não muda nenhuma regra.
 */
export const PLACEHOLDER_ITEM_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
