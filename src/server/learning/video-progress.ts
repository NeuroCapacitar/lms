import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, lesson, videoAsset, videoProgress } from '../../db/schema';
import type { LessonVideoDto } from '../../features/access/outline';
import {
  DEFAULT_VIDEO_COMPLETION_PERCENT,
  decideProgress,
  plausibleDuration,
  type VideoProgressReport,
} from '../../features/video/progress';
import {
  loadLessonContext,
  recordCompletion,
  type CompleteResult,
  LessonNotFoundError,
} from './completion';

/** O `videoAssetId` do envio não é o vídeo desta aula (aula trocada depois de a página abrir, ou forjado). */
export class VideoAssetMismatchError extends Error {
  constructor() {
    super('video_asset_mismatch');
  }
}

/** O vídeo ainda não está pronto, ou a duração é desconhecida e o player não a informou: não há o que medir. */
export class VideoNotMeasurableError extends Error {
  constructor(readonly reason: 'not_ready' | 'duration_unknown') {
    super(`video_not_measurable:${reason}`);
  }
}

export interface VideoProgressResult {
  /** `ignored`: chegou repetido ou fora de ordem, ou a aula já estava concluída; nada foi gravado. */
  status: 'updated' | 'ignored';
  maxPosition: number;
  durationSeconds: number;
  completed: boolean;
  /** Preenchido só na chamada que CONCLUIU a aula (e, com ela, talvez o curso). */
  completion?: CompleteResult;
}

/**
 * Registra o progresso de uma aula de vídeo (M5-02), tudo numa transação. A cada requisição REVERIFICA o
 * acesso, o drip e a sequência (a mesma decisão do mapa e da conclusão de texto; matrícula travada, então
 * acesso expirado ou suspenso no meio da reprodução é recusado SEM gravar). Guarda a MAIOR posição
 * (monotônica, limitada a [0, duração]), ignora `seq` repetido ou menor na mesma sessão e conclui, de forma
 * idempotente e com EVIDÊNCIA (provider, asset, posição, duração, hora do servidor), quando
 * `maior / duração` alcança o limiar do curso (padrão 90%). Staff sem matrícula é recusada como qualquer
 * pessoa sem acesso: a prévia da Staff nunca grava progresso.
 */
