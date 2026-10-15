import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * API simulada e utilitários do IndexedDB para os testes de offline (M8-02, M8-05). "Sem rede" é o portão de API que aborta com
 * `internetdisconnected`: o app vê um `TypeError` do `fetch`, como na vida real.
 */
export const COURSE_ID = '11111111-1111-4111-8111-111111111111';
export const L = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
export const T0 = new Date('2026-10-15T12:00:00.000Z');
export const HOUR = 3_600_000;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const lessonView = (n: number, extra: Record<string, unknown> = {}) => ({
  course: { id: COURSE_ID, title: 'Curso Demonstrativo' },
  lesson: {
    id: L(n),
    title: `Aula ${n}`,
    isOptional: false,
    body: doc(`Conteúdo secreto da aula ${n}.`),
    ...extra,
  },
  completed: false,
  previous: n > 1 ? { id: L(n - 1), title: `Aula ${n - 1}` } : null,
  next: { id: L(n + 1), title: `Aula ${n + 1}` },
});

const outline = {
  course: { id: COURSE_ID, title: 'Curso Demonstrativo', sequenceMode: 'free' },
  access: { hasAccess: true, reason: 'ok', expiresAt: '2027-01-10T12:00:00.000Z' },
  progress: { completed: 0, total: 3, percent: 0 },
  completedAt: null,
  modules: [
    {
      id: 'm1',
      title: 'Primeiros passos',
      releasesAt: '2026-10-01T03:00:00.000Z',
      lessons: [1, 2, 3].map((n) => ({
        id: L(n),
        title: `Aula ${n}`,
        isOptional: false,
        completed: false,
        locked: null,
        releasesAt: null,
      })),
    },
  ],
};

export interface Backend {
  online: boolean;
  userId: string;
  /** Hora do servidor devolvida no lease (acompanha o relógio simulado do navegador). */
  serverNow: () => Date;
  /** Cursos que têm lease agora (vazio = acesso revogado). */
  leaseCourses: string[];
  staff: boolean;
  leaseCalls: number;
  /** Há sessão no servidor? Sem ela, `/api/me` e o lease respondem 401 (expirou, foi revogada ou a pessoa saiu). */
  session: boolean;
  signOutCalls: number;
  /** Resposta do `sign-out` (200 encerra a sessão). */
  signOutStatus: number;
}

export function newBackend(overrides: Partial<Backend> = {}): Backend {
  return {
    online: true,
    userId: 'aluna-a',
    serverNow: () => new Date(),
    leaseCourses: [COURSE_ID],
    staff: false,
    leaseCalls: 0,
    session: true,
    signOutCalls: 0,
    signOutStatus: 200,
    ...overrides,
  };
}

/** A API simulada. O portão "sem rede" é registrado POR ÚLTIMO: o Playwright executa a rota mais recente primeiro. */
export async function mockApi(context: BrowserContext, backend: Backend) {
  await context.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await context.route('**/api/me', (route) =>
    backend.session
      ? route.fulfill({
          json: { id: backend.userId, email: `${backend.userId}@example.test`, name: 'Pessoa' },
        })
      : route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
  );
  await context.route('**/api/me/profile', (route) =>
    route.fulfill({
      json: {
        displayName: 'Maria Souza',
        certificateName: null,
        certificateNameConfirmed: false,
        theme: 'system',
        autoAdvance: false,
      },
    }),
  );
  await context.route('**/api/me/course-interests**', (route) =>
    route.fulfill({ json: { interests: [] } }),
  );
  await context.route('**/api/me/certificates', (route) =>
    route.fulfill({ json: { certificates: [] } }),
  );
  await context.route('**/api/auth/sign-out', (route) => {
    backend.signOutCalls += 1;
    if (backend.signOutStatus === 200) backend.session = false;
    return route.fulfill({ status: backend.signOutStatus, json: { success: true } });
  });
  await context.route('**/api/offline/lease', (route) => {
    backend.leaseCalls += 1;
    if (!backend.session) {
      return route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } });
    }
    if (backend.staff) {
      return route.fulfill({ status: 403, json: { error: { code: 'offline_not_available' } } });
    }
    const now = backend.serverNow();
    return route.fulfill({
      json: {
        serverNow: now.toISOString(),
        courses: backend.leaseCourses.map((courseId) => ({
          courseId,
          leaseUntil: new Date(now.getTime() + 72 * HOUR).toISOString(),
        })),
      },
    });
  });
  await context.route('**/api/courses/*/outline', (route) => route.fulfill({ json: outline }));
  await context.route('**/api/lessons/*/discussion**', (route) =>
    route.fulfill({ json: { threads: [] } }),
  );
  await context.route(/\/api\/lessons\/[0-9a-f-]{36}$/, (route) => {
    const id = route.request().url().split('/').pop()!;
    const n = Number(id.slice(-1));
    return route.fulfill({ json: n === 5 ? lessonView(5, { kind: 'quiz' }) : lessonView(n) });
  });
  await context.route('**/api/**', (route) =>
    backend.online ? route.fallback() : route.abort('internetdisconnected'),
  );
}

/** As aulas guardadas, em TODOS os bancos de conta deste navegador (nunca em outro lugar). */
export async function storedLessons(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const info of await indexedDB.databases()) {
      const name = info.name ?? '';
      if (!name.startsWith('hub-offline-') || name === 'hub-offline-index') continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction('lessons').objectStore('lessons').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      out[name] = keys.map(String);
    }
    return out;
  });
}

export const savedCount = async (page: Page) =>
  Object.values(await storedLessons(page)).reduce((sum, list) => sum + list.length, 0);

export async function openLesson(page: Page, n: number) {
  await page.goto(`/estudar/${COURSE_ID}/aulas/${L(n)}`);
  await expect(page.getByRole('heading', { level: 1, name: `Aula ${n}` })).toBeVisible();
}

export const goOffline = (backend: Backend) => {
  backend.online = false;
};
