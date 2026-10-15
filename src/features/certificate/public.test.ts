import { describe, expect, it } from 'vitest';

import { renderMetaTags } from '../catalog/course-meta';
import {
  PUBLIC_NAME_MODE,
  certificateMeta,
  maskName,
  publicCodeSchema,
  publicStateOf,
  toPublicDto,
} from './public';

const base = {
  status: 'ready' as const,
  courseTitle: 'Curso de Teste',
  workloadHours: 20,
  issuedAt: new Date('2026-10-14T12:00:00.000Z'),
  issuerName: 'Neuro Capacitar LTDA',
  holderName: 'Maria Aparecida de Nazaré Souza',
};

describe('modo do nome', () => {
  it('o padrão é NENHUM nome (decisão pendente do responsável)', () => {
    expect(PUBLIC_NAME_MODE).toBe('none');
    expect('holderName' in toPublicDto(base)!).toBe(false);
  });

  it('none: sem a chave; masked: iniciais; full: o nome', () => {
    expect(toPublicDto(base, 'none')).not.toHaveProperty('holderName');
    expect(toPublicDto(base, 'masked')?.holderName).toBe('Maria A. N. S.');
    expect(toPublicDto(base, 'full')?.holderName).toBe('Maria Aparecida de Nazaré Souza');
  });

  it('a máscara mantém a primeira palavra e só as iniciais das demais, sem as partículas', () => {
    expect(maskName('Ana')).toBe('Ana');
    expect(maskName('  José   da Silva  ')).toBe('José S.');
    expect(maskName('Ana Lima')).toBe('Ana L.');
    expect(maskName('')).toBe('');
  });
});

describe('DTO público fechado', () => {
  it('só tem os campos públicos', () => {
    expect(Object.keys(toPublicDto(base)!).sort()).toEqual([
      'courseTitle',
      'issuedAt',
      'issuerName',
      'state',
      'workloadHours',
    ]);
  });

  it('só os estados emitidos aparecem; fila, geração, falha e aguardando nome são como se não existissem', () => {
    expect(publicStateOf('ready')).toBe('valid');
    expect(publicStateOf('revoked')).toBe('revoked');
    expect(publicStateOf('superseded')).toBe('superseded');
    for (const status of ['queued', 'rendering', 'failed', 'awaiting_name'] as const) {
      expect(publicStateOf(status), status).toBeNull();
      expect(toPublicDto({ ...base, status })).toBeNull();
    }
  });
});

describe('código aceito no caminho', () => {
  it('aceita o código novo (22 caracteres) e o legado PRT-…; recusa o resto', () => {
    for (const good of ['AbCdEfGhIjKlMnOpQrStUv', 'PRT-2024-ABCD-1234']) {
      expect(publicCodeSchema.safeParse(good).success, good).toBe(true);
    }
    for (const bad of [
      '',
      'curto',
      'A'.repeat(23),
      'A'.repeat(21) + '!',
      '../etc/passwd',
      "' or 1=1",
      'PRT-',
      'prt-abcd1234',
    ]) {
      expect(publicCodeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('meta tags', () => {
  const dto = toPublicDto(base)!;

  it('válido: título do estado, canônica do código, noindex, sem nome no modo padrão', () => {
    const meta = certificateMeta('https://hub.example.test', dto, 'AbCdEfGhIjKlMnOpQrStUv');
    expect(meta.noindex).toBe(true);
    expect(meta.title).toBe('Certificado válido | NeuroCapacitar');
    expect(meta.canonical).toBe('https://hub.example.test/certificados/AbCdEfGhIjKlMnOpQrStUv');
    expect(meta.description).toBe(
      'certificado de conclusão do curso Curso de Teste, emitido por Neuro Capacitar LTDA.',
    );
  });

  it('com o modo full o nome entra na descrição; revogado e substituído têm título próprio', () => {
    const full = toPublicDto(base, 'full')!;
    expect(certificateMeta('https://h.example', full, 'x'.repeat(22)).description).toContain(
      'Maria Aparecida de Nazaré Souza:',
    );
    expect(certificateMeta('https://h.example', { ...dto, state: 'revoked' }, 'x').title).toBe(
      'Certificado revogado | NeuroCapacitar',
    );
    expect(certificateMeta('https://h.example', { ...dto, state: 'superseded' }, 'x').title).toBe(
      'Certificado substituído | NeuroCapacitar',
    );
  });

  it('sem certificado: meta GENÉRICA, noindex, canônica da home, sem eco de código', () => {
    const generic = certificateMeta('https://hub.example.test', null, null);
    expect(generic.noindex).toBe(true);
    expect(generic.canonical).toBe('https://hub.example.test/');
    expect(JSON.stringify(generic)).not.toContain('certificados/');
  });

  it('título do curso hostil é ESCAPADO nas tags e a tag robots noindex sai', () => {
    const hostile = toPublicDto({ ...base, courseTitle: '"><script>alert(1)</script>' })!;
    const html = renderMetaTags(
      certificateMeta('https://hub.example.test', hostile, 'x'.repeat(22)),
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('origem que não é http(s) é recusada', () => {
    expect(() => certificateMeta('javascript:alert(1)', null, null)).toThrow();
  });
});
