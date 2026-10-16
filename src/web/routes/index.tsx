import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { OfflineSavedCourses } from '../offline/saved-courses';
import { isNetworkFailure } from '../offline/study';

export const Route = createFileRoute('/')({ component: Home });

async function fetchHealth(): Promise<boolean> {
  const response = await fetch('/api/health/live');
  // Consome o corpo: com Cache-Control: no-store o navegador mantém a requisição aberta até lê-lo.
  await response.text();
  return response.ok;
}

function Home() {
  // Sem rede o padrão do React Query PAUSARIA a consulta ("Verificando…" para sempre): aqui a falha de rede vira o aviso de
  // "sem conexão" e a porta de entrada para os cursos guardados (M8-04). O app instalado sempre abre nesta página.
  const health = useQuery({
    queryKey: ['health', 'live'],
    queryFn: fetchHealth,
    networkMode: 'always',
    // Sem tentativas extras: o padrão (3, com espera) deixaria ~7 s em "Verificando…" antes de avisar que não há conexão.
    retry: false,
  });
  const disconnected = health.isError && isNetworkFailure(health.error);

  let status = 'Verificando o serviço…';
  if (disconnected) {
    status = 'Sem conexão.';
  } else if (health.isError || health.data === false) {
    status = 'Serviço indisponível.';
  } else if (health.data === true) {
    status = 'Serviço disponível.';
  }

  return (
    <>
      <h1>Boas-vindas ao Hub NeuroCapacitar</h1>
      <p role="status">{status}</p>
      {disconnected ? <OfflineSavedCourses /> : null}
    </>
  );
}
