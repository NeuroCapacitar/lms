/**
 * Política de eliminação de dados de uma pessoa (M9-10, parte pura): o que se ELIMINA, o que se ANONIMIZA e o que se
 * RETÉM quando a pessoa pede a exclusão. É DADO TIPADO, lido pelo script de exclusão (que o mostra no `--dry-run`),
 * pelo runbook da Staff e por um teste que obriga toda tabela que guarda uma pessoa a ter uma linha aqui.
 *
 * **O desenvolvedor não decide o que a lei manda reter.** Os itens `pending` dependem do advogado do cliente ou do
 * contador (prazo fiscal, base legal, evidência de consentimento). Enquanto `ERASURE_POLICY_APPROVED` for `false`, o
 * script só EXECUTA em Development e Staging (dados sintéticos); em Production ele recusa executar e só faz `--dry-run`.
 * Aprovar a política é um PR que muda esta constante, com o parecer anexado.
 */
export const ERASURE_POLICY_VERSION = '2026-10-19.1';
export const ERASURE_POLICY_APPROVED = false;

type PolicyAction = 'eliminate' | 'anonymize' | 'retain';
type PolicyPending = 'advogado' | 'contador' | 'advogado e contador';

export interface PolicyItem {
  /** Tabelas (e colunas) que a linha cobre. */
  tables: readonly string[];
  action: PolicyAction;
  /** O que acontece, em português para a Staff. */
  what: string;
  /** Por quê. */
  why: string;
  /** Quem precisa confirmar (ausente = decisão técnica, sem dependência jurídica). */
  pending?: PolicyPending;
}

export const ERASURE_POLICY: readonly PolicyItem[] = [
  {
    tables: ['user'],
    action: 'anonymize',
    what: 'Nome vira "[removido]", o e-mail vira um endereço inválido único, a foto some e o e-mail deixa de ser verificado. A linha fica (outras tabelas apontam para ela).',
    why: 'Remove a identidade sem quebrar o histórico que a lei manda reter.',
  },
  {
    tables: ['session', 'account', 'reauth_challenge', 'reauth_proof', 'verification'],
    action: 'eliminate',
    what: 'Sessões, contas de entrada (senha e Google), provas de reautenticação e links de acesso pendentes são apagados.',
    why: 'Credenciais e vestígios de login não têm razão de existir sem a pessoa.',
  },
  {
    tables: ['profile'],
    action: 'eliminate',
    what: 'Nome de exibição, nome para o certificado e preferências são apagados.',
    why: 'Dado pessoal sem obrigação de guarda.',
  },
  {
    tables: ['discussion_post', 'discussion_report'],
    action: 'anonymize',
    what: 'O texto das mensagens e das denúncias vira "[removido]"; a estrutura da conversa continua.',
    why: 'Apagar a linha quebraria as respostas de outras pessoas; o texto é o dado pessoal.',
  },
  {
    tables: ['support_request'],
    action: 'anonymize',
    what: 'O texto do pedido de suporte vira "[removido]"; categoria e curso ficam.',
    why: 'O texto livre pode ter dado pessoal; os metadados servem à operação.',
    pending: 'advogado',
  },
  {
    tables: ['course_interest', 'course_interest_notification', 'offline_operation'],
    action: 'eliminate',
    what: 'Interesse em cursos e a fila técnica do uso offline são apagados.',
    why: 'Sem obrigação de guarda.',
  },
  {
    tables: ['user_role', 'staff_grant', 'user_suspension'],
    action: 'retain',
    what: 'Papéis, grants e suspensões ficam (só ids). Quem tem papel ou grant ATIVO da Staff NÃO é excluído por este script.',
    why: 'Trilha de quem pôde fazer o quê; Staff tem procedimento próprio (Admin).',
    pending: 'advogado',
  },
  {
    tables: ['terms_acceptance'],
    action: 'retain',
    what: 'O registro de aceite dos termos (versão, data, declaração 18+) fica.',
    why: 'Prova de consentimento e da declaração de maioridade.',
    pending: 'advogado',
  },
  {
    tables: ['purchase_order', 'checkout_session', 'payment', 'refund_request', 'financial_review'],
    action: 'retain',
    what: 'Pedidos, pagamentos, reembolsos e revisões ficam, inclusive o nome do pagador e o documento cifrado.',
    why: 'Obrigação fiscal e contábil (prazo de guarda a confirmar).',
    pending: 'contador',
  },
  {
    tables: ['certificate'],
    action: 'retain',
    what: 'Certificados ficam como estão (o nome do titular está no snapshot e no PDF). Certificado REVOGADO segue o prazo e a purga do M7-05.',
    why: 'O certificado é evidência com hash; retirar o nome de um válido muda a validação pública. Decisão do advogado.',
    pending: 'advogado',
  },
  {
    tables: [
      'enrollment',
      'entitlement',
      'course_completion',
      'lesson_completion',
      'quiz_attempt',
      'video_progress',
    ],
    action: 'retain',
    what: 'Matrículas, acessos e progresso ficam, ligados só ao identificador interno (sem nome nem e-mail, depois da anonimização).',
    why: 'Histórico de acesso e conclusão; deixa de identificar a pessoa.',
    pending: 'advogado',
  },
  {
    tables: ['email_message', 'email_recipient_state'],
    action: 'retain',
    what: 'O histórico de envios (modelo, estado, datas) e a lista de supressão por hash ficam; o endereço não é guardado em claro.',
    why: 'Evita reenviar para quem devolveu ou reclamou.',
    pending: 'advogado',
  },
  {
    tables: ['inbox_event', 'outbox_message'],
    action: 'retain',
    what: 'Eventos de provedores e a fila ficam. CONFERIR no Staging se o payload do provedor de pagamento guarda nome ou documento do pagador.',
    why: 'Idempotência e conciliação financeira.',
    pending: 'contador',
  },
  {
    tables: ['audit_log', 'revocation_journal'],
    action: 'retain',
    what: 'A auditoria e o diário das revogações ficam (só ids, ações e instantes, sem e-mail nem texto; o registro fora do banco também).',
    why: 'Trilha de segurança e prova de que a exclusão aconteceu.',
  },
  {
    tables: [
      'course',
      'offer',
      'media_asset',
      'certificate_issuer',
      'certificate_signatory',
      'certificate_template',
      'video_provider_connection',
      'staff_invitation',
      'privacy_incident',
    ],
    action: 'retain',
    what: 'Colunas "criado por" e "alterado por" de conteúdo da Staff: guardam só o id e viram vazias se a conta for apagada.',
    why: 'Autoria de conteúdo administrativo; não é dado de quem estuda.',
  },
] as const;

