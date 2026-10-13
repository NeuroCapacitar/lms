import type { Database } from '../../db/client';
import type { IntentKind, IntentPayload } from '../../features/async/intents';

/** Falha que vale tentar de novo (provider fora do ar, timeout): volta à fila com atraso. */
export class TransientError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Falha que não adianta repetir (dado inválido, recusa definitiva): `failed`, à espera de decisão humana. */
export class PermanentError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export interface HandlerContext<Kind extends IntentKind> {
  db: Database;
  /** Payload JÁ validado contra o contrato do `kind` (só IDs). */
  payload: IntentPayload<Kind>;
  intentId: string;
  correlationId: string;
  /** Base estável para a chave de idempotência de chamadas a provider (é a `dedupeKey` da intenção). */
  idempotencyKey: string;
  /** Quantas vezes esta intenção foi reivindicada (1 = primeira). */
  attempt: number;
}

type Handler<Kind extends IntentKind> = (context: HandlerContext<Kind>) => Promise<void>;

/** Um handler por `kind`: o tipo obriga a registrar todos (kind novo sem handler não compila). */
export type HandlerRegistry = { [Kind in IntentKind]: Handler<Kind> };

/**
 * Handlers de produção. O `system.demo` não tem efeito externo (existe para provar o fluxo); os reais
 * entram com o e-mail (M4-05), o financeiro (M6) e o certificado (M7). Regras de todo handler: efeitos
 * externos NUNCA dentro de transação PG; idempotente (a entrega é at-least-once); lança `TransientError`
 * ou `PermanentError`.
 */
export const HANDLERS: HandlerRegistry = {
  'system.demo': async () => {},
};
