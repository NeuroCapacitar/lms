import { useState } from 'react';

import { requestReauth, type RequestReauthResult } from '../api/auth';
import { Button } from './ui/button';

const MESSAGES: Record<RequestReauthResult, string> = {
  sent: 'Enviamos um link de confirmação para o seu e-mail. Abra-o neste navegador, volte aqui e repita a ação.',
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  rate_limited: 'Muitos pedidos. Aguarde alguns minutos e tente de novo.',
  unavailable: 'Não foi possível enviar agora. Tente novamente em instantes.',
};

/**
 * Painel "confirme a sua identidade" (M1-05): aparece quando o servidor responde `reauth_required`.
 * Envia o link de reautenticação para o e-mail da própria sessão; a pessoa o abre neste navegador,
 * volta e repete a ação.
 */
export function ReauthPanel({ action }: { action: string }) {
  const [result, setResult] = useState<RequestReauthResult | undefined>();
  return (
    <div role="alert" className="mb-8 grid max-w-prose gap-3 rounded-lg border p-4">
      <p className="font-medium">Para {action}, confirme primeiro a sua identidade.</p>
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void requestReauth().then(setResult)}
        >
          Enviar link de confirmação
        </Button>
      </div>
      {result ? (
        <p role="status" className="text-[var(--text-muted)]">
          {MESSAGES[result]}
        </p>
      ) : null}
    </div>
  );
}
