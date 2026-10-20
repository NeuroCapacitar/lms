/**
 * Núcleo do script de reconciliação pós-restore (M9-05): leitura da pasta com o registro das revogações (`revocation-log/`,
 * baixado do R2 privado). Um arquivo inválido INTERROMPE: não se reaplica um registro duvidoso.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseRevocationEntry,
  type RevocationLogEntry,
} from '../../src/features/ops/revocation-log.ts';

export function readRevocationLogs(dir: string): RevocationLogEntry[] {
  const entries: RevocationLogEntry[] = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const parsed = parseRevocationEntry(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    if (!parsed) throw new Error(`registro de revogação inválido: ${name}`);
    entries.push(parsed);
  }
  return entries;
}
