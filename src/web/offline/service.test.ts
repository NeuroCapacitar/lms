import { beforeEach, describe, expect, it } from 'vitest';

import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import { advanceClock } from '../../features/pwa/offline-lease';
import type { OfflineOperation, SyncResultItem } from '../../features/pwa/offline-sync';
import type { MyCertificateDto } from '../../features/certificate/lifecycle';
import type { OutboxItem, OutboxStore } from './outbox';
import {
  createOfflineService,
  type Identity,
  type LeaseFetch,
  type OfflineDeps,
  type SignOutOutcome,
  type CertificatePdfFetch,
  type SyncCall,
} from './service';
import type {
  OfflineIndex,
  OfflineMeta,
  OfflineStore,
  StoredCertificatePdf,
  StoredCertificates,
  StoredLease,
  StoredLesson,
  StoredOutline,
} from './store';

/** Um IndexedDB de mentira com o MESMO contrato do real (o real é provado no navegador: e2e/offline.spec.ts). */
class MemoryStore implements OfflineStore {
  meta: OfflineMeta | null = null;
  leases = new Map<string, StoredLease>();
  lessons = new Map<string, StoredLesson>();
  outlines = new Map<string, StoredOutline>();
  failWrites = false;
  async getMeta() {
    return this.meta;
  }
  async touchClock(userId: string, now: number) {
    const previous = this.meta?.maxSeenClock ?? null;
    if (this.meta) this.meta = { ...this.meta, userId, maxSeenClock: advanceClock(previous, now) };
    return previous;
  }
  async applyVerification(input: { userId: string; now: number; leases: StoredLease[] }) {
    this.meta = { userId: input.userId, lastVerifiedAt: input.now, maxSeenClock: input.now };
    const allowed = new Set(input.leases.map((lease) => lease.courseId));
    this.leases = new Map(input.leases.map((lease) => [lease.courseId, lease]));
    for (const [id, record] of this.lessons)
      if (!allowed.has(record.courseId)) this.lessons.delete(id);
    for (const [id] of this.outlines) if (!allowed.has(id)) this.outlines.delete(id);
  }
  async getLease(courseId: string) {
    return this.leases.get(courseId) ?? null;
  }
  async putLesson(record: StoredLesson) {
    if (this.failWrites) throw new DOMException('cheio', 'QuotaExceededError');
    this.lessons.set(record.lessonId, record);
  }
  async getLesson(lessonId: string) {
    return this.lessons.get(lessonId) ?? null;
  }
  async listLessonIds(courseId: string) {
    return [...this.lessons.values()].filter((l) => l.courseId === courseId).map((l) => l.lessonId);
  }
  async listOutlines() {
    return [...this.outlines.values()];
  }
  async putOutline(record: StoredOutline) {
    this.outlines.set(record.courseId, record);
  }
  async getOutline(courseId: string) {
    return this.outlines.get(courseId) ?? null;
  }
  certificates: StoredCertificates | null = null;
  pdfs = new Map<string, StoredCertificatePdf>();
  async replaceCertificates(input: StoredCertificates) {
    this.certificates = input;
    const ready = new Set(input.items.filter((item) => item.status === 'ready').map((i) => i.id));
    for (const id of this.pdfs.keys()) if (!ready.has(id)) this.pdfs.delete(id);
  }
  async getCertificates() {
    return this.certificates;
  }
  async putCertificatePdf(record: StoredCertificatePdf) {
    this.pdfs.set(record.id, record);
  }
  async getCertificatePdf(id: string) {
    return this.pdfs.get(id) ?? null;
  }
  async deleteCertificatePdf(id: string) {
    this.pdfs.delete(id);
  }
  async listCertificatePdfIds() {
    return [...this.pdfs.keys()];
  }
  async clearAll() {
    this.certificates = null;
    this.pdfs.clear();
    this.meta = null;
    this.leases.clear();
    this.lessons.clear();
    this.outlines.clear();
  }
  close() {}
}

