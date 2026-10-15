import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import {
  MAX_ALT_LENGTH,
  MAX_LOGIN_MEDIA_PUBLISHED,
  type StaffLoginMediaDto,
  type StaffPanelBannerDto,
} from '../../features/banner/banner';
import type { ActionOutcome } from '../api/action';
import {
  createLoginMedia,
  createPanelBanner,
  deleteLoginMedia,
  deletePanelBanner,
  fetchStaffBanners,
  moveLoginMedia,
  movePanelBanner,
  setLoginMediaState,
  setPanelBannerState,
  updatePanelBanner,
  type PanelBannerInput,
} from '../api/banner';
import { ForbiddenError } from '../api/http';
import { ConfirmButton } from '../components/confirm-button';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';
import { MediaField } from '../course-builder/media-field';

export const Route = createFileRoute('/staff/banners')({ component: StaffBanners });

const FAILURES: Record<string, string> = {
  invalid_request:
    'Confira os campos: o texto alternativo é obrigatório e o link só pode ser um caminho do próprio site (começa com /) ou um endereço https do domínio da NeuroCapacitar.',
  invalid_media: 'A imagem não serve para este uso. Envie de novo.',
  media_not_ready: 'A imagem ainda não está pronta. Envie de novo.',
  media_not_published:
    'A imagem ainda não foi copiada para o armazenamento público. Tente publicar de novo.',
  media_not_configured: 'O armazenamento de imagens ainda não está ativo neste ambiente.',
  too_many_published: `Já há ${MAX_LOGIN_MEDIA_PUBLISHED} imagens publicadas no login. Despublique uma antes.`,
  forbidden: 'Só o Admin gerencia banners.',
  not_found: 'O item não existe mais. Atualize a lista.',
};

function failureText(outcome: ActionOutcome<unknown>): string {
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return (
    (outcome.code ? FAILURES[outcome.code] : undefined) ??
    (outcome.result === 'invalid' ? FAILURES.invalid_request! : 'Não foi possível concluir agora.')
  );
}

type Run = (work: () => Promise<ActionOutcome<unknown>>, ok: string) => Promise<boolean>;

/** `datetime-local` (hora do navegador, sem fuso) ↔ instante ISO. */
const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Banners do painel e imagens do login (M5-15), só do Admin. A imagem é recortada pelo navegador e conferida pelo
 * servidor (M5-07). Publicar copia a imagem para o armazenamento público; rascunho nunca aparece para ninguém. A
 * ordem é a da lista (Subir e Descer).
 */
function StaffBanners() {
  const queryClient = useQueryClient();
  const banners = useQuery({
    queryKey: ['staff-banners'],
    queryFn: fetchStaffBanners,
    retry: false,
  });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [announce, setAnnounce] = useState('');

  const run: Run = async (work, ok) => {
    setMessage(undefined);
    const outcome = await work();
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['staff-banners'] });
      // O que o aluno e a tela de login enxergam também mudou.
      await queryClient.invalidateQueries({ queryKey: ['panel-banners'] });
      await queryClient.invalidateQueries({ queryKey: ['login-media'] });
      return true;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
    return false;
  };

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Banners</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Os destaques que o aluno vê no topo dos cursos e as imagens da tela de login.
      </p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {banners.error instanceof ForbiddenError ? (
        <p role="alert">Só o Admin gerencia banners.</p>
      ) : banners.isPending ? (
        <p role="status">Carregando…</p>
      ) : banners.isError ? (
        <>
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            Não foi possível carregar os banners agora.
          </p>
          <div>
            <Button type="button" variant="secondary" onClick={() => void banners.refetch()}>
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
                  ? 'mb-6 font-medium text-[var(--text-success)]'
                  : 'mb-6 font-medium text-[var(--text-danger)]'
              }
            >
              {message.text}
            </p>
          ) : null}
          <PanelSection items={banners.data.panel} run={run} onMoved={setAnnounce} />
          <LoginSection items={banners.data.login} run={run} onMoved={setAnnounce} />
        </>
      )}
    </>
  );
}

function StateBadge({ state }: { state: 'draft' | 'published' }) {
  return (
    <span className="rounded border px-1.5 text-xs font-medium">
      {state === 'published' ? 'Publicado' : 'Rascunho'}
    </span>
  );
}

function MoveButtons({
  name,
  index,
  total,
  move,
  run,
  onMoved,
}: {
  name: string;
  index: number;
  total: number;
  move: (direction: 'up' | 'down') => Promise<ActionOutcome<unknown>>;
  run: Run;
  onMoved: (text: string) => void;
}) {
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={index === 0}
        aria-label={`Subir o ${name}`}
        onClick={() =>
          void run(() => move('up'), `Movido para a posição ${index}.`).then(
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
          void run(() => move('down'), `Movido para a posição ${index + 2}.`).then(
            (done) => done && onMoved(`${name} movido para a posição ${index + 2} de ${total}.`),
          )
        }
      >
        Descer
      </Button>
    </>
  );
}

