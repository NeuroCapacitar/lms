# Estado de implementação — Hub vNext

**Atualização:** 2026-10-10  
**Estado:** M0 praticamente concluído (M0-09 adiado, LinkedIn do M0-17 pendente); M1-01 `implemented` localmente, CI em verificação. M0 em andamento (M0-01 a M0-06 `verified` no CI; M0-07 `verified` no CI; M0-08 `homologated` em Staging e `verified` no CI; spikes M0-10, M0-11, M0-12, M0-15 e M0-18 passaram)  
**Próximo marco:** M0 — Fundação e spikes  
**Próxima tarefa recomendada:** M1-06 (magic link: página de confirmação, e-mail, Turnstile), depois M1-02 e M1-03; aplicar a migration 0001 e o segredo `BETTER_AUTH_SECRET` no Staging só com autorização; o LinkedIn do M0-17 segue pendente; M0-09 adiado (não autorizadas)  
**Task em execução:** nenhuma  
**Última tarefa comprovadamente verificada:** M0-08 (2026-10-10, no CI e em Staging)

> Nunca marcar tarefa ou marco como concluído com base em decisão, texto de plano, instrução para IA ou intenção. Só evidências reais de arquivos, comandos, testes, SHA e homologação justificam o status.

## Marcos

| Marco | Status | Evidência |
|---|---|---|
| M0 Fundação e spikes | `in_progress` | M0-01 a M0-06 `verified`; M0-07 `verified`; M0-08 `homologated` em Staging; spikes M0-10, M0-11, M0-12, M0-15 e M0-18 passaram (registro abaixo) |
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

### M1-01 — implemented localmente; CI em verificação (2026-10-10)

- **Entrega:** PR de `feat/m1-01-better-auth`. Better Auth **1.7.7** fixado (ADR 0029), sem métodos de login (magic link é a M1-06; sem Google, senha, passkey, plugin admin nem impersonation).
- **Código:** `src/db/schema.ts` (tabelas `user`, `session`, `account`, `verification`, `rate_limit`), migration `drizzle/0001_better_auth_identity.sql` (gerada pelo Drizzle e **revisada à mão**: FKs sem o prefixo `public` para o harness de testes e o `search_path`), `src/db/client.ts` (`openDatabase`), `src/server/auth/create-auth.ts` (`authOptions` e `createAuth`, uma instância por requisição), `src/server/auth/routes.ts` (`/api/auth/*` e `GET /api/me`, DTO `{ id, email, name }`, `Cache-Control: no-store`), variável `APP_BASE_URL` por ambiente (única origem confiável) e segredo `BETTER_AUTH_SECRET`; preflight recusa `APP_BASE_URL` com http, localhost, curinga ou caminho em Staging e Production.
- **Executado e passou (local):** `bun run verify` completo (exit 0; Gitleaks local pulado), com 102 testes Vitest e 18 do Playwright. Em **Postgres 18 real** (`test/pg/auth.pg.test.ts`, 10 testes): sessão nasce com ~7 dias, renova depois de 1 dia de uso e **não** reescreve dentro do mesmo dia; expira depois de 7 dias com relógio controlado; cookie com `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age=604800` e prefixo `__Secure-` em https; sign-out apaga a sessão no banco e vale na hora; origem não confiável recusada (403) e cookie sem `Origin` recusado; `/api/me` 401 sem sessão e com cookie forjado, 200 com DTO mínimo, isolamento entre pessoas. No workerd (Worker construído): `/api/me` 401 sem cache. Teste de schema (`src/server/auth/schema.test.ts`) compara cada modelo e campo do `getAuthTables()` com as tabelas Drizzle (mutação conferida: remover uma coluna o reprova).
- **Achados corrigidos:** (1) **por padrão o Better Auth desliga a checagem de origem quando `NODE_ENV=test` ou `TEST` está definida** e dispensa a validação do segredo: `disableOriginCheck: false` e `disableCSRFCheck: false` explícitos nas opções (os testes exercitam a checagem). (2) Um `use('*')` de middleware dentro do sub-app abria o banco para **qualquer** `/api`, inclusive 404 de varredura (acordaria o Neon): agora só em `/auth/*` e `/me`, com teste. (3) Sem cookie de sessão, `POST /api/auth/sign-out` responde 200 sem efeito (o CSRF só se aplica com cookie).
- **Desvios do plano:** (1) o schema foi escrito à mão a partir do `getAuthTables()` (a CLI `@better-auth/cli` publicada é a 1.4.21, anterior ao Better Auth 1.7.7); o teste de schema substitui a geração. (2) Novo projeto TypeScript `tsconfig.integration.json` (resolução `bundler` + tipos do Node) para os testes que importam `src/`. (3) `test/helpers/auth.ts` monta a **mesma** `authOptions` com o plugin `testUtils` do Better Auth, só em teste.
- **Não verificado:** Staging (a migration 0001 e o segredo `BETTER_AUTH_SECRET` **não** foram aplicados lá: `/api/me` e `/api/auth` falhariam no Staging até então; `health` não é afetado); cookie em Staging real (`Secure`, `HttpOnly`, `SameSite=Lax` foram provados em https simulado, não em Staging); CPU no plano Free (ver ADR 0029).