/** Um outbox de mentira com o MESMO contrato do real (o real é provado no navegador: e2e/offline-outbox.spec.ts). */
class MemoryOutbox implements OutboxStore {
  items = new Map<string, OutboxItem>();
  async enqueue(item: Parameters<OutboxStore['enqueue']>[0]) {
    const existing = [...this.items.values()].find(
      (row) => row.lessonId === item.lessonId && row.state === 'pending',
    );
    if (existing) return { item: existing, created: false };
    const created: OutboxItem = { ...item, attempts: 0, state: 'pending' };
    this.items.set(created.clientOperationId, created);
    return { item: created, created: true };
  }
  async list() {
    return [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  async remove(ids: string[]) {
    for (const id of ids) this.items.delete(id);
  }
  async markRejected(id: string, reason: OutboxItem['reason']) {
    const row = this.items.get(id);
    if (row) this.items.set(id, { ...row, state: 'rejected', reason });
  }
  async bumpAttempts(ids: string[]) {
    for (const id of ids) {
      const row = this.items.get(id);
      if (row) this.items.set(id, { ...row, attempts: row.attempts + 1 });
    }
  }
  close() {}
}

const COURSE = '11111111-1111-4111-8111-111111111111';
const OTHER_COURSE = '22222222-2222-4222-8222-222222222222';
const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-15T12:00:00.000Z');

function lessonView(
  id: string,
  overrides: Partial<LessonViewDto['lesson']> = {},
  courseId = COURSE,
): LessonViewDto {
  return {
    course: { id: courseId, title: 'Curso' },
    lesson: { id, title: `Aula ${id}`, isOptional: false, body: null, ...overrides },
    completed: false,
    previous: null,
    next: null,
  };
}
function outline(courseId = COURSE): CourseOutlineDto {
  return {
    course: { id: courseId, title: 'Curso', sequenceMode: 'guided' },
    access: { hasAccess: true, reason: 'ok', expiresAt: '2027-01-01T00:00:00.000Z' },
    progress: { completed: 0, total: 1, percent: 0 },
    completedAt: null,
    modules: [],
  } as unknown as CourseOutlineDto;
}

let clock: number;
let identity: Identity;
let leaseFetch: LeaseFetch;
let stores: Map<string, MemoryStore>;
let pointer: string | null;
let estimate: { usage?: number; quota?: number } | undefined;
let networkDown: boolean;
let purges: string[];
let signOutOutcome: SignOutOutcome;
let signOutCalls: number;
let pendingFlag: boolean;
let outboxes: Map<string, MemoryOutbox>;
let sent: OfflineOperation[][];
let syncAnswer: (operations: OfflineOperation[]) => SyncCall;
let idSeq: number;
let changed: number;
let appliedSignals: number;
let certificatesAnswer: MyCertificateDto[] | null;
let pdfAnswer: CertificatePdfFetch;
let certificateFetches: number;

const index: OfflineIndex = {
  get: async () => pointer,
  set: async (userId) => {
    pointer = userId;
  },
};
const lease = (courses = [COURSE]): LeaseFetch => ({
  kind: 'ok',
  lease: {
    serverNow: new Date(clock).toISOString(),
    courses: courses.map((courseId) => ({
      courseId,
      leaseUntil: new Date(clock + 72 * HOUR).toISOString(),
    })),
  },
});
const storeOf = (userId: string) => {
  let store = stores.get(userId);
  if (!store) {
    store = new MemoryStore();
    stores.set(userId, store);
  }
  return store;
};

const outboxOf = (userId: string) => {
  let box = outboxes.get(userId);
  if (!box) {
    box = new MemoryOutbox();
    outboxes.set(userId, box);
  }
  return box;
};
const OPID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Resposta padrão: aplica tudo, na ordem. */
const applyAll = (operations: OfflineOperation[]): SyncCall => ({
  kind: 'ok',
  results: operations.map((operation, index): SyncResultItem => ({
    index,
    clientOperationId: operation.clientOperationId,
    status: 'applied',
    effect: 'completed',
    courseJustCompleted: false,
  })),
});

function baseDeps(): OfflineDeps {
  return {
    now: () => clock,
    newId: () => OPID((idSeq += 1)),
    openOutbox: async (userId) => outboxOf(userId),
    outboxExists: async (userId) => outboxes.has(userId),
    anyOutbox: async () => outboxes.size > 0,
    deleteOutbox: async (userId) => {
      outboxes.delete(userId);
    },
    postSync: async ({ operations }) => {
      if (networkDown) throw new TypeError('Failed to fetch');
      sent.push(operations);
      return syncAnswer(operations);
    },
    notifyOutboxChanged: () => {
      changed += 1;
    },
    notifyApplied: () => {
      appliedSignals += 1;
    },
    fetchCertificates: async () => {
      if (networkDown) throw new TypeError('Failed to fetch');
      certificateFetches += 1;
      return certificatesAnswer;
    },
    fetchCertificatePdf: async () => {
      if (networkDown) throw new TypeError('Failed to fetch');
      return pdfAnswer;
    },
    sha256: async (bytes) => {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
    fetchIdentity: async () => identity,
    fetchLease: async () => leaseFetch,
    index,
    openStore: async (userId) => storeOf(userId),
    purgeLocal: async (reason) => {
      purges.push(reason);
      stores.clear();
      pointer = null;
    },
    requestSignOut: async () => {
      signOutCalls += 1;
      return networkDown ? 'network' : signOutOutcome;
    },
    pendingSignOut: {
      mark: async () => {
        pendingFlag = true;
      },
      isPending: async () => pendingFlag,
      clear: async () => {
        pendingFlag = false;
      },
    },
  };
}

function service() {
  const deps: OfflineDeps = {
    ...baseDeps(),
    now: () => clock,
    fetchIdentity: async () => {
      if (networkDown) throw new TypeError('Failed to fetch');
      return identity;
    },
    fetchLease: async () => {
      if (networkDown) throw new TypeError('Failed to fetch');
      return leaseFetch;
    },
    storageEstimate: async () => estimate,
  };
  return createOfflineService(deps);
}

beforeEach(() => {
  clock = T0;
  identity = { kind: 'user', userId: 'user-a' };
  leaseFetch = lease();
  stores = new Map();
  pointer = null;
  estimate = undefined;
  networkDown = false;
  purges = [];
  signOutOutcome = 'done';
  signOutCalls = 0;
  pendingFlag = false;
  outboxes = new Map();
  sent = [];
  syncAnswer = applyAll;
  idSeq = 0;
  changed = 0;
  appliedSignals = 0;
  certificatesAnswer = [];
  certificateFetches = 0;
  pdfAnswer = { kind: 'not_available' };
});

describe('offline: guardar e ler', () => {
  it('online: guarda a aula de texto e o mapa; offline: lê dentro do lease', async () => {
    const offline = service();
    expect(await offline.rememberLesson(lessonView('l1'))).toBe('saved');
    expect(await offline.rememberOutline(outline())).toBe('saved');
    networkDown = true;
    clock = T0 + 10 * HOUR;
    const lesson = await offline.readLesson(COURSE, 'l1');
    expect(lesson).toMatchObject({ kind: 'ok', savedAt: T0 });
    const map = await offline.readOutline(COURSE);
    expect(map).toMatchObject({ kind: 'ok', savedLessonIds: ['l1'] });
  });

  it('só aula de TEXTO é guardada: vídeo, quiz e prévia da Staff ficam de fora', async () => {
    const offline = service();
    expect(await offline.rememberLesson(lessonView('v', { kind: 'video' }))).toBe('skipped');
    expect(await offline.rememberLesson(lessonView('q', { kind: 'quiz' }))).toBe('skipped');
    expect(await offline.rememberLesson({ ...lessonView('p'), preview: true })).toBe('skipped');
    expect(await offline.rememberOutline({ ...outline(), preview: true })).toBe('skipped');
    expect(await offline.rememberLesson(lessonView('t', { kind: 'text' }))).toBe('saved');
    expect(storeOf('user-a').lessons.size).toBe(1);
  });

  it('aula nunca guardada: bloqueada com not_saved (há lease, falta o conteúdo)', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    expect(await offline.readLesson(COURSE, 'outra')).toEqual({
      kind: 'blocked',
      reason: 'not_saved',
    });
  });

  it('aula guardada de OUTRO curso não abre com o id deste', async () => {
    const offline = service();
    leaseFetch = lease([COURSE, OTHER_COURSE]);
    await offline.rememberLesson(lessonView('l1', {}, OTHER_COURSE));
    expect(await offline.readLesson(COURSE, 'l1')).toEqual({
      kind: 'blocked',
      reason: 'not_saved',
    });
  });

  it('sem lease do curso (sem acesso): nada é guardado', async () => {
    leaseFetch = lease([]);
    const offline = service();
    expect(await offline.rememberLesson(lessonView('l1'))).toBe('skipped');
    expect(storeOf('user-a').lessons.size).toBe(0);
  });

  it('nunca verificou online neste aparelho: no_user', async () => {
    expect(await service().readLesson(COURSE, 'l1')).toEqual({
      kind: 'blocked',
      reason: 'no_user',
    });
  });
});

describe('M8-04: cursos guardados como porta de entrada sem rede', () => {
  async function savedCourse() {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    await offline.rememberOutline(outline());
    networkDown = true;
    return offline;
  }

  it('lista o curso guardado com título, aulas guardadas e fim do lease', async () => {
    const offline = await savedCourse();
    clock = T0 + 10 * HOUR;
    expect(await offline.readSavedCourses()).toEqual({
      kind: 'ok',
      courses: [
        {
          courseId: COURSE,
          title: 'Curso',
          savedAt: T0,
          leaseUntil: T0 + 72 * HOUR,
          savedLessons: 1,
        },
      ],
    });
  });

  it('com a pessoa conhecida mas nada guardado: lista vazia (não é bloqueio)', async () => {
    const offline = service();
    await offline.verify();
    networkDown = true;
    expect(await offline.readSavedCourses()).toEqual({ kind: 'ok', courses: [] });
  });

  it('ninguém conhecido neste aparelho: no_user', async () => {
    expect(await service().readSavedCourses()).toEqual({ kind: 'blocked', reason: 'no_user' });
  });

  it('lease vencido: o curso NÃO aparece e o motivo é dito', async () => {
    const offline = await savedCourse();
    clock = T0 + 72 * HOUR;
    expect(await offline.readSavedCourses()).toEqual({ kind: 'blocked', reason: 'lease_expired' });
  });

  it('relógio atrasado além da tolerância: bloqueia a lista inteira até reverificar online', async () => {
    const offline = await savedCourse();
    clock = T0 + 20 * HOUR;
    expect((await offline.readSavedCourses()).kind).toBe('ok'); // avança o maior instante visto
    clock = T0 + 5 * HOUR; // alguém voltou o relógio
    expect(await offline.readSavedCourses()).toEqual({ kind: 'blocked', reason: 'clock_suspect' });
  });

  it('A guarda; B entra no mesmo navegador: B não vê o curso de A', async () => {
    const offline = await savedCourse();
    networkDown = false;
    identity = { kind: 'user', userId: 'user-b' };
    leaseFetch = lease();
    await offline.verify();
    networkDown = true;
    expect(await offline.readSavedCourses()).toEqual({ kind: 'ok', courses: [] });
  });

  it('banco indisponível: vira bloqueio, nunca exceção', async () => {
    pointer = 'user-a';
    const deps: OfflineDeps = {
      ...baseDeps(),
      openStore: async () => {
        throw new Error('banco apagado');
      },
    };
    expect(await createOfflineService(deps).readSavedCourses()).toEqual({
      kind: 'blocked',
      reason: 'no_user',
    });
  });
});

describe('offline: lease e relógio', () => {
  async function saved() {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    networkDown = true;
    return offline;
  }

  it('lease vencido sem rede: lease_expired', async () => {
    const offline = await saved();
    clock = T0 + 72 * HOUR;
    expect(await offline.readLesson(COURSE, 'l1')).toEqual({
      kind: 'blocked',
      reason: 'lease_expired',
    });
  });

  it('relógio adiantado só antecipa o fim', async () => {
    const offline = await saved();
    clock = T0 + 80 * HOUR;
    expect((await offline.readLesson(COURSE, 'l1')).kind).toBe('blocked');
  });

  it('relógio atrasado além da tolerância bloqueia, e continua bloqueado até reverificar online', async () => {
    const offline = await saved();
    clock = T0 + 20 * HOUR;
    expect((await offline.readLesson(COURSE, 'l1')).kind).toBe('ok'); // avança o maior instante visto
    clock = T0 + 5 * HOUR; // alguém voltou o relógio
    expect(await offline.readLesson(COURSE, 'l1')).toEqual({
      kind: 'blocked',
      reason: 'clock_suspect',
    });
    clock = T0 + 21 * HOUR;
    networkDown = false;
    leaseFetch = lease();
    expect((await offline.verify()).kind).toBe('verified'); // reverificou: o relógio é aceito de novo
    networkDown = true;
    expect((await offline.readLesson(COURSE, 'l1')).kind).toBe('ok');
  });

  it('reverificar online renova o lease', async () => {
    const offline = await saved();
    clock = T0 + 60 * HOUR;
    networkDown = false;
    await offline.verify();
    networkDown = true;
    clock = T0 + 100 * HOUR;
    expect((await offline.readLesson(COURSE, 'l1')).kind).toBe('ok');
  });

  it('acesso revogado: vale até o fim do lease; ao reverificar, o curso sai do aparelho', async () => {
    const offline = await saved();
    clock = T0 + 10 * HOUR;
    expect((await offline.readLesson(COURSE, 'l1')).kind).toBe('ok'); // limite documentado
    networkDown = false;
    leaseFetch = lease([]); // o servidor não dá mais lease
    await offline.verify();
    networkDown = true;
    expect(await offline.readLesson(COURSE, 'l1')).toEqual({ kind: 'blocked', reason: 'no_lease' });
    expect(storeOf('user-a').lessons.size).toBe(0);
  });

  it('aparelho com hora errada na verificação não ganha lease', async () => {
    const offline = service();
    leaseFetch = {
      kind: 'ok',
      lease: {
        serverNow: new Date(T0).toISOString(),
        courses: [{ courseId: COURSE, leaseUntil: new Date(T0 + 72 * HOUR).toISOString() }],
      },
    };
    clock = T0 - 3 * 24 * HOUR; // relógio 3 dias atrás
    await offline.rememberLesson(lessonView('l1'));
    networkDown = true;
    clock = T0 - 3 * 24 * HOUR + 71 * HOUR;
    expect((await offline.readLesson(COURSE, 'l1')).kind).toBe('ok');
    clock = T0 - 3 * 24 * HOUR + 73 * HOUR;
    expect((await offline.readLesson(COURSE, 'l1')).kind).toBe('blocked');
  });
});

describe('offline: isolamento entre contas', () => {
  it('A guarda; B entra no mesmo navegador: o que era de A é apagado e B não vê nada dele', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('segredo-de-a'));
    identity = { kind: 'user', userId: 'user-b' };
    leaseFetch = lease();
    await offline.verify(); // B entra (online)
    networkDown = true;
    expect(await offline.readLesson(COURSE, 'segredo-de-a')).toEqual({
      kind: 'blocked',
      reason: 'not_saved',
    });
    expect(storeOf('user-b').lessons.size).toBe(0);
    expect(purges).toEqual(['account_changed']); // M8-05: o que era de A sai do aparelho
  });

  it('conta de Staff: o servidor recusa o lease, nada é guardado e o que houver é apagado', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    leaseFetch = { kind: 'unavailable' };
    expect((await offline.verify()).kind).toBe('unavailable');
    expect(storeOf('user-a').lessons.size).toBe(0);
    expect(pointer).toBeNull();
    expect(await offline.rememberLesson(lessonView('l2'))).toBe('skipped');
  });

