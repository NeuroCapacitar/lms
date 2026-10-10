import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

async function fetchHealth(): Promise<boolean> {
  const response = await fetch('/api/health/live');
  // Consome o corpo: com Cache-Control: no-store o navegador mantém a requisição aberta até lê-lo.
  await response.text();
  return response.ok;
}

function Home() {
  const health = useQuery({ queryKey: ['health', 'live'], queryFn: fetchHealth });

  let status = 'Verificando o serviço…';
  if (health.isError || health.data === false) {
    status = 'Serviço indisponível.';
  } else if (health.data === true) {
    status = 'Serviço disponível.';
  }

  return (
    <>
      <h1>Boas-vindas ao Hub NeuroCapacitar</h1>
      <p role="status">{status}</p>
    </>
  );
}
