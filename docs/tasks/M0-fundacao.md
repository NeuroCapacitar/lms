# M0 — Fundação

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega e gate.** Um esqueleto executável (React SPA + Hono no mesmo Worker, Neon Postgres 18 via Hyperdrive sem cache, CI em duas camadas, base visual acessível, primeiro deploy em Staging com observabilidade mínima), a zona DNS **inventariada** (a cópia para a Cloudflare e a troca de nameservers ficam para antes do M10) e nove spikes técnicos resolvidos por ADR curta. **Gate de aceite:** M0-01..M0-08 concluídas (o M0-09 foi adiado para antes do M10, ver abaixo); M0-10, M0-11, M0-12 e M0-18 com ADR "passou"; Staging responde `health` com commit identificável e consulta real ao Neon Staging. Os spikes M0-13..M0-17 podem ser feitos mais tarde, mas **cada marco só começa depois do ADR "passou" do spike que o bloqueia** (indicado em cada spike). Nenhuma Production da vNext existe neste marco (big-bang).

## Ordem recomendada de execução

M0-01 → M0-02 → **M0-11** (Bun/Windows, antes de fixar CI e testes) → **M0-12** (latência Neon, antes de criar os bancos definitivos) → M0-03 → M0-04 → M0-05, M0-06, M0-07 → **M0-10** (Better Auth, antes de M1) e **M0-18** (evlog/Sentry, antes de M0-08) → M0-08 → M0-14, M0-17 (precisam do Staging público) → M0-13, M0-15, M0-16 (antes de M5, M7 e do upload de mídia). **M0-09 (DNS)** foi **adiado por decisão do responsável (2026-10-10)**: o desenvolvimento segue no domínio temporário `*.workers.dev` e a zona só precisa estar na Cloudflare antes do cutover (M10) ou antes do que exigir zona (hostname definitivo, transformação de imagens). Não bloqueia o gate do M0 nem os marcos M1 a M9.

## Regras para todas as tarefas

- **Spike:** código descartável (branch `spike/m0-nn`, nunca em `main`); só a ADR (`docs/adr/00NN-spike-<tema>.md`, modelo em `docs/adr/TEMPLATE.md`) entra no repositório. Timebox de 1–2 dias; estourou, pare, registre o que foi provado e peça decisão. **Falha do spike = ADR "reabrir decisão Qxx" com evidência; não improvise substituto.**
- Credenciais só em `.dev.vars` (ignorado pelo Git) ou nos secrets do ambiente; nunca em código, log ou ADR. Sem dados pessoais reais.
- **CLIs Cloudflare e Neon: só o perfil `neurocapacitar`**, sempre com `--profile neurocapacitar` e identidade verificada antes do primeiro comando remoto (`neon me`, `cf auth whoami`; nunca `wrangler whoami`). Ver [cli-profiles](../operations/cli-profiles.md) e ADR 0025. O perfil do Wrangler `neurocapacitar` já existe (criado com `wrangler auth create neurocapacitar`); verificação em cli-profiles.
- Nenhum teste destrutivo em Staging/Production. Contas de provedores de terceiros são fornecidas pelo cliente; sem conta, o spike fica `blocked`, não é simulado.

---

