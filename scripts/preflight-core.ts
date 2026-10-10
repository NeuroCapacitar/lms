import type { ExpectedEnvironment } from './environments.ts';

type Json = Record<string, unknown>;

/**
 * Onde cada categoria de recurso aparece no `wrangler.json` gerado pelo Cloudflare Vite Plugin
 * e qual campo identifica o recurso. Categoria não listada mas preenchida = erro (deny-by-default).
 */
const RESOURCE_REFERENCES: Readonly<Record<string, { path: readonly string[]; field: string }>> = {
  hyperdrive: { path: ['hyperdrive'], field: 'id' },
  kv_namespaces: { path: ['kv_namespaces'], field: 'id' },
  r2_buckets: { path: ['r2_buckets'], field: 'bucket_name' },
  d1_databases: { path: ['d1_databases'], field: 'database_id' },
  queue_producers: { path: ['queues', 'producers'], field: 'queue' },
  queue_consumers: { path: ['queues', 'consumers'], field: 'queue' },
  services: { path: ['services'], field: 'service' },
};

/** Chaves que podem estar preenchidas sem referenciar recurso de ambiente. */
const BENIGN_KEYS = new Set([
  'assets',
  'dev',
  'rules',
  'triggers',
  'python_modules',
  'observability',
]);

/** Chaves tratadas por regras próprias (recursos e variáveis). */
const HANDLED_KEYS = new Set([
  'hyperdrive',
  'kv_namespaces',
  'r2_buckets',
  'd1_databases',
  'services',
  'queues',
  'vars',
]);

const EXACT_HTTPS_ORIGIN = /^https:\/\/[^/*\s]+$/;

function isTrustedOrigin(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    EXACT_HTTPS_ORIGIN.test(value) &&
    !/localhost|127\.0\.0\.1/.test(value)
  );
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPath(root: Json, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.values(value).every(isEmptyValue);
  return false;
}

/**
 * Confere o artefato construído (wrangler.json gerado) contra a tabela esperada do ambiente.
 * Retorna a lista de problemas; vazia = aprovado.
 */
export function checkArtifact(
  artifact: unknown,
  expected: ExpectedEnvironment,
  requestedEnvironment: string,
): string[] {
  const problems: string[] = [];
  if (!isRecord(artifact)) return ['artefato inválido: não é um objeto JSON'];

  const target = artifact.targetEnvironment ?? null;
  if (target !== expected.cloudflareEnv) {
    problems.push(
      `ambiente do artefato (${JSON.stringify(target)}) difere do esperado para "${requestedEnvironment}" (${JSON.stringify(expected.cloudflareEnv)})`,
    );
  }

  if (artifact.name !== expected.workerName) {
    problems.push(
      `nome do Worker "${String(artifact.name)}" difere do esperado "${expected.workerName}"`,
    );
  }

  for (const [category, { path, field }] of Object.entries(RESOURCE_REFERENCES)) {
    const entries = getPath(artifact, path);
    if (!Array.isArray(entries)) continue;
    const allowed = new Set(expected.resources[category] ?? []);
    for (const entry of entries) {
      const id = isRecord(entry) ? entry[field] : undefined;
      if (typeof id !== 'string' || !allowed.has(id)) {
        problems.push(
          `recurso não permitido em "${requestedEnvironment}": ${category} ${JSON.stringify(id)}`,
        );
      }
    }
  }

  for (const [key, value] of Object.entries(artifact)) {
    if (!Array.isArray(value) && !isRecord(value)) continue;
    // Listas de texto (compatibility_flags, definedEnvironments) não são bindings.
    if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null))
      continue;
    if (BENIGN_KEYS.has(key) || HANDLED_KEYS.has(key)) continue;
    if (!isEmptyValue(value)) {
      problems.push(`binding não previsto na tabela de ambientes: ${key}`);
    }
  }

  const vars = artifact.vars;
  if (isRecord(vars)) {
    const allowedVars = new Set(expected.vars);
    for (const name of Object.keys(vars)) {
      if (!allowedVars.has(name))
        problems.push(`variável não permitida em "${requestedEnvironment}": ${name}`);
    }
    // A origem do app é a única origem confiável do Better Auth: em Staging e Production só https,
    // host exato e sem localhost (ADR 0007, M1-01).
    const baseUrl = vars.APP_BASE_URL;
    if (expected.cloudflareEnv !== null && baseUrl !== undefined && !isTrustedOrigin(baseUrl)) {
      problems.push(
        `APP_BASE_URL inválida em "${requestedEnvironment}": exige https, host exato e sem localhost`,
      );
    }
  }

  return problems;
}
