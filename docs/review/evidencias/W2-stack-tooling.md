# W2 — Stack e tooling: estado atual (pesquisa de 2026-10-09)

> Pesquisa técnica para o NeuroCapacitar Hub vNext (LMS single-tenant em Cloudflare Workers). Data de referência: **2026-10-09**.
> Este documento **não** comprova implementação. Ele registra o estado das fontes oficiais e do registry npm nesta data.

## 0. Método, convenções e limitações

- **Versões e datas de publicação** foram lidas diretamente do registry npm com `npm view <pkg> version dist-tags time peerDependencies engines --json` (somente leitura) em 2026-10-09. A fonte citada é a página do pacote, `https://www.npmjs.com/package/<pkg>`.
- **Tags de release, licenças e issues do GitHub** foram lidas com `gh api repos/<owner>/<repo>/...` (leitura direta, sem busca), em 2026-10-09.
- **Documentação, changelogs e preços** foram lidos com WebFetch nas URLs oficiais citadas.
- **Limitação importante:** a cota de WebSearch compartilhada da sessão **esgotou no meio da pesquisa**. A partir daí só li URLs oficiais conhecidas diretamente, sem buscador. Os itens que dependiam de busca aberta estão marcados como **"não confirmado"**. Eles são listados na seção 14.
- Formato de citação: `[fonte: URL, lido em 2026-10-09]`. Nas tabelas, a coluna "Fonte" vale para a linha inteira.

---

## 1. Versões-chave (snapshot npm 2026-10-09)

