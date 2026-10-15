import { useEffect, useState } from 'react';

import { Button } from '../components/ui/button';
import { onPwaEvent } from './events';
import { applyUpdate, updateWaiting } from './register';
import { useBusyReasons } from './safe-boundary';

/**
 * Aviso de nova versão (M8-01). `update-available`: há um Service Worker novo esperando; o botão só aplica numa
 * FRONTEIRA SEGURA (sem vídeo tocando, quiz em andamento, formulário sujo nem sincronização); ocupado, fica
 * desabilitado e diz por quê. `client-outdated`: a API recusou este app (época antiga) e pede recarga. Nada recarrega
 * sozinho.
 */
export function UpdateBanner() {
  const [available, setAvailable] = useState(updateWaiting());
  const [outdated, setOutdated] = useState(false);
  const reasons = useBusyReasons();

  useEffect(() => {
    const offAvailable = onPwaEvent('update-available', () => setAvailable(true));
    const offOutdated = onPwaEvent('client-outdated', () => setOutdated(true));
    return () => {
      offAvailable();
      offOutdated();
    };
  }, []);

  if (!available && !outdated) return null;
  const busy = reasons.length > 0;
  return (
    <div className="border-b bg-[var(--surface-raised)] px-4 py-3">
      {outdated ? (
        <p role="alert" className="font-medium">
          Esta versão do app ficou desatualizada e não consegue mais falar com o servidor.
        </p>
      ) : (
        <p role="status" className="font-medium">
          Há uma nova versão do app disponível.
        </p>
      )}
      {busy ? (
        <p className="text-sm text-[var(--text-muted)]">
          Termine o que está fazendo ({reasons.join(', ')}) para atualizar sem perder nada.
        </p>
      ) : null}
      <div className="mt-2">
        <Button type="button" disabled={busy} onClick={() => applyUpdate()}>
          {outdated ? 'Recarregar agora' : 'Atualizar agora'}
        </Button>
      </div>
    </div>
  );
}
