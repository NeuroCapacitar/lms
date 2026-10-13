import { z } from 'zod';

import type { Quiz } from './quiz';

/**
 * Correção do quiz (M5-04), pura e SÓ no servidor. Regra (documentada e testada): ACERTO TOTAL por questão,
 * sem crédito parcial. A questão vale seus pontos se, e só se, o conjunto de opções marcadas é EXATAMENTE o
 * conjunto das corretas; marcar a mais, a menos ou deixar em branco vale zero. Aprovado se `nota ≥ mínima`,
 * em aritmética inteira (sem ponto flutuante): `ganhos × 100 ≥ mínima × total`, então a nota exatamente no
 * limite aprova e 66,67% não aprova um mínimo de 67%.
 */
export const attemptBodySchema = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        questionId: z.uuid(),
        optionIds: z.array(z.uuid()).max(10),
      }),
    )
    .max(50),
});

export type AttemptAnswers = z.infer<typeof attemptBodySchema>['answers'];

interface QuestionResult {
  questionId: string;
  correct: boolean;
  /** As opções que a pessoa marcou. */
  selected: string[];
}

export type GradeResult =
  | {
      ok: true;
      earnedPoints: number;
      totalPoints: number;
      /** Inteiro, arredondado para BAIXO (a aprovação não usa este número, e sim a conta inteira). */
      scorePercent: number;
      passed: boolean;
      questions: QuestionResult[];
    }
  /** Resposta que não cabe neste quiz: questão/opção desconhecida, repetida, ou duas opções numa `single`. */
  | { ok: false; reason: 'invalid_answers' };

export function gradeAttempt(quiz: Quiz, answers: AttemptAnswers): GradeResult {
  const byQuestion = new Map(quiz.questions.map((question) => [question.id, question]));
  const answered = new Map<string, string[]>();
  for (const answer of answers) {
    const question = byQuestion.get(answer.questionId);
    if (!question || answered.has(answer.questionId))
      return { ok: false, reason: 'invalid_answers' };
    const valid = new Set(question.options.map((option) => option.id));
    const unique = new Set(answer.optionIds);
    if (unique.size !== answer.optionIds.length) return { ok: false, reason: 'invalid_answers' };
    if (answer.optionIds.some((id) => !valid.has(id)))
      return { ok: false, reason: 'invalid_answers' };
    if (question.kind === 'single' && answer.optionIds.length > 1) {
      return { ok: false, reason: 'invalid_answers' };
    }
    answered.set(answer.questionId, answer.optionIds);
  }

  let earnedPoints = 0;
  let totalPoints = 0;
  const questions: QuestionResult[] = quiz.questions.map((question) => {
    totalPoints += question.points;
    const selected = answered.get(question.id) ?? [];
    const correctIds = question.options
      .filter((option) => option.correct)
      .map((option) => option.id);
    const correct =
      correctIds.length > 0 &&
      selected.length === correctIds.length &&
      correctIds.every((id) => selected.includes(id));
    if (correct) earnedPoints += question.points;
    return { questionId: question.id, correct, selected };
  });
  const scorePercent = totalPoints === 0 ? 0 : Math.floor((earnedPoints * 100) / totalPoints);
  return {
    ok: true,
    earnedPoints,
    totalPoints,
    scorePercent,
    passed: totalPoints > 0 && earnedPoints * 100 >= quiz.minScorePercent * totalPoints,
    questions,
  };
}
