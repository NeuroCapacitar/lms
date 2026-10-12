import type { SequenceMode } from '../catalog/catalog';
import type { AccessResult } from './access';

/**
 * Quem pode abrir cada aula (M3-03), pura: sem banco nem relógio. Quem chama entrega a decisão de
 * acesso do curso (`resolveAccess`), o `agora`, o currículo PUBLICADO na ordem e as aulas já
 * concluídas. O servidor decide sempre; a interface só mostra o resultado.
 */

export type LessonLockReason =
  | 'no_access'
  | 'expired'
  | 'suspended'
  | 'drip_locked'
  | 'sequence_locked'
  | 'retired';

export interface LessonAccessModule {
  id: string;
  /** D+N: dias, contados em dias civis de São Paulo, depois da âncora. */
  dripDays: number;
  lessons: { id: string; isOptional: boolean; retired?: boolean }[];
}

export interface LessonAccessInput {
  access: Pick<AccessResult, 'hasAccess' | 'reason' | 'anchorAt'>;
  now: Date;
  sequenceMode: SequenceMode;
  /** O currículo publicado, na ordem do curso (módulo e aula). */
  modules: readonly LessonAccessModule[];
  /** Ids das aulas já concluídas pela pessoa. */
  completed: ReadonlySet<string>;
}

export interface LessonDecision {
  lessonId: string;
  moduleId: string;
  allowed: boolean;
  /** `null` quando liberada. */
  reason: LessonLockReason | null;
  /** Quando o módulo libera; só em `drip_locked`. */
  releasesAt: Date | null;
}

/**
 * São Paulo não tem horário de verão desde 2019: o dia civil começa sempre às 03:00 UTC (UTC-3). Se o
 * horário de verão voltar, troque esta constante por uma consulta ao tzdata (o teste de tabela pega).
 */
const SAO_PAULO_MIDNIGHT_UTC_HOUR = 3;

const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** O dia civil de São Paulo em que o instante cai. */
function civilDate(instant: Date): { year: number; month: number; day: number } {
  const parts = SAO_PAULO_DATE.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/**
 * Quando o módulo libera: o INÍCIO (00:00, São Paulo) do dia civil da âncora mais N dias. A hora da
 * âncora não importa: quem se inscreve às 23h de segunda tem o D+1 liberado à meia-noite, não 24h
 * depois. D+0 libera no próprio dia da âncora, e portanto já está liberado.
 */
export function moduleReleaseAt(anchorAt: Date, dripDays: number): Date {
  const { year, month, day } = civilDate(anchorAt);
  return new Date(Date.UTC(year, month - 1, day + dripDays, SAO_PAULO_MIDNIGHT_UTC_HOUR));
}

/**
 * Uma decisão por aula, na ordem do curso. Ordem dos motivos: aula retirada; sem acesso ao curso
 * (`no_access`, `expired`, `suspended`: o acesso expirado bloqueia TUDO, mesmo com o módulo já
 * liberado); módulo ainda não liberado (`drip_locked`, com a data); e, no curso guiado, alguma aula
 * OBRIGATÓRIA anterior ainda não concluída (`sequence_locked`). Aula opcional nunca bloqueia as
 * seguintes; no curso livre, qualquer aula liberada abre.
 */
export function computeLessonAccess(input: LessonAccessInput): LessonDecision[] {
  const decisions: LessonDecision[] = [];
  let requiredPending = false; // alguma obrigatória (não retirada) anterior sem concluir
  for (const module of input.modules) {
    const releasesAt =
      input.access.anchorAt === null
        ? null
        : moduleReleaseAt(input.access.anchorAt, module.dripDays);
    for (const lesson of module.lessons) {
      const base = { lessonId: lesson.id, moduleId: module.id };
      if (lesson.retired) {
        decisions.push({ ...base, allowed: false, reason: 'retired', releasesAt: null });
        continue;
      }
      let decision: LessonDecision;
      if (!input.access.hasAccess) {
        const reason = input.access.reason === 'ok' ? 'no_access' : input.access.reason;
        decision = { ...base, allowed: false, reason, releasesAt: null };
      } else if (releasesAt !== null && input.now.getTime() < releasesAt.getTime()) {
        decision = { ...base, allowed: false, reason: 'drip_locked', releasesAt };
      } else if (input.sequenceMode === 'guided' && requiredPending) {
        decision = { ...base, allowed: false, reason: 'sequence_locked', releasesAt: null };
      } else {
        decision = { ...base, allowed: true, reason: null, releasesAt: null };
      }
      decisions.push(decision);
      if (!lesson.isOptional && !input.completed.has(lesson.id)) requiredPending = true;
    }
  }
  return decisions;
}
