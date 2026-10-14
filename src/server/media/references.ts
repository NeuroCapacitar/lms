import { and, eq, sql } from 'drizzle-orm';

import { mediaAsset, mediaReference } from '../../db/schema';
import type { MediaPurpose } from '../../features/media/media';
import type { DomainTx } from '../async/outbox-store';

/**
 * Referências de mídia (M5-07), SEPARADAS do armazém de mídia para quem muda um ponteiro (o currículo) importar
 * só isto, sem puxar a autorização de aula e formar ciclo.
 */
/** Referenciar mídia que não está `ready`. */
export class MediaNotReadyError extends Error {
  constructor() {
    super('media_not_ready');
  }
}

/** A mídia é de outro propósito (uma capa no lugar do banner, um PDF como capa...). */
export class MediaPurposeMismatchError extends Error {
  constructor() {
    super('media_purpose_mismatch');
  }
}

/** Capa ou banner ainda não copiado para o bucket público: o ponteiro público não pode apontar para ele. */
export class MediaNotPublishedError extends Error {
  constructor() {
    super('media_not_published');
  }
}

/**
 * Faz (ou tira) a referência de um dono a uma mídia, NA transação que muda o ponteiro. Trava o asset
 * (`FOR UPDATE`): a limpeza do órfão trava o mesmo asset, então "passar a usar" e "apagar" nunca se
 * cruzam. Confere: `ready`, do propósito certo e (ponteiro público) já copiado para o bucket público.
 * `mediaId = null` só remove a referência do espaço.
 */
export async function setReferenceIn(
  tx: DomainTx,
  input: {
    ownerType:
      | 'course_draft'
      | 'course_content'
      | 'lesson'
      | 'panel_banner'
      | 'login_media'
      | 'certificate_signatory';
    ownerId: string;
    slot: string;
    mediaId: string | null;
    purpose?: MediaPurpose;
    requirePublished?: boolean;
  },
): Promise<void> {
  if (input.mediaId === null) {
    await tx
      .delete(mediaReference)
      .where(
        and(
          eq(mediaReference.ownerType, input.ownerType),
          eq(mediaReference.ownerId, input.ownerId),
          eq(mediaReference.slot, input.slot),
        ),
      );
    return;
  }
  const [asset] = await tx
    .select()
    .from(mediaAsset)
    .where(eq(mediaAsset.id, input.mediaId))
    .for('update');
  if (!asset || asset.state !== 'ready') throw new MediaNotReadyError();
  if (input.purpose && asset.purpose !== input.purpose) throw new MediaPurposeMismatchError();
  if (input.requirePublished && !asset.publicKey) throw new MediaNotPublishedError();
  await tx
    .insert(mediaReference)
    .values({
      mediaId: input.mediaId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      slot: input.slot,
    })
    .onConflictDoUpdate({
      target: [mediaReference.ownerType, mediaReference.ownerId, mediaReference.slot],
      set: { mediaId: input.mediaId, createdAt: sql`now()` },
    });
}
