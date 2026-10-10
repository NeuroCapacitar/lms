# Testes

**Estado:** vigente desde o M0-06 (2026-10-10). Decisões: [ADR 0021](../adr/0021-repositorio-github-free-ci-duas-camadas.md), [ADR 0026](../adr/0026-spike-m0-11-bun-vitest-dependency-cruiser.md). Gates de CI: [README](../../README.md#matriz-de-gates-do-ci-m0-05).

## Projetos Vitest (`vitest.config.ts`)

| Projeto | Onde roda | Arquivos | Comando |
|---|---|---|---|
| `unit` | Node | `scripts/**/*.test.ts`, `src/**/*.test.ts`, `test/unit/**/*.test.ts` | `bun run test:unit` |
| `workers` | **workerd** (`@cloudflare/vitest-plugin`), Worker **construído** (`dist/hub`), Hyperdrive local apontando ao Postgres de teste | `test/workers/**/*.test.ts` | `bun run test:workers` (faz `bun run build` antes) |
| `pg` | Node, **Postgres 18 real** | `test/pg/**/*.test.ts` | `bun run test:pg` |

`bun run test` roda os três (com `build` antes). Falha em um projeto não esconde os outros: o Vitest roda todos e o CI tem um passo por projeto. `bun run test:e2e` roda o smoke do Playwright (Chromium) contra o build servido pelo `vite preview` com o banco de teste.

## Contraste e acessibilidade (M0-07)

- `test/unit/contrast.test.ts` lê `src/web/styles/tokens.css`, resolve as camadas de tokens em cada tema e calcula a razão de contraste WCAG (`test/helpers/color.ts`, OKLCH → sRGB, sem dependência). **Para proteger um novo par de cores, acrescente-o à lista `PAIRS`**: texto ≥ 4,5:1; borda de controle, ícone e anel de foco ≥ 3:1.
- `e2e/accessibility.spec.ts` roda o axe (WCAG 2.0/2.1/2.2 A e AA) nas páginas públicas nos temas claro, escuro e do sistema, o fluxo só por teclado e as regras de tema sem script inline, mesma origem e ausência de animação automática (WCAG 2.2.2). O axe não substitui leitor de tela real nem Firefox/Safari, que ficam para verificação manual.
- Tela nova: acrescente a rota à lista `PAGES` do spec.

## Banco de teste (Postgres 18 que pode ser destruído)

- **CI:** serviço `postgres:18` do Actions, `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`.
- **Local:** projeto Neon Free `hub-test` (São Paulo), URL em `.env.test` (ignorado pelo Git; ver `.env.example`). Esta máquina não tem Docker.
- Os testes **recusam** `TEST_DATABASE_URL` que aponte para o host de Development, Staging ou Production (`test/helpers/pg-schema.ts`). Nunca usar esses bancos em testes.
- **Isolamento:** `createTestSchema()` cria um schema `t_<aleatório>` por arquivo de teste, aplica as migrations do projeto nele (journal no mesmo schema) e `drop()` o remove. Arquivos em paralelo não se enxergam.
- Testes de corrida de referência em `test/pg/race.pg.test.ts` (N inserções paralelas na mesma chave única: exatamente uma vence; duas transações com `FOR UPDATE` se serializam sem perder atualização). Servem de modelo para matrícula, pagamento e certificado.

## Por que o projeto `workers` testa o Worker construído

No workerd, o `pg` (CommonJS) falha ao carregar no pipeline de módulos do plugin (`pg-protocol` resolve para `esm/index.js`, um arquivo ESM dentro de pacote CommonJS). O Worker construído já traz o `pg` empacotado e é exatamente o que vai para produção; o arquivo de teste não importa código do projeto, só chama o `fetch` do Worker. Consequência: `dist/hub` precisa estar construído (o script `test:workers` e o CI garantem).

## Prova de que os testes do Worker usam o banco de teste

Com `TEST_DATABASE_URL` inválida, o teste `health/ready` do projeto `workers` **falha**; portanto o binding Hyperdrive local segue a variável de teste, e não o `.env` de desenvolvimento.

## Outros testes

`bun run test:db` (node:test, só Development): roles de migração e runtime no banco de dev (ver [banco e migrações](database-and-migrations.md)); precisa de credenciais e não roda no CI.

## Regras

Persistência sempre em PG18 real (mock não prova SQL nem concorrência); sem Neon de Production nem provedores reais nos PRs; sem teste sobre prosa de documentação ou YAML.

## Identidade (M1-01)

- `test/pg/auth.pg.test.ts` usa a **mesma** `authOptions` de produção com o plugin `testUtils` do Better Auth (`test/helpers/auth.ts`), sobre um schema isolado do Postgres 18, e chama as rotas reais por `authRoutes()` montadas em `/api`. Sessão criada sem passar por método de login.
- **Armadilha:** com `NODE_ENV=test` (que o Vitest define) ou a variável `TEST`, o Better Auth **desliga a checagem de origem**; por isso `authOptions` fixa `disableOriginCheck: false`. Nunca defina `TEST` ou `NODE_ENV=test` no Worker.
- `src/server/auth/schema.test.ts` confere o schema Drizzle contra `getAuthTables()` (com `validateSchema: false` nada o confere em execução). Ao atualizar o Better Auth, rode-o primeiro.
- `tsconfig.integration.json` tipa os testes que importam `src/` com resolução `bundler` e tipos do Node.

## Pedido e confirmação de link (M1-06)

- `test/pg/link.pg.test.ts` monta `authRoutes({ emailSender, isStaffEmail, turnstileFetch, limits })` com substitutos (e-mail falso, Staff simulada, Turnstile simulado, limites pequenos) sobre Postgres 18 real. Nunca chama a rede nem envia e-mail.
- `e2e/login.spec.ts` simula o widget do Turnstile (rota do script) e as respostas da API; o build do Playwright usa a chave de **teste** da Cloudflare (`playwright.config.ts`).
- Para ver o link no desenvolvimento local, rode `bun run dev` sem `RESEND_API_KEY`: o link aparece no terminal (`[dev] e-mail para …`). Em Staging e Production a falta da chave é erro.

## CSRF, cabeçalhos e reautenticação (M1-05)

- `test/helpers/api-app.ts` monta `/api` como no Worker (cabeçalhos de segurança, CSRF, rotas de identidade): os testes de rota usam `apiApp()`, e toda mutação deles envia `Origin` e `Content-Type: application/json`.
- `test/pg/reauth.pg.test.ts` cobre o desafio ligado à sessão, o guard `requireRecentAuth` e a diferença entre `forbidden` e `reauth_required`.
- `e2e/security.spec.ts` confere os cabeçalhos de `public/_headers` e **zero violações de CSP** (`securitypolicyviolation`) em cada tela; tela nova entra na lista. O Turnstile e o Sentry são simulados.
- Os testes negativos de CSRF no navegador não enviam corpo: o proxy do `vite preview` falha de forma intermitente quando a resposta chega antes de o corpo ser lido (só local).
- Resposta `no-store` cujo corpo a interface não lê deixa a requisição aberta no Chromium e trava `waitForLoadState('networkidle')`: leia ou cancele o corpo.

## Convite de Staff e bootstrap (M1-04)

- `test/pg/staff-invitation.pg.test.ts` usa `apiApp()` e monta o Admin com **prova de reautenticação inserida direto** em `reauth_proof` (o fluxo do link já tem teste próprio em `reauth.pg.test.ts`). Aceite de ponta a ponta exige um usuário com e-mail verificado e uma sessão do próprio convidado.
- Testes de corrida precisam de **conexões separadas** (`openDatabase` por chamada): `tools.db` é uma conexão só e serializaria as duas transações, escondendo a corrida.
- O Drizzle embrulha o erro do `pg`: o nome da constraint violada fica em `error.cause` (ver `expectViolation`).
- `e2e/convite.spec.ts` simula a API; o aceite real fica coberto pelos testes em Postgres.

## Suspensão e corrida com login (M1-08)

- `test/pg/suspension.pg.test.ts` prova a corrida **sem depender de sorte**: duas conexões brutas (`database.client()`), uma segurando a transação aberta, e a outra tentando o login (ou a suspensão); confere que a segunda ESPERA (`settled` falso após 300 ms) e depois o resultado. Há também 15 rodadas de corrida real em conexões separadas.
- Para provar o gatilho sem passar pelo Better Auth, insere-se a sessão direto com o Drizzle; o erro do `pg` vem em `error.cause` (`code` 23001, mensagem `account_suspended`).
