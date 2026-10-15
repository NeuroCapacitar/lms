import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import {
  evaluateOfflineLease,
  leaseUntilOnDeviceClock,
  type OfflineLeaseDto,
} from '../../features/pwa/offline-lease';
import {
  MAX_SYNC_BATCH,
  type OfflineOperation,
  type RejectionReason,
  type SyncResultItem,
} from '../../features/pwa/offline-sync';
import type { MyCertificateDto } from '../../features/certificate/lifecycle';
import type { OutboxItem, OutboxStore } from './outbox';
import type { OfflineIndex, OfflineStore, PendingSignOut, StoredLease } from './store';

/** Quanto tempo uma verificação online recente dispensa outra (cada aula aberta não chama o servidor de novo). */
const FRESH_MS = 30 * 60 * 1000;
/** Acima desta fração da cota do navegador, não se guarda mais nada (o app segue funcionando online). */
const QUOTA_LIMIT = 0.9;

export type Identity = { kind: 'user'; userId: string } | { kind: 'anonymous' };
export type LeaseFetch =
  | { kind: 'ok'; lease: OfflineLeaseDto }
  /** O servidor recusou (conta com papel de Staff): nada é guardado e o que houver é apagado. */
  | { kind: 'unavailable' };

/** Por que o aparelho foi limpo: saída da conta, outra pessoa entrou ou a sessão acabou (expirou, foi revogada, suspensa). */
export type PurgeReason = 'sign_out' | 'account_changed' | 'session_ended';

/** `done`: sessão encerrada (ou já não existia). `network`: sem rede. `error`: o servidor recusou ou falhou. */
export type SignOutOutcome = 'done' | 'network' | 'error';

/** O que o servidor respondeu ao lote do outbox. Falha de REDE lança. */
export type SyncCall =
  | { kind: 'ok'; results: SyncResultItem[] }
  | { kind: 'unauthenticated' }
  /** A sessão é de OUTRA pessoa que não a dona do outbox: nada foi aplicado. */
  | { kind: 'wrong_account' }
  | { kind: 'error' };

export type SyncSummary =
  | { kind: 'synced'; applied: number; rejected: number }
  | { kind: 'nothing' }
  /** Já havia uma sincronização em andamento nesta aba. */
  | { kind: 'busy' }
  /** "Sair" pendente: nada é enviado até a sessão ser revogada. */
  | { kind: 'skipped' }
  | { kind: 'no_session' }
  | { kind: 'wrong_account' }
  | { kind: 'offline' }
  | { kind: 'failed' };

export interface OutboxSummary {
  pending: OutboxItem[];
  rejected: OutboxItem[];
}

export interface OfflineDeps {
  now(): number;
  newId(): string;
  openOutbox(userId: string): Promise<OutboxStore>;
  outboxExists(userId: string): Promise<boolean>;
  /** Há outbox de QUALQUER conta neste aparelho? (ex.: depois de a sessão acabar, o ponteiro some mas o outbox fica). */
  anyOutbox(): Promise<boolean>;
  deleteOutbox(userId: string): Promise<void>;
  postSync(input: { expectedUserId: string; operations: OfflineOperation[] }): Promise<SyncCall>;
  /** Avisa as telas (e as outras abas) de que o outbox mudou. */
  notifyOutboxChanged?(): void;
  /** O servidor APLICOU conclusões: as telas de estudo relêem o progresso. */
  notifyApplied?(): void;
  /** Marca "ocupado" (fronteira segura de atualização) enquanto sincroniza; devolve quem libera. */
  busy?(reason: string): () => void;
  /** Lança em falha de REDE. */
  fetchIdentity(): Promise<Identity>;
  /** Lança em falha de REDE. */
  fetchLease(): Promise<LeaseFetch>;
  index: OfflineIndex;
  openStore(userId: string): Promise<OfflineStore>;
  /** Apaga TUDO que é de uma pessoa neste aparelho e avisa as outras abas. Nunca lança. */
  purgeLocal(reason: PurgeReason): Promise<void>;
  requestSignOut(): Promise<SignOutOutcome>;
  pendingSignOut: PendingSignOut;
  /** Cota do navegador, se ele a informa. */
  storageEstimate?(): Promise<{ usage?: number; quota?: number } | undefined>;
  requestPersistence?(): Promise<unknown>;
  /** A lista de certificados da pessoa; `null` = sem sessão (401). Lança em falha de REDE. */
  fetchCertificates(): Promise<MyCertificateDto[] | null>;
  /** O PDF do dono (`sha256` = o hash que o servidor conferiu, se mandou). Lança em falha de REDE. */
  fetchCertificatePdf(id: string): Promise<CertificatePdfFetch>;
  sha256(bytes: ArrayBuffer): Promise<string>;
}

