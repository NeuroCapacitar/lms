import { presignUrl, uriEncode } from '../../features/media/sigv4';
import type { Bucket, ObjectStorage } from './storage';

/**
 * O R2 de verdade (M5-07): leitura, cópia e exclusão pelos BINDINGS do Worker (sem credenciais, sem rede
 * externa) e o PUT pré-assinado pelo endpoint S3 (`<conta>.r2.cloudflarestorage.com`) com as credenciais do
 * token de API do R2. Devolve `undefined` quando falta qualquer peça: a mídia fica desligada naquele ambiente
 * (503), nunca "meio configurada". NADA aqui foi exercitado contra um R2 real nesta entrega (ver STATUS).
 */
type R2Env = Pick<
  Env,
  | 'MEDIA_PRIVATE'
  | 'MEDIA_PUBLIC'
  | 'R2_ACCOUNT_ID'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_PRIVATE_BUCKET_NAME'
>;

export function createR2Storage(env: R2Env): ObjectStorage | undefined {
  const {
    MEDIA_PRIVATE: privateBucket,
    MEDIA_PUBLIC: publicBucket,
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_PRIVATE_BUCKET_NAME: privateName,
  } = env;
  if (
    !privateBucket ||
    !publicBucket ||
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !privateName
  ) {
    return undefined;
  }
  const bucketOf = (bucket: Bucket) => (bucket === 'private' ? privateBucket : publicBucket);

  return {
    async head(bucket, key) {
      const found = await bucketOf(bucket).head(key);
      return found ? { size: found.size } : null;
    },
    async read(bucket, key) {
      const found = await bucketOf(bucket).get(key);
      return found ? new Uint8Array(await found.arrayBuffer()) : null;
    },
    async open(bucket, key) {
      const found = await bucketOf(bucket).get(key);
      return found ? { body: found.body, size: found.size } : null;
    },
    async put(bucket, key, body, contentType) {
      await bucketOf(bucket).put(key, body, { httpMetadata: { contentType } });
    },
    async delete(bucket, key) {
      await bucketOf(bucket).delete(key);
    },
    presignPut(key, contentType, expiresSeconds) {
      return presignUrl({
        method: 'PUT',
        accessKeyId,
        secretAccessKey,
        region: 'auto',
        service: 's3',
        host: `${accountId}.r2.cloudflarestorage.com`,
        path: `/${uriEncode(privateName)}/${key.split('/').map(uriEncode).join('/')}`,
        signedHeaders: { 'content-type': contentType },
        expiresSeconds,
        now: new Date(),
      });
    },
  };
}
