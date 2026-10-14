import { asc, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { loginMedia, mediaAsset, panelBanner } from '../../db/schema';
import {
  MAX_LOGIN_MEDIA_PUBLISHED,
  isInWindow,
  type BannerState,
  type LoginMediaDto,
  type PanelBannerDto,
  type StaffLoginMediaDto,
  type StaffPanelBannerDto,
} from '../../features/banner/banner';
import { toPublicImage, type ImageVariantName } from '../../features/media/delivery';
import type { DomainTx } from '../async/outbox-store';
import { setReferenceIn } from '../media/references';

/** O banner ou a imagem de login não existe. */
export class BannerNotFoundError extends Error {
  constructor() {
    super('banner_not_found');
  }
}

/** Já há 5 imagens de login publicadas. */
export class TooManyPublishedError extends Error {
  constructor() {
    super('too_many_published');
  }
}

const IMAGE_SLOT = 'image';

type PanelRow = typeof panelBanner.$inferSelect;
type LoginRow = typeof loginMedia.$inferSelect;
type Table = typeof panelBanner | typeof loginMedia;

const toStaffPanel = (row: PanelRow): StaffPanelBannerDto => ({
  id: row.id,
  mediaId: row.mediaId,
  alt: row.alt,
  linkUrl: row.linkUrl,
  startsAt: row.startsAt?.toISOString() ?? null,
  endsAt: row.endsAt?.toISOString() ?? null,
  state: row.state as BannerState,
});

const toStaffLogin = (row: LoginRow): StaffLoginMediaDto => ({
  id: row.id,
  mediaId: row.mediaId,
  state: row.state as BannerState,
});

const tableName = (table: Table) => (table === panelBanner ? 'panel_banner' : 'login_media');

/** Trava a tabela (pequena, editada raramente): numeração, ordem e o teto de 5 imagens ficam exatos. */
async function lock(tx: DomainTx, table: Table): Promise<void> {
  await tx.execute(sql.raw(`lock table ${tableName(table)} in share row exclusive mode`));
}

async function nextPosition(tx: DomainTx, table: Table): Promise<number> {
  const [last] = await tx
    .select({ position: table.position })
    .from(table)
    .orderBy(desc(table.position))
    .limit(1);
  return (last?.position ?? -1) + 1;
}

/** Os banners (Staff): todos, na ordem. */
export async function listPanelBanners(db: Database): Promise<StaffPanelBannerDto[]> {
  const rows = await db
    .select()
    .from(panelBanner)
    .orderBy(asc(panelBanner.position), asc(panelBanner.id));
  return rows.map(toStaffPanel);
}

export async function listLoginMedia(db: Database): Promise<StaffLoginMediaDto[]> {
  const rows = await db
    .select()
    .from(loginMedia)
    .orderBy(asc(loginMedia.position), asc(loginMedia.id));
  return rows.map(toStaffLogin);
}

export async function getPanelBanner(db: Database, id: string): Promise<StaffPanelBannerDto> {
  const [row] = await db.select().from(panelBanner).where(eq(panelBanner.id, id));
  if (!row) throw new BannerNotFoundError();
  return toStaffPanel(row);
}

export async function getLoginMedia(db: Database, id: string): Promise<StaffLoginMediaDto> {
  const [row] = await db.select().from(loginMedia).where(eq(loginMedia.id, id));
  if (!row) throw new BannerNotFoundError();
  return toStaffLogin(row);
}

interface PanelInput {
  mediaId: string;
  alt: string;
  linkUrl?: string | null | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}

const toDate = (value: string | null | undefined) => (value ? new Date(value) : null);

/** Cria o banner como RASCUNHO, no fim da lista. A mídia precisa estar pronta e ser `panel_banner`. */
export async function createPanelBanner(
  db: Database,
  input: PanelInput,
): Promise<StaffPanelBannerDto> {
  return db.transaction(async (tx) => {
    await lock(tx, panelBanner);
    const id = crypto.randomUUID();
    // A referência primeiro: mídia inexistente ou de outro propósito vira erro de domínio, não violação de FK.
    await setReferenceIn(tx, {
      ownerType: 'panel_banner',
      ownerId: id,
      slot: IMAGE_SLOT,
      mediaId: input.mediaId,
      purpose: 'panel_banner',
    });
    const [row] = await tx
      .insert(panelBanner)
      .values({
        id,
        mediaId: input.mediaId,
        alt: input.alt,
        linkUrl: input.linkUrl ?? null,
        startsAt: toDate(input.startsAt),
        endsAt: toDate(input.endsAt),
        position: await nextPosition(tx, panelBanner),
      })
      .returning();
    return toStaffPanel(row!);
  });
}

/**
 * Edita o banner. Trocar a imagem de um banner PUBLICADO exige a nova já copiada para o bucket público (a rota a
 * publica antes); em rascunho basta estar pronta.
 */
export async function updatePanelBanner(
  db: Database,
  input: PanelInput & { id: string },
): Promise<StaffPanelBannerDto> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(panelBanner)
      .where(eq(panelBanner.id, input.id))
      .for('update');
    if (!current) throw new BannerNotFoundError();
    await setReferenceIn(tx, {
      ownerType: 'panel_banner',
      ownerId: current.id,
      slot: IMAGE_SLOT,
      mediaId: input.mediaId,
      purpose: 'panel_banner',
      requirePublished: current.state === 'published',
    });
    const [row] = await tx
      .update(panelBanner)
      .set({
        mediaId: input.mediaId,
        alt: input.alt,
        linkUrl: input.linkUrl ?? null,
        startsAt: toDate(input.startsAt),
        endsAt: toDate(input.endsAt),
        updatedAt: sql`now()`,
      })
      .where(eq(panelBanner.id, current.id))
      .returning();
    return toStaffPanel(row!);
  });
}

