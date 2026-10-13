import { z } from 'zod';

/**
 * Contrato de progresso de vídeo (M5-02), puro: sem rede, banco nem Hono. Regras (spec de contratos §6):
 * a duração vem do PROVIDER (nunca do cliente, salvo o primeiro valor plausível quando o provider só a
 * revela pelo player); a posição é limitada a `[0, duração]`; guarda-se a MAIOR posição (monotônica);
 * `seq` menor ou igual ao último da MESMA sessão é ignorado; conclui com `maior / duração ≥ limiar` do
 * curso (padrão 90%). Seek é permitido: não há anti-seek nem botão manual de conclusão para vídeo.
 */
export const DEFAULT_VIDEO_COMPLETION_PERCENT = 90;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 86_400;

export const videoProgressSchema = z.strictObject({
  videoAssetId: z.uuid(),
  /** Uma por reprodução (aba). Só letras, números e hífen. */
  playbackSessionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  /** Sequência crescente dentro da sessão. */
  seq: z.number().int().min(0).max(1_000_000_000),
  /** Segundos desde o início. Fração é aceita e descartada. */
  position: z
    .number()
    .finite()
    .min(0)
    .max(MAX_DURATION_SECONDS * 2),
  /**
   * Duração observada no player. SÓ vale se o `VideoAsset` ainda não tem duração (provider que a revela
   * pelo player): o primeiro valor plausível é gravado e congela. Com a duração conhecida é ignorada.
   */
  duration: z
    .number()
    .finite()
    .min(0)
    .max(MAX_DURATION_SECONDS * 2)
    .optional(),
});

export type VideoProgressReport = z.infer<typeof videoProgressSchema>;

export interface VideoProgressState {
  maxPosition: number;
  lastSessionId: string | null;
  lastSeq: number;
  completed: boolean;
}

export type ProgressDecision =
  /** Nada a gravar. `stale_seq`: chegou fora de ordem ou repetido; `already_completed`: já concluída. */
  | { kind: 'ignored'; reason: 'stale_seq' | 'already_completed' }
  | {
      kind: 'update';
      /** Nova maior posição (segundos inteiros), nunca menor que a anterior. */
      maxPosition: number;
      /** Esta atualização alcança o limiar: a aula conclui AGORA (idempotente no servidor). */
      completes: boolean;
    };

/** Duração plausível (segundos inteiros) ou `undefined`. */
export function plausibleDuration(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Math.floor(value);
  return seconds >= MIN_DURATION_SECONDS && seconds <= MAX_DURATION_SECONDS ? seconds : undefined;
}

/**
 * Limiar alcançado? Aritmética inteira (sem ponto flutuante): `maior * 100 ≥ duração * percentual`.
 * 89% não conclui e 90% conclui; a posição já vem arredondada PARA BAIXO, então nunca conclui antes da hora.
 */
export function reachedThreshold(
  maxPosition: number,
  durationSeconds: number,
  percent: number = DEFAULT_VIDEO_COMPLETION_PERCENT,
): boolean {
  return durationSeconds > 0 && maxPosition * 100 >= durationSeconds * percent;
}

export function decideProgress(
  state: VideoProgressState,
  report: Pick<VideoProgressReport, 'playbackSessionId' | 'seq' | 'position'>,
  durationSeconds: number,
  percent: number = DEFAULT_VIDEO_COMPLETION_PERCENT,
): ProgressDecision {
  if (state.completed) return { kind: 'ignored', reason: 'already_completed' };
  // A ordem só vale dentro da MESMA sessão (duas abas têm sessões e contadores próprios).
  if (state.lastSessionId === report.playbackSessionId && report.seq <= state.lastSeq) {
    return { kind: 'ignored', reason: 'stale_seq' };
  }
  const clamped = Math.min(Math.max(Math.floor(report.position), 0), durationSeconds);
  const maxPosition = Math.max(state.maxPosition, clamped);
  return {
    kind: 'update',
    maxPosition,
    completes: reachedThreshold(maxPosition, durationSeconds, percent),
  };
}
