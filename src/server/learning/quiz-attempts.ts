import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { lesson, quizAttempt } from '../../db/schema';
import type { LessonQuizDto } from '../../features/access/outline';
import { gradeAttempt, type AttemptAnswers } from '../../features/quiz/grading';
import { presentQuiz, quizSchema, toStudentQuiz, type Quiz } from '../../features/quiz/quiz';
import {
  LessonNotFoundError,
  loadLessonContext,
  recordCompletion,
  type CompleteResult,
} from './completion';

/** As respostas não cabem neste quiz (questão ou opção desconhecida/repetida; ou o quiz mudou depois de a página abrir). */
export class InvalidAnswersError extends Error {
  constructor() {
    super('invalid_answers');
  }
}

/** A pessoa já foi aprovada neste quiz: não há novas tentativas (decisão de produto a confirmar, ver STATUS). */
export class QuizAlreadyPassedError extends Error {
  constructor() {
    super('quiz_already_passed');
  }
}

/** O máximo de tentativas configurado já foi usado. */
export class QuizAttemptsExhaustedError extends Error {
  constructor() {
    super('attempts_exhausted');
  }
}

/** A semente do embaralhamento: a mesma pessoa, aula e número de tentativa veem SEMPRE a mesma ordem. */
const seedOf = (userId: string, lessonId: string, attemptNumber: number) =>
  `${userId}:${lessonId}:${attemptNumber}`;

/** Lê o quiz publicado; `null` se o documento não é um quiz válido (nunca confia no que está no banco às cegas). */
function parseQuiz(raw: unknown): Quiz | null {
  const parsed = quizSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * O que o ALUNO recebe de uma aula de quiz: o quiz SEM gabarito, na ordem da PRÓXIMA tentativa, e o estado das
 * tentativas. A nota da última tentativa aparece; o gabarito só sai na resposta da submissão, e conforme o tipo
 * de feedback. Sem `userId` (prévia da Staff) nada é lido da pessoa.
 */
async function loadQuizView(
  db: Database,
  input: { rawQuiz: unknown; lessonId: string; userId?: string },
): Promise<LessonQuizDto | null> {
  const quiz = parseQuiz(input.rawQuiz);
  if (!quiz) return null;
  const attempts = input.userId
    ? await db
        .select({
          number: quizAttempt.number,
          scorePercent: quizAttempt.scorePercent,
          passed: quizAttempt.passed,
        })
        .from(quizAttempt)
        .where(and(eq(quizAttempt.userId, input.userId), eq(quizAttempt.lessonId, input.lessonId)))
        .orderBy(asc(quizAttempt.number))
    : [];
  const used = attempts.length;
  const passed = attempts.some((attempt) => attempt.passed);
  const attemptsLeft = quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - used);
  const seed = seedOf(input.userId ?? 'preview', input.lessonId, used + 1);
  const last = attempts.at(-1);
  return {
    quiz: toStudentQuiz(presentQuiz(quiz, seed)),
    attemptsUsed: used,
    attemptsLeft,
    passed,
    canAttempt: !passed && (attemptsLeft === null || attemptsLeft > 0),
    last: last
      ? { number: last.number, scorePercent: last.scorePercent, passed: last.passed }
      : null,
  };
}

/** A parte `quiz` da aula no DTO do aluno ou da prévia (vazia se o documento do quiz não é válido). */
export async function quizPart(
  db: Database,
  input: { rawQuiz: unknown; lessonId: string; userId?: string },
): Promise<{ quiz?: LessonQuizDto }> {
  const view = await loadQuizView(db, input);
  return view ? { quiz: view } : {};
}

interface QuizReview {
  questionId: string;
  correct: boolean;
  selected: string[];
  /** Só com feedback `immediate`. */
  correctOptionIds?: string[];
}

