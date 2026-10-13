import { z } from 'zod';

/**
 * Quiz simples como aula (M5-04, ADR 0012). Puro: sem rede nem banco. O quiz é um DOCUMENTO da aula
 * (`lesson_draft.quiz` e `lesson.quiz`), com ids de questão e de opção estáveis; o GABARITO (`correct`) só
 * existe no servidor e na Staff: o aluno recebe `StudentQuiz`, que NÃO tem o campo. A correção é feita só no
 * servidor (`grading.ts`).
 */
const MAX_QUESTIONS = 50;
const MAX_OPTIONS = 10;

const uuid = z.uuid();

/**
 * O quiz como a Staff o edita e o servidor o guarda. O RASCUNHO aceita trabalho incompleto (sem questões,
 * texto vazio, nenhuma opção correta): quem exige coerência é a publicação (`quizProblems`).
 */
export const quizSchema = z.strictObject({
  /** Nota mínima (%) para aprovar. */
  minScorePercent: z.number().int().min(1).max(100),
  /** `null` = tentativas ilimitadas (padrão). */
  maxAttempts: z.number().int().min(1).max(100).nullable(),
  /** `immediate`: depois de enviar mostra acerto/erro e as corretas; `score_only`: só a nota. */
  feedback: z.enum(['immediate', 'score_only']),
  shuffle: z.boolean(),
  questions: z
    .array(
      z.strictObject({
        id: uuid,
        prompt: z.string().max(2000),
        kind: z.enum(['single', 'multiple']),
        points: z.number().int().min(1).max(100),
        options: z
          .array(
            z.strictObject({
              id: uuid,
              text: z.string().max(500),
              correct: z.boolean(),
            }),
          )
          .max(MAX_OPTIONS),
      }),
    )
    .max(MAX_QUESTIONS),
});

export type Quiz = z.infer<typeof quizSchema>;

/** Um quiz novo, para a Staff começar (ainda incompleto: a publicação exige questões e gabarito). */
export function emptyQuiz(): Quiz {
  return {
    minScorePercent: 70,
    maxAttempts: null,
    feedback: 'immediate',
    shuffle: false,
    questions: [],
  };
}

export interface QuizProblem {
  code: 'quiz_missing' | 'quiz_incomplete';
  /** Relativo à aula: `quiz`, `quiz.questions[0].prompt`, `quiz.questions[1].options`... */
  path: string;
}

/**
 * Coerência para PUBLICAR: ao menos uma questão; enunciado e texto das opções não vazios; de 2 a 10
 * opções; `single` com exatamente UMA correta e `multiple` com ao menos uma; ids únicos. Devolve TODOS os
 * problemas (vazio = coerente). `null` = a aula de quiz ainda não tem quiz.
 */
export function quizProblems(quiz: Quiz | null | undefined): QuizProblem[] {
  if (!quiz) return [{ code: 'quiz_missing', path: 'quiz' }];
  const problems: QuizProblem[] = [];
  const incomplete = (path: string) => problems.push({ code: 'quiz_incomplete', path });
  if (quiz.questions.length === 0) incomplete('quiz.questions');
  const seen = new Set<string>();
  quiz.questions.forEach((question, index) => {
    const at = `quiz.questions[${index}]`;
    if (seen.has(question.id)) incomplete(`${at}.id`);
    seen.add(question.id);
    if (question.prompt.trim() === '') incomplete(`${at}.prompt`);
    if (question.options.length < 2) incomplete(`${at}.options`);
    const correct = question.options.filter((option) => option.correct).length;
    if (question.kind === 'single' ? correct !== 1 : correct < 1) incomplete(`${at}.options`);
    question.options.forEach((option, optionIndex) => {
      if (option.text.trim() === '') incomplete(`${at}.options[${optionIndex}].text`);
      if (seen.has(option.id)) incomplete(`${at}.options[${optionIndex}].id`);
      seen.add(option.id);
    });
  });
  return problems;
}

/** O que o ALUNO recebe: o quiz sem o gabarito, na ordem desta tentativa. */
export interface StudentQuiz {
  minScorePercent: number;
  maxAttempts: number | null;
  feedback: Quiz['feedback'];
  questions: {
    id: string;
    prompt: string;
    kind: 'single' | 'multiple';
    points: number;
    options: { id: string; text: string }[];
  }[];
}

/** Embaralhamento DETERMINÍSTICO (mesma semente, mesma ordem): FNV-1a para a semente, mulberry32 e Fisher-Yates. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

/**
 * O quiz na ordem em que a tentativa `attemptNumber` o apresenta (embaralhado só se o quiz pede, e sempre
 * igual para a mesma pessoa, aula e número de tentativa). Mantém o gabarito: use `toStudentQuiz` para o aluno.
 */
export function presentQuiz(quiz: Quiz, seed: string): Quiz {
  if (!quiz.shuffle) return quiz;
  return {
    ...quiz,
    questions: seededShuffle(quiz.questions, `${seed}:q`).map((question) => ({
      ...question,
      options: seededShuffle(question.options, `${seed}:${question.id}`),
    })),
  };
}

/** Remove o gabarito: a ÚNICA projeção do quiz que chega ao aluno. */
export function toStudentQuiz(quiz: Quiz): StudentQuiz {
  return {
    minScorePercent: quiz.minScorePercent,
    maxAttempts: quiz.maxAttempts,
    feedback: quiz.feedback,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      points: question.points,
      options: question.options.map((option) => ({ id: option.id, text: option.text })),
    })),
  };
}
