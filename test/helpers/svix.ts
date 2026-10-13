/** Assina um corpo como o Svix (para testar o webhook do Resend): HMAC-SHA256 de `id.timestamp.corpo`. */
export const TEST_WEBHOOK_SECRET = `whsec_${btoa('segredo-de-webhook-so-de-teste-0123456789')}`;

export async function signSvix(options: {
  secret?: string;
  id: string;
  timestamp: number;
  body: string;
}): Promise<string> {
  const secret = options.secret ?? TEST_WEBHOOK_SECRET;
  const raw = atob(secret.replace(/^whsec_/, ''));
  const keyBytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${options.id}.${options.timestamp}.${options.body}`),
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

export async function signedHeaders(
  body: string,
  options: { id?: string; timestamp?: number; secret?: string } = {},
): Promise<Record<string, string>> {
  const id = options.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': await signSvix({ id, timestamp, body, secret: options.secret }),
    'content-type': 'application/json',
  };
}