### M0-01 — Repositório privado e governança inicial
**Dependências:** nenhuma · **Estado:** `not_started`
**Objetivo:** checkout limpo instala dependências e roda os scripts mínimos sem serviço externo, no repositório privado `NeuroCapacitar/lms` (organização, GitHub Free).
**Passos:**
1. O repositório já existe (`NeuroCapacitar/lms`, privado, com os documentos); clone-o ou use esta pasta, que já é o checkout. Confirmar com o responsável quem tem escrita. Não copiar histórico do legado.
2. Fixar versões **exatas**: Bun 1.4.x (`packageManager` no `package.json`, `bunfig.toml` com `exact = true`), Node LTS (`.node-version`, usado pelo Wrangler) e TypeScript estável mais recente (7.0.x). Anotar que são provisórias até o M0-11.
3. `.gitignore` para `.dev.vars*`, `.env*`, `.wrangler/`, `dist/`, chaves; versionar só `.dev.vars.example` com nomes de variáveis, sem valores.
4. Scripts mínimos reais: `typecheck`, `lint`, `format:check`, `test`, `verify:quick`. Não criar script que ainda não faz nada útil.
5. `LICENSE` (todos os direitos reservados; titularidade a confirmar com o cliente) e `CONTRIBUTING.md` curto (branch → PR, rodar `verify:quick`).
**Testes:** clone novo em pasta temporária; `bun install --frozen-lockfile` e `bun run verify:quick` passam. Gitleaks local sem achados no histórico inicial; um segredo falso inserido de propósito em branch descartável é detectado.
**Aceite:** comandos acima passam em checkout limpo; lockfile versionado; nenhum arquivo de segredo rastreado.
**Fora do escopo / cuidados:** não configurar CI (M0-05) nem Cloudflare; GitHub Free privado não garante branch protection, então não confie nela; adicionar só colaboradores necessários.

### M0-02 — SPA React + Hono no mesmo Worker
**Dependências:** M0-01 · **Estado:** `not_started`
**Objetivo:** um único Worker serve a SPA e `/api/*`; rota profunda recarrega sem 404 e `/api` desconhecida devolve JSON 404, nunca o HTML da SPA.
**Passos:**
1. Vite + Cloudflare Vite Plugin + React 19, TanStack Router (rotas `/` e `/sobre`) e Query.
2. `wrangler.jsonc` com `assets.not_found_handling: "single-page-application"`, `assets.run_worker_first: ["/api/*"]`, `compatibility_date` fixa e `nodejs_compat`.
3. App Hono em `src/server` (só composição HTTP) com `GET /api/health/live`; erro padrão em JSON.
4. Pasta `src/features/` vazia por ora; regra: domínio não importa React/Hono/SQL.
**Testes:** build; `wrangler dev` + `curl`: `/api/health/live` 200 JSON; `/api/nada` 404 com `application/json`; `/sobre` aberto direto devolve o HTML da SPA; asset com hash serve JS/CSS corretos.
**Aceite:** os quatro testes passam localmente.
**Fora do escopo / cuidados:** sem Next, SSR, RSC, Server Actions nem API só de Node. Nenhuma regra de negócio ainda. HTMLRewriter só entra no M2-06.

### M0-03 — Wrangler, tipos e isolamento de ambientes
**Dependências:** M0-02 · **Estado:** `not_started`
**Objetivo:** Dev, Staging e Production têm configurações e bindings distintos, e um build de Staging não consegue apontar para recurso de Production.
**Passos:**
1. `env.staging` e `env.production` no Wrangler com nomes claros (sugestão `hub-staging`, `hub-production`); Production fica **declarada e nunca implantada** neste marco. Declarar só os bindings que já existem (os demais entram nas tarefas que os usam).
2. `wrangler types` gera tipos versionados; CI roda `wrangler types --check`. Não editar o arquivo gerado.
3. Scripts `build:staging` e `build:production` definem `CLOUDFLARE_ENV` **antes** do build do Vite Plugin.
4. `scripts/preflight.ts`: confere `CLOUDFLARE_ENV`, nome do Worker e IDs de recurso do artefato construído contra uma tabela esperada por ambiente (sem segredos).
5. Catálogo de variáveis/segredos (apenas nomes e dono) em `docs/operations/environment-and-release-safety.md`.
**Testes:** `wrangler types --check` passa; build com `CLOUDFLARE_ENV` errado falha; artefato de Staging com ID de Hyperdrive de Production (valores fictícios) é rejeitado pelo preflight.
**Aceite:** os dois testes negativos falham como esperado e o build correto passa.
**Fora do escopo / cuidados:** segredos de Production jamais no repositório nem em workflow comum. Se usar Workers Builds, só `wrangler versions upload`, nunca `deploy` automático. Deixar o Bot Fight Mode desligado até testar webhooks (M0-14).

