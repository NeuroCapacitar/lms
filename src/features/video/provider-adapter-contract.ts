import {
  ProviderError,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderStatus,
  type ProviderTransport,
  type VideoProviderAdapter,
} from './provider-adapter';

/**
 * Suíte de contrato do adapter do SERVIDOR (M5-03), OFFLINE com fixtures gravadas: normalização de ID/URL,
 * estado do asset, falha/timeout do provider, e a regra de que só o asset `managed` é apagado. Devolve a lista
 * de VIOLAÇÕES (vazia = conforme). NÃO prova que o provider real se comporta assim: isso é o checklist com
 * conta real (docs/operations/video-provider-checklist.md); mock nunca vira "verificado".
 */
export interface ProviderContractFixtures {
  /** Entradas válidas (URL ou ID, como a Staff cola) e o ID externo esperado. */
  accepts: { input: string; externalId: string }[];
  /** Respostas gravadas do provider e o estado esperado. */
  statuses: { externalId: string; response: ProviderResponse; expect: ProviderStatus }[];
  /** Respostas que o adapter deve tratar como erro, com o código esperado. */
  errors: { externalId: string; response: ProviderResponse; code: ProviderError['code'] }[];
}

/** Valor que NUNCA pode aparecer em erro/mensagem produzidos pelo adapter. */
const CANARY = 'segredo-canario-nao-vaza-0001';

const HOSTILE_REFERENCES = [
  '',
  '   ',
  'javascript:alert(1)',
  'data:text/html,x',
  'https://evil.example/watch?v=abc123',
  'http://user:pass@evil.example/x',
  'abc\ndef',
  'abc def',
  '../../etc/passwd',
  '<script>alert(1)</script>',
  'a'.repeat(5000),
];

/** ID externo seguro para compor caminho de API e embed: sem espaço, barra, `?`, `#` nem controle. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,200}$/;

const noNetwork: ProviderTransport = () => Promise.reject(new Error(`rede indisponível ${CANARY}`));

function recording(response: ProviderResponse) {
  const calls: ProviderRequest[] = [];
  const transport: ProviderTransport = (request) => {
    calls.push(request);
    return Promise.resolve(response);
  };
  return { transport, calls };
}

async function outcome<T>(work: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  try {
    return { value: await work };
  } catch (error) {
    return { error };
  }
}

export async function checkProviderAdapterContract(
  adapter: VideoProviderAdapter,
  fixtures: ProviderContractFixtures,
): Promise<string[]> {
  const problems: string[] = [];
  const fail = (text: string) => problems.push(`${adapter.provider}: ${text}`);

  // 1) normalização: válidos viram o ID esperado (seguro); hostis são recusados.
  for (const { input, externalId } of fixtures.accepts) {
    const result = adapter.normalizeReference(input);
    if (!result.ok) fail(`recusou entrada válida ${JSON.stringify(input)}`);
    else if (result.externalId !== externalId) {
      fail(`entrada ${JSON.stringify(input)}: esperava ${externalId}, veio ${result.externalId}`);
    } else if (!SAFE_ID.test(result.externalId)) fail(`ID externo inseguro: ${result.externalId}`);
  }
  for (const input of HOSTILE_REFERENCES) {
    let result: ReturnType<VideoProviderAdapter['normalizeReference']>;
    try {
      result = adapter.normalizeReference(input);
    } catch {
      fail(`normalizeReference lançou erro para ${JSON.stringify(input.slice(0, 40))}`);
      continue;
    }
    if (result.ok) fail(`aceitou entrada hostil ${JSON.stringify(input.slice(0, 40))}`);
  }

  // 2) estado: respostas gravadas viram o estado esperado, pelo caminho que o adapter escolher.
  for (const { externalId, response, expect } of fixtures.statuses) {
    const { transport } = recording(response);
    const result = await outcome(adapter.getStatus(transport, externalId));
    if ('error' in result) fail(`getStatus falhou numa resposta válida: ${String(result.error)}`);
    else if (JSON.stringify(result.value) !== JSON.stringify(expect)) {
      fail(`getStatus: esperava ${JSON.stringify(expect)}, veio ${JSON.stringify(result.value)}`);
    }
  }

  // 3) falhas: resposta ruim e rede fora viram ProviderError com código estável, sem vazar segredo.
  const errorCases = fixtures.errors.map(({ externalId, response, code }) => ({
    externalId,
    transport: recording(response).transport,
    code,
  }));
  const anyId = fixtures.accepts[0]?.externalId ?? 'abc';
  errorCases.push({ externalId: anyId, transport: noNetwork, code: 'provider_unreachable' });
  for (const { externalId, transport, code } of errorCases) {
    const result = await outcome(adapter.getStatus(transport, externalId));
    if ('value' in result) {
      fail(`getStatus deveria falhar com ${code}`);
    } else if (!(result.error instanceof ProviderError)) {
      fail(`getStatus deveria lançar ProviderError(${code}), lançou ${String(result.error)}`);
    } else {
      if (result.error.code !== code) fail(`erro ${result.error.code}, esperava ${code}`);
      const text = `${result.error.message} ${JSON.stringify(result.error)} ${result.error.stack ?? ''}`;
      if (text.includes(CANARY)) fail('o erro vazou o texto da falha de rede (possível segredo)');
    }
  }

  // 4) exclusão: só existe com managedUpload e só apaga o que o Hub enviou (managed).
  if (adapter.capabilities.managedUpload && !adapter.deleteAsset) {
    fail('declara managedUpload, mas não implementa deleteAsset');
  }
  if (!adapter.capabilities.managedUpload && adapter.deleteAsset) {
    fail('não declara managedUpload, mas implementa deleteAsset');
  }
  if (adapter.deleteAsset) {
    const refused = recording({ status: 200, body: {} });
    const referenced = await outcome(
      adapter.deleteAsset(refused.transport, { externalId: anyId, origin: 'referenced' }),
    );
    if ('value' in referenced) fail('apagou um asset `referenced`');
    else if (!(referenced.error instanceof ProviderError)) {
      fail('a recusa de apagar `referenced` deveria ser ProviderError');
    }
    if (refused.calls.length > 0) fail('chamou o provider ao recusar apagar `referenced`');

    const allowed = recording({ status: 200, body: {} });
    const managed = await outcome(
      adapter.deleteAsset(allowed.transport, { externalId: anyId, origin: 'managed' }),
    );
    if ('error' in managed) fail(`não apagou o asset managed: ${String(managed.error)}`);
    else if (allowed.calls.length !== 1 || allowed.calls[0]!.method !== 'DELETE') {
      fail('apagar managed deveria fazer exatamente UMA chamada DELETE');
    }
  }
  return problems;
}