export async function createLoginMedia(
  db: Database,
  input: { mediaId: string },
): Promise<StaffLoginMediaDto> {
  return db.transaction(async (tx) => {
    await lock(tx, loginMedia);
    const id = crypto.randomUUID();
    await setReferenceIn(tx, {
      ownerType: 'login_media',
      ownerId: id,
      slot: IMAGE_SLOT,
      mediaId: input.mediaId,
      purpose: 'login_media',
    });
    const [row] = await tx
      .insert(loginMedia)
      .values({ id, mediaId: input.mediaId, position: await nextPosition(tx, loginMedia) })
      .returning();
    return toStaffLogin(row!);
  });
}

/**
 * Publica ou volta a rascunho. Publicar exige a imagem JÁ copiada para o bucket público (`requirePublished`: a
 * rota a copia antes, fora da transação) e, no login, no máximo 5 publicadas (conferido sob a trava da tabela).
 */
export async function setPanelBannerState(
  db: Database,
  input: { id: string; state: BannerState },
): Promise<StaffPanelBannerDto> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(panelBanner)
      .where(eq(panelBanner.id, input.id))
      .for('update');
    if (!current) throw new BannerNotFoundError();
    if (input.state === 'published') {
      await setReferenceIn(tx, {
        ownerType: 'panel_banner',
        ownerId: current.id,
        slot: IMAGE_SLOT,
        mediaId: current.mediaId,
        purpose: 'panel_banner',
        requirePublished: true,
      });
    }
    const [row] = await tx
      .update(panelBanner)
      .set({ state: input.state, updatedAt: sql`now()` })
      .where(eq(panelBanner.id, current.id))
      .returning();
    return toStaffPanel(row!);
  });
}

export async function setLoginMediaState(
  db: Database,
  input: { id: string; state: BannerState },
): Promise<StaffLoginMediaDto> {
  return db.transaction(async (tx) => {
    await lock(tx, loginMedia);
    const [current] = await tx.select().from(loginMedia).where(eq(loginMedia.id, input.id));
    if (!current) throw new BannerNotFoundError();
    if (input.state === 'published' && current.state !== 'published') {
      const published = await tx
        .select({ id: loginMedia.id })
        .from(loginMedia)
        .where(eq(loginMedia.state, 'published'));
      if (published.length >= MAX_LOGIN_MEDIA_PUBLISHED) throw new TooManyPublishedError();
      await setReferenceIn(tx, {
        ownerType: 'login_media',
        ownerId: current.id,
        slot: IMAGE_SLOT,
        mediaId: current.mediaId,
        purpose: 'login_media',
        requirePublished: true,
      });
    }
    const [row] = await tx
      .update(loginMedia)
      .set({ state: input.state, updatedAt: sql`now()` })
      .where(eq(loginMedia.id, current.id))
      .returning();
    return toStaffLogin(row!);
  });
}