  it('sessão anônima (401): não cria ponteiro nem guarda nada', async () => {
    identity = { kind: 'anonymous' };
    const offline = service();
    expect(await offline.rememberLesson(lessonView('l1'))).toBe('skipped');
    expect(pointer).toBeNull();
  });
});

describe('offline: cota, falhas e verificação de fundo', () => {
  it('armazenamento cheio: não grava, não lança; a leitura online segue', async () => {
    estimate = { usage: 95, quota: 100 };
    const offline = service();
    expect(await offline.rememberLesson(lessonView('l1'))).toBe('skipped');
    estimate = { usage: 10, quota: 100 };
    storeOf('user-a').failWrites = true;
    expect(await offline.rememberLesson(lessonView('l2'))).toBe('failed');
  });

  it('banco indisponível: ler vira bloqueio, nunca exceção', async () => {
    pointer = 'user-a';
    const deps: OfflineDeps = {
      ...baseDeps(),
      openStore: async () => {
        throw new Error('banco apagado');
      },
    };
    expect(await createOfflineService(deps).readLesson(COURSE, 'l1')).toEqual({
      kind: 'blocked',
      reason: 'no_user',
    });
  });

  it('verificação recente dispensa nova chamada ao servidor', async () => {
    let calls = 0;
    const offline = createOfflineService({
      ...baseDeps(),
      fetchIdentity: async () => {
        calls += 1;
        return identity;
      },
    });
    await offline.rememberLesson(lessonView('l1'));
    await offline.rememberLesson(lessonView('l2'));
    expect(calls).toBe(1);
    clock = T0 + 31 * 60_000;
    await offline.rememberLesson(lessonView('l3'));
    expect(calls).toBe(2);
  });

  it('verificação de fundo só roda para quem já é conhecido e nunca lança sem rede', async () => {
    const offline = service();
    networkDown = true;
    await expect(offline.refreshInBackground()).resolves.toBeUndefined(); // sem ponteiro: nem tenta
    pointer = 'user-a';
    await expect(offline.refreshInBackground()).resolves.toBeUndefined(); // rede caída: engole
    expect(await offline.hasKnownUser()).toBe(true);
  });
});

