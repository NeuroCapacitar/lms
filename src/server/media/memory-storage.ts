import type { Bucket, ObjectStorage } from './storage';

/**
 * Armazenamento em MEMÓRIA, só para testes e desenvolvimento sem R2. Simula o que importa à regra de negócio:
 * o "navegador" sobe o objeto com `upload` (o PUT pré-assinado) e o servidor o lê, copia e apaga. NÃO prova o
 * R2 real (cabeçalhos assinados, limites, CORS): isso é o exercício com conta real, registrado à parte.
 */
export interface MemoryStorage extends ObjectStorage {
  /** O que o navegador faria com a URL pré-assinada: grava o objeto na chave do bucket privado. */
  upload(key: string, bytes: Uint8Array, contentType?: string): void;
  has(bucket: Bucket, key: string): boolean;
  keys(bucket: Bucket): string[];
  contentTypeOf(bucket: Bucket, key: string): string | undefined;
  /** Falha injetada: a próxima chamada de `delete` lança (a limpeza deve repetir depois). */
  failNextDelete: boolean;
  presigned: { key: string; contentType: string; expiresSeconds: number }[];
}

export function createMemoryStorage(): MemoryStorage {
  const objects: Record<Bucket, Map<string, { bytes: Uint8Array; contentType: string }>> = {
    private: new Map(),
    public: new Map(),
  };
  const storage: MemoryStorage = {
    failNextDelete: false,
    presigned: [],
    upload(key, bytes, contentType = 'application/octet-stream') {
      objects.private.set(key, { bytes: bytes.slice(), contentType });
    },
    has: (bucket, key) => objects[bucket].has(key),
    keys: (bucket) => [...objects[bucket].keys()],
    contentTypeOf: (bucket, key) => objects[bucket].get(key)?.contentType,
    async head(bucket, key) {
      const found = objects[bucket].get(key);
      return found ? { size: found.bytes.length } : null;
    },
    async read(bucket, key) {
      return objects[bucket].get(key)?.bytes.slice() ?? null;
    },
    async open(bucket, key) {
      const found = objects[bucket].get(key);
      if (!found) return null;
      const bytes = found.bytes.slice();
      return {
        size: bytes.length,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      };
    },
    async put(bucket, key, body, contentType) {
      objects[bucket].set(key, { bytes: body.slice(), contentType });
    },
    async delete(bucket, key) {
      if (storage.failNextDelete) {
        storage.failNextDelete = false;
        throw new Error('storage_unavailable');
      }
      objects[bucket].delete(key);
    },
    async presignPut(key, contentType, expiresSeconds) {
      storage.presigned.push({ key, contentType, expiresSeconds });
      return `https://armazenamento.exemplo.test/${key}?assinatura=teste&expira=${expiresSeconds}`;
    },
  };
  return storage;
}
