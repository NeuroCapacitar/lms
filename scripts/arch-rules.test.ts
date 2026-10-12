import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

interface Rule {
  name: string;
  severity: string;
  from: { path: string };
  to: { path: string };
}

const require = createRequire(import.meta.url);
const config = require('../.dependency-cruiser.cjs') as { forbidden: Rule[] };

/**
 * M3-02: a regra que impede o módulo de acesso e matrícula de importar pagamentos. O teste confere o
 * CONTRATO da regra (quem é fiscalizado e o que é proibido); `bun run arch` a aplica ao código.
 */
describe('regra acesso-nao-importa-pagamentos', () => {
  const rule = config.forbidden.find((item) => item.name === 'acesso-nao-importa-pagamentos');

  it('existe e é erro (bloqueia o CI)', () => {
    expect(rule).toBeDefined();
    expect(rule!.severity).toBe('error');
  });

  it('fiscaliza o servidor e o domínio de acesso, não o resto', () => {
    const from = new RegExp(rule!.from.path);
    for (const path of [
      'src/server/access/free-enrollment.ts',
      'src/server/access/entitlement-store.ts',
      'src/features/access/access.ts',
    ]) {
      expect(from.test(path), path).toBe(true);
    }
    for (const path of ['src/server/catalog/catalog-store.ts', 'src/web/routes/cursos.index.tsx']) {
      expect(from.test(path), path).toBe(false);
    }
  });

  it('proíbe pagamento, financeiro, Asaas e checkout como destino', () => {
    const to = new RegExp(rule!.to.path);
    for (const path of [
      'src/server/payments/asaas-client.ts',
      'src/server/finance/order-store.ts',
      'src/features/finance/order.ts',
      'src/server/asaas/webhook.ts',
      'src/server/checkout/session.ts',
      'src/features/payments/payment.ts',
    ]) {
      expect(to.test(path), path).toBe(true);
    }
    for (const path of [
      'src/server/access/entitlement-store.ts',
      'src/server/catalog/catalog-store.ts',
    ]) {
      expect(to.test(path), path).toBe(false);
    }
  });

  it('o código atual de acesso não importa nada proibido', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const forbidden = /from ['"][^'"]*\/(payments|finance|asaas|checkout)\//;
    for (const dir of ['src/server/access', 'src/features/access']) {
      for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
        expect(forbidden.test(readFileSync(`${dir}/${file}`, 'utf8')), `${dir}/${file}`).toBe(
          false,
        );
      }
    }
  });
});
