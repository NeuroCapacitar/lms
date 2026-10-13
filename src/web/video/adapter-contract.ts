import { isAllowedEmbed, type PlayerEvent, type VideoAdapter } from './adapter';

/**
 * Suíte de contrato do adapter de vídeo do CLIENTE (M5-03). Cada adapter (M5-08 a M5-13) a roda com
 * fixtures gravadas, OFFLINE; ela não substitui o checklist com conta real (docs/operations/video-provider-checklist.md),
 * só garante o que dá para provar sem rede. Devolve a lista de VIOLAÇÕES (vazia = conforme), para que o teste
 * da própria suíte prove que ela reprova adapters desonestos.
 */
export interface ClientContractFixtures {
  /** Um ID externo válido do provider. */
  externalId: string;
  /** Mensagens gravadas do iframe e o evento normalizado esperado (`undefined` = ignorar). */
  messages: { data: unknown; expect: PlayerEvent | undefined }[];
  /** Origem do Hub, para adapters cujo embed é do próprio Hub (`allowedHosts: ['self']`). */
  selfOrigin?: string;
  /** Conteúdo de `public/_headers`: todo host do adapter precisa estar em `frame-src`. */
  headers?: string;
}

const HOSTILE_IDS = [
  '../../x',
  'a/b',
  'a?b=1',
  'a#b',
  '//evil.example/x',
  'https://evil.example/x',
  '"><script>alert(1)</script>',
  'a b',
  'a\nb',
];

const GARBAGE: unknown[] = [
  undefined,
  null,
  'texto',
  42,
  [],
  {},
  { type: 'ended' },
  { type: 'timeupdate', t: Number.NaN },
  { type: 'timeupdate', t: 'x' },
  { type: 'durationchange', duration: Number.POSITIVE_INFINITY },
  { source: { toString: 1 }, type: {} },
];

const message = (data: unknown) => ({ data }) as MessageEvent;

function frameSources(headers: string): string[] {
  return [...headers.matchAll(/frame-src\s+([^;\n]+)/g)].flatMap((match) =>
    match[1]!.trim().split(/\s+/),
  );
}

function originOf(src: string, selfOrigin: string | undefined): string | undefined {
  if (src.startsWith('/')) return selfOrigin;
  try {
    return new URL(src).origin;
  } catch {
    return undefined;
  }
}

export function checkClientAdapterContract(
  adapter: VideoAdapter,
  fixtures: ClientContractFixtures,
): string[] {
  const problems: string[] = [];
  const fail = (text: string) => problems.push(`${adapter.provider}: ${text}`);
  const { capabilities } = adapter;

  // 1) allowlist de hosts: nomes simples, sem curinga, esquema, caminho nem porta.
  if (adapter.allowedHosts.length === 0) fail('allowedHosts vazio');
  for (const host of adapter.allowedHosts) {
    if (host !== 'self' && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) {
      fail(`host fora do formato (nome simples, minúsculo, sem curinga/esquema/caminho): ${host}`);
    }
  }

  // 2) o embed sai SÓ de buildEmbed, com host da allowlist, e a origem das mensagens bate com o src.
  const good = adapter.buildEmbed({ externalId: fixtures.externalId, startAt: 0 });
  if (!isAllowedEmbed(good.src, adapter.allowedHosts)) fail(`embed fora da allowlist: ${good.src}`);
  const srcOrigin = originOf(good.src, fixtures.selfOrigin);
  if (srcOrigin === undefined) fail('origem do embed indeterminável (informe selfOrigin)');
  else if (good.origin !== srcOrigin) {
    fail(`embed.origin (${good.origin}) diferente da origem do src (${srcOrigin})`);
  }

  // 3) ID hostil não muda o host nem escapa da allowlist (ou é recusado com erro).
  for (const hostile of HOSTILE_IDS) {
    let embed: { src: string; origin: string } | undefined;
    try {
      embed = adapter.buildEmbed({ externalId: hostile, startAt: 0 });
    } catch {
      continue;
    }
    if (!isAllowedEmbed(embed.src, adapter.allowedHosts)) {
      fail(`ID hostil escapou da allowlist: ${JSON.stringify(hostile)}`);
    } else if (originOf(embed.src, fixtures.selfOrigin) !== srcOrigin) {
      fail(`ID hostil mudou a origem do embed: ${JSON.stringify(hostile)}`);
    }
  }

  // 4) resume é honesto: só muda o embed se o provider declara retomar.
  const resumed = adapter.buildEmbed({ externalId: fixtures.externalId, startAt: 300 });
  if (capabilities.resume && resumed.src === good.src) {
    fail('declara resume, mas startAt não altera o embed');
  }
  if (!capabilities.resume && resumed.src !== good.src) {
    fail('não declara resume, mas startAt altera o embed');
  }

  // 5) lixo nunca derruba o player e nunca vira evento inválido.
  for (const data of GARBAGE) {
    let event: PlayerEvent | undefined;
    try {
      event = adapter.normalize(message(data));
    } catch {
      fail(`normalize lançou erro para ${JSON.stringify(data) ?? String(data)}`);
      continue;
    }
    if (event && 't' in event && !Number.isFinite(event.t)) fail('evento com tempo não finito');
    if (
      event?.type === 'durationchange' &&
      !(Number.isFinite(event.duration) && event.duration > 0)
    ) {
      fail('durationchange com duração inválida');
    }
  }

  // 6) as fixtures gravadas normalizam como esperado.
  const produced = new Set<PlayerEvent['type']>();
  for (const { data, expect } of fixtures.messages) {
    let event: PlayerEvent | undefined;
    try {
      event = adapter.normalize(message(data));
    } catch {
      fail(`normalize lançou erro na fixture ${JSON.stringify(data)}`);
      continue;
    }
    if (event) produced.add(event.type);
    if (JSON.stringify(event) !== JSON.stringify(expect)) {
      fail(
        `fixture ${JSON.stringify(data)}: esperava ${JSON.stringify(expect)}, veio ${JSON.stringify(event)}`,
      );
    }
  }

  // 7) capability <-> evento: declarou, tem de provar com fixture; não declarou, não pode emitir.
  const honesty: [boolean, PlayerEvent['type'], string][] = [
    [capabilities.reportsTime, 'timeupdate', 'reportsTime'],
    [capabilities.reportsEnded, 'ended', 'reportsEnded'],
    [capabilities.reportsSeek, 'seeked', 'reportsSeek'],
  ];
  for (const [declared, type, name] of honesty) {
    if (declared && !produced.has(type))
      fail(`declara ${name}, mas nenhuma fixture produz "${type}"`);
    if (!declared && produced.has(type)) fail(`não declara ${name}, mas emite "${type}"`);
  }
  if (capabilities.duration === 'player' && !produced.has('durationchange')) {
    fail('duração vem do player, mas nenhuma fixture produz "durationchange"');
  }

  // 8) todo host (menos o do próprio Hub) está em frame-src da CSP publicada.
  if (fixtures.headers !== undefined) {
    const allowed = frameSources(fixtures.headers);
    for (const host of adapter.allowedHosts) {
      if (host !== 'self' && !allowed.some((source) => source === `https://${host}`)) {
        fail(`host ${host} não está em frame-src de public/_headers`);
      }
    }
  }
  return problems;
}
