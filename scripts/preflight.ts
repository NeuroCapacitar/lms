import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENVIRONMENTS, isEnvironmentName } from './environments.ts';
import { checkArtifact } from './preflight-core.ts';

/** Localiza o `wrangler.json` gerado pelo build (dist/<worker>/wrangler.json; exatamente um). */
export function findArtifact(distDir = 'dist'): string {
  const candidates = readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'client')
    .map((entry) => join(distDir, entry.name, 'wrangler.json'))
    .filter((path) => existsSync(path));
  if (candidates.length !== 1) {
    throw new Error(
      `esperado exatamente 1 artefato em ${distDir}/*/wrangler.json; encontrados: ${candidates.length}`,
    );
  }
  return candidates[0] as string;
}

export function runPreflight(environment: string, distDir = 'dist'): string[] {
  if (!isEnvironmentName(environment)) {
    return [`ambiente desconhecido: "${environment}" (use dev, staging ou production)`];
  }
  const artifactPath = findArtifact(distDir);
  const artifact: unknown = JSON.parse(readFileSync(artifactPath, 'utf8'));
  return checkArtifact(artifact, ENVIRONMENTS[environment], environment);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const environment = process.argv[2] ?? '';
  let problems: string[];
  try {
    problems = runPreflight(environment);
  } catch (error) {
    problems = [(error as Error).message];
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`PREFLIGHT FALHOU: ${problem}`);
    process.exit(1);
  }
  console.log(`preflight ok: artefato de "${environment}" confere com a tabela de ambientes`);
}
