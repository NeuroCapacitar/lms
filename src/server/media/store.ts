import { and, asc, count, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { mediaAsset, mediaReference } from '../../db/schema';
import { publicObjectKey } from '../../features/media/delivery';
import {
  MEDIA_PURPOSES,
  MEDIA_RETENTION_HOURS,
  MIME_BY_KIND,
  UPLOAD_URL_SECONDS,
  checkIntent,
  verifyUploadedBytes,
  type ConfirmRejection,
  type IntentRejection,
  type MediaAssetDto,
  type MediaKind,
  type MediaPurpose,
  type UploadIntentDto,
} from '../../features/media/media';
import { MediaNotReadyError, MediaPurposeMismatchError } from './references';
import { checkLessonAccess } from '../learning/learning-store';
import type { ObjectStorage } from './storage';

/** O que foi declarado (intenção) ou enviado (bytes) não serve ao propósito; `reason` diz por quê. */
export class MediaRejectedError extends Error {
  constructor(readonly reason: IntentRejection | ConfirmRejection) {
    super(`media_rejected:${reason}`);
  }
}

/** Mídia inexistente, de outra pessoa ou fora do alcance: sempre a mesma resposta (não revela existência). */
export class MediaNotFoundError extends Error {
  constructor() {
    super('media_not_found');
  }
}

/** O upload pendente passou das 24 h. */
export class MediaExpiredError extends Error {
  constructor() {
    super('media_expired');
  }
}

/** A confirmação chegou antes do objeto (o PUT não aconteceu ou ainda não terminou). */
export class UploadMissingError extends Error {
  constructor() {
    super('upload_missing');
  }
}

/** A mídia não está num estado que permita a operação. */
export class MediaStateError extends Error {
  constructor(readonly state: string) {
    super(`media_state:${state}`);
  }
}

type Row = typeof mediaAsset.$inferSelect;

const toDto = (row: Row): MediaAssetDto => ({
  id: row.id,
  purpose: row.purpose as MediaPurpose,
  state: row.state as MediaAssetDto['state'],
  contentType: row.contentType ?? row.declaredType,
  size: row.size ?? row.declaredSize,
  width: row.width,
  height: row.height,
});

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Cria a intenção de upload (M5-07): confere o que foi DECLARADO (tipo e tamanho cabem no propósito), grava o
 * asset `pending_upload` com chave opaca (`m/<id>`, nunca derivada de nome de arquivo) e devolve o PUT
 * pré-assinado curto, que assina o `Content-Type`. Nada aqui publica: só `confirmUpload` torna `ready`.
 */
export async function createIntent(
  db: Database,
  storage: ObjectStorage,
  input: { userId: string; purpose: MediaPurpose; contentType: string; size: number; now?: Date },
): Promise<UploadIntentDto> {
  const checked = checkIntent(input.purpose, input.contentType, input.size);
  if (!checked.ok) throw new MediaRejectedError(checked.reason);
  const now = input.now ?? new Date();
  const id = crypto.randomUUID();
  const contentType = MIME_BY_KIND[checked.kind];
  await db.insert(mediaAsset).values({
    id,
    purpose: input.purpose,
    visibility: MEDIA_PURPOSES[input.purpose].visibility,
    declaredType: contentType,
    declaredSize: input.size,
    storageKey: `m/${id}`,
    createdBy: input.userId,
    expiresAt: new Date(now.getTime() + MEDIA_RETENTION_HOURS * 3_600_000),
    createdAt: now,
    updatedAt: now,
  });
  const url = await storage.presignPut(`m/${id}`, contentType, UPLOAD_URL_SECONDS);
  return {
    id,
    upload: {
      method: 'PUT',
      url,
      headers: { 'content-type': contentType },
      expiresInSeconds: UPLOAD_URL_SECONDS,
    },
  };
}

/** Rejeita o upload: marca `rejected` com o motivo e apaga o objeto (melhor esforço; a limpeza repete). */
async function reject(
  db: Database,
  storage: ObjectStorage,
  row: Row,
  reason: ConfirmRejection,
  now: Date,
): Promise<never> {
  const [updated] = await db
    .update(mediaAsset)
    .set({ state: 'rejected', rejectedReason: reason, updatedAt: now })
    .where(and(eq(mediaAsset.id, row.id), eq(mediaAsset.state, 'pending_upload')))
    .returning({ id: mediaAsset.id });
  if (updated) {
    try {
      await storage.delete('private', row.storageKey);
      await db
        .update(mediaAsset)
        .set({ storagePurgedAt: now, deletedAt: now })
        .where(eq(mediaAsset.id, row.id));
    } catch {
      // objeto fica; a limpeza apaga depois (estado `rejected` sem purga entra na varredura)
    }
  }
  throw new MediaRejectedError(reason);
}

/**
 * Confirma o upload (M5-07). Só o AUTOR confirma (outra pessoa recebe a mesma resposta de "não existe"). Confere,
 * sobre os bytes de verdade e nesta ordem: o objeto existe (senão `UploadMissingError`, ainda pendente), o
 * tamanho cabe no limite ANTES de ler, o tipo real pela assinatura mágica, o tamanho declarado, as dimensões do
 * cabeçalho (sem decodificar) e a proporção. Só então calcula o SHA-256 e marca `ready`. Repetir é idempotente;
 * duas confirmações simultâneas viram uma só. Reprovado: `rejected`, objeto apagado, `MediaRejectedError`.
 */
export async function confirmUpload(
  db: Database,
  storage: ObjectStorage,
  input: { userId: string; mediaId: string; now?: Date },
): Promise<MediaAssetDto> {
  const now = input.now ?? new Date();
  const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, input.mediaId));
  if (!row || row.createdBy !== input.userId) throw new MediaNotFoundError();
  if (row.state === 'ready') return toDto(row);
  if (row.state !== 'pending_upload') throw new MediaStateError(row.state);
  if (row.expiresAt.getTime() <= now.getTime()) throw new MediaExpiredError();

  const purpose = row.purpose as MediaPurpose;
  const head = await storage.head('private', row.storageKey);
  if (!head) throw new UploadMissingError();
  if (head.size > MEDIA_PURPOSES[purpose].maxBytes) {
    return reject(db, storage, row, 'too_large', now);
  }
  const bytes = await storage.read('private', row.storageKey);
  if (!bytes) throw new UploadMissingError();
  const verified = verifyUploadedBytes({
    purpose,
    declaredType: row.declaredType,
    declaredSize: row.declaredSize,
    bytes,
  });
  if (!verified.ok) return reject(db, storage, row, verified.reason, now);

  const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  const [ready] = await db
    .update(mediaAsset)
    .set({
      state: 'ready',
      contentType: verified.media.contentType,
      size: bytes.length,
      width: verified.media.width,
      height: verified.media.height,
      sha256,
      confirmedAt: now,
      updatedAt: now,
    })
    .where(and(eq(mediaAsset.id, row.id), eq(mediaAsset.state, 'pending_upload')))
    .returning();
  if (ready) return toDto(ready);
  // Outra confirmação ganhou a corrida: devolve o resultado dela.
  const [current] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, row.id));
  if (current?.state === 'ready') return toDto(current);
  throw new MediaStateError(current?.state ?? 'unknown');
}