export async function reportVideoProgress(
  db: Database,
  input: { userId: string; lessonId: string; report: VideoProgressReport; clock?: () => Date },
): Promise<VideoProgressResult> {
  return db.transaction(async (tx) => {
    const context = await loadLessonContext(tx, {
      userId: input.userId,
      lessonId: input.lessonId,
      kind: 'video',
      clock: input.clock,
    });

    const [row] = await tx
      .select({
        videoAssetId: lesson.videoAssetId,
        percent: course.videoCompletionPercent,
      })
      .from(lesson)
      .innerJoin(course, eq(course.id, lesson.courseId))
      .where(eq(lesson.id, input.lessonId));
    if (!row?.videoAssetId) throw new LessonNotFoundError();
    if (input.report.videoAssetId !== row.videoAssetId) throw new VideoAssetMismatchError();

    const [asset] = await tx
      .select({
        id: videoAsset.id,
        provider: videoAsset.provider,
        state: videoAsset.state,
        durationSeconds: videoAsset.durationSeconds,
      })
      .from(videoAsset)
      .where(eq(videoAsset.id, row.videoAssetId))
      // FOR SHARE (M9-07): todas as pessoas no MESMO vídeo leem este registro; com FOR UPDATE elas entravam em fila uma atrás da outra
      // (20 heartbeats simultâneos levavam 2,9 vezes um sozinho, só pelo travamento). SHARE ainda protege contra mudança concorrente do
      // registro (estado, duração); quem congela a duração faz um UPDATE condicional, que espera os SHARE e segue seguro.
      .for('share');
    if (!asset) throw new LessonNotFoundError();
    if (asset.state !== 'ready') throw new VideoNotMeasurableError('not_ready');

    // A duração vem do provider. Se ainda não há, aceita-se o PRIMEIRO valor plausível do player e congela.
    let duration = asset.durationSeconds;
    if (duration === null) {
      const observed = plausibleDuration(input.report.duration);
      if (observed === undefined) throw new VideoNotMeasurableError('duration_unknown');
      const frozen = await tx
        .update(videoAsset)
        .set({ durationSeconds: observed, updatedAt: sql`now()` })
        .where(and(eq(videoAsset.id, asset.id), sql`${videoAsset.durationSeconds} is null`))
        .returning({ durationSeconds: videoAsset.durationSeconds });
      duration = frozen[0]?.durationSeconds ?? observed;
    }

    const [existing] = await tx
      .select()
      .from(videoProgress)
      .where(
        and(eq(videoProgress.userId, input.userId), eq(videoProgress.lessonId, input.lessonId)),
      )
      .for('update');
    // Trocaram o vídeo da aula e a pessoa ainda não tinha concluído: o progresso recomeça no vídeo novo.
    const sameAsset = existing?.videoAssetId === asset.id;
    const state = {
      maxPosition: existing && sameAsset ? existing.maxPosition : 0,
      lastSessionId: existing && sameAsset ? existing.lastSessionId : null,
      lastSeq: existing && sameAsset ? existing.lastSeq : 0,
      completed: existing?.completedAt != null,
    };
    // Concluída: o que vale é a conclusão registrada (append-only), mesmo que o vídeo tenha sido trocado.
    if (state.completed && existing) {
      return {
        status: 'ignored',
        maxPosition: existing.maxPosition,
        durationSeconds: existing.durationSeconds,
        completed: true,
      };
    }

    const decision = decideProgress(
      state,
      input.report,
      duration,
      row.percent ?? DEFAULT_VIDEO_COMPLETION_PERCENT,
    );
    if (decision.kind === 'ignored') {
      return {
        status: 'ignored',
        maxPosition: state.maxPosition,
        durationSeconds: duration,
        completed: decision.reason === 'already_completed',
      };
    }

    const values = {
      videoAssetId: asset.id,
      maxPosition: decision.maxPosition,
      durationSeconds: duration,
      lastSessionId: input.report.playbackSessionId,
      lastSeq: input.report.seq,
    };
    if (existing) {
      await tx
        .update(videoProgress)
        .set({ ...values, updatedAt: sql`now()` })
        .where(
          and(eq(videoProgress.userId, input.userId), eq(videoProgress.lessonId, input.lessonId)),
        );
    } else {
      await tx.insert(videoProgress).values({
        userId: input.userId,
        lessonId: input.lessonId,
        courseId: context.courseId,
        ...values,
      });
    }

    if (!decision.completes) {
      return {
        status: 'updated',
        maxPosition: decision.maxPosition,
        durationSeconds: duration,
        completed: false,
      };
    }

    // Alcançou o limiar: conclusão idempotente (única por pessoa e aula) com a evidência.
    await tx
      .update(videoProgress)
      .set({
        completedAt: context.now,
        evidence: {
          provider: asset.provider,
          videoAssetId: asset.id,
          position: decision.maxPosition,
          duration,
          percent: row.percent,
          serverTime: context.now.toISOString(),
        },
      })
      .where(
        and(eq(videoProgress.userId, input.userId), eq(videoProgress.lessonId, input.lessonId)),
      );
    const completion = await recordCompletion(tx, context, {
      userId: input.userId,
      lessonId: input.lessonId,
      method: 'video',
    });
    return {
      status: 'updated',
      maxPosition: decision.maxPosition,
      durationSeconds: duration,
      completed: true,
      completion,
    };
  });
}

/**
 * O vídeo da aula para o player. Com `userId`, traz o ponto de retomada (maior posição) da pessoa; sem ele
 * (prévia da Staff) a retomada é 0 e nada da pessoa é lido.
 */
export async function loadVideoView(
  db: Database,
  input: { assetId: string; courseId: string; lessonId?: string; userId?: string },
): Promise<LessonVideoDto> {
  const [asset] = await db
    .select({
      id: videoAsset.id,
      provider: videoAsset.provider,
      externalId: videoAsset.externalId,
      durationSeconds: videoAsset.durationSeconds,
      capabilities: videoAsset.capabilities,
    })
    .from(videoAsset)
    .where(eq(videoAsset.id, input.assetId));
  const [courseRow] = await db
    .select({ percent: course.videoCompletionPercent })
    .from(course)
    .where(eq(course.id, input.courseId));
  let maxPosition = 0;
  if (input.userId && input.lessonId) {
    const [progress] = await db
      .select({ maxPosition: videoProgress.maxPosition, assetId: videoProgress.videoAssetId })
      .from(videoProgress)
      .where(
        and(eq(videoProgress.userId, input.userId), eq(videoProgress.lessonId, input.lessonId)),
      );
    if (progress && progress.assetId === input.assetId) maxPosition = progress.maxPosition;
  }
  const declared = (asset?.capabilities ?? {}) as Record<string, unknown>;
  return {
    assetId: input.assetId,
    provider: asset?.provider ?? '',
    externalId: asset?.externalId ?? '',
    durationSeconds: asset?.durationSeconds ?? null,
    // Só o que o adapter DECLAROU como verdadeiro; nada é presumido.
    capabilities: Object.fromEntries(
      Object.entries(declared).filter((entry): entry is [string, boolean] => entry[1] === true),
    ),
    maxPosition,
    completionPercent: courseRow?.percent ?? DEFAULT_VIDEO_COMPLETION_PERCENT,
  };
}
