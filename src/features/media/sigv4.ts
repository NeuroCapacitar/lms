/**
 * URL pré-assinada (SigV4 de consulta) com WebCrypto, para o PUT direto ao R2 pelo endpoint S3 (M5-07). Sem
 * biblioteca: o algoritmo é curto e o resultado confere com o exemplo publicado pela AWS (teste). Só assina o
 * que o chamador pede (`host` e, se for o caso, `content-type`); o corpo é `UNSIGNED-PAYLOAD` (o servidor valida
 * os BYTES na confirmação, porque o R2 não garante `Content-Length` nem checksum assinados).
 */
const encoder = new TextEncoder();

export interface PresignInput {
  method: 'PUT' | 'GET';
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  host: string;
  /** Caminho JÁ codificado, começando em `/` (ex.: `/bucket/chave`). */
  path: string;
  /** Cabeçalhos além de `host` que entram na assinatura (nomes em minúsculas). */
  signedHeaders?: Record<string, string>;
  expiresSeconds: number;
  now: Date;
}

/** RFC 3986: tudo codificado, menos `A-Z a-z 0-9 - _ . ~`. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

export async function presignUrl(input: PresignInput): Promise<string> {
  const iso = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = iso.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;

  const headers: Record<string, string> = { host: input.host, ...input.signedHeaders };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': iso,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key]!)}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', iso, scope, await sha256Hex(canonicalRequest)].join(
    '\n',
  );

  let key: ArrayBuffer = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), date);
  key = await hmac(key, input.region);
  key = await hmac(key, input.service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, stringToSign));
  return `https://${input.host}${input.path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
