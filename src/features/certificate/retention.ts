/**
 * Retenção do PDF de certificado REVOGADO (M7-05), parte pura. O prazo é decisão JURÍDICA (parecer do advogado do cliente), não do
 * desenvolvedor: a variável `REVOKED_PDF_RETENTION_DAYS` só liga a purga quando alguém a preenche. Ausente, vazia ou inválida = purga
 * DESLIGADA (fecha por padrão: nunca se apaga nada por um valor que não se entende). Valor proposto: 90 dias.
 */

/** O que fica no lugar do nome da pessoa no snapshot depois da purga. O gatilho do banco confere exatamente este valor. */
export const SCRUBBED_HOLDER_NAME = '[removido]';

/** Quantos certificados uma execução do Cron purga (o resto fica para o ciclo seguinte). */
export const PURGE_BATCH_LIMIT = 20;

export const MAX_RETENTION_DAYS = 3650;

/** Dias de retenção, ou `null` = purga desligada. Só aceita inteiro de 1 a 3650 (nada de "90 dias", "0" ou "-5"). */
export function parseRetentionDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^[0-9]{1,4}$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  return days >= 1 && days <= MAX_RETENTION_DAYS ? days : null;
}

/** Valor preenchido e que não vale: o Cron avisa (alerta) em vez de assumir um prazo. */
export function isRetentionMisconfigured(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== '' && parseRetentionDays(raw) === null;
}

/** Onde fica, no R2 privado, o registro durável da eliminação (um objeto por certificado; refazer sobrescreve o mesmo). */
export const purgeLogKey = (certificateId: string) => `purge-log/revoked-pdf/${certificateId}.json`;

/** O registro durável FORA do banco: sem nome, e-mail nem código em claro (só o hash do código), reexecutável depois de restaurar um dump. */
export interface PurgeLogEntry {
  certificateId: string;
  /** SHA-256 hexadecimal do código público. */
  codeSha256: string;
  /** SHA-256 do PDF eliminado (o mesmo que o tombstone guarda). */
  pdfSha256: string;
  revokedAt: string;
  purgedAt: string;
  retentionDays: number;
  /** A chave do objeto que foi apagado. */
  objectKey: string;
}