export const POLICY_TABLES: ReadonlySet<string> = new Set(
  ERASURE_POLICY.flatMap((item) => [...item.tables]),
);

/** Itens que ainda dependem de confirmação do advogado ou do contador. */
export function pendingItems(): PolicyItem[] {
  return ERASURE_POLICY.filter((item) => item.pending !== undefined);
}

/** Marcadores da anonimização (um só lugar, para o teste achar o que sobrou). */
export const REMOVED_TEXT = '[removido]';
const ANON_EMAIL_PREFIX = 'removido+';
const ANON_EMAIL_SUFFIX = '@removido.invalid';

export function anonymizedEmail(userId: string): string {
  return `${ANON_EMAIL_PREFIX}${userId}${ANON_EMAIL_SUFFIX}`;
}

export function isAnonymizedEmail(email: string): boolean {
  return email.startsWith(ANON_EMAIL_PREFIX) && email.endsWith(ANON_EMAIL_SUFFIX);
}

/**
 * Entrada do registro de eliminações guardado FORA do banco (reexecutável depois de uma restauração, M9-05). Só o
 * identificador interno, a política e contagens: nunca nome nem e-mail.
 */
export interface ErasureLogEntry {
  version: 1;
  userId: string;
  erasedAt: string;
  policyVersion: string;
  requestRef: string | null;
  counts: Record<string, number>;
}

/** Referência do pedido (número do chamado): curta e sem espaço nem arroba, para não virar um lugar de dado pessoal. */
export const REQUEST_REF_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function parseErasureLogEntry(value: unknown): ErasureLogEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (entry.version !== 1) return null;
  if (typeof entry.userId !== 'string' || entry.userId.length === 0 || entry.userId.length > 200)
    return null;
  if (typeof entry.erasedAt !== 'string' || Number.isNaN(Date.parse(entry.erasedAt))) return null;
  if (typeof entry.policyVersion !== 'string') return null;
  if (
    entry.requestRef !== null &&
    (typeof entry.requestRef !== 'string' || !REQUEST_REF_PATTERN.test(entry.requestRef))
  )
    return null;
  const counts = entry.counts;
  if (typeof counts !== 'object' || counts === null) return null;
  if (!Object.values(counts).every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0))
    return null;
  return {
    version: 1,
    userId: entry.userId,
    erasedAt: entry.erasedAt,
    policyVersion: entry.policyVersion,
    requestRef: entry.requestRef as string | null,
    counts: counts as Record<string, number>,
  };
}

export function erasureLogFileName(entry: Pick<ErasureLogEntry, 'userId' | 'erasedAt'>): string {
  const stamp = entry.erasedAt.replaceAll(/[:.]/g, '-');
  return `erasure-${stamp}-${entry.userId.replaceAll(/[^A-Za-z0-9_-]/g, '_')}.json`;
}
