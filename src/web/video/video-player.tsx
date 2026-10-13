import { useEffect, useMemo, useRef, useState } from 'react';

import type { LessonVideoDto } from '../../features/access/outline';
import { sendVideoProgress } from '../api/learning';
import { Button } from '../components/ui/button';
import { isAllowedEmbed, type PlayerEvent } from './adapter';
import { ProgressReporter, type SendOutcome } from './progress-reporter';
import { getVideoAdapter } from './registry';

/** Segundos de contagem antes de ir para a próxima aula (autoavanço). */
const AUTO_ADVANCE_SECONDS = 5;

interface VideoPlayerProps {
  lessonId: string;
  video: LessonVideoDto;
  /** Prévia da Staff: o vídeo toca, mas NADA é enviado nem gravado. */
  preview: boolean;
  /** Preferência da pessoa (padrão DESLIGADA). Só vale com `reportsEnded` confiável. */
  autoAdvance: boolean;
  next: { id: string; title: string } | null;
  onCompleted: (outcome: Extract<SendOutcome, { kind: 'ok' }>) => void;
  onNext: () => void;
}

/**
 * Player de aula de vídeo (M5-02): UM iframe de UM adapter, com a mensagem validada por `event.origin` E
 * `event.source` (a do iframe DESTA aula) antes de qualquer tradução. Reporta o progresso pelo
 * `ProgressReporter` (heartbeat, pausa, seek, fim, aba oculta e saída da página) e deixa a conclusão para o
 * servidor: não há botão de concluir vídeo. Autoavanço: só em `ended` de adapter que o declara confiável,
 * opt-in, com contagem cancelável e SEM autoplay da próxima aula; sem `reportsEnded` há o botão manual.
 */
export function VideoPlayer({
  lessonId,
  video,
  preview,
  autoAdvance,
  next,
  onCompleted,
  onNext,
}: VideoPlayerProps) {
  const adapter = getVideoAdapter(video.provider);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [denied, setDenied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const reporterRef = useRef<ProgressReporter | null>(null);
  const callbacks = useRef({ onCompleted, onNext });
  callbacks.current = { onCompleted, onNext };

  const embed = useMemo(() => {
    if (!adapter) return undefined;
    const built = adapter.buildEmbed({
      externalId: video.externalId,
      startAt: adapter.capabilities.resume ? video.maxPosition : 0,
    });
    // Nunca um iframe com URL arbitrária: o host precisa estar na allowlist do adapter.
    return isAllowedEmbed(built.src, adapter.allowedHosts) ? built : undefined;
    // `video.maxPosition` é só a posição INICIAL: mudar o src no meio da reprodução recarregaria o vídeo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, video.assetId, video.externalId]);

  useEffect(() => {
    if (!adapter || !embed) return undefined;
    const sessionId = crypto.randomUUID();
    const reporter = preview
      ? undefined
      : new ProgressReporter({
          assetId: video.assetId,
          sessionId,
          knownDuration: video.durationSeconds,
          startPosition: video.maxPosition,
          send: (payload, options) => sendVideoProgress(lessonId, payload, options),
          onCompleted: (outcome) => callbacks.current.onCompleted(outcome),
          onDenied: () => setDenied(true),
        });
    reporterRef.current = reporter ?? null;

    function onMessage(event: MessageEvent) {
      // As DUAS conferências, antes de olhar o conteúdo: origem do provider e o iframe desta aula.
      if (event.origin !== embed!.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const normalized: PlayerEvent | undefined = adapter!.normalize(event);
      if (!normalized) return;
      reporter?.handle(normalized);
      if (
        normalized.type === 'ended' &&
        !preview &&
        autoAdvance &&
        adapter!.capabilities.reportsEnded &&
        next
      ) {
        setCountdown(AUTO_ADVANCE_SECONDS);
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') reporter?.flush();
    }
    function onPageHide() {
      reporter?.flush();
    }
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // Ao sair da aula (navegação dentro do app) também envia o que falta.
      reporter?.flush();
      reporter?.dispose();
      reporterRef.current = null;
    };
    // O reporter vive enquanto a aula e o vídeo forem os mesmos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, embed, lessonId, video.assetId, preview, autoAdvance, next?.id]);

  // A contagem do autoavanço: um tique por segundo, cancelável; na virada vai à próxima aula (o servidor
  // confere o drip e a sequência ao abri-la).
  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown === 0) {
      setCountdown(null);
      callbacks.current.onNext();
      return undefined;
    }
    const timer = setTimeout(
      () => setCountdown((value) => (value === null ? null : value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [countdown]);

  if (!adapter || !embed) {
    return (
      <p role="status" className="max-w-prose rounded-lg border p-4">
        Este vídeo ainda não está disponível nesta versão da plataforma.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {preview ? (
        <p className="text-sm text-[var(--text-muted)]">Na prévia o progresso não é gravado.</p>
      ) : null}
      <div className="aspect-video w-full max-w-3xl overflow-hidden rounded-lg border">
        <iframe
          ref={iframeRef}
          title="Vídeo da aula"
          src={embed.src}
          className="size-full"
          allow="fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation"
        />
      </div>
      {denied ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Seu acesso a esta aula mudou e o progresso deste vídeo não pôde ser salvo. Recarregue a
          página.
        </p>
      ) : null}
      {countdown !== null ? (
        <div role="status" className="flex flex-wrap items-center gap-3">
          <span>
            Próxima aula em {countdown} s: {next?.title}
          </span>
          <Button type="button" variant="secondary" onClick={() => setCountdown(null)}>
            Cancelar
          </Button>
        </div>
      ) : null}
      {!adapter.capabilities.reportsEnded && next ? (
        <div>
          <Button type="button" variant="secondary" onClick={onNext}>
            Próxima aula
          </Button>
        </div>
      ) : null}
    </div>
  );
}
