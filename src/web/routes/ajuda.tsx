import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import {
  HELP_CATEGORIES,
  HELP_CATEGORY_LABELS,
  MAX_REQUEST_LENGTH,
  type HelpCategory,
  type HelpFaqItemDto,
} from '../../features/help/help';
import { fetchFaq, sendSupportRequest } from '../api/help';
import { UnauthenticatedError } from '../api/profile';
import { RichTextView } from '../components/rich-text/rich-text-view';
import { RequireTerms } from '../components/require-terms';
import { SupportAddress } from '../components/support-address';
import { Button } from '../components/ui/button';
import { TextArea } from '../components/ui/text-area';

export const Route = createFileRoute('/ajuda')({
  component: () => (
    <RequireTerms>
      <Help />
    </RequireTerms>
  ),
});

const FAILURES: Record<string, string> = {
  rate_limited:
    'Você enviou pedidos demais em pouco tempo. Aguarde alguns minutos e tente de novo.',
  invalid_context: 'Não foi possível identificar o curso informado.',
  invalid_request: `Confira o texto: de 1 a ${MAX_REQUEST_LENGTH} caracteres.`,
};

/**
 * Ajuda (M5-14): uma única entrada com a FAQ publicada e o pedido de suporte, que chega à equipe por e-mail. Sem
 * busca nem chat; a resposta é humana e acontece fora do Hub. Fixo acima do campo: é proibido incluir dados que
 * identifiquem pacientes.
 */
function Help() {
  const faq = useQuery({
    queryKey: ['help-faq'],
    queryFn: fetchFaq,
    retry: false,
    staleTime: 60_000,
  });

  const unauthenticated = faq.error instanceof UnauthenticatedError;
  const grouped = HELP_CATEGORIES.map((category) => ({
    category,
    items: (faq.data ?? []).filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Ajuda</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Veja as perguntas frequentes e, se não encontrar a resposta, escreva para a nossa equipe.
      </p>

      {unauthenticated ? (
        <p role="alert" className="mb-6 max-w-prose">
          Entre na sua conta para ver a ajuda e falar com a equipe.{' '}
          <Link to="/entrar" search={{ returnTo: '/ajuda' }} className="underline">
            Entrar
          </Link>
        </p>
      ) : null}
      <div className="mb-8">
        <SupportAddress prefix="Se não conseguir entrar, escreva para" />
      </div>

      {faq.isPending ? <p role="status">Carregando a ajuda…</p> : null}
      {faq.isError && !unauthenticated ? (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            Não foi possível carregar as perguntas agora.
          </p>
          <Button type="button" variant="secondary" onClick={() => void faq.refetch()}>
            Tentar novamente
          </Button>
        </>
      ) : null}

      {faq.data ? (
        <section aria-labelledby="faq-titulo" className="mb-12 grid max-w-prose gap-6">
          <h2 id="faq-titulo" className="text-xl font-semibold">
            Perguntas frequentes
          </h2>
          {grouped.length === 0 ? (
            <p className="text-[var(--text-muted)]">Ainda não há perguntas publicadas.</p>
          ) : (
            grouped.map((group) => (
              <section
                key={group.category}
                aria-label={HELP_CATEGORY_LABELS[group.category]}
                className="grid gap-2"
              >
                <h3 className="text-lg font-semibold">{HELP_CATEGORY_LABELS[group.category]}</h3>
                {group.items.map((item) => (
                  <FaqEntry key={item.id} item={item} />
                ))}
              </section>
            ))
          )}
        </section>
      ) : null}

      {!unauthenticated ? <SupportForm /> : null}
    </>
  );
}

function FaqEntry({ item }: { item: HelpFaqItemDto }) {
  return (
    <details className="rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer font-medium">{item.question}</summary>
      <div className="mt-3">
        <RichTextView value={item.answer} />
      </div>
    </details>
  );
}

function SupportForm() {
  const [category, setCategory] = useState<HelpCategory>('acesso');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim() === '') return;
    setBusy(true);
    setResult(undefined);
    const outcome = await sendSupportRequest({ category, message });
    setBusy(false);
    if (outcome.result === 'ok') {
      setMessage('');
      setResult({
        kind: 'ok',
        text: 'Pedido enviado. A equipe responderá por e-mail para o endereço da sua conta.',
      });
      return;
    }
    setResult({
      kind: 'error',
      text:
        outcome.result === 'unavailable'
          ? 'Não foi possível enviar agora. Verifique a conexão e tente de novo.'
          : outcome.result === 'unauthenticated'
            ? 'Sua sessão expirou. Entre novamente.'
            : ((outcome.code ? FAILURES[outcome.code] : undefined) ??
              (outcome.result === 'invalid'
                ? FAILURES.invalid_request!
                : 'Não foi possível enviar o pedido agora.')),
    });
  }

  return (
    <section aria-labelledby="suporte-titulo" className="grid max-w-prose gap-4">
      <h2 id="suporte-titulo" className="text-xl font-semibold">
        Falar com a equipe
      </h2>
      <p className="rounded-lg border p-3 text-sm">
        É proibido incluir dados que identifiquem pacientes (nome, contato, documento ou qualquer
        informação que permita reconhecê-los). Descreva só o problema com a plataforma.
      </p>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="font-medium text-[var(--field-label)]">Assunto</span>
          <select
            name="categoria"
            value={category}
            onChange={(event) => setCategory(event.target.value as HelpCategory)}
            className="min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]"
          >
            {HELP_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {HELP_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <TextArea
          id="suporte-mensagem"
          label="Sua mensagem"
          value={message}
          maxLength={MAX_REQUEST_LENGTH}
          onChange={(event) => setMessage(event.target.value)}
          description={`${message.length} de ${MAX_REQUEST_LENGTH} caracteres. A resposta vai para o e-mail da sua conta.`}
        />
        {result ? (
          <p
            role={result.kind === 'ok' ? 'status' : 'alert'}
            className={
              result.kind === 'ok'
                ? 'font-medium text-[var(--text-success)]'
                : 'font-medium text-[var(--text-danger)]'
            }
          >
            {result.text}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={busy || message.trim() === ''}>
            {busy ? 'Enviando…' : 'Enviar pedido'}
          </Button>
        </div>
      </form>
    </section>
  );
}
