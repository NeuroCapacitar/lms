import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { isOfferAcquirable } from '../../src/features/catalog/catalog.ts';
import { validateCurriculum } from '../../src/features/catalog/curriculum.ts';
import { DEMO_DRAFT, DEMO_OFFER, DEMO_SLUG } from '../../src/features/catalog/demo-course.ts';
import {
  getDraft,
  getPublishedCurriculum,
  saveDraft,
} from '../../src/server/catalog/curriculum-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/** M2-07 em Postgres 18 real: o seed é repetível, publica pelo domínio e respeita o M2-02. */
let database: TestSchema;
let opened: Awaited<ReturnType<typeof openDatabase>>;

beforeAll(async () => {
  database = await createTestSchema();
  opened = await openDatabase(database.connectionString);
});
afterAll(async () => {
  await opened.close();
  await database.drop();
});
beforeEach(async () => {
  await opened.db.execute(
    sql`truncate table lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
});

const rows = (
  table:
    | typeof schema.course
    | typeof schema.offer
    | typeof schema.courseModule
    | typeof schema.lesson,
) =>
  opened.db
    .select()
    .from(table)
    .then((all) => all.length);

describe('curso demonstrativo (seed)', () => {
  it('cria o curso guiado e publicado, com a oferta gratuita de 3 meses ativa e o currículo publicado', async () => {
    const result = await seedDemoCourse(opened.db);
    expect(result.created).toEqual({ course: true, offer: true, published: true });

    const [courseRow] = await opened.db.select().from(schema.course);
    expect(courseRow).toMatchObject({
      slug: DEMO_SLUG,
      sequenceMode: 'guided',
      status: 'published',
    });
    const [offerRow] = await opened.db.select().from(schema.offer);
    expect(offerRow).toMatchObject({
      kind: 'free',
      priceCents: 0,
      accessMonths: DEMO_OFFER.accessMonths,
      status: 'active',
    });

    const published = await getPublishedCurriculum(opened.db, result.courseId);
    const lessons = published!.modules.flatMap((module) => module.lessons);
    expect(published!.modules.map((module) => module.dripDays)).toEqual([0, 7, 14]);
    expect(lessons).toHaveLength(6);
    expect(lessons.filter((item) => item.isOptional)).toHaveLength(1);
    expect(
      isOfferAcquirable({
        courseStatus: 'published',
        offerStatus: 'active',
        hasPublishedCurriculum: true,
      }),
    ).toBe(true);
  });

  it('o conteúdo passa pelas validações do M2-02 (sem problemas)', () => {
    const tree = {
      details: DEMO_DRAFT.details,
      modules: DEMO_DRAFT.modules.map((module, mi) => ({
        id: `m${mi}`,
        ...module,
        lessons: module.lessons.map((item, li) => ({ id: `l${mi}-${li}`, ...item })),
      })),
    };
    expect(validateCurriculum(tree)).toEqual([]);
  });

  it('rodar duas vezes não duplica nada e mantém os ids', async () => {
    const first = await createDemoCourse(opened.db);
    const second = await createDemoCourse(opened.db);
    expect(second.created).toEqual({ course: false, offer: false, published: false });
    expect(second.courseId).toBe(first.courseId);
    expect(second.offerId).toBe(first.offerId);
    expect(second.moduleIds).toEqual(first.moduleIds);
    expect(second.lessonIds).toEqual(first.lessonIds);
    expect(await rows(schema.course)).toBe(1);
    expect(await rows(schema.offer)).toBe(1);
    expect(await rows(schema.courseModule)).toBe(3);
    expect(await rows(schema.lesson)).toBe(6);
    expect((await getDraft(opened.db, first.courseId))!.publishedVersion).toBe(1);
  });

  it('não sobrescreve edição posterior de uma pessoa nem republica por cima', async () => {
    const first = await seedDemoCourse(opened.db);
    const draft = await getDraft(opened.db, first.courseId);
    await saveDraft(opened.db, {
      courseId: first.courseId,
      expectedRev: draft!.rev,
      details: { ...draft!.details, displayTitle: 'Título editado por uma pessoa' },
      modules: draft!.modules,
    });
    const again = await seedDemoCourse(opened.db);
    expect(again.created.published).toBe(false);
    expect((await getDraft(opened.db, first.courseId))!.details.displayTitle).toBe(
      'Título editado por uma pessoa',
    );
    const published = await getPublishedCurriculum(opened.db, first.courseId);
    expect(published!.details.displayTitle).toBe(DEMO_DRAFT.details.displayTitle);
  });

  it('completa um estado parcial (curso sem oferta) sem recriar o curso', async () => {
    await seedDemoCourse(opened.db);
    await opened.db.delete(schema.offer);
    const result = await seedDemoCourse(opened.db);
    expect(result.created).toEqual({ course: false, offer: true, published: false });
    expect(await rows(schema.course)).toBe(1);
    const [row] = await opened.db
      .select()
      .from(schema.offer)
      .where(eq(schema.offer.id, result.offerId));
    expect(row!.status).toBe('active');
  });

  it('é uma ação do sistema: o curso e a auditoria ficam sem autor', async () => {
    const result = await seedDemoCourse(opened.db);
    const [courseRow] = await opened.db.select().from(schema.course);
    expect(courseRow!.createdBy).toBeNull();
    const audit = await opened.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, result.courseId));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((row) => row.actorId === null)).toBe(true);
  });
});