### M0-04 — Neon (×3), Drizzle e Hyperdrive sem cache
**Dependências:** M0-02, M0-12 · **Estado:** `not_started`
**Objetivo:** Worker consulta o Postgres 18 do próprio ambiente por Hyperdrive com `pg` por requisição e cache **desligado**, com migrations SQL revisadas e forward-only.
**Passos:**
1. Criar três projetos Neon Free (Dev, Staging, Production) na região decidida no M0-12; o de Production fica vazio e sem conexão com Worker.
2. Em cada projeto, duas roles: migração (DDL) e runtime (só DML). Migrações rodam fora do Worker, pela conexão direta.
3. Uma configuração Hyperdrive por ambiente (string direta, sem pooler) com cache desligado; confirmar o estado com `wrangler hyperdrive get`.
4. `drizzle-orm` e `drizzle-kit` 0.45 fixados; Drizzle só como query builder/schema (sem API relacional); `drizzle-kit generate` produz o SQL, que é revisado à mão; **proibido `drizzle-kit push`**. Runner `db:migrate` com journal único.
5. Cliente `pg` criado por requisição e fechado no fim (padrão validado no M0-10); tabela mínima de verificação e `GET /api/health/ready` com `SELECT 1`.
**Testes:** migrations aplicadas duas vezes em PG18 vazio (a segunda é no-op); role runtime tentando `CREATE TABLE` recebe permissão negada; escrita seguida de leitura na mesma requisição enxerga o dado novo (prova de cache off); `generate` não gera diff novo (drift).
**Aceite:** `health/ready` passa local e em Staging com o mesmo schema.
**Fora do escopo / cuidados:** sem advisory locks, LISTEN/NOTIFY ou PREPARE SQL (o Hyperdrive não os suporta). Sem DDL em rota HTTP, Cron ou startup. Nunca usar a string de Production no Dev.

### M0-05 — Qualidade e CI em duas camadas
**Dependências:** M0-01, M0-02, M0-11 · **Estado:** `not_started`
**Objetivo:** todo PR mostra resultados verificáveis: camada **bloqueante** (falha impede o merge por disciplina) e camada **consultiva** (alerta sem bloquear).
**Passos:**
1. Bloqueantes: TypeScript, Oxlint/Oxfmt, Vitest (unitário + PG18 real, após o M0-06), build do Worker, Playwright smoke, Gitleaks CLI, Knip, dependency-cruiser (regras de AGENTS §5: UI não importa persistência/segredos; features não importam Hono/React/SQL).
2. Consultivas: Semgrep CE; actionlint e zizmor quando um workflow mudar; Renovate com espera de 7–14 dias (pedir ao responsável que instale o app: é ação dele).
3. `.github/workflows` com `permissions: contents read`, ações fixadas por SHA, `bun install --frozen-lockfile`.
4. Tabela da matriz de gates (bloqueante/consultivo) no README do repositório; `bun run verify` espelha a camada bloqueante localmente.
**Testes:** PRs descartáveis, cada um com uma falha deliberada (erro de tipo, lint, segredo falso, export não usado, import proibido entre camadas) — cada check correto deve falhar e os demais passar.
**Aceite:** as cinco falhas são detectadas pelo check certo; PR limpo passa tudo.
**Fora do escopo / cuidados:** Socket, Scorecard, Graphify, CodeRabbit e CodeQL ficam fora. Sem branch protection garantida: o responsável só faz merge com checks verdes e confere isso manualmente.

