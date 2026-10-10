import { describe, expect, it } from 'vitest';

import {
  compareZones,
  isEquivalent,
  normalizeName,
  normalizeValue,
  type DnsRecord,
} from './dns-parity-core.ts';

const record = (name: string, type: DnsRecord['type'], value: string, ttl = 300): DnsRecord => ({
  name,
  type,
  value: normalizeValue(type, value),
  ttl,
});

describe('normalização', () => {
  it('ignora caixa e ponto final em nomes, CNAME, NS e MX', () => {
    expect(normalizeName('App.Example.COM.')).toBe('app.example.com');
    expect(normalizeValue('CNAME', 'Cname.Vercel-DNS.com.')).toBe('cname.vercel-dns.com');
    expect(normalizeValue('MX', '10 MX1.Example.com.')).toBe('10 mx1.example.com');
  });

  it('preserva o texto de TXT', () => {
    expect(normalizeValue('TXT', 'v=spf1 -all')).toBe('v=spf1 -all');
  });
});

describe('compareZones', () => {
  const reference = [
    record('example.com', 'A', '192.0.2.1', 14400),
    record('example.com', 'MX', '10 mx.example.com'),
    record('www.example.com', 'CNAME', 'example.com'),
  ];

  it('zonas iguais são equivalentes', () => {
    expect(isEquivalent(compareZones(reference, [...reference].reverse()))).toBe(true);
  });

  it('acusa registro faltando, sobrando e valor diferente', () => {
    const target = [
      record('example.com', 'A', '192.0.2.99', 14400),
      record('example.com', 'MX', '10 mx.example.com'),
      record('extra.example.com', 'A', '192.0.2.5'),
    ];
    const report = compareZones(reference, target);
    expect(isEquivalent(report)).toBe(false);
    expect(report.missing.map((item) => `${item.name} ${item.type}`).sort()).toEqual([
      'example.com A',
      'www.example.com CNAME',
    ]);
    expect(report.extra.map((item) => `${item.name} ${item.type}`).sort()).toEqual([
      'example.com A',
      'extra.example.com A',
    ]);
  });

  it('TTL diferente é informativo e não reprova', () => {
    const target = reference.map((item) => ({ ...item, ttl: 60 }));
    const report = compareZones(reference, target);
    expect(isEquivalent(report)).toBe(true);
    expect(report.ttlDifferences).toHaveLength(3);
  });
});
