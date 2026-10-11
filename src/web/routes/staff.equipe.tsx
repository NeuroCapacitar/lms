import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { DELEGABLE_CAPABILITIES } from '../../features/identity/capabilities';
import type { InvitationStatus } from '../../features/identity/staff-invitation';
import { CAPABILITY_LABELS, type TeamMemberDto } from '../../features/identity/team';
import type { ActionResult } from '../api/action';
import {
  addGrant,
  fetchInvitations,
  fetchTeam,
  ForbiddenError,
  inviteStaff,
  reactivateAccount,
  removeSupport,
  resendInvitation,
  revokeGrant,
  revokeInvitation,
  suspendAccount,
} from '../api/staff';
import { ConfirmButton } from '../components/confirm-button';
import { ReauthPanel } from '../components/reauth-panel';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/staff/equipe')({ component: Team });

const STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: 'Pendente',
  expired: 'Vencido',
  accepted: 'Aceito',
  revoked: 'Revogado',
};

const FAILURES: Partial<Record<ActionResult, string>> = {
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  invalid: 'Confira os dados informados.',
  forbidden: 'Você não tem permissão para esta ação.',
  not_found: 'Não encontramos o item. Atualize a página.',
  conflict:
    'Não foi possível: o estado mudou ou a regra não permite (por exemplo, o último administrador).',
  rate_limited: 'Muitos pedidos hoje. Tente novamente mais tarde.',
  unavailable: 'Não foi possível concluir agora. Tente novamente em instantes.',
};