### M0-06 — Vitest (Node e workerd), PG18 e Playwright
**Dependências:** M0-02, M0-04, M0-11 · **Estado:** `not_started`
**Objetivo:** testes de domínio, de Worker (workerd) e de persistência em Postgres 18 real rodam no checkout local e no CI com resultado reprodutível.
**Passos:**
1. Projetos Vitest separados: `unit` (Node), `workers` (`@cloudflare/vitest-plugin`) e `pg` (integração).
2. PG18 efêmero: contêiner `postgres:18` no CI e `docker compose` local (se Docker não rodar na máquina, registrar no ADR do M0-11). Helper que cria banco/schema isolado por arquivo de teste, aplica as migrations e limpa.
3. Teste de Worker que chama `/api/health/live` e outro que usa o binding Hyperdrive apontando ao PG local.
4. Teste de corrida de referência: N inserções paralelas na mesma chave única, exatamente uma vence; duas transações com `FOR UPDATE` se serializam. Servem de modelo para os marcos seguintes.
5. Playwright (Chromium) de fumaça: abre `/`, navega `/sobre`, chama a API.
**Testes:** os próprios acima, rodados em clone novo e no CI.
**Aceite:** `bun run test` e o smoke passam localmente e no CI; falha em um projeto não esconde os outros.
**Fora do escopo / cuidados:** sem Neon Production nem provedores reais nos PRs; mock não prova comportamento de SQL/workerd, então a persistência é sempre testada em PG18 real.

### M0-07 — Base visual com tokens OKLCH
**Dependências:** M0-02 · **Estado:** `verified` (CI; ver STATUS)
**Objetivo:** primitives e tema (claro/escuro/sistema) acessíveis, com contraste calculado, servindo uma página pública mínima.
**Passos:**
1. Tokens em três camadas OKLCH (marca → função → componente) em `src/styles/tokens.css`; variantes escurecidas para texto e ação; botão laranja com texto escuro. Hex da marca **PENDENTE (cliente: manual de marca em PDF e logo positivo)**: usar valores provisórios sinalizados.
2. Tailwind 4, shadcn com Base UI, Phosphor e Lexend Deca auto-hospedada (sem CDN de fontes); sem Geist Mono.
3. Button, Input, Field (rótulo, descrição, erro), ThemeToggle e um layout público. Tema aplicado sem script inline (compatível com a CSP do M1-05).
4. Teste que calcula a razão de contraste de cada par declarado, nos dois temas.
5. Regra WCAG 2.2.2: nenhum conteúdo em movimento automático por mais de 5 s sem pausa. Não se implementa adaptação a `prefers-reduced-motion` (decidido).
**Testes:** contraste ≥ 4,5:1 (texto) e ≥ 3:1 (componentes/foco) nos dois temas; axe (Playwright) sem violações; fluxo só por teclado (foco visível, ordem, rótulos).
**Aceite:** a página pública mínima passa nos três testes.
**Fora do escopo / cuidados:** sem design system amplo, Storybook nem CSS do legado (petróleo). Linguagem neutra ("Boas-vindas", "Pessoas inscritas"). Sem teste sobre prosa de documentação (`docs:check` do pacote antigo foi removido).

### M0-08 — Primeiro deploy em Staging com observabilidade mínima
**Dependências:** M0-03, M0-04, M0-05, M0-06, M0-18 · **Estado:** `homologated` em Staging e `verified` no CI (ver STATUS)
**Objetivo:** existe um candidato em Staging verificável: Worker real, Neon Staging, versão rastreável ao commit e logs sem dados pessoais.
**Passos:**
1. Deploy do Worker Staging por GitHub Actions com token restrito a Staging (nenhuma credencial de Production no GitHub). Domínio `*.workers.dev` até a zona do M0-09 estar ativa; hostname definitivo de Staging **PENDENTE (responsável)**.
2. `health/live` e `health/ready` devolvem `releaseId` (SHA); correlation id por requisição.
3. Logging mínimo conforme a ADR do M0-18 (evlog ou fallback), Workers Logs e, se aprovado, Sentry Free e Web Analytics; redaction de e-mail, token e cookie.
4. Rodar smoke e guardar a evidência (comando, resultado, SHA) em `docs/implementation/STATUS.md`.
**Testes:** `curl` em `live`/`ready`; falha proposital (Hyperdrive indisponível) vira alerta/log legível e `ready` retorna não-ok; varredura nos logs por e-mail/token de teste não encontra nada.
**Aceite:** SHA publicado == SHA do commit; `ready` consulta o Neon Staging.
**Fora do escopo / cuidados:** não declarar "pronto para produção". Sem Operations Center e alertas P0–P3 (M4). Bot Fight Mode desligado.

