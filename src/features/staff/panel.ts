/**
 * Painel de fatos da Staff (M9-01, passo 2). Só CONTAGENS, cada uma com a definição e o período escritos (a tela mostra os dois): sem
 * nome, e-mail nem identificador de pessoa. As seções financeiras e de moderação só vão a quem tem a capacidade (`finance.view` e
 * `discussion.moderate`); as demais servem a toda a Staff (`staff.read`). O servidor calcula tudo pelo `now()` do banco.
 */
export interface PanelFact {
  id: PanelFactId;
  label: string;
  value: number;
  /** O que a contagem conta, em uma frase. */
  definition: string;
  /** A janela de tempo, escrita (ex.: "agora", "últimos 30 dias"). */
  period: string;
}

export interface PanelCourseRow {
  courseId: string;
  title: string;
  withAccess: number;
  expiringIn7Days: number;
  completions: number;
  activeInterests: number;
}

export interface StaffPanelDto {
  generatedAt: string;
  facts: PanelFact[];
  /** Até {@link PANEL_COURSE_LIMIT} cursos, do que tem mais pessoas com acesso para o que tem menos. */
  courses: PanelCourseRow[];
  coursesTruncated: boolean;
  /** `true` = a seção existe mas esta pessoa não tem a capacidade para vê-la (a tela diz isso, sem mostrar números). */
  restricted: { finance: boolean; moderation: boolean };
}

export const PANEL_COURSE_LIMIT = 50;

export type PanelFactId =
  | 'access_now'
  | 'expiring_7d'
  | 'completions_30d'
  | 'completions_total'
  | 'certificates_ready'
  | 'certificates_failed'
  | 'certificates_awaiting_name'
  | 'interests_active'
  | 'orders_paid_30d'
  | 'orders_pending_30d'
  | 'orders_refund_requested_30d'
  | 'orders_refunded_30d'
  | 'reports_open';

/** Rótulo, definição e período de cada fato: a fonte única (o servidor monta o DTO com isto e o teste confere). */
export const PANEL_FACTS: Record<
  PanelFactId,
  {
    label: string;
    definition: string;
    period: string;
    section: 'general' | 'finance' | 'moderation';
  }
> = {
  access_now: {
    label: 'Inscrições com acesso',
    definition:
      'Pares pessoa × curso com direito de acesso em vigor: direito não revogado e dentro da janela, matrícula e conta não suspensas.',
    period: 'agora',
    section: 'general',
  },
  expiring_7d: {
    label: 'Acessos que vencem em 7 dias',
    definition:
      'Das inscrições com acesso, as que terminam em até 7 dias (vale a maior expiração entre os direitos não revogados).',
    period: 'próximos 7 dias',
    section: 'general',
  },
  completions_30d: {
    label: 'Cursos concluídos',
    definition: 'Conclusões de curso registradas.',
    period: 'últimos 30 dias',
    section: 'general',
  },
  completions_total: {
    label: 'Cursos concluídos (total)',
    definition: 'Conclusões de curso registradas, desde o início.',
    period: 'desde o início',
    section: 'general',
  },
  certificates_ready: {
    label: 'Certificados emitidos',
    definition: 'Certificados prontos (PDF gerado), sem contar os revogados nem os substituídos.',
    period: 'agora',
    section: 'general',
  },
  certificates_failed: {
    label: 'Certificados com falha',
    definition: 'Certificados cuja geração falhou e esperam nova tentativa.',
    period: 'agora',
    section: 'general',
  },
  certificates_awaiting_name: {
    label: 'Certificados aguardando o nome',
    definition: 'Certificados parados até a pessoa confirmar o nome que sairá no documento.',
    period: 'agora',
    section: 'general',
  },
  interests_active: {
    label: 'Interesses ativos',
    definition: 'Pessoas que pediram para ser avisadas de um curso com inscrições encerradas.',
    period: 'agora',
    section: 'general',
  },
  orders_paid_30d: {
    label: 'Pedidos pagos',
    definition: 'Pedidos criados no período que estão pagos.',
    period: 'criados nos últimos 30 dias',
    section: 'finance',
  },
  orders_pending_30d: {
    label: 'Pedidos pendentes',
    definition: 'Pedidos criados no período que ainda aguardam o pagamento.',
    period: 'criados nos últimos 30 dias',
    section: 'finance',
  },
  orders_refund_requested_30d: {
    label: 'Reembolsos pedidos',
    definition: 'Pedidos criados no período com reembolso solicitado e ainda não concluído.',
    period: 'criados nos últimos 30 dias',
    section: 'finance',
  },
  orders_refunded_30d: {
    label: 'Pedidos reembolsados',
    definition: 'Pedidos criados no período que foram reembolsados.',
    period: 'criados nos últimos 30 dias',
    section: 'finance',
  },
  reports_open: {
    label: 'Denúncias abertas',
    definition: 'Mensagens de discussão com denúncia ainda não resolvida.',
    period: 'agora',
    section: 'moderation',
  },
};
