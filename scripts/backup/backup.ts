/**
 * Backup do banco (M9-05): `pg_dump -Fc` (cliente PG18, conexão DIRETA, role somente leitura), cifra com `age` (só a
 * chave PÚBLICA) e manifesto com SHA-256. Grava em uma pasta; `--upload` envia ao bucket S3-compatível de backup
 * (R2, bucket SEPARADO da mídia) com o `aws` CLI e um token de escopo mínimo; `--record` (só com `--upload`)
 * registra o backup em `backup_run`, de onde o alerta de backup velho do Worker lê (ADR 0033).
 *
 *   BACKUP_DATABASE_URL=… BACKUP_AGE_RECIPIENT=age1… bun scripts/backup/backup.ts --kind daily --out ./backups
 *
 * Variáveis do upload: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET e as credenciais do `aws` (AWS_ACCESS_KEY_ID e
 * AWS_SECRET_ACCESS_KEY). Nada aqui lê a mídia nem o Worker; nada é impresso além de nomes, tamanhos e hashes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import pg from 'pg';

import { buildManifest, manifestKey, type BackupKind, type BackupManifest } from './backup-core.ts';
import { assertAgeRecipient, assertDirectConnection } from './backup-guards.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`variável ausente: ${name}`);
  return value;
}

async function databaseFacts(url: string): Promise<{ migrations: number; pgVersion: string }> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const version = await client.query<{ server_version: string }>('show server_version');
    const migrations = await client.query<{ n: string }>(
      'select count(*)::text as n from drizzle.__drizzle_migrations',
    );
    return {
      migrations: Number(migrations.rows[0]?.n ?? 0),
      pgVersion: version.rows[0]?.server_version ?? '',
    };
  } finally {
    await client.end();
  }
}

/** Registra o backup JÁ ENVIADO em `backup_run` (a role do dump tem INSERT só nesta tabela). */
async function recordBackup(url: string, manifest: BackupManifest): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `insert into backup_run (kind, object_key, sha256, size_bytes, migrations, pg_version, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        manifest.kind,
        manifest.object,
        manifest.sha256,
        manifest.size,
        manifest.migrations,
        manifest.pgVersion,
        manifest.createdAt,
      ],
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--record') && !process.argv.includes('--upload'))
    throw new Error('--record só com --upload (não registre um backup que não está no bucket)');
  const kind = (arg('kind') ?? 'daily') as BackupKind;
  if (kind !== 'daily' && kind !== 'release') throw new Error('--kind deve ser daily ou release');
  const out = arg('out');
  if (!out) throw new Error('informe --out <pasta>');
  const url = need('BACKUP_DATABASE_URL');
  const recipient = need('BACKUP_AGE_RECIPIENT');
  assertDirectConnection(url);
  assertAgeRecipient(recipient);

  const startedAt = new Date();
  const work = mkdtempSync(join(tmpdir(), 'hub-backup-'));
  try {
    const plain = join(work, 'hub.dump');
    const encryptedPath = join(work, 'hub.dump.age');
    // `--no-owner --no-acl`: o dump não carrega papéis do ambiente de origem (a restauração cria os dela).
    execFileSync('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', plain, url], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    execFileSync('age', ['-r', recipient, '-o', encryptedPath, plain], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    rmSync(plain, { force: true });

    const encrypted = readFileSync(encryptedPath);
    const facts = await databaseFacts(url);
    const manifest = buildManifest({ kind, createdAt: startedAt, encrypted, ...facts });

    const objectPath = join(out, manifest.object);
    const manifestPath = join(out, manifestKey(manifest.object));
    mkdirSync(dirname(objectPath), { recursive: true });
    writeFileSync(objectPath, encrypted);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `backup ${kind}: ${manifest.object} (${manifest.size} bytes, sha256 ${manifest.sha256.slice(0, 12)}…, migrations ${manifest.migrations})`,
    );

    if (process.argv.includes('--upload')) {
      const endpoint = need('BACKUP_S3_ENDPOINT');
      const bucket = need('BACKUP_S3_BUCKET');
      // O manifesto sobe DEPOIS do objeto: manifesto sem objeto não existe, objeto sem manifesto é ignorado.
      for (const [local, key] of [
        [objectPath, manifest.object],
        [manifestPath, manifestKey(manifest.object)],
      ] as const)
        execFileSync(
          'aws',
          [
            's3',
            'cp',
            local,
            `s3://${bucket}/${key}`,
            '--endpoint-url',
            endpoint,
            '--only-show-errors',
          ],
          {
            stdio: ['ignore', 'inherit', 'inherit'],
          },
        );
      console.log(`enviado: s3://${bucket}/${manifest.object}`);
      if (process.argv.includes('--record')) {
        await recordBackup(url, manifest);
        console.log('registrado em backup_run');
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  // Nunca imprime a URL do banco: só a mensagem.
  console.error(error instanceof Error ? error.message : 'falha desconhecida');
  process.exit(1);
});
