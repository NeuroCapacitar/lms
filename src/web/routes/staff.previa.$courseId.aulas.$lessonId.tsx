import { createFileRoute } from '@tanstack/react-router';

import { LessonScreen } from '../study/lesson-screen';

export const Route = createFileRoute('/staff/previa/$courseId/aulas/$lessonId')({
  component: PreviewLesson,
});

/** Aula na prévia de aluno (M3-07): o conteúdo publicado, sem gravar nada. */
function PreviewLesson() {
  const { courseId, lessonId } = Route.useParams();
  return <LessonScreen mode={{ preview: true, courseId }} lessonId={lessonId} />;
}
