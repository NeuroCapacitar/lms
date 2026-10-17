/**
 * Analytics first-party (M9-02): FATOS DERIVADOS de dados que já existem (matrículas, conclusões, progresso de vídeo, tentativas de quiz,
 * interesses, pedidos). Nenhum evento novo é coletado e nenhuma tabela de eventos brutos existe. São fatos operacionais
 * IDENTIFICÁVEIS (ligados a pessoas matriculadas), não "anônimos": aqui só saem contagens, mas a base é por pessoa. Nada aqui afirma
 * causalidade (um aviso não "causa" uma compra). Cada número vem com a definição escrita.
 */
export const FUNNEL_WINDOW_DAYS = 90;

export interface AnalyticsDefinitions {
  withAccess: string;
  inactive: string;
  progress: string;
  lessonCompletion: string;
  videoPosition: string;
  quiz: string;
}

/** Textos de definição, fonte única (a tela os mostra e o teste os confere). */
export const LEARNING_DEFINITIONS: AnalyticsDefinitions = {
  withAccess:
    'Pessoas com acesso em vigor agora: direito não revogado e dentro da janela, matrícula e conta não suspensas.',
  inactive:
    'Das pessoas com acesso, as sem nenhuma atividade (aula concluída, vídeo assistido ou tentativa de quiz) há 14 dias ou mais, ou há 30 dias ou mais. Quem nunca teve atividade conta desde a matrícula. Quem tem 30 dias também está nos 14.',
  progress:
    'Das pessoas com acesso, a parte das aulas obrigatórias (não retiradas) que cada uma concluiu, em faixas.',
  lessonCompletion:
    'Pessoas que concluíram a aula, sobre todas as pessoas matriculadas no curso (inclusive quem já perdeu o acesso).',
  videoPosition:
    'Entre quem começou o vídeo, até que ponto chegou (maior posição já alcançada, sobre a duração). É a posição, não o tempo assistido.',
  quiz: 'Pessoas que tentaram o quiz, tentativas feitas e pessoas que passaram em pelo menos uma tentativa.',
};

export const PROGRESS_BANDS = ['0%', 'de 1% a 49%', 'de 50% a 99%', '100%'] as const;
export const VIDEO_BANDS = ['até 25%', 'de 25% a 50%', 'de 50% a 75%', '75% ou mais'] as const;

export interface LessonAnalytics {
  lessonId: string;
  title: string;
  kind: 'text' | 'video' | 'quiz';
  isOptional: boolean;
  /** Pessoas que concluíram a aula. */
  completions: number;
  /** Só vídeo: quantas pessoas começaram e a distribuição da maior posição (4 faixas, na ordem de {@link VIDEO_BANDS}). */
  video: { started: number; completed: number; bands: [number, number, number, number] } | null;
  /** Só quiz. */
  quiz: { attemptedPeople: number; attempts: number; passedPeople: number } | null;
}

export interface CourseAnalyticsDto {
  generatedAt: string;
  course: { id: string; title: string };
  /** Todas as pessoas matriculadas (denominador das conclusões por aula). */
  enrolled: number;
  withAccess: number;
  inactive: { days14: number; days30: number };
  /** Contagem por faixa, na ordem de {@link PROGRESS_BANDS}; `null` quando o curso não tem aula obrigatória. */
  progressBands: [number, number, number, number] | null;
  requiredLessons: number;
  lessons: LessonAnalytics[];
  definitions: AnalyticsDefinitions;
}

export interface OfferFunnelRow {
  offerId: string;
  offerName: string;
  courseId: string;
  courseTitle: string;
  kind: 'free' | 'paid';
  status: string;
  /** Pedidos criados na janela (só oferta paga tem pedido). */
  ordersCreated: number;
  /** Pedidos que chegaram a abrir um checkout (existe sessão de checkout). */
  checkoutsOpened: number;
  /** Pedidos pagos em algum momento (inclui os depois reembolsados ou contestados). */
  paid: number;
  expired: number;
  canceled: number;
  pending: number;
  refunded: number;
}

export interface InterestConversionRow {
  courseId: string;
  courseTitle: string;
  total: number;
  active: number;
  withdrawn: number;
  converted: number;
}

export interface OfferAnalyticsDto {
  generatedAt: string;
  windowDays: number;
  offers: OfferFunnelRow[];
  interests: InterestConversionRow[];
  definitions: { funnel: string; interests: string; causality: string };
}

export const OFFER_DEFINITIONS: OfferAnalyticsDto['definitions'] = {
  funnel:
    'Pedidos criados nos últimos 90 dias, por oferta paga: quantos abriram o checkout e quantos foram pagos (em algum momento), expiraram, foram cancelados ou seguem pendentes; os reembolsados já estão entre os pagos.',
  interests:
    'Pedidos de aviso de curso com inscrições encerradas, desde o início: ativos, retirados e convertidos (a pessoa se inscreveu depois).',
  causality:
    'São contagens do que aconteceu, uma ao lado da outra. Não indicam que um aviso, um e-mail ou uma oferta causou a compra.',
};
