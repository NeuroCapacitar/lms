import { createFileRoute } from '@tanstack/react-router';

import { RequireTerms } from '../components/require-terms';
import { LessonScreen } from '../study/lesson-screen';

export const Route = createFileRoute('/estudar/$courseId/aulas/$lessonId')({
  component: StudentLesson,
});

/** Aula do aluno (M3-03): a tela compartilhada com a prévia da Staff, no modo aluno. */
function StudentLesson() {
  const { courseId, lessonId } = Route.useParams();
  return (
    <RequireTerms>
      <LessonScreen mode={{ preview: false, courseId }} lessonId={lessonId} />
    </RequireTerms>
  );
}
