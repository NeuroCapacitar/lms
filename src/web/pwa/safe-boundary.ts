import { useEffect, useSyncExternalStore } from 'react';

/**
 * Fronteira segura de atualização (M8-01). Quem está fazendo algo que não pode ser interrompido (vídeo tocando, quiz
 * em andamento, formulário sujo, outbox sincronizando) se registra aqui com um MOTIVO; o aviso de nova versão só deixa
 * aplicar o update quando não há ninguém registrado. Nada aqui recarrega a página sozinho.
 */
let reasons: readonly string[] = [];
const listeners = new Set<() => void>();
let nextId = 0;
const active = new Map<number, string>();

function publish() {
  reasons = [...new Set(active.values())];
  for (const listener of listeners) listener();
}

/** Marca "ocupado" com um motivo; devolve a função que desmarca (idempotente). */
export function markBusy(reason: string): () => void {
  const id = (nextId += 1);
  active.set(id, reason);
  publish();
  return () => {
    if (active.delete(id)) publish();
  };
}

export function busyReasons(): readonly string[] {
  return reasons;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Os motivos de ocupação atuais (re-renderiza quando mudam). */
export function useBusyReasons(): readonly string[] {
  return useSyncExternalStore(subscribe, busyReasons, busyReasons);
}

/** Enquanto `isBusy` for verdadeiro, o componente mantém o motivo registrado. */
export function useBusy(reason: string, isBusy: boolean) {
  useEffect(() => {
    if (!isBusy) return undefined;
    return markBusy(reason);
  }, [reason, isBusy]);
}

/** Só para os testes: limpa tudo. */
export function resetBusyForTests() {
  active.clear();
  publish();
}
