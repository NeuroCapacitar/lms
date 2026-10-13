import { z } from 'zod';

/**
 * Discussão por aula (M5-05). Puro: sem rede nem banco. TEXTO SIMPLES: nada de HTML nem Markdown; a tela o
 * mostra como texto escapado. Um nível de resposta. O nome exibido é SEMPRE o nome de exibição do perfil,
 * nunca o e-mail. Sem notificação por e-mail (adiada).
 */
export const MAX_BODY_LENGTH = 2000;
const MAX_REASON_LENGTH = 300;
/** Quantos posts novos uma pessoa pode escrever por janela. */
export const POST_RATE_LIMIT = { count: 5, windowMinutes: 10 } as const;
/** Quantas denúncias uma pessoa pode fazer por janela. */
export const REPORT_RATE_LIMIT = { count: 10, windowMinutes: 60 } as const;
/** Quantas conversas (posts de topo) a aula carrega de uma vez. */
export const MAX_THREADS = 100;

/** Controle C0/C1 (menos quebra de linha e tabulação): por código, sem regex de controle. */
function isControl(code: number): boolean {
  if (code === 0x0a || code === 0x09) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Normaliza o texto: quebras de linha "\n", sem caracteres de controle (menos "\n" e "\t"), sem os que
 * invertem ou escondem texto (bidi e largura zero), sem mais de duas quebras seguidas, e aparado.
 */
export function normalizeText(raw: string): string {
  let cleaned = '';
  for (const char of raw.replace(/\r\n?/g, '\n')) {
    if (!isControl(char.codePointAt(0)!)) cleaned += char;
  }
  return cleaned
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const text = (max: number) =>
  z
    .string()
    .max(max * 3)
    .transform(normalizeText)
    .pipe(z.string().min(1).max(max));

export const createPostSchema = z.strictObject({
  body: text(MAX_BODY_LENGTH),
  /** Resposta a um post de topo da mesma aula; ausente = nova pergunta. */
  parentId: z.uuid().optional(),
});

export const editPostSchema = z.strictObject({ body: text(MAX_BODY_LENGTH) });

export const reportSchema = z.strictObject({
  reason: text(MAX_REASON_LENGTH).optional(),
});

export const staffReplySchema = z.strictObject({ body: text(MAX_BODY_LENGTH) });

export const moderateSchema = z.strictObject({
  action: z.enum(['hide', 'restore', 'delete']),
  /** O motivo é obrigatório: vai para a auditoria. */
  reason: text(MAX_REASON_LENGTH).pipe(z.string().min(3)),
});

export const dismissSchema = z.strictObject({ reason: text(MAX_REASON_LENGTH).optional() });

export type PostState = 'visible' | 'hidden' | 'deleted';
export type ModerationAction = z.infer<typeof moderateSchema>['action'];

/**
 * Transição de estado da moderação. `hide`: visível → oculto; `delete`: visível ou oculto → excluído (definitivo);
 * `restore`: só do OCULTO para o visível (um post que o próprio autor excluiu não volta contra a vontade dele).
 */
export function nextState(current: PostState, action: ModerationAction): PostState | null {
  if (action === 'hide') return current === 'visible' ? 'hidden' : null;
  if (action === 'delete') return current === 'deleted' ? null : 'deleted';
  return current === 'hidden' ? 'visible' : null;
}

export interface DiscussionPostDto {
  id: string;
  /** Nome de exibição do perfil (nunca o e-mail). */
  authorName: string;
  authorRole: 'student' | 'staff';
  /** `null` quando o post foi ocultado ou excluído e só resta o lugar dele na conversa. */
  body: string | null;
  /** Só aparece para `hidden` e `deleted` (a conversa mostra "mensagem removida"). */
  placeholder?: 'hidden' | 'deleted';
  createdAt: string;
  editedAt: string | null;
  /** É da pessoa que está lendo (a tela oferece editar e excluir). */
  mine: boolean;
}

interface DiscussionThreadDto {
  post: DiscussionPostDto;
  replies: DiscussionPostDto[];
}

export interface LessonDiscussionDto {
  threads: DiscussionThreadDto[];
}

/** Um item da fila da Staff: o post com o contexto da aula e os números que importam. */
export interface StaffDiscussionItemDto {
  id: string;
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  authorName: string;
  authorRole: 'student' | 'staff';
  state: PostState;
  /** Resposta a outro post (só os de topo recebem resposta). */
  isReply: boolean;
  /** O texto COMPLETO, mesmo oculto: a Staff precisa ler para decidir. */
  body: string;
  createdAt: string;
  openReports: number;
  /** Respostas visíveis da equipe nesta conversa (só nos de topo). */
  staffReplies: number;
}
