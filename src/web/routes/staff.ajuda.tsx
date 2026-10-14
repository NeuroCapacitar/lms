import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';

import type { RichText } from '../../features/content/rich-text';
import {
  HELP_CATEGORIES,
  HELP_CATEGORY_LABELS,
  MAX_QUESTION_LENGTH,
  type HelpCategory,
  type HelpFaqItemDto,
} from '../../features/help/help';
import type { ActionOutcome } from '../api/action';
import {
  createFaq,
  deleteFaq,
  fetchStaffFaq,
  fetchSupportRequests,
  moveFaq,
  setFaqState,
  updateFaq,
} from '../api/help';
import { ForbiddenError } from '../api/staff';
import { ConfirmButton } from '../components/confirm-button';
import { RichTextView } from '../components/rich-text/rich-text-view';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/staff/ajuda')({ component: StaffHelp });

const RichTextEditor = lazy(() =>
  import('../components/rich-text/rich-text-editor').then((module) => ({
    default: module.RichTextEditor,
  })),
);

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const EMPTY_ANSWER: RichText = { type: 'doc', content: [{ type: 'paragraph' }] };

const FAILURES: Record<string, string> = {
  invalid_request:
    'Confira os campos: a pergunta não pode ficar vazia e a resposta precisa ter texto válido.',
  forbidden: 'Você não tem a permissão de editar a ajuda.',
  not_found: 'O item não existe mais. Atualize a lista.',
};

function failureText(outcome: ActionOutcome<unknown>): string {
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return (
    (outcome.code ? FAILURES[outcome.code] : undefined) ??
    (outcome.result === 'invalid' ? FAILURES.invalid_request! : 'Não foi possível concluir agora.')
  );
}

/**
 * Ajuda da equipe (M5-14): pedidos de suporte (qualquer Staff lê) e a FAQ (só quem tem o grant "editar a
 * FAQ/Ajuda"). A resposta ao pedido é por e-mail, fora do Hub: o e-mail ao suporte traz o id e o `Reply-To` da pessoa.
 */
function StaffHelp() {
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Ajuda</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        A FAQ que os alunos veem e os pedidos de suporte recebidos.
      </p>
      <FaqSection />
      <RequestsSection />
    </>
  );
}

