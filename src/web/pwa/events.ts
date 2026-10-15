/**
 * Eventos do PWA entre o registro do Service Worker, o `fetch` do app e o aviso na tela (M8-01). Um barramento simples
 * sobre `EventTarget`: sem dependência e fácil de disparar nos testes.
 */
export type PwaEventName = 'update-available' | 'client-outdated' | 'offline-ready';

const bus = new EventTarget();

export function emitPwaEvent(name: PwaEventName) {
  bus.dispatchEvent(new Event(name));
}

export function onPwaEvent(name: PwaEventName, handler: () => void): () => void {
  bus.addEventListener(name, handler);
  return () => bus.removeEventListener(name, handler);
}
