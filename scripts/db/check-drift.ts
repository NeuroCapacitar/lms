/**
 * Falha se o schema TypeScript (src/db/schema.ts) divergir das migrações versionadas:
 * roda `drizzle-kit generate` e exige "nothing to migrate". Se gerar algo, desfaz e sai com 1.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';

const dir = 'drizzle';
const backup = '.drizzle-drift-backup';
const listing = () => (existsSync(dir) ? readdirSync(dir, { recursive: true }).join('|') : '');

rmSync(backup, { recursive: true, force: true });
cpSync(dir, backup, { recursive: true });
const before = listing();
const result = spawnSync('bun', ['x', 'drizzle-kit', 'generate', '--name', 'drift_check'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const changed = listing() !== before;
if (changed) {
  rmSync(dir, { recursive: true, force: true });
  cpSync(backup, dir, { recursive: true });
}
rmSync(backup, { recursive: true, force: true });

if (result.status !== 0 || changed) {
  console.error('DRIFT: o schema em src/db/schema.ts difere das migrações em drizzle/.');
  console.error('Rode `bun run db:generate`, REVISE o SQL à mão e inclua a migração no commit.');
  process.exit(1);
}
console.log('sem drift: schema e migrações conferem');