### M0-17 — passou tecnicamente e no Meta (2026-10-10); LinkedIn pendente

- **Entrega:** [ADR 0031](../adr/0031-spike-m0-17-htmlrewriter-meta-tags.md) e [evidências](../review/evidencias/m0-17/README.md). Spike **fora do repositório**; nenhum código de produção mudou. **Recurso ainda no ar:** Worker `m0-17-spike` (workers.dev, perfil `neurocapacitar`), mantido para os validadores; **apagar após o registro**. URLs de teste: `https://m0-17-spike.neurocapacitar-projetos.workers.dev/cursos/neuro-basico` e `…/cursos/curso-simples`.
- **Executado e passou (curl com User-Agent de crawler, Worker real):** tags reescritas por HTMLRewriter a partir de placeholders; título, descrição e URLs com aspas, `<`, `>`, `&` e entidades literais saem corretos; 404 byte a byte idêntico para inexistente, rascunho e arquivado; `__proto__` e `constructor` dão 404; `Host` forjado não altera a canônica; cabeçalhos da resposta montados do zero.
- **Achados:** o HTMLRewriter escapa só as aspas em atributos (precisa-se escapar `&` antes); copiar cabeçalhos do asset vazava `CF-Cache-Status`; a resposta dinâmica não passa pelo cache.
- **Validadores (responsável):** **Meta (Sharing Debugger): passou** (título, descrição e imagem corretos, caracteres especiais como texto, sem avisos; `og:image:alt` vazio). **LinkedIn (Post Inspector): falhou na conexão** ("Unable to connect to server"), com o Worker no ar; causa não identificada, hipótese `workers.dev`. **Pendente:** dois controles do responsável (um site qualquer e o `hub-staging` no Post Inspector). A M2-06 não é concluída sem o LinkedIn registrado.

### M0-15 — spike passou (2026-10-10)

- **Entrega:** [ADR 0030](../adr/0030-spike-m0-15-browser-run-pdf.md) e [evidências](../review/evidencias/m0-15/README.md). Spike **fora do repositório**; nenhum código de produção mudou. Recurso criado e apagado (perfil `neurocapacitar`): Worker `m0-15-spike` (workers.dev, plano Free, binding `BROWSER`); conferido que o endereço voltou a responder 404. Nenhum R2 foi criado.
- **Executado e passou:** PDF A4 paisagem (297,0 × 209,9 mm) com posição de campos a 0,1 mm do HTML; Lexend Deca embutida a partir de `data:` (sem recurso externo), acentos corretos, texto extraível; ~1,1 s por PDF; escape, CSP no HTML e bloqueio de rede comprovados (o log do Worker mostrou que a imagem externa bloqueada não foi buscada e a do controle foi).
- **Achados:** o JavaScript da página **executa** e `setJavaScriptEnabled: false` é ignorado (só a CSP no HTML o impede); o PDF **não é determinístico** (6 hashes para o mesmo HTML), então o hash é do arquivo guardado e reemitir cria novo arquivo; fontes saem em Type 3; ligaduras quebram a extração de "fi" (desligadas); nome longo encolhe a página inteira sem `overflow: hidden`; no Free, 1 requisição por 10 s (HTTP 429 sob concorrência); entrada de 8 MB leva 10 s sem falhar.
- **Não verificado:** gravação no R2 (fica para o M7); Acrobat e leitor do Edge/Preview (só pdf.js); impressão física; logotipos em `data:`; preço do Browser Run no Paid; caracteres fora do subconjunto latino.

