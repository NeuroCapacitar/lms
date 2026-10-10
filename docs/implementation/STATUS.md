# Estado de implementação — Hub vNext

**Atualização:** 2026-10-10  
**Estado:** M0 em andamento (M0-01 a M0-06 `verified` no CI; spikes M0-11 e M0-12 passaram)  
**Próximo marco:** M0 — Fundação e spikes  
**Próxima tarefa recomendada:** M0-07 (base visual com tokens OKLCH) e M0-08 (primeiro deploy em Staging) (não autorizadas)  
**Task em execução:** nenhuma  
**Última tarefa comprovadamente verificada:** M0-06 (2026-10-10, no CI)

> Nunca marcar tarefa ou marco como concluído com base em decisão, texto de plano, instrução para IA ou intenção. Só evidências reais de arquivos, comandos, testes, SHA e homologação justificam o status.

## Marcos

| Marco | Status | Evidência |
|---|---|---|
| M0 Fundação e spikes | `in_progress` | M0-01 a M0-06 `verified`; spikes M0-11 e M0-12 passaram (registro abaixo) |
| M1 Identidade e Staff | `not_started` | — |
| M2 Catálogo e autoria | `not_started` | — |
| M3 Jornada gratuita | `not_started` | — |
| M4 Assíncrono e e-mail | `not_started` | — |
| M5 Aprendizagem completa | `not_started` | — |
| M6 Comércio | `not_started` | — |
| M7 Certificados | `not_started` | — |
| M8 PWA | `not_started` | — |
| M9 Operação e refinamento | `not_started` | — |
| M10 Migração e lançamento | `not_started` | — |

## Registro de tarefas concluídas

Ao concluir uma tarefa, acrescente: `ID`, SHA, arquivos, comandos executados, resultados, evidências, pendências e responsável pela homologação.

### M0-06 — implemented localmente; CI em verificação (2026-10-10)

- **Entrega:** PR de `feat/m0-06-testes`. Estratégia e comandos em [testes](../operations/testing.md).
- **Recurso criado (perfil `neurocapacitar`, identidade verificada):** projeto Neon Free `hub-test` (`aws-sa-east-1`, PG 18), o banco de testes local; URL só em `.env.test` (ignorado pelo Git). Nenhum Worker, Hyperdrive ou projeto existente foi alterado.
- **Vitest 5.0.3** com três projetos: `unit` (Node), `workers` (`@cloudflare/vitest-plugin` 1.4.0, workerd) e `pg` (Postgres 18 real). **Playwright 1.64.0** (Chromium headless shell 156, 118 MiB baixados do CDN oficial do Playwright).
- **Executado e passou (local):** `bun run verify` completo (exit 0): 16 testes Vitest (9 unit, 4 pg, 3 workers), 4 testes Playwright, Knip, dependency-cruiser e Gitleaks. `test:workers` rodou 3 vezes seguidas sem erro.
  - `pg`: migrations em PG 18 (confere `server_version_num` ≥ 180000), schema isolado por arquivo, **corrida de referência** (20 inserções paralelas na mesma chave: exatamente 1 vence) e **serialização com `FOR UPDATE`** (duas transações, contador final 2, espera ≥ 70% da retenção do lock).
  - `workers`: `/api/health/live` 200 JSON, `/api/nada` 404 JSON e `health/ready` **pelo binding Hyperdrive local até o Postgres de teste**. Com `TEST_DATABASE_URL` inválida o teste `ready` **falha**, provando que usa o banco de teste e não o `.env` de dev.
  - Playwright: página inicial com "Serviço disponível.", navegação para `/sobre`, **rota profunda `/sobre` aberta direto e recarregada sem 404 em navegador real** (fecha o item "SPA fallback em navegador real" que ficara pendente no M0-02), API em JSON e 404 JSON em `/api` desconhecida.