### M0-09 — Zona DNS na Cloudflare (só planejar e copiar; sem cutover)
**Dependências:** nenhuma (ação do responsável) · **Estado:** `deferred` até antes do M10 (decisão de 2026-10-10: desenvolver no domínio temporário; inventário público e ferramenta de paridade prontos; falta a exportação da zona e a criação da zona na Cloudflare; ver [dns-inventory-and-cutover](../operations/dns-inventory-and-cutover.md))
**Objetivo:** a zona de `neurocapacitar.com.br` está inventariada e replicada na Cloudflare com paridade comprovada, e `app.neurocapacitar.com.br` **continua apontando para o legado**.
**Passos:**
1. Com o responsável, identificar registrador, provedor de DNS atual e qual é a zona (provavelmente o domínio raiz; confirmar se o plano Free aceita delegar só o subdomínio — **PENDENTE (verificar)**).
2. Inventariar todos os registros (A/AAAA/CNAME/MX/TXT de SPF, DKIM, DMARC, verificações, CAA etc.) em tabela, sem tokens de verificação em texto no repositório; checar DNSSEC/DS no registrador.
3. Criar a zona Free na Cloudflare (estado pendente), importar e comparar **1:1** com o inventário; todos os registros em modo "somente DNS" (sem proxy).
4. Redigir o plano de troca de nameservers: janela, redução prévia de TTL, comparação por `dig` consultando os nameservers antigos e os da Cloudflare, rollback (restaurar os antigos), conferência de e-mail (SPF/DKIM/DMARC) depois.
5. A troca efetiva de nameservers é sub-etapa **autorizada à parte** pelo responsável.
**Testes:** script/tabela de paridade (registro a registro, TTL e valor) sem divergência; após a troca (se autorizada): resolução de `app.` idêntica à anterior e e-mail enviado/recebido passando SPF e DKIM.
**Aceite:** inventário e plano aprovados; paridade comprovada; nenhum registro novo do vNext criado para `app.`.
**Fora do escopo / cuidados:** não é o cutover (M10). Não ligar proxy nem mudar MX/SPF/DKIM. Se o importador da Cloudflare omitir registros, vale o inventário manual. Erro aqui derruba e-mail e o legado: nada de mudança sem janela e rollback.

### M0-10 — Spike 1: Better Auth + magic link + Hono + Hyperdrive + `pg` + Drizzle no workerd
**Dependências:** M0-03, M0-04 · **Estado:** `passou` ([ADR 0029](../adr/0029-spike-m0-10-better-auth-magic-link.md)) · **Timebox:** 2 dias · **Deve vir antes de:** M1-01
**Objetivo:** provar que o fluxo magic link → sessão em Postgres funciona no Worker real (Staging ou `wrangler dev` remoto) com a versão exata do Better Auth.
**Passos:**
1. Fixar a versão exata do Better Auth; montar `/api/auth/*` no Hono com `nodejs_compat`; instância, cliente `pg` e Drizzle criados por requisição; `advanced.database.validateSchema: false`, com o schema verificado no CI.
2. Plugin de magic link: link aponta para **página de confirmação** (a sessão só nasce em POST, nunca em GET); token de uso único e expiração curta; e-mail por um sender falso.
3. Sessão no PG com 7 dias rolling (`expiresIn`/`updateAge`), cookie cache desligado, rate limit com `storage: "database"` e `cf-connecting-ip`.
4. Medir: conexões abertas por requisição (sem vazamento), CPU de uma criação de senha (scrypt) e de um magic link, tempo total do fluxo.
5. Verificar se dá para impedir cadastro livre para e-mails de Staff e se o plugin captcha cobre Turnstile; se não, planejar verificação própria.
**Testes:** link usado duas vezes falha; link expirado falha; GET no link não cria sessão; 20 fluxos em sequência sem esgotar conexões; revogação de sessão é imediata.
**Aceite (passou):** todos os testes passam e a CPU medida cabe no limite do plano Paid. **Falha (reabrir decisão de auth, Q52/Better Auth):** não conclui o fluxo no workerd, vaza conexões, ou exige remendo não sustentável. A ADR lista o que foi medido; alternativas só são citadas, não adotadas.
**Fora do escopo / cuidados:** não construir telas finais nem as tabelas de domínio; sem Google/senha/passkey neste spike.

