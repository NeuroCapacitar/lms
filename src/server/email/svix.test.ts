import { describe, expect, it } from 'vitest';

import { TEST_WEBHOOK_SECRET, signSvix } from '../../../test/helpers/svix';
import { verifySvixSignature } from './svix';

const NOW = 1_800_000_000;
const BODY = '{"type":"email.delivered","data":{"email_id":"abc"}}';
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';

async function input(overrides: Partial<Parameters<typeof verifySvixSignature>[0]> = {}) {
  return {
    secret: TEST_WEBHOOK_SECRET,
    id: ID,
    timestamp: String(NOW),
    signature: await signSvix({ id: ID, timestamp: NOW, body: BODY }),
    body: BODY,
    nowSeconds: NOW,
    ...overrides,
  };
}

describe('assinatura Svix do webhook do Resend', () => {
  it('aceita a assinatura válida', async () => {
    expect(await verifySvixSignature(await input())).toBe(true);
  });

  it('recusa corpo adulterado, mesmo com um byte a mais ou reserializado', async () => {
    expect(await verifySvixSignature(await input({ body: `${BODY} ` }))).toBe(false);
    expect(
      await verifySvixSignature(await input({ body: JSON.stringify(JSON.parse(BODY), null, 2) })),
    ).toBe(false);
  });

  it('recusa id ou carimbo trocados e segredo errado', async () => {
    expect(await verifySvixSignature(await input({ id: 'msg_outro' }))).toBe(false);
    expect(await verifySvixSignature(await input({ timestamp: String(NOW + 1) }))).toBe(false);
    const other = `whsec_${btoa('outro-segredo-que-nao-e-o-do-endpoint')}`;
    expect(await verifySvixSignature(await input({ secret: other }))).toBe(false);
  });

  it('recusa cabeçalho ausente ou vazio', async () => {
    for (const field of ['id', 'timestamp', 'signature'] as const) {
      expect(await verifySvixSignature(await input({ [field]: undefined }))).toBe(false);
      expect(await verifySvixSignature(await input({ [field]: '' }))).toBe(false);
    }
  });

  it('carimbo fora da janela de 5 min (passado ou futuro) é recusado: anti-replay', async () => {
    const old = NOW - 301;
    expect(
      await verifySvixSignature(
        await input({
          timestamp: String(old),
          signature: await signSvix({ id: ID, timestamp: old, body: BODY }),
        }),
      ),
    ).toBe(false);
    const future = NOW + 301;
    expect(
      await verifySvixSignature(
        await input({
          timestamp: String(future),
          signature: await signSvix({ id: ID, timestamp: future, body: BODY }),
        }),
      ),
    ).toBe(false);
    const edge = NOW - 300;
    expect(
      await verifySvixSignature(
        await input({
          timestamp: String(edge),
          signature: await signSvix({ id: ID, timestamp: edge, body: BODY }),
        }),
      ),
    ).toBe(true);
  });

  it('carimbo que não é inteiro é recusado', async () => {
    for (const timestamp of ['abc', '1.5', '-1', '1e9', '12345678901234']) {
      expect(await verifySvixSignature(await input({ timestamp })), timestamp).toBe(false);
    }
  });

  it('aceita se UMA das assinaturas confere (rotação do segredo)', async () => {
    const valid = await signSvix({ id: ID, timestamp: NOW, body: BODY });
    expect(
      await verifySvixSignature(
        await input({ signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${valid}` }),
      ),
    ).toBe(true);
  });

  it('versão que não é v1, assinatura vazia ou base64 inválido são recusados sem lançar', async () => {
    const valid = (await signSvix({ id: ID, timestamp: NOW, body: BODY })).slice(3);
    for (const signature of [`v2,${valid}`, 'v1,', 'v1', '', 'v1,@@@@', valid]) {
      expect(await verifySvixSignature(await input({ signature })), signature).toBe(false);
    }
    expect(await verifySvixSignature(await input({ secret: 'whsec_@@@' }))).toBe(false);
    expect(await verifySvixSignature(await input({ secret: '' }))).toBe(false);
  });
});
