# W5 — Reescrever (SPA + Hono) vs portar (OpenNext/vinext) o LMS Next.js da Vercel para a Cloudflare

- **Data da pesquisa:** 2026-10-09
- **Escopo:** avaliar alternativas antes de confirmar a reescrita do LMS legado (Next.js 16.3 App Router, Server Actions, RSC, route handlers, crons Vercel, React 19.3, Drizzle + `pg` no Neon, Better Auth 1.7, `@sentry/nextjs`, pdfkit, sharp, `@aws-sdk/client-s3` para R2, Resend + react-email, TipTap) como **React SPA + Vite + Hono num Worker**.
- **Método:** fontes oficiais (opennext.js.org, developers.cloudflare.com, blog.cloudflare.com, nextjs.org, tanstack.com, docs.sentry.io, Google Search Central, Meta for Developers), GitHub (releases/issues), registro npm (consultado diretamente em 2026-10-09) e relatos de devs datados.
- **Convenções:** "**não confirmado**" = não encontrei fonte primária que comprove; "**inferência**" = conclusão minha a partir das fontes; datas no formato AAAA-MM-DD.
- **Limitações desta pesquisa:**
  - O orçamento de buscas web da sessão se esgotou no fim da pesquisa. Por isso, **não** consegui varrer HN/Reddit sobre o vinext 1.0 (lançado em 2026-09-28) nem procurar um post oficial de anúncio do 1.0. Os dados do vinext 1.0 vêm do npm e da página de releases do GitHub.
  - Não li o código do legado. Afirmações sobre "como o legado provavelmente está escrito" são inferências e precisam ser conferidas.

---

## 0. TL;DR

