import { describe, expect, it } from 'vitest';

import { certificateDeps } from '../certificate/factory';
import { createR2Storage } from './r2-storage';
import { MediaNotConfiguredError } from './storage';

/** Um R2Bucket de mentira (só o que o código usa): guarda em memória. */
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = {
    async head(key: string) {
      const found = objects.get(key);
      return found ? { size: found.bytes.byteLength } : null;
    },
    async get(key: string) {
      const found = objects.get(key);
      if (!found) return null;
      return {
        size: found.bytes.byteLength,
        body: new Blob([found.bytes as unknown as ArrayBuffer]).stream(),
        arrayBuffer: async () => found.bytes.slice().buffer,
      };
    },
    async put(
      key: string,
      body: Uint8Array,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      objects.set(key, { bytes: body, contentType: options?.httpMetadata?.contentType });
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

const credentials = {
  R2_ACCOUNT_ID: 'conta',
  R2_ACCESS_KEY_ID: 'chave',
  R2_SECRET_ACCESS_KEY: 'segredo',
  R2_PRIVATE_BUCKET_NAME: 'bucket-privado',
};

describe('createR2Storage', () => {
  it('sem os DOIS buckets, a mídia fica desligada', () => {
    const { bucket } = fakeBucket();
    expect(createR2Storage({} as unknown as Env)).toBeUndefined();
    expect(createR2Storage({ MEDIA_PRIVATE: bucket } as unknown as Env)).toBeUndefined();
    expect(createR2Storage({ MEDIA_PUBLIC: bucket } as unknown as Env)).toBeUndefined();
  });

  it('só com os bindings: ler, gravar e apagar funcionam; o PUT pré-assinado do navegador NÃO (503)', async () => {
    const privateBucket = fakeBucket();
    const storage = createR2Storage({
      MEDIA_PRIVATE: privateBucket.bucket,
      MEDIA_PUBLIC: fakeBucket().bucket,
    } as unknown as Env)!;
    expect(storage).toBeDefined();
    const bytes = new TextEncoder().encode('%PDF-1.7 exemplo');
    await storage.put('private', 'certificates/a.pdf', bytes, 'application/pdf');
    expect(privateBucket.objects.get('certificates/a.pdf')?.contentType).toBe('application/pdf');
    expect(await storage.head('private', 'certificates/a.pdf')).toEqual({ size: bytes.byteLength });
    expect(new TextDecoder().decode((await storage.read('private', 'certificates/a.pdf'))!)).toBe(
      '%PDF-1.7 exemplo',
    );
    expect(await storage.read('private', 'nao-existe')).toBeNull();
    await storage.delete('private', 'certificates/a.pdf');
    expect(await storage.read('private', 'certificates/a.pdf')).toBeNull();
    expect(() => storage.presignPut('m/abc', 'image/png', 300)).toThrow(MediaNotConfiguredError);
  });

  it('com as credenciais, o PUT pré-assinado sai (endereço da conta, sem o segredo)', async () => {
    const storage = createR2Storage({
      MEDIA_PRIVATE: fakeBucket().bucket,
      MEDIA_PUBLIC: fakeBucket().bucket,
      ...credentials,
    } as unknown as Env)!;
    const url = await storage.presignPut('m/abc', 'image/png', 300);
    expect(url).toContain('conta.r2.cloudflarestorage.com/bucket-privado/m/abc');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).not.toContain('segredo');
  });
});

describe('certificateDeps (o renderer do ambiente)', () => {
  const browser = { quickAction: async () => new Response('x') };

  it('só existe com o Browser Run E o R2: faltando um deles, o certificado vai a failed com código claro', () => {
    const buckets = { MEDIA_PRIVATE: fakeBucket().bucket, MEDIA_PUBLIC: fakeBucket().bucket };
    expect(
      certificateDeps({ APP_BASE_URL: 'https://x.example' } as unknown as Env),
    ).toBeUndefined();
    expect(
      certificateDeps({ APP_BASE_URL: 'https://x.example', BROWSER: browser } as unknown as Env),
    ).toBeUndefined();
    expect(
      certificateDeps({ APP_BASE_URL: 'https://x.example', ...buckets } as unknown as Env),
    ).toBeUndefined();
    const deps = certificateDeps({
      APP_BASE_URL: 'https://x.example',
      BROWSER: browser,
      ...buckets,
    } as unknown as Env);
    expect(deps?.renderer).toBeDefined();
  });
});
