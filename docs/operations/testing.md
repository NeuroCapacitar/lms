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
