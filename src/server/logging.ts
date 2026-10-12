import {
  ACCESS_LINK_PATTERN,
  EMAIL_PATTERN,
  REDACTED,
  SECRET_KEY_PATHS,
} from '../features/observability/patterns';
import { evlog, type EvlogVariables } from 'evlog/hono';
import { initWorkersLogger } from 'evlog/workers';

import { APP_ENV, RELEASE_ID } from './release';

/**
 * Único módulo que conhece o evlog (ADR 0028): trocar a biblioteca é trocar este arquivo.
 * Um wide event por requisição, com redação de e-mail, cookie, token e link de acesso antes
 * de o evento chegar ao console (Workers Logs). Sem corpo, sem cabeçalhos, sem query string.
 */
export type LogVariables = EvlogVariables;

initWorkersLogger({
  env: { service: 'hub', environment: APP_ENV, commitHash: RELEASE_ID },
  redact: {
    paths: [...SECRET_KEY_PATHS],
    // E-mail por padrão próprio: o mascaramento parcial dos `builtins` ainda é dado pessoal.
    // Sem `creditCard`, `phone` e `iban`: eles mascaravam pedaços do id de correlação (um UUID com
    // dígitos em sequência virava "****4806-****9012") e o suporte não achava o id no log. O log não tem
    // corpo, cabeçalho nem query string, então não há telefone nem cartão para proteger; e-mail, token,
    // link de acesso, cookie e segredo continuam redigidos pelos padrões e pelos caminhos abaixo.
    builtins: ['ipv4', 'jwt', 'bearer'],
    patterns: [new RegExp(ACCESS_LINK_PATTERN.source, 'g'), new RegExp(EMAIL_PATTERN.source, 'g')],
    replacement: REDACTED,
  },
});

export const loggingMiddleware = () => evlog();