### M0-09 — adiado para antes do M10 (decisão do responsável, 2026-10-10); inventário público e ferramenta de paridade prontos

- **Entrega:** [dns-inventory-and-cutover](../operations/dns-inventory-and-cutover.md), `scripts/dns-parity.ts` (+ `dns-parity-core.ts`, `dns-names.json`, teste unitário) e o script `dns:parity`. Só consultas DNS e RDAP públicas (somente leitura). **Não criei a zona na Cloudflare e não troquei nameservers.**
- **Fatos:** domínio no Registro.br (registro em 2026-05-21, expira em 2029-05-21); nameservers atuais `athena.` e `apollo.dns-parking.com`; DNSSEC desligado; e-mail da equipe no Lark Suite (MX, SPF); Resend já configurado em `send.` e `resend._domainkey` (usado pelo legado); `app` e `www` são CNAME para a Vercel (o legado); DMARC `p=none`.
- **Executado e passou:** teste unitário do núcleo de comparação (5 casos); a ferramenta rodada entre os dois nameservers atuais (15 registros em cada, paridade total), o que valida a consulta direta aos servidores autoritativos.
- **Achados:** o apex tem **dois IPs** (`76.76.21.21`, da Vercel, e `2.57.91.91`, que não identifiquei); o seletor DKIM do Lark é desconhecido, então o DKIM do e-mail da equipe não aparece no inventário; DNS público não permite listar a zona, então o inventário só fica completo com a exportação do painel.
- **Decisão (2026-10-10):** o responsável decidiu desenvolver no domínio temporário (`workers.dev`) e ajustar para o definitivo depois; o M0-09 sai do gate do M0 e passa a ser pré-requisito do M10 (e do que exigir zona na Cloudflare). **Pendente (responsável, quando retomar):** exportar a zona completa; informar onde se altera a delegação e quem tem acesso; confirmar `2.57.91.91`; autorizar a criação da zona (pendente) na Cloudflare; a troca de nameservers continua sendo etapa autorizada à parte, com janela e rollback.

### M0-10 — spike passou (2026-10-10)

- **Entrega:** [ADR 0029](../adr/0029-spike-m0-10-better-auth-magic-link.md) e [evidências](../review/evidencias/m0-10/README.md). Spike **fora do repositório**; nenhum código de produção mudou.
- **Recursos criados e apagados (perfil `neurocapacitar`, identidade verificada, autorizados pelo responsável):** Hyperdrive `m0-10-spike` (cache desligado, apontando ao Neon de testes `hub-test`, sem dado real) e Worker `m0-10-spike` (workers.dev, plano Free). Ao final: Worker e Hyperdrive apagados, tabelas do spike removidas do `hub-test`, conferido que a lista de Hyperdrive voltou aos três do projeto. A primeira tentativa de criar o Hyperdrive foi bloqueada pelo classificador de permissões; segui só depois da autorização explícita no chat.
- **Executado e passou:** roteiro de 20 verificações em workerd local contra o Neon (20/20) e no Worker real (basic 15/15, rate 2/2, seq 2/2): link usado duas vezes e expirado falham, GET/HEAD não criam sessão, POST exige origem, token com hash, sessão de 7 dias com renovação rolling, revogação imediata, rate limit em banco pelo IP real, e-mail de Staff bloqueado no cadastro livre, 20 fluxos em sequência sem conexão presa, Turnstile pelo plugin (400/403/200 com as chaves de teste da Cloudflare).
- **Medidas no edge (Free):** CPU p50 9 ms no pedido de link e 12 ms na confirmação (máx 67 e 46 na primeira requisição do isolate); scrypt 82 ms p50 e 125 ms máx; inicialização 56 ms; bundle 437 KiB gzip. **O limite de 10 ms do Free não comporta o fluxo: o Workers Paid vira requisito prático do M1.**
- **Achados:** falha de verificação responde com redirect 3xx (converter em JSON); três camadas de rate limit (padrão do plugin, `customRules`, opção do plugin; `customRules` vence); sem verificação de schema no CI com `validateSchema: false` (planejar teste contra `getAuthTables()`); o captcha só é exportado por `better-auth/plugins`.
- **Não verificado:** envio real por Resend, Turnstile com chave real e widget, concorrência paralela, fluxo no navegador com a página de confirmação em JavaScript, Google e senha.
- **Aviso operacional:** ao rodar spikes encontrei dezenas de processos `workerd` e `node` do `wrangler dev` de execuções anteriores ainda vivos (um driver antigo não matava a árvore de processos), ocupando a mesma porta e travando requisições; encerrei só os que eram dos spikes.