describe('M8-05: sair da conta, troca de conta e sessão encerrada', () => {
  it('sair online: o servidor confirma, o aparelho é limpo e não fica nada pendente', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    expect(await offline.signOut()).toBe('done');
    expect(purges).toEqual(['sign_out']);
    expect(pointer).toBeNull();
    expect(stores.size).toBe(0);
    expect(pendingFlag).toBe(false);
  });

  it('sair SEM rede: o aparelho é limpo na hora e a revogação da sessão fica pendente', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    networkDown = true;
    expect(await offline.signOut()).toBe('pending');
    expect(purges).toEqual(['sign_out']);
    expect(stores.size).toBe(0);
    expect(pendingFlag).toBe(true);
    // sem rede, ler já não mostra nada da pessoa
    expect(await offline.readLesson(COURSE, 'l1')).toEqual({ kind: 'blocked', reason: 'no_user' });
  });

  it('o servidor falhou online: NADA é apagado e dá para tentar de novo', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    signOutOutcome = 'error';
    expect(await offline.signOut()).toBe('failed');
    expect(purges).toEqual([]);
    expect(storeOf('user-a').lessons.size).toBe(1);
    expect(pendingFlag).toBe(false);
  });

  it('a rede volta: o "sair" pendente é revogado e só então a verificação segue; com falha, nada é verificado nem guardado', async () => {
    const offline = service();
    pendingFlag = true;
    networkDown = true;
    expect(await offline.flushPendingSignOut()).toBe(false);
    expect(await offline.rememberLesson(lessonView('l1'))).toBe('skipped'); // pendente: não guarda nada
    expect(stores.size).toBe(0);
    await offline.refreshInBackground();
    expect(pointer).toBeNull();
    networkDown = false;
    expect(await offline.flushPendingSignOut()).toBe(true);
    expect(pendingFlag).toBe(false);
    expect(signOutCalls).toBe(3);
  });

  it('com "sair" pendente, a verificação (ex.: aba que voltou) revoga primeiro e não volta a criar dados da pessoa', async () => {
    const offline = service();
    pendingFlag = true;
    identity = { kind: 'anonymous' }; // o servidor já não tem a sessão depois do sign-out
    expect(await offline.verify()).toEqual({ kind: 'anonymous' });
    expect(pendingFlag).toBe(false);
    expect(pointer).toBeNull();
  });

  it('outra pessoa entrou (A→B): o que era de A é apagado ANTES de qualquer leitura ou gravação de B', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('segredo-de-a'));
    identity = { kind: 'user', userId: 'user-b' };
    expect((await offline.verify()).kind).toBe('verified');
    expect(purges).toEqual(['account_changed']);
    expect(stores.has('user-a')).toBe(false); // purga zera tudo; só o banco de B existe agora
    networkDown = true;
    expect(await offline.readLesson(COURSE, 'segredo-de-a')).toEqual({
      kind: 'blocked',
      reason: 'not_saved',
    });
  });

  it('a mesma pessoa verificando de novo NÃO é troca de conta', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    await offline.verify();
    expect(purges).toEqual([]);
    expect(storeOf('user-a').lessons.size).toBe(1);
  });

  it('sessão encerrada (expirou, revogada ou conta suspensa): ao contato online o aparelho é limpo', async () => {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    identity = { kind: 'anonymous' };
    expect(await offline.verify()).toEqual({ kind: 'anonymous' });
    expect(purges).toEqual(['session_ended']);
    expect(pointer).toBeNull();
    networkDown = true;
    expect(await offline.readLesson(COURSE, 'l1')).toEqual({ kind: 'blocked', reason: 'no_user' });
  });

  it('visitante sem ninguém conhecido neste aparelho: nada a limpar, nada pedido ao servidor', async () => {
    identity = { kind: 'anonymous' };
    const offline = service();
    expect(await offline.verify()).toEqual({ kind: 'anonymous' });
    expect(purges).toEqual([]);
  });
});

