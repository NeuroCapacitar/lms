import { Workbox } from 'workbox-window';

import { emitPwaEvent } from './events';

/**
 * Registro do Service Worker (M8-01). Só em build de produção e em navegador com suporte. O SW novo fica `waiting`:
 * o app AVISA (`update-available`) e só `applyUpdate()`, chamado numa fronteira segura, o ativa e recarrega. Nunca
 * `skipWaiting` automático. Se o registro falhar, o app segue funcionando online (o PWA é um acréscimo).
 */
let workbox: Workbox | undefined;
let waitingSeen = false;
let applying = false;

function offer() {
  waitingSeen = true;
  emitPwaEvent('update-available');
}

export function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  workbox = new Workbox('/sw.js');
  // O SW novo assumiu A PEDIDO do app: recarrega UMA vez para o shell novo. Nunca recarrega por conta própria.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) window.location.reload();
  });
  workbox.addEventListener('activated', (event) => {
    if (!event.isUpdate) emitPwaEvent('offline-ready');
  });
  void workbox
    .register()
    .then((registration) => registration && watchForNewVersion(registration))
    .catch(() => undefined);
}

/**
 * Há uma versão mais nova esperando? Observa o registro direto (e não só os eventos do Workbox): vale para o SW
 * novo deste endereço e para qualquer outro que fique `waiting` atrás do que controla a página. Sem controlador
 * (primeira instalação) não há "atualização": nada a oferecer.
 */
function watchForNewVersion(registration: ServiceWorkerRegistration) {
  if (registration.waiting && navigator.serviceWorker.controller) offer();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) offer();
    });
  });
}

/** Há um SW novo esperando? (o aviso pode montar depois do evento). */
export function updateWaiting(): boolean {
  return waitingSeen;
}

/** Ativa o SW novo e recarrega. Chame SÓ numa fronteira segura. Sem SW esperando, só recarrega. */
export function applyUpdate() {
  if (workbox && waitingSeen) {
    applying = true;
    workbox.messageSkipWaiting();
    return;
  }
  window.location.reload();
}
