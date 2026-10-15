import type { OfflineInfo } from '../api/learning';

const FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Faixa de "sem conexão" (M8-02): deixa claro que o que se vê é uma CÓPIA guardada no aparelho, de quando, e até quando o
 * estudo offline deste curso vale. O servidor segue sendo a fonte; ao voltar a rede a tela recarrega sozinha.
 */
export function OfflineNotice({ info }: { info: OfflineInfo }) {
  return (
    <p role="status" className="mb-4 max-w-prose rounded-lg border p-3 font-medium">
      Você está sem conexão. Esta é a cópia guardada em {FORMAT.format(info.savedAt)}. O estudo
      offline deste curso vale até {FORMAT.format(info.leaseUntil)}.
    </p>
  );
}