describe('M8-03: outbox offline e sincronização', () => {
  const task = { lessonId: 'aula-1', courseId: COURSE, lessonTitle: 'Boas-vindas' };

  async function studied() {
    const offline = service();
    await offline.rememberLesson(lessonView('l1'));
    return offline;
  }

  it('concluir sem rede guarda UM comando por aula (clicar de novo não duplica) com id novo', async () => {
    const offline = await studied();
    expect(await offline.enqueueCompletion(task)).toBe('queued');
    expect(await offline.enqueueCompletion(task)).toBe('already_pending');
    const items = await outboxOf('user-a').list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      command: 'lesson.complete',
      lessonId: 'aula-1',
      state: 'pending',
      attempts: 0,
      clientOperationId: OPID(1),
    });
    expect((await offline.outboxSummary()).pending).toHaveLength(1);
    expect(changed).toBeGreaterThan(0);
  });

  it('ninguém conhecido neste aparelho: não guarda nada (no_user)', async () => {
    expect(await service().enqueueCompletion(task)).toBe('no_user');
    expect(outboxes.size).toBe(0);
  });

  it('a rede volta: envia o outbox na ordem, o servidor aplica e o item SAI; a tela é avisada', async () => {
    const offline = await studied();
    await offline.enqueueCompletion({ ...task, lessonId: 'aula-1' });
    clock += 1000;
    await offline.enqueueCompletion({ ...task, lessonId: 'aula-2', lessonTitle: 'Segunda' });
    const outcome = await offline.syncOutbox();
    expect(outcome).toEqual({ kind: 'synced', applied: 2, rejected: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((op) => op.lessonId)).toEqual(['aula-1', 'aula-2']);
    expect(sent[0]![0]).toMatchObject({ command: 'lesson.complete', clientOperationId: OPID(1) });
    expect(await outboxOf('user-a').list()).toEqual([]);
    expect(appliedSignals).toBe(1);
  });

  it('o servidor RECUSA: o item fica VISÍVEL com o motivo até a pessoa dispensar (nunca descarta em silêncio)', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    syncAnswer = (operations) => ({
      kind: 'ok',
      results: operations.map((operation, index) => ({
        index,
        clientOperationId: operation.clientOperationId,
        status: 'rejected' as const,
        reason: 'lesson_not_found' as const,
      })),
    });
    expect(await offline.syncOutbox()).toEqual({ kind: 'synced', applied: 0, rejected: 1 });
    const summary = await offline.outboxSummary();
    expect(summary.pending).toEqual([]);
    expect(summary.rejected).toMatchObject([
      { lessonTitle: 'Boas-vindas', reason: 'lesson_not_found' },
    ]);
    sent = [];
    await offline.syncOutbox();
    expect(sent).toEqual([]); // recusado não é reenviado
    await offline.dismissRejected(summary.rejected[0]!.clientOperationId);
    expect((await offline.outboxSummary()).rejected).toEqual([]);
  });

  it('"duplicate" do servidor: o resultado ORIGINAL vale (aplicado sai; recusado fica com o motivo)', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    await offline.enqueueCompletion({ ...task, lessonId: 'aula-2', lessonTitle: 'Segunda' });
    syncAnswer = (operations) => ({
      kind: 'ok',
      results: [
        {
          index: 0,
          clientOperationId: operations[0]!.clientOperationId,
          status: 'duplicate',
          original: 'applied',
        },
        {
          index: 1,
          clientOperationId: operations[1]!.clientOperationId,
          status: 'duplicate',
          original: 'rejected',
          reason: 'lesson_locked',
        },
      ],
    });
    expect(await offline.syncOutbox()).toEqual({ kind: 'synced', applied: 1, rejected: 1 });
    const summary = await offline.outboxSummary();
    expect(summary.pending).toEqual([]);
    expect(summary.rejected).toMatchObject([{ lessonId: 'aula-2', reason: 'lesson_locked' }]);
  });

  it('sem rede, 5xx ou 401: o outbox é MANTIDO; com a rede, a mesma operação é reenviada com o MESMO id', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    networkDown = true;
    expect((await offline.syncOutbox()).kind).toBe('offline');
    networkDown = false;
    syncAnswer = () => ({ kind: 'error' });
    expect((await offline.syncOutbox()).kind).toBe('failed');
    syncAnswer = () => ({ kind: 'unauthenticated' });
    expect((await offline.syncOutbox()).kind).toBe('no_session');
    const [item] = await outboxOf('user-a').list();
    expect(item).toMatchObject({ state: 'pending' });
    syncAnswer = applyAll;
    sent = [];
    expect((await offline.syncOutbox()).kind).toBe('synced');
    expect(sent[0]![0]!.clientOperationId).toBe(OPID(1));
    expect(await outboxOf('user-a').list()).toEqual([]);
  });

  it('só envia se a sessão for da DONA do outbox: outra pessoa logada não envia o outbox de A', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    identity = { kind: 'user', userId: 'user-b' };
    expect(await offline.syncOutbox()).toEqual({ kind: 'nothing' }); // B não tem outbox
    expect(sent).toEqual([]);
    expect(outboxOf('user-a').items.size).toBe(1);
    // O servidor também trava: se a sessão mudar no meio, responde wrong_account e nada sai.
    identity = { kind: 'user', userId: 'user-a' };
    syncAnswer = () => ({ kind: 'wrong_account' });
    expect((await offline.syncOutbox()).kind).toBe('wrong_account');
    expect(outboxOf('user-a').items.size).toBe(1);
  });

  it('sessão acabou (sem login): o estudo é apagado, mas o OUTBOX fica; ao entrar de novo como a MESMA pessoa, é enviado', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    identity = { kind: 'anonymous' };
    expect((await offline.verify()).kind).toBe('anonymous');
    expect(purges).toEqual(['session_ended']);
    expect(outboxOf('user-a').items.size).toBe(1);
    identity = { kind: 'user', userId: 'user-a' };
    await offline.refreshInBackground(); // sem ponteiro, mas COM outbox: ainda verifica
    expect(sent).toHaveLength(1);
    expect(outboxOf('user-a').items.size).toBe(0);
  });

  it('A→B: o estudo de A é apagado, o outbox de A fica guardado e B NUNCA o envia; B tem o próprio', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    identity = { kind: 'user', userId: 'user-b' };
    await offline.verify();
    expect(purges).toEqual(['account_changed']);
    expect(sent).toEqual([]);
    expect(outboxOf('user-a').items.size).toBe(1);
    expect(await offline.enqueueCompletion({ ...task, lessonId: 'aula-b' })).toBe('queued');
    expect(outboxOf('user-b').items.size).toBe(1);
  });

  it('toda verificação online bem-sucedida descarrega o outbox (ex.: a rede voltou)', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    await offline.refreshInBackground();
    expect(sent).toHaveLength(1);
    expect(await outboxOf('user-a').list()).toEqual([]);
  });

  it('lote grande: 120 pendentes viram lotes de no máximo 50, em ordem', async () => {
    const offline = await studied();
    for (let n = 0; n < 120; n += 1) {
      clock += 1;
      await offline.enqueueCompletion({ ...task, lessonId: `aula-${n}` });
    }
    await offline.syncOutbox();
    expect(sent.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(sent.flat().map((op) => op.lessonId)[0]).toBe('aula-0');
    expect(outboxOf('user-a').items.size).toBe(0);
  });

  it('sair com conclusão NÃO enviada: prepareSignOut conta; só "sair e descartar" apaga o outbox', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    networkDown = true;
    expect(await offline.prepareSignOut(50)).toEqual({ pending: 1 });
    expect(await offline.signOut()).toBe('pending'); // sem confirmar o descarte, o outbox continua
    expect(outboxOf('user-a').items.size).toBe(1);
    pointer = 'user-a';
    expect(await offline.signOut({ discardOutbox: true })).toBe('pending');
    expect(outboxes.has('user-a')).toBe(false);
  });

  it('sair com o outbox já enviado: nada pendente (sem confirmação)', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    expect(await offline.prepareSignOut()).toEqual({ pending: 0 });
    expect(sent).toHaveLength(1);
  });

  it('"sair" pendente (sem rede): NADA é enviado até a sessão ser revogada', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    pendingFlag = true;
    expect(await offline.syncOutbox()).toEqual({ kind: 'skipped' });
    expect(sent).toEqual([]);
  });

  it('uma sincronização por vez na mesma aba', async () => {
    const offline = await studied();
    await offline.enqueueCompletion(task);
    const [first, second] = await Promise.all([offline.syncOutbox(), offline.syncOutbox()]);
    expect([first.kind, second.kind].sort()).toEqual(['busy', 'synced']);
    expect(sent).toHaveLength(1);
  });
});

