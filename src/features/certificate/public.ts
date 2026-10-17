import { z } from 'zod';

import { canonicalOrigin, type PageMeta } from '../catalog/course-meta';
import { CERTIFICATE_CODE_PATTERN, type CertificateStatus } from './certificate';
import { SCRUBBED_HOLDER_NAME } from './retention';

/**
 * Validação PÚBLICA do certificado (M7-08), parte pura. Quem tem o código vê SÓ o estado, o curso, a carga horária, a
 * data de emissão e o emitente. Nunca CPF, e-mail, pagamento, motivo interno, caminho ou link do PDF. O nome do titular
 * depende de decisão pendente do responsável: `PUBLIC_NAME_MODE` (padrão `none`, o mais privado).
 */
export type PublicNameMode = 'none' | 'masked' | 'full';

/** DECISÃO PENDENTE (M7-07/M7-08): sem nome na página pública até o responsável escolher. */
export const PUBLIC_NAME_MODE: PublicNameMode = 'none';

export type PublicCertificateState = 'valid' | 'revoked' | 'superseded';

export interface PublicCertificateDto {
  state: PublicCertificateState;
  courseTitle: string;
  workloadHours: number | null;
  /** Data de emissão (ISO, só o dia importa). */
  issuedAt: string;
  issuerName: string;
  /** SÓ existe quando o modo não é `none`. */
  holderName?: string;
}

/** O que a validação aceita no caminho: o código novo (22 caracteres) ou o legado `PRT-…` (importado no M10-08). */
const LEGACY_CODE = /^PRT-[A-Za-z0-9-]{4,40}$/;
export const publicCodeSchema = z
  .string()
  .refine((value) => CERTIFICATE_CODE_PATTERN.test(value) || LEGACY_CODE.test(value));

/** Só os estados "emitidos" aparecem; fila, geração, falha e aguardando nome são como se não existissem. */
export function publicStateOf(status: CertificateStatus): PublicCertificateState | null {
  if (status === 'ready') return 'valid';
  if (status === 'revoked') return 'revoked';
  if (status === 'superseded') return 'superseded';
  return null;
}

/** "Maria Aparecida de Souza" → "Maria A. S." (a primeira palavra inteira, as demais só a inicial). */
export function maskName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const [first, ...rest] = words;
  const initials = rest
    .filter((word) => word.length > 3 || /^[A-ZÀ-Ý]/.test(word))
    .filter((word) => !['da', 'de', 'do', 'das', 'dos', 'e'].includes(word.toLowerCase()))
    .map((word) => `${[...word][0]!.toUpperCase()}.`);
  return [first, ...initials].join(' ');
}

export function toPublicDto(
  input: {
    status: CertificateStatus;
    courseTitle: string;
    workloadHours: number | null;
    issuedAt: Date;
    issuerName: string;
    holderName: string;
  },
  mode: PublicNameMode = PUBLIC_NAME_MODE,
): PublicCertificateDto | null {
  const state = publicStateOf(input.status);
  if (!state) return null;
  const dto: PublicCertificateDto = {
    state,
    courseTitle: input.courseTitle,
    workloadHours: input.workloadHours,
    issuedAt: input.issuedAt.toISOString(),
    issuerName: input.issuerName,
  };
  // Nome já eliminado pela retenção (M7-05): nunca aparece, qualquer que seja o modo.
  if (input.holderName !== SCRUBBED_HOLDER_NAME) {
    if (mode === 'full') dto.holderName = input.holderName;
    if (mode === 'masked') dto.holderName = maskName(input.holderName);
  }
  return dto;
}

const STATE_TEXT: Record<PublicCertificateState, string> = {
  valid: 'Certificado válido',
  revoked: 'Certificado revogado',
  superseded: 'Certificado substituído',
};

/**
 * Meta tags da página (Open Graph), respeitando o modo do nome. Sempre `noindex`. Código inexistente: meta genérica,
 * a MESMA de qualquer outro código desconhecido. A canônica nunca ecoa o código recebido.
 */
export function certificateMeta(
  baseUrl: string,
  dto: PublicCertificateDto | null,
  code: string | null,
): PageMeta {
  const origin = canonicalOrigin(baseUrl);
  if (!dto || !code) {
    return {
      title: 'Validação de certificado | NeuroCapacitar',
      description: 'Confira a validade de um certificado emitido pela NeuroCapacitar.',
      canonical: `${origin}/`,
      image: `${origin}/og-default.png`,
      noindex: true,
    };
  }
  const who = dto.holderName ? `${dto.holderName}: ` : '';
  return {
    title: `${STATE_TEXT[dto.state]} | NeuroCapacitar`,
    description: `${who}certificado de conclusão do curso ${dto.courseTitle}, emitido por ${dto.issuerName}.`,
    canonical: `${origin}/certificados/${code}`,
    image: `${origin}/og-default.png`,
    noindex: true,
  };
}
