import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import type { Quiz } from '../../src/features/quiz/quiz.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-04 em Postgres 18 real: quiz como aula. A nota é calculada SÓ no servidor (acerto total por questão),
 * o gabarito nunca chega ao aluno antes da submissão, o histórico guarda uma cópia do quiz apresentado
 * (append-only), as tentativas respeitam o máximo mesmo em concorrência, e acesso/drip/sequência são
 * reverificados a cada envio. A aprovação conclui a aula (método `quiz`) e conta para a conclusão do curso.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
/** Todos os módulos do demonstrativo (D+0, D+7, D+14) já liberados pelo drip. */
const LATE = new Date('2026-10-30T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;
let clockNow = LATE;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  clockNow = LATE;
  await tools.db.execute(
    sql`truncate table quiz_attempt, video_progress, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;
const app = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    clock: () => clockNow,
  });

async function newStudent() {
  seq += 1;
  const user = tools.test.createUser({ email: `aluno${seq}@example.test`, name: `Aluno ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}
function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Q1 (single, 1 ponto): A (11) certa. Q2 (multiple, 2 pontos): B (22) e C (23) certas. Q3 (single, 1 ponto): E (32) certa. */
function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    minScorePercent: 70,
    maxAttempts: null,
    feedback: 'immediate',
    shuffle: false,
    questions: [
      {
        id: id(1),
        prompt: 'Primeira pergunta',
        kind: 'single',
        points: 1,
        options: [
          { id: id(11), text: 'A', correct: true },
          { id: id(12), text: 'B', correct: false },
        ],
      },
      {
        id: id(2),
        prompt: 'Segunda pergunta',
        kind: 'multiple',
        points: 2,
        options: [
          { id: id(21), text: 'A', correct: false },
          { id: id(22), text: 'B', correct: true },
          { id: id(23), text: 'C', correct: true },
        ],
      },
      {
        id: id(3),
        prompt: 'Terceira pergunta',
        kind: 'single',
        points: 1,
        options: [
          { id: id(31), text: 'D', correct: false },
          { id: id(32), text: 'E', correct: true },
        ],
      },
    ],
    ...overrides,
  };
}
const answer = (questionId: string, ...optionIds: string[]) => ({ questionId, optionIds });
const RIGHT = [answer(id(1), id(11)), answer(id(2), id(22), id(23)), answer(id(3), id(32))];
const WRONG = [answer(id(1), id(12)), answer(id(2), id(21)), answer(id(3), id(31))];
/** 3 de 4 pontos (75%): erra só a terceira. */
const THREE_OF_FOUR = [answer(id(1), id(11)), answer(id(2), id(22), id(23)), answer(id(3), id(31))];

/** O demonstrativo com 'Boas-vindas' (D+0, a primeira) virada em QUIZ. */
async function quizCourse(quiz: Quiz = makeQuiz()) {
  const fixture = await createDemoCourse(tools.db);
  const rows = await tools.db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  const lesson = Object.fromEntries(rows.map((row) => [row.title, row.id])) as Record<
    string,
    string
  >;
  await setQuiz(lesson['Boas-vindas']!, quiz);
  return { ...fixture, lesson, quizLesson: lesson['Boas-vindas']! };
}
async function setQuiz(lessonId: string, quiz: Quiz) {
  await tools.db
    .update(schema.lesson)
    .set({ kind: 'quiz', quiz })
    .where(eq(schema.lesson.id, lessonId));
}

async function enrolled(courseId: string, offerId: string, accessMonths = 12) {
  const student = await newStudent();
  await grantEntitlement(tools.db, {
    userId: student.id,
    courseId,
    offerId,
    source: 'free_offer',
    sourceRef: `free:${student.id}:${offerId}:0`,
    accessMonths,
    startsAt: T0,
    grantedBy: student.id,
  });
  return student;
}

const submit = (headers: Headers | undefined, lessonId: string, answers: unknown) =>
  call('POST', `/lessons/${lessonId}/quiz-attempts`, headers, { answers });
const attemptsOf = (userId: string) =>
  tools.db
    .select()
    .from(schema.quizAttempt)
    .where(eq(schema.quizAttempt.userId, userId))
    .orderBy(schema.quizAttempt.number);
