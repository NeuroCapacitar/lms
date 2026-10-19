import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ERASURE_POLICY,
  ERASURE_POLICY_APPROVED,
  POLICY_TABLES,
  anonymizedEmail,
  erasureLogFileName,
  isAnonymizedEmail,
  parseErasureLogEntry,
  pendingItems,
} from '../../src/features/privacy/erasure-policy.ts';
import {
  assertCanExecute,
  assertOutsideRepo,
  parseArgs,
  personSelector,
  readLogs,
  requestRef,
  writeLog,
} from '../../scripts/privacy/privacy-core.ts';

describe('argumentos do script de pedidos de privacidade', () => {
  it('lê ambiente, comando, opções com valor e marcas', () => {
    const args = parseArgs([
      'staging',
      'erase',
      '--user',
      'abc',
      '--request-ref',
      'CH-1',
      '--execute',
    ]);
    expect(args.environment).toBe('staging');
    expect(args.command).toBe('erase');
    expect(args.values.get('--user')).toBe('abc');
    expect(args.flags.has('--execute')).toBe(true);
    expect(requestRef(args)).toBe('CH-1');
  });

  it('recusa comando desconhecido, opção desconhecida e opção sem valor', () => {
    expect(() => parseArgs([])).toThrow('uso:');
    expect(() => parseArgs(['staging', 'apagar-tudo'])).toThrow('uso:');
    expect(() => parseArgs(['staging', 'erase', '--tudo'])).toThrow('desconhecida');
    expect(() => parseArgs(['staging', 'erase', '--user'])).toThrow('precisa de um valor');
    expect(() => parseArgs(['staging', 'erase', '--user', '--execute'])).toThrow(
      'precisa de um valor',
    );
  });

  it('a pessoa vem de --user OU de --email (um só); o e-mail é normalizado', () => {
    expect(personSelector(parseArgs(['staging', 'export', '--user', 'u1']))).toEqual({
      by: 'id',
      value: 'u1',
    });
    expect(
      personSelector(parseArgs(['staging', 'export', '--email', ' Ana@Exemplo.TEST '])),
    ).toEqual({
      by: 'email',
      value: 'ana@exemplo.test',
    });
    expect(() => personSelector(parseArgs(['staging', 'export']))).toThrow('um só');
    expect(() =>
      personSelector(parseArgs(['staging', 'export', '--user', 'a', '--email', 'b@c.d'])),
    ).toThrow('um só');
  });

  it('a referência do pedido não aceita espaço nem arroba (não vira lugar de dado pessoal)', () => {
    for (const ref of ['ana@exemplo.test', 'chamado 123', 'a'.repeat(65)])
      expect(() => requestRef(parseArgs(['staging', 'erase', '--request-ref', ref]))).toThrow(
        '--request-ref',
      );
    expect(requestRef(parseArgs(['staging', 'erase']))).toBeNull();
  });
});

describe('travas de execução', () => {
  const run =
    (...argv: string[]) =>
    () =>
      assertCanExecute(parseArgs(argv));

  it('sem --execute tudo é ensaio e nada é recusado', () => {
    expect(run('production', 'erase', '--user', 'a')).not.toThrow();
    expect(run('production', 'reapply', '--log-dir', 'x')).not.toThrow();
  });

  it('excluir exige o registro fora do banco (--log-dir)', () => {
    expect(run('staging', 'erase', '--user', 'a', '--execute')).toThrow('--log-dir');
    expect(run('staging', 'erase', '--user', 'a', '--log-dir', 'x', '--execute')).not.toThrow();
  });

  it('trocar o e-mail exige as DUAS confirmações da Staff', () => {
    expect(run('staging', 'change-email', '--user', 'a', '--execute')).toThrow('--confirmed-old');
    expect(run('staging', 'change-email', '--user', 'a', '--confirmed-old', '--execute')).toThrow(
      '--confirmed-new',
    );
    expect(
      run(
        'staging',
        'change-email',
        '--user',
        'a',
        '--confirmed-old',
        '--confirmed-new',
        '--execute',
      ),
    ).not.toThrow();
  });

  it('em Production, excluir e reaplicar só executam com a política APROVADA (hoje não está)', () => {
    expect(ERASURE_POLICY_APPROVED).toBe(false);
    expect(run('production', 'erase', '--user', 'a', '--log-dir', 'x', '--execute')).toThrow(
      'NÃO foi aprovada',
    );
    expect(run('production', 'reapply', '--log-dir', 'x', '--execute')).toThrow('NÃO foi aprovada');
    // Staging não depende da aprovação (dados sintéticos).
    expect(run('staging', 'reapply', '--log-dir', 'x', '--execute')).not.toThrow();
  });
});

