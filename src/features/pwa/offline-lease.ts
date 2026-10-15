import { z } from 'zod';

/**
 * Lease do acesso offline (M8-02), puro: sem banco, relógio nem navegador. O servidor DECIDE o lease (`computeLeaseUntil`); o
 * cliente só o consulta (`evaluateOfflineLease`) antes de mostrar o que guardou. Offline NÃO é DRM: o relógio do aparelho é da
 * pessoa; o limite do lease e a trava de relógio só dificultam o uso indevido, não o impedem.
 */

/** O lease dura no máximo 72 h desde a última verificação online. */
export const OFFLINE_LEASE_MS = 72 * 60 * 60 * 1000;

/** Quanto o relógio pode andar PARA TRÁS entre dois usos sem ser tratado como adulterado (ajuste automático de hora). */
export const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/** `leaseUntil = min(expiração do direito, agora do servidor + 72 h)`. */
export function computeLeaseUntil(accessExpiresAt: Date, serverNow: Date): Date {
  return new Date(Math.min(accessExpiresAt.getTime(), serverNow.getTime() + OFFLINE_LEASE_MS));
}

/** Resposta de `POST /api/offline/lease`: um lease por curso em que a pessoa TEM acesso agora. */
export interface OfflineLeaseDto {
  serverNow: string;
  courses: { courseId: string; leaseUntil: string }[];
}

export const offlineLeaseSchema = z.object({
  serverNow: z.iso.datetime(),
  courses: z.array(z.object({ courseId: z.uuid(), leaseUntil: z.iso.datetime() })).max(200),
});

export type LeaseStatus =
  | { status: 'valid'; remainingMs: number }
  | { status: 'expired' }
  /** O relógio do aparelho voltou além da tolerância: vale como expirado até verificar de novo online. */
  | { status: 'clock_suspect' }
  | { status: 'none' };

/**
 * Posso mostrar o conteúdo guardado deste curso AGORA? `leaseUntil` e `maxSeenClock` são epoch ms (`null` = não há). Relógio
 * atrás do maior instante já visto (além da tolerância) bloqueia, mesmo com lease aparentemente em dia.
 */
export function evaluateOfflineLease(input: {
  leaseUntil: number | null;
  now: number;
  maxSeenClock: number | null;
}): LeaseStatus {
  if (input.leaseUntil === null) return { status: 'none' };
  if (input.maxSeenClock !== null && input.now < input.maxSeenClock - CLOCK_TOLERANCE_MS) {
    return { status: 'clock_suspect' };
  }
  if (input.now >= input.leaseUntil) return { status: 'expired' };
  return { status: 'valid', remainingMs: input.leaseUntil - input.now };
}

/** O maior instante já visto: só sobe. */
export function advanceClock(maxSeenClock: number | null, now: number): number {
  return maxSeenClock === null ? now : Math.max(maxSeenClock, now);
}

/**
 * O fim do lease, em epoch ms do RELÓGIO DO APARELHO. O servidor entrega o fim em hora dele (`leaseUntil`) e a hora dele
 * (`serverNow`); a diferença para o relógio do aparelho no momento da verificação é descontada, então um aparelho com a hora
 * errada na verificação não ganha (nem perde) horas de lease.
 */
export function leaseUntilOnDeviceClock(input: {
  leaseUntil: string;
  serverNow: string;
  deviceNow: number;
}): number {
  const offset = Date.parse(input.serverNow) - input.deviceNow;
  return Date.parse(input.leaseUntil) - offset;
}