/** Erros do Drizzle trazem a mensagem do Postgres em `cause`: confere nas duas. */
async function violation(work: PromiseLike<unknown>, pattern: RegExp) {
  let caught: unknown;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'esperava uma violação').toBeDefined();
  const text = [caught, (caught as { cause?: unknown }).cause]
    .map((item) => (item as Error | undefined)?.message ?? '')
    .join(' | ');
  expect(text).toMatch(pattern);
}
const completionsOf = (userId: string) =>
  tools.db.select().from(schema.lessonCompletion).where(eq(schema.lessonCompletion.userId, userId));

describe('o que o aluno recebe (sem gabarito)', () => {
  it('a aula traz o quiz SEM `correct` e sem nenhuma pista do gabarito, com o estado das tentativas', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    const response = await call('GET', `/lessons/${quizLesson}`, student.headers);
    expect(response.status).toBe(200);
    const text = await response.clone().text();
    expect(text).not.toContain('correct');
    const body = await json(response);
    expect(body.lesson.kind).toBe('quiz');
    expect(body.lesson.quiz).toMatchObject({
      attemptsUsed: 0,
      attemptsLeft: null,
      passed: false,
      canAttempt: true,
      last: null,
      quiz: { minScorePercent: 70, maxAttempts: null, feedback: 'immediate' },
    });
    expect(body.lesson.quiz.quiz.questions).toHaveLength(3);
    expect(body.lesson.quiz.quiz.questions[1].options.map((o: { id: string }) => o.id)).toEqual([
      id(21),
      id(22),
      id(23),
    ]);
  });

  it('embaralhar é determinístico por tentativa: a mesma ordem ao reabrir, e outra na tentativa seguinte', async () => {
    const many = makeQuiz({
      shuffle: true,
      questions: Array.from({ length: 8 }, (_, index) => ({
        id: id(100 + index),
        prompt: `Pergunta ${index}`,
        kind: 'single' as const,
        points: 1,
        options: [
          { id: id(200 + index * 4), text: 'a', correct: true },
          { id: id(201 + index * 4), text: 'b', correct: false },
          { id: id(202 + index * 4), text: 'c', correct: false },
          { id: id(203 + index * 4), text: 'd', correct: false },
        ],
      })),
    });
    const { courseId, offerId, quizLesson } = await quizCourse(many);
    const student = await enrolled(courseId, offerId);
    const order = async () =>
      JSON.stringify(
        (await json(await call('GET', `/lessons/${quizLesson}`, student.headers))).lesson.quiz.quiz
          .questions,
      );
    const first = await order();
    expect(await order()).toBe(first);
    const original = JSON.stringify(
      many.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        kind: question.kind,
        points: question.points,
        options: question.options.map((option) => ({ id: option.id, text: option.text })),
      })),
    );
    expect(first).not.toBe(original);
    // errou a 1ª tentativa: a ordem da 2ª é outra
    expect(
      (
        await submit(
          student.headers,
          quizLesson,
          many.questions.map((question) => answer(question.id, question.options[1]!.id)),
        )
      ).status,
    ).toBe(201);
    expect(await order()).not.toBe(first);
  });

  it('a prévia da Staff mostra o quiz sem gabarito, sem tentativas e sem gravar', async () => {
    const { courseId, quizLesson } = await quizCourse();
    seq += 1;
    const staffUser = tools.test.createUser({ email: `staff${seq}@example.test`, name: 'Staff' });
    await tools.test.saveUser(staffUser);
    await grantRole(tools.db, { actorId: null, targetId: staffUser.id, role: 'admin' });
    const staff = await tools.test.login({ userId: staffUser.id });
    const preview = await call(
      'GET',
      `/staff/preview/courses/${courseId}/lessons/${quizLesson}`,
      staff.headers,
    );
    expect(preview.status).toBe(200);
    expect(await preview.clone().text()).not.toContain('correct');
    expect((await json(preview)).lesson.quiz).toMatchObject({ attemptsUsed: 0, last: null });
    // enviar uma tentativa na prévia: sem matrícula, 403, e nada é gravado
    expect((await submit(staff.headers, quizLesson, RIGHT)).status).toBe(403);
    expect(await tools.db.select().from(schema.quizAttempt)).toHaveLength(0);
    expect(await tools.db.select().from(schema.lessonCompletion)).toHaveLength(0);
  });
});

