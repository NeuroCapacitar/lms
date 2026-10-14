import type {
  IssuerDto,
  IssuerInput,
  SignatoryDto,
  SignatoryInput,
} from '../../features/certificate/issuer';
import { sendAction } from './action';
import { getJson } from './staff';

/**
 * Clientes do emitente e do signatário do certificado (M7-06). A interface só mostra e envia; quem decide permissão,
 * CNPJ válido e se a assinatura é do propósito certo é o servidor.
 */
export const fetchIssuer = async () =>
  (await getJson<{ issuer: IssuerDto | null }>('/api/staff/certificate/issuer')).issuer;

export const saveIssuer = (input: IssuerInput) =>
  sendAction<{ issuer: IssuerDto }>('PUT', '/api/staff/certificate/issuer', input);

export const fetchSignatory = async (courseId: string) =>
  (
    await getJson<{ signatory: SignatoryDto | null }>(
      `/api/staff/courses/${courseId}/certificate/signatory`,
    )
  ).signatory;

export const saveSignatory = (courseId: string, input: SignatoryInput) =>
  sendAction<{ signatory: SignatoryDto }>(
    'PUT',
    `/api/staff/courses/${courseId}/certificate/signatory`,
    input,
  );

/** A assinatura só sai por esta rota autorizada (Admin); nunca existe URL pública dela. */
export const signatureSrc = (mediaId: string) => `/api/media/${mediaId}/content`;
