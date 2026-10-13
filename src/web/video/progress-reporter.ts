import type { PlayerEvent } from './adapter';

/**
 * Quem envia o progresso ao servidor (M5-02), puro e testável: heartbeat a cada 15 a 30 s (padrão 20 s)
 * ENQUANTO reproduz, mais um envio em `pause`, `seeked`, `ended`, aba oculta e saída da página (os dois
 * últimos pelo chamador, com `keepalive`). Cada envio leva `seq` crescente da sessão de reprodução. O
 * servidor é quem decide tudo (acesso, drip, limiar, monotonicidade): aqui só se reporta. Depois de a aula
 * concluir, ou de o acesso ser negado, para de enviar.
 */
export interface ProgressPayload {
  videoAssetId: string;
  playbackSessionId: string;
  seq: number;
  position: number;
  /** Só quando o servidor ainda não tem a duração e o player a revelou. */
  duration?: number;
}

export type SendOutcome =
  | { kind: 'ok'; completed: boolean; maxPosition: number; courseJustCompleted: boolean }
  | { kind: 'denied' }
  | { kind: 'error' };

export interface ReporterDeps {
  assetId: string;
  sessionId: string;
  /** Duração que o servidor já conhece (`null` = ainda não: enviar a observada pelo player). */
  knownDuration: number | null;
  /** Posição de partida (retomada), para um `pause` antes de qualquer `timeupdate` não regredir. */
  startPosition: number;
  send(payload: ProgressPayload, options: { keepalive: boolean }): Promise<SendOutcome>;
  onCompleted(outcome: Extract<SendOutcome, { kind: 'ok' }>): void;
  onDenied(): void;
  heartbeatMs?: number;
  setIntervalFn?: (callback: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

const DEFAULT_HEARTBEAT_MS = 20_000;

export class ProgressReporter {
  private position: number;
  private observedDuration: number | undefined;
  private playing = false;
  private seq = 0;
  private stopped = false;
  private timer: unknown;

  constructor(private readonly deps: ReporterDeps) {
    this.position = deps.startPosition;
  }

  /** Um evento NORMALIZADO do player. */
  handle(event: PlayerEvent): void {
    if (this.stopped) return;
    switch (event.type) {
      case 'timeupdate':
        this.position = event.t;
        break;
      case 'durationchange':
        this.observedDuration = event.duration;
        break;
      case 'play':
        this.playing = true;
        this.startHeartbeat();
        break;
      case 'pause':
        this.playing = false;
        this.stopHeartbeat();
        this.send(false);
        break;
      case 'seeked':
        this.position = event.t;
        this.send(false);
        break;
      case 'ended':
        this.playing = false;
        this.stopHeartbeat();
        // Sem `timeupdate` do provider, o fim vale a duração conhecida (ou a observada).
        this.position = this.deps.knownDuration ?? this.observedDuration ?? this.position;
        this.send(false);
        break;
      default:
        break;
    }
  }

  /** Aba oculta ou saída da página: envia agora, com `keepalive` (a requisição sobrevive ao descarregar). */
  flush(): void {
    if (this.stopped) return;
    this.send(true);
  }

  dispose(): void {
    this.stopped = true;
    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.timer !== undefined) return;
    const setter = this.deps.setIntervalFn ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.timer = setter(() => {
      if (this.playing) this.send(false);
    }, this.deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.timer === undefined) return;
    const clearer =
      this.deps.clearIntervalFn ?? ((handle) => globalThis.clearInterval(handle as number));
    clearer(this.timer);
    this.timer = undefined;
  }

  private send(keepalive: boolean): void {
    if (this.stopped) return;
    this.seq += 1;
    const payload: ProgressPayload = {
      videoAssetId: this.deps.assetId,
      playbackSessionId: this.deps.sessionId,
      seq: this.seq,
      position: this.position,
      ...(this.deps.knownDuration === null && this.observedDuration !== undefined
        ? { duration: this.observedDuration }
        : {}),
    };
    void this.deps.send(payload, { keepalive }).then(
      (outcome) => {
        if (this.stopped) return;
        if (outcome.kind === 'denied') {
          this.stopped = true;
          this.stopHeartbeat();
          this.deps.onDenied();
        } else if (outcome.kind === 'ok' && outcome.completed) {
          this.stopped = true;
          this.stopHeartbeat();
          this.deps.onCompleted(outcome);
        }
      },
      () => {
        // Falha de rede: o próximo envio (heartbeat, pausa ou saída) leva a posição; o servidor deduplica por seq.
      },
    );
  }
}
