import { beforeEach, describe, expect, it } from 'vitest';

import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import { advanceClock } from '../../features/pwa/offline-lease';
import {
  createOfflineService,
  type Identity,
  type LeaseFetch,
  type OfflineDeps,
  type SignOutOutcome,
} from './service';
import type {
  OfflineIndex,
  OfflineMeta,
  OfflineStore,
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
  async putOutline(record: StoredOutline) {
    this.outlines.set(record.courseId, record);
  }
  async getOutline(courseId: string) {
    return this.outlines.get(courseId) ?? null;
  }
  async clearAll() {
    this.meta = null;
    this.leases.clear();
    this.lessons.clear();
    this.outlines.clear();
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

function baseDeps(): OfflineDeps {
  return {
    now: () => clock,
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
