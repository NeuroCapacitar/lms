import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sobre')({ component: Sobre });

function Sobre() {
  return (
    <>
      <h1>Sobre</h1>
      <p>Página de teste da rota profunda. O conteúdo real chega nos próximos marcos.</p>
    </>
  );
}