export type CertificatePdfFetch =
  | { kind: 'ok'; bytes: ArrayBuffer; sha256: string | null }
  /** 404: não é dele, não está pronto, foi revogado ou substituído. */
  | { kind: 'not_available' }
  | { kind: 'unauthenticated' }
  | { kind: 'error' };

export type CertificatesRead =
  | { kind: 'ok'; items: MyCertificateDto[]; verifiedAt: number; pdfIds: string[] }
  | { kind: 'blocked'; reason: 'no_user' | 'not_saved' };

export type PdfSaveOutcome =
  | 'saved'
  | 'not_available'
  | 'unauthenticated'
  /** O hash do arquivo recebido não bate com o que o servidor conferiu: nada é guardado. */
  | 'integrity_failed'
  | 'failed';

export type PdfOpenOutcome =
  | { kind: 'ok'; bytes: ArrayBuffer; filename: string }
  /** Nunca foi guardado (ou já foi removido). */
  | { kind: 'missing' }
  /** O arquivo guardado foi alterado: o hash recalculado não bate; a cópia foi DESCARTADA. */
  | { kind: 'tampered' }
  /** A lista guardada já diz que não está mais pronto (revogado ou substituído): a cópia foi removida. */
  | { kind: 'not_ready' };

export type BlockedReason =
  /** Ninguém usou o app online neste aparelho (ou o ponteiro foi apagado). */
  | 'no_user'
  /** Nunca houve verificação online para este curso (ou ela foi apagada). */
  | 'no_lease'
  | 'lease_expired'
  | 'clock_suspect'
  /** Há lease, mas esta aula/mapa nunca foi guardado (não foi visitado ou não é de texto). */
  | 'not_saved';

export type OfflineRead<T> =
  | { kind: 'ok'; data: T; leaseUntil: number; savedAt: number; savedLessonIds?: string[] }
  | { kind: 'blocked'; reason: BlockedReason };

export type VerifyOutcome =
  | { kind: 'verified'; userId: string; courses: number }
  /** Sem sessão agora. Se havia dados de alguém neste aparelho, foram apagados (`session_ended`). */
  | { kind: 'anonymous' }
  | { kind: 'unavailable' };

/** Só aula de TEXTO liberada vale ser guardada (vídeo nunca; quiz é só online). */
function isStorable(view: LessonViewDto): boolean {
  return view.preview !== true && (view.lesson.kind === undefined || view.lesson.kind === 'text');
}

/**
 * O núcleo do offline do aluno (M8-02), sem navegador direto: tudo o que toca rede, relógio e IndexedDB entra por `deps`.
 * Escrever é "melhor esforço" (nunca lança para a tela); ler decide pelo lease e pelo relógio, nessa ordem de cuidado.
 */
