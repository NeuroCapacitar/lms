import { createFileRoute } from '@tanstack/react-router';

import { RequireTerms } from '../components/require-terms';
import { OutlineScreen } from '../study/outline-screen';

export const Route = createFileRoute('/estudar/$courseId/')({ component: StudentOutline });

/** Mapa do curso do aluno (M3-03): a tela compartilhada com a prévia da Staff, no modo aluno. */
function StudentOutline() {
  const { courseId } = Route.useParams();
  return (
    <RequireTerms>
      <OutlineScreen mode={{ preview: false, courseId }} />
    </RequireTerms>
  );
}