/** Sobe ou desce trocando a posição com o vizinho, sob trava da tabela; renumera 0..n-1. Na ponta, não faz nada. */
async function move(
  db: Database,
  table: Table,
  input: { id: string; direction: 'up' | 'down' },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lock(tx, table);
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .orderBy(asc(table.position), asc(table.id));
    const index = rows.findIndex((row) => row.id === input.id);
    if (index === -1) throw new BannerNotFoundError();
    const otherIndex = input.direction === 'up' ? index - 1 : index + 1;
    if (!rows[otherIndex]) return;
    const ordered = rows.map((row) => row.id);
    [ordered[index], ordered[otherIndex]] = [ordered[otherIndex]!, ordered[index]!];
    for (const [position, id] of ordered.entries()) {
      await tx.update(table).set({ position }).where(eq(table.id, id));
    }
  });
}

export const movePanelBanner = (db: Database, input: { id: string; direction: 'up' | 'down' }) =>
  move(db, panelBanner, input);

export const moveLoginMedia = (db: Database, input: { id: string; direction: 'up' | 'down' }) =>
  move(db, loginMedia, input);

/** Exclui e solta a referência da mídia (a limpeza do M5-07 apaga o órfão depois da carência). */
export async function deletePanelBanner(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(panelBanner)
      .where(eq(panelBanner.id, id))
      .returning({ id: panelBanner.id });
    if (deleted.length === 0) throw new BannerNotFoundError();
    await setReferenceIn(tx, {
      ownerType: 'panel_banner',
      ownerId: id,
      slot: IMAGE_SLOT,
      mediaId: null,
    });
  });
}

export async function deleteLoginMedia(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(loginMedia)
      .where(eq(loginMedia.id, id))
      .returning({ id: loginMedia.id });
    if (deleted.length === 0) throw new BannerNotFoundError();
    await setReferenceIn(tx, {
      ownerType: 'login_media',
      ownerId: id,
      slot: IMAGE_SLOT,
      mediaId: null,
    });
  });
}

/** Imagem pública pronta: só mídia `ready` já copiada para o bucket público; senão, `null` (o item não aparece). */
function imageOf(
  asset: typeof mediaAsset.$inferSelect,
  baseUrl: string | undefined,
  variant: ImageVariantName,
) {
  if (!baseUrl) return null;
  if (asset.state !== 'ready' || !asset.publicKey || !asset.width || !asset.height) return null;
  return toPublicImage({
    baseUrl,
    publicKey: asset.publicKey,
    variant,
    width: asset.width,
    height: asset.height,
  });
}

/** O que quem está logado vê: publicados, dentro da janela, com imagem pública pronta, na ordem. */
export async function listActivePanelBanners(
  db: Database,
  options: { baseUrl: string | undefined; now?: Date },
): Promise<PanelBannerDto[]> {
  const now = options.now ?? new Date();
  const rows = await db
    .select({ banner: panelBanner, asset: mediaAsset })
    .from(panelBanner)
    .innerJoin(mediaAsset, eq(mediaAsset.id, panelBanner.mediaId))
    .where(eq(panelBanner.state, 'published'))
    .orderBy(asc(panelBanner.position), asc(panelBanner.id));
  const banners: PanelBannerDto[] = [];
  for (const { banner, asset } of rows) {
    if (!isInWindow(banner, now)) continue;
    const image = imageOf(asset, options.baseUrl, 'banner_wide');
    if (image) banners.push({ id: banner.id, image, alt: banner.alt, linkUrl: banner.linkUrl });
  }
  return banners;
}

/** As imagens decorativas do login (público, sem sessão): publicadas, com imagem pública pronta. */
export async function listPublishedLoginMedia(
  db: Database,
  options: { baseUrl: string | undefined },
): Promise<LoginMediaDto[]> {
  const rows = await db
    .select({ item: loginMedia, asset: mediaAsset })
    .from(loginMedia)
    .innerJoin(mediaAsset, eq(mediaAsset.id, loginMedia.mediaId))
    .where(eq(loginMedia.state, 'published'))
    .orderBy(asc(loginMedia.position), asc(loginMedia.id));
  const items: LoginMediaDto[] = [];
  for (const { item, asset } of rows) {
    const image = imageOf(asset, options.baseUrl, 'login_side');
    if (image) items.push({ id: item.id, image });
  }
  return items;
}