describe('a exportação nunca fica dentro do repositório', () => {
  it('aceita pasta fora do repositório e recusa dentro dele', () => {
    const cwd = join(tmpdir(), 'repo');
    expect(assertOutsideRepo(join(tmpdir(), 'pedidos', 'ch-1.json'), cwd)).toContain('ch-1.json');
    expect(() => assertOutsideRepo(join(cwd, 'saida.json'), cwd)).toThrow('dentro do repositório');
    expect(() => assertOutsideRepo(cwd, cwd)).toThrow('dentro do repositório');
  });
});

describe('política de eliminação', () => {
  it('cada tabela aparece em uma só linha e todo "retém" ou "pendente" diz por quê', () => {
    const seen = new Map<string, number>();
    for (const item of ERASURE_POLICY)
      for (const table of item.tables) seen.set(table, (seen.get(table) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([table]) => table)).toEqual([]);
    expect(POLICY_TABLES.size).toBe(seen.size);
    for (const item of ERASURE_POLICY) {
      expect(item.what.length).toBeGreaterThan(20);
      expect(item.why.length).toBeGreaterThan(10);
    }
  });

  it('o que depende do advogado ou do contador está marcado (e a política NÃO está aprovada)', () => {
    expect(pendingItems().length).toBeGreaterThan(0);
    const financial = ERASURE_POLICY.find((item) => item.tables.includes('payment'));
    expect(financial).toMatchObject({ action: 'retain', pending: 'contador' });
    expect(ERASURE_POLICY_APPROVED).toBe(false);
  });

  it('o e-mail anonimizado é único por pessoa, inválido e reconhecível', () => {
    expect(anonymizedEmail('abc')).toBe('removido+abc@removido.invalid');
    expect(isAnonymizedEmail(anonymizedEmail('abc'))).toBe(true);
    expect(isAnonymizedEmail('ana@exemplo.test')).toBe(false);
    expect(anonymizedEmail('a')).not.toBe(anonymizedEmail('b'));
  });

  it('o runbook da Staff cita todas as tabelas da política (documento e código não divergem)', () => {
    const doc = readFileSync('docs/operations/privacy-requests.md', 'utf8');
    const missing = [...POLICY_TABLES].filter((table) => !doc.includes(`\`${table}\``));
    expect(missing).toEqual([]);
  });
});

describe('registro de eliminações guardado fora do banco', () => {
  const entry = {
    version: 1,
    userId: 'u-1',
    erasedAt: '2026-10-19T12:00:00.000Z',
    policyVersion: '2026-10-19.1',
    requestRef: 'CH-1',
    counts: { sessions: 2, discussionPosts: 1 },
  };

  it('aceita um registro válido e devolve só os campos conhecidos', () => {
    expect(parseErasureLogEntry({ ...entry, extra: 'ignorado' })).toEqual(entry);
    expect(parseErasureLogEntry({ ...entry, requestRef: null })?.requestRef).toBeNull();
  });

  it('recusa versão, data, contagens e referência inválidas', () => {
    for (const bad of [
      null,
      'texto',
      { ...entry, version: 2 },
      { ...entry, userId: '' },
      { ...entry, erasedAt: 'ontem' },
      { ...entry, policyVersion: 1 },
      { ...entry, requestRef: 'ana@exemplo.test' },
      { ...entry, counts: { sessions: -1 } },
      { ...entry, counts: { sessions: 1.5 } },
      { ...entry, counts: null },
    ])
      expect(parseErasureLogEntry(bad), JSON.stringify(bad)).toBeNull();
  });

  it('o nome do arquivo é seguro e único por pessoa e instante', () => {
    const name = erasureLogFileName({ userId: 'a/b c', erasedAt: '2026-10-19T12:00:00.123Z' });
    expect(name).toBe('erasure-2026-10-19T12-00-00-123Z-a_b_c.json');
    expect(name).not.toMatch(/[/\\ :]/);
  });
});

describe('pasta de registros (arquivos fora do banco)', () => {
  const entry = {
    version: 1 as const,
    userId: 'u-1',
    erasedAt: '2026-10-19T12:00:00.000Z',
    policyVersion: '2026-10-19.1',
    requestRef: 'CH-1',
    counts: { sessions: 2 },
  };

  it('grava um arquivo por exclusão, não sobrescreve e lê tudo de volta em ordem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-privacy-log-'));
    try {
      const first = writeLog(dir, entry);
      expect(first).toContain('erasure-2026-10-19T12-00-00-000Z-u-1.json');
      expect(() => writeLog(dir, entry)).toThrow(); // `wx`: nunca sobrescreve um registro
      writeLog(dir, { ...entry, userId: 'u-2', erasedAt: '2026-10-19T13:00:00.000Z' });
      expect(readLogs(dir).map((item) => item.userId)).toEqual(['u-1', 'u-2']);
      expect(readFileSync(first, 'utf8')).not.toMatch(/@|nome|email/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('um arquivo inválido interrompe a leitura (não se reaplica um registro duvidoso)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-privacy-log-'));
    try {
      writeFileSync(join(dir, 'erasure-x.json'), JSON.stringify({ version: 9 }));
      expect(() => readLogs(dir)).toThrow('inválido');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