### M0-11 — Spike 2: Bun 1.4 no Windows + `@cloudflare/vitest-plugin` + dependency-cruiser sob TS 7
**Dependências:** M0-01, M0-02 · **Estado:** `not_started` · **Timebox:** 1 dia · **Deve vir antes de:** M0-05, M0-06
**Objetivo:** confirmar que o toolchain fixado roda na máquina Windows do desenvolvimento e no Linux do CI com o mesmo resultado.
**Passos:**
1. `bun install --frozen-lockfile` no Windows e no CI; comparar o lockfile gerado (`bun.lock`).
2. Rodar `@cloudflare/vitest-plugin` (workerd) com Vitest sob Bun e, se necessário, Node; Wrangler rodando em Node LTS.
3. dependency-cruiser sob TypeScript 7 (testar o extrator padrão e o swc) com uma regra que deve falhar.
4. Registrar versões exatas que funcionam (matriz testada) e se Docker/PG18 local roda.
**Testes:** os mesmos comandos passam em Windows e Linux; a regra do dependency-cruiser detecta um import proibido.
**Aceite (passou):** matriz de versões registrada e reproduzível. **Falha (reabrir Q51):** instalação ou plugin de teste não funciona de forma estável no Windows; a ADR diz o menor recuo (por exemplo, extrator swc, Node para testes, TypeScript anterior), a decidir com o responsável.
**Fora do escopo / cuidados:** não atualizar versões "por garantia"; fixar o que funcionou.

### M0-12 — Spike 3: latência do Neon (São Paulo × us-east) e orçamento de acordar o banco
**Dependências:** M0-02 · **Estado:** `not_started` · **Timebox:** 1 dia · **Deve vir antes de:** M0-04
**Objetivo:** escolher a região dos projetos Neon e dimensionar o Cron de 30 min e o tempo de "acordar" no Free.
**Passos:**
1. Criar dois projetos Neon descartáveis (São Paulo, se o plano Free permitir — **PENDENTE (verificar no console)**, e us-east), PG18.
2. Worker descartável via Hyperdrive medindo, por região: p50/p95 de uma query simples, de 5 queries sequenciais e o tempo da primeira query depois de ocioso (despertar).
3. Calcular o consumo: acordadas/dia × duração acordada × tamanho de computação, comparado ao gatilho de upgrade (70 CU-h/mês); medir com o cron proposto de 30 min.
4. Avaliar Smart Placement apenas se a diferença justificar.
**Testes:** pelo menos 30 amostras por cenário, com data/hora e resultado bruto na ADR.
**Aceite (passou):** região escolhida com números; orçamento mensal estimado abaixo do gatilho; despertar frio aceitável (limite proposto: p95 ≤ 5 s — ajustar com o responsável). **Falha (reabrir Q43):** o despertar ou o consumo inviabiliza o Neon Free; a ADR apresenta opções, sem contratar plano pago.
**Fora do escopo / cuidados:** apagar os projetos descartáveis; sem dados reais.