describe('M8-06: certificados offline', () => {
  const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
  const sha = async (bytes: ArrayBuffer) => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  const cert = (id: string, status: MyCertificateDto['status'] = 'ready'): MyCertificateDto => ({
    id,
    courseTitle: `Curso ${id}`,
    status,
    code: `COD-${id}`,
    readyAt: '2026-10-10T12:00:00.000Z',
    canDownload: status === 'ready',
  });

  async function withList(list: MyCertificateDto[]) {
    const offline = service();
    await offline.verify(); // identifica a pessoa (ponteiro)
    expect(await offline.rememberCertificates(list)).toBe('saved');
    return offline;
  }

  it('guarda a lista com o instante da verificação e a lê sem rede, SEMPRE com essa data', async () => {
    const offline = await withList([cert('c1'), cert('c2', 'revoked')]);
    networkDown = true;
    clock += 5 * HOUR;
    const read = await offline.readCertificates();
    expect(read).toMatchObject({ kind: 'ok', verifiedAt: T0, pdfIds: [] });
    expect(read.kind === 'ok' && read.items.map((item) => item.status)).toEqual([
      'ready',
      'revoked',
    ]);
  });

  it('ninguém conhecido, ou nada guardado: bloqueado (nunca inventa uma lista)', async () => {
    expect(await service().readCertificates()).toEqual({ kind: 'blocked', reason: 'no_user' });
    pointer = 'user-a';
    expect(await service().readCertificates()).toEqual({ kind: 'blocked', reason: 'not_saved' });
  });

  it('lista vazia e ninguém conhecido: não guarda nem chama o servidor', async () => {
    let calls = 0;
    const offline = createOfflineService({
      ...baseDeps(),
      fetchIdentity: async () => {
        calls += 1;
        return identity;
      },
    });
    expect(await offline.rememberCertificates([])).toBe('skipped');
    expect(calls).toBe(0);
  });

  it('sem pessoa conhecida, guardar a lista primeiro CONFIRMA a identidade online; anônimo não guarda nada', async () => {
    identity = { kind: 'anonymous' };
    expect(await service().rememberCertificates([cert('c1')])).toBe('skipped');
    expect(stores.size).toBe(0);
    identity = { kind: 'user', userId: 'user-a' };
    expect(await service().rememberCertificates([cert('c1')])).toBe('saved');
    expect(pointer).toBe('user-a');
  });

  it('baixar o PDF de propósito: confere o hash do servidor, guarda os bytes com o SHA-256 e abre offline', async () => {
    const offline = await withList([cert('c1')]);
    const bytes = bytesOf('%PDF-1.7 certificado do aluno');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    expect(await offline.saveCertificatePdf('c1')).toBe('saved');
    expect(storeOf('user-a').pdfs.get('c1')?.sha256).toBe(await sha(bytes));
    networkDown = true;
    const opened = await offline.openCertificatePdf('c1');
    expect(opened).toMatchObject({ kind: 'ok', filename: 'certificado-COD-c1.pdf' });
    expect(opened.kind === 'ok' && new TextDecoder().decode(opened.bytes)).toContain('%PDF-1.7');
    expect((await offline.readCertificates()).kind === 'ok').toBe(true);
  });

  it('o hash recebido NÃO bate com o que o servidor conferiu: nada é guardado', async () => {
    const offline = await withList([cert('c1')]);
    pdfAnswer = {
      kind: 'ok',
      bytes: bytesOf('conteúdo trocado no caminho'),
      sha256: 'a'.repeat(64),
    };
    expect(await offline.saveCertificatePdf('c1')).toBe('integrity_failed');
    expect(storeOf('user-a').pdfs.size).toBe(0);
  });

  it('só guarda PDF de certificado que está na lista como pronto; 404, sem sessão e erro do servidor viram resultados', async () => {
    const offline = await withList([cert('c1'), cert('c2', 'revoked')]);
    const bytes = bytesOf('%PDF');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    expect(await offline.saveCertificatePdf('c2')).toBe('failed'); // revogado: não está pronto
    expect(await offline.saveCertificatePdf('fora-da-lista')).toBe('failed');
    pdfAnswer = { kind: 'not_available' };
    expect(await offline.saveCertificatePdf('c1')).toBe('not_available');
    pdfAnswer = { kind: 'unauthenticated' };
    expect(await offline.saveCertificatePdf('c1')).toBe('unauthenticated');
    pdfAnswer = { kind: 'error' };
    expect(await offline.saveCertificatePdf('c1')).toBe('failed');
    networkDown = true;
    expect(await offline.saveCertificatePdf('c1')).toBe('failed'); // sem rede não baixa
    expect(storeOf('user-a').pdfs.size).toBe(0);
  });

  it('CACHE ADULTERADO: o hash recalculado diverge, a cópia é DESCARTADA e o app avisa', async () => {
    const offline = await withList([cert('c1')]);
    const bytes = bytesOf('%PDF original');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    await offline.saveCertificatePdf('c1');
    const record = storeOf('user-a').pdfs.get('c1')!;
    storeOf('user-a').pdfs.set('c1', { ...record, bytes: bytesOf('%PDF adulterado') });
    expect(await offline.openCertificatePdf('c1')).toEqual({ kind: 'tampered' });
    expect(storeOf('user-a').pdfs.size).toBe(0);
    expect(await offline.openCertificatePdf('c1')).toEqual({ kind: 'missing' });
  });

  it('REVOGADO depois do download: ao reverificar online a lista é renovada e a cópia do PDF SAI', async () => {
    const offline = await withList([cert('c1')]);
    const bytes = bytesOf('%PDF');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    await offline.saveCertificatePdf('c1');
    // Sem rede a cópia ainda abre (limite dito na tela); a revogação só chega ao reconectar.
    networkDown = true;
    expect((await offline.openCertificatePdf('c1')).kind).toBe('ok');
    networkDown = false;
    certificatesAnswer = [cert('c1', 'revoked')];
    clock += 2 * HOUR;
    await offline.verify();
    expect(storeOf('user-a').pdfs.size).toBe(0);
    const read = await offline.readCertificates();
    expect(read.kind === 'ok' && read.items[0]?.status).toBe('revoked');
    expect(read.kind === 'ok' && read.verifiedAt).toBe(T0 + 2 * HOUR);
    expect(await offline.openCertificatePdf('c1')).toEqual({ kind: 'missing' });
  });

  it('substituído ou fora da lista: perde o PDF; a lista nova traz a data da NOVA verificação', async () => {
    const offline = await withList([cert('c1'), cert('c2')]);
    const bytes = bytesOf('%PDF');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    await offline.saveCertificatePdf('c1');
    await offline.saveCertificatePdf('c2');
    certificatesAnswer = [cert('c1', 'revoked')]; // c2 saiu da lista
    clock += HOUR;
    await offline.verify();
    expect(storeOf('user-a').pdfs.size).toBe(0);
  });

  it('só renova a lista a quem JÁ guarda certificados (não chama o servidor à toa)', async () => {
    const offline = service();
    await offline.verify();
    expect(certificateFetches).toBe(0);
  });

  it('a lista guardada que já diz "não pronto" remove a cópia ao tentar abrir', async () => {
    const offline = await withList([cert('c1')]);
    const bytes = bytesOf('%PDF');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    await offline.saveCertificatePdf('c1');
    const store = storeOf('user-a');
    store.certificates = { verifiedAt: T0, items: [cert('c1', 'revoked')] }; // lista e PDF dessincronizados
    expect(await offline.openCertificatePdf('c1')).toEqual({ kind: 'not_ready' });
    expect(store.pdfs.size).toBe(0);
  });

  it('o PDF de A é inacessível a B (cada conta tem o seu banco) e a purga do aparelho leva tudo', async () => {
    const offline = await withList([cert('c1')]);
    const bytes = bytesOf('%PDF');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    await offline.saveCertificatePdf('c1');
    identity = { kind: 'user', userId: 'user-b' };
    await offline.verify(); // B entra: o aparelho é limpo (account_changed)
    expect(purges).toEqual(['account_changed']);
    expect(await offline.openCertificatePdf('c1')).toEqual({ kind: 'missing' });
    expect(stores.has('user-a')).toBe(false);
  });

  it('remover a cópia a pedido da pessoa', async () => {
    const offline = await withList([cert('c1')]);
    const bytes = bytesOf('%PDF');
    pdfAnswer = { kind: 'ok', bytes, sha256: await sha(bytes) };
    await offline.saveCertificatePdf('c1');
    await offline.removeCertificatePdf('c1');
    expect(storeOf('user-a').pdfs.size).toBe(0);
  });
});