/**
 * Publica a capa ou o banner: COPIA o master para o bucket público e SÓ DEPOIS grava `public_key` (o ponteiro de
 * quem usa só pode apontar para um objeto que já está lá). Fora de transação (chama o R2); idempotente. Devolve a
 * chave pública. Mídia privada nunca é copiada.
 */
export async function publishPublicMedia(
  db: Database,
  storage: ObjectStorage,
  mediaId: string,
  now: Date = new Date(),
): Promise<string> {
  const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, mediaId));
  if (!row) throw new MediaNotFoundError();
  if (row.state !== 'ready') throw new MediaNotReadyError();
  if (row.visibility !== 'public') throw new MediaPurposeMismatchError();
  if (row.publicKey) return row.publicKey;

  const kind = (Object.entries(MIME_BY_KIND).find(([, mime]) => mime === row.contentType)?.[0] ??
    'jpeg') as MediaKind;
  const key = publicObjectKey(row.id, kind);
  const bytes = await storage.read('private', row.storageKey);
  if (!bytes) throw new UploadMissingError();
  await storage.put('public', key, bytes, row.contentType!);
  await db
    .update(mediaAsset)
    .set({ publicKey: key, publishedAt: now, updatedAt: now })
    .where(and(eq(mediaAsset.id, row.id), isNull(mediaAsset.publicKey)));
  const [current] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, row.id));
  return current!.publicKey!;
}

export interface PrivateDownload {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
  isDocument: boolean;
}

/**
 * Entrega de mídia PRIVADA (M5-07), sempre depois de autorizar: a Staff (`staff.read`) ou quem pode abrir AGORA
 * uma aula que referencia a mídia (acesso, expiração, drip e sequência, a mesma decisão do mapa). Nada de URL
 * assinada reutilizável: o Worker lê do R2 e entrega, então cada requisição reautoriza. Mídia pública não passa
 * por aqui. Quem não pode recebe a mesma resposta de "não existe".
 */
export async function openPrivateMedia(
  db: Database,
  storage: ObjectStorage,
  input: {
    userId: string;
    canStaffRead: boolean;
    /** Só o Admin (`staff.manage`) abre ativo do certificado (assinatura): nunca por acesso a aula nem pelo Suporte. */
    canStaffManage?: boolean;
    mediaId: string;
    now?: Date;
  },
): Promise<PrivateDownload> {
  const [asset] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, input.mediaId));
  if (!asset || asset.state !== 'ready' || asset.visibility !== 'private') {
    throw new MediaNotFoundError();
  }
  if (asset.purpose === 'certificate_asset') {
    if (input.canStaffManage !== true) throw new MediaNotFoundError();
  }
  let allowed = asset.purpose === 'certificate_asset' ? true : input.canStaffRead;
  if (!allowed && asset.purpose !== 'certificate_asset') {
    const lessons = await db
      .select({ lessonId: mediaReference.ownerId })
      .from(mediaReference)
      .where(and(eq(mediaReference.mediaId, asset.id), eq(mediaReference.ownerType, 'lesson')));
    for (const { lessonId } of lessons) {
      const gate = await checkLessonAccess(db, input.userId, lessonId, input.now ?? new Date());
      if (gate.kind === 'ok') {
        allowed = true;
        break;
      }
    }
  }
  if (!allowed) throw new MediaNotFoundError();
  const opened = await storage.open('private', asset.storageKey);
  if (!opened) throw new MediaNotFoundError();
  return {
    body: opened.body,
    size: opened.size,
    contentType: asset.contentType ?? asset.declaredType,
    isDocument: asset.contentType === 'application/pdf',
  };
}

