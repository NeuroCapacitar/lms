import { desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { videoProviderConnection } from '../../db/schema';
import {
  secretRequired,
  type VideoConnectionDto,
  type VideoConnectionStatus,
  type VideoProvider,
} from '../../features/video/providers';
import { auditEvent } from '../auth/access-store';
import {
  DecryptionError,
  UnknownKeyVersionError,
  openSecret,
  sealSecret,
  type Keyring,
} from '../security/secret-box';

/** O provider exige o segredo da conta (todos menos YouTube e Vimeo públicos). */
export class SecretRequiredError extends Error {
  constructor() {
    super('secret_required');
  }
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super('connection_not_found');
  }
}

/** O cofre de chaves não está configurado neste ambiente (falta o segredo do Worker). */
export class KeyringMissingError extends Error {
  constructor() {
    super('keyring_missing');
  }
}

/** O AAD amarra o texto cifrado à conexão e ao provider: copiado para outra linha, não abre. */
const aadOf = (id: string, provider: string) => `${id}:${provider}`;

const columns = {
  id: videoProviderConnection.id,
  provider: videoProviderConnection.provider,
  label: videoProviderConnection.label,
  status: videoProviderConnection.status,
  ciphertext: videoProviderConnection.ciphertext,
  keyVersion: videoProviderConnection.keyVersion,
  createdAt: videoProviderConnection.createdAt,
  updatedAt: videoProviderConnection.updatedAt,
};

/** Linha → DTO. O texto cifrado NUNCA sai daqui: só "configurado" e a versão da chave. */
function toDto(row: {
  id: string;
  provider: string;
  label: string;
  status: string;
  ciphertext: string | null;
  keyVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}): VideoConnectionDto {
  return {
    id: row.id,
    provider: row.provider as VideoProvider,
    label: row.label,
    status: row.status as VideoConnectionStatus,
    configured: row.ciphertext !== null,
    keyVersion: row.keyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireKeyring(keyring: Keyring | undefined): Keyring {
  if (!keyring) throw new KeyringMissingError();
  return keyring;
}

export async function listConnections(db: Database): Promise<VideoConnectionDto[]> {
  const rows = await db
    .select(columns)
    .from(videoProviderConnection)
    .orderBy(videoProviderConnection.provider, desc(videoProviderConnection.createdAt));
  return rows.map(toDto);
}

/**
 * Cadastra uma conexão. O segredo é cifrado ANTES de gravar (AAD = id + provider) e a auditoria entra na
 * mesma transação, SEM o segredo (só provider, rótulo e a versão da chave). Providers que exigem
 * credencial recusam a conexão sem segredo.
 */
export async function createConnection(
  db: Database,
  keyring: Keyring | undefined,
  input: { provider: VideoProvider; label: string; secret?: string; actorId: string },
): Promise<VideoConnectionDto> {
  if (input.secret === undefined && secretRequired(input.provider)) throw new SecretRequiredError();
  const id = crypto.randomUUID();
  const sealed =
    input.secret === undefined
      ? undefined
      : await sealSecret(requireKeyring(keyring), input.secret, aadOf(id, input.provider));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(videoProviderConnection)
      .values({
        id,
        provider: input.provider,
        label: input.label,
        ciphertext: sealed?.ciphertext ?? null,
        nonce: sealed?.nonce ?? null,
        keyVersion: sealed?.keyVersion ?? null,
        createdBy: input.actorId,
      })
      .returning(columns);
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'video.connection_create',
      targetType: 'video_provider_connection',
      targetId: id,
      details: {
        provider: input.provider,
        label: input.label,
        keyVersion: sealed?.keyVersion ?? null,
      },
    });
    return toDto(row!);
  });
}

/**
 * Rotação: o novo segredo é cifrado de novo (nonce novo, chave corrente). Os `VideoAsset` e o progresso
 * existentes NÃO mudam (a conexão é a mesma linha).
 */
export async function rotateSecret(
  db: Database,
  keyring: Keyring | undefined,
  input: { id: string; secret: string; actorId: string },
): Promise<VideoConnectionDto> {
  const [current] = await db
    .select({ provider: videoProviderConnection.provider })
    .from(videoProviderConnection)
    .where(eq(videoProviderConnection.id, input.id));
  if (!current) throw new ConnectionNotFoundError();
  const sealed = await sealSecret(
    requireKeyring(keyring),
    input.secret,
    aadOf(input.id, current.provider),
  );
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(videoProviderConnection)
      .set({
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        keyVersion: sealed.keyVersion,
        updatedAt: sql`now()`,
      })
      .where(eq(videoProviderConnection.id, input.id))
      .returning(columns);
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'video.secret_rotate',
      targetType: 'video_provider_connection',
      targetId: input.id,
      details: { provider: current.provider, keyVersion: sealed.keyVersion },
    });
    return toDto(row!);
  });
}

