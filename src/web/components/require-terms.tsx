import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { LegalDocumentDto, LegalKind } from '../../features/identity/legal';
import { acceptLegal, fetchLegal } from '../api/legal';
import { Button } from './ui/button';

const TITLES: Record<LegalKind, string> = {
  terms: 'Termos de Uso',
  privacy: 'Política de Privacidade',
};

/**
 * Protege uma tela de área logada: sem aceite das versões vigentes mostra a tela de aceite no lugar
 * do conteúdo (que nem é montado, então nenhuma chamada dele sai e um fragmento de URL, como o do
 * convite, segue intacto). A barreira real é o servidor (403 `terms_required` em toda rota de área
 * logada); isto é só a consequência na interface. Sem sessão, mostra o conteúdo (ele pede o login).
 */
export function RequireTerms({ children }: { children: ReactNode }) {
  const legal = useQuery({ queryKey: ['legal'], queryFn: fetchLegal, retry: false });

  if (legal.isPending) return <p role="status">Carregando…</p>;
  if (legal.isError) {
    return (
      <>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível verificar o aceite dos termos agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void legal.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }
  if (legal.data === null || legal.data.accepted) return <>{children}</>;
  return <AcceptTerms documents={legal.data.documents} />;
}

function AcceptTerms({ documents }: { documents: LegalDocumentDto[] }) {
  const queryClient = useQueryClient();
  const [readTerms, setReadTerms] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const provisional = documents.some((doc) => doc.body.startsWith('TEXTO PROVISÓRIO'));

  async function submit() {
    setBusy(true);
    setError(undefined);
    const result = await acceptLegal(documents.map((doc) => doc.id));
    setBusy(false);
    if (result === 'ok' || result === 'changed') {
      // `changed`: saiu uma versão nova no meio; recarrega para ler a vigente.
      await queryClient.invalidateQueries({ queryKey: ['legal'] });
      return;
    }
    setError(
      result === 'unauthenticated'
        ? 'Sua sessão expirou. Entre novamente.'
        : 'Não foi possível registrar o aceite agora. Tente novamente em instantes.',
    );
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Antes de continuar</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        Para usar a área logada, leia e aceite os documentos abaixo e declare que tem 18 anos ou
        mais.
      </p>
      {provisional ? (
        <p role="note" className="mb-6 max-w-prose rounded-lg border p-3 font-medium">
          Os textos abaixo são provisórios e aguardam a versão definitiva do advogado.
        </p>
      ) : null}
      <div className="mb-8 grid max-w-prose gap-6">
        {documents.map((doc) => (
          <section key={doc.id} aria-labelledby={`doc-${doc.id}`} className="grid gap-2">
            <h2 id={`doc-${doc.id}`} className="text-xl font-semibold">
              {TITLES[doc.kind]} <span className="text-sm font-normal">(versão {doc.version})</span>
            </h2>
            <div
              className="max-h-64 overflow-y-auto whitespace-pre-line rounded-lg border p-4"
              tabIndex={0}
            >
              {doc.body}
            </div>
          </section>
        ))}
      </div>
      <div className="grid max-w-prose gap-2">
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={readTerms}
            onChange={(event) => setReadTerms(event.target.checked)}
            className="size-5"
          />
          <span>Li e aceito os Termos de Uso e a Política de Privacidade.</span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={adult}
            onChange={(event) => setAdult(event.target.checked)}
            className="size-5"
          />
          <span>Declaro ter 18 anos ou mais.</span>
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-4 font-medium text-[var(--text-danger)]">
          {error}
        </p>
      ) : null}
      <div className="mt-6">
        <Button type="button" disabled={busy || !readTerms || !adult} onClick={() => void submit()}>
          {busy ? 'Registrando…' : 'Aceitar e continuar'}
        </Button>
      </div>
    </>
  );
}