export function createOfflineService(deps: OfflineDeps) {
  let persistenceRequested = false;
  let syncing = false;

  const toWire = (item: OutboxItem): OfflineOperation => ({
    clientOperationId: item.clientOperationId,
    command: item.command,
    lessonId: item.lessonId,
    clientCreatedAt: new Date(item.createdAt).toISOString(),
  });

  /**
   * Envia o outbox da pessoa que está com a sessão AGORA (M8-03), em lotes e na ordem em que foram feitos. Só envia se a sessão for da
   * DONA do outbox (confere a identidade antes e manda `expectedUserId`, que o servidor também confere). Aplicado ou duplicado sai do
   * outbox; recusado fica VISÍVEL com o motivo; falha de rede, 401 e erro do servidor MANTÊM tudo para a próxima tentativa. Nunca lança.
   */
  async function syncOutbox(knownUserId?: string): Promise<SyncSummary> {
    if (syncing) return { kind: 'busy' };
    syncing = true;
    let release: (() => void) | undefined;
    try {
      if (await deps.pendingSignOut.isPending()) return { kind: 'skipped' };
      let userId = knownUserId;
      if (userId === undefined) {
        const identity = await deps.fetchIdentity();
        if (identity.kind === 'anonymous') return { kind: 'no_session' };
        userId = identity.userId;
      }
      if (!(await deps.outboxExists(userId))) return { kind: 'nothing' };
      const outbox = await deps.openOutbox(userId);
      try {
        let applied = 0;
        let rejected = 0;
        let sentAny = false;
        // Teto de rodadas: um servidor que nunca resolve não prende o app num laço.
        for (let round = 0; round < 10; round += 1) {
          const batch = (await outbox.list())
            .filter((item) => item.state === 'pending')
            .slice(0, MAX_SYNC_BATCH);
          if (batch.length === 0) break;
          release ??= deps.busy?.('sincronizando conclusões');
          sentAny = true;
          const ids = batch.map((item) => item.clientOperationId);
          let call: SyncCall;
          try {
            call = await deps.postSync({
              expectedUserId: userId,
              operations: batch.map(toWire),
            });
          } catch {
            await outbox.bumpAttempts(ids);
            return { kind: 'offline' };
          }
          if (call.kind === 'unauthenticated') return { kind: 'no_session' };
          if (call.kind === 'wrong_account') return { kind: 'wrong_account' };
          if (call.kind === 'error') {
            await outbox.bumpAttempts(ids);
            return { kind: 'failed' };
          }
          const done: string[] = [];
          const answered = new Set<string>();
          for (const result of call.results) {
            const item = batch[result.index];
            if (!item) continue;
            answered.add(item.clientOperationId);
            const accepted =
              result.status === 'applied' ||
              (result.status === 'duplicate' && result.original === 'applied');
            if (accepted) {
              done.push(item.clientOperationId);
              applied += 1;
              continue;
            }
            const reason: RejectionReason = result.reason ?? 'invalid_payload';
            await outbox.markRejected(item.clientOperationId, reason);
            rejected += 1;
          }
          await outbox.remove(done);
          if (done.length > 0) deps.notifyApplied?.();
          // Sem resposta para algum item: continua pendente (a próxima tentativa decide).
          const unanswered = ids.filter((id) => !answered.has(id));
          if (unanswered.length > 0) {
            await outbox.bumpAttempts(unanswered);
            return { kind: 'failed' };
          }
        }
        return sentAny ? { kind: 'synced', applied, rejected } : { kind: 'nothing' };
      } finally {
        outbox.close();
      }
    } catch {
      // Sem rede (ou erro inesperado): tudo fica no outbox.
      return { kind: 'offline' };
    } finally {
      release?.();
      syncing = false;
      deps.notifyOutboxChanged?.();
    }
  }

  /** O outbox da pessoa conhecida neste aparelho: o que espera envio e o que o servidor recusou (e ela ainda não leu). */
  async function outboxSummary(): Promise<OutboxSummary> {
    try {
      const userId = await deps.index.get();
      if (!userId || !(await deps.outboxExists(userId))) return { pending: [], rejected: [] };
      const outbox = await deps.openOutbox(userId);
      try {
        const items = await outbox.list();
        return {
          pending: items.filter((item) => item.state === 'pending'),
          rejected: items.filter((item) => item.state === 'rejected'),
        };
      } finally {
        outbox.close();
      }
    } catch {
      return { pending: [], rejected: [] };
    }
  }

  async function storeForCurrentUser(): Promise<{ userId: string; store: OfflineStore } | null> {
    const userId = await deps.index.get();
    if (!userId) return null;
    return { userId, store: await deps.openStore(userId) };
  }

  /** Verificação online: quem é a pessoa agora e quais cursos têm lease. Falha de rede propaga (o chamador decide). */
  async function verify(): Promise<VerifyOutcome> {
    // "Sair" feito sem rede ainda não revogou a sessão: primeiro isso; sem conseguir, nada é verificado nem guardado.
    if (!(await flushPendingSignOut())) return { kind: 'anonymous' };
    const identity = await deps.fetchIdentity();
    const previous = await deps.index.get();
    if (identity.kind === 'anonymous') {
      // A sessão acabou (expirou, foi revogada, a conta foi suspensa ou saiu em outra aba): nada fica no aparelho.
      if (previous !== null) await deps.purgeLocal('session_ended');
      return { kind: 'anonymous' };
    }
    // Outra pessoa entrou neste aparelho: o que era da anterior sai ANTES de qualquer leitura ou gravação.
    if (previous !== null && previous !== identity.userId) await deps.purgeLocal('account_changed');
    const leaseResult = await deps.fetchLease();
    const store = await deps.openStore(identity.userId);
    let verified: VerifyOutcome;
    try {
      if (leaseResult.kind === 'unavailable') {
        await store.clearAll();
        if ((await deps.index.get()) === identity.userId) await deps.index.set(null);
        return { kind: 'unavailable' };
      }
      const now = deps.now();
      const leases: StoredLease[] = leaseResult.lease.courses.map((course) => ({
        courseId: course.courseId,
        leaseUntil: leaseUntilOnDeviceClock({
          leaseUntil: course.leaseUntil,
          serverNow: leaseResult.lease.serverNow,
          deviceNow: now,
        }),
        verifiedAt: now,
      }));
      await store.applyVerification({ userId: identity.userId, now, leases });
      await deps.index.set(identity.userId);
      verified = { kind: 'verified', userId: identity.userId, courses: leases.length };
    } finally {
      store.close();
    }
    // Toda verificação online bem-sucedida também descarrega o outbox desta pessoa (M8-03). Nunca lança.
    await syncOutbox(identity.userId);
    // E, se a pessoa já guarda certificados neste aparelho, a lista é renovada: revogado ou substituído leva a cópia do PDF junto (M8-06).
    await refreshCertificates(identity.userId);
    return verified;
  }

  /** Renova a lista de certificados guardada (só se já existe uma) e poda o que deixou de valer. Nunca lança. */
  async function refreshCertificates(userId: string): Promise<void> {
    try {
      const store = await deps.openStore(userId);
      try {
        if ((await store.getCertificates()) === null) return;
        const list = await deps.fetchCertificates();
        if (list === null) return;
        await store.replaceCertificates({ verifiedAt: deps.now(), items: list });
      } finally {
        store.close();
      }
    } catch {
      // Sem rede ou erro: a cópia antiga segue com a data da última verificação.
    }
  }

  /** Revoga no servidor um "sair" feito sem rede. `true` = não há mais nada pendente. */
  async function flushPendingSignOut(): Promise<boolean> {
    try {
      if (!(await deps.pendingSignOut.isPending())) return true;
      if ((await deps.requestSignOut()) !== 'done') return false;
      await deps.pendingSignOut.clear();
      return true;
    } catch {
      return false;
    }
  }

  /** Verifica só se faz falta (sem lease do curso ou verificação velha). Nunca lança. */
  async function ensureFresh(courseId: string): Promise<boolean> {
    try {
      if (await deps.pendingSignOut.isPending()) return false;
      const current = await storeForCurrentUser();
      if (current) {
        try {
          const meta = await current.store.getMeta();
          const lease = await current.store.getLease(courseId);
          if (meta?.lastVerifiedAt && lease && deps.now() - meta.lastVerifiedAt < FRESH_MS) {
            return true;
          }
        } finally {
          current.store.close();
        }
      }
      const outcome = await verify();
      return outcome.kind === 'verified';
    } catch {
      return false;
    }
  }

  async function hasRoom(): Promise<boolean> {
    try {
      const estimate = await deps.storageEstimate?.();
      if (estimate?.quota && estimate.usage !== undefined) {
        return estimate.usage / estimate.quota < QUOTA_LIMIT;
      }
    } catch {
      // Sem estimativa: tenta gravar mesmo assim.
    }
    return true;
  }

  async function save(
    courseId: string,
    write: (store: OfflineStore, now: number) => Promise<void>,
  ): Promise<'saved' | 'skipped' | 'failed'> {
    try {
      if (!(await ensureFresh(courseId))) return 'skipped';
      if (!(await hasRoom())) return 'skipped';
      const current = await storeForCurrentUser();
      if (!current) return 'skipped';
      try {
        // Só guarda curso com lease: sem ele a pessoa não tem acesso (ou a conta é de Staff).
        if (!(await current.store.getLease(courseId))) return 'skipped';
        await write(current.store, deps.now());
      } finally {
        current.store.close();
      }
      if (!persistenceRequested) {
        persistenceRequested = true;
        void deps.requestPersistence?.().catch(() => undefined);
      }
      return 'saved';
    } catch {
      // Armazenamento cheio, negado ou apagado pelo navegador: a aula segue funcionando online.
      return 'failed';
    }
  }

  async function read<T>(
    courseId: string,
    load: (
      store: OfflineStore,
    ) => Promise<{ data: T; savedAt: number; savedLessonIds?: string[] } | null>,
  ): Promise<OfflineRead<T>> {
    try {
      const current = await storeForCurrentUser();
      if (!current) return { kind: 'blocked', reason: 'no_user' };
      try {
        const now = deps.now();
        const previousClock = await current.store.touchClock(current.userId, now);
        const lease = await current.store.getLease(courseId);
        const status = evaluateOfflineLease({
          leaseUntil: lease?.leaseUntil ?? null,
          now,
          maxSeenClock: previousClock,
        });
        if (status.status === 'none') return { kind: 'blocked', reason: 'no_lease' };
        if (status.status === 'expired') return { kind: 'blocked', reason: 'lease_expired' };
        if (status.status === 'clock_suspect') return { kind: 'blocked', reason: 'clock_suspect' };
        const found = await load(current.store);
        if (!found) return { kind: 'blocked', reason: 'not_saved' };
        return { kind: 'ok', ...found, leaseUntil: lease!.leaseUntil };
      } finally {
        current.store.close();
      }
    } catch {
      return { kind: 'blocked', reason: 'no_user' };
    }
  }

  return {
    verify,

    /**
     * Guarda a lista de certificados que o servidor acabou de dar, com o instante DESTA verificação (M8-06). O que saiu da lista, ou
     * deixou de estar pronto, perde também o PDF guardado. Melhor esforço; nunca lança.
     */
    async rememberCertificates(list: MyCertificateDto[]): Promise<'saved' | 'skipped' | 'failed'> {
      try {
        if (await deps.pendingSignOut.isPending()) return 'skipped';
        if ((await deps.index.get()) === null) {
          // Sem certificado e sem ninguém conhecido, não há o que guardar (e nem se chama o servidor à toa).
          if (list.length === 0) return 'skipped';
          // Ninguém conhecido ainda: confirma a identidade (online) antes de guardar qualquer coisa da pessoa.
          if ((await verify()).kind !== 'verified') return 'skipped';
        }
        const current = await storeForCurrentUser();
        if (!current) return 'skipped';
        try {
          await current.store.replaceCertificates({ verifiedAt: deps.now(), items: list });
        } finally {
          current.store.close();
        }
        return 'saved';
      } catch {
        return 'failed';
      }
    },

    /** A lista guardada, SEMPRE com o instante da última verificação online (nunca mostra "válido" sem ele). */
    async readCertificates(): Promise<CertificatesRead> {
      try {
        const current = await storeForCurrentUser();
        if (!current) return { kind: 'blocked', reason: 'no_user' };
        try {
          const saved = await current.store.getCertificates();
          if (!saved) return { kind: 'blocked', reason: 'not_saved' };
          return {
            kind: 'ok',
            items: saved.items,
            verifiedAt: saved.verifiedAt,
            pdfIds: await current.store.listCertificatePdfIds(),
          };
        } finally {
          current.store.close();
        }
      } catch {
        return { kind: 'blocked', reason: 'no_user' };
      }
    },

    /**
     * Baixa o PDF PARA LER OFFLINE (só quando a pessoa pede). Confere o hash recebido contra o que o servidor conferiu e guarda os
     * bytes com o SHA-256 (por conta). Sem a lista guardada não guarda (o PDF precisa de uma entrada "pronto" para ser podado).
     */
    async saveCertificatePdf(id: string): Promise<PdfSaveOutcome> {
      try {
        if (await deps.pendingSignOut.isPending()) return 'failed';
        const fetched = await deps.fetchCertificatePdf(id);
        if (fetched.kind === 'unauthenticated') return 'unauthenticated';
        if (fetched.kind === 'not_available') return 'not_available';
        if (fetched.kind === 'error') return 'failed';
        const computed = await deps.sha256(fetched.bytes);
        if (fetched.sha256 !== null && fetched.sha256 !== computed) return 'integrity_failed';
        const current = await storeForCurrentUser();
        if (!current) return 'failed';
        try {
          const saved = await current.store.getCertificates();
          if (!saved?.items.some((item) => item.id === id && item.status === 'ready'))
            return 'failed';
          await current.store.putCertificatePdf({
            id,
            sha256: computed,
            bytes: fetched.bytes,
            savedAt: deps.now(),
          });
        } finally {
          current.store.close();
        }
        return 'saved';
      } catch {
        return 'failed';
      }
    },

    /** Abre a cópia guardada: o SHA-256 é RECALCULADO; se divergir, a cópia é descartada (cache adulterado ou corrompido). */
    async openCertificatePdf(id: string): Promise<PdfOpenOutcome> {
      try {
        const current = await storeForCurrentUser();
        if (!current) return { kind: 'missing' };
        try {
          const record = await current.store.getCertificatePdf(id);
          if (!record) return { kind: 'missing' };
          const saved = await current.store.getCertificates();
          const item = saved?.items.find((entry) => entry.id === id);
          if (!item || item.status !== 'ready') {
            await current.store.deleteCertificatePdf(id);
            return { kind: 'not_ready' };
          }
          if ((await deps.sha256(record.bytes)) !== record.sha256) {
            await current.store.deleteCertificatePdf(id);
            return { kind: 'tampered' };
          }
          return { kind: 'ok', bytes: record.bytes, filename: `certificado-${item.code}.pdf` };
        } finally {
          current.store.close();
        }
      } catch {
        return { kind: 'missing' };
      }
    },

    /** A pessoa apagou a cópia do PDF deste aparelho. */
    async removeCertificatePdf(id: string): Promise<void> {
      try {
        const current = await storeForCurrentUser();
        if (!current) return;
        try {
          await current.store.deleteCertificatePdf(id);
        } finally {
          current.store.close();
        }
      } catch {
        // Fica para a próxima.
      }
    },

    /** Há uma pessoa que já verificou o acesso online neste aparelho? (o app abre offline só para ela). */
    async hasKnownUser(): Promise<boolean> {
      try {
        return (await deps.index.get()) !== null;
      } catch {
        return false;
      }
    },

    /** Verificação de fundo (abertura, volta da rede, aba visível): só quando já há uma pessoa conhecida. Nunca lança. */
    async refreshInBackground(): Promise<void> {
      try {
        if (!(await flushPendingSignOut())) return;
        // Sem ponteiro (ex.: a sessão acabou e o estudo foi apagado) mas COM outbox pendente, a pessoa ainda pode voltar e enviar.
        if ((await deps.index.get()) === null && !(await deps.anyOutbox())) return;
        await verify();
      } catch {
        // Sem rede: tenta de novo na próxima oportunidade.
      }
    },

    /**
     * Sair da conta (M8-05). Com o servidor confirmando (ou sem sessão), purga e pronto (`done`). SEM rede, purga o aparelho NA
     * HORA e deixa a revogação da sessão para quando a rede voltar (`pending`). Se o servidor falhar online (`failed`), NADA é
     * apagado: a pessoa continua logada e pode tentar de novo.
     */
    async signOut(
      options: { discardOutbox?: boolean } = {},
    ): Promise<'done' | 'pending' | 'failed'> {
      const userId = await deps.index.get().catch(() => null);
      const outcome = await deps.requestSignOut();
      if (outcome === 'error') return 'failed';
      await deps.purgeLocal('sign_out');
      // A pessoa CONFIRMOU descartar o que não foi enviado (M8-05, passo 1): só então o outbox sai do aparelho.
      if (options.discardOutbox && userId) {
        await deps.deleteOutbox(userId);
        deps.notifyOutboxChanged?.();
      }
      if (outcome === 'network') {
        await deps.pendingSignOut.mark().catch(() => undefined);
        return 'pending';
      }
      return 'done';
    },

    flushPendingSignOut,

    syncOutbox: () => syncOutbox(),
    outboxSummary,

    /**
     * Conclui uma aula de texto SEM rede (M8-03): guarda o comando no outbox (um por aula) com um id novo. Quem confere acesso, drip e
     * sequência é o servidor, quando a rede voltar; aqui só se guarda. `no_user`: ninguém conhecido neste aparelho.
     */
    async enqueueCompletion(input: {
      lessonId: string;
      courseId: string;
      lessonTitle: string;
    }): Promise<'queued' | 'already_pending' | 'no_user' | 'failed'> {
      try {
        const userId = await deps.index.get();
        if (!userId) return 'no_user';
        const outbox = await deps.openOutbox(userId);
        try {
          const { created } = await outbox.enqueue({
            clientOperationId: deps.newId(),
            command: 'lesson.complete',
            lessonId: input.lessonId,
            courseId: input.courseId,
            lessonTitle: input.lessonTitle,
            createdAt: deps.now(),
          });
          return created ? 'queued' : 'already_pending';
        } finally {
          outbox.close();
          deps.notifyOutboxChanged?.();
        }
      } catch {
        return 'failed';
      }
    },

    /** A pessoa leu a recusa: o item sai do outbox. */
    async dismissRejected(clientOperationId: string): Promise<void> {
      try {
        const userId = await deps.index.get();
        if (!userId || !(await deps.outboxExists(userId))) return;
        const outbox = await deps.openOutbox(userId);
        try {
          await outbox.remove([clientOperationId]);
        } finally {
          outbox.close();
          deps.notifyOutboxChanged?.();
        }
      } catch {
        // Fica para a próxima.
      }
    },

    /**
     * Antes de sair (M8-05, passo 1): tenta enviar o outbox com um prazo curto e diz quantas conclusões AINDA não foram enviadas. Se
     * sobrar alguma, a tela pede confirmação antes de descartar.
     */
    async prepareSignOut(timeoutMs = 4000): Promise<{ pending: number }> {
      await Promise.race([
        syncOutbox(),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
      return { pending: (await outboxSummary()).pending.length };
    },

    rememberLesson(view: LessonViewDto) {
      if (!isStorable(view)) return Promise.resolve('skipped' as const);
      return save(view.course.id, (store, now) =>
        store.putLesson({ lessonId: view.lesson.id, courseId: view.course.id, savedAt: now, view }),
      );
    },

    rememberOutline(outline: CourseOutlineDto) {
      if (outline.preview === true) return Promise.resolve('skipped' as const);
      return save(outline.course.id, (store, now) =>
        store.putOutline({ courseId: outline.course.id, savedAt: now, outline }),
      );
    },

    readLesson(courseId: string, lessonId: string) {
      return read<LessonViewDto>(courseId, async (store) => {
        const record = await store.getLesson(lessonId);
        // A aula guardada precisa ser DESTE curso (defesa contra id trocado).
        return record && record.courseId === courseId
          ? { data: record.view, savedAt: record.savedAt }
          : null;
      });
    },

    readOutline(courseId: string) {
      return read<CourseOutlineDto>(courseId, async (store) => {
        const record = await store.getOutline(courseId);
        if (!record) return null;
        return {
          data: record.outline,
          savedAt: record.savedAt,
          savedLessonIds: await store.listLessonIds(courseId),
        };
      });
    },
  };
}
