import { z } from 'zod';

import { certificateLayoutSchema, type CertificateLayout } from './layout';

/**
 * Template do certificado por curso (M7-03), contratos puros do rascunho e da publicação. O corpo do rascunho leva o
 * layout inteiro (validado por Zod, sem campo livre), o fundo opcional (mídia privada `certificate_asset`) e a versão
 * que a tela viu (`null` = ainda não há rascunho): dois Admins no mesmo rascunho não se sobrescrevem em silêncio.
 */
export const templateDraftInputSchema = z.strictObject({
  layout: certificateLayoutSchema,
  backgroundMediaId: z.uuid().nullable(),
  expectedVersion: z.number().int().min(1).nullable(),
});
export type TemplateDraftInput = z.infer<typeof templateDraftInputSchema>;

export const templatePublishInputSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
});

export interface TemplateDto {
  id: string;
  status: 'draft' | 'published' | 'superseded';
  layout: CertificateLayout;
  backgroundMediaId: string | null;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
}

export interface TemplatesDto {
  draft: TemplateDto | null;
  published: TemplateDto | null;
}
