import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExpectedEnvironment } from './environments.ts';
import { checkArtifact } from './preflight-core.ts';
import { runPreflight } from './preflight.ts';

// IDs FICTÍCIOS: o teste não depende de nenhum recurso real.
const STAGING_HD = 'staging-hyperdrive-fake-0001';
const PRODUCTION_HD = 'production-hyperdrive-fake-0002';

const staging: ExpectedEnvironment = {
  cloudflareEnv: 'staging',
  workerName: 'hub-staging',
  resources: { hyperdrive: [STAGING_HD] },
  vars: [],
  databaseHost: 'fake-host.example',
};

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    targetEnvironment: 'staging',
    name: 'hub-staging',
    definedEnvironments: ['staging', 'production'],
    compatibility_flags: ['nodejs_compat'],
    hyperdrive: [{ binding: 'HYPERDRIVE', id: STAGING_HD }],
    kv_namespaces: [],
    r2_buckets: [],
    queues: { producers: [], consumers: [] },
    vars: {},
    durable_objects: { bindings: [] },
    assets: { directory: '../client' },
    observability: { enabled: true, logs: { invocation_logs: false } },
    preview_urls: false,
    ...overrides,
  };
}

describe('checkArtifact', () => {
  it('aprova o artefato correto de Staging', () => {
    expect(checkArtifact(artifact(), staging, 'staging')).toEqual([]);
  });

  it('rejeita Hyperdrive de Production em artefato de Staging', () => {
    const problems = checkArtifact(
      artifact({ hyperdrive: [{ binding: 'HYPERDRIVE', id: PRODUCTION_HD }] }),
      staging,
      'staging',
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/recurso não permitido.*hyperdrive/);
  });

  it('Version URLs e Preview URLs ligadas (ou sem a chave) são recusadas em Staging e Production, e a desligada passa', () => {
    expect(checkArtifact(artifact({ preview_urls: true }), staging, 'staging').join('\n')).toMatch(
      /preview_urls precisa ser false/,
    );
    const { preview_urls: _omitted, ...without } = artifact();
    expect(checkArtifact(without, staging, 'staging').join('\n')).toMatch(
      /preview_urls precisa ser false/,
    );
    const production: ExpectedEnvironment = {
      ...staging,
      cloudflareEnv: 'production',
      workerName: 'hub-production',
    };
    expect(
      checkArtifact(
        artifact({ name: 'hub-production', targetEnvironment: 'production', preview_urls: true }),
        production,
        'production',
      ).join('\n'),
    ).toMatch(/preview_urls/);
    expect(checkArtifact(artifact(), staging, 'staging')).toEqual([]);
  });

  it('rejeita nome de Worker de outro ambiente', () => {
    const problems = checkArtifact(artifact({ name: 'hub-production' }), staging, 'staging');
    expect(problems.join('\n')).toMatch(/nome do Worker/);
  });

  it('rejeita artefato construído para outro ambiente ou sem ambiente', () => {
    expect(
      checkArtifact(artifact({ targetEnvironment: 'production' }), staging, 'staging').join('\n'),
    ).toMatch(/ambiente do artefato/);
    expect(
      checkArtifact(artifact({ targetEnvironment: undefined }), staging, 'staging').join('\n'),
    ).toMatch(/ambiente do artefato/);
  });

  it('rejeita recurso de categoria sem previsão na tabela (R2, filas)', () => {
    const r2 = checkArtifact(
      artifact({ r2_buckets: [{ binding: 'MEDIA', bucket_name: 'hub-prod-media' }] }),
      staging,
      'staging',
    );
    expect(r2.join('\n')).toMatch(/r2_buckets/);
    const queue = checkArtifact(
      artifact({ queues: { producers: [{ binding: 'Q', queue: 'hub-finance' }], consumers: [] } }),
      staging,
      'staging',
    );
    expect(queue.join('\n')).toMatch(/queue_producers/);
  });

  it('aceita só o cron de reconciliação a cada 30 min (M4-03)', () => {
    const withCron = (crons: unknown) =>
      checkArtifact(artifact({ triggers: { crons } }), staging, 'staging');
    expect(withCron(['*/30 * * * *'])).toEqual([]);
    expect(withCron(['*/5 * * * *']).join('\n')).toMatch(/cron não permitido/);
    expect(withCron(['*/30 * * * *', '* * * * *']).join('\n')).toMatch(/cron não permitido/);
    expect(withCron([42]).join('\n')).toMatch(/cron não permitido/);
  });

  it('rejeita binding de categoria desconhecida e variáveis não previstas', () => {
    expect(
      checkArtifact(
        artifact({ ai: { binding: 'AI' }, ai_search: [{ name: 'x' }] }),
        staging,
        'staging',
      ).join('\n'),
    ).toMatch(/binding não previsto/);
    expect(
      checkArtifact(artifact({ vars: { API_URL: 'x' } }), staging, 'staging').join('\n'),
    ).toMatch(/variável não permitida/);
  });

  it('REVOKED_PDF_RETENTION_DAYS (M7-05): vazio (purga desligada) e dias inteiros passam; qualquer outra coisa não vai para o ar', () => {
    const allowed: ExpectedEnvironment = { ...staging, vars: ['REVOKED_PDF_RETENTION_DAYS'] };
    const withDays = (value: string) =>
      checkArtifact(artifact({ vars: { REVOKED_PDF_RETENTION_DAYS: value } }), allowed, 'staging');
    for (const ok of ['', '90', ' 90 ']) expect(withDays(ok)).toEqual([]);
    for (const bad of ['abc', '90 dias', '-1', '9.5', '12345']) {
      expect(withDays(bad).join(' | '), bad).toMatch(/REVOKED_PDF_RETENTION_DAYS inválida/);
    }
  });

  it('rejeita APP_BASE_URL com http, localhost, curinga ou caminho em ambiente publicado', () => {
    const allowed: ExpectedEnvironment = { ...staging, vars: ['APP_BASE_URL'] };
    const withUrl = (url: string) =>
      checkArtifact(artifact({ vars: { APP_BASE_URL: url } }), allowed, 'staging');
    expect(withUrl('https://hub-staging.example.dev')).toEqual([]);
    for (const bad of [
      'http://hub-staging.example.dev',
      'https://localhost:5173',
      'https://*.example.dev',
      'https://a.example.dev/caminho',
    ]) {
      expect(withUrl(bad).join('\n'), bad).toMatch(/APP_BASE_URL inválida/);
    }
  });

  it('rejeita entrada que não é objeto', () => {
    expect(checkArtifact(null, staging, 'staging')).toEqual([
      'artefato inválido: não é um objeto JSON',
    ]);
  });
});

describe('runPreflight (artefato em disco)', () => {
  it('lê dist/<worker>/wrangler.json e rejeita ambiente desconhecido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
    try {
      mkdirSync(join(dir, 'hub'));
      mkdirSync(join(dir, 'client'));
      writeFileSync(
        join(dir, 'hub', 'wrangler.json'),
        JSON.stringify({ targetEnvironment: 'staging', name: 'hub-staging', preview_urls: false }),
      );
      expect(runPreflight('staging', dir)).toEqual([]);
      expect(runPreflight('producao', dir).join('\n')).toMatch(/ambiente desconhecido/);
      expect(runPreflight('production', dir).join('\n')).toMatch(/ambiente do artefato/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('build por ambiente', () => {
  it('scripts/build-env.ts recusa ambiente inválido sem construir', () => {
    for (const bad of ['prod', 'dev', '']) {
      const result = spawnSync(process.execPath, ['scripts/build-env.ts', bad], {
        encoding: 'utf8',
      });
      expect(result.status, `ambiente "${bad}" deveria falhar`).toBe(1);
      expect(result.stderr).toMatch(/ambiente inválido/);
    }
  });
});
