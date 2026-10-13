import type { VideoAdapter } from './adapter';
import { REAL_ADAPTERS } from './adapters';
import { createFakeAdapter } from './fake-adapter';

/**
 * Os adapters disponíveis NESTA build, por provider: os reais de `adapters.ts` (cada um só depois do teste de
 * contrato do M5-03 e da trava de ativação) e, só com `VITE_FAKE_VIDEO=1`, o FALSO. Provider sem adapter: o
 * player mostra "ainda não disponível" (nunca monta um iframe às cegas).
 */
const adapters = new Map<string, VideoAdapter>();

for (const [provider, create] of Object.entries(REAL_ADAPTERS)) {
  adapters.set(provider, create());
}

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
