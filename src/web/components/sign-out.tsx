import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { offline } from '../offline/runtime';
import { markSignedOutPending } from '../offline/signed-out';
import { Button } from './ui/button';

/**
 * "Sessão: sair da conta" (M8-05). Sai do servidor e APAGA tudo o que era da pessoa neste aparelho (IndexedDB, caches,
 * armazenamento, cache de consultas). Sem rede, o aparelho é limpo NA HORA e o servidor encerra a sessão quando a rede voltar.
 * Se o servidor falhar online, nada é apagado e dá para tentar de novo. Disponível mesmo quando o perfil não carrega.
 */
export function SignOutSection() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'leaving' | 'failed'>('idle');

  async function leave() {
    setState('leaving');
    const outcome = await offline.signOut();
    if (outcome === 'failed') {
      setState('failed');
      return;
    }
    // Nada da pessoa fica em memória: o cache de consultas é descartado.
    queryClient.clear();
    if (outcome === 'pending') {
      // A tela da conta remonta com a limpeza das consultas: o aviso vive fora dela (`useSignedOutPending`).
      markSignedOutPending();
      return;
    }
    window.location.assign('/');
  }

  return (
    <section aria-labelledby="sessao-titulo" className="mt-12 grid max-w-md gap-3">
      <h2 id="sessao-titulo" className="text-xl font-semibold">
        Sessão
      </h2>
      <p className="text-[var(--text-muted)]">
        Encerra o acesso neste aparelho e apaga o que foi guardado nele para estudar offline.
      </p>
      {state === 'failed' ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível sair agora. Tente novamente.
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={state === 'leaving'}
          onClick={() => void leave()}
        >
          {state === 'leaving' ? 'Saindo…' : 'Sair da conta'}
        </Button>
      </div>
    </section>
  );
}

/** Depois de sair SEM rede: o aparelho já está limpo e a sessão será encerrada no servidor quando houver conexão. */
export function SignedOutNotice() {
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Minha conta</h1>
      <section aria-labelledby="sessao-titulo" className="mt-6 grid max-w-md gap-3">
        <h2 id="sessao-titulo" className="text-xl font-semibold">
          Sessão
        </h2>
        <p role="status" className="font-medium">
          Você saiu da conta neste aparelho e os dados guardados foram apagados. A sessão no
          servidor será encerrada assim que houver conexão.
        </p>
        <Link to="/">Ir para a página inicial</Link>
      </section>
    </>
  );
}