describe('a nota é do servidor', () => {
  it('errou: 201 com a nota, sem conclusão, e o gabarito só depois de enviar (feedback imediato)', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    const response = await submit(student.headers, quizLesson, WRONG);
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.attempt).toEqual({
      number: 1,
      scorePercent: 0,
      earnedPoints: 0,
      totalPoints: 4,
      passed: false,
      minScorePercent: 70,
    });
    expect(body.completion).toBeUndefined();
    expect(body.review).toEqual([
      { questionId: id(1), correct: false, selected: [id(12)], correctOptionIds: [id(11)] },
      { questionId: id(2), correct: false, selected: [id(21)], correctOptionIds: [id(22), id(23)] },
      { questionId: id(3), correct: false, selected: [id(31)], correctOptionIds: [id(32)] },
    ]);
    expect(await completionsOf(student.id)).toHaveLength(0);
    // o estado da aula reflete a tentativa
    const view = await json(await call('GET', `/lessons/${quizLesson}`, student.headers));
    expect(view.lesson.quiz).toMatchObject({
      attemptsUsed: 1,
      passed: false,
      canAttempt: true,
      last: { number: 1, scorePercent: 0, passed: false },
    });
  });

  it('feedback só-nota: a resposta NÃO traz acerto por questão nem o gabarito, em lugar nenhum', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse(
      makeQuiz({ feedback: 'score_only' }),
    );
    const student = await enrolled(courseId, offerId);
    const response = await submit(student.headers, quizLesson, THREE_OF_FOUR);
    const text = await response.clone().text();
    const body = await json(response);
    expect(body.review).toBeUndefined();
    expect(text).not.toContain('correctOptionIds');
    expect(text).not.toContain('"correct"');
    expect(body.attempt).toMatchObject({ scorePercent: 75, passed: true });
  });

  it('aprovou: a aula conclui com o método quiz, de forma idempotente; nova tentativa é 409', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    const response = await submit(student.headers, quizLesson, RIGHT);
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.attempt).toMatchObject({ scorePercent: 100, passed: true });
    expect(body.completion).toMatchObject({ status: 'completed', courseJustCompleted: false });
    expect(await completionsOf(student.id)).toEqual([
      expect.objectContaining({ lessonId: quizLesson, method: 'quiz' }),
    ]);
    const again = await submit(student.headers, quizLesson, RIGHT);
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe('quiz_already_passed');
    expect(await attemptsOf(student.id)).toHaveLength(1);
    expect(await completionsOf(student.id)).toHaveLength(1);
    const view = await json(await call('GET', `/lessons/${quizLesson}`, student.headers));
    expect(view).toMatchObject({ completed: true });
    expect(view.lesson.quiz).toMatchObject({ passed: true, canAttempt: false });
  });

  it('a nota EXATAMENTE no limite aprova (75% com mínimo 75)', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse(makeQuiz({ minScorePercent: 75 }));
    const student = await enrolled(courseId, offerId);
    const body = await json(await submit(student.headers, quizLesson, THREE_OF_FOUR));
    expect(body.attempt).toMatchObject({ scorePercent: 75, passed: true });
    expect(await completionsOf(student.id)).toHaveLength(1);
  });

  it('um ponto percentual acima do limite não aprova (75% com mínimo 76)', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse(makeQuiz({ minScorePercent: 76 }));
    const student = await enrolled(courseId, offerId);
    const body = await json(await submit(student.headers, quizLesson, THREE_OF_FOUR));
    expect(body.attempt).toMatchObject({ scorePercent: 75, passed: false });
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('múltipla escolha sem crédito parcial: marcar só uma das duas corretas vale zero na questão', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    const body = await json(
      await submit(student.headers, quizLesson, [
        answer(id(1), id(11)),
        answer(id(2), id(22)),
        answer(id(3), id(32)),
      ]),
    );
    expect(body.attempt).toMatchObject({ earnedPoints: 2, totalPoints: 4, scorePercent: 50 });
    expect(body.review[1]).toMatchObject({ correct: false });
  });

  it('o cliente não escolhe a nota: campos a mais (passed, score) e corpo inválido dão 400 e nada é gravado', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    for (const body of [
      { answers: WRONG, passed: true },
      { answers: WRONG, scorePercent: 100 },
      { answers: [{ questionId: id(1), optionIds: [id(11)], correct: true }] },
      { answers: 'x' },
      {},
      { answers: [{ questionId: 'nao-uuid', optionIds: [] }] },
    ]) {
      const response = await call(
        'POST',
        `/lessons/${quizLesson}/quiz-attempts`,
        student.headers,
        body,
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await attemptsOf(student.id)).toHaveLength(0);
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('resposta adulterada: opção de OUTRA questão, questão inexistente, repetida, duas na single: 400 e nada gravado', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    for (const answers of [
      [answer(id(1), id(21))],
      [answer(id(99), id(11))],
      [answer(id(1), id(11)), answer(id(1), id(12))],
      [answer(id(1), id(11), id(12))],
      [answer(id(2), id(22), id(22))],
    ]) {
      const response = await submit(student.headers, quizLesson, answers);
      expect(response.status, JSON.stringify(answers)).toBe(400);
      expect((await json(response)).error.code).toBe('invalid_answers');
    }
    expect(await attemptsOf(student.id)).toHaveLength(0);
  });

  it('o tipo da aula manda: tentativa em aula de texto é 404, e a aula de quiz não conclui pelo botão', async () => {
    const { courseId, offerId, lesson, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    expect((await submit(student.headers, lesson['Como estudar aqui']!, RIGHT)).status).toBe(404);
    expect(
      (await call('POST', `/lessons/${quizLesson}/complete`, student.headers, {})).status,
    ).toBe(404);
    expect(await completionsOf(student.id)).toHaveLength(0);
  });
});