export interface CleanupResult {
  expired: number;
  orphaned: number;
  purged: number;
  failed: number;
}

const LIMIT = 50;

/** Há trabalho de limpeza? (a sonda barata do Cron: sem trabalho o job nem acorda). */
export async function hasMediaWork(db: Database, now: Date = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - MEDIA_RETENTION_HOURS * 3_600_000);
  const [row] = await db
    .execute<{ found: boolean }>(sql`
    select (
      exists (select 1 from media_asset where state = 'pending_upload' and expires_at < ${now})
      or exists (
        select 1 from media_asset a
        where a.state = 'ready' and a.confirmed_at < ${cutoff}
          and not exists (select 1 from media_reference r where r.media_id = a.id)
      )
      or exists (
        select 1 from media_asset where state in ('deleted', 'rejected') and storage_purged_at is null
      )
    ) as found`)
    .then((result) => result.rows);
  return row?.found === true;
}

/**
 * Limpeza (M5-07, job do Cron): (1) upload pendente vencido (>24 h) vira `deleted`; (2) objeto `ready` SEM
 * referência há mais de 24 h vira `deleted`, relendo a contagem de referências SOB TRAVA do asset (uma corrida com
 * `setReferenceIn` nunca apaga o que acabou de ganhar referência); (3) o que ficou `deleted` ou `rejected` sem
 * purga tem os objetos apagados do R2, FORA de transação, e só então marca `storage_purged_at`. Se o R2 falhar,
 * a linha fica para o próximo ciclo (apagar é repetível).
 */
export async function cleanupMedia(
  db: Database,
  storage: ObjectStorage,
  now: Date = new Date(),
): Promise<CleanupResult> {
  const result: CleanupResult = { expired: 0, orphaned: 0, purged: 0, failed: 0 };
  const cutoff = new Date(now.getTime() - MEDIA_RETENTION_HOURS * 3_600_000);

  const expired = await db
    .update(mediaAsset)
    .set({ state: 'deleted', rejectedReason: 'expired', deletedAt: now, updatedAt: now })
    .where(
      inArray(
        mediaAsset.id,
        db
          .select({ id: mediaAsset.id })
          .from(mediaAsset)
          .where(and(eq(mediaAsset.state, 'pending_upload'), lt(mediaAsset.expiresAt, now)))
          .limit(LIMIT),
      ),
    )
    .returning({ id: mediaAsset.id });
  result.expired = expired.length;

  const candidates = await db
    .select({ id: mediaAsset.id })
    .from(mediaAsset)
    .where(
      and(
        eq(mediaAsset.state, 'ready'),
        lt(mediaAsset.confirmedAt, cutoff),
        sql`not exists (select 1 from media_reference r where r.media_id = ${mediaAsset.id})`,
      ),
    )
    .orderBy(asc(mediaAsset.confirmedAt))
    .limit(LIMIT);
  for (const candidate of candidates) {
    const deleted = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: mediaAsset.id, state: mediaAsset.state })
        .from(mediaAsset)
        .where(eq(mediaAsset.id, candidate.id))
        .for('update', { skipLocked: true });
      if (!locked || locked.state !== 'ready') return false;
      // A releitura SOB TRAVA: quem ganhou referência entre a sonda e agora não é apagado.
      const [refs] = await tx
        .select({ total: count() })
        .from(mediaReference)
        .where(eq(mediaReference.mediaId, candidate.id));
      if ((refs?.total ?? 0) > 0) return false;
      await tx
        .update(mediaAsset)
        .set({ state: 'deleted', rejectedReason: 'orphan', deletedAt: now, updatedAt: now })
        .where(eq(mediaAsset.id, candidate.id));
      return true;
    });
    if (deleted) result.orphaned += 1;
  }

  const toPurge = await db
    .select()
    .from(mediaAsset)
    .where(
      and(inArray(mediaAsset.state, ['deleted', 'rejected']), isNull(mediaAsset.storagePurgedAt)),
    )
    .orderBy(asc(mediaAsset.updatedAt))
    .limit(LIMIT);
  for (const row of toPurge) {
    try {
      await storage.delete('private', row.storageKey);
      if (row.publicKey) await storage.delete('public', row.publicKey);
      await db
        .update(mediaAsset)
        .set({ storagePurgedAt: now, deletedAt: row.deletedAt ?? now })
        .where(eq(mediaAsset.id, row.id));
      result.purged += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
