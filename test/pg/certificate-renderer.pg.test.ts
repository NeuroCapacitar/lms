import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { buildCertificateSnapshot } from '../../src/features/certificate/certificate.ts';
import { defaultLayout } from '../../src/features/certificate/layout.ts';
import {
  createBrowserRunRenderer,
  type BrowserRunBinding,
} from '../../src/server/certificate/browser-run-renderer.ts';
import {
  CertificateRenderRejectedError,
  CertificateRenderTransientError,
} from '../../src/server/certificate/certificate-store.ts';
import { createMemoryStorage, type MemoryStorage } from '../../src/server/media/memory-storage.ts';
import { pngBytes, sha256Hex } from '../helpers/media-bytes.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M7-02: o renderer de produção com um Browser Run FALSO (roteirizado) e o R2 em memória. Prova o contrato (o que é
 * enviado ao serviço, como cada resposta é classificada, o que é gravado e com que hash). NÃO prova o Browser Run real:
 * esse é o gate do M7-09, em Staging.
 */
const FONT = 'data:font/woff2;base64,d09GMgABAAAAAAAA';
const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const MEDIA = '00000000-0000-4000-8000-0000000000a1';
const BACKGROUND = '00000000-0000-4000-8000-0000000000b2';

const onePagePdf = (pad = 200) =>
  new TextEncoder().encode(
    `%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n${'x'.repeat(pad)}\n%%EOF\n`,
  );
const twoPagePdf = () =>
  new TextEncoder().encode(
    '%PDF-1.7\n2 0 obj << /Type /Pages /Count 2 >> endobj\n3 0 obj << /Type /Page >> endobj\n4 0 obj << /Type /Page >> endobj\n%%EOF\n',
  );

let database: TestSchema;
let main: OpenDatabase;
let storage: MemoryStorage;
let userId: string;

beforeAll(async () => {
  database = await createTestSchema();
  main = await openDatabase(database.connectionString);
});
afterAll(async () => {
  await main.close();
  await database.drop();
});
beforeEach(async () => {
  storage = createMemoryStorage();
  await main.db.execute(sql`truncate table media_reference, media_asset cascade`);
  await main.db.delete(schema.user);
  userId = `u-${crypto.randomUUID()}`;
  await main.db
    .insert(schema.user)
    .values({ id: userId, name: 'Admin', email: `${userId}@example.test` });
});

/** SHA-256 REAL dos bytes: o renderizador confere o que lê do R2 contra o que foi verificado na confirmação. */
async function shaOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function asset(id: string, purpose = 'certificate_asset', state = 'ready') {
  const bytes = pngBytes(600, 200, 400);
  await main.db.insert(schema.mediaAsset).values({
    id,
    purpose,
    visibility: 'private',
    storageKey: `m/${id}`,
    declaredType: 'image/png',
    declaredSize: bytes.length,
    contentType: 'image/png',
    state,
    size: bytes.length,
    width: 600,
    height: 200,
    sha256: await shaOf(bytes),
    confirmedAt: new Date(),
    createdBy: userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await storage.put('private', `m/${id}`, bytes, 'image/png');
}

function snapshot(overrides: Partial<Parameters<typeof buildCertificateSnapshot>[0]> = {}) {
  return buildCertificateSnapshot({
    certificateName: 'Ana Souza',
    displayName: 'x',
    courseTitle: 'Curso de Teste',
    workloadHours: 20,
    completedAt: new Date('2026-10-14T12:00:00.000Z'),
    requiredTotal: 5,
    issuer: { legalName: 'Neuro Capacitar LTDA', cnpj: '11222333000181' },
    signatory: { name: 'Dra. Ana Lima', title: 'Diretora', signatureMediaId: MEDIA },
    layout: defaultLayout(),
    backgroundMediaId: null,
    ...overrides,
  });
}

interface Call {
  action: string;
  options: Record<string, any>;
}

function browser(
  answer: () => Response | Promise<Response>,
  calls: Call[] = [],
): BrowserRunBinding {
  return {
    async quickAction(action, options) {
      calls.push({ action, options });
      return answer();
    },
  };
}

const renderer = (binding: BrowserRunBinding) =>
  createBrowserRunRenderer({
    browser: binding,
    storage,
    baseUrl: 'https://hub.example.test',
    fontDataUri: FONT,
    now: () => new Date('2026-10-15T12:00:00.000Z'),
  });

const input = (snap = snapshot()) => ({
  db: main.db,
  certificateId: crypto.randomUUID(),
  code: CODE,
  snapshot: snap,
});

describe('o que é enviado ao Browser Run', () => {
  it('a ação pdf, o HTML autocontido com fonte e assinatura em data:, as opções do ADR 0030 e o bloqueio de rede', async () => {
    await asset(MEDIA);
    await asset(BACKGROUND);
    const calls: Call[] = [];
    await renderer(browser(() => new Response(onePagePdf()), calls)).render(
      input(snapshot({ backgroundMediaId: BACKGROUND })),
    );
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.action).toBe('pdf');
    expect(call.options.pdfOptions).toEqual({ preferCSSPageSize: true, printBackground: true });
    expect(call.options.rejectRequestPattern).toEqual(['^https?://.*']);
    const html = call.options.html as string;
    expect(html).toContain(FONT);
    expect(html).toMatch(
      /<img src="data:image\/png;base64,[^"]+" alt="Assinatura de Dra\. Ana Lima">/,
    );
    expect(html).toContain('<img class="bg" src="data:image/png;base64,');
    expect(html).toContain(`https://hub.example.test/certificados/${CODE}`);
    expect(html).toContain('em 15 de outubro de 2026');
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?https?:/i);
    expect(html).not.toMatch(/<script/i);
  });

  it('sem assinatura nem fundo no snapshot, não lê o R2 e ainda renderiza', async () => {
    const calls: Call[] = [];
    await renderer(browser(() => new Response(onePagePdf()), calls)).render(
      input(
        snapshot({
          signatory: { name: 'Dra. Ana Lima', title: 'Diretora', signatureMediaId: null },
        }),
      ),
    );
    expect(calls[0]!.options.html).not.toContain('<img');
  });
});

