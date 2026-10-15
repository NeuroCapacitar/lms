import { useSyncExternalStore } from 'react';

/**
 * "Saí da conta sem rede" (M8-05): o aparelho já foi limpo, mas a sessão só será revogada no servidor quando a rede voltar. É um estado
 * da SESSÃO DA ABA (não da tela): vive aqui, fora dos componentes, porque a limpeza derruba as consultas e a tela da conta remonta.
 */
let pending = false;
const listeners = new Set<() => void>();

export function markSignedOutPending() {
  pending = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSignedOutPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => false,
  );
}
