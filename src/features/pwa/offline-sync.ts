import { z } from 'zod';

/**
 * Contrato do outbox offline (M8-03). Há UM comando na allowlist: concluir aula de TEXTO. Qualquer outro (quiz, vídeo, o que vier)
 * é recusado item a item pelo servidor; não existe fila genérica de requisições. A pessoa NUNCA vem do corpo: é a da sessão (o
 * `expectedUserId` só serve de TRAVA: se a sessão for de outra pessoa, nada é aplicado).
 */
const OFFLINE_COMMANDS = ['lesson.complete'] as const;
export type OfflineCommand = (typeof OFFLINE_COMMANDS)[number];

/** Tamanho máximo de um lote por chamada. */
export const MAX_SYNC_BATCH = 50;

/**
 * Os esquemas são construídos SOB DEMANDA, nunca no carregamento do módulo. No navegador a CSP não permite eval e o Zod 4 sonda
 * `new Function` ao CRIAR um objeto se o JIT ainda estiver ligado; `web/zod-config.ts` o desliga, mas um esquema criado no
 * carregamento de um módulo que o empacotador junta ao chunk do Zod nasceria ANTES dessa configuração (violação de CSP em toda tela).
 */
function build() {
  /** O comando como o cliente guarda e envia. Chaves desconhecidas (ex.: `userId`) são DESCARTADAS na leitura, nunca usadas. */
  const operation = z.object({
    clientOperationId: z.uuid(),
    command: z.literal('lesson.complete'),
    lessonId: z.uuid(),
    /** Hora do aparelho: só metadado. A hora do fato é a do servidor. */
    clientCreatedAt: z.iso.datetime().optional(),
  });

  /** Corpo de `POST /api/offline/sync`. Cada item é validado sozinho (um item ruim não derruba os outros). */
  const request = z.object({
    expectedUserId: z.string().min(1).max(128).optional(),
    operations: z.array(z.unknown()).min(1).max(MAX_SYNC_BATCH),
  });

  const rejectionReason = z.enum([
    'invalid_payload',
    'command_not_allowed',
    'lesson_not_found',
    'lesson_locked',
    'access_no_access',
    'access_expired',
    'access_suspended',
  ]);

  const resultBase = { index: z.number().int().min(0), clientOperationId: z.string().nullable() };

  /** O resultado de UM item do lote. `duplicate`: o mesmo id já foi processado antes e o resultado original vale. */
  const result = z.discriminatedUnion('status', [
    z.object({
      ...resultBase,
      status: z.literal('applied'),
      effect: z.enum(['completed', 'already_completed']),
      courseJustCompleted: z.boolean(),
    }),
    z.object({
      ...resultBase,
      status: z.literal('duplicate'),
      original: z.enum(['applied', 'rejected']),
      reason: rejectionReason.optional(),
    }),
    z.object({ ...resultBase, status: z.literal('rejected'), reason: rejectionReason }),
  ]);

  /** Resposta de `POST /api/offline/sync`: um resultado por item, na ordem enviada. */
  const response = z.object({ results: z.array(result).max(MAX_SYNC_BATCH) });

  return { operation, request, rejectionReason, result, response };
}

type Schemas = ReturnType<typeof build>;
let schemas: Schemas | undefined;
const lazy = (): Schemas => (schemas ??= build());

export const offlineOperationSchema = () => lazy().operation;
export const syncRequestSchema = () => lazy().request;
export const syncResponseSchema = () => lazy().response;

export type OfflineOperation = z.infer<Schemas['operation']>;
export type RejectionReason = z.infer<Schemas['rejectionReason']>;
export type SyncResultItem = z.infer<Schemas['result']>;

/** O mesmo texto para as telas: por que o comando foi recusado. */
export const REJECTION_MESSAGES: Record<RejectionReason, string> = {
  invalid_payload: 'O registro guardado está inválido.',
  command_not_allowed: 'Esta ação não pode ser feita sem conexão.',
  lesson_not_found: 'A aula não existe mais (ou não é uma aula de texto).',
  lesson_locked: 'A aula ainda não estava liberada para você.',
  access_no_access: 'Você não tem mais acesso a este curso.',
  access_expired: 'O seu acesso a este curso terminou.',
  access_suspended: 'O seu acesso a este curso está suspenso.',
};
