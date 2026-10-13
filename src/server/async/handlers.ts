import { createEmailHandler, type EmailHandlerDeps } from '../email/send-handler';
import { type HandlerRegistry } from './handler-types';

export {
  PermanentError,
  TransientError,
  type HandlerContext,
  type HandlerRegistry,
} from './handler-types';

/** O que os handlers de produção precisam do ambiente (montado em `queue-entry.ts`). */
export interface HandlerDeps {
  email: EmailHandlerDeps;
}

/**
 * Handlers de produção, um por `kind`. O `system.demo` não tem efeito externo (existe para provar o fluxo);
 * os demais entram com o seu marco (e-mail no M4-04, financeiro no M6, certificado no M7). Regras de todo
 * handler: efeitos externos NUNCA dentro de transação PG; idempotente (a entrega é at-least-once); relê o
 * estado do provider antes de repetir; lança `TransientError` ou `PermanentError`.
 */
export function createHandlers(deps: HandlerDeps): HandlerRegistry {
  return {
    'system.demo': async () => {},
    'email.send': createEmailHandler(deps.email),
  };
}
