import { readFileSync } from 'node:fs';
import { Resolver } from 'node:dns/promises';

import {
  RECORD_TYPES,
  compareZones,
  isEquivalent,
  normalizeName,
  normalizeValue,
  type DnsRecord,
  type RecordType,
} from './dns-parity-core.ts';

/**
 * Compara, registro a registro, o que dois servidores de nomes respondem para uma zona (M0-09):
 *   bun scripts/dns-parity.ts <servidor-referência> <servidor-destino> [scripts/dns-names.json]
 * Os servidores são nomes de host (ex.: athena.dns-parking.com e o NS atribuído pela Cloudflare).
 * Só consultas DNS (somente leitura). A lista de nomes vem do inventário: só nomes listados são
 * conferidos, então o inventário completo (exportado do painel do provedor) precisa alimentá-la.
 */
const [referenceHost, targetHost, namesFile = 'scripts/dns-names.json'] = process.argv.slice(2);
if (!referenceHost || !targetHost) {
  console.error(
    'uso: bun scripts/dns-parity.ts <servidor-referência> <servidor-destino> [arquivo-de-nomes]',
  );
  process.exit(2);
}

const config = JSON.parse(readFileSync(namesFile, 'utf8')) as { zone: string; labels: string[] };
const names = config.labels.map((label) =>
  label === '@' ? config.zone : `${label}.${config.zone}`,
);

async function resolverFor(host: string): Promise<Resolver> {
  const addresses = await new Resolver().resolve4(host);
  const resolver = new Resolver({ timeout: 4000, tries: 2 });
  resolver.setServers(addresses);
  return resolver;
}

async function collect(resolver: Resolver, name: string, type: RecordType): Promise<DnsRecord[]> {
  const records: DnsRecord[] = [];
  const add = (value: string, ttl = 0) =>
    records.push({ name: normalizeName(name), type, value: normalizeValue(type, value), ttl });
  try {
    switch (type) {
      case 'A':
      case 'AAAA': {
        const answers = await (type === 'A'
          ? resolver.resolve4(name, { ttl: true })
          : resolver.resolve6(name, { ttl: true }));
        for (const answer of answers) add(answer.address, answer.ttl);
        break;
      }
      case 'CNAME':
        for (const value of await resolver.resolveCname(name)) add(value);
        break;
      case 'NS':
        for (const value of await resolver.resolveNs(name)) add(value);
        break;
      case 'MX':
        for (const mx of await resolver.resolveMx(name)) add(`${mx.priority} ${mx.exchange}`);
        break;
      case 'TXT':
        for (const chunks of await resolver.resolveTxt(name)) add(chunks.join(''));
        break;
      case 'CAA':
        for (const caa of await resolver.resolveCaa(name))
          add(
            `${caa.critical} ${Object.entries(caa)
              .filter(([key]) => key !== 'critical')
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(' ')}`,
          );
        break;
      case 'SRV':
        for (const srv of await resolver.resolveSrv(name))
          add(`${srv.priority} ${srv.weight} ${srv.port} ${srv.name}`);
        break;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Sem registro desse tipo (ENODATA/ENOTFOUND) é resposta válida; o resto é falha de consulta.
    if (code !== 'ENODATA' && code !== 'ENOTFOUND' && code !== 'ENOTIMP') {
      throw new Error(`${name} ${type}: ${code ?? (error as Error).message}`);
    }
  }
  return records;
}

async function snapshot(host: string): Promise<DnsRecord[]> {
  const resolver = await resolverFor(host);
  const all: DnsRecord[] = [];
  for (const name of names) {
    for (const type of RECORD_TYPES) all.push(...(await collect(resolver, name, type)));
  }
  return all;
}

const [reference, target] = [await snapshot(referenceHost), await snapshot(targetHost)];
const report = compareZones(reference, target);
console.log(
  `referência ${referenceHost}: ${reference.length} registros; destino ${targetHost}: ${target.length} registros`,
);
for (const item of report.missing)
  console.error(`FALTA no destino: ${item.name} ${item.type} ${item.value} (TTL ${item.ttl})`);
for (const item of report.extra)
  console.error(`SOBRA no destino: ${item.name} ${item.type} ${item.value} (TTL ${item.ttl})`);
for (const item of report.ttlDifferences) {
  console.log(
    `TTL diferente (informativo): ${item.record.name} ${item.record.type} ${item.referenceTtl} -> ${item.targetTtl}`,
  );
}
if (!isEquivalent(report)) process.exit(1);
console.log(
  'paridade: os dois servidores respondem o mesmo para todos os nomes e tipos verificados',
);
