import type { RichText } from '../content/rich-text';
import type { SequenceMode } from '../catalog/catalog';
import type { AccessDto } from './access';
import type { CourseProgress } from './progress';
import type { LessonLockReason } from './lesson-access';

/**
 * O que a pessoa matriculada recebe do servidor para estudar (M3-03). O mapa do curso traz TÍTULOS e
 * o estado de cada aula, nunca o conteúdo; o conteúdo só vem de `LessonViewDto`, e só quando o
 * servidor liberou a aula. Aula bloqueada nunca tem corpo.
 */

export interface OutlineLessonDto {
  id: string;
  title: string;
  isOptional: boolean;
  completed: boolean;
  /** `null` = liberada. */
  locked: LessonLockReason | null;
  /** ISO 8601; só quando `locked` é `drip_locked`. */
  releasesAt: string | null;
}

interface OutlineModuleDto {
  id: string;
  title: string;
  /** Quando o módulo libera (ISO 8601): no passado ou hoje = já liberado. */
  releasesAt: string;
  lessons: OutlineLessonDto[];
}

export interface CourseOutlineDto {
  course: { id: string; title: string; sequenceMode: SequenceMode };
  access: AccessDto;
  /** Progresso das aulas OBRIGATÓRIAS (as opcionais ficam fora do cálculo). */
  progress: CourseProgress;
  /** Quando o curso foi concluído (ISO 8601), ou `null`. Histórico: não some se o currículo mudar. */
  completedAt: string | null;
  modules: OutlineModuleDto[];
  /** `true` só na prévia da Staff (M3-07): nada é gravado e drip, sequência e direito são ignorados. */
  preview?: true;
}

interface LessonNeighborDto {
  id: string;
  title: string;
}

/**
 * O vídeo de uma aula como o PLAYER precisa (M5-02): o provider e o id público do vídeo (para montar o
 * embed de um host da allowlist), a duração conhecida, o que o adapter declara e o ponto de retomada.
 * Nunca traz segredo de conexão nem credencial.
 */
export interface LessonVideoDto {
  assetId: string;
  provider: string;
  externalId: string;
  /** `null` enquanto o provider ainda não a informou (o player a revela e o servidor congela a primeira). */
  durationSeconds: number | null;
  capabilities: Record<string, boolean>;
  /** A maior posição já alcançada (segundos): de onde retomar. */
  maxPosition: number;
  /** Percentual que conclui a aula (limiar do curso). */
  completionPercent: number;
}

export interface LessonViewDto {
  course: { id: string; title: string };
  lesson: {
    id: string;
    title: string;
    isOptional: boolean;
    body: RichText | null;
    /** Ausente = aula de texto. */
    kind?: 'text' | 'video';
    /** Só na aula de vídeo. */
    video?: LessonVideoDto;
  };
  completed: boolean;
  /** Aulas vizinhas na ordem do curso (só id e título; abrir uma bloqueada é recusado pelo servidor). */
  previous: LessonNeighborDto | null;
  next: LessonNeighborDto | null;
  /** `true` só na prévia da Staff (M3-07). */
  preview?: true;
}
