import { z } from 'zod';

export const LEGAL_KINDS = ['terms', 'privacy'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

/** Uma versão de documento legal como a interface a recebe (o texto é do advogado do cliente). */
export interface LegalDocumentDto {
  id: string;
  kind: LegalKind;
  version: string;
  body: string;
  effectiveFrom: string;
}

/** Estado de aceite da pessoa: `accepted` é verdadeiro quando não há versão pendente. */
export interface LegalStatusDto {
  accepted: boolean;
  documents: LegalDocumentDto[];
}

/**
 * Corpo de `POST /api/me/legal/accept`. A pessoa envia os IDs das versões que VIU e a declaração de
 * ter 18 anos ou mais (obrigatória: `false` é recusado). Se uma versão nova foi publicada nesse meio
 * tempo, o servidor recusa (409) para ninguém aceitar o que não leu.
 */
export const acceptLegalSchema = z.strictObject({
  adultDeclaration: z.literal(true),
  documentVersionIds: z.array(z.uuid()).min(1).max(LEGAL_KINDS.length),
});