/* ---------------- Banners do painel ---------------- */

function PanelSection({
  items,
  run,
  onMoved,
}: {
  items: StaffPanelBannerDto[];
  run: Run;
  onMoved: (text: string) => void;
}) {
  return (
    <section aria-labelledby="painel-titulo" className="mb-12 grid grid-cols-1 gap-4">
      <h2 id="painel-titulo" className="text-xl font-semibold">
        Banners do painel
      </h2>
      <PanelForm
        heading="Novo banner"
        submit="Criar (rascunho)"
        onSubmit={(value) =>
          run(
            () => createPanelBanner(value),
            'Banner criado como rascunho. Publique para aparecer.',
          )
        }
      />
      {items.length === 0 ? (
        <p className="text-[var(--text-muted)]">Ainda não há banners.</p>
      ) : (
        <ol className="grid gap-4" aria-label="Banners do painel">
          {items.map((item, index) => (
            <li key={item.id}>
              <PanelRow
                item={item}
                index={index}
                total={items.length}
                run={run}
                onMoved={onMoved}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PanelForm({
  heading,
  submit,
  initial,
  onSubmit,
  onCancel,
}: {
  heading: string;
  submit: string;
  initial?: StaffPanelBannerDto;
  onSubmit: (value: PanelBannerInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [mediaId, setMediaId] = useState<string | null>(initial?.mediaId ?? null);
  const [alt, setAlt] = useState(initial?.alt ?? '');
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.endsAt ?? null));
  const [busy, setBusy] = useState(false);
  const [fieldKey, setFieldKey] = useState(0);

  return (
    <form
      noValidate
      aria-label={heading}
      className="grid grid-cols-1 gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!mediaId) return;
        setBusy(true);
        void onSubmit({
          mediaId,
          alt,
          linkUrl: linkUrl.trim() === '' ? null : linkUrl,
          startsAt: toIso(startsAt),
          endsAt: toIso(endsAt),
        }).then((done) => {
          setBusy(false);
          if (done && !initial) {
            setMediaId(null);
            setAlt('');
            setLinkUrl('');
            setStartsAt('');
            setEndsAt('');
            setFieldKey((key) => key + 1);
          }
        });
      }}
    >
      <h3 className="font-semibold">{heading}</h3>
      <MediaField
        key={fieldKey}
        purpose="panel_banner"
        label={`Imagem (${heading})`}
        help="Recortada ao centro na proporção 4:1 (1680×420), com pelo menos 840 pixels de largura."
        value={mediaId}
        readOnly={false}
        uploadedHint="Imagem enviada. Salve o banner para usá-la."
        onChange={setMediaId}
      />
      <TextField
        label={`Texto alternativo (${heading})`}
        description="Obrigatório: descreve a imagem para quem não a enxerga."
        value={alt}
        maxLength={MAX_ALT_LENGTH}
        onChange={(event) => setAlt(event.target.value)}
      />
      <TextField
        label={`Link, opcional (${heading})`}
        description="Um caminho do site (como /cursos) ou um endereço https do domínio neurocapacitar.com.br."
        value={linkUrl}
        maxLength={500}
        onChange={(event) => setLinkUrl(event.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="font-medium text-[var(--field-label)]">
            Começa em, opcional ({heading})
          </span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-medium text-[var(--field-label)]">
            Termina em, opcional ({heading})
          </span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            className="min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !mediaId || alt.trim() === ''}>
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

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function PanelRow({
  item,
  index,
  total,
  run,
  onMoved,
}: {
  item: StaffPanelBannerDto;
  index: number;
  total: number;
  run: Run;
  onMoved: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const name = `banner ${index + 1}`;

  if (editing) {
    return (
      <PanelForm
        heading={`Editar o ${name}`}
        submit="Salvar alterações"
        initial={item}
        onCancel={() => setEditing(false)}
        onSubmit={async (value) => {
          const done = await run(() => updatePanelBanner(item.id, value), 'Banner atualizado.');
          if (done) setEditing(false);
          return done;
        }}
      />
    );
  }
  return (
    <article
      className="grid grid-cols-1 gap-3 rounded-lg border p-4"
      aria-label={`Painel, ${name}`}
    >
      <header className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{item.alt}</span>
        <StateBadge state={item.state} />
      </header>
      <p className="text-sm text-[var(--text-muted)]">
        {item.linkUrl ? `Link: ${item.linkUrl}` : 'Sem link.'}{' '}
        {item.startsAt ? `Começa em ${dateFormat.format(new Date(item.startsAt))}. ` : ''}
        {item.endsAt ? `Termina em ${dateFormat.format(new Date(item.endsAt))}.` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <MoveButtons
          name={name}
          index={index}
          total={total}
          move={(direction) => movePanelBanner(item.id, direction)}
          run={run}
          onMoved={onMoved}
        />
        <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
          Editar o {name}
        </Button>
        {item.state === 'draft' ? (
          <Button
            type="button"
            onClick={() =>
              void run(() => setPanelBannerState(item.id, 'published'), 'Banner publicado.')
            }
          >
            Publicar o {name}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void run(() => setPanelBannerState(item.id, 'draft'), 'Banner despublicado.')
            }
          >
            Despublicar o {name}
          </Button>
        )}
        <ConfirmButton
          label={`Excluir o ${name}`}
          confirmLabel="Confirmar exclusão do banner"
          disabled={false}
          onConfirm={() => void run(() => deletePanelBanner(item.id), 'Banner excluído.')}
        />
      </div>
    </article>
  );
}

/* ---------------- Imagens do login ---------------- */

function LoginSection({
  items,
  run,
  onMoved,
}: {
  items: StaffLoginMediaDto[];
  run: Run;
  onMoved: (text: string) => void;
}) {
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [fieldKey, setFieldKey] = useState(0);
  const published = items.filter((item) => item.state === 'published').length;

  return (
    <section aria-labelledby="login-titulo" className="grid grid-cols-1 gap-4">
      <h2 id="login-titulo" className="text-xl font-semibold">
        Imagens da tela de login
      </h2>
      <p className="max-w-prose text-sm text-[var(--text-muted)]">
        Decorativas (sem texto alternativo) e só aparecem em telas largas. No máximo{' '}
        {MAX_LOGIN_MEDIA_PUBLISHED} publicadas ({published} agora); a tela mostra a primeira da
        lista.
      </p>
      <form
        noValidate
        aria-label="Nova imagem de login"
        className="grid grid-cols-1 gap-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!mediaId) return;
          void run(
            () => createLoginMedia(mediaId),
            'Imagem criada como rascunho. Publique para aparecer.',
          ).then((done) => {
            if (done) {
              setMediaId(null);
              setFieldKey((key) => key + 1);
            }
          });
        }}
      >
        <h3 className="font-semibold">Nova imagem de login</h3>
        <MediaField
          key={fieldKey}
          purpose="login_media"
          label="Imagem (login)"
          help="Recortada ao centro na proporção 3:4 (900×1200), com pelo menos 450 pixels de largura."
          value={mediaId}
          readOnly={false}
          uploadedHint="Imagem enviada. Crie o item para usá-la."
          onChange={setMediaId}
        />
        <div>
          <Button type="submit" disabled={!mediaId}>
            Criar (rascunho)
          </Button>
        </div>
      </form>
      {items.length === 0 ? (
        <p className="text-[var(--text-muted)]">Ainda não há imagens.</p>
      ) : (
        <ol className="grid gap-4" aria-label="Imagens do login">
          {items.map((item, index) => {
            const name = `imagem ${index + 1}`;
            return (
              <li key={item.id}>
                <article
                  className="grid grid-cols-1 gap-3 rounded-lg border p-4"
                  aria-label={`Login, ${name}`}
                >
                  <header className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-semibold">Imagem {index + 1}</span>
                    <StateBadge state={item.state} />
                  </header>
                  <div className="flex flex-wrap gap-2">
                    <MoveButtons
                      name={name}
                      index={index}
                      total={items.length}
                      move={(direction) => moveLoginMedia(item.id, direction)}
                      run={run}
                      onMoved={onMoved}
                    />
                    {item.state === 'draft' ? (
                      <Button
                        type="button"
                        onClick={() =>
                          void run(
                            () => setLoginMediaState(item.id, 'published'),
                            'Imagem publicada.',
                          )
                        }
                      >
                        Publicar a {name}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          void run(
                            () => setLoginMediaState(item.id, 'draft'),
                            'Imagem despublicada.',
                          )
                        }
                      >
                        Despublicar a {name}
                      </Button>
                    )}
                    <ConfirmButton
                      label={`Excluir a ${name}`}
                      confirmLabel="Confirmar exclusão da imagem"
                      disabled={false}
                      onConfirm={() =>
                        void run(() => deleteLoginMedia(item.id), 'Imagem excluída.')
                      }
                    />
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
