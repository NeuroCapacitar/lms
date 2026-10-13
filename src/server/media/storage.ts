/**
 * Porta do armazenamento de mídia (M5-07). A regra de negócio (intenção, confirmação, publicação, referências,
 * limpeza, autorização) fala só com esta interface; o R2 de verdade (`r2-storage.ts`) e a versão em memória dos
 * testes (`memory-storage.ts`) a implementam. Chamadas aqui NUNCA acontecem dentro de transação PG.
 */
export type Bucket = 'private' | 'public';

export interface ObjectStorage {
  /** Existe? Devolve o tamanho (a base da primeira conferência da confirmação). */
  head(bucket: Bucket, key: string): Promise<{ size: number } | null>;
  /** O objeto inteiro (até 20 MiB), para conferir os bytes e calcular o SHA-256. */
  read(bucket: Bucket, key: string): Promise<Uint8Array | null>;
  /** Abre o objeto para ENTREGA (download autorizado): corpo em fluxo e o tamanho. */
  open(
    bucket: Bucket,
    key: string,
  ): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Apagar um objeto que já não existe não é erro (a limpeza é repetível). */
  delete(bucket: Bucket, key: string): Promise<void>;
  /** PUT pré-assinado e curto para o master no bucket PRIVADO; assina o `Content-Type`. */
  presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string>;
}

/** Faltam os bindings ou as credenciais do R2 neste ambiente (a mídia fica desligada, 503). */
export class MediaNotConfiguredError extends Error {
  constructor() {
    super('media_not_configured');
  }
}
