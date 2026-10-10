/**
 * Smoke de um Worker publicado: `bun scripts/smoke.ts <url-base> <releaseId-esperado>`.
 * Confere que o que está no ar é o commit esperado e que o banco do ambiente responde.
 * Só leitura (GET). Sai com código 1 se algo divergir.
 */
const [baseUrl, expectedRelease] = process.argv.slice(2);
if (!baseUrl || !expectedRelease) {
  console.error('uso: bun scripts/smoke.ts <url-base> <releaseId-esperado>');
  process.exit(2);
}

interface HealthBody {
  status?: string;
  releaseId?: string;
}

async function check(path: string, attempts: number): Promise<string[]> {
  const problems: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    problems.length = 0;
    try {
      const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(20_000) });
      const body = (await response.json()) as HealthBody;
      if (response.status !== 200) problems.push(`${path}: HTTP ${response.status}`);
      if (body.status !== 'ok') problems.push(`${path}: status "${body.status}"`);
      if (body.releaseId !== expectedRelease) {
        problems.push(`${path}: releaseId "${body.releaseId}" != esperado "${expectedRelease}"`);
      }
      if (!response.headers.get('x-request-id')) problems.push(`${path}: sem x-request-id`);
      console.log(`${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
    } catch (error) {
      problems.push(`${path}: ${error instanceof Error ? error.message : 'falha'}`);
    }
    if (problems.length === 0) break;
    // O Neon Free suspende após 5 min ocioso: a primeira consulta pode demorar e falhar uma vez.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return problems;
}

const problems = [
  ...(await check('/api/health/live', 2)),
  ...(await check('/api/health/ready', 3)),
];
if (problems.length > 0) {
  for (const problem of problems) console.error(`SMOKE FALHOU: ${problem}`);
  process.exit(1);
}
console.log(`smoke aprovado: ${baseUrl} está em ${expectedRelease}`);