describe('tentativas', () => {
  it('máximo configurado: depois do limite, 409 attempts_exhausted (mesmo acertando) e nada novo é gravado', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse(makeQuiz({ maxAttempts: 2 }));
    const student = await enrolled(courseId, offerId);
    expect((await json(await submit(student.headers, quizLesson, WRONG))).attemptsLeft).toBe(1);
    expect((await json(await submit(student.headers, quizLesson, WRONG))).attemptsLeft).toBe(0);
    const third = await submit(student.headers, quizLesson, RIGHT);
    expect(third.status).toBe(409);
    expect((await json(third)).error.code).toBe('attempts_exhausted');
    expect((await attemptsOf(student.id)).map((row) => row.number)).toEqual([1, 2]);
    expect(await completionsOf(student.id)).toHaveLength(0);
    const view = await json(await call('GET', `/lessons/${quizLesson}`, student.headers));
    expect(view.lesson.quiz).toMatchObject({ attemptsLeft: 0, canAttempt: false });
  });

  it('ilimitadas por padrão: muitas tentativas seguidas numeram 1..N', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await submit(student.headers, quizLesson, WRONG)).status).toBe(201);
    }
    expect((await attemptsOf(student.id)).map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('tentativas SIMULTÂNEAS no limite: exatamente `máximo` são aceitas, as demais 409, números únicos', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse(makeQuiz({ maxAttempts: 3 }));
    const student = await enrolled(courseId, offerId);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => submit(student.headers, quizLesson, WRONG)),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 201, 201, 409, 409, 409, 409, 409]);
    expect((await attemptsOf(student.id)).map((row) => row.number)).toEqual([1, 2, 3]);
  });

  it('aprovações SIMULTÂNEAS geram UMA tentativa aprovada e UMA conclusão', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => submit(student.headers, quizLesson, RIGHT)),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(4);
    expect(await attemptsOf(student.id)).toHaveLength(1);
    expect(await completionsOf(student.id)).toHaveLength(1);
  });
});

