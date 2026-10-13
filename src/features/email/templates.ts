import { z } from 'zod';

/**
 * Contrato dos e-mails do produto (M4-04). O TEXTO editorial vive no Resend (Hosted Templates); aqui
 * ficam só o que o código precisa saber: o alias do modelo, as variáveis (Zod ESTRITO: variável faltando
 * ou a mais falha ANTES do envio), a prioridade e se o e-mail é crítico. Variáveis guardadas são só
 * valores NÃO sensíveis; nome e endereço vêm da conta na hora de enviar, e links com token nunca passam
 * por aqui (esses e-mails são `direct`, enviados pelo caminho dos hooks do login).
 *
 * Classe de prioridade (quanto menor, antes sai; ver a cota do M4-08): 1 link de acesso; 2 financeiro;
 * 3 acesso, certificado e suporte; 4 aviso de expiração e novo curso; 5 marketing (M9).
 */
export type PriorityClass = 1 | 2 | 3 | 4 | 5;

/** Prioridade da linha na outbox (menor sai primeiro) por classe. */
export const OUTBOX_PRIORITY_BY_CLASS: Readonly<Record<PriorityClass, number>> = {
  1: 10,
  2: 50,
  3: 100,
  4: 200,
  5: 500,
};

const text = (max: number) => z.string().min(1).max(max);
const course = z.strictObject({ COURSE_TITLE: text(200) });

interface BaseContract {
  /**
   * Alias do modelo no Resend (o modelo precisa estar PUBLICADO com este alias). SEMPRE com o prefixo
   * `vnext-`: a conta do Resend é compartilhada com o legado, que já usa os nomes sem prefixo
   * (`purchase-confirmed`, `staff-invitation`, `support-request`...). Nunca reaproveite nem edite os do legado.
   */
  alias: string;
  priorityClass: PriorityClass;
  /** Crítico: a falha de envio é prioridade de alerta alta (P1), pois bloqueia algo que a pessoa espera. */
  critical: boolean;
  /** Remetente próprio; ausente = o `EMAIL_FROM` do ambiente. */
  from?: string;
  replyTo?: string;
}

/** Enviado pela outbox: a pessoa vem da conta (`user`) ou é a caixa de suporte. */
interface QueuedContract extends BaseContract {
  delivery: 'queued';
  recipient: 'user' | 'support_inbox';
  variables: z.ZodType<Record<string, string>>;
  /** Se o modelo usa `NAME`, o nome vem da conta na hora de enviar (nunca é guardado). */
  usesName: boolean;
}

/** Link com token: nunca guardado, enviado direto pelo hook do login (M1); o contrato só o registra. */
interface DirectContract extends BaseContract {
  delivery: 'direct';
  variableNames: readonly string[];
  /** Reservado, ainda sem uso (o modelo não precisa existir; o verificador o ignora). */
  deferred?: boolean;
}

type TemplateContract = QueuedContract | DirectContract;

export const EMAIL_TEMPLATES = {
  'magic-link': {
    delivery: 'direct',
    alias: 'vnext-magic-link',
    priorityClass: 1,
    critical: true,
    variableNames: ['LINK_URL'],
  },
  'reauth-link': {
    delivery: 'direct',
    alias: 'vnext-reauth-link',
    priorityClass: 1,
    critical: true,
    variableNames: ['LINK_URL'],
  },
  'staff-invitation': {
    delivery: 'direct',
    alias: 'vnext-staff-invitation',
    priorityClass: 1,
    critical: true,
    variableNames: ['LINK_URL'],
  },
  'email-verification': {
    delivery: 'direct',
    alias: 'vnext-email-verification',
    priorityClass: 1,
    critical: true,
    variableNames: ['LINK_URL'],
    deferred: true,
  },
  'password-reset': {
    delivery: 'direct',
    alias: 'vnext-password-reset',
    priorityClass: 1,
    critical: true,
    variableNames: ['LINK_URL'],
    deferred: true,
  },
  'purchase-confirmed': {
    delivery: 'queued',
    alias: 'vnext-purchase-confirmed',
    recipient: 'user',
    priorityClass: 2,
    critical: true,
    usesName: true,
    variables: z.strictObject({ COURSE_TITLE: text(200), AMOUNT_BRL: text(30) }),
  },
  'refund-completed': {
    delivery: 'queued',
    alias: 'vnext-refund-completed',
    recipient: 'user',
    priorityClass: 2,
    critical: true,
    usesName: true,
    variables: z.strictObject({ COURSE_TITLE: text(200), AMOUNT_BRL: text(30) }),
  },
  'access-granted': {
    delivery: 'queued',
    alias: 'vnext-access-granted',
    recipient: 'user',
    priorityClass: 3,
    critical: false,
    usesName: true,
    variables: z.strictObject({ COURSE_TITLE: text(200), EXPIRES_AT: text(40) }),
  },
  'certificate-issued': {
    delivery: 'queued',
    alias: 'vnext-certificate-issued',
    recipient: 'user',
    priorityClass: 3,
    critical: false,
    usesName: true,
    variables: z.strictObject({ COURSE_TITLE: text(200), CERTIFICATE_ID: z.uuid() }),
  },
  'support-request': {
    delivery: 'queued',
    alias: 'vnext-support-request',
    recipient: 'support_inbox',
    priorityClass: 3,
    critical: false,
    usesName: false,
    variables: z.strictObject({ REQUEST_ID: z.uuid(), CATEGORY: text(60) }),
  },
  'access-expiry-warning': {
    delivery: 'queued',
    alias: 'vnext-access-expiry-warning',
    recipient: 'user',
    priorityClass: 4,
    critical: false,
    usesName: true,
    variables: z.strictObject({ COURSE_TITLE: text(200), EXPIRES_AT: text(40) }),
  },
  'course-available': {
    delivery: 'queued',
    alias: 'vnext-course-available',
    recipient: 'user',
    priorityClass: 4,
    critical: false,
    usesName: true,
    variables: course,
  },
} as const satisfies Record<string, TemplateContract>;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;

export function isEmailTemplate(name: string): name is EmailTemplateName {
  return Object.hasOwn(EMAIL_TEMPLATES, name);
}

/** O contrato de um template ENFILEIRÁVEL; `undefined` se não existe ou é de link direto. */
export function queuedContract(name: string): QueuedContract | undefined {
  if (!isEmailTemplate(name)) return undefined;
  const contract: TemplateContract = EMAIL_TEMPLATES[name];
  return contract.delivery === 'queued' ? contract : undefined;
}

/** Nomes das variáveis que o modelo do Resend precisa declarar (as do contrato mais as do sistema). */
export function expectedVariableNames(name: EmailTemplateName): string[] {
  const contract: TemplateContract = EMAIL_TEMPLATES[name];
  if (contract.delivery === 'direct') return [...contract.variableNames];
  const shape = (contract.variables as unknown as z.ZodObject).shape;
  const names = Object.keys(shape);
  if (contract.usesName) names.push('NAME');
  names.push('APP_URL');
  return names;
}

/** Os templates que o código USA hoje (os adiados não precisam existir no Resend). */
export function activeTemplateNames(): EmailTemplateName[] {
  return (Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[]).filter((name) => {
    const contract: TemplateContract = EMAIL_TEMPLATES[name];
    return !(contract.delivery === 'direct' && contract.deferred);
  });
}
