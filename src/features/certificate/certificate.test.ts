import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_CODE_PATTERN,
  CERTIFICATE_STATUSES,
  SnapshotInvalidError,
  buildCertificateSnapshot,
  canTransitionCertificate,
  certificateSnapshotSchema,
  generateCertificateCode,
} from './certificate';

const base = {
  certificateName: null,
  displayName: 'Ana Souza',
  courseTitle: 'Curso de Teste',
  workloadHours: 20,
  completedAt: new Date('2026-10-14T12:00:00.000Z'),
  requiredTotal: 5,
};

describe('código do certificado', () => {
  it('tem 22 caracteres Base64URL e nunca se repete', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCertificateCode()));
    expect(codes.size).toBe(500);
    for (const code of codes) expect(code).toMatch(CERTIFICATE_CODE_PATTERN);
  });

  it('codifica os 16 bytes sem preenchimento nem + ou /', () => {
    expect(generateCertificateCode((bytes) => bytes.fill(0xff))).toBe('_____________________w');
    expect(generateCertificateCode((bytes) => bytes.fill(0))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('estados', () => {
  it('só avança pelo caminho previsto', () => {
    expect(canTransitionCertificate('queued', 'rendering')).toBe(true);
    expect(canTransitionCertificate('rendering', 'ready')).toBe(true);
    expect(canTransitionCertificate('failed', 'queued')).toBe(true);
    expect(canTransitionCertificate('ready', 'queued')).toBe(false);
    expect(canTransitionCertificate('revoked', 'ready')).toBe(false);
    expect(canTransitionCertificate('superseded', 'ready')).toBe(false);
    expect(CERTIFICATE_STATUSES).toHaveLength(7);
  });
});

describe('snapshot', () => {
  it('usa o nome confirmado e, sem ele, o nome de exibição', () => {
    expect(buildCertificateSnapshot(base).holderName).toBe('Ana Souza');
    expect(
      buildCertificateSnapshot({ ...base, certificateName: 'Ana Maria de Souza' }).holderName,
    ).toBe('Ana Maria de Souza');
    expect(buildCertificateSnapshot({ ...base, certificateName: '   ' }).holderName).toBe(
      'Ana Souza',
    );
  });

  it('normaliza para NFC e guarda a data em ISO', () => {
    const snapshot = buildCertificateSnapshot({ ...base, displayName: 'José' });
    expect(snapshot.holderName).toBe('José');
    expect(snapshot.completedAt).toBe('2026-10-14T12:00:00.000Z');
  });

  it('carga horária ausente é permitida; título ou nome vazios e campo extra são recusados', () => {
    expect(buildCertificateSnapshot({ ...base, workloadHours: null }).workloadHours).toBeNull();
    expect(() => buildCertificateSnapshot({ ...base, courseTitle: '  ' })).toThrow(
      SnapshotInvalidError,
    );
    expect(() => buildCertificateSnapshot({ ...base, displayName: '' })).toThrow(
      SnapshotInvalidError,
    );
    expect(() => buildCertificateSnapshot({ ...base, displayName: 'x'.repeat(201) })).toThrow(
      SnapshotInvalidError,
    );
    expect(
      certificateSnapshotSchema.safeParse({
        ...buildCertificateSnapshot(base),
        email: 'ana@example.test',
      }).success,
    ).toBe(false);
  });
});
