import { describe, expect, it } from 'vitest';

import { ENVIRONMENTS } from './environments.ts';
import { resolveSeedTarget } from './seed-demo-core.ts';

const url = (host: string, database = 'neondb') => `postgresql://u:p@${host}/${database}`;

describe('trava do seed demonstrativo (M2-07)', () => {
  it('aceita dev e staging com o host aprovado', () => {
    for (const name of ['dev', 'staging'] as const) {
      const target = resolveSeedTarget(name, url(ENVIRONMENTS[name].databaseHost));
      expect(target.environment).toBe(name);
      expect(target.url.hostname).toBe(ENVIRONMENTS[name].databaseHost);
    }
  });

  it('recusa production pelo nome do ambiente, mesmo com o host certo', () => {
    expect(() =>
      resolveSeedTarget('production', url(ENVIRONMENTS.production.databaseHost)),
    ).toThrow(/Production recusada/);
  });

  it('recusa o host de Production quando o ambiente pedido é dev ou staging', () => {
    for (const name of ['dev', 'staging']) {
      expect(() => resolveSeedTarget(name, url(ENVIRONMENTS.production.databaseHost))).toThrow(
        /host do banco/,
      );
    }
  });

  it('recusa endpoint com pooler, ambiente desconhecido e banco que lembra produção', () => {
    expect(() =>
      resolveSeedTarget('dev', url(ENVIRONMENTS.dev.databaseHost.replace('ep-', 'ep-x-pooler-'))),
    ).toThrow();
    expect(() => resolveSeedTarget('prod', url(ENVIRONMENTS.dev.databaseHost))).toThrow(
      /desconhecido/,
    );
    expect(() =>
      resolveSeedTarget('dev', url(ENVIRONMENTS.dev.databaseHost, 'hub_production')),
    ).toThrow(/lembra Production/);
  });

  it('recusa sem a URL de conexão', () => {
    expect(() => resolveSeedTarget('dev', undefined)).toThrow(/DATABASE_URL_MIGRATION/);
  });
});
