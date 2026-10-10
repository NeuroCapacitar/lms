/**
 * Coleta mínima do SDK do Sentry 11 (ADR 0028). No Sentry 11 o padrão é coletar TUDO (cookies,
 * cabeçalhos, corpos, query string, variáveis das pilhas) e `sendDefaultPii` não existe mais:
 * tudo é desligado aqui, e o `beforeSend` (scrub.ts) continua como segunda barreira.
 */
export const MINIMAL_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
