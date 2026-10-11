import { eq } from 'drizzle-orm';

import type { Database } from '../../src/db/client.ts';
import { courseModule, lesson } from '../../src/db/schema.ts';
import { seedDemoCourse, type DemoSeedResult } from '../../src/server/catalog/demo-seed.ts';

export interface DemoFixture extends DemoSeedResult {
  moduleIds: string[];
  lessonIds: string[];
}

/**
 * Fixture dos testes de integração (M2-07): o MESMO curso demonstrativo do seed de Dev e Staging
 * (3 módulos em D+0, D+7 e D+14, uma aula opcional, oferta gratuita de 3 meses, tudo publicado),
 * com os ids dos módulos e das aulas na ordem do currículo. Repetível: chamar de novo devolve o mesmo.
 */
export async function createDemoCourse(db: Database): Promise<DemoFixture> {
  const seeded = await seedDemoCourse(db);
  const modules = await db
    .select({ id: courseModule.id })
    .from(courseModule)
    .where(eq(courseModule.courseId, seeded.courseId))
    .orderBy(courseModule.position);
  const lessons = await db
    .select({ id: lesson.id })
    .from(lesson)
    .where(eq(lesson.courseId, seeded.courseId))
    .orderBy(lesson.moduleId, lesson.position);
  return {
    ...seeded,
    moduleIds: modules.map((row) => row.id),
    lessonIds: lessons.map((row) => row.id),
  };
}