### M0-13 — Spike 4: player JMVStream real
**Dependências:** M0-02 · **Estado:** `not_started` · **Timebox:** 2 dias · **Deve vir antes de:** M5 (adapters de vídeo)
**Objetivo:** saber se o player JMVStream expõe duração, posição e `ended` de forma confiável e como funciona a restrição de domínio.
**Passos:**
1. Conta de teste e vídeo fornecidos pelo cliente (**PENDENTE (cliente)**); sem eles, marcar `blocked`.
2. Página descartável com o player; registrar eventos recebidos por `postMessage`, `event.origin`/`event.source`, duração e frequência de atualização de posição.
3. Testar `ended` (assistindo ao fim e saltando), seek, pausa, aba oculta, iPhone real em tela cheia.
4. Testar restrição de domínio em `localhost`, `*.workers.dev` e no domínio definitivo.
**Testes:** tabela evento × cenário × resultado, com capturas sem dados pessoais.
**Aceite (passou):** `ended` e duração confiáveis ou, se não, o adapter declara as capacidades que de fato existem. **Falha (reabrir Q36 para este provedor):** não há como obter posição/duração/`ended`; a ADR propõe rebaixar a capacidade ou retirar o adapter.
**Fora do escopo / cuidados:** não escrever o adapter final; não prometer anti-seek.

### M0-14 — Spike 5: webhook Asaas em sandbox
**Dependências:** M0-08 · **Estado:** `not_started` · **Timebox:** 2 dias · **Deve vir antes de:** M4 e M6
**Objetivo:** comprovar o contrato do Asaas que o desenho do financeiro assume.
**Passos:**
1. Conta sandbox (**PENDENTE (cliente)**) e endpoint descartável em Staging que valida `asaas-access-token`, grava o corpo bruto e **responde sempre HTTP 200**.
2. Criar Hosted Checkout (`POST /v3/checkouts`) e pagar com Pix e cartão de teste; registrar a sequência real de eventos e se `externalReference` chega nulo.
3. Correlacionar pelo id da sessão de checkout e reler o Payment pela API (`GET /v3/payments`, filtro `checkoutSession`).
4. Provocar duplicidade e ordem trocada; verificar o que acontece com respostas não-200 (risco de pausar a fila).
**Testes:** tabela evento × payload relevante × correlação possível; 100% das entregas respondidas 200.
**Aceite (passou):** correlação e releitura funcionam e o contrato fica registrado. **Falha (reabrir B4/Q28):** impossível correlacionar com segurança; a ADR traz opções, sem coletar cartão no Hub.
**Fora do escopo / cuidados:** sandbox apenas; nenhum dado real; token do webhook só em secret; não conceder acesso a partir de `CHECKOUT_PAID`.

### M0-15 — Spike 6: Browser Run gerando PDF com Lexend Deca
**Dependências:** M0-03 · **Estado:** `not_started` · **Timebox:** 1–2 dias · **Deve vir antes de:** M7
**Objetivo:** provar que um HTML/CSS A4 controlado vira PDF fiel, com a fonte da marca, via binding do Browser Run.
**Passos:**
1. Binding `BROWSER` e `quickAction("pdf", …)` num Worker descartável, com HTML próprio (sem links externos) e Lexend Deca embutida.
2. Verificar tamanho A4, fonte embutida no PDF, acentos, SHA-256 dos bytes e gravação num R2 de teste.
3. Medir tempo e comportamento sob falha (sessão derrubada, timeout) e repetição.
**Testes:** abrir o PDF em dois leitores; comparar posição de um campo com o HTML; texto com HTML malicioso aparece escapado.
**Aceite (passou):** PDF A4 fiel, fonte correta, tempo previsível. **Falha (reabrir Q15 / B7):** não gera fonte/tamanho corretos; a ADR avalia o plano B (gerar com biblioteca) sem adotá-lo.
**Fora do escopo / cuidados:** sem editor de certificado; sem fallback automático para serviço externo.

