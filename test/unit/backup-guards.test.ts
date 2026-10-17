import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildManifest, verifyManifest } from '../../scripts/backup/backup-core.ts';
import {
  assertAgeRecipient,
  assertDirectConnection,
  assertRestoreTarget,
  databaseName,
} from '../../scripts/backup/backup-guards.ts';

describe('trava do alvo da restauração', () => {
  it('só aceita banco descartável cujo nome começa por restore_rehearsal', () => {
    expect(() =>
      assertRestoreTarget('postgres://u:p@localhost:5432/restore_rehearsal_2026'),
    ).not.toThrow();
    for (const name of ['neondb', 'hub_production', 'postgres', 'restore']) {
      expect(() =>
        assertRestoreTarget(`postgres://u:p@ep-x.sa-east-1.aws.neon.tech/${name}?sslmode=require`),
      ).toThrow('RECUSADO');
    }
    expect(() => assertRestoreTarget('isto não é uma url')).toThrow('inválida');
  });

  it('a mensagem de recusa não vaza usuário nem senha', () => {
    try {
      assertRestoreTarget('postgres://usuario:segredo@host.example/neondb');
    } catch (error) {
      expect(String(error)).not.toContain('segredo');
      expect(String(error)).not.toContain('usuario');
    }
    expect(databaseName('postgres://u:p@h/restore_rehearsal_a?x=1')).toBe('restore_rehearsal_a');
  });
});

describe('trava do dump', () => {
  it('recusa o pooler do Neon e o Hyperdrive; aceita a conexão direta', () => {
    expect(() =>
      assertDirectConnection('postgres://u:p@ep-a-b-pooler.sa-east-1.aws.neon.tech/neondb'),
    ).toThrow('direta');
    expect(() => assertDirectConnection('postgres://u:p@abc.hyperdrive.local/neondb')).toThrow(
      'Hyperdrive',
    );
    expect(() =>
      assertDirectConnection('postgres://u:p@ep-a-b.sa-east-1.aws.neon.tech/neondb'),
    ).not.toThrow();
  });

  it('só recebe chave PÚBLICA do age; a privada é recusada', () => {
    const publicKey = `age1${'q'.repeat(58)}`;
    expect(() => assertAgeRecipient(publicKey)).not.toThrow();
    expect(() => assertAgeRecipient(`AGE-SECRET-KEY-1${'Q'.repeat(58)}`)).toThrow('PRIVADA');
    expect(() => assertAgeRecipient('age1curta')).toThrow('inválida');
    expect(() => assertAgeRecipient('')).toThrow('inválida');
  });
});

/** O `age` real: cifrar com a pública, decifrar com a privada, e decifrar SEM a chave certa falha. Pulado sem o binário. */
const hasAge = (() => {
  try {
    execFileSync('age', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasAge)('age de verdade (cifra e chave)', () => {
  it('ida e volta, hash do manifesto, adulteração detectada e chave errada não decifra', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-age-test-'));
    try {
      const keygen = (name: string) => {
        const file = join(dir, name);
        execFileSync('age-keygen', ['-o', file], { stdio: 'ignore' });
        const text = readFileSync(file, 'utf8');
        const publicKey = /public key: (age1\w+)/.exec(text)?.[1];
        if (!publicKey) throw new Error('chave pública não encontrada');
        return { file, publicKey };
      };
      const right = keygen('certa.txt');
      const wrong = keygen('errada.txt');
      assertAgeRecipient(right.publicKey);

      const plain = join(dir, 'dump.bin');
      writeFileSync(plain, 'PGDMP conteúdo sintético do dump');
      const encryptedPath = join(dir, 'dump.bin.age');
      execFileSync('age', ['-r', right.publicKey, '-o', encryptedPath, plain]);
      const encrypted = readFileSync(encryptedPath);
      expect(encrypted.includes(Buffer.from('PGDMP'))).toBe(false);

      const manifest = buildManifest({
        kind: 'daily',
        createdAt: new Date('2026-10-17T03:00:00Z'),
        encrypted,
        migrations: 41,
        pgVersion: '18.1',
      });
      expect(verifyManifest(manifest, encrypted)).toEqual({ ok: true });

      const back = join(dir, 'volta.bin');
      execFileSync('age', ['-d', '-i', right.file, '-o', back, encryptedPath]);
      expect(readFileSync(back, 'utf8')).toBe('PGDMP conteúdo sintético do dump');

      expect(() =>
        execFileSync('age', ['-d', '-i', wrong.file, '-o', join(dir, 'x.bin'), encryptedPath], {
          stdio: 'ignore',
        }),
      ).toThrow();

      const tampered = Buffer.from(encrypted);
      tampered[tampered.length - 5] = (tampered[tampered.length - 5] ?? 0) ^ 1;
      expect(verifyManifest(manifest, tampered)).toEqual({ ok: false, reason: 'sha256' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
