import { describe, expect, it } from 'vitest';

import { emptyQuiz, quizProblems, quizSchema } from './quiz';
import {
  addOption,
  addQuestion,
  moveQuestion,
  parseMaxAttempts,
  removeOption,
  removeQuestion,
  setOptionCorrect,
  setQuestionKind,
  updateOptionText,
  updateQuestion,
} from './quiz-edit';

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('edição do quiz (funções puras)', () => {
  it('uma questão nova nasce incompleta e o quiz só fica coerente depois de preencher e marcar a certa', () => {
    let quiz = addQuestion(emptyQuiz(), newId);
    expect(quizSchema.safeParse(quiz).success).toBe(true); // o rascunho aceita incompleto
    expect(quizProblems(quiz).length).toBeGreaterThan(0);
    quiz = updateQuestion(quiz, 0, { prompt: 'Qual?' });
    quiz = updateOptionText(quiz, 0, 0, 'A');
    quiz = updateOptionText(quiz, 0, 1, 'B');
    quiz = setOptionCorrect(quiz, 0, 1, true);
    expect(quizProblems(quiz)).toEqual([]);
  });

  it('na escolha única, marcar uma correta desmarca a outra; na múltipla, ambas ficam', () => {
    let quiz = addQuestion(emptyQuiz(), newId);
    quiz = setOptionCorrect(quiz, 0, 0, true);
    quiz = setOptionCorrect(quiz, 0, 1, true);
    expect(quiz.questions[0]!.options.map((option) => option.correct)).toEqual([false, true]);
    quiz = setQuestionKind(quiz, 0, 'multiple');
    quiz = setOptionCorrect(quiz, 0, 0, true);
    expect(quiz.questions[0]!.options.map((option) => option.correct)).toEqual([true, true]);
    // voltar para única mantém só a primeira correta
    quiz = setQuestionKind(quiz, 0, 'single');
    expect(quiz.questions[0]!.options.map((option) => option.correct)).toEqual([true, false]);
  });

  it('limites: no máximo 50 questões e 10 opções; remover e mover fora do intervalo não muda nada', () => {
    let quiz = emptyQuiz();
    for (let index = 0; index < 55; index += 1) quiz = addQuestion(quiz, newId);
    expect(quiz.questions).toHaveLength(50);
    for (let index = 0; index < 12; index += 1) quiz = addOption(quiz, 0, newId);
    expect(quiz.questions[0]!.options).toHaveLength(10);
    expect(removeQuestion(quiz, 99)).toBe(quiz);
    expect(removeOption(quiz, 0, 99)).toBe(quiz);
    expect(moveQuestion(quiz, 0, 'up')).toBe(quiz);
    expect(moveQuestion(quiz, 49, 'down')).toBe(quiz);
    expect(updateQuestion(quiz, 99, { prompt: 'x' })).toBe(quiz);
  });

  it('mover e remover preservam os ids', () => {
    let quiz = addQuestion(addQuestion(emptyQuiz(), newId), newId);
    const [first, second] = quiz.questions.map((question) => question.id);
    quiz = moveQuestion(quiz, 0, 'down');
    expect(quiz.questions.map((question) => question.id)).toEqual([second, first]);
    quiz = removeQuestion(quiz, 0);
    expect(quiz.questions.map((question) => question.id)).toEqual([first]);
  });

  it('tentativas máximas: vazio = ilimitadas; senão inteiro de 1 a 100', () => {
    expect(parseMaxAttempts('')).toBeNull();
    expect(parseMaxAttempts('  ')).toBeNull();
    expect(parseMaxAttempts('3')).toBe(3);
    expect(parseMaxAttempts('0')).toBe(1);
    expect(parseMaxAttempts('500')).toBe(100);
    expect(parseMaxAttempts('2.9')).toBe(2);
    expect(parseMaxAttempts('x')).toBeNull();
  });
});
