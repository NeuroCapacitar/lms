import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

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
    ...overrides,
  };
}

describe('checkArtifact', () => {
  it('aprova o artefato correto de Staging', () => {
    assert.deepEqual(checkArtifact(artifact(), staging, 'staging'), []);
  });

  it('rejeita Hyperdrive de Production em artefato de Staging', () => {
    const problems = checkArtifact(
      artifact({ hyperdrive: [{ binding: 'HYPERDRIVE', id: PRODUCTION_HD }] }),
      staging,
      'staging',
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /recurso não permitido.*hyperdrive/);
  });

  it('rejeita nome de Worker de outro ambiente', () => {
    const problems = checkArtifact(artifact({ name: 'hub-production' }), staging, 'staging');
    assert.match(problems.join('\n'), /nome do Worker/);
  });

  it('rejeita artefato construído para outro ambiente ou sem ambiente', () => {
    assert.match(
      checkArtifact(artifact({ targetEnvironment: 'production' }), staging, 'staging').join('\n'),
      /ambiente do artefato/,
    );
    assert.match(
      checkArtifact(artifact({ targetEnvironment: undefined }), staging, 'staging').join('\n'),
      /ambiente do artefato/,
    );
  });

  it('rejeita recurso de categoria sem previsão na tabela (R2, filas)', () => {
    const r2 = checkArtifact(
      artifact({ r2_buckets: [{ binding: 'MEDIA', bucket_name: 'hub-prod-media' }] }),
      staging,
      'staging',
    );
    assert.match(r2.join('\n'), /r2_buckets/);
    const queue = checkArtifact(
      artifact({ queues: { producers: [{ binding: 'Q', queue: 'hub-finance' }], consumers: [] } }),
      staging,
      'staging',
    );
    assert.match(queue.join('\n'), /queue_producers/);
  });

  it('rejeita binding de categoria desconhecida e variáveis não previstas', () => {
    assert.match(
      checkArtifact(
        artifact({ ai: { binding: 'AI' }, ai_search: [{ name: 'x' }] }),
        staging,
        'staging',
      ).join('\n'),
      /binding não previsto/,
    );
    assert.match(
      checkArtifact(artifact({ vars: { API_URL: 'x' } }), staging, 'staging').join('\n'),
      /variável não permitida/,
    );
  });

  it('rejeita entrada que não é objeto', () => {
    assert.deepEqual(checkArtifact(null, staging, 'staging'), [
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
        JSON.stringify({ targetEnvironment: 'staging', name: 'hub-staging' }),
      );
      assert.deepEqual(runPreflight('staging', dir), []);
      assert.match(runPreflight('producao', dir).join('\n'), /ambiente desconhecido/);
      assert.match(runPreflight('production', dir).join('\n'), /ambiente do artefato/);
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
      assert.equal(result.status, 1, `ambiente "${bad}" deveria falhar`);
      assert.match(result.stderr, /ambiente inválido/);
    }
  });
});