### M0-08 — homologated em Staging e verified no CI (2026-10-10)

- **Entrega:** PR #21 (`feat/m0-08-staging`), CI verde (`bloqueante` 1m45s, `consultivo`, `lint-workflows`). Código publicado: commit `06fb96d91fdfe592da73191d4e735f0a34a34af9` (os commits de documentação posteriores não mudam o código). Perfil `neurocapacitar` verificado antes (`cf auth whoami`, `wrangler auth list`, `sentry auth whoami`).
- **Recursos criados:** Worker `hub-staging` (https://hub-staging.neurocapacitar-projetos.workers.dev, plano Workers **Free**: o Paid segue não contratado), segredo `SENTRY_DSN` do Worker; no Sentry (org `neurocapacitar`, plano Developer) os projetos `hub-vnext-worker` e `hub-vnext-web`, com descarte de IP e limpador de dados ligados. O projeto `hub-web` pré-existente **não foi tocado**. Nada em Production.
- **Código:** `src/server/logging.ts` (evlog 2.30.1 fixado, redação de e-mail, token, cookie e link de acesso), `src/server/sentry.ts` e `src/web/observability.ts` (Sentry 11.6.0 com `dataCollection` mínima, `beforeSend`, sem breadcrumbs, sem tracing; o SPA carrega o Sentry depois da primeira renderização), `src/features/observability/*` (padrões e limpeza, puros, testados), `src/server/index.ts` (id de correlação gerado no servidor, ignora o `x-request-id` do cliente, devolve `x-request-id`), `health/live` e `health/ready` com `releaseId` (SHA embutido no build pelo Vite), Workers Logs ligado (`invocation_logs: false`), `scripts/deploy-staging.ts` (recusa árvore suja e commit fora do GitHub), `scripts/smoke.ts`, `.github/workflows/deploy-staging.yml` (manual, **sem os segredos no GitHub**).
- **Executado e passou:**
  - `bun run verify` completo local (exit 0; Gitleaks local pulado, o CI executa): 77 testes Vitest (inclui `src/server/app.test.ts`: `ready` com banco inalcançável devolve 503 com log de erro legível; e-mail, token, cookie, `Authorization` e `x-request-id` forjado não aparecem nos registros) e 18 do Playwright.
  - `bun run deploy:staging` e `bun run smoke`: `live` e `ready` 200 com `releaseId` igual ao SHA do commit; `ready` consulta o **Neon Staging** pelo Hyperdrive (648 ms no primeiro acesso, com o banco acordando).
  - **Varredura de logs com dados de teste** (e-mail `pessoa@example.com`, `TOKEN_SECRETO`, `COOKIE_SECRETO`, `x-request-id` forjado): o Workers Logs **persistido** (`cf observability telemetry query --profile neurocapacitar`) não contém nenhum deles; o e-mail da mensagem de erro saiu `[REDACTED]` e o id de correlação foi o gerado no servidor.
  - **Falha proposital:** um Worker temporário (versão `2ff69688…`, rota que lança erro, **não commitada**, já substituída pela versão `158a7a81…` do commit) mostrou o erro chegando ao Sentry (`HUB-VNEXT-WORKER-1`, título com `[email]`, sem usuário, cookies, cabeçalhos nem query). No SPA, um erro lançado no Chromium contra o Staging chegou como `HUB-VNEXT-WEB-1`, sem e-mail, query nem fragmento.
- **Achados corrigidos:** (1) **no Sentry 11 `sendDefaultPii` não existe e o padrão coleta tudo** (cookies, cabeçalhos, corpos, query, variáveis das pilhas): trocado por `dataCollection` mínima (ADR 0028, emenda). (2) O Sentry preencheu a geografia do usuário a partir do IP: `scrubIPAddresses` ligado nos dois projetos. (3) O preflight rejeitava `observability`: agora é chave benigna. (4) O `wrangler tail` mostra a URL com query e o `x-request-id` do cliente (só ao vivo; o log persistido está limpo).
- **Desvios do plano:** (1) o primeiro deploy foi feito **da máquina do responsável com o perfil `neurocapacitar`**, não pelo GitHub Actions: o workflow existe, mas o token Cloudflare para o GitHub não foi criado (a permissão de editar Workers vale para a conta toda e permitiria também publicar Production; passo a passo em [ambientes](../operations/environment-and-release-safety.md#staging-publicação-m0-08)). (2) Web Analytics **não foi ligado** (depende de confirmar a ausência de cookie e de um domínio definitivo; M0-09). (3) O Hyperdrive indisponível foi provado em teste de unidade, não derrubando o Hyperdrive real do Staging.
- **Atualização (2026-10-10):** o responsável criou o token e os secrets no GitHub; as variables foram definidas por `gh variable set`. O workflow `deploy-staging.yml` rodou com sucesso (run 38046262259, commit `1390e43`): deploy, `live` e `ready` com o SHA do commit. Na primeira execução o smoke falhou porque `live` ainda devolvia o SHA anterior por alguns segundos após o deploy (propagação); o PR #23 aumentou as tentativas. Esta nota substitui o desvio (1) acima: o deploy agora também roda pelo Actions.
- **Riscos abertos:** `hub-staging` e `health/ready` são públicos em `workers.dev` e acordam o Neon a cada chamada (aceitável em Staging vazio; proteger antes de dados reais); source maps do Sentry não enviados (a pilha sai com nomes do bundle); limites do plano Free do Workers (CPU, requisições) não medidos sob carga; o endpoint de pagamento e a CSP ainda não existem.
- **Responsável pela homologação:** quem abrir a URL do Staging e conferir o `releaseId`.

### M0-18 — spike passou (2026-10-10)

- **Entrega:** [ADR 0028](../adr/0028-spike-m0-18-evlog-e-sentry.md) e [evidências](../review/evidencias/m0-18/README.md). Spike em diretório descartável **fora do repositório**; nenhum código de produção mudou. Sem deploy, sem conta Cloudflare (workerd local) e **sem conta Sentry** (DSN apontando para um servidor local que gravou os envelopes). Nenhum recurso externo foi criado.
- **Executado:** `wrangler dev --local` (4.149.0) com Hono 4.13.13 + evlog 2.30.1 + `@sentry/hono` 11.6.0; SPA com `@sentry/react` 11.6.0 em Chromium (Playwright 1.64.0).
- **Resultados:** evento de erro chega sem e-mail, cookie nem token; log com e-mail, cookie, token e link mágico sai `[REDACTED]`; **controle negativo:** o SPA com a configuração padrão do Sentry envia URL com `?email=…&token=…#fragmento`, por isso o `beforeSend` é obrigatório. Também: o `x-request-id` do cliente vira `requestId` do evlog; o SDK copia o console para breadcrumbs (desligados). Bundle gzip: Hono 14,57 KiB, +evlog 37,14 KiB, +Sentry 128,31 KiB, ambos 151,60 KiB; SPA +39,65 KiB.
- **Não verificado:** envio a um Sentry real e source maps; logs de Queue e Cron; Workers Logs e Web Analytics em Staging (a documentação foi lida, não testada); `vite preview`/plugin Cloudflare Vite com o evlog. A leitura da documentação (limites do Workers Logs, preços do Sentry) foi feita por busca de páginas e resumida automaticamente: reconferir os números no painel antes de depender deles.
- **Pendência do responsável:** criar a conta e o projeto Sentry (plano Developer, sem cartão) e informar os DSNs do Worker e do SPA antes do M0-08; sem isso o Staging publica só com Workers Logs.

### M0-07 — verified no CI (2026-10-10)

- **Entrega:** PR #17 (`feat/m0-07-base-visual`); CI verde (`bloqueante` 1m36s, `consultivo` 24s), com Playwright, axe e Gitleaks no Linux. Nenhum recurso externo foi criado ou alterado (sem Cloudflare, sem Neon).
- **Dependências novas (versões exatas, licenças conferidas no registro):** Tailwind CSS 4.3.3 e `@tailwindcss/vite` 4.3.3 (MIT), `@base-ui/react` 1.9.0 (MIT), `@phosphor-icons/react` 2.1.10 (MIT), `@fontsource-variable/lexend-deca` 5.3.0 (OFL-1.1, fonte empacotada pelo Vite e servida da própria origem), `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0 e, em desenvolvimento, `@axe-core/playwright` 4.13.0 (MPL-2.0, só em testes).
- **Arquivos:** `src/web/styles/tokens.css` (3 camadas OKLCH), `src/web/styles/app.css`, `src/web/theme.ts`, `src/web/components/{theme-toggle,ui/button,ui/input,ui/field}.tsx`, `src/web/layouts/public-layout.tsx`, `src/web/routes/base-visual.tsx` (vitrine temporária), `test/helpers/color.ts`, `test/unit/contrast.test.ts`, `e2e/accessibility.spec.ts`, `tsconfig.e2e.json`.
- **Executado e passou (local):** `bun run verify` (typecheck, Oxlint, Oxfmt, `types:check`, drift, Vitest, Playwright, builds de Staging e Production com preflight, Knip, dependency-cruiser, agentes); Gitleaks local pulado (binário ausente; o CI executa).
  - **Contraste:** 54 pares declarados (texto ≥ 4,5:1; borda de controle e anel de foco ≥ 3:1) nos temas claro e escuro, calculados a partir do OKLCH do CSS. O bloco escuro do sistema é conferido contra o bloco escuro forçado e as camadas (marca → função → componente) são validadas. **Teste de mutação:** escurecer o texto do botão e clarear a borda fez o teste falhar com a razão calculada; clarear o texto secundário fez o axe falhar (`color-contrast`).
  - **Playwright (Chromium):** axe (tags WCAG 2.0/2.1/2.2 A e AA) sem violações em `/`, `/sobre` e `/base-visual` com o tema do sistema claro e escuro, e nos temas forçados, inclusive com erro de formulário; fluxo só por teclado (pular para o conteúdo, navegação, alternância de tema, erro anunciado com `aria-invalid`, envio válido); foco visível; tema persiste ao recarregar; nenhum script inline; todas as requisições na mesma origem (fonte autohospedada); nenhuma animação em andamento (WCAG 2.2.2).
- **Desvios do plano:** (1) tokens em `src/web/styles/` (e não `src/styles/`), junto do código da SPA. (2) Os componentes seguem o padrão shadcn (cva + `cn`) escritos à mão sobre Base UI, sem o CLI do shadcn nem `components.json`: não há catálogo a atualizar e a CLI traria dependências sem uso. (3) Variantes: o laranja usado no botão foi **clareado** (L 0,72 em vez de 0,675 do hex original) para o texto escuro passar com folga; petróleo escurecido para texto e links, terracota e oliva escurecidos no tema claro e clareados no escuro. Todos os matizes seguem **PENDENTES do cliente** (manual de marca em PDF e logo positivo). (4) `/base-visual` é uma vitrine para o teste de acessibilidade e deve sair do menu quando houver telas reais. (5) `tsconfig.e2e.json` separado, com a biblioteca DOM, para tipar os testes do Playwright sem levar DOM aos scripts. (6) Knip ignora `tailwindcss` e a fonte porque são consumidos por `@import` de CSS.
- **Não verificado:** Firefox e WebKit/Safari (só Chromium); leitor de tela real (o axe cobre regras automáticas, não a experiência de uso); `GET /api/health/ready` segue sem proteção (M4/M9).
- **Pendente:** cliente enviar o manual de marca e o logo positivo para substituir os valores provisórios.

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
