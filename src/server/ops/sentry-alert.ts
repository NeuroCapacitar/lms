import { scrubEvent } from '../../features/observability/scrub';
import type { OpsAlert } from '../../features/ops/operations';

/**
 * Envia UM alerta do Operations Center ao Sentry (M9-06, ADR 0033) pelo endpoint de envelopes, sem o SDK: o Cron
 * (`scheduled`) não passa pelo middleware do Sentry, e aqui o evento é montado À MÃO só com campos que nós
 * escolhemos: código, severidade, a mensagem fixa do alerta (contagens, nunca nome nem e-mail), ambiente e
 * versão. O agrupamento é por `fingerprint = [código]`, então o Sentry junta as repetições em UM problema.
 * Falha de rede NÃO lança: devolve `false` e o chamador tenta no próximo ciclo.
 */
export interface SentryAlertTarget {
  dsn: string;
  environment: string;
  release: string;
}

const LEVEL: Record<OpsAlert['severity'], string> = {
  P0: 'fatal',
  P1: 'error',
  P2: 'warning',
  P3: 'info',
};

interface ParsedDsn {
  key: string;
  envelopeUrl: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    if (url.protocol !== 'https:' || !url.username || !/^[0-9]+$/.test(projectId)) return null;
    return { key: url.username, envelopeUrl: `https://${url.host}/api/${projectId}/envelope/` };
  } catch {
    return null;
  }
}

function hex32(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function buildAlertEnvelope(
  alert: OpsAlert,
  target: Pick<SentryAlertTarget, 'environment' | 'release'>,
  now: Date,
): string {
  const eventId = hex32();
  const sentAt = now.toISOString();
  const event = {
    event_id: eventId,
    timestamp: Math.floor(now.getTime() / 1000),
    platform: 'javascript',
    level: LEVEL[alert.severity],
    logger: 'hub.ops.alerts',
    message: `${alert.severity} ${alert.code}: ${alert.message}`,
    fingerprint: [alert.code],
    environment: target.environment,
    release: target.release,
    tags: { severity: alert.severity, alert_code: alert.code },
    server_name: 'hub-worker',
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: sentAt }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(scrubEvent(event)),
  ].join('\n');
}

export async function sendAlertToSentry(
  alert: OpsAlert,
  target: SentryAlertTarget,
  options: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<boolean> {
  const parsed = parseDsn(target.dsn);
  if (!parsed) return false;
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(parsed.envelopeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=hub-ops/1`,
      },
      body: buildAlertEnvelope(alert, target, options.now ?? new Date()),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