export interface SubmitQuizResult {
  attempt: {
    number: number;
    scorePercent: number;
    earnedPoints: number;
    totalPoints: number;
    passed: boolean;
    minScorePercent: number;
  };
  attemptsUsed: number;
  attemptsLeft: number | null;
  /** Só com feedback `immediate`: acerto por questão e as opções certas (já depois de enviar). */
  review?: QuizReview[];
  /** Preenchido só quando a tentativa APROVOU (conclui a aula e, talvez, o curso). */
  completion?: CompleteResult;
}

/**
 * Corrige e registra uma tentativa, numa transação (M5-04). A matrícula é travada (`FOR UPDATE`) por
 * `loadLessonContext`, que também reverifica acesso, drip e sequência: duas submissões da mesma pessoa
 * entram em fila, então o número sequencial e o limite de tentativas nunca estouram (o `UNIQUE (pessoa, aula,
 * número)` é a segunda barreira). A nota é calculada AQUI, contra o quiz publicado vigente; o cliente só envia
 * as opções marcadas. Guarda uma CÓPIA do quiz como foi apresentado (ordem, gabarito, nota mínima) e as
 * respostas. Aprovou: conclui a aula de forma idempotente (método `quiz`). Staff sem matrícula é recusada
 * como qualquer pessoa sem acesso: a prévia não grava.
 */
export async function submitQuizAttempt(
  db: Database,
  input: { userId: string; lessonId: string; answers: AttemptAnswers; clock?: () => Date },
): Promise<SubmitQuizResult> {
  return db.transaction(async (tx) => {
    const context = await loadLessonContext(tx, {
      userId: input.userId,
      lessonId: input.lessonId,
      kind: 'quiz',
      clock: input.clock,
    });
    const [row] = await tx
      .select({ quiz: lesson.quiz })
      .from(lesson)
      .where(eq(lesson.id, input.lessonId));
    const quiz = parseQuiz(row?.quiz);
    if (!quiz) throw new LessonNotFoundError();

    const [counted] = await tx
      .select({
        used: sql<number>`count(*)::int`,
        passed: sql<boolean>`coalesce(bool_or(${quizAttempt.passed}), false)`,
      })
      .from(quizAttempt)
      .where(and(eq(quizAttempt.userId, input.userId), eq(quizAttempt.lessonId, input.lessonId)));
    const used = counted?.used ?? 0;
    if (counted?.passed) throw new QuizAlreadyPassedError();
    if (quiz.maxAttempts !== null && used >= quiz.maxAttempts) {
      throw new QuizAttemptsExhaustedError();
    }

    const graded = gradeAttempt(quiz, input.answers);
    if (!graded.ok) throw new InvalidAnswersError();

    const number = used + 1;
    const presented = presentQuiz(quiz, seedOf(input.userId, input.lessonId, number));
    await tx.insert(quizAttempt).values({
      userId: input.userId,
      courseId: context.courseId,
      lessonId: input.lessonId,
      number,
      snapshot: presented,
      answers: graded.questions,
      earnedPoints: graded.earnedPoints,
      totalPoints: graded.totalPoints,
      scorePercent: graded.scorePercent,
      passed: graded.passed,
      createdAt: context.now,
    });

    const completion = graded.passed
      ? await recordCompletion(tx, context, {
          userId: input.userId,
          lessonId: input.lessonId,
          method: 'quiz',
        })
      : undefined;
    const correctOf = new Map(
      quiz.questions.map((question) => [
        question.id,
        question.options.filter((option) => option.correct).map((option) => option.id),
      ]),
    );
    return {
      attempt: {
        number,
        scorePercent: graded.scorePercent,
        earnedPoints: graded.earnedPoints,
        totalPoints: graded.totalPoints,
        passed: graded.passed,
        minScorePercent: quiz.minScorePercent,
      },
      attemptsUsed: number,
      attemptsLeft: quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - number),
      ...(quiz.feedback === 'immediate'
        ? {
            review: graded.questions.map((result) => ({
              ...result,
              correctOptionIds: correctOf.get(result.questionId) ?? [],
            })),
          }
        : {}),
      ...(completion ? { completion } : {}),
    };
  });
}