- **Achados corrigidos:** (1) no workerd o `pg` não carrega pelo pipeline de módulos do plugin (`pg-protocol` resolve para `esm/index.js`, arquivo ESM dentro de pacote CommonJS; alias, plugin de resolução e otimizador de dependências não resolveram): o projeto `workers` testa o **Worker construído** (`dist/hub`), que já traz o `pg` empacotado. (2) Ao fechar o cliente, o `pg-cloudflare` rejeitava o leitor do socket e emitia um `error` sem ouvinte (exceção não tratada que derrubava o Vitest e poluiria os logs em produção): `withDatabase` agora registra `client.on('error', ...)`. Com `pg` 8.23.1 o problema persistia, então o `pg` segue fixado em 8.16.3 (ADR 0022).
- **Desvios do plano:** (1) o teste do Worker usa o artefato construído, não o código-fonte. (2) PG18 local é o projeto Neon `hub-test` (sem Docker nesta máquina); no CI é o serviço `postgres:18`. (3) `test:db` (node:test, só Development) permanece à parte por depender de credenciais de dev.
- **Pendente nesta entrega:** o resultado do CI com o serviço `postgres:18` e o Playwright no Linux (registrado após a execução); duração do CI com os testes novos; uso de minutos do Actions.

### M0-05 — verified no CI (2026-10-10)

