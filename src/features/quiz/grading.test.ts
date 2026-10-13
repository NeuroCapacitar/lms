import { describe, expect, it } from 'vitest';

import { gradeAttempt } from './grading';
import {
  emptyQuiz,
  presentQuiz,
  quizProblems,
  quizSchema,
  seededShuffle,
  toStudentQuiz,
  type Quiz,
} from './quiz';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Q1 (single, 1 ponto): A correta. Q2 (multiple, 2 pontos): B e C corretas. Q3 (single, 1 ponto): E correta. */
function quiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    minScorePercent: 70,
    maxAttempts: null,
    feedback: 'immediate',
    shuffle: false,
    questions: [
      {
        id: id(1),
        prompt: 'Q1',
        kind: 'single',
        points: 1,
        options: [
          { id: id(11), text: 'A', correct: true },
          { id: id(12), text: 'B', correct: false },
        ],
      },
      {
        id: id(2),
        prompt: 'Q2',
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
        prompt: 'Q3',
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
const right = [answer(id(1), id(11)), answer(id(2), id(22), id(23)), answer(id(3), id(32))];

describe('correção (acerto total por questão, sem crédito parcial)', () => {
  it('tudo certo: 100% e aprovado', () => {
    expect(gradeAttempt(quiz(), right)).toMatchObject({
      ok: true,
      earnedPoints: 4,
      totalPoints: 4,
      scorePercent: 100,
      passed: true,
    });
  });

  it('múltipla escolha SEM crédito parcial: marcar só uma das duas corretas, ou uma a mais, vale zero', () => {
    for (const partial of [[id(22)], [id(22), id(23), id(21)], [id(21)], []]) {
      const result = gradeAttempt(quiz(), [
        answer(id(1), id(11)),
        answer(id(2), ...partial),
        answer(id(3), id(32)),
      ]);
      expect(result).toMatchObject({ ok: true, earnedPoints: 2, totalPoints: 4 });
      expect(result.ok && result.questions[1]!.correct).toBe(false);
    }
  });

  it('sem resposta a uma questão: errada (não é erro de formato)', () => {
    expect(gradeAttempt(quiz(), [answer(id(1), id(11))])).toMatchObject({
      ok: true,
      earnedPoints: 1,
      passed: false,
    });
    expect(gradeAttempt(quiz(), [])).toMatchObject({ ok: true, earnedPoints: 0, scorePercent: 0 });
  });

  it('a nota EXATAMENTE no limite aprova; um ponto abaixo não (aritmética inteira)', () => {
    // 4 pontos no total; 3 ganhos = 75%
    const threeOfFour = [
      answer(id(1), id(11)),
      answer(id(2), id(22), id(23)),
      answer(id(3), id(31)),
    ];
    expect(gradeAttempt(quiz({ minScorePercent: 75 }), threeOfFour)).toMatchObject({
      scorePercent: 75,
      passed: true,
    });
    expect(gradeAttempt(quiz({ minScorePercent: 76 }), threeOfFour)).toMatchObject({
      scorePercent: 75,
      passed: false,
    });
    // 3 pontos no total (todas valem 1): 2/3 = 66,67% NÃO aprova mínimo 67, aprova mínimo 66
    const ones = quiz({
      questions: quiz().questions.map((question) => ({ ...question, points: 1 })),
    });
    const twoOfThree = [
      answer(id(1), id(11)),
      answer(id(2), id(22), id(23)),
      answer(id(3), id(31)),
    ];
    expect(gradeAttempt({ ...ones, minScorePercent: 67 }, twoOfThree)).toMatchObject({
      scorePercent: 66,
      passed: false,
    });
    expect(gradeAttempt({ ...ones, minScorePercent: 66 }, twoOfThree)).toMatchObject({
      passed: true,
    });
    expect(gradeAttempt({ ...ones, minScorePercent: 100 }, right)).toMatchObject({ passed: true });
  });

  it('resposta que não cabe no quiz é recusada inteira (id de outra questão, repetida, duas na single)', () => {
    const invalid = [
      [answer(id(99), id(11))],
      [answer(id(1), id(21))], // opção de OUTRA questão
      [answer(id(1), id(11)), answer(id(1), id(12))], // questão repetida
      [answer(id(1), id(11), id(12))], // duas opções numa single
      [answer(id(2), id(22), id(22))], // opção repetida
      [answer(id(2), id(99))],
    ];
    for (const answers of invalid) {
      expect(gradeAttempt(quiz(), answers), JSON.stringify(answers)).toEqual({
        ok: false,
        reason: 'invalid_answers',
      });
    }
  });

  it('um quiz sem questões nunca aprova', () => {
    expect(gradeAttempt(quiz({ questions: [] }), [])).toMatchObject({ ok: true, passed: false });
  });
});

describe('quiz: coerência para publicar, projeção do aluno e embaralhamento', () => {
  it('um quiz coerente não tem problema; ausente ou incompleto lista TODOS', () => {
    expect(quizProblems(quiz())).toEqual([]);
    expect(quizProblems(null)).toEqual([{ code: 'quiz_missing', path: 'quiz' }]);
    expect(quizProblems(emptyQuiz())).toEqual([
      { code: 'quiz_incomplete', path: 'quiz.questions' },
    ]);
    const broken = quiz();
    broken.questions[0]!.prompt = '  ';
    broken.questions[0]!.options[0]!.correct = false; // single sem correta
    broken.questions[1]!.options = [{ id: id(21), text: 'só uma', correct: true }];
    broken.questions[2]!.options[1]!.text = '';
    expect(quizProblems(broken).map((problem) => problem.path)).toEqual([
      'quiz.questions[0].prompt',
      'quiz.questions[0].options',
      'quiz.questions[1].options',
      'quiz.questions[2].options[1].text',
    ]);
    const twoCorrect = quiz();
    twoCorrect.questions[0]!.options[1]!.correct = true; // single com duas corretas
    expect(quizProblems(twoCorrect)).toEqual([
      { code: 'quiz_incomplete', path: 'quiz.questions[0].options' },
    ]);
    const duplicated = quiz();
    duplicated.questions[1]!.id = id(1);
    expect(quizProblems(duplicated)).toEqual([
      { code: 'quiz_incomplete', path: 'quiz.questions[1].id' },
    ]);
  });

  it('o schema recusa campo a mais, nota mínima fora de 1..100 e questões demais', () => {
    expect(quizSchema.safeParse(quiz()).success).toBe(true);
    expect(quizSchema.safeParse({ ...quiz(), extra: 1 }).success).toBe(false);
    for (const minScorePercent of [0, 101, 70.5]) {
      expect(quizSchema.safeParse({ ...quiz(), minScorePercent }).success).toBe(false);
    }
    expect(quizSchema.safeParse({ ...quiz(), maxAttempts: 0 }).success).toBe(false);
    expect(quizSchema.safeParse({ ...quiz(), maxAttempts: null }).success).toBe(true);
    const many = Array.from({ length: 51 }, (_, index) => ({
      ...quiz().questions[0]!,
      id: id(1000 + index),
    }));
    expect(quizSchema.safeParse({ ...quiz(), questions: many }).success).toBe(false);
  });

  it('a projeção do aluno NUNCA traz o gabarito (nem o campo `correct`)', () => {
    const student = toStudentQuiz(quiz());
    expect(JSON.stringify(student)).not.toContain('correct');
    expect(student.questions[1]!.options.map((option) => option.id)).toEqual([
      id(21),
      id(22),
      id(23),
    ]);
    expect(student.minScorePercent).toBe(70);
  });

  it('embaralhar é determinístico por semente, preserva os itens e muda com a tentativa', () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    expect(seededShuffle(items, 'a')).toEqual(seededShuffle(items, 'a'));
    expect([...seededShuffle(items, 'a')].sort((a, b) => a - b)).toEqual(items);
    expect(seededShuffle(items, 'tentativa:1')).not.toEqual(seededShuffle(items, 'tentativa:2'));
    const shuffled = presentQuiz(quiz({ shuffle: true }), 'u:l:1');
    expect(shuffled).toEqual(presentQuiz(quiz({ shuffle: true }), 'u:l:1'));
    expect(shuffled.questions.map((question) => question.id).sort()).toEqual(
      quiz()
        .questions.map((question) => question.id)
        .sort(),
    );
    // sem `shuffle` a ordem é a do autor
    expect(presentQuiz(quiz(), 'u:l:1')).toEqual(quiz());
    // a correção não depende da ordem apresentada
    expect(gradeAttempt(shuffled, right)).toMatchObject({ ok: true, passed: true });
  });
});
