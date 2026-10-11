import { getAuthTables } from 'better-auth/db';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import { createFakeEmailSender } from '../email/fake';
import { authOptions } from './create-auth';

/**
 * Com `validateSchema: false` o Better Auth não confere o schema em execução. Este teste compara,
 * para a versão fixada e as opções reais, cada modelo e cada campo esperado com as tabelas Drizzle:
 * existência, obrigatoriedade e unicidade. Falha ao atualizar a biblioteca se o schema mudar.
 */
const expected = getAuthTables(
  authOptions(
    { baseUrl: 'https://app.example', secret: 'x'.repeat(32) },
    {
      emailSender: createFakeEmailSender(),
      isStaffEmail: async () => false,
      isSuspended: async () => false,
      isStaffUser: async () => false,
    },
  ),
);

describe('schema do Better Auth × tabelas Drizzle', () => {
  it('cada modelo esperado existe', () => {
    for (const model of Object.keys(expected)) {
      expect(schema, `modelo ${model}`).toHaveProperty(model);
    }
  });

  for (const [model, definition] of Object.entries(expected)) {
    it(`campos de "${model}" conferem (existência, obrigatório, único)`, () => {
      const table = (schema as unknown as Record<string, Parameters<typeof getTableColumns>[0]>)[
        model
      ];
      expect(table, `tabela ${model}`).toBeDefined();
      const columns = getTableColumns(table!);
      expect(getTableName(table!).length).toBeGreaterThan(0);
      for (const [key, field] of Object.entries(definition.fields)) {
        const name = field.fieldName ?? key;
        const column = columns[name];
        expect(column, `${model}.${name} existe`).toBeDefined();
        if (field.required !== false) {
          expect(column?.notNull, `${model}.${name} obrigatório`).toBe(true);
        }
        if (field.unique) {
          expect(column?.isUnique, `${model}.${name} único`).toBe(true);
        }
      }
      // Nenhuma coluna extra sem dono: além de `id`, só campos que o Better Auth conhece.
      const known = new Set([
        'id',
        ...Object.entries(definition.fields).map(([k, f]) => f.fieldName ?? k),
      ]);
      for (const column of Object.keys(columns)) {
        expect(known.has(column), `${model}.${column} desconhecida do Better Auth`).toBe(true);
      }
    });
  }
});