Todas as linhas abaixo: [fonte: `npm view` em https://www.npmjs.com/package/<pacote>, lido em 2026-10-09]

| Pacote | `latest` (data) | Pré-release / observação relevante |
|---|---|---|
| react / react-dom | **19.3.0** (2026-09-09) | 19.2.0 em 2025-10-01 |
| vite | **8.3.4** (2026-10-08) | 8.0.0 em 2026-03-12; `previous` = 6.4.4 |
| rolldown | 1.2.13 (2026-10-07) | 1.0.0 em 2026-05-07 |
| @cloudflare/vite-plugin | **1.63.1** (2026-10-08) | `beta` **2.0.0-beta** publicado em 2026-10-09; peer `vite ^6.1 \|\| ^7 \|\| ^8`, `wrangler ^4.149.0` |
| wrangler | 4.149.0 (2026-10-08) | `engines.node >=22.0.0` |
| @tanstack/react-router | 1.170.41 (2026-09-30) | — |
| @tanstack/router-plugin | 1.168.42 | peer `vite >=5…>=8`, `node >=20.19` |
| @tanstack/react-query | 5.104.1 (2026-10-02) | — |
| @tanstack/react-start | 1.168.60 (2026-09-30) | peer `vite >=7`, `node >=22.12` (docs ainda dizem RC, ver §2.4) |
| hono | **4.13.13** (2026-10-04) | `next` = **5.0.0-rc.0** (2026-10-08) |
| @hono/zod-validator | 0.9.1 | peer `zod ^3.25 \|\| ^4`, `hono >=4.11.2` |
| zod | **4.6.5** (2026-09-13) | 4.0.0 em 2025-07-09 |
| drizzle-orm | **0.45.4** (2026-10-08) | `rc` = **1.0.0-rc.4** (2026-06-27); `beta` = 1.0.0-beta.22 |
| drizzle-kit | 0.31.11 (2026-09-21) | `rc` = 1.0.0-rc.4 |
| better-auth | **1.7.7** (2026-09-30) | 1.7.0 em 2026-08-18; linha `release-1.6` = 1.6.33 |
| @better-auth/passkey | 1.7.7 | peer `better-auth ^1.7.7` |
| @better-auth/infra | 0.4.16 | plugin `dash()` do serviço pago |
| typescript | **7.0.2** (2026-07-08) | `next` = 7.1.0-dev; 6.0.3 em 2026-04-16; 5.9.3 em 2025-09-30 |
| @typescript/typescript6 | 6.0.2 | alias oficial para manter a API JS do TS 6 |
| oxlint | **1.87.0** (2026-10-05) | peer opcional `oxlint-tsgolint >=7.0.2003` |
| oxlint-tsgolint | 7.0.2003 | type-aware via typescript-go |
| oxfmt | **0.72.0** (2026-10-05) | ainda **0.x**, com lançamentos semanais desde 2025-09 |
| ultracite | 7.12.4 (2026-10-05) | peers: `oxlint ^1.86`, `oxfmt >=0.59`, `@biomejs/biome ^2.5`, `eslint ^10.9`, `prettier ^3` |
| @biomejs/biome | 2.5.15 (2026-09-30) | — |
| knip | **6.41.0** (2026-10-09) | usa `oxc-parser`/`oxc-resolver`, sem dependência do `typescript` |
| dependency-cruiser | **18.5.0** (2026-09-30) | `engines.node ^22 \|\| ^24 \|\| >=26` |
| vitest | **5.0.3** (2026-09-30) | 5.0.0 em 2026-09-03; `V4` = 4.1.11 |
| @cloudflare/vitest-pool-workers | 0.23.0 (2026-10-07) | **DEPRECATED**: "renamed to @cloudflare/vitest-plugin"; peer `vitest ^4.1.0` |
| @cloudflare/vitest-plugin | **1.4.0** | criado em 2026-08-20; peer `vitest ^4.1.0 \|\| ^5.0.0` |
| @playwright/test | 1.64.0 (2026-10-07) | — |
| msw | **3.0.2** (2026-10-03) | 3.0.0 em 2026-09-28 |
| @msw/cloudflare | 0.2.0 | — |
| bun | **1.4.2** (2026-09-05) | 1.4.0 em 2026-08-20 |
| tailwindcss / @tailwindcss/vite | 4.3.3 (2026-07-16) | 4.3.0 em 2026-05-08 |
| shadcn (CLI) | 4.21.4 (2026-10-07) | — |
| @base-ui/react | **1.9.0** (2026-10-09) | 1.0.0 em 2025-12-11 |
| @phosphor-icons/react | 2.1.10 (**2025-05-22**) | sem release há cerca de 16 meses |
| sonner | 2.0.8 (2026-08-09) | — |
| react-hook-form | 7.89.0 (2026-09-26) | `beta` = 8.0.0-beta.4 |
| @tanstack/react-form | 1.33.5 (2026-08-11) | `alpha` 2.0.0 |
| @tiptap/react / core | 3.31.4 (2026-09-30) | v3 estável desde jul/2025 (3.0.1 em 2025-07-12) |
| @tiptap/static-renderer, @tiptap/html | 3.31.4 | render de JSON → HTML/React |
| lexical | 0.52.0 (2026-09-28) | ainda 0.x |
| platejs | 53.3.15 | `beta` 54 |
| @dnd-kit/core | 6.3.1 (**2024-12-05**) | sem release há cerca de 22 meses |
| @dnd-kit/react | 0.5.0 (2026-06-11) | ainda 0.x |
| @atlaskit/pragmatic-drag-and-drop | 4.0.0 (2026-09-24) | Apache-2.0 |
| react-easy-crop | 6.2.4 (2026-10-06) | MIT |
| @tanstack/react-table | **9.2.8** (2026-10-08) | 9.0.0 em 2026-08-04; v8 = 8.21.3 |
| @sentry/cloudflare / @sentry/react | **11.6.0** (2026-10-08) | 11.0.0 em 2026-09-23 |
| @sentry/hono | 11.6.0 | descrição oficial: "(ALPHA)" |
| resend | 6.32.1 (2026-10-06) | — |
| react-email | 6.11.1 | 6.0.0 em 2026-04-16 |
| vite-plugin-pwa | **2.0.0** (2026-10-03) | peer `vite …^8`, `workbox-build ^7.4.1` |
| serwist / @serwist/vite | 9.5.13 (2026-10-04) | `preview` = 10.0.0-preview.14; peer `typescript >=5` |
| workbox-build | 7.4.1 (2026-05-04) | 7.4.0 em 2025-11-19; cadência lenta |
| @electric-sql/pglite | 0.5.8 (2026-08-26) | — |
| testcontainers / @testcontainers/postgresql | 12.2.0 (2026-09-28) | — |
| pg-mem | 3.0.14 (2026-02-26) | — |
| pg | 8.23.1 | Hyperdrive exige `pg >8.16.3` (§2.8) |
| sanitize-html | 2.18.0 | — |
| typescript-eslint | 8.71.1 | peer `typescript >=4.8.4 <6.1.0` (**não suporta TS 7**) |

**Surpresa geral:** nas últimas 6 semanas saíram várias majors: Vitest 5 (set), MSW 3 (set), Sentry 11 (set), vite-plugin-pwa 2 (out), TanStack Table 9 (ago), Hono 5 RC (8 out) e @cloudflare/vite-plugin 2.0 beta (9 out). Um projeto iniciado agora pega o ecossistema no meio dessa transição.

---

## 2. Núcleo da aplicação

### 2.1 React
- A versão estável atual é **19.3.0**, publicada em 2026-09-09. O post oficial cita View Transitions, Fragment Refs, `browser()` e **Trusted Types** [fonte: https://react.dev/blog, lido em 2026-10-09].
- React 19.2 saiu em 2025-10-01 com Activity e `useEffectEvent`. O React Compiler v1.0 saiu em 2025-10-07 [fonte: https://react.dev/blog, lido em 2026-10-09].
- Em dez/2025 houve CVEs críticos em **React Server Components** (RCE não autenticada, corrigida em 19.0.1/19.1.2/19.2.1). Isso **não afeta uma SPA sem RSC**, mas reforça a decisão de não usar RSC [fonte: https://react.dev/blog, lido em 2026-10-09].
- Desde 2026-02-24 o React está sob a React Foundation (Linux Foundation) [fonte: https://react.dev/blog, lido em 2026-10-09].

### 2.2 Vite 8 / Rolldown
- O Vite 8 estável saiu em **2026-03-12**. O **Rolldown** passou a ser o único bundler, no lugar do par esbuild + Rollup. Há uma camada de compatibilidade que converte `esbuild`/`rollupOptions` [fonte: https://vite.dev/blog/announcing-vite8, lido em 2026-10-09].
- Requisitos: Node 20.19+ ou 22.12+. A instalação ficou cerca de 15 MB maior (lightningcss mais o binário do Rolldown). O Full Bundle Mode é experimental e a Environment API **ainda não é estável** [fonte: https://vite.dev/blog/announcing-vite8, lido em 2026-10-09].
- O `@vitejs/plugin-react` v6 removeu o Babel; o v5 ainda funciona com o Vite 8. Hoje o v6.1.2 tem peer `vite ^8.0.0` [fontes: https://vite.dev/blog/announcing-vite8 e https://www.npmjs.com/package/@vitejs/plugin-react, lidos em 2026-10-09].

### 2.3 @cloudflare/vite-plugin
- A versão estável é 1.63.1, com peer Vite 6/7/8. Um **2.0.0-beta** foi tagueado em 2026-10-09 [fonte: https://www.npmjs.com/package/@cloudflare/vite-plugin, lido em 2026-10-09].
- **Ambientes:** "you select a Cloudflare environment at dev or build time by providing the `CLOUDFLARE_ENV` environment variable". Definir `CLOUDFLARE_ENV` no `vite preview` ou no `wrangler deploy` "will have no effect". Isso confirma a regra do AGENTS.md de selecionar o ambiente **antes** do build [fonte: https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/, lido em 2026-10-09; página atualizada em 2026-04-23].
- A página do plugin cita "standard Build Output for `cf build` and `cf deploy`". Isso sugere um CLI `cf` novo. **Não investiguei**; o guia de início ainda usa `wrangler deploy` [fontes: https://developers.cloudflare.com/workers/vite-plugin/ (atualizada em 2026-09-30) e https://developers.cloudflare.com/workers/vite-plugin/get-started/, lidos em 2026-10-09].
- **SPA em Workers, um ponto crítico para o OAuth:**
  - Com `not_found_handling: "single-page-application"`, as requisições de **navegação** (`Sec-Fetch-Mode: navigate`) **não invocam o Worker**: recebem o `index.html`.
  - A própria documentação avisa que callbacks OAuth (navegação) precisam de tratamento. A solução é `run_worker_first: ["/api/*", …]`, que exige Wrangler ≥4.20 ou plugin ≥1.7.
  - Portanto `/api/auth/callback/google` **precisa** estar em `run_worker_first`.
  - [fonte: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/, lido em 2026-10-09; atualizada em 2025-08-25]

### 2.4 TanStack Router, Query e Start
- Router 1.170.41 e Query 5.104.1 estão estáveis e com releases frequentes [fonte: npm, ver §1].
- **TanStack Start:**
  - A documentação ainda diz: "TanStack Start is currently in the **Release Candidate** stage". Também diz que RSC estão "available as an experimental feature" [fonte: https://tanstack.com/start/latest/docs/framework/react/overview, lido em 2026-10-09].
  - O post do RC é de **2025-09-23** e não traz nota de 1.0 final [fonte: https://tanstack.com/blog/announcing-tanstack-start-v1, lido em 2026-10-09].
  - Ou seja, o Start está em **RC há mais de 12 meses**.
- Suporte Cloudflare ao Start: há um guia oficial (atualizado em 2026-10-08) com `cloudflare({ viteEnvironment: { name: "ssr" } })`, prerender e `env` de `cloudflare:workers` [fonte: https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/, lido em 2026-10-09].
- O Start tem "SPA mode": gera um shell `/_shell.html` e permite pré-renderizar rotas selecionadas, mantendo server functions [fonte: https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode, lido em 2026-10-09].
- **Vale trocar a SPA pelo Start? Avaliação (inferência minha):**
  - Áreas atrás de login não ganham nada com SSR.
  - As páginas públicas (catálogo e validação de certificado) precisam de `<title>`/OG corretos e de HTML indexável. Isso se resolve sem framework SSR de duas formas:
    - (a) o Worker usa `HTMLRewriter` para injetar meta tags no `index.html` em `/cursos/:slug` e `/certificados/:codigo` (listados em `run_worker_first`);
    - (b) o Hono gera um HTML mínimo para essas poucas rotas públicas.
  - A opção (b) pode colidir com a proibição de "SSR" no AGENTS.md §5 e **exigiria decisão explícita**.
  - Adotar o Start ainda em RC aumentaria o risco e contrariaria o AGENTS.md. **Recomendo manter a SPA** e reavaliar o Start só depois da 1.0 GA, via ADR.

### 2.5 Hono
- A estável é 4.13.13 (2026-10-04). Ela adiciona `hono/mount` e deprecia `app.mount()`, que "will be removed in v5". O **v5.0.0-rc.0** foi publicado em 2026-10-08, sem notas de mudanças [fonte: https://github.com/honojs/hono/releases, lido em 2026-10-09].
- **RPC (`hc`):**
  - A inferência exige rotas encadeadas e `export type AppType`.
  - Os status passados a `c.json(…, status)` entram no tipo de resposta, e `parseResponse()` lança `DetailedError` quando a resposta não é OK.
  - Apps grandes deixam o IDE lento. As recomendações são separar sub-apps com clientes distintos ou pré-compilar os tipos.
  - Path params e query sempre chegam como string.
  - [fonte: https://hono.dev/docs/guides/rpc, lido em 2026-10-09]
- **CSRF, um ponto de atenção:**
  - O middleware `hono/csrf` valida `Origin`/`Sec-Fetch-Site` **somente** em métodos inseguros com content-types de formulário (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`).
  - Requisições JSON **não** são verificadas por ele.
  - [fonte: https://hono.dev/docs/middleware/builtin/csrf, lido em 2026-10-09]
  - Consequência: para RPC JSON com cookie é preciso um middleware próprio. Ele deve exigir `Content-Type: application/json` e validar `Origin` contra a allowlist e/ou `Sec-Fetch-Site`, além de cookies SameSite=Lax.
- **secure-headers:** os defaults incluem HSTS, `X-Frame-Options: SAMEORIGIN`, `nosniff`, `Referrer-Policy: no-referrer` e COOP/CORP. CSP e Permissions-Policy vêm **desligados por padrão**. Há suporte a nonce. A documentação tem uma inconsistência entre `permissionPolicy` e `permissionsPolicy` [fonte: https://hono.dev/docs/middleware/builtin/secure-headers, lido em 2026-10-09].

### 2.6 Zod 4
- O Zod 4 é estável. Comparado ao v3, faz parse 6,5x a 14x mais rápido, gera cerca de 100x menos instanciações de TS e tem `zod/mini`. A customização de erro foi unificada em `error`. Formatos viraram funções de topo (`z.email()`), e existe `z.toJSONSchema()` nativo [fonte: https://zod.dev/v4, lido em 2026-10-09].
- A versão atual é 4.6.5 [fonte: https://www.npmjs.com/package/zod, lido em 2026-10-09].

### 2.7 Drizzle ORM / drizzle-kit
- **A v1 NÃO está GA.**
  - O `latest` é **0.45.4** (2026-10-08) e o drizzle-kit está em 0.31.11.
  - O canal `rc` está em **1.0.0-rc.4 (2026-06-27)**, sem RC novo há mais de 3 meses.
  - O GitHub não traz data de GA.
  - [fontes: https://www.npmjs.com/package/drizzle-orm e https://github.com/drizzle-team/drizzle-orm/releases, lidos em 2026-10-09]
- **O que muda na v1:**
  - O `journal.json` foi removido e as migrations são reorganizadas em pastas (`drizzle-kit up` converte).
  - Os snapshots passam a ser de DDL, com checagem de comutatividade entre branches.
  - O `drizzle-kit drop` foi removido.
  - Quem usa relational queries precisa migrar para o RQB v2 (`defineRelations`).
  - [fontes: https://orm.drizzle.team/docs/upgrade-v1 e https://orm.drizzle.team/docs/relations-v2, lidos em 2026-10-09]
- O RQB v1 foi **removido do dialeto Postgres no 1.0.0-rc.1**. No beta.20 houve uma correção de escaping em `sql.identifier()`/`sql.as()` com "possible SQL injection" [fonte: https://github.com/drizzle-team/drizzle-orm/releases, lido em 2026-10-09].
- O Better Auth aceita os dois: peer `drizzle-orm ^0.45.2 || >=1.0.0-rc.1 <2.0.0` [fonte: https://www.npmjs.com/package/better-auth, lido em 2026-10-09].

### 2.8 Hyperdrive + driver
- **O driver recomendado é node-postgres (`pg`).** A documentação diz que é "the recommended driver for Drizzle ORM with Hyperdrive". Drizzle com **Postgres.js é listado como problema conhecido e não suportado** [fonte: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/, lido em 2026-10-09; atualizada em 2026-10-01].
- É preciso `pg@>8.16.3` e `nodejs_compat`. Crie um `Client` **por requisição**: "Hyperdrive maintains the underlying database connection pool, so creating a new client is fast" [fonte: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/, lido em 2026-10-09].
- **Limites:**

  | | Free | Paid |
  |---|---|---|
  | Conexões de origem por config | ~20 | ~100 |
  | Configs por conta | 10 | 25 |

  - Statement com no máximo 60 s; cache de respostas até 50 MB.
  - Timeout de conexão inicial de 15 s e timeout de ociosidade de 10 min.
  - [fonte: https://developers.cloudflare.com/hyperdrive/platform/limits/, lido em 2026-10-09; atualizada em 2026-06-09]
- Evidência de campo: na issue better-auth#11276, um usuário com Start + Better Auth + Drizzle + Neon falhava no Cloudflare. O autor concluiu: "I should not use postgres library" [fonte: https://github.com/better-auth/better-auth/issues/11276, lido em 2026-10-09].

---

## 3. Better Auth

### 3.1 Versão e integração
- A versão é **1.7.7** (2026-09-30). A linha 1.7 estreou em 2026-08-18, e a linha 1.6 ainda recebe patches (1.6.33) [fonte: https://www.npmjs.com/package/better-auth, lido em 2026-10-09].
- **Hono/Workers:**
  - Monte com `app.all("/api/auth/*", c => auth.handler(c.req.raw))`.
  - Use CORS com origin explícita, `credentials: true` e a mesma origin em `trustedOrigins`.
  - "Better Auth uses `AsyncLocalStorage`", portanto `nodejs_compat` (ou `nodejs_als`) é necessário.
  - [fonte: https://better-auth.com/docs/integrations/hono, lido em 2026-10-09]
- **Sessão:**
  - O padrão é `expiresIn` de 7 dias com renovação após `updateAge` (1 dia). Isso bate com a decisão de sessão rolling de 7 dias.
  - `freshAge` vale 1 dia para endpoints sensíveis.
  - **Cookie cache:** os modos são `compact`/`jwt`/`jwe`. Aviso oficial: "revoked sessions may remain active on other devices until the cookie cache expires".
  - [fontes: https://better-auth.com/docs/concepts/session-management e https://better-auth.com/docs/reference/security, lidos em 2026-10-09]
- **Account linking:**
  - Vem ligado por padrão e liga contas quando o provedor confirma e-mail verificado.
  - `trustedProviders` liga contas mesmo sem verificação, com o aviso: "may increase the risk of account takeover".
  - Existe `disableImplicitLinking: true`.
  - [fonte: https://better-auth.com/docs/concepts/users-accounts, lido em 2026-10-09]
  - Isso é compatível com a regra "linking apenas por e-mail confiável/verificado", desde que **não** se use `trustedProviders` nem `allowDifferentEmails`.
- **CSRF:**
  - Faz validação de `Origin` contra `trustedOrigins` e usa Fetch Metadata para bloquear login CSRF.
  - Prefere requests "non-simple" (JSON).
  - Aviso: "Do not leave the localhost origin in a trusted origins list of a production auth instance".
  - Cookies são `Secure` (com HTTPS), `HttpOnly` e `SameSite=Lax`. Senha usa **scrypt** por padrão.
  - [fonte: https://better-auth.com/docs/reference/security, lido em 2026-10-09]
- **Rate limit:**
  - Ligado por padrão em produção (janela de 10 s, máximo de 100). `/sign-in/email` tem limite de 3 por 10 s.
  - Armazenamento em **memória é desaconselhado em serverless**. Use `storage: "database"` ou secondary storage.
  - Para o IP, configure `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`.
  - Requisições via `auth.api` no servidor **não** são limitadas.
  - [fonte: https://better-auth.com/docs/concepts/rate-limit, lido em 2026-10-09]
- **Passkeys:**
  - Pacote separado `@better-auth/passkey`, baseado em SimpleWebAuthn.
  - Suporta conditional UI (`autocomplete="username webauthn"`).
  - `rpID` não pode ser sufixo público. A página não declara nível de estabilidade.
  - [fonte: https://better-auth.com/docs/plugins/passkey, lido em 2026-10-09]

### 3.2 Problemas conhecidos relevantes para Workers e PG (issues abertas ou recentes)
- **#11651 (aberta, 2026-10-08):**
  - A validação de schema em runtime (default desde 1.7.3) pode **travar todas as requisições de auth do isolate** se a primeira requisição for cancelada.
  - Com `advanced.database.validateSchema: false` o problema não ocorre.
  - [fonte: https://github.com/better-auth/better-auth/issues/11651, lido em 2026-10-09]
- **#11346 (fechada em 2026-09-23):** a mesma validação, introduzida no 1.7.3, quebrava toda requisição no D1. É um exemplo de **regressão em patch release** [fonte: https://github.com/better-auth/better-auth/issues/11346, lido em 2026-10-09].
- **#11258 (fechada em 2026-09-12):** o `drizzleAdapter()` lia `db._.schema` de forma síncrona na construção e quebrava clientes Drizzle lazy [fonte: https://github.com/better-auth/better-auth/issues/11258, lido em 2026-10-09].
- **#11519 (aberta):**
  - Com rate limit em `database` no Postgres via `pg`, o `X-Retry-After` sai gigantesco, porque `int8` chega como string.
  - O bloqueio em si funciona.
  - [fonte: https://github.com/better-auth/better-auth/issues/11519, lido em 2026-10-09]
- **#11660 (aberta, 2026-10-09):** o rate limiter "empurra" a janela a cada requisição e rejeita tráfego abaixo do limite. O reporte é com storage em memória [fonte: https://github.com/better-auth/better-auth/issues/11660, lido em 2026-10-09].
- **#11555 (aberta):**
  - O plugin passkey gera um **user handle WebAuthn aleatório a cada registro**.
  - Gerenciadores como o 1Password passam a ver contas "diferentes".
  - [fonte: https://github.com/better-auth/better-auth/issues/11555, lido em 2026-10-09]
- **#11501 (aberta):** pede uma forma suportada de invalidar o cookie cache depois de atualizar a sessão. Isso confirma que o cookie cache e a revogação são frágeis [fonte: lista de issues via `gh api repos/better-auth/better-auth/issues`, lido em 2026-10-09].
- **Não confirmado:** custo de CPU do scrypt por login no Workers. A busca foi bloqueada pela cota. No plano Paid o limite de CPU é maior, mas recomendo medir no spike.

**Padrão recomendado (inferência a partir das fontes acima):**
1. Criar `pg.Client`, `drizzle(client)` e `betterAuth(...)` **por requisição**, ou usar uma factory barata por requisição.
2. Desligar `validateSchema` em Workers e validar o schema no CI.
3. Rate limit em `database`, com o header `cf-connecting-ip`.
4. Cookie cache desligado, ou `maxAge` curto e `disableCookieCache` em operações sensíveis. Isso é coerente com "deny-by-default no servidor".
5. Versão **pinada exata**, com upgrade só após rodar a suíte de auth.

### 3.3 Better Auth Infrastructure ("dash", Sentinel)
- É um serviço pago e opcional (`@better-auth/infra`, `dash()`): dashboard, auditoria e abuse protection (Sentinel) [fonte: https://better-auth.com/docs/infrastructure/introduction.md, lido em 2026-10-09].
- Preços na página oficial:

  | Plano | Preço | Inclui |
  |---|---|---|
  | Starter | **US$ 0** | 1 seat, 10k audit logs/mês com retenção de 1 dia |
  | Pro | **US$ 20/mês** | seats ilimitados, retenção de 7 dias, e-mail a US$ 0,001 e SMS a US$ 0,09 |
  | Enterprise | sob consulta | — |

  [fonte: https://better-auth.com/pricing, lido em 2026-10-09]
- **Conflito:** um snippet de busca de `landing.better-auth.com/pricing` mostrava US$ 10/49/299. A página falhou por certificado expirado e não pôde ser verificada. Prevalece a página principal.
- O core é "free and open source", com licença MIT no GitHub [fontes: https://better-auth.com/pricing e `gh api repos/better-auth/better-auth`, lidos em 2026-10-09].
- Implicação: o Infra envia dados de auth a um terceiro, o que é uma **decisão de privacidade**. Não é necessário na v1.

### 3.4 Alternativas (para centenas de usuários)

| Opção | Status/custo verificado | Trade-off |
|---|---|---|
| **Neon Auth / Managed Better Auth** | Construído sobre Better Auth 1.7.6. Dados no schema `neon_auth` do próprio banco. Free até 60k MAU. Só regiões AWS. Plugins/hooks limitados ("self-host Better Auth if you need custom plugins") [fonte: https://neon.com/docs/auth/overview, lido em 2026-10-09]. SDK `@neondatabase/auth` está em **0.5.0-beta** [fonte: https://www.npmjs.com/package/@neondatabase/auth, lido em 2026-10-09] | Acopla auth ao Neon e tem menos controle sobre plugins (passkey, rate limit). Pouco ganho frente ao self-host. |
| **Clerk** | Hobby: 50k MRU grátis, **sem passkeys**. Pro: US$ 25/mês (US$ 20 anual) [fonte: https://clerk.com/pricing, lido em 2026-10-09] | PII de alunos em SaaS externo, lock-in e passkeys só pagos. |
| **WorkOS AuthKit** | Grátis até **1M MAU**, inclui passkeys, MFA e social [fonte: https://workos.com/pricing, lido em 2026-10-09] | É a alternativa gerenciada mais forte em custo. Ainda é um processador externo de PII, com lock-in e sessão fora do PG (conflita com B-decisões). |
| **Lucia** | "Lucia was deprecated on March 2025" [fonte: https://github.com/lucia-auth/lucia, lido em 2026-10-09] | Descartar. |
| **Auth.js** | "The Auth.js project is now part of Better Auth" [fonte: https://authjs.dev/, lido em 2026-10-09] | Sem vantagem sobre o Better Auth. |
| **OpenAuth** | Último release 0.4.3 em **2025-03-04**, último push em 2025-07 [fonte: `gh api repos/anomalyco/openauth`, lido em 2026-10-09] | Parece parado. Descartar. |
| **Stack Auth** | Repo ativo; a descrição agora cita "Hexclave" [fonte: `gh api repos/stack-auth/stack-auth`, lido em 2026-10-09]. Preço e rebrand **não confirmados** | Não avaliado a fundo. |

**Conclusão:** o Better Auth self-hosted continua sendo a melhor opção para as decisões vigentes (sessão em PG, passkeys opcionais, sem PII em terceiros). Ele exige disciplina de versão e testes por causa das regressões em patches.

---

## 4. TypeScript 7

- **Está GA:** o post "Announcing TypeScript 7.0" é de **2026-07-08**. A versão atual no npm é 7.0.2, com o RC 7.0.1 em 2026-06-18 [fontes: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ e https://www.npmjs.com/package/typescript, lidos em 2026-10-09].
- É instalado como `typescript` e fornece o binário `tsc`. É o port nativo em Go, com builds completos 8x a 12x mais rápidos [fonte: https://devblogs.microsoft.com/typescript/?p=5246, lido em 2026-10-09].
- **Compatibilidade:** "made to be compatible with TypeScript 6.0's type-checking and command-line behavior". Código limpo no 6.0 (com `stableTypeOrdering` e sem `ignoreDeprecations`) deve compilar igual [mesma fonte].
- **Mudanças que quebram:**
  - `strict` passa a ser true por padrão.
  - `module` passa a `esnext` por padrão.
  - **`types` passa a `[]` por padrão**: é preciso listar `@cloudflare/workers-types`, `vite/client` etc.
  - `rootDir` passa a `./`.
  - `baseUrl`, `target: es5`, `moduleResolution: node/node10` e `downlevelIteration` agora são erro.
  - O JS/JSDoc foi reescrito.
  - [mesma fonte]
- **Não há API programática:** "TypeScript 7.0 is here, it does not ship with an API". A nova API está prevista para a 7.1. Ferramentas que embutem o compilador (Volar/Vue/Svelte/MDX, language service plugins) devem ficar no 6.0. O pacote **`@typescript/typescript6`** (`tsc6`) permite usar o 6.0 lado a lado via alias npm [mesma fonte].
- **Ecossistema:**
  - **typescript-eslint:** suporta `>=4.8.4 <6.1.0`. **Sem TS 7** [fonte: https://typescript-eslint.io/users/dependency-versions, lido em 2026-10-09]. É irrelevante se o lint for Oxlint.
  - **Oxlint type-aware:** **exige TypeScript 7.0+**, via `oxlint-tsgolint` (typescript-go). Cobre 59 de 61 regras type-aware do typescript-eslint. A opção `--type-check` pode substituir o `tsc --noEmit`. `baseUrl` não é suportado [fonte: https://oxc.rs/docs/guide/usage/linter/type-aware.html, lido em 2026-10-09].
  - **Knip v6:** trocou o compilador TS por `oxc-parser`/`oxc-resolver`. Não depende do TS 7 [fonte: https://knip.dev/blog/knip-v6, lido em 2026-10-09].
  - **dependency-cruiser:** a nota do v18.1.0 diz que "typescript@7.1.0 is expected to ship with a public API" e que essa será a primeira 7.x suportável. Desde o v18.1.0 há aviso em runtime quando o TypeScript, o Babel ou o swc estão indisponíveis. O extractor **swc** ganhou suporte a tsx/jsx e type-only imports no v18.3.0 [fonte: https://github.com/sverweij/dependency-cruiser/releases, lido em 2026-10-09].
  - Com TS 7 no projeto, use o extractor swc ou o alias `@typescript/typescript6` no dependency-cruiser. **Não testado.**
  - **Vite:** remove os tipos via Oxc e não depende da API do TS (inferência; o post do TS 7 não cita o Vite).
  - **Serwist:** peer `typescript >=5`. Se usar a API do TS no build, pode quebrar com o TS 7 (**não confirmado**).
  - **Editor:** há uma extensão VS Code para o TS 7, o suporte nativo está a caminho, e qualquer editor LSP funciona [fonte: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/, lido em 2026-10-09].
- **Recomendação para iniciar em out/2026:**
  - Use o **TS 7.0.x**. A stack não usa Vue/Svelte/MDX, nem language service plugins, nem emissão de `.d.ts` de biblioteca.
  - Garanta um `tsconfig` sem `baseUrl` e com `types` explícitos.
  - Tenha `@typescript/typescript6` como alias **somente se** alguma ferramenta exigir a API.
  - Valide no spike M0: `tsc -p`, Oxlint `--type-aware`, Knip, dependency-cruiser (swc), `wrangler types --check`, Hono RPC.
  - Fallback: TS 6.0.3.

---

## 5. Lint, formatação e fronteiras

- **Oxlint 1.87.0** é estável (1.0 em 2025-06-10) [fonte: https://www.npmjs.com/package/oxlint, lido em 2026-10-09]. O type-aware funciona como descrito em §4. A página do Oxlint não usa rótulo alpha/beta, diz apenas "Rule coverage is incomplete (but very close)". Limitações: consumo de memória e performance ainda em evolução [fonte: https://oxc.rs/docs/guide/usage/linter/type-aware.html, lido em 2026-10-09].
- **Oxfmt 0.72.0** ainda é **0.x**. A página não declara status: "aims to match Prettier's output… Unexpected differences are treated as bugs". Tem ordenação de imports e de classes Tailwind embutida e suporta JS/TS/JSON/YAML/TOML/CSS/Markdown e outros [fontes: https://oxc.rs/docs/guide/usage/formatter.html e https://www.npmjs.com/package/oxfmt, lidos em 2026-10-09]. O rótulo oficial (beta/estável) **não foi confirmado**.
- **Ultracite 7.12.4** suporta três providers: Biome; **Oxlint + Oxfmt**; ESLint + Prettier + Stylelint. Também gera regras e hooks para agentes (Claude Code etc.) [fontes: https://www.ultracite.ai/ e peers em https://www.npmjs.com/package/ultracite, lidos em 2026-10-09].
- **Biome 2.5.15:** o 2.5 (2026-06-05) trouxe "500 lint rules, plugin code fixes, cross-file linting". É uma ferramenta única para lint e formatação, com inferência de tipos própria [fonte: https://biomejs.dev/blog/, lido em 2026-10-09]. Esta é a alternativa se o Oxfmt 0.x se mostrar instável. Perde-se o type-aware baseado no compilador real.
- **Knip 6.41.0** tem plugins para **Wrangler, Vite, Vitest, Playwright, Drizzle, TanStack Router, Oxlint e dependency-cruiser** [fonte: https://knip.dev/reference/plugins, lido em 2026-10-09].
- **dependency-cruiser 18.5.0:**
  - Regras de dependência validadas (camadas e features).
  - Desde o v18.2.0 aceita config em TS, e desde o v18.3/18.4 tem baseline.
  - O v18.0.0 removeu o suporte a Node 20.
  - [fonte: https://github.com/sverweij/dependency-cruiser/releases, lido em 2026-10-09]
- **Alternativas para fronteiras:** eslint-plugin-boundaries 7.2.0 exige ESLint [fonte: https://www.npmjs.com/package/eslint-plugin-boundaries, lido em 2026-10-09]. Ele não combina com uma stack sem ESLint.
- **Evitar sobreposição (recomendação):**

  | Ferramenta | Papel único |
  |---|---|
  | Oxlint | lint e regras type-aware |
  | Oxfmt | formatação |
  | Knip | arquivos, exports e dependências não usados |
  | dependency-cruiser | fronteiras arquiteturais e ciclos |

  - Desligue as regras de import cycle no Oxlint, ou não use `no-circular` no depcruise. Escolha **um**.
  - O Ultracite serve só como preset de partida, e a configuração final deve ser versionada.

---

## 6. Testes

- **Vitest 5.0** saiu em 2026-09-03.
  - Ganhos de 8% a 53% de wall-clock frente ao 4.1.
  - `clearMocks` passa a true por padrão. Asserções async sem `await` agora falham. Locators estritos.
  - Requisitos: Vite ≥6.4 e Node ≥22.12.
  - [fonte: https://vitest.dev/blog/vitest-5, lido em 2026-10-09]
- **Mudança importante: `@cloudflare/vitest-pool-workers` está DEPRECATED.**
  - Mensagem no npm: "has been renamed to @cloudflare/vitest-plugin. This package will not receive future updates".
  - A última versão (0.23.0) tem peer **`vitest ^4.1.0`**, ou seja, não roda com Vitest 5.
  - O substituto **`@cloudflare/vitest-plugin` 1.4.0** aceita `vitest ^4.1.0 || ^5.0.0`.
  - [fontes: https://www.npmjs.com/package/@cloudflare/vitest-pool-workers e https://www.npmjs.com/package/@cloudflare/vitest-plugin, lidos em 2026-10-09]
  - Migração: codemod `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`. A API e a configuração não mudam. Para mock de saída, use `@msw/cloudflare` [fonte: https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/, lido em 2026-10-09; atualizada em 2026-08-20].
  - A integração mantém "isolated per-test-file storage" [fonte: https://developers.cloudflare.com/workers/testing/vitest-integration/, lido em 2026-10-09].
- **Postgres real em testes:**

  | Opção | Prós | Contras |
  |---|---|---|
  | **Testcontainers** (`@testcontainers/postgresql` 12.2.0) | Postgres real com a **imagem exata** (PG 18), com `snapshot()`/`restoreSnapshot()` entre testes [fonte: https://node.testcontainers.org/modules/postgresql/, lido em 2026-10-09] | Exige Docker (Docker Desktop no Windows e runners Linux no CI) e é mais lento. |
  | **PGlite** 0.5.8 | WASM, sem Docker, rápido | "only has a single exclusive connection" [fonte: https://pglite.dev/docs/, lido em 2026-10-09]. Versão embutida do PG (17 ou 18) **não confirmada**. Não testa locks, concorrência nem fencing. |
  | **pg-mem** 3.0.14 | Em memória, rápido | É um emulador, não Postgres. Último release em fev/2026 [fonte: https://www.npmjs.com/package/pg-mem, lido em 2026-10-09]. Inadequado para constraints, locks e migrations reais. |

  - Recomendação: **Testcontainers com postgres:18** para integração, migrations e concorrência (financeiro e entitlement). PGlite fica opcional para testes de query rápidos. Evitar pg-mem.
- **Playwright 1.64:** browsers Chromium 156, Firefox 157 e WebKit 27.2. Novidades: `--shuffle`, named test locks (1.63) [fonte: https://playwright.dev/docs/release-notes, lido em 2026-10-09]. O WebKit é útil para os cenários PWA/Safari, mas **não substitui o iOS real**.
- **MSW 3.0** saiu em 2026-09-30, com ESM e uma nova abordagem de interceptação [fonte: https://mswjs.io/blog, lido em 2026-10-09]. Detalhes de breaking **não confirmados**.

---

## 7. Bun, Node e Wrangler

- **Bun 1.4** saiu em 2026-08-20 (atual 1.4.2):
  - "Bun's source moved from **Zig to Rust**". É uma mudança interna grande, com risco de regressões.
  - Corrige mais de 2.900 issues.
  - No Windows: startup e memória menores, build ARM64 nativo.
  - Breaking no Windows: códigos de erro `fs` passam a ser os do libuv (`-4058` para ENOENT).
  - Novo `lockfileVersion: 2`, com hashes SHA-512 para deps git/tarball.
  - Isolated installs **não** são o padrão.
  - [fonte: https://bun.com/blog/bun-v1.4, lido em 2026-10-09]
- Windows 10 1809+ e x64/ARM64 são suportados [fonte: https://bun.com/docs/installation, lido em 2026-10-09].
- `bun run` **respeita o shebang `#!/usr/bin/env node`**, executando com Node, salvo `--bun`. No Windows os scripts rodam pelo Bun Shell [fonte: https://bun.com/docs/cli/run, lido em 2026-10-09]. Na prática, Vite e Wrangler continuam rodando no Node, o que é bom.
- **Dependabot + Bun:** suporta version updates (Bun ≥1.1.39), mas **não suporta security updates** [fonte: https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories, lido em 2026-10-09].
- **Renovate + Bun:** o manager `bun` cobre `bun.lock` e `bun.lockb` [fonte: https://docs.renovatebot.com/modules/manager/bun/, lido em 2026-10-09].
- **Node:**

  | Versão | Status atual | Próxima fase | EOL |
  |---|---|---|---|
  | 24.x (Krypton) | Active LTS | **Maintenance a partir de 2026-10-20** | 2028-04-30 |
  | 26.x | Current | **Active LTS em 2026-10-28** | 2029-04-30 |
  | 22.x | Maintenance | — | 2027-04-30 |

  [fonte: https://github.com/nodejs/Release, lido em 2026-10-09]
- **Wrangler** exige Node ≥22 [fonte: https://www.npmjs.com/package/wrangler, lido em 2026-10-09]. Os `engines` de Vitest 5 e dependency-cruiser aceitam 22/24/26 [fonte: npm, §1].
- **Recomendação:**
  - Node 24 é seguro para tooling hoje (suportado até abr/2028). Agende a avaliação do Node 26 depois de 2026-10-28.
  - Bun como **gerenciador de pacotes pinado** (`packageManager`, versão exata) é aceitável, mas a reescrita para Rust aumenta o risco. Teste `bun install --frozen-lockfile` no Windows e no Linux do CI.
  - Para um dev júnior no Windows, **pnpm é a escolha mais conservadora**. A troca é barata no início.

---

## 8. GitHub Free (organização, repo privado) e ferramentas de segurança

### 8.1 O que o plano Free oferece em repo privado

| Recurso | Free org, repo **privado** | Repo **público** | Fonte |
|---|---|---|---|
| Actions | 2.000 min/mês; 500 MB de artifacts; 10 GB de cache/repo; Linux 2-core a US$ 0,006/min | Gratuito em runners padrão | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| Protected branches / required reviewers / CODEOWNERS | **Não** (listados em Team: "Advanced tools… in private repositories") | Sim | https://docs.github.com/en/get-started/learning-about-github/githubs-plans |
| Repository rules (rulesets) | **Não**: a tabela de preços marca "Public repositories" para o Free | Sim | https://github.com/pricing |
| Environments (protection rules, required reviewers) | **Não**. "Environments can only be configured for public repositories" no Free; no privado, regras e **environment secrets são ignorados** | Sim | https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment |
| Organization secrets | **Não**: "Organization-level secrets and variables are not accessible by private repositories for GitHub Free" | Sim | https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets |
| Secret scanning / push protection | **Não**. Exige GitHub Secret Protection, que só orgs Team/Enterprise podem comprar | Grátis | https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security |
| Code scanning / CodeQL / upload de SARIF | **Não**. Exige GitHub Code Security (Team/Enterprise) | Grátis | idem e https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github |
| Dependabot alerts | Sim (listado no Free sem ressalva de público) | Sim | https://docs.github.com/en/get-started/learning-about-github/githubs-plans |
| Dependabot security updates para **Bun** | **Não suportado** para o ecossistema Bun | — | §7 |
| Dependency review | Não (exige Code Security) | **Também não é grátis**, segundo a tabela | about-github-advanced-security (acima) |

Todas as linhas: lido em 2026-10-09.

- **GitHub Team** custa US$ 4/usuário/mês. Inclui protected branches, required reviewers e environments em privado, com 3.000 min de Actions. Secret Protection e Code Security continuam sendo **add-ons à parte**, com preço não exibido nas páginas lidas [fontes: https://github.com/pricing e githubs-plans, lidos em 2026-10-09].
- **Comparação com o legado público:** o repo público ganha de graça secret scanning, push protection, CodeQL, rulesets, environments e Actions ilimitado em runners padrão. O preço é expor o código. Isso confirma o alerta do AGENTS.md de que no Free privado esses controles **não existem**.

### 8.2 Ferramentas
- **Renovate (Mend-hosted Community Cloud):**
  - **Grátis para repos privados**, "unlimited number of public and private repositories".
  - Limites do plano gratuito: 1 job concorrente por org, execução a cada 4 h, timeout de 30 min. Merge Confidence não está incluído.
  - [fonte: https://docs.renovatebot.com/mend-hosted/overview/, lido em 2026-10-09]
  - O Renovate está em 44.149.0, sob AGPL-3.0 (irrelevante para o uso via app) [fonte: `gh api repos/renovatebot/renovate`, lido em 2026-10-09].
- **gitleaks-action:**
  - "GITLEAKS_LICENSE … required for organizations, not required for user accounts". A licença é gratuita mas exige cadastro com nome, e-mail e empresa [fonte: https://github.com/gitleaks/gitleaks-action, lido em 2026-10-09].
  - **Alternativa:** o CLI `gitleaks` (MIT, v8.30.1 de 2026-03-21) rodado diretamente no workflow e em pre-commit, sem licença [fonte: `gh api repos/gitleaks/gitleaks`, lido em 2026-10-09].
  - TruffleHog v3.99.2 é **AGPL-3.0** e também roda como CLI [fonte: `gh api repos/trufflesecurity/trufflehog`, lido em 2026-10-09].
- **Semgrep:**
  - O CLI CE (v1.180.0) é LGPL-2.1 [fonte: `gh api repos/semgrep/semgrep`, lido em 2026-10-09].
  - As regras do registry seguem a Semgrep Rules License v1.0, que permite uso "only for your own internal business purposes", sem redistribuição nem SaaS [fonte: https://semgrep.dev/legal/rules-license, lido em 2026-10-09]. Isso é OK para uso interno.
  - O **plano Free da AppSec Platform** cobre até **10 contributors e 10 repos privados**, com cross-file e regras Pro. O Teams custa US$ 30 por contributor/mês [fonte: https://semgrep.dev/pricing, lido em 2026-10-09].
  - Sem Code Security, o SARIF **não sobe** no repo privado. Use a saída no console e falhe o job.
- **zizmor v1.30.1** (MIT) [fonte: `gh api repos/zizmorcore/zizmor`, lido em 2026-10-09]. Em repo privado sem GHAS, use `advanced-security: false` no `zizmor-action`. Os resultados vão para o console, "without any issues or feature limitations" [fonte: https://github.com/zizmorcore/zizmor-action, lido em 2026-10-09].
- **actionlint v1.7.12** (2026-03-30, MIT), ativo [fonte: `gh api repos/rhysd/actionlint`, lido em 2026-10-09].
- **Socket.dev:** a página de preços retornou **HTTP 403**, e a doc da GitHub app não menciona preço. O plano free para org privada está **não confirmado** [fontes: https://socket.dev/pricing e https://docs.socket.dev/docs/socket-for-github, tentados em 2026-10-09].

---

## 9. PWA (Vite) e iOS/Safari

- **vite-plugin-pwa 2.0.0** (2026-10-03):
  - Peer Vite até 8 e `workbox-build ^7.4.1`.
  - As notas de breaking são escassas; o ⚠️ marcado é a aceitação de `@vite-pwa/assets-generator` ^2.
  - O suporte a Vite 8 chegou no 1.3.0.
  - [fontes: https://github.com/vite-pwa/vite-plugin-pwa/releases e https://www.npmjs.com/package/vite-plugin-pwa, lidos em 2026-10-09]
- **Workbox 7.4.1:** as releases são espaçadas (nov/2025 e mai/2026) [fonte: https://www.npmjs.com/package/workbox-build, lido em 2026-10-09].
- **Serwist 9.5.13:**
  - Tem `@serwist/vite`, com precaching, runtime caching e `BackgroundSyncQueue`. A v10 está em preview.
  - [fontes: https://serwist.pages.dev/ e https://www.npmjs.com/package/serwist, lidos em 2026-10-09]
  - É um projeto menor (cerca de 1,5k estrelas) [fonte: `gh api repos/serwist/serwist`, lido em 2026-10-09].
- **Recomendação:** vite-plugin-pwa em modo **`injectManifest`**, com service worker próprio e pequeno. O controle explícito importa por causa do cache por usuário e do logout. Serwist é uma alternativa equivalente.
- **Limites do WebKit:**
  - Quota por origem: até 60% do disco em apps de navegador e 15% em outros apps. A **eviction é LRU e best-effort**.
  - `navigator.storage.persist()` é concedido por heurística e favorece apps na tela inicial, sem garantia.
  - [fonte: https://webkit.org/blog/14403/updates-to-storage-policy/ (2023-08-10), lido em 2026-10-09]
  - O Safari apaga **todo o storage gravável por script, incluindo os caches do service worker, após 7 dias de uso sem interação** com o site. Apps na tela inicial têm contador próprio e são exceção [fonte: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (2020), lido em 2026-10-09].
  - Isso combina com o lease de 72 h, que deve **sempre** tolerar a perda do cache.
- **Background Sync:** "Limited availability… not Baseline". Na prática não existe no Safari nem no Firefox, segundo conhecimento geral e a ressalva do MDN. Faça feature-detect e use fallback no `online`/`visibilitychange`/abertura do app [fonte: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API, lido em 2026-10-09].
- **Logout e troca de usuário:**
  - `Clear-Site-Data` é "Baseline Widely available… since September 2023", com "Some parts… varying levels of support", e só funciona em HTTPS [fonte: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data, lido em 2026-10-09].
  - **Padrão recomendado (inferência):**
    - Caches e bancos IndexedDB **nomeados por `userId`**.
    - No logout: `postMessage` ao SW, apagar caches e IDB do usuário, e responder o logout com `Clear-Site-Data: "cache", "storage"`.
    - Nunca cachear `/api/auth/*` nem respostas com dados sensíveis sem chave do usuário.
    - A outbox fica no IDB do usuário, com allowlist de comandos.
    - Testar no WebKit (Playwright) e em **iPhone real**.

---

## 10. UI

- **shadcn/ui:**
  - "Starting today, **Base UI is the default component library in shadcn/ui**" (julho de 2026). O Radix "is not being deprecated". `-b radix` mantém o Radix, e os componentes ficam em paridade.
  - A migração é feita via skill de agente, componente a componente.
  - [fonte: https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default, lido em 2026-10-09]
  - O CLI v4 saiu em mar/2026 [fonte: https://ui.shadcn.com/docs/changelog, lido em 2026-10-09].
- **Base UI:**
  - A **v1.0.0 estável saiu em 2025-12-11**, e a atual é a 1.9.0 (2026-10-09). Há releases mensais, sem breaking declarado.
  - Atenção: o v1.5.0 renomeou `sanitizeValue` para `normalizeValue`.
  - O pacote é `@base-ui/react`. O antigo `@base-ui-components/react` parou em 1.0.0-rc.0.
  - [fontes: https://base-ui.com/react/overview/releases e npm, lidos em 2026-10-09]
- **Tailwind CSS:**
  - A versão é 4.3.3. A 4.3 (2026-05-08) trouxe scrollbars, utilitários lógicos e novas cores.
  - **Tailwind Labs se juntou à Shopify** em 2026-09-09.
  - [fonte: https://tailwindcss.com/blog, lido em 2026-10-09]
- **Phosphor (@phosphor-icons/react 2.1.10):**
  - Suporta tree-shaking, e os nomes têm sufixo `Icon` (`HouseIcon`).
  - Para builds de dev rápidos, importe por arquivo (`@phosphor-icons/react/dist/csr/BellSimple`).
  - Evite `import *`.
  - [fonte: https://github.com/phosphor-icons/react, lido em 2026-10-09]
  - Risco baixo a médio: **sem release desde 2025-05-22** [fonte: npm, §1].
- **Toasts:** a versão é sonner 2.0.8. A página Base UI "Sonner" do shadcn não confirma se o Sonner ainda é o padrão, e o changelog de julho/2026 cita "Toast". **Não confirmado** se o Toast do Base UI substituiu o Sonner [fontes: https://ui.shadcn.com/docs/components/base/sonner e /docs/changelog, lidos em 2026-10-09].
- **Formulários:** o shadcn documenta **React Hook Form, TanStack Form e Formisch**, sem recomendação explícita [fonte: https://ui.shadcn.com/docs/forms, lido em 2026-10-09].
  - RHF está em 7.89 (v8 em beta); TanStack Form em 1.33.
  - Sugestão para equipe júnior: RHF + Zod, pelo volume de material, ou TanStack Form pela tipagem. **Escolha uma só.**
- **Rich text:**
  - **TipTap:** "Tiptap Editor is open source (MIT) and free". Pagos: colaboração, comentários, AI e conversão de documentos. Planos: Start US$ 49 a 59/mês, Team US$ 149 a 179, Business US$ 999 a 1.199 [fonte: https://tiptap.dev/pricing, lido em 2026-10-09]. A v3.31.4 é MIT [fonte: `gh api repos/ueberdosis/tiptap`, lido em 2026-10-09].
  - Alternativas: Lexical 0.52 (MIT, ainda 0.x) e Plate 53 (MIT, baseado em Slate) [fonte: npm, §1].
  - **Renderização segura (recomendação):**
    - Armazenar o **JSON ProseMirror validado por schema (Zod)** e renderizar com `@tiptap/static-renderer` ou `@tiptap/html` (3.31.4) usando apenas os nós e marcas permitidos [fonte: https://www.npmjs.com/package/@tiptap/static-renderer, lido em 2026-10-09].
    - Validar links (`https:`/`mailto:` apenas).
    - O DOMPurify depende de DOM e não roda no Workers sem polyfill (inferência). Se for preciso sanitizar HTML no servidor, use `sanitize-html` 2.18.
    - Combinar com CSP e, opcionalmente, **Trusted Types**, agora suportados pelo React 19.3 [fonte: https://react.dev/blog, lido em 2026-10-09].
- **Drag-and-drop:**
  - `@dnd-kit/core` 6.3.1 está **sem release desde dez/2024**. O novo `@dnd-kit/react` está em 0.5.0 (pré-1.0) [fonte: npm, §1].
  - O README destaca a nova arquitetura (`@dnd-kit/abstract`, `@dnd-kit/dom`) [fonte: https://github.com/clauderic/dnd-kit, lido em 2026-10-09].
  - **Pragmatic DnD 4.0.0** (Atlassian, Apache-2.0, 2026-09-24) é a alternativa ativa [fonte: npm, §1].
  - Para reordenar módulos e aulas, ofereça também botões "subir/descer" acessíveis, por WCAG 2.2 (2.5.7 Dragging Movements).
- **Crop:** react-easy-crop 6.2.4 (MIT), ativo [fonte: npm, §1].
- **Tabelas:** a **TanStack Table v9** é GA desde 2026-08-04, e a v8 parou em 8.21.3 [fonte: npm, §1]. Exemplos "data table" do shadcn ainda em v8: **não confirmado**. Começar na v9 evita uma migração futura, mas há menos material.

---

## 11. Observabilidade

- **Sentry:**
  - SDKs na v11 (11.0.0 em 2026-09-23) [fonte: npm, §1].
  - A configuração recomendada para Workers é `sentryCloudflareVitePlugin` com `autoInstrumentation`, que embrulha o entry, os Durable Objects e os Workflows.
  - Exige `nodejs_compat` (AsyncLocalStorage). Source maps via `upload_source_maps: true`.
  - **Limitação:** spans CPU-bound aparecem com 0 ms, porque o relógio do Workers só avança após I/O.
  - Hono tem pacote próprio, `@sentry/hono`, que está **em ALPHA** segundo o npm.
  - [fontes: https://docs.sentry.io/platforms/javascript/guides/cloudflare/ e https://www.npmjs.com/package/@sentry/hono, lidos em 2026-10-09]
- **Preços Sentry:**

  | Plano | Preço | Inclui |
  |---|---|---|
  | Developer | US$ 0 | **1 usuário**, 5k erros, 5M spans, **50 replays**, 5 GB de logs, 30 dias |
  | Team | US$ 26/mês (anual) | usuários ilimitados, 50k erros, até 90 dias |
  | Business | US$ 80/mês | — |

  [fonte: https://sentry.io/pricing/, lido em 2026-10-09]
- **Cloudflare nativo:**
  - Workers Logs: o Paid inclui 20M eventos/mês, com retenção de 7 dias e excedente a US$ 0,60 por milhão. O Free inclui 200k/dia com 3 dias.
  - **"Starting December 1, 2026, Workers Logs moves to Cloudflare Observability pricing"**. Os novos valores **não foram confirmados**.
  - [fonte: https://developers.cloudflare.com/workers/observability/logs/workers-logs/, lido em 2026-10-09]
  - Traces: tracing automático "in early beta", retenção de 7 dias e export OTel (Honeycomb, Grafana, Axiom) [fonte: https://developers.cloudflare.com/workers/observability/traces/, lido em 2026-10-09].
- **Alternativas:**
  - **Better Stack:** o free inclui 100k exceções/mês, "Sentry SDK-compatible", logs de 3 GB com 3 dias e 10 monitores de uptime [fonte: https://betterstack.com/pricing, lido em 2026-10-09].
  - **Axiom:** o free (Personal) inclui 500 GB/mês com 30 dias; o próximo plano custa US$ 25/mês mais uso [fonte: https://axiom.co/pricing, lido em 2026-10-09].
  - Highlight.io (adquirido?): **não confirmado**.
- **Recomendação:**
  - Workers Logs, que já está no Paid, mais o Sentry para erros de front e back.
  - Se mais de uma pessoa precisar triar, o Developer (1 usuário) não basta. As opções são o Team (US$ 26/mês) ou o Better Stack com o SDK Sentry.
  - Configurar scrubbing de PII (`dataCollection`, `beforeSend`).
  - Replays só com mascaramento total, ou desligados.

---

## 12. E-mail (Resend e alternativas)

- **Preços Resend (transacional):**

  | Plano | Preço | Volume | Domínios |
  |---|---|---|---|
  | Free | US$ 0 | 3.000/mês com **limite de 100/dia** | 3 |
  | Pro | US$ 20/mês | 50k/mês (US$ 35 para 100k), sem limite diário | 10 |
  | Scale | a partir de US$ 90 | — | — |

  - Marketing: grátis até 1.000 contatos; Pro a partir de US$ 40/mês para 5.000.
  - Retenção de 30 dias. IP dedicado só no Scale, por US$ 30/mês.
  - [fonte: https://resend.com/pricing, lido em 2026-10-09]
- **Templates hospedados:**
  - "full version history". O template precisa estar **publicado** para enviar, e o envio é via objeto `template: { id, variables }`.
  - A página não declara o status (GA ou beta) [fonte: https://resend.com/docs/dashboard/templates/introduction, lido em 2026-10-09].
  - Variáveis usam `{{{VAR}}}`, com tipos string ou number e fallback opcional. Sem valor e sem fallback, o **envio falha**.
  - Há no máximo **50 variáveis** por template. São reservadas: `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `UNSUBSCRIBE_URL`, `contact` e `this`.
  - O escaping de HTML **não é documentado**, portanto não confie em variáveis com HTML.
  - [fonte: https://resend.com/docs/dashboard/templates/template-variables, lido em 2026-10-09]
- **Idempotência:**
  - Header `Idempotency-Key`, com 1 a 256 caracteres, válido por **24 h**.
  - Payload diferente com a mesma chave retorna `409 invalid_idempotent_request`; uma requisição ainda em andamento retorna `409 concurrent_idempotent_requests`.
  - Funciona também no batch.
  - [fonte: https://resend.com/docs/dashboard/emails/idempotency-keys, lido em 2026-10-09]
  - Isso combina com a outbox, usando chave = id do comando.
- **Webhooks:** assinados no padrão Svix (`svix-id`, `svix-timestamp`, `svix-signature`). Verifique com `resend.webhooks.verify()` ou `svix`, sempre sobre o **corpo bruto** [fonte: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests, lido em 2026-10-09].
- **Broadcasts:** contatos organizados em segments e topics para preferências, com agendamento [fonte: https://resend.com/docs/dashboard/broadcasts/introduction, lido em 2026-10-09].
- **React Email 6.11.1** existe (6.0 em 2026-04-16) [fonte: npm, §1]. O AGENTS.md exclui o React Email como fonte concorrente, e nada na pesquisa contradiz isso.
- **Alternativas:**

  | Serviço | Condições | Fonte |
  |---|---|---|
  | Postmark | Free de 100/mês; Basic a US$ 15 para 10k; streams separados para broadcast | https://postmarkapp.com/pricing |
  | AWS SES | US$ 0,10 por 1.000 e-mails; sem cota gratuita específica, só créditos AWS | https://aws.amazon.com/ses/pricing/ |
  | **Cloudflare Email Sending** | "**Beta**", binding `send_email` no Worker, **exige Workers Paid**; templates e webhooks não citados | https://developers.cloudflare.com/email-service/ (atualizada em 2026-10-08) |

  Todas lidas em 2026-10-09.
- **Implicação:** o **limite de 100/dia do plano Free** é arriscado em produção. Resets de senha, verificação, notificações e certificados de algumas centenas de alunos podem estourá-lo num dia de lançamento. Planejar o **Resend Pro (US$ 20/mês)** como decisão de custo.

---

## 13. Feature flags e e-mail de marketing (breve)

- **Feature flags:** para um monólito single-tenant com deploy manual, **não há necessidade real de um serviço de flags na v1**.
  - Bastam config tipada por ambiente (bindings/vars do Wrangler validados por Zod) e, se necessário, uma tabela `app_setting` no PG com auditoria. É uma inferência, sem fonte externa necessária.
  - Kill switches para integrações (Asaas, Resend, Browser Run) cabem nessa tabela.
- **Marketing:** Resend Broadcasts, com consentimento independente (já decidido) e grátis até 1.000 contatos (§12). Não exige ferramenta extra na v1.

---

## 14. Itens NÃO confirmados (busca bloqueada ou fonte inacessível)

1. Preço e plano free do Socket.dev para org privada: a página de preços retornou 403.
2. Status oficial (beta ou estável) do Oxfmt: a página não declara; só a versão 0.72 foi confirmada.
3. Versão do PostgreSQL embutida no PGlite 0.5.x.
4. Valores do "Cloudflare Observability pricing" a partir de 2026-12-01.
5. Custo de CPU do scrypt do Better Auth por login no Workers.
6. O significado do `cf build`/`cf deploy` citado na página do plugin Vite.
7. Se o Toast do Base UI substituiu o Sonner no shadcn.
8. Os breaking changes completos do MSW 3, do vite-plugin-pwa 2 e do Hono 5 (RC sem notas).
9. Se o Serwist ou outro plugin de build depende da API do TypeScript, o que quebraria com o TS 7.
10. O destino do Highlight.io e o rebrand Stack Auth → "Hexclave".
11. A tabela de preços conflitante do Better Auth Infra (landing com certificado expirado).

---

## 15. Implicações para decisões

| Tema (AGENTS.md) | Veredito | Evidência resumida | Ação recomendada |
|---|---|---|---|
| React 19 SPA + Vite + @cloudflare/vite-plugin | **Confirma** | React 19.3, Vite 8 com Rolldown estável e plugin 1.63 com peer Vite 8 (§2.1–2.3) | Pinar plugin **1.x** (o 2.0 está em beta desde hoje). Selecionar `CLOUDFLARE_ENV` antes do build. **Pôr `/api/*` em `run_worker_first`**, ou o callback OAuth cai no `index.html`. |
| TanStack Router + Query | **Confirma** | Estáveis e ativos | — |
| Não usar TanStack Start/SSR | **Confirma** (com nuance) | O Start segue **RC** desde 2025-09 e RSC é experimental (§2.4) | Para SEO/OG do catálogo e da validação de certificado: `HTMLRewriter` no Worker para meta tags. HTML gerado pelo Hono só com **decisão explícita**, pois toca a regra "sem SSR". Reavaliar o Start só após a 1.0 GA, via ADR. |
| Hono RPC + Zod | **Confirma** | Hono 4.13 e Zod 4.6 (§2.5–2.6) | **Risco:** Hono 5 em RC. Pinar 4.13.x e planejar o upgrade. **Contradiz a suposição implícita** de que `hono/csrf` protege JSON: escrever middleware próprio de Origin/Sec-Fetch-Site/Content-Type. Habilitar CSP explicitamente. |
| Drizzle + PG/Neon via Hyperdrive | **Confirma, com risco de versão** | v1 **não GA** (rc.4 parado desde 27/jun); estável 0.45.4. Hyperdrive exige `pg` ≥8.16.3, Client por requisição, e **Drizzle+postgres.js não é suportado** (§2.7–2.8) | Recomendação pragmática: **0.45.x + drizzle-kit 0.31** com migrations SQL geradas e revisadas. **Evitar a API relacional v1** (usar query builder core) para baratear a migração à v1. Alternativa: v1 RC pinada exata, se a equipe aceitar software RC. Decisão a registrar. |
| Better Auth (Google+senha, passkeys, sessão PG 7 dias) | **Confirma, com riscos operacionais** | 1.7.7 (§3) tem defaults de sessão compatíveis. Houve **regressões em patches** (1.7.3+: validação de schema quebrou D1 e pode travar isolates, #11346/#11651). Bugs abertos no rate limit com PG (#11519) e no user handle do passkey (#11555) | Pinar versão exata. `advanced.database.validateSchema: false` no Worker, com o schema checado no CI. Instância e Client por requisição. Rate limit `database` com `cf-connecting-ip`. Cookie cache desligado ou curto. **Não** usar `trustedProviders`. Infra/dash fora da v1 por privacidade. Passkeys como opcional e por último. |
| Alternativas de auth | **Confirma o Better Auth** | Lucia deprecated, Auth.js absorvido, OpenAuth parado; Clerk sem passkeys no free; WorkOS grátis até 1M MAU mas com PII externa; Neon Managed BA usa SDK beta (§3.4) | Manter o WorkOS AuthKit só como plano B documentado. |
| TypeScript 7 strict | **Confirma, com cuidado** | GA em 2026-07-08; **sem API até a 7.1**; typescript-eslint não suporta; **Oxlint type-aware exige TS 7**; Knip v6 independe; dependency-cruiser não usa TS 7 até a 7.1 (§4) | Adotar o TS 7.0.x; `types` explícitos e sem `baseUrl`. dependency-cruiser com extractor **swc** ou alias `@typescript/typescript6`. Validar no spike M0. Fallback: TS 6.0.3. |
| Oxlint/Oxfmt/Ultracite | **Confirma, com risco no Oxfmt** | Oxlint 1.x estável; Oxfmt **0.x**; Ultracite suporta Oxlint+Oxfmt (§5) | Pinar Oxfmt exato e aceitar churn de formatação. Plano B: Biome 2.5 (uma ferramenta, sem type-aware real). |
| Knip + dependency-cruiser | **Confirma** | Knip tem plugins para Wrangler, Vite, Vitest, Playwright, Drizzle, TanStack Router e Oxlint (§5) | Um dono por regra: ciclos e camadas no depcruise, não usados no Knip. **Não** adicionar eslint-plugin-boundaries. |
| Vitest Node + "plugin oficial Cloudflare" | **Contradiz o nome do pacote**: o certo é a **alternativa** | `@cloudflare/vitest-pool-workers` está **deprecated** e preso ao Vitest 4. O substituto é **`@cloudflare/vitest-plugin` 1.4.0**, com Vitest 4.1 ou 5 (§6) | Usar `@cloudflare/vitest-plugin` + Vitest 5.0.x (ou 4.1 se surgir incompatibilidade). Atualizar as referências nos docs de planejamento. |
| Integração PostgreSQL 18 | **Confirma** | Testcontainers suporta PG real e snapshots; PGlite tem conexão única; pg-mem é emulador (§6) | Testcontainers `postgres:18` no CI Linux e Docker local. Evitar pg-mem. |
| Playwright / MSW | **Confirma** | Playwright 1.64 (WebKit 27.2); MSW 3.0 (30/set) mais `@msw/cloudflare` (§6) | Validar o MSW 3 antes de adotar, pois a major é recente. |
| Bun pinado no Windows | **Risco moderado** | Bun 1.4 foi **reescrito de Zig para Rust** em ago/2026; lockfile v2; códigos de erro mudaram no Windows; Dependabot não faz security updates para Bun (§7) | Se mantiver o Bun: só como gerenciador de pacotes (Vite e Wrangler já rodam no Node via shebang), versão exata e CI Linux mais Windows. **pnpm** é a opção mais conservadora para júnior no Windows. |
| Node 24 LTS | **Confirma, com prazo** | Maintenance a partir de 2026-10-20 e EOL em 2028-04-30; Node 26 vira Active LTS em 2026-10-28 (§7) | Node 24 agora; avaliar o 26 em nov/2026. |
| GitHub Free privado | **Confirma o alerta do AGENTS.md** | Sem protected branches, rulesets, environments, secrets de org, secret scanning e CodeQL no privado. Há Dependabot alerts e 2.000 min (§8.1) | Decisão de custo: **GitHub Team US$ 4/usuário/mês** traz branch protection e environments, mas não GHAS. Se ficar no Free: gitleaks **CLI** (sem a action, que exige licença para orgs), Semgrep CE CLI ou o plano Free (até 10 repos/contributors), zizmor com `advanced-security: false`, actionlint, Renovate Mend Community (grátis no privado). Segredos de Production fora do GitHub, como já decidido. |
| Socket | **Não confirmado** | Preço inacessível (403) | Verificar manualmente antes de incluir como gate. |
| PWA offline Student | **Confirma, com limites** | vite-plugin-pwa 2.0 e Serwist ativos; Safari **sem Background Sync**; storage best-effort e LRU; limite de 7 dias fora da tela inicial; `Clear-Site-Data` é Baseline (§9) | `injectManifest` com SW próprio. Caches e IDB nomeados por `userId`. Logout com limpeza e `Clear-Site-Data`. Outbox drenada em `online`/abertura. Lease tolerante à perda total. Testar em iPhone real. |
| shadcn + Base UI | **Confirma** | Base UI é o default do shadcn desde jul/2026; Base UI 1.x estável desde dez/2025 (§10) | — |
| Phosphor | **Confirma, com risco baixo** | Sem release desde mai/2025 | Imports nomeados com sufixo `Icon`; aceitar o risco. |
| Rich text (TipTap) | **Confirma** | Core MIT; pagos só colaboração, AI e conversão (§10) | JSON validado com render server-side por allowlist (`@tiptap/static-renderer`). CSP e Trusted Types. Nada de HTML cru do cliente. |
| DnD | **Alternativa melhor** | dnd-kit core parado; dnd-kit/react em 0.x; Pragmatic DnD 4.0 ativo (§10) | Pragmatic DnD **ou** reordenação por botões acessíveis, que é obrigatória por WCAG 2.5.7 de qualquer forma. |
| Tabelas | **Atenção** | TanStack Table v9 GA em ago/2026 | Começar na v9 se os exemplos do shadcn suportarem; caso contrário, v8 consciente da migração. |
| Sentry | **Confirma, com custo** | SDK v11; plano free com **1 usuário**; `@sentry/hono` em alpha (§11) | Workers Logs (incluso) mais Sentry via plugin Vite. Avaliar Team (US$ 26) ou Better Stack (compatível com o SDK Sentry, 100k exceções grátis). Atenção à mudança de preço do Observability em 2026-12-01. |
| Resend (Hosted Templates, outbox) | **Confirma, com custo** | Templates versionados e publicados; idempotency de 24 h; webhooks Svix; **free com 100/dia** (§12) | Planejar o **Pro US$ 20/mês**. Chave de idempotência = id do comando da outbox. Não passar HTML em variáveis. Cloudflare Email Sending ainda é beta, então não usar como primário. |
| Feature flags | **Desnecessário na v1** | — | Config tipada mais tabela de settings auditada. |

### Recomendação pragmática para equipe pequena
1. **Congelar versões no M0 com uma matriz testada:** React 19.3, Vite 8.3, @cloudflare/vite-plugin 1.63, Wrangler 4.149, TanStack Router 1.170, Query 5.104, Hono 4.13, Zod 4.6, Drizzle 0.45 ou v1-rc (decidir), Better Auth 1.7.7 exato, TS 7.0.2, Oxlint 1.87, Oxfmt 0.72 exato, Vitest 5.0 com `@cloudflare/vitest-plugin` 1.4, Playwright 1.64.
2. **Renovate com `minimumReleaseAge` de 7 a 14 dias e agrupamento.** O ecossistema está no meio de várias majors (Hono 5, plugin Cloudflare 2, MSW 3, Vitest 5).
3. **Spike técnico obrigatório antes do M1:**
   - Fluxo completo Better Auth + Hyperdrive + `pg` + Drizzle no workerd: login Google com callback via `run_worker_first`, senha com medição de CPU do scrypt, sessão e rate limit em DB.
   - Testes no `@cloudflare/vitest-plugin`.
   - Oxlint `--type-aware` com TS 7.
   - dependency-cruiser com swc.
4. **Registrar como decisões pendentes (custo, segurança ou privacidade):** GitHub Team vs Free com controles compensatórios; Resend Pro; Sentry Team vs Better Stack; Bun vs pnpm; Drizzle 0.45 vs v1-rc; meta tags/HTML server-side para páginas públicas.
