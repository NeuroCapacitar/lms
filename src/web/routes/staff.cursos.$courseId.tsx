import { createFileRoute } from '@tanstack/react-router';

import { CourseEditor } from '../course-builder/course-editor';

export const Route = createFileRoute('/staff/cursos/$courseId')({ component: CourseEditorPage });

function CourseEditorPage() {
  const { courseId } = Route.useParams();
  // `key`: trocar de curso remonta o editor e zera o rascunho local.
  return <CourseEditor key={courseId} courseId={courseId} />;
}
