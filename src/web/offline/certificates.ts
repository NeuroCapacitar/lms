import type { MyCertificateDto } from '../../features/certificate/lifecycle';
import { fetchMyCertificates } from '../api/certificate-lifecycle';
import { offline } from './runtime';
import { isNetworkFailure } from './study';

/** Os certificados da pessoa. `offline`: a lista veio da CÓPIA guardada (sem rede), com o instante da última verificação. */
export interface CertificatesView {
  items: MyCertificateDto[];
  offline?: { verifiedAt: number; pdfIds: string[] };
}

/**
 * "Meus certificados" (M8-06). Online: o servidor decide e a lista é guardada para depois (com a hora desta verificação; o que
 * saiu dela ou deixou de estar pronto perde o PDF guardado). Sem rede: mostra a cópia guardada, SEMPRE com "verificado em" (nunca
 * diz "válido" sem a data). Resposta do servidor (inclusive sem sessão) nunca é trocada pela cópia.
 */
export async function loadMyCertificates(): Promise<CertificatesView> {
  try {
    const items = await fetchMyCertificates();
    void offline.rememberCertificates(items);
    return { items };
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    const read = await offline.readCertificates();
    if (read.kind === 'ok') {
      return { items: read.items, offline: { verifiedAt: read.verifiedAt, pdfIds: read.pdfIds } };
    }
    throw error;
  }
}
