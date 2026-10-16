import type { QueryClient } from '@tanstack/react-query';

import { afterSignIn } from './offline/runtime';
import { takeReturnTo } from './return-to';

/**
 * O que acontece logo depois de o link de acesso ser confirmado com sucesso (link aberto OU colado no app instalado):
 * descarta o cache de consultas (outra pessoa pode ter usado este aparelho), confere a troca de conta ANTES de qualquer tela ler
 * dado local (M8-05) e volta à página de onde a pessoa veio (caminho interno validado) ou à inicial.
 */
export async function completeSignIn(
  queryClient: QueryClient,
  goHome: () => Promise<unknown>,
): Promise<void> {
  queryClient.clear();
  const back = takeReturnTo();
  await afterSignIn();
  if (back) {
    window.location.assign(back);
    return;
  }
  await goHome();
}
