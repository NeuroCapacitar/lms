import {
  EMAIL_TEMPLATES,
  activeTemplateNames,
  expectedVariableNames,
  type EmailTemplateName,
} from '../../features/email/templates';

/**
 * Verificador dos modelos hospedados (M4-04): para cada template do contrato, confere no Resend que o
 * modelo EXISTE, está PUBLICADO, tem assunto e declara exatamente as variáveis que o código envia (faltando
 * uma, o Resend recusa o envio; sobrando uma sem valor padrão, também). Roda em Staging e no preflight de
 * Production, com a chave do ambiente; NUNCA envia e-mail (só `GET /templates/:alias`).
 */
export interface TemplateProblem {
  template: EmailTemplateName;
  problem: string;
}

interface ResendTemplate {
  status?: unknown;
  subject?: unknown;
  variables?: unknown;
}

export async function verifyTemplates(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Só para teste: outra lista de nomes. Padrão: os que o código usa hoje. */
  only?: readonly EmailTemplateName[];
}): Promise<TemplateProblem[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const names = options.only ?? activeTemplateNames();
  const problems: TemplateProblem[] = [];

  for (const template of names) {
    const alias = EMAIL_TEMPLATES[template].alias;
    let response: Response;
    try {
      response = await doFetch(`https://api.resend.com/templates/${encodeURIComponent(alias)}`, {
        headers: { authorization: `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      problems.push({ template, problem: 'sem resposta do Resend' });
      continue;
    }
    if (response.status === 404) {
      problems.push({ template, problem: `modelo "${alias}" não existe no Resend` });
      continue;
    }
    if (!response.ok) {
      problems.push({ template, problem: `Resend respondeu HTTP ${response.status}` });
      continue;
    }
    const body = (await response.json()) as ResendTemplate;
    if (body.status !== 'published') {
      problems.push({ template, problem: 'modelo não está publicado' });
    }
    if (typeof body.subject !== 'string' || body.subject.trim() === '') {
      problems.push({ template, problem: 'modelo sem assunto' });
    }
    const declared = new Set(
      Array.isArray(body.variables)
        ? body.variables.flatMap((variable: unknown) =>
            typeof variable === 'object' &&
            variable !== null &&
            typeof (variable as { key?: unknown }).key === 'string'
              ? [(variable as { key: string }).key]
              : [],
          )
        : [],
    );
    const expected = new Set(expectedVariableNames(template));
    const missing = [...expected].filter((key) => !declared.has(key));
    const extra = [...declared].filter((key) => !expected.has(key));
    if (missing.length > 0) {
      problems.push({
        template,
        problem: `variáveis que o código envia e o modelo não declara: ${missing.join(', ')}`,
      });
    }
    if (extra.length > 0) {
      problems.push({
        template,
        problem: `variáveis do modelo que o código não envia: ${extra.join(', ')}`,
      });
    }
  }
  return problems;
}