describe('acesso reverificado a cada envio', () => {
  it('sem sessão 401; quem não está matriculado 403; ids malformados 404', async () => {
    const { quizLesson } = await quizCourse();
    expect((await submit(undefined, quizLesson, RIGHT)).status).toBe(401);
    const outsider = await newStudent();
    const denied = await submit(outsider.headers, quizLesson, RIGHT);
    expect(denied.status).toBe(403);
    expect((await json(denied)).error).toMatchObject({ code: 'access_denied' });
    expect((await submit(outsider.headers, 'xyz', RIGHT)).status).toBe(404);
    expect((await submit(outsider.headers, crypto.randomUUID(), RIGHT)).status).toBe(404);
    expect(await tools.db.select().from(schema.quizAttempt)).toHaveLength(0);
  });

  it('módulo ainda NÃO liberado pelo drip: 403 lesson_locked e nada gravado', async () => {
    const { courseId, offerId, lesson } = await quizCourse();
    await setQuiz(lesson['Conceito central']!, makeQuiz());
    clockNow = new Date(T0.getTime() + 60_000); // só o módulo 1 está liberado
    const student = await enrolled(courseId, offerId);
    const response = await submit(student.headers, lesson['Conceito central']!, RIGHT);
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'lesson_locked' });
    expect(await attemptsOf(student.id)).toHaveLength(0);
  });

  it('sequência guiada: o quiz que vem DEPOIS de uma obrigatória não concluída está bloqueado', async () => {
    const { courseId, offerId, lesson } = await quizCourse();
    // 'Como estudar aqui' é a 2ª aula (obrigatória); vira quiz, mas a 1ª ainda não foi concluída
    await setQuiz(lesson['Como estudar aqui']!, makeQuiz());
    const student = await enrolled(courseId, offerId);
    const response = await submit(student.headers, lesson['Como estudar aqui']!, RIGHT);
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'lesson_locked' });
    expect(await attemptsOf(student.id)).toHaveLength(0);
  });

  it('acesso EXPIRADO: 403 e nada é gravado; a tentativa anterior fica intacta', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId, 1); // 1 mês de acesso
    clockNow = new Date('2026-10-20T12:00:00.000Z');
    expect((await submit(student.headers, quizLesson, WRONG)).status).toBe(201);
    clockNow = new Date('2026-12-30T12:00:00.000Z');
    const response = await submit(student.headers, quizLesson, RIGHT);
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({
      code: 'access_denied',
      reason: 'expired',
    });
    expect(await attemptsOf(student.id)).toHaveLength(1);
    expect(await completionsOf(student.id)).toHaveLength(0);
  });
});

