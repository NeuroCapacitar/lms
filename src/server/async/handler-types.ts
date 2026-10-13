import type { Database } from '../../db/client';
import type { IntentKind, IntentPayload } from '../../features/async/intents';

/**
 * Erros tipados e tipos dos handlers (M4-02), SEPARADOS da fábrica de handlers (`handlers.ts`) para que os
 * handlers de cada domínio (e-mail, financeiro, certificado) os importem sem formar ciclo com a fábrica.
 */

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