function FaqSection() {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ['staff-faq'], queryFn: fetchStaffFaq, retry: false });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [announce, setAnnounce] = useState('');

  async function run(work: () => Promise<ActionOutcome<unknown>>, ok: string): Promise<boolean> {
    setMessage(undefined);
    const outcome = await work();
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['staff-faq'] });
      return true;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
    return false;
  }

  return (
    <section aria-labelledby="faq-staff-titulo" className="mb-12 grid gap-4">
      <h2 id="faq-staff-titulo" className="text-xl font-semibold">
        Perguntas frequentes
      </h2>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {items.error instanceof ForbiddenError ? (
        <p role="alert">Você não tem a permissão de editar a FAQ.</p>
      ) : items.isPending ? (
        <p role="status">Carregando…</p>
      ) : items.isError ? (
        <>
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            Não foi possível carregar a FAQ agora.
          </p>
          <div>
            <Button type="button" variant="secondary" onClick={() => void items.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </>
      ) : (
        <>
          {message ? (
            <p
              role={message.kind === 'ok' ? 'status' : 'alert'}
              className={
                message.kind === 'ok'
                  ? 'font-medium text-[var(--text-success)]'
                  : 'font-medium text-[var(--text-danger)]'
              }
            >
              {message.text}
            </p>
          ) : null}
          <FaqForm
            heading="Nova pergunta"
            submit="Criar (rascunho)"
            onSubmit={(value) =>
              run(
                () => createFaq(value),
                'Item criado como rascunho. Publique para os alunos verem.',
              )
            }
          />
          {items.data.length === 0 ? (
            <p className="text-[var(--text-muted)]">Ainda não há itens.</p>
          ) : (
            <ol className="grid gap-4" aria-label="Itens da FAQ">
              {items.data.map((item, index) => (
                <li key={item.id}>
                  <FaqRow
                    item={item}
                    index={index}
                    total={items.data.length}
                    run={run}
                    onMoved={(text) => setAnnounce(text)}
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function FaqForm({
  heading,
  submit,
  initial,
  onSubmit,
  onCancel,
}: {
  heading: string;
  submit: string;
  initial?: { category: HelpCategory; question: string; answer: RichText };
  onSubmit: (value: {
    category: HelpCategory;
    question: string;
    answer: RichText;
  }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [category, setCategory] = useState<HelpCategory>(initial?.category ?? 'conta');
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [answer, setAnswer] = useState<RichText>(initial?.answer ?? EMPTY_ANSWER);
  const [busy, setBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  return (
    <form
      noValidate
      aria-label={heading}
      className="grid gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSubmit({ category, question, answer }).then((done) => {
          setBusy(false);
          if (done && !initial) {
            setQuestion('');
            setAnswer(EMPTY_ANSWER);
            setEditorKey((key) => key + 1);
          }
        });
      }}
    >
      <h3 className="font-semibold">{heading}</h3>
      <label className="grid gap-1.5">
        <span className="font-medium text-[var(--field-label)]">Categoria ({heading})</span>
        <select
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
      <TextField
        label={`Pergunta (${heading})`}
        value={question}
        maxLength={MAX_QUESTION_LENGTH}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <div className="grid gap-2">
        <p className="font-medium">Resposta ({heading})</p>
        <Suspense fallback={<p role="status">Carregando editor…</p>}>
          <RichTextEditor
            key={editorKey}
            initialValue={initial?.answer ?? null}
            label={`Resposta (${heading})`}
            onChange={setAnswer}
          />
        </Suspense>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || question.trim() === ''}>
          {submit}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function FaqRow({
  item,
  index,
  total,
  run,
  onMoved,
}: {
  item: HelpFaqItemDto;
  index: number;
  total: number;
  run: (work: () => Promise<ActionOutcome<unknown>>, ok: string) => Promise<boolean>;
  onMoved: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const name = `item ${index + 1}`;

  if (editing) {
    return (
      <FaqForm
        heading={`Editar o ${name}`}
        submit="Salvar alterações"
        initial={{ category: item.category, question: item.question, answer: item.answer }}
        onCancel={() => setEditing(false)}
        onSubmit={async (value) => {
          const done = await run(() => updateFaq(item.id, value), 'Item atualizado.');
          if (done) setEditing(false);
          return done;
        }}
      />
    );
  }
  return (
    <article className="grid gap-3 rounded-lg border p-4" aria-label={`FAQ, ${name}`}>
      <header className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{HELP_CATEGORY_LABELS[item.category]}</span>
        <span className="rounded border px-1.5 text-xs font-medium">
          {item.state === 'published' ? 'Publicado' : 'Rascunho'}
        </span>
      </header>
      <p className="font-medium">{item.question}</p>
      <RichTextView value={item.answer} className="max-w-prose" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={index === 0}
          aria-label={`Subir o ${name}`}
          onClick={() =>
            void run(() => moveFaq(item.id, 'up'), `Item movido para a posição ${index}.`).then(
              (done) => done && onMoved(`${name} movido para a posição ${index} de ${total}.`),
            )
          }
        >
          Subir
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={index === total - 1}
          aria-label={`Descer o ${name}`}
          onClick={() =>
            void run(
              () => moveFaq(item.id, 'down'),
              `Item movido para a posição ${index + 2}.`,
            ).then(
              (done) => done && onMoved(`${name} movido para a posição ${index + 2} de ${total}.`),
            )
          }
        >
          Descer
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
          Editar o {name}
        </Button>
        {item.state === 'draft' ? (
          <Button
            type="button"
            onClick={() => void run(() => setFaqState(item.id, 'published'), 'Item publicado.')}
          >
            Publicar o {name}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void run(() => setFaqState(item.id, 'draft'), 'Item despublicado.')}
          >
            Despublicar o {name}
          </Button>
        )}
        <ConfirmButton
          label={`Excluir o ${name}`}
          confirmLabel="Confirmar exclusão do item"
          disabled={false}
          onConfirm={() => void run(() => deleteFaq(item.id), 'Item excluído.')}
        />
      </div>
    </article>
  );
}

function RequestsSection() {
  const requests = useQuery({
    queryKey: ['support-requests'],
    queryFn: fetchSupportRequests,
    retry: false,
  });
  return (
    <section aria-labelledby="pedidos-titulo" className="grid gap-4">
      <h2 id="pedidos-titulo" className="text-xl font-semibold">
        Pedidos de suporte
      </h2>
      <p className="max-w-prose text-sm text-[var(--text-muted)]">
        Os 50 mais recentes. Cada pedido também chega por e-mail ao suporte, com o endereço da
        pessoa em "Responder para": a resposta é feita por lá.
      </p>
      {requests.isPending ? (
        <p role="status">Carregando…</p>
      ) : requests.isError ? (
        <>
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            Não foi possível carregar os pedidos agora.
          </p>
          <div>
            <Button type="button" variant="secondary" onClick={() => void requests.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </>
      ) : requests.data.length === 0 ? (
        <p className="text-[var(--text-muted)]">Nenhum pedido ainda.</p>
      ) : (
        <ul className="grid gap-3" aria-label="Pedidos de suporte">
          {requests.data.map((request) => (
            <li key={request.id} className="grid gap-2 rounded-lg border p-4">
              <p className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-semibold">{request.authorName}</span>
                <span className="rounded border px-1.5 text-xs font-medium">
                  {HELP_CATEGORY_LABELS[request.category]}
                </span>
                <time dateTime={request.createdAt} className="text-[var(--text-muted)]">
                  {dateFormat.format(new Date(request.createdAt))}
                </time>
                {request.courseTitle ? (
                  <span className="text-[var(--text-muted)]">Curso: {request.courseTitle}</span>
                ) : null}
                <span className="text-xs text-[var(--text-muted)]">
                  Pedido {request.id.slice(0, 8)}
                </span>
              </p>
              <p className="whitespace-pre-wrap break-words">{request.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
