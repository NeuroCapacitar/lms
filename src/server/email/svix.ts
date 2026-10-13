/**
 * Verificação da assinatura Svix dos webhooks do Resend (M4-07), com WebCrypto. O corpo é o texto BRUTO
 * (nunca o JSON reserializado). Assina-se `${svix-id}.${svix-timestamp}.${corpo}` com HMAC-SHA256 e a
 * chave do endpoint (`whsec_<base64>`); o cabeçalho `svix-signature` traz uma ou mais assinaturas
 * `v1,<base64>` separadas por espaço (a rotação do segredo envia as duas). A comparação é em tempo
 * constante (`crypto.subtle.verify`) e o carimbo de tempo precisa estar dentro da tolerância (anti-replay).
 */
const DEFAULT_TOLERANCE_SECONDS = 300;

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

export interface SvixInput {
  /** `whsec_<base64>`, o segredo do endpoint no Resend. */
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  /** Corpo bruto exatamente como recebido. */
  body: string;
  /** Segundos desde a época (injetável nos testes). */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

/** `true` só se o carimbo está na janela E ao menos uma assinatura `v1` confere. Nunca lança. */
export async function verifySvixSignature(input: SvixInput): Promise<boolean> {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamp)) > tolerance) return false;

  const rawSecret = input.secret.startsWith('whsec_') ? input.secret.slice(6) : input.secret;
  const keyBytes = base64ToBytes(rawSecret);
  if (!keyBytes || keyBytes.length === 0) return false;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'verify',
    ]);
  } catch {
    return false;
  }
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${input.body}`);

  for (const candidate of signature.split(' ')) {
    const [version, value] = candidate.split(',');
    if (version !== 'v1' || !value) continue;
    const bytes = base64ToBytes(value);
    if (!bytes) continue;
    if (await crypto.subtle.verify('HMAC', key, bytes, signed)) return true;
  }
  return false;
}
