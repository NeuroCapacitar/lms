import { z } from 'zod';

/**
 * Interesse em cursos ainda não abertos (M5-06). Puro: sem rede nem banco. A pessoa autenticada pede para ser
 * avisada; recebe UM e-mail a cada abertura de vendas (um por interesse e ciclo) até retirar o interesse ou ter
 * o direito efetivo. Aviso solicitado não exige consentimento de marketing; leads externos nunca viram interesse.
 */
export const registerInterestSchema = z.strictObject({ courseId: z.uuid() });

export type InterestStatus = 'active' | 'withdrawn' | 'converted';

/** Quantos interessados cada execução do fan-out processa (o resto continua em outra execução, sem falhar). */
export const FANOUT_BATCH_SIZE = 50;
/** Espera entre lotes do fan-out (segundos), para não ocupar a fila nem estourar a cota do e-mail. */
export const FANOUT_DEFER_SECONDS = 5;

export type CycleAction = 'open' | 'close' | 'none';

/**
 * O que fazer com o ciclo depois de um comando que pode mudar a disponibilidade: abre ao passar de não
 * adquirível para adquirível, fecha na volta, e não faz nada quando nada mudou (acrescentar oferta a curso já
 * adquirível, por exemplo, não cria ciclo).
 */
export function cycleAction(acquirableNow: boolean, hasOpenCycle: boolean): CycleAction {
  if (acquirableNow && !hasOpenCycle) return 'open';
  if (!acquirableNow && hasOpenCycle) return 'close';
  return 'none';
}

/** Os interesses DA PESSOA, como a conta os mostra. */
export interface MyInterestDto {
  courseId: string;
  slug: string;
  title: string;
  status: InterestStatus;
}

/** Contagens para a Staff: nunca a lista de pessoas nem e-mails. */
export interface InterestStatsDto {
  active: number;
  withdrawn: number;
  converted: number;
  cycles: { number: number; openedAt: string; closedAt: string | null; notified: number }[];
}