describe('o que é guardado', () => {
  it('um PDF de 1 página vai ao R2 PRIVADO em certificates/<id>/<sha256>.pdf com o hash dos bytes guardados', async () => {
    await asset(MEDIA);
    const pdf = onePagePdf(500);
    const args = input();
    const result = await renderer(browser(() => new Response(pdf))).render(args);
    const hash = await sha256Hex(pdf);
    expect(result).toEqual({
      pdfKey: `certificates/${args.certificateId}/${hash}.pdf`,
      pdfSha256: hash,
    });
    const stored = await storage.read('private', result.pdfKey);
    expect(await sha256Hex(stored!)).toBe(hash);
    expect(await storage.read('public', result.pdfKey)).toBeNull();
  });

  it('duas tentativas com PDFs diferentes (não determinístico) geram dois objetos e nenhum sobrescreve o outro', async () => {
    await asset(MEDIA);
    const args = input();
    const first = await renderer(browser(() => new Response(onePagePdf(300)))).render(args);
    const second = await renderer(browser(() => new Response(onePagePdf(301)))).render(args);
    expect(first.pdfKey).not.toBe(second.pdfKey);
    expect(await storage.read('private', first.pdfKey)).not.toBeNull();
    expect(await storage.read('private', second.pdfKey)).not.toBeNull();
  });
});

describe('classificação das respostas', () => {
  const codeOf = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('429, 5xx e exceção do serviço são TRANSITÓRIOS (a outbox repete)', async () => {
    await asset(MEDIA);
    for (const answer of [
      () => new Response('limite', { status: 429 }),
      () => new Response('erro', { status: 503 }),
      () => {
        throw new Error('rede');
      },
    ]) {
      const error = await codeOf(renderer(browser(answer)).render(input()));
      expect(error).toBeInstanceOf(CertificateRenderTransientError);
    }
  });

  it('4xx (formato recusado) é DEFINITIVO e leva o status no código', async () => {
    await asset(MEDIA);
    const error = (await codeOf(
      renderer(browser(() => new Response('formato inválido', { status: 400 }))).render(input()),
    )) as CertificateRenderRejectedError;
    expect(error).toBeInstanceOf(CertificateRenderRejectedError);
    expect(error.code).toBe('browser_run_http_400');
  });

  it('resposta que não é PDF, vazia, grande demais ou com mais de uma página é DEFINITIVA e nada é guardado', async () => {
    await asset(MEDIA);
    const cases: [Uint8Array, string][] = [
      [new TextEncoder().encode('<html>nao e pdf</html>'), 'not_a_pdf'],
      [new Uint8Array(), 'pdf_size_invalid'],
      [onePagePdf(2_100_000), 'pdf_size_invalid'],
      [twoPagePdf(), 'pdf_not_one_page'],
    ];
    for (const [bytes, expected] of cases) {
      const args = input();
      const error = (await codeOf(
        renderer(browser(() => new Response(bytes))).render(args),
      )) as CertificateRenderRejectedError;
      expect(error, expected).toBeInstanceOf(CertificateRenderRejectedError);
      expect(error.code).toBe(expected);
    }
    expect(storage.keys('private').filter((key) => key.startsWith('certificates/'))).toEqual([]);
  });

  it('falha do R2 ao gravar é transitória', async () => {
    await asset(MEDIA);
    const broken = { ...storage, put: async () => Promise.reject(new Error('r2')) };
    const error = await codeOf(
      createBrowserRunRenderer({
        browser: browser(() => new Response(onePagePdf())),
        storage: broken as unknown as MemoryStorage,
        baseUrl: 'https://hub.example.test',
        fontDataUri: FONT,
      }).render(input()),
    );
    expect(error).toBeInstanceOf(CertificateRenderTransientError);
  });
});

