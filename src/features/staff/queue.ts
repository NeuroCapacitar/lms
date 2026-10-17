import type { Capability } from '../identity/capabilities';

/**
 * Fila operacional unificada da Staff (M9-01, passo 3): o que PRECISA DE AÇÃO, com a idade de cada item. Sem nome, e-mail nem
 * dado de pagamento: só o tipo, o estado, um código curto e a idade. Quem vê cada tipo e quem tem a AÇÃO (o grant) estão aqui, na
 * fonte única; o servidor monta o DTO com isto e o teste confere.
 */
export type QueueKind =
  | 'financial_review'
  | 'refund_pending'
  | 'refund_uncertain'
  | 'refund_failed'
  | 'certificate_failed'
  | 'certificate_awaiting_name'
  | 'email_problem'
  | 'outbox_problem'
  | 'discussion_report';

export interface QueueItem {
  /** `tipo:id` (estável; serve de chave na tela). */
  id: string;
  kind: QueueKind;
  /** Frase curta em português, igual para todos os itens do tipo. */
  title: string;
  /** Estado ou código curto (ex.: `unknown`, `provider_503`); nunca dado pessoal. */
  detail: string | null;
  /** Segundos desde que o item entrou na fila (pelo `now()` do banco). */
  ageSeconds: number;
  /** A ação, só para quem tem o grant; `null` = item informativo para esta pessoa. */
  action: { label: string; screen: QueueScreen } | null;
}

type QueueScreen =
  | '/staff/financeiro'
  | '/staff/certificados/emitidos'
  | '/staff/operacao'
  | '/staff/discussoes';

export interface StaffQueueDto {
  generatedAt: string;
  /** Do mais antigo para o mais novo, no máximo {@link QUEUE_LIMIT}. */
  items: QueueItem[];
  /** Quantos itens existem de cada tipo visível (o total real, não só os listados). */
  totals: Partial<Record<QueueKind, number>>;
  truncated: boolean;
  /** Tipos que existem mas que esta pessoa não pode ver (a tela diz isso, sem números). */
  hidden: QueueKind[];
}

export const QUEUE_LIMIT = 100;
/** Por tipo, quantos itens vêm do banco (o total real vem junto por `count(*) over ()`). */
export const QUEUE_PER_KIND = 50;

export interface QueueKindRule {
  title: string;
  /** Definição de "precisa de ação" (a tela mostra). */
  definition: string;
  /** Quem VÊ o tipo. */
  visibleWith: Capability;
  /** Quem pode AGIR e para onde vai; `null` = o tipo é só informativo (ninguém age por esta fila). */
  action: { capability: Capability; label: string; screen: QueueScreen } | null;
}

/** Idades-limite (em segundos) que tornam um item "parado". */
export const QUEUE_THRESHOLDS = {
  /** Reembolso em andamento há mais que isto passa a pedir atenção. */
  refundPendingSeconds: 15 * 60,
  /** Certificado esperando o nome há mais que isto. */
  awaitingNameSeconds: 3 * 24 * 3600,
  /** E-mail com problema só entra na fila por este período. */
  emailWindowSeconds: 7 * 24 * 3600,
  /** Reembolso que falhou só entra na fila por este período. */
  refundFailedWindowSeconds: 30 * 24 * 3600,
  /** Intenção na fila de envio que não saiu há mais que isto. */
  outboxLateSeconds: 30 * 60,
} as const;

export const QUEUE_RULES: Record<QueueKind, QueueKindRule> = {
  financial_review: {
    title: 'Revisão financeira aberta',
    definition: 'Revisão financeira ainda não resolvida, desde que foi aberta.',
    visibleWith: 'finance.review',
    action: { capability: 'finance.review', label: 'Resolver', screen: '/staff/financeiro' },
  },
  refund_pending: {
    title: 'Reembolso em andamento há mais de 15 minutos',
    definition:
      'Pedido de reembolso solicitado, em envio ou enviado ao provedor, sem conclusão há mais de 15 minutos.',
    visibleWith: 'refund.execute',
    action: { capability: 'refund.execute', label: 'Ver reembolso', screen: '/staff/financeiro' },
  },
  refund_uncertain: {
    title: 'Reembolso com resultado incerto',
    definition:
      'Reembolso cujo resultado no provedor é desconhecido ou aguarda autorização externa; não se repete às cegas.',
    visibleWith: 'refund.execute',
    action: { capability: 'refund.execute', label: 'Ver reembolso', screen: '/staff/financeiro' },
  },
  refund_failed: {
    title: 'Reembolso que falhou',
    definition: 'Reembolso que falhou nos últimos 30 dias.',
    visibleWith: 'refund.execute',
    action: { capability: 'refund.execute', label: 'Ver reembolso', screen: '/staff/financeiro' },
  },
  certificate_failed: {
    title: 'Certificado com falha na geração',
    definition: 'Certificado cuja geração do PDF falhou e espera nova tentativa.',
    visibleWith: 'staff.read',
    action: {
      capability: 'ops.queue',
      label: 'Tentar de novo',
      screen: '/staff/certificados/emitidos',
    },
  },
  certificate_awaiting_name: {
    title: 'Certificado esperando o nome há mais de 3 dias',
    definition:
      'Certificado parado até a pessoa confirmar o nome do documento, há mais de 3 dias. Quem age é a pessoa.',
    visibleWith: 'staff.read',
    action: null,
  },
  email_problem: {
    title: 'E-mail com problema',
    definition:
      'E-mail que falhou, foi suprimido, devolvido, bloqueado ou marcado como spam, nos últimos 7 dias.',
    visibleWith: 'staff.read',
    action: null,
  },
  outbox_problem: {
    title: 'Fila de envio com problema',
    definition:
      'Intenção da fila assíncrona que morreu (`dead`), falhou, ou está sem sair há mais de 30 minutos.',
    visibleWith: 'staff.read',
    action: { capability: 'ops.queue', label: 'Reenfileirar', screen: '/staff/operacao' },
  },
  discussion_report: {
    title: 'Mensagem de discussão denunciada',
    definition: 'Mensagem com denúncia ainda não resolvida; a idade é a da denúncia mais antiga.',
    visibleWith: 'discussion.moderate',
    action: { capability: 'discussion.moderate', label: 'Moderar', screen: '/staff/discussoes' },
  },
};

export const QUEUE_KINDS = Object.keys(QUEUE_RULES) as QueueKind[];

/** Idade em português para a tela: "menos de 1 min", "15 min", "3 h", "2 dias". Arredonda para baixo; nunca negativa. */
export function formatAge(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return 'menos de 1 min';
  if (total < 3600) return `${Math.floor(total / 60)} min`;
  if (total < 86_400) return `${Math.floor(total / 3600)} h`;
  const days = Math.floor(total / 86_400);
  return days === 1 ? '1 dia' : `${days} dias`;
}

/** Em que grupo a tela explica um tipo escondido ("finanças", "moderação das discussões"). */
export function hiddenGroup(kind: QueueKind): 'finanças' | 'moderação das discussões' | null {
  if (kind === 'financial_review' || kind.startsWith('refund_')) return 'finanças';
  if (kind === 'discussion_report') return 'moderação das discussões';
  return null;
}
