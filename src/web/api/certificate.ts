import type {
  IssuerDto,
  IssuerInput,
  SignatoryDto,
  SignatoryInput,
} from '../../features/certificate/issuer';
import type {
  TemplateDraftInput,
  TemplateDto,
  TemplatesDto,
} from '../../features/certificate/template';
import { postAction, sendAction } from './action';
import { getJson } from './staff';

/**
 * Clientes do emitente, do signatário e do template do certificado (M7-06 e M7-03). A interface só mostra e envia;
 * quem decide permissão, CNPJ válido, layout publicável e se a imagem é do propósito certo é o servidor.
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

/** A imagem privada (assinatura, fundo) só sai por esta rota autorizada (Admin); nunca existe URL pública dela. */
export const signatureSrc = (mediaId: string) => `/api/media/${mediaId}/content`;

export const fetchTemplates = (courseId: string) =>
  getJson<TemplatesDto>(`/api/staff/courses/${courseId}/certificate/template`);

export const saveTemplateDraft = (courseId: string, input: TemplateDraftInput) =>
  sendAction<{ draft: TemplateDto }>(
    'PUT',
    `/api/staff/courses/${courseId}/certificate/template`,
    input,
  );

export const publishTemplate = (courseId: string, expectedVersion: number) =>
  postAction<{ published: TemplateDto }>(
    `/api/staff/courses/${courseId}/certificate/template/publish`,
    { expectedVersion },
  );

export const discardTemplateDraft = (courseId: string) =>
  postAction<{ discarded: boolean }>(
    `/api/staff/courses/${courseId}/certificate/template/discard`,
    {},
  );
