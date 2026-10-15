import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import {
  VIDEO_PROVIDERS,
  VIDEO_PROVIDER_LABELS,
  secretRequired,
  type VideoConnectionDto,
  type VideoProvider,
} from '../../features/video/providers';
import type { ActionResult } from '../api/action';
import { ForbiddenError } from '../api/http';
import {
  createVideoConnection,
  fetchVideoConnections,
  fetchVideoProviders,
  rekeyVideoSecrets,
  rotateVideoSecret,
  setVideoConnectionEnabled,
} from '../api/video';
import { ConfirmButton } from '../components/confirm-button';
import { ReauthPanel } from '../components/reauth-panel';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/staff/videos')({ component: VideoConnections });

const FAILURES: Partial<Record<ActionResult, string>> = {
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  invalid: 'Confira os dados informados (o provedor escolhido exige o segredo da conta).',
  forbidden: 'Só o administrador pode gerir as conexões de vídeo.',
  not_found: 'Não encontramos a conexão. Atualize a página.',
  unavailable:
    'Não foi possível concluir agora. Se o problema continuar, o cofre de chaves do ambiente pode não estar configurado.',
};

function RotateSecret({
  connection,
  busy,
  onRotate,
}: {
  connection: VideoConnectionDto;
  busy: boolean;
  onRotate: (id: string, secret: string) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const [secret, setSecret] = useState('');
  if (!asking) {
    return (
      <Button
        type="button"
        variant="secondary"
        aria-label={`Trocar o segredo da conexão ${connection.label}`}
        onClick={() => setAsking(true)}
      >
        Trocar o segredo
      </Button>
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onRotate(connection.id, secret)) {
      setSecret('');
      setAsking(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="grid min-w-64 gap-2">
      <TextField
        label={`Novo segredo de ${connection.label}`}
        name={`segredo-${connection.id}`}
        type="password"
        autoComplete="off"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        description="Só é enviado agora e nunca mais é mostrado."
      />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || secret === ''}>
          Salvar segredo
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSecret('');
            setAsking(false);
          }}
        >
          Cancelar
        </Button>
      </span>
    </form>
  );
}

/**
 * Tela "Vídeo" (M5-01, só Admin): as conexões com as contas de provedor de vídeo do cliente. O segredo é
 * write-only: depois de salvo a tela só mostra "configurado" e a versão da chave, nunca o valor. Cada
 * mudança pede a reautenticação recente (M1-05) e é auditada pelo servidor.
 */