describe('histórico, edição do quiz e conclusão do curso', () => {
  it('a tentativa guarda a CÓPIA do quiz apresentado: editar o quiz depois não reescreve o histórico', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    await submit(student.headers, quizLesson, WRONG);
    // a Staff muda enunciado, gabarito e nota mínima
    const edited = makeQuiz({ minScorePercent: 100 });
    edited.questions[0]!.prompt = 'Pergunta reescrita';
    edited.questions[0]!.options[0]!.correct = false;
    edited.questions[0]!.options[1]!.correct = true;
    await setQuiz(quizLesson, edited);

    const [first] = await attemptsOf(student.id);
    const snapshot = first!.snapshot as Quiz;
    expect(snapshot.minScorePercent).toBe(70);
    expect(snapshot.questions[0]!.prompt).toBe('Primeira pergunta');
    expect(snapshot.questions[0]!.options.find((option) => option.id === id(11))!.correct).toBe(
      true,
    );
    expect(first!.answers).toEqual([
      { questionId: id(1), correct: false, selected: [id(12)] },
      { questionId: id(2), correct: false, selected: [id(21)] },
      { questionId: id(3), correct: false, selected: [id(31)] },
    ]);
    // a próxima tentativa já vale pelo quiz novo (agora B é a certa da Q1)
    const second = await json(
      await submit(student.headers, quizLesson, [
        answer(id(1), id(12)),
        answer(id(2), id(22), id(23)),
        answer(id(3), id(32)),
      ]),
    );
    expect(second.attempt).toMatchObject({
      number: 2,
      scorePercent: 100,
      minScorePercent: 100,
      passed: true,
    });
    expect((await attemptsOf(student.id)).map((row) => row.number)).toEqual([1, 2]);
  });

  it('quiz que mudou de questões depois de a página abrir: a resposta antiga é 400 e nada é gravado', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    const smaller = makeQuiz({ questions: makeQuiz().questions.slice(0, 1) });
    await setQuiz(quizLesson, smaller);
    const response = await submit(student.headers, quizLesson, RIGHT); // responde a questões que sumiram
    expect(response.status).toBe(400);
    expect(await attemptsOf(student.id)).toHaveLength(0);
  });

  it('o histórico é append-only (não se reescreve nem se apaga) e o número é único por pessoa e aula', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    await submit(student.headers, quizLesson, WRONG);
    await violation(
      tools.db.execute(sql`update quiz_attempt set passed = true where user_id = ${student.id}`),
      /quiz_attempt_immutable/,
    );
    await violation(
      tools.db.execute(sql`delete from quiz_attempt where user_id = ${student.id}`),
      /quiz_attempt_not_deletable/,
    );
    const [row] = await attemptsOf(student.id);
    await violation(
      tools.db.insert(schema.quizAttempt).values({
        userId: student.id,
        courseId,
        lessonId: quizLesson,
        number: 1,
        snapshot: row!.snapshot,
        answers: [],
        earnedPoints: 0,
        totalPoints: 4,
        scorePercent: 0,
        passed: false,
      }),
      /quiz_attempt_number_unique/,
    );
    // a conta do banco também recusa nota incoerente
    await violation(
      tools.db.execute(sql`
        insert into quiz_attempt (user_id, course_id, lesson_id, number, snapshot, answers, earned_points, total_points, score_percent, passed)
        values (${student.id}, ${courseId}, ${quizLesson}, 9, '{}', '[]', 5, 4, 125, true)`),
      /quiz_attempt_score_check/,
    );
  });

  it('o quiz obrigatório conta para a conclusão do curso (e a última aprovação cria a conclusão UMA vez)', async () => {
    const { courseId, offerId, lesson } = await quizCourse();
    await setQuiz(lesson['Próximos passos']!, makeQuiz());
    const student = await enrolled(courseId, offerId);
    const text = (title: string) =>
      call('POST', `/lessons/${lesson[title]}/complete`, student.headers, {});
    expect((await submit(student.headers, lesson['Boas-vindas']!, RIGHT)).status).toBe(201);
    for (const title of ['Como estudar aqui', 'Conceito central', 'Revisão']) {
      expect((await text(title)).status, title).toBe(201);
    }
    expect(await tools.db.select().from(schema.courseCompletion)).toHaveLength(0);

    const last = await json(await submit(student.headers, lesson['Próximos passos']!, RIGHT));
    expect(last.completion).toMatchObject({ courseJustCompleted: true, courseCompleted: true });
    expect(await tools.db.select().from(schema.courseCompletion)).toHaveLength(1);
    const methods = (await completionsOf(student.id)).map((row) => row.method).sort();
    expect(methods).toEqual(['manual', 'manual', 'manual', 'quiz', 'quiz']);
  });

  it('reprovar não conclui nada, nem a aula nem o curso', async () => {
    const { courseId, offerId, quizLesson } = await quizCourse();
    const student = await enrolled(courseId, offerId);
    await submit(student.headers, quizLesson, WRONG);
    expect(await completionsOf(student.id)).toHaveLength(0);
    expect(await tools.db.select().from(schema.courseCompletion)).toHaveLength(0);
    const outline = await json(await call('GET', `/courses/${courseId}/outline`, student.headers));
    expect(outline.progress.completed).toBe(0);
  });
});

describe('o banco guarda o tipo da aula', () => {
  it('aula de quiz exige o quiz; aula de outro tipo não o tem; método quiz é aceito na conclusão', async () => {
    const { lesson } = await quizCourse();
    await violation(
      tools.db.execute(sql`update lesson set quiz = null where id = ${lesson['Boas-vindas']}`),
      /lesson_quiz_check/,
    );
    await violation(
      tools.db.execute(
        sql`update lesson set quiz = '{}'::jsonb where id = ${lesson['Como estudar aqui']}`,
      ),
      /lesson_quiz_check/,
    );
  });
});
