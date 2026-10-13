import type { VideoAdapter } from './adapter';
import { createFakeAdapter } from './fake-adapter';

/**
 * Os adapters disponíveis NESTA build, por provider. Os seis reais entram nas tarefas M5-08 a M5-13, cada um
 * só depois do teste de contrato com conta real (M5-03). Hoje só o FALSO, e só com `VITE_FAKE_VIDEO=1`.
 * Provider sem adapter: o player mostra "ainda não disponível" (nunca monta um iframe às cegas).
 */
const adapters = new Map<string, VideoAdapter>();

if (import.meta.env.VITE_FAKE_VIDEO === '1') {
  const fake = createFakeAdapter();
  adapters.set(fake.provider, fake);
  // Variante que NÃO declara `ended` confiável: sem autoavanço, com o botão manual de próxima aula.
  const withoutEnded = createFakeAdapter({ provider: 'fake-no-ended', reportsEnded: false });
  adapters.set(withoutEnded.provider, withoutEnded);
}

export function getVideoAdapter(provider: string): VideoAdapter | undefined {
  return adapters.get(provider);
}
