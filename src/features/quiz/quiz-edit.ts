import type { Quiz } from './quiz';

/**
 * Edição do quiz no navegador (M5-04): funções puras e imutáveis sobre o documento do quiz (cada uma devolve
 * um quiz novo, ou o MESMO se não houver o que fazer). Os limites de tamanho espelham `quizSchema`; quem
 * decide o que pode ser publicado é `quizProblems`.
 */
type Question = Quiz['questions'][number];
type Option = Question['options'][number];
type Direction = 'up' | 'down';

const MAX_QUESTIONS = 50;
const MAX_OPTIONS = 10;

function withQuestion(quiz: Quiz, index: number, change: (question: Question) => Question): Quiz {
  const current = quiz.questions[index];
  if (!current) return quiz;
  const next = change(current);
  if (next === current) return quiz;
  return {
    ...quiz,
    questions: quiz.questions.map((question, at) => (at === index ? next : question)),
  };
}

/** Questão nova: escolha única, 1 ponto e duas opções vazias (a Staff preenche e marca a certa). */
export function addQuestion(quiz: Quiz, newId: () => string): Quiz {
  if (quiz.questions.length >= MAX_QUESTIONS) return quiz;
  const question: Question = {
    id: newId(),
    prompt: '',
    kind: 'single',
    points: 1,
    options: [
      { id: newId(), text: '', correct: false },
      { id: newId(), text: '', correct: false },
    ],
  };
  return { ...quiz, questions: [...quiz.questions, question] };
}

export function removeQuestion(quiz: Quiz, index: number): Quiz {
  if (index < 0 || index >= quiz.questions.length) return quiz;
  return { ...quiz, questions: quiz.questions.filter((_, at) => at !== index) };
}

export function moveQuestion(quiz: Quiz, index: number, direction: Direction): Quiz {
  const to = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || to < 0 || index >= quiz.questions.length || to >= quiz.questions.length) {
    return quiz;
  }
  const questions = [...quiz.questions];
  [questions[index], questions[to]] = [questions[to]!, questions[index]!];
  return { ...quiz, questions };
}

export function updateQuestion(
  quiz: Quiz,
  index: number,
  patch: Partial<Pick<Question, 'prompt' | 'points'>>,
): Quiz {
  return withQuestion(quiz, index, (question) => ({ ...question, ...patch }));
}

/** Trocar para escolha única mantém só a PRIMEIRA opção correta (a regra é exatamente uma). */
export function setQuestionKind(quiz: Quiz, index: number, kind: Question['kind']): Quiz {
  return withQuestion(quiz, index, (question) => {
    if (question.kind === kind) return question;
    let kept = false;
    const options =
      kind === 'single'
        ? question.options.map((option) => {
            const correct = option.correct && !kept;
            if (correct) kept = true;
            return correct === option.correct ? option : { ...option, correct };
          })
        : question.options;
    return { ...question, kind, options };
  });
}

export function addOption(quiz: Quiz, index: number, newId: () => string): Quiz {
  return withQuestion(quiz, index, (question) =>
    question.options.length >= MAX_OPTIONS
      ? question
      : { ...question, options: [...question.options, { id: newId(), text: '', correct: false }] },
  );
}

export function removeOption(quiz: Quiz, index: number, optionIndex: number): Quiz {
  return withQuestion(quiz, index, (question) =>
    optionIndex < 0 || optionIndex >= question.options.length
      ? question
      : { ...question, options: question.options.filter((_, at) => at !== optionIndex) },
  );
}

export function updateOptionText(
  quiz: Quiz,
  index: number,
  optionIndex: number,
  text: string,
): Quiz {
  return withQuestion(quiz, index, (question) => ({
    ...question,
    options: question.options.map((option, at) =>
      at === optionIndex ? ({ ...option, text } satisfies Option) : option,
    ),
  }));
}

/** Marca ou desmarca a opção correta; na escolha única, marcar uma desmarca as outras. */
export function setOptionCorrect(
  quiz: Quiz,
  index: number,
  optionIndex: number,
  correct: boolean,
): Quiz {
  return withQuestion(quiz, index, (question) => ({
    ...question,
    options: question.options.map((option, at) => {
      if (at === optionIndex) return { ...option, correct };
      return question.kind === 'single' && correct && option.correct
        ? { ...option, correct: false }
        : option;
    }),
  }));
}

/** O campo numérico de tentativas: vazio = ilimitadas; senão um inteiro de 1 a 100. */
export function parseMaxAttempts(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const value = Math.trunc(Number(text));
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(100, value));
}
