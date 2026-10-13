import { z } from 'zod';

import { parseRichText, richTextSchema, type RichText } from '../content/rich-text';
import { quizProblems, quizSchema, type Quiz } from '../quiz/quiz';

/**
 * Currículo vivo (M2-02). Puro: sem rede nem banco. O curso tem um RASCUNHO (o que a Staff edita) e
 * um currículo PUBLICADO (o que o aluno vê); os ids de módulo e aula nascem no rascunho e são os
 * MESMOS no publicado, para sempre. Não há histórico de versões: o publicado anterior não é retido.
 */
const MAX_MODULES = 100;
const MAX_LESSONS_PER_MODULE = 200;
const MAX_DRIP_DAYS = 3650;
/** O corpo da aula e a descrição do curso são texto rico validado por allowlist (M2-05) ou nulos. */
const richOrNull = richTextSchema.nullable();

const uuid = z.uuid();

/**
 * Corpo de `PUT /api/staff/courses/:id/draft`: o rascunho INTEIRO e o `expectedRev` que a tela leu
 * (concorrência otimista). A ordem dos arrays é a ordem do curso. Item com `id` mantém o id (editar,
 * reordenar e MOVER aula de módulo não trocam ids); item sem `id` é novo; o que sumiu do corpo sai
 * do rascunho. O rascunho aceita trabalho incompleto (título vazio): quem exige é a publicação.
 */
export const saveDraftSchema = z.strictObject({
  expectedRev: z.number().int().min(0),
  details: z.strictObject({
    displayTitle: z.string().max(200),
    description: richOrNull,
    workloadHours: z.number().int().min(1).max(10_000).nullable(),
    /** M5-07: capa e banner (`media_asset` prontos). AUSENTE = mantém; `null` = remove. */
    coverMediaId: uuid.nullable().optional(),
    bannerMediaId: uuid.nullable().optional(),
  }),
  modules: z
    .array(
      z.strictObject({
        id: uuid.optional(),
        title: z.string().max(200),
        dripDays: z.number().int().min(0).max(MAX_DRIP_DAYS),
        lessons: z
          .array(
            z
              .strictObject({
                id: uuid.optional(),
                title: z.string().max(200),
                isOptional: z.boolean(),
                body: richOrNull,
                /**
                 * M5-02: tipo da aula e o UM vídeo dela. AUSENTE = mantém o que já está no rascunho (a tela
                 * antiga, que só edita texto, não converte aula de vídeo em texto sem querer); aula nova
                 * sem tipo é de texto. Aula de texto não tem vídeo; o vídeo pode faltar no rascunho, mas a
                 * publicação exige.
                 */
                kind: z.enum(['text', 'video', 'quiz']).optional(),
                videoAssetId: uuid.nullable().optional(),
                /**
                 * M5-04: o quiz da aula de quiz (com gabarito). AUSENTE = mantém o quiz do rascunho; `null` o
                 * remove. O rascunho aceita quiz incompleto; a publicação exige coerência (`quizProblems`).
                 */
                quiz: quizSchema.nullable().optional(),
              })
              .refine((lesson) => lesson.kind === 'video' || !lesson.videoAssetId, {
                message: 'video_asset_on_text_lesson',
              })
              .refine((lesson) => lesson.kind === 'quiz' || !lesson.quiz, {
                message: 'quiz_on_non_quiz_lesson',
              }),
          )
          .max(MAX_LESSONS_PER_MODULE),
      }),
    )
    .max(MAX_MODULES),
});

export interface CurriculumDetails {
  displayTitle: string;
  description: RichText | null;
  workloadHours: number | null;
  /** Capa e banner (M5-07). Ausente = sem imagem (telas e testes anteriores). */
  coverMediaId?: string | null;
  bannerMediaId?: string | null;
}

export interface LessonNode {
  id: string;
  title: string;
  isOptional: boolean;
  body: RichText | null;
  /** Ausente = aula de texto (telas e testes anteriores ao M5-02). */
  kind?: 'text' | 'video' | 'quiz';
  /** Só na aula de vídeo: o UM `video_asset`. */
  videoAssetId?: string | null;
  /** Só na aula de quiz (M5-04), COM gabarito: a Staff e o servidor; o aluno recebe `StudentQuiz`. */
  quiz?: Quiz | null;
}

