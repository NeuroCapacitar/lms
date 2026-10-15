import { useState } from 'react';

import { REJECTION_MESSAGES } from '../../features/pwa/offline-sync';
import { Button } from '../components/ui/button';
import { offline } from './runtime';
import { useOutboxSummary } from './use-outbox';

/**
 * Pendências do outbox offline (M8-03), à vista em qualquer tela: quantas conclusões aguardam envio e, se o servidor RECUSOU
 * alguma (aula removida, acesso que terminou...), o motivo, até a pessoa dispensar. Nada é descartado em silêncio.
 */
export function OutboxStatus() {
  const { pending, rejected } = useOutboxSummary();
  const [sending, setSending] = useState(false);
  if (pending.length === 0 && rejected.length === 0) return null;

  async function sendNow() {
    setSending(true);
    await offline.refreshInBackground();
    setSending(false);
  }

  return (
    <div className="grid gap-3 border-b bg-[var(--surface-raised)] px-4 py-3">
      {pending.length > 0 ? (
        <div className="grid gap-2">
          <p role="status" className="font-medium">
            {pending.length === 1
              ? '1 conclusão de aula aguardando envio.'
              : `${pending.length} conclusões de aula aguardando envio.`}{' '}
            <span className="font-normal text-[var(--text-muted)]">
              Elas são enviadas quando houver conexão.
            </span>
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={sending}
              onClick={() => void sendNow()}
            >
              {sending ? 'Enviando…' : 'Enviar agora'}
            </Button>
          </div>
        </div>
      ) : null}
      {rejected.map((item) => (
        <div key={item.clientOperationId} role="alert" className="grid gap-2">
          <p className="font-medium">
            A conclusão da aula “{item.lessonTitle}” não foi aceita.{' '}
            <span className="font-normal">
              {REJECTION_MESSAGES[item.reason ?? 'invalid_payload']}
            </span>
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void offline.dismissRejected(item.clientOperationId)}
            >
              Entendi
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
