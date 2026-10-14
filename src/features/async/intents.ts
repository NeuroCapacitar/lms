import { z } from 'zod';

/**
 * Contrato das intenções da outbox (M4-01), sem SQL, Hono nem SDK. O payload de uma intenção leva SÓ
 * IDs (UUID): nunca e-mail, nome, token ou segredo. Isso vale POR CONSTRUÇÃO: `intentPayload` só aceita
 * campos UUID e rejeita qualquer campo a mais, então um dado pessoal não passa nem por engano.
 */
export type QueueName = 'finance' | 'general';

const id = z.uuid();

function intentPayload<Shape extends Record<string, typeof id>>(shape: Shape) {
  return z.strictObject(shape);
}

/** Cada `kind` conhecido: a fila e o formato exato do payload. Os `kind` reais entram nos M4-05, M5 e M7. */
export const INTENT_KINDS = {
  /** Handler demonstrativo (M4-02): prova o fluxo claim → handler → conclusão sem efeito externo. */
  'system.demo': { queue: 'general', payload: intentPayload({ subjectId: id }) },
  /** E-mail transacional (M4-04): o payload é só o id da `email_message`; destinatário e variáveis ficam no banco. */
  'email.send': { queue: 'general', payload: intentPayload({ emailMessageId: id }) },
  /** Aviso de abertura de vendas (M5-06): o payload é só o id do ciclo; os interessados vêm do banco, em lotes. */
  'interest.fanout': { queue: 'general', payload: intentPayload({ cycleId: id }) },
  /** Reembolso integral (M6-05): o payload é só o id do `refund_request`; o executor lê o resto do banco e NUNCA reenvia às cegas. */
  'finance.refund': { queue: 'finance', payload: intentPayload({ refundRequestId: id }) },
} as const satisfies Record<string, { queue: QueueName; payload: z.ZodType }>;

export type IntentKind = keyof typeof INTENT_KINDS;

export function isIntentKind(kind: string): kind is IntentKind {
  return Object.hasOwn(INTENT_KINDS, kind);
}

export type IntentPayload<Kind extends IntentKind> = z.infer<
  (typeof INTENT_KINDS)[Kind]['payload']
>;

/** Menor vai primeiro: o link de login nunca espera atrás de e-mail transacional ou de marketing. */
export const PRIORITY = { login: 10, transactional: 100, marketing: 500 } as const;

/** Tentativas antes de a mensagem ir para `dead`. Cada claim conta uma tentativa. */
export const MAX_ATTEMPTS = 8;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60_000;

/**
 * Atraso antes da próxima tentativa: exponencial (30 s, 1 min, 2 min…), com teto de 1 h e "jitter"
 * (sorteia entre metade e o total) para que falhas simultâneas não voltem todas no mesmo instante.
 * `random` é injetável para o teste ser determinístico.
 */
export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.min(attempts, 30) - 1);
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

/** Retenção depois de a linha entrar em estado final (valores do legado; ajustar só com motivo). */
export const RETENTION_DAYS = { done: 30, problem: 180 } as const;

/** Limite do payload bruto da inbox (o banco também confere). */
export const INBOX_PAYLOAD_MAX_BYTES = 65_536;