1. **O OpenNext para Cloudflare (`@opennextjs/cloudflare` 1.20.10, publicado em 2026-10-09) é maduro o bastante para portar um app Next 16.3 existente.**
   - Suporta App Router, RSC, Server Actions, route handlers, ISR, `after()`, streaming e otimização de imagem via Cloudflare Images.
   - Exige `next >= 16.3.8` (peer dependency).
   - Restrições:
     - `proxy.ts` (Node middleware) é **experimental** desde a 1.20.3, e a documentação ainda diz "não suportado".
     - Cada minor do Next já quebrou o adaptador por alguns dias (16.1.0 e 16.2.0).
     - Há um bug aberto de Server Action `redirect()` em Workers multi-host (#1413, 2026-10-02).
     - A própria Cloudflare **recomenda o vinext, e não o OpenNext, para apps Next novos** e mantém o OpenNext para apps existentes.
2. **O vinext chegou ao 1.0.0 em 2026-09-28 (o 1.1.0 saiu em 2026-10-08).** Até 2026-08-25 a doc da Cloudflare o tratava como beta. É uma reimplementação da API do Next feita com IA. Uma auditoria de fevereiro de 2026 validou 24 vulnerabilidades, 4 delas críticas de vazamento entre requisições, que segundo os autores foram corrigidas. O repo tem cerca de 280 issues abertas. **Não é a escolha prudente para um LMS com pagamento e dados pessoais hoje.**
3. **TanStack Start:** a doc oficial ainda diz "Release Candidate" (npm `latest` 1.168.60). Roda bem em Workers via Cloudflare Vite Plugin e tem SSR seletivo por rota e SPA mode. **React Router v8** (8.4.0) roda em Workers, mas "SPA mode e prerendering não são suportados" com o Cloudflare Vite plugin.
4. **Dependências do legado que não sobrevivem a nenhum dos caminhos sem troca:**
   - `sharp`: nativo, não roda em workerd.
   - `pdfkit`: suporte a Workers **não confirmado**; issue aberta desde 2024; um relato teve de trocar uma lib de PDF que usava `fs.readFileSync`.
   - Pool global de `pg`: precisa virar cliente por requisição.
   - `@sentry/nextjs` v10: bug de WASM em Workers, resolvido na v11.
   - Cron do `vercel.json`: vira Cron Trigger com `scheduled()` em worker customizado.

   Ou seja, **portar via OpenNext também exige mudanças de código, não só de configuração.**
5. **Relatos reais:**
   - Ports via OpenNext custaram de "horas" (Silvermine, 2026-02) a cerca de 40 h em 3 semanas (BuildMVPFast, 2026-06, e-commerce), com quebras em imagem, PDF, bundle e memória.
   - Uma reescrita completa para Vite + TanStack Router SPA + Hono levou cerca de 19 dias com agentes de IA (WebCatalog, 2026-09) e cortou cerca de 80% do custo. Mesmo assim produziu **bugs de cache que serviam respostas por visitante**.
6. **SEO/OG numa SPA em Workers é resolvível sem SSR.** Basta um Worker com `run_worker_first` para as rotas públicas e `HTMLRewriter` injetando `<title>`, `og:*` e canonical no `index.html`. Pré-render no build só serve para conteúdo que muda raramente. Crawlers sociais, segundo relatos amplos (não confirmado oficialmente pela Meta), não executam JS.
7. **Contexto do repositório:** a vNext já é, por decisão aprovada (B11 e auditoria 01), uma **reconstrução de domínio** (CourseRelease, Entitlement/Enrollment, Asaas, filas e outbox), não um port de hosting. O legado coexiste e não há migração obrigatória da base beta.
   - Isso muda o cálculo: **OpenNext resolve "sair da Vercel", não "ter o domínio novo".**
   - **Recomendação condicionada** (detalhes em "Implicações"):
     - Se a dor imediata é custo ou dependência da Vercel, um **port do legado via OpenNext** (tarefa separada, autorizada à parte) pode servir de ponte barata.
     - A vNext segue como reescrita **com coexistência e corte por coorte/curso** (strangler por fluxo, não big-bang).
     - Spikes técnicos devem cobrir os riscos de runtime antes do M1.

---

## 1. `@opennextjs/cloudflare` (OpenNext para Cloudflare)

### 1.1 Versão e suporte a Next 16

| Fato | Valor | Fonte (data) |
|---|---|---|
| Versão atual | **1.20.10**, publicada em 2026-10-09 | registro npm (consultado em 2026-10-09); [GitHub releases](https://github.com/opennextjs/opennextjs-cloudflare/releases) |
| Peer deps | `next: ">=15.5.27 <16 \|\| >=16.3.8"`, `wrangler: ^4.148.0` | npm (2026-10-09) |
| Versões de Next suportadas | "todas as minors e patches de Next.js 16" + última minor de 14 e 15 (suporte ao 14 encerrado no 1º tri de 2026) | [opennext.js.org/cloudflare](https://opennext.js.org/cloudflare) (consultado em 2026-10-09) |
| Next mais recente | `next@latest` = **16.4.0** (2026-10-06). A changelog do OpenNext não cita 16.4 explicitamente; o peer range aceita, mas o suporte efetivo ao 16.4 está **não confirmado** | npm (2026-10-09) |
| Mínimos de segurança | A 1.20.8 (2026-10-02) elevou o mínimo para Next 15.5.27 e 16.3.8. A 1.20.7 (2026-09-29) tratou uma vulnerabilidade em `next/og` presente nas versões 16.2.0–16.3.5 | [releases](https://github.com/opennextjs/opennextjs-cloudflare/releases) |
| Adapter API oficial do Next | Estável desde o Next 16.2 (2026-03-25). Os adapters OpenNext para Cloudflare, Netlify e AWS estavam "em desenvolvimento ativo, com releases esperados mais tarde neste ano". Em 2026-08-06, os únicos *verified adapters* listados eram Vercel e Bun; a Cloudflare aparece como "integração própria, não verificada" | [nextjs.org/blog/nextjs-across-platforms](https://nextjs.org/blog/nextjs-across-platforms) (2026-03-25); [nextjs.org/docs/.../deploying](https://nextjs.org/docs/app/getting-started/deploying) (atualizada em 2026-08-06) |
| Posição oficial da Cloudflare | "Cloudflare recommends vinext instead of OpenNext for new Next.js applications on Cloudflare Workers". O OpenNext continua indicado para apps existentes | [CF docs — OpenNext](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) (atualizada em 2026-08-25) |

### 1.2 Matriz de recursos que o legado usa

| Recurso do legado | Status no OpenNext/Cloudflare | Observações |
|---|---|---|
| App Router, RSC, route handlers, streaming | Suportado | [CF docs OpenNext](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) (2026-08-25) |
| Server Actions | Suportado | Há bugs abertos; ver §1.5 |
| `middleware.ts` (edge) | Suportado | — |
| `proxy.ts` / Node middleware (padrão do Next 16) | **Experimental** desde a 1.20.3 (2026-08-26), exige `nodejs_compat` | A doc da CF (2026-08-25) e a página opennext.js.org ainda dizem "Node Middleware not yet supported". **Conflito de fontes**: trate como não estável. Relatos de abril e maio de 2026 contornaram removendo `proxy.ts` ou movendo redirects para regras da Cloudflare ([workers-sdk#13755](https://github.com/cloudflare/workers-sdk/issues/13755)) |
| `export const runtime = "edge"` | **Precisa ser removido**: o adaptador só usa o runtime Node | [whoooop.co.uk](https://whoooop.co.uk/blog/nextjs-on-cloudflare-workers) (2026-09-08) |
| ISR, `revalidateTag`/`revalidatePath` | Suportado, com configuração explícita de cache | Recomendado: incremental cache em **R2**, fila em **Durable Objects**, tag cache em **D1** ou DO sharded. KV não é recomendado (consistência eventual). A fila em memória não serve para produção. Purge exige zona própria e token ([opennext caching](https://opennext.js.org/cloudflare/caching)). Isso **conflita com B12**, que exclui DO/KV/D1 obrigatórios, caso o legado use revalidação |
| `after()` | Suportado | **Inferência:** em Workers, `waitUntil` estende o trabalho por **até 30 s** após a resposta ([CF limits](https://developers.cloudflare.com/workers/platform/limits/), atualizada em 2026-10-08). Tarefas longas em `after()` (e-mail em lote, PDF) correm risco de corte |
| `next/image` | Via **binding Cloudflare Images**, sem sharp | Sem `minimumCacheTTL`. Custo: 5.000 transformações únicas por mês grátis, depois US$ 0,50 por 1.000 ([CF Images pricing](https://developers.cloudflare.com/images/pricing/), 2026-07-08) |
| PPR / `"use cache"` | Suportado, mas experimental no próprio Next. A 1.20.9 (2026-10-06) corrigiu falhas de Cache Components sob concorrência | [releases](https://github.com/opennextjs/opennextjs-cloudflare/releases) |
| Crons do `vercel.json` | Não há equivalente automático | Ver §1.8 |

### 1.3 Limites de plataforma Workers relevantes (Paid)

Fonte: [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits/), atualizada em 2026-10-08.

- **Tamanho do Worker:** **64 MiB descomprimido; "There is no compressed size limit"**.
  - A doc do OpenNext ([troubleshooting](https://opennext.js.org/cloudflare/troubleshooting)) ainda cita 3 MiB/10 MiB gzip. Está desatualizada.
  - Um relato de junho de 2026 precisou dividir uma rota em outro Worker por estourar o limite antigo de 10 MB.
- **Startup:** 1 s. É o tempo de avaliar o código de topo do módulo; Next completo é sensível a isso.
- **Memória:** 128 MB por isolate. Um relato teve OOM numa busca e precisou paginar.
- **CPU por requisição:** 30 s por padrão, máximo de 5 min.
- **Cron:** 30 s de CPU para intervalos menores que 1 h; 15 min para intervalos de 1 h ou mais.
- **Conexões de saída simultâneas:** 6 (as demais entram em fila).
- **Subrequests:** 10.000.
- **Cold start e desempenho:** não há benchmark independente de 2026 sobre cold start do OpenNext; os números que circulam são de marketing ou sem metodologia (**não confirmado**).
  - A Cloudflare reconheceu em 2025-10-14 que o Next via OpenNext era o único benchmark em que Workers ainda perdia da Vercel em CPU.
  - Causas apontadas: GC (10–25% do tempo), alocações e cópias no OpenNext e adaptação de streams. Aplicaram correções, mas o gap "diminuiu, não fechou" ([blog CF](https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/), 2025-10-14).
  - Em 2025-06, a v1.2 tirou o preload de todas as rotas, com cerca de 100 ms a menos no startup segundo o changelog da CF citado em busca. **Não li a página diretamente.**

### 1.4 Compatibilidade das dependências do legado (vale para OpenNext e também para a reescrita)

| Dependência | Situação em workerd | Ação necessária | Fonte |
|---|---|---|---|
| `pg` + Neon via **Hyperdrive** | Funciona com `nodejs_compat` e `pg >= 8.16.3` | **Cliente por requisição**; nada de Pool global. A doc do OpenNext recomenda `new Pool({ connectionString: env.HYPERDRIVE.connectionString, maxUses: 1 })` dentro de `cache()` do React. Um cliente global gera "Cannot perform I/O on behalf of a different request". **Inferência:** se o legado exporta um `db` singleton (padrão comum em Next/Vercel), isso vira refatoração transversal (`getDb()`) | [CF Hyperdrive + pg](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/) (2026-04-21); [OpenNext db](https://opennext.js.org/cloudflare/howtos/db); [troubleshooting](https://opennext.js.org/cloudflare/troubleshooting) |
| Drizzle | Sem configuração especial além do cliente por requisição | Migrations devem rodar contra a URL de origem, não a do Hyperdrive | idem; [hono.dev better-auth](https://hono.dev/examples/better-auth-on-cloudflare) |
| Better Auth 1.7 (npm `latest` 1.7.7, 2026-09-30) | Exemplo oficial do Hono em Workers usa o driver serverless do Neon. Sobre Better Auth **dentro do OpenNext** não achei guia específico (**não confirmado**) | Instanciar por requisição se carregar pool. Sugestão de desativar cache do Hyperdrive para leituras de sessão (fonte de terceiros: Alchemy) | [hono.dev](https://hono.dev/examples/better-auth-on-cloudflare) |
| `@sentry/nextjs` | Suportado no OpenNext com `nodejs_compat` e `compatibility_date >= 2025-08-16` | A v10 tinha bug: o import puxava um plugin WASM que quebra em todo cold start ([sentry-javascript#22794](https://github.com/getsentry/sentry-javascript/issues/22794), aberta em 2026-07-29 e fechada em 2026-09-08; solução: **migrar para a v11**; npm `latest` 11.6.0 em 2026-10-08). Alternativa: `@sentry/cloudflare` | [Sentry Next.js on Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nextjs/) |
| **sharp** | **Não roda** (binário C++ nativo) | Trocar pelo binding Images (entrada de até 20 MB; `.transform`, `.draw`, `.info`) ou por processamento no browser. A WebCatalog levou para Railway as APIs que dependiam de sharp | [CF Images binding](https://developers.cloudflare.com/images/transform-images/bindings/) (2026-09-02); [WebCatalog](https://webcatalog.io/en/blog/how-moving-from-vercel-to-cloudflare-workers-railway-cut-our-hosting-costs-by-80percent) (2026-09-23) |
| **pdfkit** (0.20.2, 2026-08-30) | **Não confirmado.** [Issue #1526](https://github.com/foliojs/pdfkit/issues?q=cloudflare) ("Support for other javascript runtimes… cloudflare worker"), aberta desde 2024-06. As fontes padrão vinham de arquivos AFM lidos via `fs`; o VFS dos Workers só expõe os módulos do bundle em `/bundle`. A 0.20.x passou a emitir dados de fonte como módulos, o que pode ajudar (**não confirmado**) | PoC obrigatório ou troca. Um relato de port via OpenNext precisou **substituir** uma lib de PDF que usava `fs.readFileSync` ([BuildMVPFast](https://www.buildmvpfast.com/blog/vercel-vs-cloudflare-nextjs-hosting-migration-2026), 2026-06-01). A vNext já decidiu usar **Browser Run (HTML/CSS → PDF)** | [CF fs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/) (2026-04-23); [CF Browser Run PDF](https://developers.cloudflare.com/browser-run/how-to/pdf-generation/) |
| `@aws-sdk/client-s3` (R2) | A doc do R2 mostra uso do aws-sdk-js-v3, inclusive presigned PUT/GET; a API S3 não funciona em `wrangler dev` local | Em Worker, preferir o **binding R2** para operações server-side; presign com aws-sdk ou aws4fetch (**não verifiquei** bundle e checksums em detalhe) | [CF R2 aws-sdk-js-v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) (2026-04-21) |
| Resend SDK / react-email | SDK baseado em HTTP; **não verifiquei** especificamente em workerd | A vNext usa Resend Hosted Templates (sem React Email), então isso só importa no port | — |
| TipTap | Só cliente | Neutro | — |
| Node APIs em geral | `fs`, `net`, `http(s)`, `zlib`, `crypto` suportados; `tls` parcial; `child_process`/`worker_threads` são stubs. Com `compatibility_date >= 2026-08-04`, `nodejs_compat` vem ligado por padrão | Libs que usam `child_process` ou binários nativos falham | [CF Node.js APIs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) (2026-08-12) |

### 1.5 Problemas conhecidos (issues relevantes)

- **[#1413](https://github.com/opennextjs/opennextjs-cloudflare/issues/1413), aberta em 2026-10-02, sem resposta de mantenedor:** `redirect()` relativo em Server Action renderiza a página do **primeiro host que inicializou o isolate**, porque o init grava `__NEXT_PRIVATE_ORIGIN` uma única vez.
  - O autor relata vazamento entre tenants em produção.
  - O LMS é single-tenant, mas **se servir apex + www, ou domínio + `workers.dev`, o bug pode aparecer** (inferência).
  - Há fix proposto na PR #1414, ainda aberta.
- **[#1410](https://github.com/opennextjs/opennextjs-cloudflare/issues/1410), outubro de 2026:** CSS obsoleto em redirect de Server Action após rebuild (dev/preview). Baixo impacto.
- **Quebras a cada minor do Next:**
  - [#1049](https://github.com/opennextjs/opennextjs-cloudflare/issues/1049): Next 16.1.0, erro 1101.
  - [#1157](https://github.com/opennextjs/opennextjs-cloudflare/issues/1157): Next 16.2.0, erro 1101 no startup. Aberta em 2026-03-18 e corrigida na 1.17.3 em 2026-03-23, cerca de 5 dias depois.
  - A 1.20.7 precisou corrigir um `ReferenceError` específico do Next 16.3.
  - **Padrão:** o upgrade do Next fica atrelado ao ritmo do adaptador.
- **[workers-sdk#13755](https://github.com/cloudflare/workers-sdk/issues/13755)** (2026-04-30 a 2026-06-22): "Version Trap" entre `proxy.ts` do Next 16 e o adaptador. Contornos comunitários: remover `proxy.ts` ou rebaixar para o Next 15.
- **Problemas antigos de `getCloudflareContext`** em Server Actions de rotas dinâmicas ([#575](https://github.com/opennextjs/opennextjs-cloudflare/issues/575), 2025). Status atual não verificado.

### 1.6 Maturidade e adoção

- **Histórico:** 1.0-beta em abril de 2025 ([blog CF](https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/)), linha 1.20.x hoje, releases semanais (quatro entre 2026-09-29 e 2026-10-09).
- O blog do Next.js (2026-03-25) chama o OpenNext de "early production-grade adapter, especially on AWS", com Cloudflare e Netlify entrando depois.
- **Empresas em produção:** não encontrei uma lista oficial de clientes do OpenNext Cloudflare (**não confirmado**). Os relatos achados são de pequenos times e agências (§4).
- **Dependência de terceiros:** o adaptador é open source e comunitário (a CF participa). O blog da BuildMVPFast lembra que ele é dependência de terceiro, não suportada pelo fornecedor do framework.

### 1.7 Esforço típico de migração Vercel → Cloudflare via OpenNext

| Relato | Tipo de app | Esforço | Problemas |
|---|---|---|---|
| [Silvermine](https://www.silvermine.ai/newsletter/cloudflare-vs-vercel-nextjs-opennext) (2026-02-09) | App Next (não nomeado), time de 3 | "horas, não semanas" | Ajustes em `next/image`, rotas dinâmicas e middleware; perda de previews, analytics e flags da Vercel |
| [BuildMVPFast](https://www.buildmvpfast.com/blog/vercel-vs-cloudflare-nextjs-hosting-migration-2026) (2026-06-01) | E-commerce com checkout, time de 3 | ~40 h em 3 semanas | Layout shift no Safari por `next/image fill` (2 dias; "quase quebrou o checkout"); env vars; **lib de PDF com `fs.readFileSync` substituída**; rota acima de 10 MB dividida; OOM de 128 MB; logs e deploys mais difíceis |
| [whoooop.co.uk](https://whoooop.co.uk/blog/nextjs-on-cloudflare-workers) (2026-09-08) | Guia comparativo | "majoritariamente configuração" | `runtime = "edge"` residual é a causa nº 1 de falha no primeiro build; `WORKER_SELF_REFERENCE` obrigatório; R2 + fila DO para cache |

**Estimativa para este LMS (inferência):** o LMS tem mais pontos de atrito que os relatos acima: sharp, pdfkit, pool `pg`, Sentry v10, crons e `proxy.ts`. Ainda assim, deve ficar na ordem de **1 a 3 semanas de engenharia** mais regressão completa de auth e checkout, e não meses. É preciso validar com um spike de 1–2 dias.

### 1.8 Crons: substituindo `vercel.json`

- O worker gerado pelo OpenNext só exporta `fetch`. Cria-se um **custom worker** que reexporta `handler.fetch` e adiciona `scheduled()`, apontando `main` do wrangler para ele ([OpenNext custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker)).
- Os schedules ficam em `triggers.crons` do wrangler, por ambiente (`env.<nome>.triggers`), em **UTC**. Mudanças levam até 15 min para propagar. Teste local via `/cdn-cgi/local/scheduled` ([CF Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), 2026-09-04).
- **Padrão de transição (inferência, não documentado pelo OpenNext):** no `scheduled()`, chamar `handler.fetch(new Request("https://<host>/api/cron/x", { headers: { authorization: "Bearer " + env.CRON_SECRET } }), env, ctx)` reaproveita as rotas que hoje a Vercel chama. Melhor ainda é chamar o caso de uso diretamente.
- **Limites:** 250 cron triggers por conta (Paid); 30 s de CPU por execução em crons com intervalo menor que 1 h; 15 min de wall time.

---

## 2. vinext (Cloudflare)

| Fato | Valor | Fonte |
|---|---|---|
| O que é | Plugin Vite que **reimplementa** a API pública do Next (App e Pages Router, RSC, Server Actions, route handlers, middleware/`proxy.ts`, ISR, `next/*`). Não é fork | [GitHub cloudflare/vinext](https://github.com/cloudflare/vinext) |
| Origem | Anunciado em 2026-02-24 ("How we rebuilt Next.js with AI in one week"): 1 engenheiro, cerca de US$ 1.100 em tokens, cerca de 94% da API do Next 16 coberta, 1.700+ testes Vitest e 380 E2E | [blog CF](https://blog.cloudflare.com/vinext/) (2026-02-24) |
| Linha do tempo | Beta 1 em julho de 2026 ([itwriting](https://www.itwriting.com/blog/12442-cloudflares-vinext-project-reaches-beta-1-not-just-an-ai-experiment.html), 2026-07-12); 1.0.0-beta.9 em setembro; **1.0.0 em 2026-09-28**, 1.0.1 em 2026-10-01, **1.1.0 em 2026-10-08** | npm (2026-10-09); [releases](https://github.com/cloudflare/vinext/releases) |
| Peer deps | `vite ^8`, `react ^19.2.6`, `@vitejs/plugin-rsc ^0.5.34`; testado contra Next 16.2.6 (setembro de 2026) | npm; whoooop.co.uk |
| Posição da CF | "Default way to run Next.js on Workers", mas "not yet a drop-in replacement for every application or production workload"; a doc ainda falava em beta em 2026-08-25 | [CF Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) |
| Lacunas declaradas (README) | Cache Components/PPR parciais; otimização de imagem e fonte em build; módulos nativos (sharp) no dev do App Router; `runtime`/`preferredRegion` ignorados; sem pré-render no build (na 1.0 foi substituído por *cache warming*) | README; releases 1.0.0 |
| Segurança | A Hacktron (2026-02-27) validou 24 achados: **4 críticos** (estado compartilhado entre requisições via `AsyncLocalStorage` de fallback, cache servindo resposta de um usuário a outros), 7 altos (bypass de middleware por normalização de path, SSRF) etc. Segundo os autores, foram corrigidos | [hacktron.ai](https://www.hacktron.ai/blog/hacking-cloudflare-vinext) |
| Uso em produção | CIO.gov (National Design Studio) e "clientes não nomeados" (fevereiro de 2026) | [blog CF](https://blog.cloudflare.com/vinext/) |
| Saúde do repo | ~9,1 mil stars; ~280 issues e ~365 PRs abertas (2026-10) | GitHub |

**Leitura:** o vinext 1.0 tem menos de 2 semanas. A própria CF recomendava "appropriate caution" para workloads críticos. Um guia independente diz para evitá-lo em apps com receita (whoooop, 2026-09-08, ainda na fase beta). Para um LMS com Asaas, certificados e PII, **é uma aposta prematura**. Reavaliar em 6–12 meses. **Não confirmado:** não encontrei post oficial de anúncio do 1.0 nem discussões da comunidade sobre ele, porque a busca esgotou.

---

## 3. Alternativas intermediárias: TanStack Start e React Router em Workers

### 3.1 TanStack Start

- **Status:** a doc oficial diz "currently in the **Release Candidate** stage", com API considerada estável ([overview](https://tanstack.com/start/latest/docs/framework/react/overview), consultada em 2026-10-09). O post RC é de 2025-09-23 ([blog](https://tanstack.com/blog/announcing-tanstack-start-v1)). O npm `latest` é **1.168.60** (2026-09-30), com releases a cada poucos dias; pinar versão é recomendado ([Makerkit](https://makerkit.dev/blog/tutorials/what-is-tanstack-start), docs conferidas em outubro de 2026).
- **Em Workers:** guia oficial da CF com Cloudflare Vite Plugin (`viteEnvironment: { name: "ssr" }`), bindings via `cloudflare:workers` e entrada customizada para Queues, Cron e DO. Tem prerender estático opcional ([CF TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), 2026-10-08). Cloudflare é parceira oficial ([tanstack.com/blog/cloudflare-partnership](https://tanstack.com/blog/cloudflare-partnership)).
- **SPA mode:** gera um shell estático, mantém server functions e permite prerender seletivo de rotas ([SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)).
- **Selective SSR:** `ssr: true | false | 'data-only'` por rota e `defaultSsr`. Permite **SSR só nas rotas públicas** (catálogo, validação de certificado) e client-only atrás do login. Filhos herdam a configuração e só podem ser mais restritivos ([selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)).
- **RSC:** experimental.
- **Relevância:** é o "meio-termo" natural se aparecer necessidade real de SSR em páginas públicas. Hoje está **excluído pela decisão B11**; reabrir exige o processo de mudança de decisão.

### 3.2 React Router (framework mode)

- A v8 saiu em 2026-06-17; o npm `latest` é **8.4.0** (2026-09-15). A v7 recebe só correções de segurança (7.18.4). RSC continua `unstable_` ([blog v8](https://remix.run/blog/react-router-v8)).
- Em Workers: SSR com loaders e actions e bindings via `context.cloudflare`. **"SPA mode and prerendering are not currently supported" com o Cloudflare Vite plugin**; para SPA, a CF recomenda o template React com React Router como biblioteca ([CF React Router](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/), 2026-06-19).
- Uma CVE de 2026 (CVE-2026-34077) afetou só as APIs RSC instáveis (7.7.0–7.13.1).

---

## 4. Relatos de migração: port vs reescrita, e SPA + API atrás de login

- **Ports via OpenNext** (§1.7):
  - **Ganho:** custo, sobretudo build minutes. Exemplo: de US$ 330 para US$ 5 por mês, em [Silvermine](https://www.silvermine.ai/newsletter/cloudflare-vs-vercel-nextjs-opennext) e [BuildMVPFast](https://www.buildmvpfast.com/blog/vercel-vs-cloudflare-nextjs-hosting-migration-2026).
  - **Dor:** imagem, PDF/`fs`, tamanho de bundle, memória, observabilidade e DX de deploy e logs.
  - A BuildMVPFast recomenda **ficar na Vercel** para times pequenos com uso pesado de ISR/PPR, ou quando o tempo de migração supera a economia. Cloudflare compensaria com conta acima de cerca de US$ 200 por mês ou com muito tráfego/banda.
- **Reescrita** ([WebCatalog](https://webcatalog.io/en/blog/how-moving-from-vercel-to-cloudflare-workers-railway-cut-our-hosting-costs-by-80percent), 2026-09-23):
  - Apps viraram **Vite + TanStack Router SPA em Workers**; sites de marketing viraram **TanStack Start SSR**; APIs viraram **Hono + tRPC na Railway**, porque precisavam de Node e sharp. Cloudflare Containers exigiu tuning demais.
  - Rejeitaram o adaptador por manter "suposições Vercel-oriented".
  - Cerca de 19 dias para as SPAs, com agentes de IA. Cerca de 80% a menos de custo (90% com regras de segurança na borda).
  - **Dores:** tirar auth de dentro das rotas Next; manter endpoints legados para clientes antigos; **regras de cache próprias que casaram respostas por visitante** e conflitaram com o fallback da SPA; uma tentativa com Astro foi abandonada após 5 dias (prerender sem credenciais de produção).
- **Lição (inferência):** SPA + API atrás de login simplifica o modelo (sem RSC, sem cache de página), mas **passa o cache e a autorização para o time**. Respostas autenticadas precisam de `Cache-Control: private, no-store` e não podem cair em regras de CDN. Isso já está alinhado com o AGENTS ("dados sensíveis não vão para cache CDN").
- **Desempenho Next em Workers:** gap de CPU em SSR reconhecido pela CF em 2025-10 (§1.3). Uma SPA + Hono JSON tem perfil de CPU muito menor por requisição (inferência).
- **Não coberto:** discussões no HN/Reddit de 2026 especificamente sobre o vinext 1.0 e OpenNext 1.20, por falta de orçamento de busca.

---

## 5. Reescrita vs port incremental (strangler fig): referências e riscos

### Referências clássicas

- **Joel Spolsky, "Things You Should Never Do, Part I" (2000-04-06)** ([link](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/)):
  - Chama a reescrita do zero de "the single worst strategic mistake".
  - Usa como exemplo a Netscape, com cerca de 3 anos sem lançar.
  - Lembra que código "feio" carrega correções de casos reais que a reescrita perde e reintroduz.
- **Martin Fowler, "Strangler Fig Application" (atualizado em 2024-08-22)** ([link](https://martinfowler.com/bliki/StranglerFigApplication.html)):
  - Substituição gradual, com o novo crescendo ao lado do legado.
  - Entrega valor cedo, com risco menor por passo e aprendizado contínuo.
  - Aponta que reescritas completas "gone down in flames most of the time", que comportamento existente é difícil de especificar e que, sem mudar práticas, o novo sistema volta a ficar emaranhado.
  - Indica o catálogo *Patterns of Legacy Displacement* (Cartwright, Horn, Lewis) e o conceito de **arquitetura transicional**.

### Evidência recente

- **vinext:** "reescrito em uma semana", mas levou cerca de 20 semanas até o beta 1 e cerca de 7 meses até o 1.0.
  - A primeira versão tinha **4 vulnerabilidades críticas** de estado compartilhado entre requisições, achadas por auditoria externa ([Hacktron](https://www.hacktron.ai/blog/hacking-cloudflare-vinext)).
  - Os autores concluem que testes gerados para "passar" raramente cobrem casos de borda de segurança.
  - **Relevância direta:** uma reescrita assistida por IA do LMS herda esse risco em auth, RBAC e checkout.
- **WebCatalog:** reescrita bem-sucedida e rápida, mas com escopo de apps relativamente simples, IA intensiva e **legado mantido para clientes antigos**, o que na prática foi uma coexistência.

### Riscos específicos de big-bang neste LMS (inferência)

1. **Financeiro:** webhooks Asaas, reconciliação, reembolsos e pagamentos em voo no corte.
2. **Acesso:** alunos com acesso ativo no legado precisam continuar acessando.
3. **Certificados históricos:** URLs públicas de validação precisam continuar resolvendo (a doc 05/09 já fala em preservar URLs históricas).
4. **Identidade:** sessões e senhas. A base nova não migra a beta, o que obriga os usuários a recadastro ou convite.
5. **SEO e links compartilhados:** catálogo e certificados.

### Formas de strangler aplicáveis

- **(a) Por fluxo/coorte (alinhado à doc):** novas Offers e matrículas na vNext; o legado mantém acessos e certificados históricos até expirarem; corte de DNS por rota depois.
- **(b) Fachada por rota:** um Worker na frente do legado na Vercel faz proxy das rotas não migradas e serve as já migradas.
  - Limitação: bancos e sessões separados tornam o SSO entre os dois difícil (inferência). Funciona melhor para páginas públicas (validação de certificado, catálogo) do que para a área logada.
- **(c) Port de hosting primeiro (OpenNext) e reescrita depois:** reduz custo e risco de plataforma já, mas gasta esforço num código que será descartado.

---

## 6. SEO/OG numa SPA em Workers (catálogo, validação de certificado, retorno de checkout)

### Precisa de SSR?

- **Google:** renderiza JS (crawl → fila de render → index), mas recomenda SSR ou pré-render como "a great idea" e lembra que "nem todos os bots executam JS". Canonical e `noindex` devem estar no HTML original ([Google JS SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), 2026-03-04).
- **Crawlers sociais** (Facebook/WhatsApp `facebookexternalhit`, LinkedIn, X):
  - Relatos amplos indicam que **não executam JS**. A doc da Meta não diz isso explicitamente (**não confirmado oficialmente**).
  - A Meta exige as tags OG no primeiro 1 MB, gzip/deflate e resposta "em poucos segundos" ([Meta crawler](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/)).
  - **Para compartilhar certificado no LinkedIn ou curso no WhatsApp, as meta tags precisam estar no HTML servido.**

### Por página

| Página | SEO | OG | Solução sugerida |
|---|---|---|---|
| Catálogo (curso/oferta) | Sim | Sim | Injeção no shell via HTMLRewriter (dinâmica) |
| Validação pública de certificado | Normalmente `noindex` (dado pessoal mínimo) | Sim, para o preview no LinkedIn | HTMLRewriter com dados mínimos e `noindex` |
| Retorno de checkout | Não (`noindex`) | Não | SPA pura; nunca conceder acesso pelo retorno (já é invariante) |

### Como fazer sem SSR (Workers + static assets)

1. Configurar `assets.not_found_handling: "single-page-application"` e **`run_worker_first: ["/api/*", "/cursos/*", "/certificados/*", …]`** ([CF SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), 2026-08-25).
   - **Pegadinha:** com `compatibility_date >= 2025-04-01`, navegações (`Sec-Fetch-Mode: navigate`) **pulam o Worker** e vão direto ao `index.html`, a menos que a rota esteja em `run_worker_first`.
2. No Worker:
   - Fazer `env.ASSETS.fetch(request)` do shell.
   - Buscar os dados públicos mínimos do curso ou certificado (Hyperdrive, com timeout curto e fallback para meta genérica).
   - Aplicar **`HTMLRewriter`** para setar `<title>`, `meta[name=description]`, `og:title/description/image/url`, `og:image:width/height`, `link[rel=canonical]`, `robots` e JSON-LD `Course`.
   - Usar `setAttribute` e conteúdo em modo texto, que é **escapado por padrão**. Evitar `{ html: true }` com dados vindos do banco (proteção contra XSS) ([HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/), 2026-04-23).
3. **Opcional:** embutir no shell um bootstrap JSON com os dados públicos, para evitar uma ida extra à API (padrão citado pela CF como "SPA shell with bootstrap data").
4. **Pré-render no build:** só para páginas estáveis (home, sobre, termos). Um catálogo editado pela Staff exigiria rebuild e deploy a cada mudança, e o prerender roda com credenciais e bindings locais (alerta tanto da CF para TanStack Start quanto da WebCatalog com Astro).
5. **Custo e risco:** cada navegação nessas rotas invoca o Worker (faturável, mas desprezível na escala do LMS). Erros no HTMLRewriter podem truncar a resposta, então é preciso fallback para o shell sem modificação.

Isso **não é SSR de React**: o HTML do corpo continua sendo renderizado no cliente; só o `<head>` é enriquecido. É compatível com a decisão B11 ("sem SSR/RSC"), mas convém registrar o padrão como contrato (inferência).

---

## 7. Comparação de caminhos

| Caminho | Esforço inicial | Risco técnico | Atende o domínio novo (B1–B16)? | Lock-in/manutenção | Encaixe com decisões vigentes |
|---|---|---|---|---|---|
| **A. Port do legado via OpenNext** | Baixo a médio (semanas) | Médio: `proxy.ts` experimental, lag a cada minor do Next, #1413, cache com DO/D1/R2, sharp/pdfkit/pool `pg`, Sentry v11 | **Não**: só muda o hosting | Adaptador de terceiros; a CF prioriza o vinext para apps novos | Conflita com B11 (Next) e B12 (DO/KV/D1 não obrigatórios) **se** usado para a vNext; aceitável como ponte do **legado** |
| **B. Port via vinext** | Baixo a médio | **Alto hoje:** 1.0 com menos de 2 semanas, histórico de vulnerabilidades críticas, ~280 issues abertas | Não | Atrelado à Cloudflare e a uma reimplementação | Idem A, com mais risco |
| **C. Reescrita em TanStack Start (SSR seletivo)** | Alto | Médio: RC, releases frequentes | Sim | Médio | Exige reabrir B11 |
| **D. Reescrita SPA + Vite + Hono (plano atual)** | Alto | Médio: o risco está no **domínio** (financeiro, auth), não no runtime; o runtime é simples | Sim | Baixo (Hono e React padrão) | Plano aprovado |
| **E. Híbrido: A como ponte para o legado + D com coexistência e corte por coorte** | A + D | Menor risco de negócio; custo de manter dois sistemas | Sim (via D) | — | D aprovado; A precisa de autorização separada (tarefa no repo legado) |

---

## Implicações

### Quando portar via OpenNext faz sentido

- **O objetivo principal é sair da Vercel** por custo, limites ou contrato, e **o domínio atual atende**. Ou seja: não há a remodelagem que a vNext implica (CourseRelease, Entitlement/Enrollment, inbox/outbox financeiro, filas).
- O time aceita:
  1. trocar sharp por Images binding;
  2. validar ou trocar pdfkit;
  3. refatorar o `db` para cliente por requisição;
  4. migrar para Sentry v11;
  5. reescrever crons como `scheduled()`;
  6. evitar ou testar `proxy.ts`;
  7. pinar Next (≥ 16.3.8) e só subir de minor depois que o OpenNext publicar suporte.
- Não se usa ISR com revalidação, ou se aceita R2 + DO queue + D1/DO tag cache.
- Há uma **janela de transição** em que o legado precisa continuar no ar por meses (acessos e certificados históricos) e a conta da Vercel pesa. Nesse cenário o OpenNext é uma **ponte barata para o legado**, não a base da vNext.

### Quando reescrever faz sentido

- O produto **já decidiu mudar o modelo de domínio e as invariantes** (decisões B1–B16 e auditoria 01). Portar o código Next carregaria um modelo que a vNext explicitamente substitui (por exemplo, `CoursePublication` por clones, anti-seek e Server Actions como fronteira).
- A área logada é a maior parte do produto e as páginas públicas são poucas. SEO/OG se resolve com HTMLRewriter (§6), sem SSR.
- Querem runtime simples, testável em workerd e independente do ciclo de releases do Next, sem cache de página nem RSC, com custo de CPU baixo por requisição.

### Riscos de cada caminho

- **Port (OpenNext/vinext):**
  - Dependência de um adaptador que corre atrás de cada minor do Next (quebras no 16.1 e 16.2; correção do 16.3 em 2026-09).
  - Recursos experimentais: `proxy.ts`, PPR, `"use cache"`.
  - Bug aberto de redirect multi-host (#1413).
  - Gap de CPU do Next em Workers (reconhecido em 2025-10).
  - Observabilidade e DX piores que na Vercel.
  - A CF já sinaliza preferência pelo vinext, um risco de "deprioritização" do OpenNext a médio prazo (inferência).
  - Esforço gasto em código que pode ser descartado.
- **Reescrita (SPA + Hono):**
  - Risco clássico de big-bang: prazo e paridade (Joel, Fowler).
  - Perda de correções implícitas do legado.
  - Bugs de segurança em código novo, sobretudo se assistido por IA (lição do vinext).
  - Responsabilidade total por cache e autorização (lição da WebCatalog).
  - SEO/OG exige o padrão HTMLRewriter.
  - Dois sistemas em paralelo durante a transição: suporte, dados divididos, usuários com duas contas.

### Recomendação condicionada aos fatos

1. **Manter a reescrita SPA + Vite + Hono (B11) como base da vNext.** Os fatos não indicam um caminho de port que entregue o domínio novo, e os riscos do runtime da SPA + Hono são menores e mais controláveis que os do Next sobre adaptador. Condição: o escopo v1 continua sendo o domínio remodelado. Se o produto decidir que o modelo atual do legado basta, reavaliar o caminho A.
2. **Evitar o big-bang** e transformar a reescrita num strangler por fluxo e coorte:
   - novas Offers e matrículas na vNext;
   - legado somente para acessos e certificados históricos até expirarem;
   - URLs públicas de validação de certificado preservadas, via redirect ou proxy por rota no Worker;
   - corte de DNS só depois de Go/No-Go com reconciliação financeira.
3. **Spikes técnicos curtos e com escopo explícito antes de comprometer marcos** (DoR do AGENTS):
   - `pg` + Hyperdrive + Drizzle por requisição em workerd, com 6 conexões simultâneas;
   - Better Auth em Hono/Workers;
   - Browser Run para PDF de certificado (substitui pdfkit);
   - Images Transformations com fallback (substitui sharp);
   - HTMLRewriter com `run_worker_first` para catálogo e certificado, testado com o Sharing Debugger da Meta e o Post Inspector do LinkedIn;
   - Sentry (`@sentry/cloudflare` v11) no Worker.
4. **OpenNext como ponte opcional do legado, só se** a conta ou os limites da Vercel justificarem **e** a coexistência for durar meses.
   - Antes de decidir, fazer um spike de 1–2 dias para medir os gaps reais: sharp, pdfkit, pool, `proxy.ts`, crons, Sentry.
   - Isso é uma **tarefa no repositório legado**, que exige autorização explícita separada (o AGENTS proíbe editar o legado em tarefas da vNext).
   - Se a conta da Vercel for baixa, ficar na Vercel durante a transição é a opção mais barata em esforço.
5. **Não adotar o vinext agora.** Reavaliar em 6–12 meses, com atenção a auditorias de segurança pós-1.0, à redução das issues abertas e a casos de produção nomeados.
6. **Reabrir B11 para TanStack Start só se** surgir requisito concreto de SSR de corpo de página (SEO de conteúdo rico em escala, landing pages). Isso hoje está fora da v1. O padrão HTMLRewriter cobre título, descrição e OG.

---

## Fontes principais (com data de atualização ou publicação quando disponível)

- OpenNext Cloudflare: [visão geral](https://opennext.js.org/cloudflare), [caching](https://opennext.js.org/cloudflare/caching), [db](https://opennext.js.org/cloudflare/howtos/db), [image](https://opennext.js.org/cloudflare/howtos/image), [custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker), [troubleshooting](https://opennext.js.org/cloudflare/troubleshooting), [releases](https://github.com/opennextjs/opennextjs-cloudflare/releases) (1.20.10, 2026-10-09)
- Issues: [#1413](https://github.com/opennextjs/opennextjs-cloudflare/issues/1413) (2026-10-02), [#1410](https://github.com/opennextjs/opennextjs-cloudflare/issues/1410), [#1157](https://github.com/opennextjs/opennextjs-cloudflare/issues/1157) (2026-03-18), [#1049](https://github.com/opennextjs/opennextjs-cloudflare/issues/1049), [workers-sdk#13755](https://github.com/cloudflare/workers-sdk/issues/13755) (2026-04-30), [sentry-javascript#22794](https://github.com/getsentry/sentry-javascript/issues/22794) (2026-07-29 a 2026-09-08)
- Cloudflare docs: [Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) (2026-08-25), [OpenNext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) (2026-08-25), [limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-08), [Node.js APIs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) (2026-08-12), [fs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/) (2026-04-23), [Hyperdrive pg](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/) (2026-04-21), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) (2026-09-04), [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) (2026-08-25), [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) (2026-04-23), [Images binding](https://developers.cloudflare.com/images/transform-images/bindings/) (2026-09-02), [Images pricing](https://developers.cloudflare.com/images/pricing/) (2026-07-08), [R2 aws-sdk-js-v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) (2026-04-21), [TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) (2026-10-08), [React Router](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/) (2026-06-19), [Browser Run PDF](https://developers.cloudflare.com/browser-run/how-to/pdf-generation/)
- Blog Cloudflare: [vinext](https://blog.cloudflare.com/vinext/) (2026-02-24), [CPU benchmarks](https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/) (2025-10-14), [OpenNext 1.0-beta](https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/) (2025-04)
- vinext: [GitHub](https://github.com/cloudflare/vinext), [releases](https://github.com/cloudflare/vinext/releases) (1.0.0 em 2026-09-28; 1.1.0 em 2026-10-08), [Hacktron audit](https://www.hacktron.ai/blog/hacking-cloudflare-vinext) (2026-02-27), [itwriting beta 1](https://www.itwriting.com/blog/12442-cloudflares-vinext-project-reaches-beta-1-not-just-an-ai-experiment.html) (2026-07-12), [whoooop comparativo](https://whoooop.co.uk/blog/nextjs-on-cloudflare-workers) (2026-09-08)
- Next.js: [Across Platforms / Adapter API](https://nextjs.org/blog/nextjs-across-platforms) (2026-03-25), [Deploying](https://nextjs.org/docs/app/getting-started/deploying) (2026-08-06), [Deploying to Platforms](https://nextjs.org/docs/app/guides/deploying-to-platforms)
- Sentry: [Next.js on Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nextjs/)
- TanStack: [overview](https://tanstack.com/start/latest/docs/framework/react/overview), [RC post](https://tanstack.com/blog/announcing-tanstack-start-v1) (2025-09-23), [SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode), [Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr), [Makerkit](https://makerkit.dev/blog/tutorials/what-is-tanstack-start) (2026-07, revisado em 2026-10)
- React Router: [v8 blog](https://remix.run/blog/react-router-v8)
- Relatos: [Silvermine](https://www.silvermine.ai/newsletter/cloudflare-vs-vercel-nextjs-opennext) (2026-02-09), [BuildMVPFast](https://www.buildmvpfast.com/blog/vercel-vs-cloudflare-nextjs-hosting-migration-2026) (2026-06-01), [WebCatalog](https://webcatalog.io/en/blog/how-moving-from-vercel-to-cloudflare-workers-railway-cut-our-hosting-costs-by-80percent) (2026-09-23)
- Reescrita: [Joel Spolsky](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) (2000-04-06), [Fowler — Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html) (2024-08-22)
- SEO: [Google JS SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) (2026-03-04), [Meta web crawlers](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/)
- pdfkit: [issues "cloudflare"](https://github.com/foliojs/pdfkit/issues?q=cloudflare) (#1526, aberta desde 2024-06-14)
- Registro npm (consultado diretamente em 2026-10-09): `@opennextjs/cloudflare` 1.20.10; `vinext` 1.1.0; `next` 16.4.0; `@tanstack/react-start` 1.168.60; `react-router` 8.4.0; `@sentry/nextjs` e `@sentry/cloudflare` 11.6.0; `pdfkit` 0.20.2; `better-auth` 1.7.7; `hono` 4.13.13; `@cloudflare/vite-plugin` 1.63.1; `wrangler` 4.149.0.