export interface ModuleNode {
  id: string;
  title: string;
  dripDays: number;
  lessons: LessonNode[];
}

/** A árvore do currículo (rascunho ou publicado) com ids. */
export interface CurriculumTree {
  details: CurriculumDetails;
  modules: ModuleNode[];
}

/** O rascunho como a tela o recebe: árvore com ids, o contador e a versão publicada. */
export interface DraftDto extends CurriculumTree {
  rev: number;
  publishedVersion: number;
}

/** O que quem estuda vê: só o publicado e ativo (nada aposentado, nada de rascunho). */
export interface PublishedCurriculumDto extends CurriculumTree {
  version: number;
}

export interface CurriculumProblem {
  code:
    | 'course_title_empty'
    | 'no_modules'
    | 'module_title_empty'
    | 'module_no_lessons'
    | 'lesson_title_empty'
    | 'no_required_lesson'
    | 'drip_invalid'
    | 'body_invalid'
    | 'video_asset_missing'
    | 'quiz_missing'
    | 'quiz_incomplete';
  /** Onde: `details.displayTitle`, `modules[1].title`, `modules[0].lessons[2].title`... */
  path: string;
}

/**
 * Valida o rascunho para PUBLICAR: título não vazio; pelo menos um módulo; todo módulo com pelo
 * menos uma aula; pelo menos uma aula obrigatória; D+N inteiro e não negativo; corpo válido. Devolve
 * TODOS os problemas (vazio = pode publicar).
 */
export function validateCurriculum(tree: CurriculumTree): CurriculumProblem[] {
  const problems: CurriculumProblem[] = [];
  if (tree.details.displayTitle.trim() === '') {
    problems.push({ code: 'course_title_empty', path: 'details.displayTitle' });
  }
  if (tree.modules.length === 0) problems.push({ code: 'no_modules', path: 'modules' });
  let required = 0;
  tree.modules.forEach((module, moduleIndex) => {
    const at = `modules[${moduleIndex}]`;
    if (module.title.trim() === '')
      problems.push({ code: 'module_title_empty', path: `${at}.title` });
    if (!Number.isInteger(module.dripDays) || module.dripDays < 0) {
      problems.push({ code: 'drip_invalid', path: `${at}.dripDays` });
    }
    if (module.lessons.length === 0)
      problems.push({ code: 'module_no_lessons', path: `${at}.lessons` });
    module.lessons.forEach((lesson, lessonIndex) => {
      const lessonAt = `${at}.lessons[${lessonIndex}]`;
      if (lesson.title.trim() === '') {
        problems.push({ code: 'lesson_title_empty', path: `${lessonAt}.title` });
      }
      if (lesson.body !== null && parseRichText(lesson.body) === null) {
        problems.push({ code: 'body_invalid', path: `${lessonAt}.body` });
      }
      if (lesson.kind === 'video' && !lesson.videoAssetId) {
        problems.push({ code: 'video_asset_missing', path: `${lessonAt}.videoAssetId` });
      }
      if (lesson.kind === 'quiz') {
        for (const problem of quizProblems(lesson.quiz)) {
          problems.push({ code: problem.code, path: `${lessonAt}.${problem.path}` });
        }
      }
      if (!lesson.isOptional) required += 1;
    });
  });
  if (tree.modules.some((module) => module.lessons.length > 0) && required === 0) {
    problems.push({ code: 'no_required_lesson', path: 'modules' });
  }
  return problems;
}

/** JSON com as chaves em ordem estável (o `jsonb` do Postgres reordena as chaves). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Duas árvores têm o mesmo conteúdo, ids e ordem? Decide se publicar é um no-op. */
export function curriculumEquals(a: CurriculumTree, b: CurriculumTree): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** O corpo de `PUT /api/staff/courses/:id/draft` já validado. */
export type SaveDraftBody = z.infer<typeof saveDraftSchema>;