### M0-16 — Spike 7: transformação de imagens com fallback estático
**Dependências:** M0-08 (zona ativa do M0-09 se a transformação exigir) · **Estado:** `not_started` · **Timebox:** 1 dia · **Deve vir antes de:** M5 (mídia)
**Objetivo:** confirmar redimensionamento/formatos no Free e o comportamento quando as 5.000 transformações únicas do mês acabam.
**Passos:**
1. Verificar se a transformação por URL exige zona na Cloudflare (se sim, só a parte que exigir zona espera o M0-09, que foi adiado para antes do M10: testar no `workers.dev` o que for possível e registrar o resto como pendente).
2. Servir um objeto do R2 em duas variantes; confirmar cache e contagem de transformações únicas.
3. Simular o limite (erro de cota) e comprovar o fallback para a imagem original estática (`onerror` ou equivalente).
**Testes:** com cota "esgotada" simulada, a página continua exibindo a imagem; sem URL de variante pública para arquivo privado.
**Aceite (passou):** variante e fallback comprovados. **Falha:** transformação inviável no Free; a ADR propõe entregar apenas variantes pré-geradas no navegador (master editado), sem custo.
**Fora do escopo / cuidados:** sem Images Hosted; sem plano pago.

### M0-17 — Spike 8: HTMLRewriter e validadores de compartilhamento
**Dependências:** M0-08 · **Estado:** `not_started` · **Timebox:** 1 dia · **Deve vir antes de:** M2-06
**Objetivo:** provar que meta tags injetadas pelo Worker na SPA são lidas pelos validadores do LinkedIn e do Meta.
**Passos:**
1. Rota descartável em Staging público: busca o `index.html` dos assets e reescreve `title`, `description` e `og:*`/`twitter:*` com `HTMLRewriter`; a rota precisa estar em `run_worker_first`.
2. Testar no Post Inspector do LinkedIn e no depurador do Meta (pode exigir login pessoal do responsável: pedir a ele).
3. Verificar escape de aspas/HTML em título e descrição, cabeçalhos de cache e que slug inexistente não vaza nada.
**Testes:** prévia correta nos dois validadores; título com `"` e `<` aparece escapado.
**Aceite (passou):** ambos exibem título, descrição e imagem. **Falha:** algum validador não lê (por exemplo, exige HTML estático); a ADR propõe rota dedicada de HTML mínimo.
**Fora do escopo / cuidados:** sem SSR; só cursos e validação de certificado terão meta tags dinâmicas.

### M0-18 — Spike 9: evlog e Sentry 11 no Worker
**Dependências:** M0-02, M0-03 · **Estado:** `passou` ([ADR 0028](../adr/0028-spike-m0-18-evlog-e-sentry.md)) · **Timebox:** 1 dia · **Deve vir antes de:** M0-08
**Objetivo:** decidir o logging estruturado e o rastreio de erros do Worker, validando a maturidade do `evlog`.
**Passos:**
1. Integrar `evlog` num Worker descartável: evento amplo por requisição, correlation id, redaction de e-mail/token/cookie; checar manutenção, licença e tamanho.
2. Integrar Sentry 11 no Worker e no SPA (Free); confirmar filtro de dados pessoais e `beforeSend`.
3. Confirmar Workers Logs e Web Analytics no Free.
**Testes:** exceção proposital aparece no Sentry sem e-mail; log de uma requisição com e-mail e cookie de teste sai redigido.
**Aceite (passou):** ADR escolhe evlog ou logger próprio simples e define o conjunto mínimo. **Falha (reabrir Q54 em parte):** `evlog` ou Sentry não funcionam no workerd; a ADR adota `console` estruturado próprio + Workers Logs.
**Fora do escopo / cuidados:** Sentry Free tem 1 usuário; sem plano pago. Sentry não substitui auditoria financeira.

---

**Notas de migração.** M0-01..M0-08 mantidos e adaptados (Bun fixado; TypeScript estável; CI em duas camadas; Neon Free ×3; Hyperdrive sem cache; `run_worker_first`). Removidos do antigo M0-05: Socket e Dependabot (decisão Q50). Removido do antigo M0-07: script `docs:check` (decisão Q6/Q59: sem testes sobre prosa). Novos: M0-09 (DNS) e M0-10..M0-18 (spikes, decisão Q57).
