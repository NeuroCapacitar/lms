import { createFileRoute } from '@tanstack/react-router';

import { OutlineScreen } from '../study/outline-screen';

export const Route = createFileRoute('/staff/previa/$courseId/')({ component: PreviewOutline });

/** Prévia de aluno (M3-07): o mapa do curso publicado, só leitura, tudo liberado. */
function PreviewOutline() {
  const { courseId } = Route.useParams();
  return <OutlineScreen mode={{ preview: true, courseId }} />;
}