function VideoConnections() {
  const queryClient = useQueryClient();
  const connections = useQuery({
    queryKey: ['video-connections'],
    queryFn: fetchVideoConnections,
    retry: false,
  });
  // Quais providers o ambiente oferece (M5-03). Se a consulta falhar, mostra todos: o servidor é quem trava.
  const availability = useQuery({
    queryKey: ['video-providers'],
    queryFn: fetchVideoProviders,
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [needsReauth, setNeedsReauth] = useState<string | undefined>();
  const [chosenProvider, setProvider] = useState<VideoProvider>('panda');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');

  async function run(action: () => Promise<ActionResult>, ok: string, reauthFor: string) {
    setBusy(true);
    setMessage(undefined);
    const result = await action();
    setBusy(false);
    if (result === 'reauth_required') {
      setNeedsReauth(reauthFor);
      return false;
    }
    setNeedsReauth(undefined);
    if (result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['video-connections'] });
      return true;
    }
    setMessage({ kind: 'error', text: FAILURES[result] ?? FAILURES.unavailable! });
    return false;
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const created = await run(
      () =>
        createVideoConnection({
          provider,
          label,
          ...(secret === '' ? {} : { secret }),
        }),
      'Conexão cadastrada.',
      'cadastrar uma conexão',
    );
    if (created) {
      setLabel('');
      setSecret('');
    }
  }

  async function onRekey() {
    setBusy(true);
    setMessage(undefined);
    const outcome = await rekeyVideoSecrets();
    setBusy(false);
    if (outcome.result === 'reauth_required') {
      setNeedsReauth('recifrar os segredos');
      return;
    }
    setNeedsReauth(undefined);
    if (outcome.result === 'ok' && outcome.data) {
      const { rekeyed, alreadyCurrent, failed } = outcome.data;
      setMessage({
        kind: failed > 0 ? 'error' : 'ok',
        text: `Recifragem: ${rekeyed} recifrado(s), ${alreadyCurrent} já na chave atual, ${failed} com falha.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['video-connections'] });
      return;
    }
    setMessage({ kind: 'error', text: FAILURES[outcome.result] ?? FAILURES.unavailable! });
  }

  if (connections.isPending) return <p role="status">Carregando…</p>;
  if (connections.error instanceof ForbiddenError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Vídeo</h1>
        <p role="alert">Só o administrador pode gerir as conexões de vídeo.</p>
      </>
    );
  }
  if (connections.isError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Vídeo</h1>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar as conexões agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void connections.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }

  const known = new Map((availability.data?.providers ?? []).map((item) => [item.provider, item]));
  const options = VIDEO_PROVIDERS.filter((value) => known.get(value)?.selectable ?? true);
  const provider = options.includes(chosenProvider)
    ? chosenProvider
    : (options[0] ?? chosenProvider);
  const unverified = (value: VideoProvider) => known.get(value)?.verified === false;
  const needsSecret = secretRequired(provider);

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Vídeo</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        As contas de provedor de vídeo do cliente. O segredo de cada conta é guardado cifrado e
        nunca volta para esta tela. Cada mudança pede a confirmação da sua identidade e fica na
        auditoria.
      </p>

      {needsReauth ? <ReauthPanel action={needsReauth} /> : null}
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

      <section aria-labelledby="conexoes-titulo" className="mb-12 grid gap-4">
        <h2 id="conexoes-titulo" className="text-xl font-semibold">
          Conexões
        </h2>
        {connections.data.length === 0 ? (
          <p className="text-[var(--text-muted)]">Nenhuma conexão cadastrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <caption className="sr-only">Conexões com provedores de vídeo</caption>
              <thead>
                <tr>
                  {['Conta', 'Provedor', 'Situação', 'Segredo', 'Ações'].map((header) => (
                    <th key={header} scope="col" className="border-b p-2 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {connections.data.map((connection) => (
                  <tr key={connection.id}>
                    <th scope="row" className="border-b p-2 font-normal">
                      {connection.label}
                    </th>
                    <td className="border-b p-2">{VIDEO_PROVIDER_LABELS[connection.provider]}</td>
                    <td className="border-b p-2">
                      {connection.status === 'active' ? 'Ativa' : 'Desativada'}
                    </td>
                    <td className="border-b p-2">
                      {connection.configured
                        ? `configurado (chave v${connection.keyVersion})`
                        : 'sem credenciais'}
                    </td>
                    <td className="grid gap-2 border-b p-2">
                      <RotateSecret
                        connection={connection}
                        busy={busy}
                        onRotate={(id, value) =>
                          run(
                            () => rotateVideoSecret(id, value),
                            'Segredo trocado.',
                            'trocar o segredo',
                          )
                        }
                      />
                      <ConfirmButton
                        label={connection.status === 'active' ? 'Desativar' : 'Reativar'}
                        confirmLabel={
                          connection.status === 'active'
                            ? 'Confirmar: desativar'
                            : 'Confirmar: reativar'
                        }
                        disabled={busy}
                        onConfirm={() =>
                          void run(
                            () =>
                              setVideoConnectionEnabled(
                                connection.id,
                                connection.status !== 'active',
                              ),
                            connection.status === 'active'
                              ? 'Conexão desativada.'
                              : 'Conexão reativada.',
                            'mudar a situação da conexão',
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void onRekey()}>
            Recifrar com a chave atual
          </Button>
          <p className="mt-2 max-w-prose text-sm text-[var(--text-muted)]">
            Use depois de acrescentar uma nova versão da chave mestra ao ambiente: leva todos os
            segredos para a chave atual, sem tirar nada do ar.
          </p>
        </div>
      </section>

      <section aria-labelledby="nova-titulo" className="mb-12 grid max-w-xl gap-4">
        <h2 id="nova-titulo" className="text-xl font-semibold">
          Nova conexão
        </h2>
        <form onSubmit={onCreate} noValidate className="grid gap-5">
          <label className="grid gap-1.5">
            <span className="font-medium text-[var(--field-label)]">Provedor</span>
            <select
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value as VideoProvider)}
              className="min-h-11 rounded-lg border border-[var(--border-control)] bg-[var(--surface)] px-3"
            >
              {options.map((value) => (
                <option key={value} value={value}>
                  {VIDEO_PROVIDER_LABELS[value]}
                  {unverified(value) ? ' (não verificado)' : ''}
                </option>
              ))}
            </select>
          </label>
          {options.length === 0 ? (
            <p role="alert" className="font-medium text-[var(--text-danger)]">
              Nenhum provedor foi ativado neste ambiente: cada um só é liberado depois do teste com
              conta real.
            </p>
          ) : options.some(unverified) ? (
            <p className="text-sm text-[var(--text-muted)]">
              Provedores "não verificados" ainda não passaram no teste com conta real: use só para
              testar. Em produção só aparecem os verificados.
            </p>
          ) : null}
          <TextField
            label="Nome da conta"
            name="label"
            autoComplete="off"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <TextField
            label={needsSecret ? 'Segredo da conta' : 'Segredo da conta (opcional)'}
            name="secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            description={
              needsSecret
                ? 'Obrigatório para este provedor. Só é enviado agora e nunca mais é mostrado.'
                : 'Este provedor funciona sem credenciais para vídeos públicos.'
            }
          />
          <div>
            <Button type="submit" disabled={busy || options.length === 0 || label.trim() === ''}>
              Cadastrar conexão
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
