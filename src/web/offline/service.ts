import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import {
  evaluateOfflineLease,
  leaseUntilOnDeviceClock,
  type OfflineLeaseDto,
} from '../../features/pwa/offline-lease';
import type { OfflineIndex, OfflineStore, StoredLease } from './store';

/** Quanto tempo uma verificação online recente dispensa outra (cada aula aberta não chama o servidor de novo). */
const FRESH_MS = 30 * 60 * 1000;
/** Acima desta fração da cota do navegador, não se guarda mais nada (o app segue funcionando online). */
const QUOTA_LIMIT = 0.9;

export type Identity = { kind: 'user'; userId: string } | { kind: 'anonymous' };
export type LeaseFetch =
  | { kind: 'ok'; lease: OfflineLeaseDto }
  /** O servidor recusou (conta com papel de Staff): nada é guardado e o que houver é apagado. */
  | { kind: 'unavailable' };

export interface OfflineDeps {
  now(): number;
  /** Lança em falha de REDE. */
  fetchIdentity(): Promise<Identity>;
  /** Lança em falha de REDE. */
  fetchLease(): Promise<LeaseFetch>;
  index: OfflineIndex;
  openStore(userId: string): Promise<OfflineStore>;
  /** Cota do navegador, se ele a informa. */
  storageEstimate?(): Promise<{ usage?: number; quota?: number } | undefined>;
  requestPersistence?(): Promise<unknown>;
}

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

  async function storeForCurrentUser(): Promise<{ userId: string; store: OfflineStore } | null> {
    const userId = await deps.index.get();
    if (!userId) return null;
    return { userId, store: await deps.openStore(userId) };
  }

  /** Verificação online: quem é a pessoa agora e quais cursos têm lease. Falha de rede propaga (o chamador decide). */
  async function verify(): Promise<VerifyOutcome> {
    const identity = await deps.fetchIdentity();
    if (identity.kind === 'anonymous') return { kind: 'anonymous' };
    const leaseResult = await deps.fetchLease();
    const store = await deps.openStore(identity.userId);
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
      return { kind: 'verified', userId: identity.userId, courses: leases.length };
    } finally {
      store.close();
    }
  }

  /** Verifica só se faz falta (sem lease do curso ou verificação velha). Nunca lança. */
  async function ensureFresh(courseId: string): Promise<boolean> {
    try {
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
        if ((await deps.index.get()) === null) return;
        await verify();
      } catch {
        // Sem rede: tenta de novo na próxima oportunidade.
      }
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
