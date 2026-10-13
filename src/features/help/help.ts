import { z } from 'zod';

import { richTextSchema, type RichText } from '../content/rich-text';
import { normalizeText } from '../discussion/discussion';

/**
 * Ajuda e suporte (M5-14). Puro: sem rede nem banco. Uma só entrada "Ajuda": FAQ editável e um formulário que
 * manda o pedido ao suporte por e-mail. Sem busca, chatbot nem helpdesk: a resposta humana acontece fora do Hub.
 */
export const HELP_CATEGORIES = [
  'conta',
  'acesso',
  'curso',
  'certificado',
  'pagamento',
  'outro',
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export const HELP_CATEGORY_LABELS: Record<HelpCategory, string> = {
  conta: 'Minha conta e login',
  acesso: 'Acesso aos cursos',
  curso: 'Conteúdo do curso',
  certificado: 'Certificado',
  pagamento: 'Pagamento',
  outro: 'Outro assunto',
};

export const MAX_QUESTION_LENGTH = 300;
export const MAX_REQUEST_LENGTH = 2000;
/** Quantos pedidos de suporte uma pessoa pode abrir por janela. */
export const SUPPORT_RATE_LIMIT = { count: 3, windowMinutes: 10 } as const;
/** Quantos pedidos a página da Staff lista (os mais recentes). */
export const SUPPORT_LIST_LIMIT = 50;

const category = z.enum(HELP_CATEGORIES);

const text = (max: number) =>
  z
    .string()
    .max(max * 3)
    .transform(normalizeText)
    .pipe(z.string().min(1).max(max));

export const faqItemSchema = z.strictObject({
  category,
  question: text(MAX_QUESTION_LENGTH),
  answer: richTextSchema,
});

export const supportRequestSchema = z.strictObject({
  category,
  message: text(MAX_REQUEST_LENGTH),
  /** Contexto opcional: o curso a que o pedido se refere. */
  courseId: z.uuid().optional(),
});

export const moveFaqSchema = z.strictObject({ direction: z.enum(['up', 'down']) });
export const faqStateSchema = z.strictObject({ state: z.enum(['draft', 'published']) });

export type FaqState = 'draft' | 'published';

export interface HelpFaqItemDto {
  id: string;
  category: HelpCategory;
  question: string;
  answer: RichText;
  state: FaqState;
}

export interface SupportRequestItemDto {
  id: string;
  category: HelpCategory;
  message: string;
  courseTitle: string | null;
  /** Nome de exibição do perfil; o endereço para responder vai no `Reply-To` do e-mail, não nesta tela. */
  authorName: string;
  createdAt: string;
}

/**
 * O endereço serve de `Reply-To`? Uma única caixa, sem espaço, sem quebra de linha (injeção de cabeçalho), sem
 * mais de um destinatário. É a última barreira: o endereço da conta já foi validado no login.
 */
export function isSafeReplyTo(address: string): boolean {
  return (
    address.length <= 254 &&
    /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/.test(address)
  );
}
