import { z } from 'zod';

import { INTENT_KINDS, isIntentKind, type IntentKind, type QueueName } from './intents';

/**
 * Envelope da mensagem de Queue (M4-02): só o necessário para achar a intenção no Postgres. NUNCA leva
 * e-mail, nome, token nem segredo (o payload da intenção fica no banco). É versionado: uma versão ou um
 * `kind` desconhecido NÃO é ignorado em silêncio, vai para a DLQ com alerta.
 */
export const ENVELOPE_VERSION = 1;

const envelopeSchema = z.strictObject({
  v: z.literal(ENVELOPE_VERSION),
  kind: z.string().min(1).max(100),
  intentId: z.uuid(),
  correlationId: z.string().min(1).max(100),
});

export interface Envelope {
  v: typeof ENVELOPE_VERSION;
  kind: IntentKind;
  intentId: string;
  correlationId: string;
}

type EnvelopeProblem = 'invalid_shape' | 'unknown_version' | 'unknown_kind';

export type ParsedEnvelope =
  | { ok: true; envelope: Envelope }
  | {
      ok: false;
      problem: EnvelopeProblem;
      /** Quando dá para achar a intenção mesmo com o envelope ruim (para marcá-la `dead` no banco). */
      intentId?: string;
    };

export function buildEnvelope(input: {
  kind: IntentKind;
  intentId: string;
  correlationId: string;
}): Envelope {
  return { v: ENVELOPE_VERSION, ...input };
}

export function parseEnvelope(body: unknown): ParsedEnvelope {
  const asRecord =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
  const salvageId = z.uuid().safeParse(asRecord?.intentId);
  const intentId = salvageId.success ? salvageId.data : undefined;

  if (asRecord && 'v' in asRecord && asRecord.v !== ENVELOPE_VERSION) {
    return { ok: false, problem: 'unknown_version', intentId };
  }
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) return { ok: false, problem: 'invalid_shape', intentId };
  if (!isIntentKind(parsed.data.kind)) {
    return { ok: false, problem: 'unknown_kind', intentId: parsed.data.intentId };
  }
  return { ok: true, envelope: { ...parsed.data, kind: parsed.data.kind } };
}

export function queueOfKind(kind: IntentKind): QueueName {
  return INTENT_KINDS[kind].queue;
}

export interface QueueLane {
  queue: QueueName;
  /** `true`: é a fila de mensagens mortas (DLQ) desta lane. */
  dlq: boolean;
}

/**
 * Descobre a lane pelo NOME da fila do lote: `hub-finance`, `hub-staging-general-dlq`… Nome fora do
 * padrão devolve `undefined` (configuração errada: o consumidor falha alto, não adivinha).
 */
export function laneOfQueueName(name: string): QueueLane | undefined {
  const match = /(?:^|-)(finance|general)(-dlq)?$/.exec(name);
  if (!match) return undefined;
  return { queue: match[1] as QueueName, dlq: match[2] === '-dlq' };
}
