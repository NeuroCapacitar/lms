/**
 * Núcleo puro do script de pedidos de privacidade (M9-10): leitura dos argumentos e as TRAVAS. Sem banco; o único disco é a pasta de
 * registros. Para que o que decide "isto pode rodar?" seja testado sozinho.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  ERASURE_POLICY_APPROVED,
  REQUEST_REF_PATTERN,
  erasureLogFileName,
  parseErasureLogEntry,
  type ErasureLogEntry,
} from '../../src/features/privacy/erasure-policy.ts';

export const COMMANDS = ['export', 'erase', 'change-email', 'reapply'] as const;
export type Command = (typeof COMMANDS)[number];

export interface ParsedArgs {
  environment: string;
  command: Command;
  /** Opções com valor (`--user abc`) e marcas sem valor (`--execute`). */
  values: Map<string, string>;
  flags: Set<string>;
}

const VALUE_OPTIONS = new Set([
  '--user',
  '--email',
  '--new-email',
  '--request-ref',
  '--operator',
  '--out',
  '--log-dir',
]);
const FLAG_OPTIONS = new Set(['--execute', '--confirmed-old', '--confirmed-new', '--log-s3']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [environment, command, ...rest] = argv;
  if (!environment || !command || !(COMMANDS as readonly string[]).includes(command))
    throw new Error(`uso: <dev|staging|production> <${COMMANDS.join('|')}> [opções]`);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (FLAG_OPTIONS.has(arg)) flags.add(arg);
    else if (VALUE_OPTIONS.has(arg)) {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`a opção ${arg} precisa de um valor`);
      values.set(arg, value);
      i += 1;
    } else throw new Error(`opção desconhecida: ${arg}`);
  }
  return { environment, command: command as Command, values, flags };
}

/** Quem é a pessoa: pelo identificador interno ou pelo e-mail (um dos dois). */
export function personSelector(args: ParsedArgs): { by: 'id' | 'email'; value: string } {
  const id = args.values.get('--user');
  const email = args.values.get('--email');
  if ((id === undefined) === (email === undefined))
    throw new Error('informe a pessoa com --user <id> OU --email <endereço> (um só)');
  return id !== undefined
    ? { by: 'id', value: id }
    : { by: 'email', value: email!.trim().toLowerCase() };
}

export function requestRef(args: ParsedArgs): string | null {
  const ref = args.values.get('--request-ref');
  if (ref === undefined) return null;
  if (!REQUEST_REF_PATTERN.test(ref))
    throw new Error(
      '--request-ref aceita só letras, números, ponto, hífen e sublinhado (o número do chamado), sem espaço nem arroba',
    );
  return ref;
}

/**
 * O que pode EXECUTAR (sem `--execute` tudo é ensaio). Em Production a exclusão só executa com a política APROVADA
 * (constante em `erasure-policy.ts`, mudada por PR com o parecer do advogado e do contador); o ensaio sempre pode.
 */
export function assertCanExecute(args: ParsedArgs): void {
  if (!args.flags.has('--execute')) return;
  if (
    args.environment === 'production' &&
    (args.command === 'erase' || args.command === 'reapply') &&
    !ERASURE_POLICY_APPROVED
  )
    throw new Error(
      'RECUSADO: a política de eliminação NÃO foi aprovada pelo advogado e pelo contador; em Production só vale o ensaio (sem --execute)',
    );
  if (args.command === 'erase' && !args.values.has('--log-dir'))
    throw new Error(
      'RECUSADO: excluir exige --log-dir (o registro da eliminação FORA do banco, para reaplicar depois de uma restauração)',
    );
  if (
    args.command === 'change-email' &&
    !(args.flags.has('--confirmed-old') && args.flags.has('--confirmed-new'))
  )
    throw new Error(
      'RECUSADO: trocar o e-mail exige --confirmed-old e --confirmed-new (a Staff confirmou os DOIS endereços)',
    );
}

/** O arquivo da exportação tem dado pessoal: nunca dentro do repositório. */
export function assertOutsideRepo(path: string, cwd: string = process.cwd()): string {
  const absolute = resolve(path);
  const rel = relative(cwd, absolute);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    throw new Error('RECUSADO: o arquivo tem dado pessoal e não pode ficar dentro do repositório');
  return absolute;
}

/** Grava o registro da eliminação (um arquivo por exclusão, sem sobrescrever, permissão restrita). Só id, política e contagens. */
export function writeLog(dir: string, entry: ErasureLogEntry): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, erasureLogFileName(entry));
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return file;
}

/** Lê TODOS os registros de uma pasta, em ordem; um arquivo inválido interrompe (não se reaplica um registro duvidoso). */
export function readLogs(dir: string): ErasureLogEntry[] {
  const entries: ErasureLogEntry[] = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const parsed = parseErasureLogEntry(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    if (!parsed) throw new Error(`registro de eliminação inválido: ${name}`);
    entries.push(parsed);
  }
  return entries;
}
