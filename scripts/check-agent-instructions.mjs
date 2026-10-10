#!/usr/bin/env node
// Verifica apenas a topologia e referências locais das instruções.
// Não exige dependências do projeto nem presume execução de modelos externos.
import { lstatSync, readFileSync, realpathSync, existsSync, readlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = join(root, 'AGENTS.md');
/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const results = [];
/** @param {string} path */
const text = (path) => readFileSync(path, 'utf8');
const canonicalText = text(canonical);
if (!canonicalText.includes('NeuroCapacitar Hub vNext') || canonicalText.length < 3000) {
  errors.push('AGENTS.md ausente, incompleto ou inesperado');
}

/**
 * @param {string} relative
 * @param {string} expectedLink
 * @param {string} expectedImport
 */
function check(relative, expectedLink, expectedImport) {
  const file = join(root, relative);
  if (!existsSync(file)) {
    errors.push(`${relative}: ausente ou link quebrado`);
    return;
  }
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(file);
    if (link !== expectedLink || realpathSync(file) !== realpathSync(canonical)) {
      errors.push(`${relative}: symlink não aponta para o AGENTS.md canônico`);
    } else {
      results.push(`${relative}: symlink válido (${link})`);
    }
    return;
  }
  const contents = text(file);
  if (!contents.includes(expectedImport)) {
    errors.push(`${relative}: falta importação/referência canônica ${expectedImport}`);
  } else if (contents.length > 1300) {
    errors.push(`${relative}: ponte grande demais; possível duplicação de regras`);
  } else {
    results.push(`${relative}: ponte portátil válida`);
  }
}

check('CLAUDE.md', 'AGENTS.md', '@AGENTS.md');
check('.github/copilot-instructions.md', '../AGENTS.md', '@../AGENTS.md');
for (const relative of [
  'docs/README.md',
  'docs/decisions.md',
  'docs/implementation/STATUS.md',
  'docs/roadmap.md',
  'docs/operations/agent-instructions.md',
]) {
  if (!existsSync(join(root, relative))) errors.push(`documento essencial ausente: ${relative}`);
}
for (const line of results) console.log(`OK: ${line}`);
if (errors.length) {
  for (const e of errors) console.error(`ERRO: ${e}`);
  process.exitCode = 1;
} else {
  console.log('OK: fonte canônica e entradas de agentes válidas no filesystem local.');
}
