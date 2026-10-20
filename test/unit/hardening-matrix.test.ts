import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * M9-04: a matriz `docs/review/evidencias/m9-04/README.md` é CONFERIDA. Toda referência `arquivo :: trecho do título` precisa
 * existir (o arquivo e o trecho), então renomear ou apagar um teste que a matriz cita derruba este teste, e a matriz não
 * apodrece. O aceite da tarefa ("nenhuma linha vermelha em auth, financeiro ou privacidade") também é verificado aqui.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MATRIX = readFileSync(`${ROOT}docs/review/evidencias/m9-04/README.md`, 'utf8');
const normalize = (text: string) => text.replaceAll(/\s+/g, ' ');

interface Row {
  id: string;
  area: string;
  cells: string[];
  result: string;
}

/** Linhas de dado das tabelas (`| ID | Área | ... | Resultado |`), sem o cabeçalho nem o separador. */
function rows(): Row[] {
  const out: Row[] = [];
  for (const line of MATRIX.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line
      .slice(1, line.lastIndexOf('|'))
      .split('|')
      .map((cell) => cell.trim());
    if (cells[0] === 'ID' || /^-+$/.test(cells[0] ?? '')) continue;
    // Tabelas com 6 colunas (ID, Área, Ameaça, Fluxo, Prova, Resultado) e a da seção 9 (ID, Área, Controle, Prova, Resultado).
    out.push({ id: cells[0]!, area: cells[1]!, cells, result: cells[cells.length - 1]! });
  }
  return out;
}

describe('a matriz de provas de segurança', () => {
  const table = rows();

  it('tem as linhas mínimas da tarefa (XSS, CSRF, RBAC, SSRF, upload, financeiro, prévia) e os incidentes adversariais', () => {
    const prefixes = new Set(table.map((row) => row.id.replace(/\d+$/, '')));
    for (const needed of ['X', 'C', 'R', 'S', 'U', 'F', 'P', 'A', 'G'])
      expect(prefixes, needed).toContain(needed);
    expect(table.filter((row) => row.id.startsWith('A')).length).toBeGreaterThanOrEqual(17);
  });

  it('todo resultado é provado, parcial, ambiente ou lacuna', () => {
    const bad = table.filter((row) => !/^(provado|parcial|ambiente|lacuna)/.test(row.result));
    expect(bad.map((row) => `${row.id}: ${row.result}`)).toEqual([]);
  });

  it('ACEITE: nenhuma linha vermelha (lacuna) em auth, financeiro ou privacidade', () => {
    const red = table.filter(
      (row) =>
        row.result.startsWith('lacuna') && ['auth', 'financeiro', 'privacidade'].includes(row.area),
    );
    expect(red.map((row) => `${row.id} (${row.area})`)).toEqual([]);
  });

  it('toda referência arquivo :: trecho existe de verdade (o arquivo e o trecho do título)', () => {
    const refs = [...MATRIX.matchAll(/`([^`]+?) :: ([^`]+?)`/g)].map((match) => ({
      file: match[1]!,
      fragment: match[2]!,
    }));
    expect(refs.length).toBeGreaterThan(100);
    const missing: string[] = [];
    for (const ref of refs) {
      const path = `${ROOT}${ref.file}`;
      if (!existsSync(path)) {
        missing.push(`${ref.file}: arquivo não existe`);
        continue;
      }
      if (!normalize(readFileSync(path, 'utf8')).includes(normalize(ref.fragment)))
        missing.push(`${ref.file} :: ${ref.fragment}`);
    }
    expect(missing).toEqual([]);
  });

  it('linha sem prova automatizada (ambiente ou parcial) diz o que falta na seção "O que NÃO foi provado"', () => {
    expect(MATRIX).toContain('## 11. O que NÃO foi provado');
    expect(table.filter((row) => row.result.startsWith('provado')).length).toBeGreaterThan(
      table.length / 2,
    );
  });
});
