/**
 * Núcleo puro da comparação de zonas DNS (M0-09): normaliza as respostas de um servidor de nomes e
 * compara dois conjuntos registro a registro. Sem rede, para ser testado sem depender de DNS.
 */
export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA', 'SRV'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export interface DnsRecord {
  readonly name: string;
  readonly type: RecordType;
  /** Valor canônico: minúsculas, sem ponto final, TXT concatenado, MX como `prioridade host`. */
  readonly value: string;
  readonly ttl: number;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '');
}

export function normalizeValue(type: RecordType, value: string): string {
  const text = value.trim();
  if (type === 'CNAME' || type === 'NS') return normalizeName(text);
  if (type === 'MX') {
    const [priority = '', ...host] = text.split(/\s+/);
    return `${priority} ${normalizeName(host.join(' '))}`;
  }
  if (type === 'AAAA') return text.toLowerCase();
  return text;
}

const keyOf = (record: DnsRecord) => `${record.name} ${record.type} ${record.value}`;

export interface ParityReport {
  /** Existe na referência e não existe no destino. */
  readonly missing: DnsRecord[];
  /** Existe no destino e não existe na referência. */
  readonly extra: DnsRecord[];
  /** Mesmo registro com TTL diferente (informativo: não reprova a paridade). */
  readonly ttlDifferences: Array<{ record: DnsRecord; referenceTtl: number; targetTtl: number }>;
}

export function compareZones(
  reference: readonly DnsRecord[],
  target: readonly DnsRecord[],
): ParityReport {
  const referenceByKey = new Map(reference.map((record) => [keyOf(record), record]));
  const targetByKey = new Map(target.map((record) => [keyOf(record), record]));
  const missing: DnsRecord[] = [];
  const extra: DnsRecord[] = [];
  const ttlDifferences: ParityReport['ttlDifferences'] = [];
  for (const [key, record] of referenceByKey) {
    const other = targetByKey.get(key);
    if (!other) missing.push(record);
    else if (other.ttl !== record.ttl) {
      ttlDifferences.push({ record, referenceTtl: record.ttl, targetTtl: other.ttl });
    }
  }
  for (const [key, record] of targetByKey) {
    if (!referenceByKey.has(key)) extra.push(record);
  }
  return { missing, extra, ttlDifferences };
}

export function isEquivalent(report: ParityReport): boolean {
  return report.missing.length === 0 && report.extra.length === 0;
}
