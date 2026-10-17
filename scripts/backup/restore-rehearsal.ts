/**
 * Ensaio de restauração (M9-05): confere o manifesto (SHA-256) ANTES de decifrar, decifra com a chave PRIVADA do age
 * (arquivo local, nunca no repositório), `pg_restore` em um banco DESCARTÁVEL (nome começa por `restore_rehearsal`),
 * confere invariantes e mede o tempo. Nunca restaura em Production nem em banco de uso (`assertRestoreTarget`).
 *
 *   RESTORE_DATABASE_URL=…/restore_rehearsal_2026 bun scripts/backup/restore-rehearsal.ts \
 *     --dump ./backups/daily/…/hub-….dump.age --manifest ./backups/daily/…/hub-….manifest.json --identity ./age-key.txt
 *
 * Sem efeitos de provider: o ensaio só toca o banco descartável. Quem reabre efeitos depois de uma restauração REAL
 * segue o runbook (`docs/operations/backup-and-restore.md`), com a reconciliação.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';

import { isManifest, verifyManifest } from './backup-core.ts';
import { assertRestoreTarget } from './backup-guards.ts';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) throw new Error(`informe --${name}`);
  return value;
}

/** Tabelas cujo conteúdo o ensaio compara com o que existe depois da restauração (existência e contagem, sem dado pessoal). */
const INVARIANT_TABLES = [
  'user',
  'course',
  'enrollment',
  'purchase_order',
  'payment',
  'certificate',
  'outbox_message',
];

async function main(): Promise<void> {
  const target = process.env.RESTORE_DATABASE_URL;
  if (!target) throw new Error('variável ausente: RESTORE_DATABASE_URL');
  assertRestoreTarget(target);

  const encrypted = readFileSync(arg('dump'));
  const parsed: unknown = JSON.parse(readFileSync(arg('manifest'), 'utf8'));
  const check = verifyManifest(parsed, encrypted);
  if (!check.ok || !isManifest(parsed))
    throw new Error(
      `backup NÃO íntegro (${check.ok ? 'forma' : check.reason}); nada foi decifrado`,
    );
  const manifest = parsed;
  console.log(
    `manifesto confere (sha256 ${manifest.sha256.slice(0, 12)}…, ${manifest.size} bytes)`,
  );

  const work = mkdtempSync(join(tmpdir(), 'hub-restore-'));
  const started = Date.now();
  try {
    const plain = join(work, 'hub.dump');
    execFileSync('age', ['-d', '-i', arg('identity'), '-o', plain, arg('dump')], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const decrypted = Date.now();
    execFileSync('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '-d', target, plain], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const restored = Date.now();

    const client = new pg.Client({ connectionString: target });
    await client.connect();
    try {
      const migrations = Number(
        (
          await client.query<{ n: string }>(
            'select count(*)::text as n from drizzle.__drizzle_migrations',
          )
        ).rows[0]?.n ?? -1,
      );
      if (migrations !== manifest.migrations)
        throw new Error(
          `migrations restauradas (${migrations}) diferem do manifesto (${manifest.migrations})`,
        );
      for (const table of INVARIANT_TABLES) {
        const rows = await client.query<{ n: string }>(
          `select count(*)::text as n from "${table}"`,
        );
        console.log(`  ${table}: ${rows.rows[0]?.n} linhas`);
      }
    } finally {
      await client.end();
    }
    const ageHours = ((Date.now() - Date.parse(manifest.createdAt)) / 3_600_000).toFixed(1);
    console.log(
      `ENSAIO OK: decifrar ${((decrypted - started) / 1000).toFixed(1)} s, restaurar ${((restored - decrypted) / 1000).toFixed(1)} s, ` +
        `total ${((Date.now() - started) / 1000).toFixed(1)} s (RTO ≤ 8 h); idade do dump ${ageHours} h (RPO ≤ 24 h)`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'falha desconhecida');
  process.exit(1);
});