/** Ativa ou desativa. Desativar NÃO apaga o segredo nem altera assets e histórico de progresso. */
export async function setConnectionStatus(
  db: Database,
  input: { id: string; status: VideoConnectionStatus; actorId: string },
): Promise<VideoConnectionDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(videoProviderConnection)
      .set({ status: input.status, updatedAt: sql`now()` })
      .where(eq(videoProviderConnection.id, input.id))
      .returning(columns);
    if (!row) throw new ConnectionNotFoundError();
    await auditEvent(tx, {
      actorId: input.actorId,
      action: input.status === 'disabled' ? 'video.connection_disable' : 'video.connection_enable',
      targetType: 'video_provider_connection',
      targetId: input.id,
      details: { provider: row.provider },
    });
    return toDto(row);
  });
}

export interface RekeyResult {
  rekeyed: number;
  alreadyCurrent: number;
  /** Conexões que NÃO abriram (versão de chave ausente ou texto adulterado): ficam como estão, para revisão. */
  failed: number;
}

/**
 * Recifra com a chave CORRENTE todo segredo gravado com uma versão antiga (job de rotação da chave mestra,
 * sem downtime: as chaves antigas continuam no cofre até a recifragem terminar). Cada linha é trocada só se
 * ainda estiver na versão lida (otimista): uma rotação de segredo concorrente nunca é sobrescrita.
 */
export async function rekeyAll(
  db: Database,
  keyring: Keyring,
  actorId: string,
): Promise<RekeyResult> {
  const rows = await db
    .select({
      id: videoProviderConnection.id,
      provider: videoProviderConnection.provider,
      ciphertext: videoProviderConnection.ciphertext,
      nonce: videoProviderConnection.nonce,
      keyVersion: videoProviderConnection.keyVersion,
    })
    .from(videoProviderConnection);
  const result: RekeyResult = { rekeyed: 0, alreadyCurrent: 0, failed: 0 };
  for (const row of rows) {
    if (row.ciphertext === null || row.nonce === null || row.keyVersion === null) continue;
    if (row.keyVersion === keyring.currentVersion) {
      result.alreadyCurrent += 1;
      continue;
    }
    try {
      const aad = aadOf(row.id, row.provider);
      const plain = await openSecret(
        keyring,
        { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.keyVersion },
        aad,
      );
      const sealed = await sealSecret(keyring, plain, aad);
      const updated = await db
        .update(videoProviderConnection)
        .set({
          ciphertext: sealed.ciphertext,
          nonce: sealed.nonce,
          keyVersion: sealed.keyVersion,
          updatedAt: sql`now()`,
        })
        .where(
          sql`${videoProviderConnection.id} = ${row.id} and ${videoProviderConnection.keyVersion} = ${row.keyVersion}`,
        )
        .returning({ id: videoProviderConnection.id });
      if (updated.length === 1) result.rekeyed += 1;
    } catch (error) {
      if (error instanceof UnknownKeyVersionError || error instanceof DecryptionError) {
        result.failed += 1;
        continue;
      }
      throw error;
    }
  }
  await db.transaction((tx) =>
    auditEvent(tx, {
      actorId,
      action: 'video.rekey',
      targetType: 'video_provider_connection',
      targetId: 'all',
      details: { ...result, toVersion: keyring.currentVersion },
    }),
  );
  return result;
}

/**
 * Lê o segredo EM CLARO, só no servidor, para falar com o provider (adapters, M5-08 em diante). Nunca
 * exportada para rota nem DTO. Conexão desativada não entrega o segredo.
 */
export async function readConnectionSecret(
  db: Database,
  keyring: Keyring,
  id: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({
      provider: videoProviderConnection.provider,
      ciphertext: videoProviderConnection.ciphertext,
      nonce: videoProviderConnection.nonce,
      keyVersion: videoProviderConnection.keyVersion,
      status: videoProviderConnection.status,
    })
    .from(videoProviderConnection)
    .where(eq(videoProviderConnection.id, id));
  if (!row) throw new ConnectionNotFoundError();
  if (row.status !== 'active') return undefined;
  if (row.ciphertext === null || row.nonce === null || row.keyVersion === null) return undefined;
  return openSecret(
    keyring,
    { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.keyVersion },
    aadOf(id, row.provider),
  );
}