function GrantBoxes({
  legend,
  selected,
  disabled,
  onToggle,
}: {
  legend: string;
  selected: string[];
  disabled: boolean;
  onToggle: (capability: string, checked: boolean) => void;
}) {
  return (
    <fieldset className="grid gap-1" disabled={disabled}>
      <legend className="mb-1 font-medium">{legend}</legend>
      {DELEGABLE_CAPABILITIES.map((capability) => (
        <label key={capability} className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={selected.includes(capability)}
            onChange={(event) => onToggle(capability, event.target.checked)}
            className="size-5"
          />
          <span>{CAPABILITY_LABELS[capability]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Tela "Equipe" (M1-10, só Admin): convidar, reenviar e revogar convites, editar permissões de cada
 * Suporte, suspender e tirar do Suporte. Toda ação sensível pede a reautenticação recente (M1-05) e
 * é auditada pelo servidor; esta tela só pede e mostra o resultado.
 */
function Team() {
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: ['team'], queryFn: fetchTeam, retry: false });
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: fetchInvitations,
    retry: false,
    enabled: team.isSuccess,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [needsReauth, setNeedsReauth] = useState<string | undefined>();
  const [email, setEmail] = useState('');
  const [inviteGrants, setInviteGrants] = useState<string[]>([]);

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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team'] }),
        queryClient.invalidateQueries({ queryKey: ['invitations'] }),
      ]);
      return true;
    }
    setMessage({ kind: 'error', text: FAILURES[result] ?? FAILURES.unavailable! });
    return false;
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    const sent = await run(
      () => inviteStaff(email, inviteGrants),
      'Convite enviado.',
      'convidar uma pessoa',
    );
    if (sent) {
      setEmail('');
      setInviteGrants([]);
    }
  }

  if (team.isPending) return <p role="status">Carregando…</p>;
  if (team.error instanceof ForbiddenError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Equipe</h1>
        <p role="alert" className="max-w-prose">
          Você não tem permissão para gerir a equipe.
        </p>
      </>
    );
  }
  if (team.isError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Equipe</h1>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar a equipe agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void team.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }

  const note = 'A pessoa precisará entrar de novo por link de acesso para valer.';
  const person = (member: TeamMemberDto) => member.name || member.email;

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Equipe</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Convide pessoas para o Suporte e escolha o que cada uma pode fazer. Mudanças são registradas
        na auditoria e pedem a confirmação da sua identidade.
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

      <section aria-labelledby="convidar-titulo" className="mb-12 grid max-w-xl gap-4">
        <h2 id="convidar-titulo" className="text-xl font-semibold">
          Convidar para o Suporte
        </h2>
        <form onSubmit={onInvite} noValidate className="grid gap-5">
          <TextField
            label="E-mail da pessoa"
            name="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <GrantBoxes
            legend="Permissões iniciais (opcional)"
            selected={inviteGrants}
            disabled={busy}
            onToggle={(capability, checked) =>
              setInviteGrants((current) =>
                checked ? [...current, capability] : current.filter((item) => item !== capability),
              )
            }
          />
          <div>
            <Button type="submit" disabled={busy || email.trim() === ''}>
              Enviar convite
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="convites-titulo" className="mb-12 grid gap-4">
        <h2 id="convites-titulo" className="text-xl font-semibold">
          Convites
        </h2>
        {invitations.isPending ? <p role="status">Carregando…</p> : null}
        {invitations.isError ? (
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            Não foi possível carregar os convites.
          </p>
        ) : null}
        {invitations.data?.length === 0 ? <p>Nenhum convite ainda.</p> : null}
        <ul className="grid gap-3">
          {invitations.data?.map((invitation) => (
            <li key={invitation.id} className="grid gap-2 rounded-lg border p-4">
              <p>
                <strong>{invitation.email}</strong> · {STATUS_LABELS[invitation.status]}
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                {invitation.grants.length === 0
                  ? 'Sem permissões iniciais'
                  : `Permissões: ${invitation.grants.map((g) => CAPABILITY_LABELS[g as keyof typeof CAPABILITY_LABELS] ?? g).join('; ')}`}
              </p>
              {invitation.status === 'pending' || invitation.status === 'expired' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => resendInvitation(invitation.id),
                        'Convite reenviado.',
                        'reenviar o convite',
                      )
                    }
                  >
                    Reenviar convite de {invitation.email}
                  </Button>
                  <ConfirmButton
                    label={`Revogar convite de ${invitation.email}`}
                    confirmLabel="Confirmar revogação"
                    disabled={busy}
                    onConfirm={() =>
                      void run(
                        () => revokeInvitation(invitation.id),
                        'Convite revogado.',
                        'revogar o convite',
                      )
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pessoas-titulo" className="grid gap-4">
        <h2 id="pessoas-titulo" className="text-xl font-semibold">
          Pessoas da equipe
        </h2>
        {team.data.length === 0 ? <p>Nenhuma pessoa na equipe ainda.</p> : null}
        <ul className="grid gap-4">
          {team.data.map((member) => {
            const isAdmin = member.roles.includes('admin');
            const isSupport = member.roles.includes('support');
            return (
              <li key={member.id} className="grid gap-3 rounded-lg border p-4">
                <p>
                  <strong>{person(member)}</strong> ({member.email}) ·{' '}
                  {member.roles
                    .map((role) => (role === 'admin' ? 'Administrador' : 'Suporte'))
                    .join(' e ')}
                  {member.suspended ? ' · Conta suspensa' : ''}
                </p>
                {isAdmin ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    O administrador tem todas as permissões.
                  </p>
                ) : null}
                {isSupport && !isAdmin ? (
                  <GrantBoxes
                    legend={`Permissões de ${person(member)}`}
                    selected={member.grants}
                    disabled={busy}
                    onToggle={(capability, checked) =>
                      void run(
                        () =>
                          checked
                            ? addGrant(member.id, capability)
                            : revokeGrant(member.id, capability),
                        `Permissões de ${person(member)} atualizadas. ${note}`,
                        'mudar permissões',
                      )
                    }
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {member.suspended ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => reactivateAccount(member.id),
                          `Conta de ${person(member)} reativada.`,
                          'reativar a conta',
                        )
                      }
                    >
                      Reativar {person(member)}
                    </Button>
                  ) : (
                    <ConfirmButton
                      label={`Suspender ${person(member)}`}
                      confirmLabel="Confirmar suspensão"
                      disabled={busy}
                      onConfirm={() =>
                        void run(
                          () => suspendAccount(member.id),
                          `Conta de ${person(member)} suspensa.`,
                          'suspender a conta',
                        )
                      }
                    />
                  )}
                  {isSupport ? (
                    <ConfirmButton
                      label={`Tirar ${person(member)} do Suporte`}
                      confirmLabel="Confirmar remoção"
                      disabled={busy}
                      onConfirm={() =>
                        void run(
                          () => removeSupport(member.id),
                          `${person(member)} saiu do Suporte.`,
                          'tirar a pessoa do Suporte',
                        )
                      }
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
