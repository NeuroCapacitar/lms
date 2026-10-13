import { describe, expect, it } from 'vitest';

import { verifyTemplates } from './verify-templates';

function resend(templates: Record<string, { status?: number; body?: unknown }>) {
  return (async (url: string) => {
    const alias = decodeURIComponent(url.split('/templates/')[1]!);
    const found = templates[alias];
    if (!found) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(found.body ?? {}), { status: found.status ?? 200 });
  }) as unknown as typeof fetch;
}

const variables = (...keys: string[]) => keys.map((key) => ({ key, type: 'string' }));

describe('verificador de modelos do Resend', () => {
  it('passa quando o modelo existe, está publicado, tem assunto e as variáveis batem', async () => {
    const problems = await verifyTemplates({
      apiKey: 'k',
      only: ['course-available'],
      fetchImpl: resend({
        'vnext-course-available': {
          body: {
            status: 'published',
            subject: 'Novo curso',
            variables: variables('COURSE_TITLE', 'NAME', 'APP_URL'),
          },
        },
      }),
    });
    expect(problems).toEqual([]);
  });

  it('acusa modelo ausente, não publicado, sem assunto e variáveis que não batem', async () => {
    const problems = await verifyTemplates({
      apiKey: 'k',
      only: ['course-available', 'access-granted', 'refund-completed'],
      fetchImpl: resend({
        'vnext-course-available': {
          body: {
            status: 'draft',
            subject: ' ',
            variables: variables('COURSE_TITLE', 'NAME', 'APP_URL'),
          },
        },
        'vnext-access-granted': {
          body: {
            status: 'published',
            subject: 'x',
            variables: variables('COURSE_TITLE', 'EXTRA'),
          },
        },
      }),
    });
    const text = problems.map((item) => `${item.template}: ${item.problem}`).join('\n');
    expect(text).toContain('course-available: modelo não está publicado');
    expect(text).toContain('course-available: modelo sem assunto');
    expect(text).toMatch(
      /access-granted: variáveis que o código envia e o modelo não declara: .*EXPIRES_AT/,
    );
    expect(text).toMatch(/access-granted: variáveis do modelo que o código não envia: EXTRA/);
    expect(text).toContain(
      'refund-completed: modelo "vnext-refund-completed" não existe no Resend',
    );
  });

  it('erro do Resend e falta de resposta viram problema (não passam em silêncio)', async () => {
    const down = await verifyTemplates({
      apiKey: 'k',
      only: ['course-available'],
      fetchImpl: (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch,
    });
    expect(down[0]?.problem).toContain('HTTP 500');
    const silent = await verifyTemplates({
      apiKey: 'k',
      only: ['course-available'],
      fetchImpl: (async () => {
        throw new Error('rede');
      }) as unknown as typeof fetch,
    });
    expect(silent[0]?.problem).toContain('sem resposta');
  });
});
