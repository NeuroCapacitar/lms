import type { PublicCertificateDto } from '../../features/certificate/public';

/** `not_found` cobre código malformado, inexistente e certificado que ainda não foi emitido: uma resposta só. */
export type PublicCertificateResult =
  | { kind: 'found'; dto: PublicCertificateDto }
  | { kind: 'not_found' }
  | { kind: 'limited' };

/**
 * Validação pública do certificado (M7-08): `GET /api/public/certificates/:code`, sem sessão. Qualquer falha que não
 * seja 404 ou 429 vira erro de carregamento (a tela pede para tentar de novo).
 */
export async function fetchPublicCertificate(code: string): Promise<PublicCertificateResult> {
  const response = await fetch(`/api/public/certificates/${encodeURIComponent(code)}`, {
    credentials: 'same-origin',
  });
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 429) return { kind: 'limited' };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { kind: 'found', dto: (await response.json()) as PublicCertificateDto };
}