describe('o que não pode ser impresso', () => {
  const rejected = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      return error as CertificateRenderRejectedError;
    }
    return undefined;
  };

  it('snapshot sem emitente ou sem signatário: recusado ANTES de chamar o Browser Run', async () => {
    const calls: Call[] = [];
    const binding = browser(() => new Response(onePagePdf()), calls);
    expect(
      (await rejected(renderer(binding).render(input(snapshot({ issuer: null })))))?.code,
    ).toBe('issuer_missing');
    expect(
      (await rejected(renderer(binding).render(input(snapshot({ signatory: null })))))?.code,
    ).toBe('signatory_missing');
    expect(calls).toHaveLength(0);
  });

  it('assinatura ou fundo que não existem, não estão prontos ou são de outro propósito: recusado', async () => {
    const calls: Call[] = [];
    const binding = browser(() => new Response(onePagePdf()), calls);
    // assinatura referenciada mas ausente
    expect((await rejected(renderer(binding).render(input())))?.code).toBe('signature_unavailable');
    await asset(MEDIA, 'course_cover');
    expect((await rejected(renderer(binding).render(input())))?.code).toBe('signature_unavailable');
    await main.db.execute(sql`truncate table media_asset cascade`);
    await asset(MEDIA, 'certificate_asset', 'pending_upload');
    expect((await rejected(renderer(binding).render(input())))?.code).toBe('signature_unavailable');
    // objeto sumiu do R2
    await main.db.execute(sql`truncate table media_asset cascade`);
    await asset(MEDIA);
    await storage.delete('private', `m/${MEDIA}`);
    expect((await rejected(renderer(binding).render(input())))?.code).toBe('signature_unavailable');
    expect(calls).toHaveLength(0);
  });

  it('assinatura TROCADA no R2 depois da confirmação (PUT pré-assinado reaproveitado) é recusada: o certificado não embute bytes não verificados', async () => {
    const calls: Call[] = [];
    const binding = browser(() => new Response(onePagePdf()), calls);
    await asset(MEDIA);
    // O objeto é trocado por outro conteúdo (aqui, HTML com cara de imagem) com a mesma chave e o mesmo tipo registrado.
    await storage.put(
      'private',
      `m/${MEDIA}`,
      new TextEncoder().encode('<script>alert(1)</script>'),
      'image/png',
    );
    expect((await rejected(renderer(binding).render(input())))?.code).toBe('signature_unavailable');
    expect(calls).toHaveLength(0);
  });

  it('HTML grande demais é recusado sem chamar o serviço', async () => {
    await asset(MEDIA);
    const calls: Call[] = [];
    const big = snapshot();
    // 3 MiB de assinatura em base64 passam de 1,5 MB de HTML
    await main.db.execute(sql`truncate table media_asset cascade`);
    const bytes = new Uint8Array(2_900_000);
    await main.db.insert(schema.mediaAsset).values({
      id: MEDIA,
      purpose: 'certificate_asset',
      visibility: 'private',
      storageKey: `m/${MEDIA}`,
      declaredType: 'image/png',
      declaredSize: bytes.length,
      contentType: 'image/png',
      state: 'ready',
      size: bytes.length,
      width: 600,
      height: 200,
      sha256: await shaOf(bytes),
      confirmedAt: new Date(),
      createdBy: userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await storage.put('private', `m/${MEDIA}`, bytes, 'image/png');
    const error = await rejected(
      renderer(browser(() => new Response(onePagePdf()), calls)).render(input(big)),
    );
    expect(error?.code).toBe('html_too_large');
    expect(calls).toHaveLength(0);
  });
});