- **Entrega:** PR #10 (`feat/m0-05-ci`). Matriz de gates no [README](../../README.md#matriz-de-gates-do-ci-m0-05).
- **Arquivos:** `.github/workflows/ci.yml` (jobs `bloqueante` e `consultivo`), `.github/workflows/workflows-advisory.yml` (actionlint e zizmor, só quando um workflow muda), `renovate.json`, `knip.json`, `.dependency-cruiser.cjs` (regras de AGENTS §5), `scripts/secrets-scan.ts`, scripts `knip`, `arch`, `agents:check`, `secrets` e `verify` no `package.json`.
- **Camada bloqueante (um job, passos que rodam mesmo após falha):** TypeScript, Oxlint, Oxfmt, `wrangler types --check`, drift do Drizzle, testes dos scripts, build de Staging e Production com preflight, Knip, dependency-cruiser, instruções de agentes e Gitleaks. **Consultiva:** Semgrep CE 1.178.0 e, ao mudar workflow, actionlint 1.7.12 e zizmor 1.30.1. Vitest, PG18 e Playwright entram no M0-06.
- **Segurança do workflow:** `permissions: contents: read`, sem nenhum segredo, ações fixadas por SHA (`checkout` e `setup-node`), `bun install --frozen-lockfile`, Bun e Gitleaks instalados do release oficial com **checksum SHA-256 conferido**.
- **PR limpo:** CI verde (~30 s) e `bun run verify` local com exit 0.
- **Cinco PRs descartáveis (#11 a #15, fechados sem merge; cada um com uma falha deliberada):**

  | PR | Falha deliberada | Único passo que falhou |
  |---|---|---|
  | #11 | `'ok' as number` (erro de tipo) | TypeScript |
  | #12 | `debugger` | Oxlint |
  | #13 | token falso aleatório no formato `ghp_...` | Gitleaks |
  | #14 | export não usado em `src/db/client.ts` | Knip |
  | #15 | UI (`src/web`) importando `src/db/schema` | dependency-cruiser |

- **Achados corrigidos durante a tarefa:** (1) o zizmor apontou a instalação do Bun por `npm install -g` fora do lockfile (baixa severidade): trocada por binário oficial com checksum. (2) Sem `bunx` no binário oficial do Bun, `build-env.ts` e `check-drift.ts` falhavam só no CI: passaram a usar `bun x`. (3) O Gitleaks varria **todos os branches** remotos (o segredo de um PR derrubava os outros): agora só `--log-opts=HEAD`. (4) A primeira versão dos testes de erro de tipo e de export não usado também quebrava outros gates (retorno errado em função usada; export em arquivo importado com `import *`) e foi refeita para falhar um passo só.
- **Ação do responsável pendente:** instalar o app do Renovate no repositório (ver `renovate.json`). Sem ele, a atualização de dependências é manual.
- **Não verificado:** a duração do CI com Vitest, PG18 e Playwright (M0-06); o uso mensal de minutos do Actions (medir no primeiro mês); o Semgrep consultivo passou, mas não revisei o conjunto de regras do registro.
- **Limitação:** sem branch protection no GitHub Free privado, o merge com tudo verde continua sendo disciplina do responsável.

### M0-04 — verified localmente (2026-10-10; o CI só chega no M0-05)

- **Entrega:** PR de `feat/m0-04-banco` (o SHA do próprio commit não pode constar aqui). Runbook: [database-and-migrations](../operations/database-and-migrations.md).
- **Recursos criados (perfil `neurocapacitar`, identidade verificada antes):**
  - 3 projetos Neon Free, PG 18, `aws-sa-east-1`: `hub-development`, `hub-staging`, `hub-production` (este **vazio**, sem migração e sem Worker).
  - Role `hub_runtime` (só DML) em cada um; a role de migração é a dona do banco (`neondb_owner`), só pela conexão direta, fora do Worker.
  - 3 configs Hyperdrive com a role de runtime, **cache desligado** (confirmado por `wrangler hyperdrive get`): `hub-development`, `hub-staging`, `hub-production`. IDs e hosts em `scripts/environments.ts`.
  - Nenhum projeto pré-existente do legado foi tocado.
- **Código:** Drizzle 0.45.4 e drizzle-kit 0.31.11 fixados (sem API relacional, colunas `snake_case`), `pg` 8.16.3; `src/db/schema.ts` (tabela `health_probe`), `src/db/client.ts` (um cliente `pg` por requisição), `GET /api/health/ready` (`SELECT 1`), migração `drizzle/0000_init_health_probe.sql` (revisada à mão), scripts `db:generate`, `db:drift`, `db:migrate`, `db:roles`, `test:db`, com guardas (recusam pooler, host de outro ambiente e Production sem confirmação explícita).
- **Executado e passou:**
  - `db:migrate` em dev duas vezes (a segunda é no-op: journal continua com 1 registro) e em staging; Production recusada sem `CONFIRM_MIGRATE_PRODUCTION`.
  - `test:db` no dev (4 testes): `hub_runtime` recebe `permission denied` (42501) em `CREATE TABLE`, `ALTER TABLE` e `DROP TABLE`, não lê o journal de migrações e faz DML em `health_probe`.
  - `drizzle-kit generate` repetido: "No schema changes" (sem drift); `db:drift` passa.
  - `GET /api/health/ready` em `vite dev` com a conexão local do binding: 200 `{"status":"ok"}`; sem a variável o `dev` nem inicia (erro explícito do Wrangler).
  - **Prova de cache desligado:** Worker descartável (apagado) ligado ao Hyperdrive de dev, escrita e leitura na mesma requisição, 3 execuções × 20 rodadas = **0 leituras obsoletas**.
  - Verificações locais: `verify:quick`, `types:check`, `test` (9) e `build:staging`/`build:production` (preflight aceita os IDs reais).
- **Achado (cópia limpa):** o `wrangler types` embutia nomes de variáveis do `.env` local no tipo `Env`, então o arquivo gerado dependia da máquina e o `types:check` falhava em checkout limpo. Corrigido: `types` e `types:check` rodam com `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`; confirmado nas duas árvores (com e sem `.env`).
- **Não verificado:** `health/ready` no Staging publicado (o Worker de Staging só existe no M0-08; o banco de Staging já está migrado com o mesmo schema); `drizzle-kit generate` sem diff foi provado no checkout local, a verificação em CI chega no M0-05; `test:db` não roda em CI (precisa de credenciais do dev).
- **Riscos e pendências:** `GET /api/health/ready` é público e acorda o Neon Free (proteção no M4/M9); a senha da role de runtime está só no Hyperdrive e no `.env` local do desenvolvimento (rotação por `db:roles` com nova senha, depois `hyperdrive update`); sem backup independente ainda (M9-05).
- **Desvios do plano:** (1) a role de migração é o dono do banco (`neondb_owner`) em vez de uma terceira role criada à parte; (2) a prova de cache desligado usou um Worker descartável no Hyperdrive de dev, porque o Staging ainda não existe; (3) `test:db` fica fora do `test` padrão por depender de credenciais.

### M0-03 — verified localmente (2026-10-10; o CI só chega no M0-05)

- **Entrega:** PR de `feat/m0-03-ambientes` (o SHA do próprio commit não pode constar aqui).
- **Arquivos:** `wrangler.jsonc` (`env.staging` = `hub-staging`, `env.production` = `hub-production`; Worker de desenvolvimento `hub`), `scripts/environments.ts` (tabela de recursos e variáveis permitidos por ambiente), `scripts/preflight-core.ts`, `scripts/preflight.ts`, `scripts/build-env.ts`, `scripts/preflight.test.ts`, `tsconfig.node.json`, `worker-configuration.d.ts` (regenerado), `package.json` (`build:staging`, `build:production`, `preflight`, `types`, `types:check`, `test`), catálogo de variáveis e segredos em `docs/operations/environment-and-release-safety.md`.
- **Executado e passou:**
  - Em cópia limpa (sem `node_modules`): `bun install --frozen-lockfile`, `bun run verify:quick`, `bun run types:check`, `bun run test` (9 testes, `node --test`), `bun run build:staging` e `bun run build:production`.
  - `wrangler types --check` passa em sincronia e **falha** quando o `wrangler.jsonc` muda sem regenerar os tipos.
  - `CLOUDFLARE_ENV=prod vite build` (ambiente inexistente) **falha** (exit 1); `build-env.ts` também recusa `prod`, `dev` e vazio.
  - Artefato de Staging adulterado com um Hyperdrive fictício de Production: o preflight **rejeita** (`recurso não permitido em "staging": hyperdrive ...`); artefato de Staging verificado como Production: rejeitado (ambiente e nome do Worker); artefato sem ambiente verificado como Staging: rejeitado; artefatos corretos de dev, Staging e Production: aprovados.
- **Achado:** o Vite Plugin grava sempre em `dist/hub/`, mas o `wrangler.json` gerado traz o `name` do ambiente (`hub-staging`, `hub-production`) e `targetEnvironment`; o preflight confere esses campos e cada referência a recurso. A primeira versão do preflight acusou falso positivo em listas de texto (`compatibility_flags`, `definedEnvironments`); o teste contra o artefato real o expôs e foi corrigido.
- **Desvios do plano:** (1) o preflight é TypeScript executado por Bun e testado com o runner nativo do Node (`node --test`), sem dependência nova; o M0-06 define o `test` definitivo (Vitest) e pode absorvê-lo. (2) A tabela de recursos está vazia: Hyperdrive, filas e R2 entram quando forem criados (M0-04 em diante). (3) O catálogo de variáveis traz **nomes propostos**, ainda não criados.
- **Cloudflare:** nenhum recurso remoto foi criado nem alterado (nenhum Worker, deploy ou segredo); o primeiro deploy de Staging é o M0-08. Nenhum comando remoto foi usado nesta tarefa.
- **Não verificado:** `CLOUDFLARE_ENV` com Workers Builds; o bloqueio de `deploy` automático (só `versions upload`) não existe ainda e depende do CI (M0-05).

### M0-12 (spike 3) — passou (2026-10-10)

- **Entrega:** [ADR 0027](../adr/0027-spike-m0-12-regiao-neon-e-orcamento-de-compute.md) e medições brutas em [evidencias/m0-12/](../review/evidencias/m0-12/README.md). Código do spike (Worker de teste) ficou fora do repositório.
- **Resultado:** Worker (colo GRU) → Hyperdrive (cache desligado) → Neon, 3 rodadas por região: **São Paulo ~5 a 8 ms por query** contra **~120 a 137 ms em us-east-1**; despertar frio via Hyperdrive em São Paulo 595 a 1119 ms (p50 633 ms, n = 5), abaixo do limite de 5 s. O pool do Hyperdrive não impede o scale-to-zero (endpoint `idle` ~5 min após a última query). Decisão: **São Paulo (`aws-sa-east-1`)**, cron de 30 min (modelo: ~32 CU-h/mês sem tráfego), nunca abaixo de 10 min.
- **Não medido:** consumo real de CU-h (as métricas do projeto ficaram em 0 durante o spike); p95 do despertar com n maior.
- **Recursos criados e apagados (perfil `neurocapacitar`):** 2 projetos Neon Free, 2 configs Hyperdrive, 1 Worker. Verificado depois: restam só os 3 projetos Neon que já existiam, 0 configs Hyperdrive `spike-m0-12-*` e o Worker respondeu 404. Nenhum projeto pré-existente foi tocado. Plano Workers Free (sem Paid).

### M0-11 (spike 2) — passou (2026-10-10)

- **Entrega:** [ADR 0026](../adr/0026-spike-m0-11-bun-vitest-dependency-cruiser.md). Código do spike na branch descartável `spike/m0-11` (**nunca mesclar**); só a ADR entra na `main`.
- **Matriz testada:** Bun 1.4.2, Node 24.21.0, TypeScript 7.0.2, Vitest 5.0.3, `@cloudflare/vitest-plugin` 1.4.0, Wrangler 4.149.0, dependency-cruiser 18.5.0 + `@swc/core` 1.16.13, oxlint 1.87.0, oxfmt 0.72.0. Windows 11 e GitHub Actions `ubuntu-latest`.
- **Resultado:** frozen install e `verify:quick` passaram nos dois sistemas; `bun.lock` regenerado do zero no Windows é idêntico; Vitest no workerd passou com Node (via `bunx`), com runtime Bun e com Node direto (5/5 estável no Windows; falha injetada falha); dependency-cruiser sob TS 7 detecta o import proibido (exit 2) e passa em árvore limpa (exit 0), com aviso não fatal.
- **Lacuna aberta:** a máquina não tem Docker, WSL nem PostgreSQL local; o Postgres 18 local do M0-06 não foi testado (opções na ADR 0026).
- **Não usado:** Cloudflare e Neon (nenhum recurso remoto).

### M0-02 — verified localmente (2026-10-10; o CI só chega no M0-05)

- **SHA:** `f4edb18` (mesclado por PR #2, merge `9f83cb0`). Base: M0-01 (PR #1, merge `300b3ed`).
- **Arquivos:** `index.html`, `vite.config.ts`, `wrangler.jsonc`, `src/server/{app,index}.ts` (Hono), `src/web/{main.tsx,routes/{__root,index,sobre}.tsx,routeTree.gen.ts}` (gerado), `src/features/.gitkeep`, `worker-configuration.d.ts` (gerado por `wrangler types`), `tsconfig.{json,node,web,worker}.json`, `.oxlintrc.json`, ajustes em `package.json`, `bun.lock`, `.oxfmtrc.json`, `.gitattributes`, `README.md`, `AGENTS.md`.
- **Versões fixadas (exatas):** React 19.3.0, Hono 4.13.13, TanStack Router 1.170.41, Query 5.104.1, router-plugin 1.168.42, Vite 8.3.4, @vitejs/plugin-react 6.1.2, @cloudflare/vite-plugin 1.63.1, Wrangler 4.149.0, @types/react e react-dom 19.3.0. `compatibility_date` 2026-10-01 com `nodejs_compat`.
- **Executado e passou:**
  - Em cópia limpa dos arquivos versionáveis (sem `node_modules` nem `dist`): `bun install --frozen-lockfile`, `bun run verify:quick` e `bun run build`, todos com exit 0 (`typecheck` roda os 3 projetos: node, web e worker).
  - `bun run build` seguido de `vite preview` (workerd local): `GET /api/health/live` → 200 `application/json` `{"status":"ok"}`; `GET /api/nada` → 404 `application/json` `{"error":{"code":"not_found"}}`; `GET /sobre` → 200 `text/html` com `<div id="root">`; asset com hash (`/assets/index-*.js`) → 200 `text/javascript`; `POST /api/health/live` → 404 JSON.
  - `vite dev`: `/api/health/live` 200, `/api/nada` 404 JSON, `/sobre` 200 HTML.
  - Os servidores foram encerrados ao final (porta fechada).
- **Não verificado:** o comportamento do SPA fallback em navegador real (a doc da Cloudflare condiciona o fallback a requisições de navegação) e em ambiente publicado: fica para o Playwright (M0-06) e o Staging (M0-08). Também não foi testado `wrangler dev` (usei `vite preview`/`vite dev`, que também rodam o Worker em workerd local).
- **Desvios do plano:** (1) `worker-configuration.d.ts` (624 KB, gerado) está versionado e usado pelo projeto TypeScript do Worker; o `wrangler types --check` e o isolamento por ambiente são do M0-03. (2) Três projetos TypeScript (`node`, `web`, `worker`) em vez de um, para não misturar tipos DOM e do Worker. (3) `skipLibCheck` ligado nos projetos node e web: tipos de terceiros (`wrangler`, `miniflare`) referenciam módulos ausentes. (4) A página inicial faz uma consulta à API para provar a mesma origem; sem estilo (M0-07). (5) `.gitattributes` ganhou `eol=lf` para `.mjs`, `.html`, `.css` e marca os arquivos gerados.
- **Cloudflare:** nenhuma conta, login, deploy ou recurso remoto foi usado (`WRANGLER_SEND_METRICS=false`).
- **Riscos:** versões provisórias até o spike M0-11; `@cloudflare/vite-plugin` 2.0 está em beta (mantida a 1.63.1).

### M0-01 — verified localmente (2026-10-10; o CI só chega no M0-05)

- **SHA:** `77c1ce3` (mesclado por PR #1, merge `300b3ed`).
- **Arquivos:** `package.json`, `bun.lock`, `bunfig.toml`, `.node-version`, `tsconfig.json`, `.oxfmtrc.json`, `.gitignore` (negação de `.dev.vars.example`), `LICENSE`, `CONTRIBUTING.md`, `scripts/check-agent-instructions.mjs` (JSDoc), `README.md`, `AGENTS.md`.
- **Versões fixadas (exatas):** Bun 1.4.2, Node 24.21.0, TypeScript 7.0.2, oxlint 1.87.0, oxfmt 0.72.0, @types/node 24.19.2. Provisórias até o spike M0-11.
- **Executado e passou:** `bun install` e, em cópia limpa dos arquivos versionáveis (sem `node_modules`), `bun install --frozen-lockfile` e `bun run verify:quick` (exit 0). Testes negativos na cópia: erro de tipo, formatação errada e `debugger`/variável não usada falham o respectivo script. `git check-ignore` confirma que `.dev.vars`, `.env*`, `.wrangler/`, `dist/` e chaves são ignorados e que `.dev.vars.example` não é.
- **Gitleaks 8.30.1** (release oficial `gitleaks/gitleaks`, `windows_x64.zip`, 8.438.883 bytes, checksum SHA-256 conferido contra o `checksums.txt` do mesmo release; guardado fora do projeto): `gitleaks git` no histórico (todas as refs) e `gitleaks dir` no diretório de trabalho (sem `node_modules`) = **no leaks found**. Teste negativo em repositório temporário descartável com um token falso aleatório no formato `ghp_...`: **1 achado, exit 1**. O Gitleaks ainda não está no CI (M0-05).
- **Desvios do plano:** (1) não há script `test`: não existia nada a testar e a tarefa proíbe script sem utilidade; chega no M0-06. (2) `lint` usa `--deny-warnings`, para que aviso falhe. (3) oxfmt só cobre código e configuração (`.oxfmtrc.json` ignora `docs/**`, `*.md`, lockfile e manifesto), para não reformatar a documentação. (4) `.dev.vars.example` não foi criado: ainda não há variáveis. (5) `LICENSE` deixa o titular como PENDENTE.
- **Riscos:** versões provisórias; GitHub Free privado sem branch protection (trabalho em branch, revisão humana).

## Bloqueios e pendências externas

- Repositório vNext criado em 2026-10-10: `NeuroCapacitar/lms` (privado, organização, GitHub Free; opção B da Q49 realizada).
- **CLIs: só o perfil `neurocapacitar`** (`neurocapacitar.projetos@gmail.com`) na Cloudflare e na Neon, sempre com `--profile neurocapacitar` ([cli-profiles](../operations/cli-profiles.md), ADR 0025). Verificado em 2026-10-10 (somente leitura): `neon me` e `cf auth whoami` com o perfil confirmam o e-mail; o perfil ativo da Neon é `DEFAULT` (outra conta); `wrangler whoami` sem `--profile` mostra outra conta; o Wrangler passou a ter o perfil `neurocapacitar` autenticado em 2026-10-10 (criado pelo responsável com `wrangler auth create neurocapacitar`; `wrangler login --profile` não o criou) e foi verificado pelo ID da conta (igual ao do `cf auth whoami --profile neurocapacitar`). Na sessão anterior rodei `wrangler whoami` sem `--profile` (somente leitura, conta pessoal); nada foi criado nem alterado. Nada foi provisionado na Cloudflare nem na Neon.
- Spikes do M0 não executados: nenhuma compatibilidade foi testada (Better Auth + Hyperdrive, Bun/Windows, JMV, Asaas sandbox, Browser Run, Images, HTMLRewriter, evlog/Sentry).
- Terceiros: contador (NFS-e), advogado do cliente (termos, retenções, transferência internacional), cliente (provedores de vídeo e contas de teste, manual de marca e logo positivo, destino da cópia off-cloud). Ver [relatório final](../review/relatorio-final.md#7-pendências-que-dependem-de-terceiros).

## Regra de atualização

Atualize após cada tarefa verificada; registre impedimentos reais. Não acrescente datas, deploys ou testes fictícios. Não inicie uma tarefa nova automaticamente.
