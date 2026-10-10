# W1 — Cloudflare + Neon: estado atual (lido em 2026-10-09)

> Pesquisa técnica para reavaliar a stack "Cloudflare-first pragmática" do LMS NeuroCapacitar Hub vNext.
> Escala-alvo: centenas de alunos, single-tenant, um produto, equipe pequena, usuários no Brasil.
>
> **Método:** leitura direta de páginas oficiais (developers.cloudflare.com, blog.cloudflare.com, neon.com, páginas de preço dos fornecedores). Cada fato traz `[fonte: URL, lido em 2026-10-09]`. Quando a página oficial não trouxe o dado, o item está marcado **"não confirmado"**. Inferências próprias estão marcadas **"(inferência)"**.
>
> **Limitação do processo:** o orçamento compartilhado de WebSearch esgotou-se no meio da pesquisa. A partir daí usei apenas WebFetch em URLs oficiais conhecidas. Por isso, alguns pontos ficaram sem uma segunda fonte: o limite de 50 usuários do Access Free, a localização de consumers de Queues, a interação entre Neon scale-to-zero e Hyperdrive e o roadmap de passkeys do Neon Auth. Eles aparecem como "não confirmado".

---

## Sumário de mudanças e surpresas relevantes (2026)

| # | Fato novo/relevante | Impacto |
|---|---|---|
| 1 | **Browser Rendering foi renomeado para "Browser Run" em 2026-04-15.** Agora existe a binding `env.BROWSER.quickAction("pdf", …)`, que dispensa API token. | Confirma o PDF via Browser Run. O nome "Browser Run" usado no projeto está correto. |
| 2 | **A precificação de observabilidade muda em 2026-12-01.** Logs e traces passam a ser cobrados por GB ingerido e armazenado, não mais por evento. | Revisar orçamento e sampling de logs. |
| 3 | **`nodejs_compat` e `nodejs_compat_v2` passam a ser default** para `compatibility_date >= 2026-08-04`. | Simplifica a configuração. |
| 4 | **O limite de tamanho do Worker passou a 64 MiB descomprimido, sem limite comprimido.** | Abre espaço para WASM pesado, como typst. O limite que pesa agora é a memória (128 MB/isolate). |
| 5 | **"Workers Previews" (`wrangler preview`, Wrangler ≥ 4.135.0).** Cada branch ganha um ambiente isolado com vars, secrets e bindings próprios. "Preview URLs" foram renomeadas para "Version URLs". | Alternativa ou complemento a Staging. Não substitui Staging para Queues e Cron. |
| 6 | **O cache de queries do Hyperdrive vem LIGADO por padrão** (`max_age` 60 s, SWR 15 s), e writes **não** invalidam o cache. | **Risco direto** para auth, sessões, RBAC e financeiro. Obriga config sem cache. |
| 7 | **O Hyperdrive não suporta advisory locks, LISTEN/NOTIFY nem PREPARE SQL.** | Fencing e locks precisam ser baseados em linhas, tokens ou leases no PG. |
| 8 | **Neon tem `aws-sa-east-1` (São Paulo) e suporta PG 14–18 (18.6).** | Confirma PG 18 e permite banco no Brasil. |
| 9 | **Neon agora é "from Databricks" (core "Lakebase Postgres").** Preços: Launch US$ 0,106/CU-h, Scale US$ 0,222/CU-h, storage US$ 0,35/GB-mês, sem mínimo mensal. | Custo baixo. Há risco estratégico de roadmap (foco em IA e Databricks). |
| 10 | **Neon Managed Better Auth está GA, mas sem passkey e sem hooks ou plugins customizados.** MFA está "coming soon". | Mantém o Better Auth self-hosted no Worker. |
| 11 | **D1 e R2 não têm location hint para a América do Sul.** D1 não documenta transações interativas (só `batch()`). | D1 é inadequado como banco principal com financeiro. Objetos no R2 ficam fora do Brasil. |
| 12 | **A cobrança de steps e storage do Workflows começou "não antes de" 2026-08-10** (500k steps/mês incluídos). | Workflows é viável e barato, mas não elimina o outbox. |
| 13 | **Cloudflare Email Sending está em beta, só no Workers Paid**, com 3.000 e-mails/mês incluídos e depois US$ 0,35/1k. Não documenta templates. | Confirma o Resend como provedor principal. |
| 14 | **PlanetScale Postgres tem plano de US$ 5/mês** (single node) e pode ser criado e faturado via Cloudflare. **Em São Paulo só há "metal"**, sem PS-*. | Alternativa barata apenas em regiões dos EUA. |
| 15 | **Placement (Smart/hints) só afeta handlers `fetch`.** | Consumers de Queue e Cron podem rodar longe do banco (não confirmado). |
| 16 | **Bot Fight Mode (Free) é "aplicado a todo o tráfego do domínio".** | Risco para webhooks Asaas. Não ativar sem teste. |
| 17 | **Logpush passou a estar disponível em planos self-serve** (antes era Enterprise). | Exportação durável de logs fica acessível. |

---

## A. Workers Paid

### Preço e incluídos
- **Base:** US$ 5/mês por conta. Inclui **10 milhões de requests/mês** (depois US$ 0,30/milhão) e **30 milhões de CPU-ms/mês** (depois US$ 0,02/milhão de CPU-ms). Não há cobrança de duração (wall time) nem de egress. [fonte: https://developers.cloudflare.com/workers/platform/pricing/, lido em 2026-10-09; página atualizada em 2026-10-02]
- **Free:** 100.000 requests/dia (reset à meia-noite UTC) e 10 ms de CPU por invocação. [fonte: https://developers.cloudflare.com/workers/platform/limits/, lido em 2026-10-09; página atualizada em 2026-10-08]
- **Static Assets:** requests a assets estáticos são **"free and unlimited"**. Só se cobra quando o Worker é invocado. Com `run_worker_first`, as rotas que casam contam como request do Worker. [fonte: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/, lido em 2026-10-09]

### Limites (Paid)
Fonte desta seção: https://developers.cloudflare.com/workers/platform/limits/, lido em 2026-10-09.

| Limite | Free | Paid |
|---|---|---|
| CPU por request HTTP | 10 ms | default 30 s, até **5 min** (configurável) |
| CPU em Cron | 10 ms | 30 s (intervalo < 1 h) ou 15 min (intervalo ≥ 1 h) |
| CPU em consumer de Queue | — | 30 s default, até 5 min via `limits.cpu_ms` |
| Memória | 128 MB por isolate (inclui heap JS e WASM) | 128 MB |
| Tamanho do Worker | **64 MiB descomprimido; "There is no compressed size limit"** | idem |
| Subrequests | 50/request | **10.000/request** (configurável até 10M) |
| Conexões simultâneas abertas | **6 por invocação** (conta conexões aguardando headers) | 6 |
| Duração (wall) | HTTP sem limite; Cron, DO alarm e Queue consumer: 15 min | idem |
| Startup do Worker | 1 s | 1 s |
| Workers por conta | 100 | 500 |
| Variáveis de ambiente | 64 por Worker | 128 por Worker (5 KB cada) |
| Cron Triggers por conta | 5 | 250 |
| Static assets por versão | 20.000 arquivos | **100.000** arquivos; 25 MiB por arquivo |
| Corpo da request | depende do plano da zona: Free/Pro 100 MB, Business 200 MB | — |

- **Observação:** o limite antigo de 3 MB/10 MB comprimido não aparece mais. A página atual diz que só o tamanho descomprimido conta. **Não confirmei a data dessa mudança.**
- **(inferência)** O limite de 6 conexões simultâneas por invocação deve valer também para sockets TCP de drivers Postgres via Hyperdrive. Não abra pools com várias conexões por request. Não confirmado explicitamente na documentação.

### Smart Placement e placement hints
Fonte desta seção: https://developers.cloudflare.com/workers/configuration/placement/, lido em 2026-10-09; página atualizada em 2026-04-23.
- **Smart Placement:** disponível em todos os planos, mas ainda **beta** (a página avisa que o header `cf-placement` pode sair "before Smart Placement exits beta"). A análise leva até 15 min após o deploy. Só considera locais onde o Worker já rodou, e 1% das requests ficam sem placement como baseline.
- **Placement hints:** `region = "aws:us-east-1"` (formato `{provider}:{region}` para AWS, GCP e Azure), `host = "db.example.com:5432"` (probe TCP, *experimental*) ou `hostname` (probe HTTP HEAD). As opções são mutuamente exclusivas.
- **Placement só afeta handlers `fetch`.** Não afeta RPC nem entrypoints nomeados. Static assets sempre saem do PoP mais próximo do usuário.
- **Para a latência até o banco**, a doc do Hyperdrive cita **20–30 ms por query** quando o Worker está longe do banco e **1–3 ms** quando está próximo. Recomenda placement quando a request faz várias queries sequenciais. [fonte: https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/, lido em 2026-10-09]
- **Não confirmado:** se `aws:sa-east-1` é aceito como hint. O formato é genérico; não há lista explícita de regiões.
- **Não confirmado:** onde rodam consumers de Queue e Cron. A doc de Cron diz que scheduled Workers rodam "on underutilized machines". [fonte: https://developers.cloudflare.com/workers/configuration/cron-triggers/, lido em 2026-10-09]

### Node.js compat
- **Para `compatibility_date >= 2026-08-04`, `nodejs_compat` e `nodejs_compat_v2` são habilitados por default.** Projetos novos devem omitir o flag. Para desligar, use `no_nodejs_compat` e `no_nodejs_compat_v2`. [fonte: https://developers.cloudflare.com/workers/configuration/compatibility-flags/, lido em 2026-10-09]
- **Totalmente suportados:** AsyncLocalStorage, Buffer, Crypto, Events, File system, HTTP/HTTPS, **Net**, Process, Stream, Timers, URL, Zlib e outros. **TLS/SSL é parcial.** `node:http2`, `child_process` e `worker_threads` são stubs. [fonte: https://developers.cloudflare.com/workers/runtime-apis/nodejs/, lido em 2026-10-09; atualizada em 2026-08-12]

### Static Assets e SPA
- **`not_found_handling = "single-page-application"`:** serve `/index.html` com 200 quando não há arquivo correspondente. [fonte: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/, lido em 2026-10-09; atualizada em 2026-08-25]
- **Requests de navegação** (`Sec-Fetch-Mode: navigate`) com `compatibility_date >= 2025-04-01` vão direto para assets, sem invocar o Worker. Um `fetch("/api/x")` ainda chega ao Worker. (mesma fonte)
- **`run_worker_first`:** `false` é o default; `true` invoca sempre o Worker; o array aceita até **100 padrões**, com `!` para negação (a negação tem precedência). Exige Wrangler ≥ 4.20.0 e Vite plugin ≥ 1.7.0. [fonte: https://developers.cloudflare.com/workers/static-assets/binding/, lido em 2026-10-09]

### Workers Builds (CI nativo)
Fonte desta seção: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/, lido em 2026-10-09; atualizada em 2026-05-29.

| | Free | Paid |
|---|---|---|
| Minutos de build/mês | 3.000 | 6.000; excedente US$ 0,005/min |
| Builds concorrentes | 1 | 6 |
| Timeout | 20 min | 20 min |
| Máquina | 2 vCPU, 8 GB RAM, 20 GB disco | 4 vCPU, 8 GB RAM, 20 GB disco |

- **Provedores:** GitHub, GitLab e "Artifacts". Branches que não são de produção geram **Preview builds**. A branch de produção cria uma versão e pode promovê-la a Active Deployment. É possível usar `wrangler versions upload` como comando de deploy para subir a versão sem promover. [fonte: https://developers.cloudflare.com/workers/ci-cd/builds/, lido em 2026-10-09; atualizada em 2026-10-01]

### Versions, gradual deployments e rollback
- **Gradual deployments:** só com as **últimas 100 versões** enviadas. Há version affinity opcional. Durable Objects rodam uma versão por vez. Exige Wrangler ≥ 3.40. [fonte: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/, lido em 2026-10-09]
- **Rollback:** até as **100 versões mais recentes**. **Recursos conectados (KV, D1, R2) não são revertidos.** O rollback é bloqueado se houver migração de classe DO no meio ou binding apontando para recurso inexistente. A página não menciona secrets nem assets. [fonte: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/, lido em 2026-10-09]
- **(inferência)** O rollback de código não desfaz migrations do Neon. Isso reforça a política expand/contract do projeto.

### Version URLs (antigas "preview URLs") e Workers Previews
- **Version URLs:** formato `<prefixo>-<worker>.<subdomínio>.workers.dev`, com alias opcional via `--preview-alias` e até 1.000 aliases. Só funcionam em `workers.dev`. **Não são geradas para Workers que implementam Durable Objects.** São **públicas**, a menos que protegidas por Cloudflare Access. Não aparecem em Workers Logs nem em tail. O campo de config continua `preview_urls`. [fonte: https://developers.cloudflare.com/workers/configuration/previews/, lido em 2026-10-09; atualizada em 2026-09-22]
- **Workers Previews (novo):** comando `wrangler preview` (Wrangler ≥ 4.135.0). Cria um ambiente por branch com vars, secrets, bindings, URL e observabilidade próprios, definidos num bloco `previews` da config. Cada Preview recebe um namespace de Durable Object próprio. KV, D1 e R2 só ficam isolados se você apontar para recursos separados. [fonte: https://developers.cloudflare.com/workers/previews/, lido em 2026-10-09; atualizada em 2026-09-24]
  - **Limitações:** **Cron e rotas sempre miram produção.** **Queue consumers não podem mirar um Preview.** Workflows usam os existentes. Service bindings chamam a produção do Worker alvo. As URLs são públicas por padrão.
  - **Limites:** 100 (Free) ou 500 (Paid) Previews por Worker, 100 deployments por Preview.

### Ambientes: Wrangler e Vite plugin
- **`CLOUDFLARE_ENV` é lido em `vite dev` e `vite build`.** Em `vite preview` ou `wrangler deploy` ele **não tem efeito**. O build gera um `wrangler.json` "achatado" para o ambiente escolhido, e o `wrangler deploy` usa esse output. Também dá para selecionar via `.env.<mode>` (por exemplo, `vite build --mode staging`). Há secrets locais por ambiente em `.dev.vars.<env>`. [fonte: https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/, lido em 2026-10-09; atualizada em 2026-04-23]
  - Isso confirma a regra do AGENTS.md: "CLOUDFLARE_ENV antes do build".

### `wrangler types`
- **O que gera:** `Env` a partir dos bindings, mais tipos de runtime a partir de `compatibility_date` e flags, em `worker-configuration.d.ts`. Agrega todos os ambientes, a menos que se passe `--env`.
- **`--check`:** compara o hash de config e o header de runtime gravados. Sai com 0 se está atualizado e 1 se está desatualizado. Não regenera o arquivo nem valida o corpo dele.
- **Outros flags:** `--strict-vars` (default true), `-c` múltiplo (adiciona tipos RPC de outros Workers), `--include-runtime` e `--include-env`.
- **`@cloudflare/workers-types`:** fica restrito a Wrangler antigo.
- [fonte: https://developers.cloudflare.com/workers/wrangler/commands/workers/, lido em 2026-10-09]

---

## B. Hyperdrive

- **Preço:** incluído nos planos Free e Paid. **Free: 100.000 queries/dia** (falha ao exceder). **Paid: queries ilimitadas.** Pooling, cache e egress não têm custo. Cached e uncached contam igualmente para o limite Free. **Novo:** é possível criar bancos PlanetScale (Postgres e MySQL) pela Cloudflare, cobrados na fatura Cloudflare ao preço PlanetScale. [fonte: https://developers.cloudflare.com/hyperdrive/platform/pricing/, lido em 2026-10-09; atualizada em 2026-06-18]
- **Limites** [fonte: https://developers.cloudflare.com/hyperdrive/platform/limits/, lido em 2026-10-09]:

  | | Free | Paid |
  |---|---|---|
  | Configs por conta | 10 | 25 |
  | Conexões de origem por config | ~20 | **~100** |
  | Duração máxima de query | 60 s | 60 s |
  | Resposta cacheável | até 50 MB | até 50 MB |
  | Idle timeout | 10 min | 10 min |
  | Timeout de conexão inicial | 15 s | 15 s |

  - O pool tem `max_size` como limite *soft* (mínimo 5) e pode exceder temporariamente. [fonte: https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/, lido em 2026-10-09]
- **Bancos e drivers:**
  - **PostgreSQL 9.0 até 18.x** suportado. Neon está listado, embora a página ainda diga "Neon currently runs Postgres 15.x", o que está desatualizado. [fonte: https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/, lido em 2026-10-09; atualizada em 2026-09-30]
  - **Drivers recomendados para Neon via Hyperdrive:** `pg` (node-postgres ≥ **8.16.3**) ou Postgres.js. **A doc desaconselha o driver serverless da Neon** com Hyperdrive. [fonte: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/, lido em 2026-10-09]
- **Neon pooled vs direct:** use a connection string **direta (sem pooler)**; o Hyperdrive faz o pooling. (mesma fonte)
  - A Neon também diz que **"Hyperdrive is the recommended approach"** para Workers, com drivers nativos e pooling desligado na string. O driver serverless da Neon (HTTP/WebSocket) usa string *pooled*. [fonte: https://neon.com/docs/guides/cloudflare-workers, lido em 2026-10-09]
- **Pooling em modo transação.** **Transações interativas são suportadas:** o cliente segura uma conexão durante o `BEGIN…COMMIT`. `SET` vale apenas dentro da transação ou query, e a conexão é resetada ao voltar ao pool. **Named prepared statements são suportados em `pg` e `postgres.js`.** [fonte: https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/, lido em 2026-10-09]
- **Não suportados:** PREPARE/EXECUTE/DEALLOCATE/DISCARD SQL, **advisory locks**, **LISTEN/NOTIFY** e mudanças de estado de sessão não documentadas. Temp tables, COPY e cursores não são mencionados (não confirmado). [fonte: https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/, lido em 2026-10-09]
- **Cache de queries (atenção):** [fonte: https://developers.cloudflare.com/hyperdrive/concepts/query-caching/, lido em 2026-10-09; atualizada em 2026-07-05]
  - **Ligado por padrão.** `max_age` default de 60 s (máximo de 1 h) e `stale_while_revalidate` de 15 s.
  - **"Hyperdrive does not invalidate cached read query results when your application writes to your database."**
  - Não cacheia writes nem funções `VOLATILE`/`STABLE` (`NOW()`, `RANDOM()` etc.). Nomes de função dentro de comentários SQL podem tornar a query não-cacheável. A página não esclarece se queries dentro de transação são cacheadas (não confirmado).
  - **Recomendação oficial:** usar uma config **com cache desabilitado** (`--caching-disabled`) para "authentication, sessions, permissions, billing, admin settings, and reads right after a write". Isso pode ser feito com dois bindings (cached e uncached). Somar as conexões de todas as configs ao dimensionar o banco.
- **Latência:** o pool fica em regiões próximas ao banco de origem; a conexão é iniciada no edge. O placement só ajuda quando a request faz várias queries sequenciais. [fonte: https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/, lido em 2026-10-09]
  - **Não confirmado:** se existe ponto de pool do Hyperdrive na América do Sul.
- **Desenvolvimento local:** `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>` ou `localConnectionString`. **Cache e pooling não são emulados** em `wrangler dev`. `--remote` usa a config real e escreve no banco real. [fonte: https://developers.cloudflare.com/hyperdrive/configuration/local-development/, lido em 2026-10-09]
- **Banco privado:** via Cloudflare Tunnel com service token do Access. A doc não fala em IPs de egress estáticos do Hyperdrive (não confirmado). [fonte: https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/, lido em 2026-10-09]

---

## C. Queues, Cron, Workflows e Durable Objects

### Queues
- **Preço:** **Free: 10.000 operações/dia, retenção fixa de 24 h.** **Paid: 1M operações/mês incluídas**, depois US$ 0,40/milhão; retenção default de 4 dias, configurável até 14. [fonte: https://developers.cloudflare.com/queues/platform/pricing/, lido em 2026-10-09]
  - Cada write, read ou delete conta como 1 operação por 64 KB. Uma entrega típica custa 3 operações. Cada retry adiciona um read. Ir para a DLQ custa um write.
- **Limites:** mensagem de 128 KB; batch de consumer de até 100; `sendBatch` de até 100 mensagens ou 256 KB; batch wait de até 60 s; **até 100 retries**; **`delaySeconds` até 24 h**; retenção até 14 dias; 5.000 msg/s por fila; 250 invocações concorrentes de consumer; consumer com 15 min de wall e 30 s de CPU (até 5 min); backlog de 25 GB por fila. [fonte: https://developers.cloudflare.com/queues/platform/limits/, lido em 2026-10-09]
- **Entrega "at least once".** A recomendação oficial é usar ID único e chave de idempotência. [fonte: https://developers.cloudflare.com/queues/reference/delivery-guarantees/, lido em 2026-10-09]
- **DLQ:** configurada por `dead_letter_queue`, com **3 retries por padrão**. **Mensagens na DLQ sem consumer são apagadas após 4 dias.** **Sem DLQ, mensagens que esgotam retries são apagadas.** [fonte: https://developers.cloudflare.com/queues/configuration/dead-letter-queues/, lido em 2026-10-09]

### Cron Triggers
- **Limites:** 5 por conta no Free e **250 no Paid**. [fonte: https://developers.cloudflare.com/workers/platform/limits/, lido em 2026-10-09]
- **Comportamento:** horário sempre em **UTC**. Mudanças levam até 15 min para propagar. **O deploy substitui a lista `crons`.** A página **não declara garantia de execução** (at-least-once, atraso, skip). O histórico no dashboard guarda as 100 últimas execuções. Há teste local via `/cdn-cgi/local/scheduled`. [fonte: https://developers.cloudflare.com/workers/configuration/cron-triggers/, lido em 2026-10-09; atualizada em 2026-09-04]

### Workflows
- **Status:** **GA desde 2025-04-07.** [fonte: https://developers.cloudflare.com/changelog/post/2025-04-07-workflows-ga/, lido em 2026-10-09 via resultado de busca]
- **Preço** [fonte: https://developers.cloudflare.com/workflows/reference/pricing/, lido em 2026-10-09; atualizada em 2026-09-21]:
  - **Paid:** requests e CPU como Workers; storage com 1 GB-mês incluído, depois US$ 0,20/GB-mês; **steps com 500.000/mês incluídos, depois US$ 0,80 por 100.000**.
  - **Free:** 3.000 steps/dia e 1 GB-mês.
  - A cobrança de steps e storage começa **"starting August 10th, 2026"** (o changelog dizia "no earlier than"). Não confirmei se a cobrança já está ativa. [fonte adicional: https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/, via busca]
- **Limites** (Free / Paid) [fonte: https://developers.cloudflare.com/workflows/reference/limits/, lido em 2026-10-09]:
  - Steps por workflow: 1.024 / **10.000 (até 25.000)**.
  - **`step.sleep` até 365 dias.**
  - Resultado de step não-stream ≤ 1 MiB.
  - Estado por instância: 100 MB / 1 GB.
  - Instâncias concorrentes: 100 / **50.000**.
  - Criação de instâncias: 300/s por conta, 100/s por Workflow.
  - Retenção de instâncias concluídas: 3 / 30 dias.
  - Payload de evento ≤ 1 MiB.
  - Até 10.000 retries por step.
- **Como alternativa ao outbox + queue + reconciler (análise, inferência):**
  - **A favor:** retries por step com backoff, `sleep` longo, `waitForEvent` (útil para "aguardar confirmação de pagamento"), estado durável e um ID de instância que pode ser determinístico (idempotente). Isso substitui bem a orquestração multi-etapas, como certificado (render → R2 → hash → marcar emitido → e-mail) ou reembolso.
  - **Contra:** **não resolve a escrita dupla entre o PG e o disparo.** Criar uma instância de Workflow não participa da transação do Postgres. Ainda é preciso registrar a intenção no PG (outbox ou linha de comando) e ter um sweeper que (re)crie instâncias com ID = ID da intenção.
  - **Contra:** Workflows não aparecem isolados em Previews; a fonte da verdade continua sendo o PG; há limite de 1 MiB por resultado de step; e cada `sleep`/`waitForEvent` conta como step.
  - **Conclusão:** Workflows pode **substituir a Queue como executor** de processos longos, mas **não substitui o outbox nem o reconciler**. Para centenas de alunos, o custo é desprezível.

### Durable Objects (SQLite-backed)
- **Free:** só o backend SQLite; 100k requests/dia; 13.000 GB-s/dia; 5M rows lidas e 100k escritas por dia; 5 GB.
- **Paid:** 1M requests/mês (depois US$ 0,15/M); 400k GB-s (depois US$ 12,50/M GB-s); 25 bilhões de rows lidas e 50M escritas (depois US$ 0,001/M e US$ 1,00/M); 5 GB-mês (depois US$ 0,20/GB-mês).
- **Alarmes:** `setAlarm()` conta como 1 row escrita e a invocação conta como request.
- A cobrança de storage SQLite estava prevista para "January 7, 2026 at the earliest"; a página ainda usa futuro e **não confirma se já está ativa**.
- [fonte: https://developers.cloudflare.com/durable-objects/platform/pricing/, lido em 2026-10-09; atualizada em 2026-09-30]
- **(inferência)** Como o Hyperdrive não suporta advisory locks, um DO por recurso poderia servir de mutex. Porém isso adiciona um segundo sistema de estado. Para o volume do projeto, **lease e fencing em coluna do PG (`SELECT … FOR UPDATE SKIP LOCKED`, token de versão)** são mais simples.

---

## D. D1

- **Limites** (Free / Paid) [fonte: https://developers.cloudflare.com/d1/platform/limits/, lido em 2026-10-09]:
  - Bancos por conta: 10 / 50.000.
  - **Tamanho máximo do banco: 500 MB / 10 GB (não aumentável).**
  - Storage por conta: 5 GB / 1 TB.
  - Queries por invocação: 50 / 1.000.
  - **Time Travel (PITR): 7 / 30 dias.**
  - Query de até 30 s; row ou BLOB de até 2 MB; statement de até 100 KB; 100 parâmetros.
  - **Cada banco é single-threaded:** cerca de 1.000 qps com queries de 1 ms, ou cerca de 10 qps com queries de 100 ms. Ao exceder, devolve erro "overloaded".
- **Preço:** Paid inclui 25 bilhões de rows lidas/mês (depois US$ 0,001/M), 50M rows escritas (depois US$ 1,00/M) e 5 GB (depois US$ 0,75/GB-mês). [fonte: https://developers.cloudflare.com/workers/platform/pricing/, lido em 2026-10-09]
- **Transações:** a API documenta apenas `batch()`. "Batched statements are SQL transactions", e uma falha aborta ou faz rollback da sequência. D1 opera em auto-commit. **Não há menção a BEGIN/COMMIT interativo.** [fonte: https://developers.cloudflare.com/d1/worker-api/d1-database/, lido em 2026-10-09]
  - Fontes de terceiros (fev/2026) descrevem workarounds pela falta de transações interativas. Não consegui ler o post diretamente: https://event-driven.io/en/cloudflare_d1_transactions_and_tradeoffs/ (não confirmado).
- **Read replication e Sessions API:** `withSession()` com bookmark garante consistência sequencial (read-your-writes). Réplicas em ENAM, WNAM, WEUR, EEUR, APAC e OC, sem custo extra. A página não diz se é beta ou GA. [fonte: https://developers.cloudflare.com/d1/best-practices/read-replication/, lido em 2026-10-09; atualizada em 2026-08-10]
- **Localização:** **"D1 location hints are not currently supported for South America (`sam`)."** Jurisdições disponíveis: eu, us e fedramp. [fonte: https://developers.cloudflare.com/d1/configuration/data-location/, lido em 2026-10-09; atualizada em 2026-10-02]
- **D1 como alternativa ao Neon** (análise):
  - **Prós:** custo praticamente zero nessa escala; Time Travel de 30 dias incluído; zero conexões e zero Hyperdrive; integração nativa com Workers, Previews e Vitest.
  - **Contras concretos:**
    - Sem transações interativas: inviabiliza `SELECT … FOR UPDATE`, ler-decidir-escrever atômico e fencing transacional, que são o coração do financeiro (Order/Payment/Refund/Entitlement).
    - SQLite em vez de PG 18: sem enums, sem `jsonb` PG, sem exclusion constraints e sem tipos usados em constraints de concorrência.
    - Primário fora do Brasil (nenhum hint `sam`): latência maior e dados pessoais fora do país.
    - Teto rígido de 10 GB.
    - Escritor único.
    - Contradiz decisões aprovadas (PG 18, Drizzle via Hyperdrive, `pg_dump` + `age`).
  - **Veredito:** **não é viável como banco principal** de um LMS com pagamentos e invariantes concorrentes. Serve, no máximo, para dados auxiliares, o que não é necessário aqui.
- **Custo Hyperdrive vs D1:** o Hyperdrive é gratuito (queries ilimitadas no Paid). O custo real fica no Neon (ver M). D1 sairia por cerca de US$ 0 nessa escala.

---

## E. R2

- **Preço** [fonte: https://developers.cloudflare.com/r2/pricing/, lido em 2026-10-09; atualizada em 2026-10-01]:

  | | Standard | Infrequent Access |
  |---|---|---|
  | Storage | US$ 0,015/GB-mês | US$ 0,01/GB-mês |
  | Class A (escritas, listagens) | US$ 4,50/M | US$ 9,00/M |
  | Class B (leituras) | US$ 0,36/M | US$ 0,90/M |
  | Retrieval | — | US$ 0,01/GB |
  | Duração mínima | — | 30 dias |

  - **Free tier mensal (só Standard):** 10 GB-mês, 1M Class A e 10M Class B.
  - **Egress gratuito** via Workers API, S3 API e r2.dev. DeleteObject e AbortMultipartUpload são gratuitos; 401 não é cobrado.
- **Presigned URLs** [fonte: https://developers.cloudflare.com/r2/api/s3/presigned-urls/, lido em 2026-10-09; atualizada em 2026-08-22]:
  - Suportam GET, HEAD, PUT e DELETE. **POST (form/policy) não é suportado.** Validade de 1 s a 7 dias.
  - **Content-Type pode ser assinado** (enviar outro gera 403).
  - **A página não documenta se Content-Length ou headers de checksum assinados são aplicados.** Não confirmado; precisa de teste.
  - **Funcionam apenas no domínio S3** (`<ACCOUNT_ID>.r2.cloudflarestorage.com`), não em custom domain.
  - A URL é um bearer token reutilizável até expirar. CORS é necessário para uso no browser.
- **Compatibilidade S3 do PutObject:** suporta Content-MD5 e escritas condicionais (If-Match, If-None-Match), além de SSE-C. **Não suporta Object Lock da API S3, tagging nem KMS.** O PutObject não lista headers `x-amz-checksum-*`. Na tabela de algoritmos, CRC64NVME é FULL_OBJECT ✅ e SHA-256 é só COMPOSITE. [fonte: https://developers.cloudflare.com/r2/api/s3/api/, lido em 2026-10-09]
  - **Implicação:** a validação de bytes pós-upload no servidor (HEAD, tamanho, ETag, magic bytes e SHA-256 calculado no Worker) continua necessária, como já previsto.
- **Custom domain e acesso público:** o domínio precisa ser zona na mesma conta (aceita CNAME setup). **r2.dev tem rate limit e é só para desenvolvimento.** Cache, WAF, Access e token auth exigem custom domain. Para cachear tudo, é preciso uma regra "Cache Everything". [fonte: https://developers.cloudflare.com/r2/buckets/public-buckets/, lido em 2026-10-09]
- **Event notifications:** eventos `object-create` (Put, Copy, CompleteMultipart) e `object-delete` (inclui deleção por lifecycle), entregues **apenas para Queues**. Até 100 regras por bucket. A mensagem traz key, size e eTag. A página não declara garantia de entrega. [fonte: https://developers.cloudflare.com/r2/buckets/event-notifications/, lido em 2026-10-09]
- **Bucket locks:** retenção por prazo, data ou indefinida, com prefixo, até 1.000 regras. **Têm precedência sobre lifecycle.** Impedem esvaziar o bucket. Não há comparação com os modos compliance/governance da S3. [fonte: https://developers.cloudflare.com/r2/buckets/bucket-locks/, lido em 2026-10-09]
  - Útil para PDFs de certificado revogados (retenção de 90 dias).
- **Criptografia:** AES-256 (preferencialmente GCM) em repouso, sempre ligada, com chaves gerenciadas pela Cloudflare. SSE-C é suportado na API S3. [fonte: https://developers.cloudflare.com/r2/reference/data-security/, lido em 2026-10-09]
- **Localização:** hints wnam, enam, weur, eeur, apac e oc. **Sem América do Sul.** Jurisdições: eu, us e fedramp. [fonte: https://developers.cloudflare.com/r2/reference/data-location/, lido em 2026-10-09]

---

## F. Images

- **Free:** **5.000 transformações únicas/mês.** Acima disso, as já cacheadas continuam funcionando e **as novas retornam erro 9422, sem cobrança**. O parâmetro `onerror` pode redirecionar para o original na mesma zona.
- **Paid:** 5.000 incluídas, depois **US$ 0,50 por 1.000 transformações únicas/mês**.
- **Images Hosted:** **US$ 5 por 100.000 imagens armazenadas/mês** e **US$ 1 por 100.000 entregues**.
- **Contagem:** cada combinação origem+parâmetros conta uma vez por mês calendário. `format` não gera transformação extra. `.info()` é grátis.
- [fonte desta lista: https://developers.cloudflare.com/images/pricing/, lido em 2026-10-09; atualizada em 2026-07-08]
- **Requisito de zona:** a transformação por URL (`/cdn-cgi/image/…`) exige **habilitar Transformations na zona**. Por padrão, a origem precisa estar na mesma zona; outras origens podem ser liberadas. [fonte: https://developers.cloudflare.com/images/transform-images/, lido em 2026-10-09]
- **Binding Images no Worker:** `.input(stream)` (até **20 MB**), `.transform()`, `.draw()`, `.output({format})`, `.info()` e `.text()`.
  - Aceita R2 como fonte.
  - É **cobrado como transformação única**.
  - **Não cacheia automaticamente**: a doc recomenda Cache API e `Cache-Control`.
  - Em `wrangler dev` roda em "baixa fidelidade" (só width, height, rotate e format).
  - **Não confirmado:** disponibilidade no plano Free.
  - [fonte: https://developers.cloudflare.com/images/transform-images/bindings/, lido em 2026-10-09; atualizada em 2026-09-02]
- **Limites de formato, dimensão e AVIF:** não estavam na página lida. **Não confirmado.**

---

## G. Stream e Media Transformations

- **Stream** [fonte: https://developers.cloudflare.com/stream/pricing/, lido em 2026-10-09; atualizada em 2026-09-08]:
  - **US$ 5 por 1.000 minutos armazenados/mês** (pré-pago, em blocos) e **US$ 1 por 1.000 minutos entregues**.
  - Ingestão e encoding grátis. Não há free tier listado.
  - Live é cobrado igual; billing de WebRTC a partir de 2026-10-15.
- **Media Transformations:** US$ 0,50 por 1.000 transformações únicas/mês, com 5.000 grátis. Via binding, não são cobradas durante o beta. (mesma fonte)
- **Signed URLs e DRM:**
  - Existe `requireSignedURLs`, com tokens via `/token` (1 h por padrão) ou assinados localmente com signing key, mais restrições de geo e IP. Bindings mais novos geram tokens sem gerenciar chaves. [fonte: https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/, via resultado de busca]
  - **DRM (Widevine/FairPlay):** não há evidência de suporte. A única fonte é uma resposta antiga de staff no Community dizendo que não é suportado. **Não confirmado em doc oficial atual.**
- **Relevância:** Stream é um dos seis adapters previstos. Não é necessário como mídia canônica.

---

## H. Browser Run (antigo Browser Rendering)

- **Renomeação:** em **2026-04-15**, Browser Rendering passou a se chamar **Browser Run**. Na mesma data subiram os limites Paid e chegaram Live View, Human in the Loop, gravações e WebMCP. [fonte: https://developers.cloudflare.com/changelog/post/2026-04-15-br-rename/, via resultado de busca, lido em 2026-10-09]
- **Preço** [fonte: https://developers.cloudflare.com/browser-run/pricing/, lido em 2026-10-09]:
  - **Free:** 10 min de browser/dia e 3 browsers concorrentes.
  - **Paid:** **10 browser-hours/mês incluídas, depois US$ 0,09/hora**; 10 browsers concorrentes incluídos (média mensal dos picos diários), depois US$ 2,00 por browser concorrente adicional.
  - **Quick Actions** (como `/pdf`) **cobram apenas horas.** Browser Sessions (Puppeteer, Playwright, CDP) cobram horas e concorrência.
  - Falhas por `waitForTimeout` não são cobradas.
- **Limites** (Free / Paid) [fonte: https://developers.cloudflare.com/browser-run/limits/, lido em 2026-10-09; atualizada em 2026-09-26]:
  - Browsers concorrentes: 3 / **200**.
  - Novas instâncias: 1 a cada 20 s / 3 por s.
  - **REST/Quick Actions: 1 a cada 10 s / 30 por s.**
  - Timeout default de 60 s; `keep_alive` de até 10 min.
  - Sessões caem com 1 min de inatividade **e também quando há rollout de nova release** do Browser Run.
- **`/pdf`** [fonte: https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/, lido em 2026-10-09; atualizada em 2026-09-26]:
  - REST: `POST /accounts/<id>/browser-run/pdf` com `html` ou `url`.
  - **No Worker:** `env.BROWSER.quickAction("pdf", {...})`, **sem API token**.
  - Opções: `pdfOptions` (formato, landscape, `printBackground`, `preferCSSPageSize`, margens, header e footer), `addStyleTag` (fontes e CSS), `gotoOptions`, `rejectRequestPattern` e `allowRequestPattern`.
  - Corpo de até 50 MB.
- **Adequação para certificados (inferência):**
  - **Sim.** Com centenas de certificados por mês, a alguns segundos cada, o uso fica dentro das 10 h incluídas.
  - Recomendações: embutir a fonte Lexend Deca em base64 no HTML, usar `rejectRequestPattern` e allowlist para bloquear toda rede externa (mitiga SSRF e vazamento) e escapar todo dado do aluno.
  - Como sessões podem cair em releases, o processamento deve ser assíncrono e idempotente (Queue ou Workflow), como já previsto.
- **Alternativas dentro do Worker** (prós e contras; nenhuma foi testada nesta pesquisa):

  | Opção | Prós | Contras |
  |---|---|---|
  | **pdf-lib** | JS puro, sem browser ("any modern JavaScript runtime"), barato em CPU, PDF vetorial com fonte embutida via `@pdf-lib/fontkit`. Bom para template fixo. | **Última versão 1.17.1, publicada em nov/2021** (sem release desde então) [fonte: https://registry.npmjs.org/pdf-lib/latest e https://github.com/Hopding/pdf-lib, lidos em 2026-10-09]. Layout manual por coordenadas e sem quebra de texto automática. Contradiz a decisão "HTML/CSS controlado". |
  | **@react-pdf/renderer** | Layout declarativo em React com flexbox (yoga). | Há relatos de problemas com yoga WASM e de `__dirname` em bundles ESM. **Compatibilidade com workerd não confirmada.** [fonte: https://react-pdf.org/compatibility, via busca] |
  | **satori + resvg-wasm** | Gera SVG ou PNG a partir de JSX; é usado para OG images em Workers. | **Não gera PDF.** Exigiria rasterizar e embutir a imagem em PDF: texto não selecionável e pior acessibilidade e integridade. |
  | **typst (wasm: typst.ts / typst-wasm)** | Tipografia de qualidade e templates declarativos. Agora cabe no limite de 64 MiB descomprimido. | Fontes precisam ir no bundle; WASM pesado com memória de 128 MB por isolate; projetos jovens. **Funcionamento em Workers não confirmado.** [fonte: https://forum.typst.app/t/typst-wasm-compile-typst-in-browsers-node-and-serverless-runtimes/9399, via busca] |

  - **Recomendação (inferência):** manter o Browser Run. O custo é desprezível e a decisão "HTML/CSS controlado" é preservada. pdf-lib serve como plano B emergencial.

---

## I. Observabilidade

- **Workers Logs (até 2026-11-30):**
  - **Free:** 200.000 eventos/dia, retenção de 3 dias.
  - **Paid:** 20M eventos/mês, depois US$ 0,60/milhão, retenção de 7 dias.
  - Limite diário de 5 bilhões por conta (depois disso aplica-se amostragem de 1%). Log máximo de 256 KB (truncado acima disso). `head_sampling_rate` vai de 0 a 1.
  - Pode desligar `invocation_logs`. Workers novos já vêm com observability ligada.
  - [fonte: https://developers.cloudflare.com/workers/observability/logs/workers-logs/, lido em 2026-10-09; atualizada em 2026-10-02]
- **Nova precificação unificada a partir de 2026-12-01** [fonte: https://developers.cloudflare.com/observability/pricing/, lido em 2026-10-09; atualizada em 2026-10-05; anúncio de 2026-10-02 em https://blog.cloudflare.com/one-observability-platform/]:
  - **Free:** 0,5 GB ingerido/dia, retenção de 7 dias, sem excedente (a ingestão para até 00:00 UTC).
  - **Paid:** **50 GB ingeridos + 10 GB-mês armazenados por ciclo**, compartilhados entre logs e traces. Excedente de **US$ 0,25/GB** ingerido e **US$ 0,10/GB-mês** armazenado.
  - Retenção default de 7 dias; opções de 30, 90 e 365 dias "coming soon".
  - Datasets de segurança não amostrados custam US$ 1/GB.
  - Queries, dashboards e alertas não são cobrados.
- **Traces:** instrumentação automática "in early beta". Cobre fetch, bindings (KV, R2, DO), RPC e handlers fetch, scheduled e queue. A página não cita Hyperdrive nem D1. Suporta spans customizados e retenção de 7 dias. **A partir de 2026-12-01, traces contam na cota de GB.** [fonte: https://developers.cloudflare.com/workers/observability/traces/, lido em 2026-10-09]
  - O blog diz que "Cloudflare Traces" (request-level) está em open beta. [fonte: https://blog.cloudflare.com/one-observability-platform/, lido em 2026-10-09]
- **Export OpenTelemetry:** destinos incluem Honeycomb, Grafana Cloud, Axiom, **Sentry**, Datadog, New Relic, SigNoz, PostHog (só logs) e outros. Exporta logs e traces. **Não suporta OTLP binário.** Status e preço não estão na página. O blog diz que destinos OTel ficam fora do preço de Logpush por GB. [fonte: https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/, lido em 2026-10-09]
- **Logpush:** agora em **planos self-serve**. Destinos Cloudflare têm 25 GB incluídos e depois US$ 0,03/GB; destinos externos têm 25 GB e depois US$ 0,10/GB; Transformers têm 1 GB e depois US$ 0,04/GB. [fonte: https://blog.cloudflare.com/one-observability-platform/, lido em 2026-10-09]
- **Analytics Engine:**
  - Paid: 10M data points/mês (depois US$ 0,25/M) e 1M queries de leitura (depois US$ 1,00/M).
  - Free: 100k/dia e 10k/dia.
  - **"You are not currently billed".**
  - [fonte: https://developers.cloudflare.com/analytics/analytics-engine/pricing/, lido em 2026-10-09]
- **Tail Workers:** **apenas nos planos Paid e Enterprise**, cobrados por CPU. Rodam por invocação, sem batch. A doc recomenda OTel export para Sentry e similares. [fonte: https://developers.cloudflare.com/workers/observability/logs/tail-workers/, lido em 2026-10-09]
- **Sentry `@sentry/cloudflare`** [fonte: https://docs.sentry.io/platforms/javascript/guides/cloudflare/, lido em 2026-10-09]:
  - Há um plugin Vite próprio (`sentryCloudflareVitePlugin` de `@sentry/cloudflare/vite`) que aplica `withSentry` no build.
  - **Hono via `@sentry/hono`.**
  - Requer `nodejs_compat` (AsyncLocalStorage).
  - Source maps via `upload_source_maps: true` e o wizard.
  - Release lida de `CF_VERSION_METADATA`.
  - Limitação conhecida: spans de trabalho CPU-bound aparecem com 0 ms.

---

## J. Segurança

- **Turnstile Free:** **grátis**, com desafios e verificações ilimitados, até 20 widgets e 10 hostnames por widget. Branding não removível, analytics de 7 dias, conformidade WCAG 2.2 AAA. [fonte: https://developers.cloudflare.com/turnstile/plans/, lido em 2026-10-09; atualizada em 2026-08-14]
- **Rate Limiting binding:**
  - Configurado com `ratelimits` e `simple { limit, period }`. **`period` aceita apenas 10 ou 60 segundos.**
  - **O limite é por localização Cloudflare**, "permissive, eventually consistent". Não deve ser usado como contabilidade exata. A chave deve ser um ID de usuário ou rota, não IP.
  - Exige Wrangler ≥ 4.36.0. A página não informa status nem preço.
  - [fonte: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/, lido em 2026-10-09]
  - **(inferência)** Serve como freio anti-abuso (login, reset, checkout). Limites críticos (tentativas de login por conta) precisam de contador no PG ou equivalente.
- **WAF:**
  - **Free:** apenas o "Cloudflare Free Managed Ruleset". O Managed Ruleset completo e o OWASP Core exigem Pro ou superior. [fonte: https://developers.cloudflare.com/waf/managed-rules/, lido em 2026-10-09]
  - **Custom rules:** Free 5, Pro 20, Business 100 (regex só a partir do Business). [fonte: https://developers.cloudflare.com/waf/custom-rules/, lido em 2026-10-09]
  - **Rate limiting rules:** Free tem **1 regra**, por IP, com período de 10 s e timeout de 10 s; Pro tem 2. [fonte: https://developers.cloudflare.com/waf/rate-limiting-rules/, lido em 2026-10-09]
- **Bot Fight Mode (Free):** desafia bots de cloud providers e headless. **"Applied to all traffic across a domain"**, sem escopo por path. [fonte: https://developers.cloudflare.com/bots/plans/free/, lido em 2026-10-09]
  - **(inferência) Risco:** os webhooks do Asaas vêm de infraestrutura de nuvem e podem ser desafiados. Não ativar sem teste, ou isolar os webhooks em outra zona.
- **Cloudflare Access / Zero Trust Free:**
  - O resultado de busca, citando a página oficial de planos, indica **Free até 50 usuários** e pay-as-you-go a US$ 7/usuário/mês. **A página oficial não renderizou no fetch. Considerar não confirmado diretamente.** [fonte: https://www.cloudflare.com/plans/zero-trust-services/, lido em 2026-10-09]
  - Limites de conta: 500 aplicações Access e 50 service tokens. [fonte: https://developers.cloudflare.com/cloudflare-one/account-limits/, lido em 2026-10-09]
  - Access pode proteger Version URLs e Previews. [fonte: https://developers.cloudflare.com/workers/configuration/previews/, lido em 2026-10-09]
- **Secrets Store:** **open beta**, com secrets em nível de conta compatíveis com Workers e AI Gateway. Preço e limites não informados. [fonte: https://developers.cloudflare.com/secrets-store/, lido em 2026-10-09; atualizada em 2026-08-14]
  - **(inferência)** Por estar em beta, manter `wrangler secret` por Worker e ambiente.
- **mTLS:**
  - O binding mTLS apresenta certificado de cliente no `fetch` de saída. Não funciona para destinos em zona proxied pela Cloudflare (retorna 520). [fonte: https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/, lido em 2026-10-09]
  - mTLS de entrada: 100 certificados de cliente por zona com a CA gerenciada. A disponibilidade no Free não está explícita. [fonte: https://developers.cloudflare.com/ssl/client-certificates/, lido em 2026-10-09]
  - Relevância baixa para o projeto.

---

## K. E-mail

- **Cloudflare Email Service:** reúne Email Sending (saída) e Email Routing (entrada).
  - **Email Sending está em beta e exige Workers Paid.** O envio é feito pelo binding `send_email` (`env.EMAIL.send()`), por REST `/email/sending/send`, por SDKs (Node, Python, Go) ou por SMTP. O foco é transacional. **Templates não são mencionados.** [fonte: https://developers.cloudflare.com/email-service/, lido em 2026-10-09; atualizada em 2026-10-08]
  - **Preço:** **3.000 e-mails/mês incluídos no Paid, depois US$ 0,35/1.000.** Envio no Free não está disponível (só para destinos verificados). Email Routing de entrada é ilimitado. [fonte: https://developers.cloudflare.com/email-service/platform/pricing/, lido em 2026-10-09]
  - **Limites:** 50 destinatários por e-mail, 5 MiB por mensagem e "conservative daily quota" para contas novas (sem número publicado). O envio só sai de domínios de roteamento. [fonte: https://developers.cloudflare.com/email-service/platform/limits/, lido em 2026-10-09]
- **Resend** [fonte: https://resend.com/pricing, lido em 2026-10-09]:
  - **Free:** 3.000 e-mails/mês, **100/dia**, 3 domínios.
  - **Pro:** **US$ 20/mês por 50.000** (ou US$ 35 por 100k), excedente de US$ 0,90/1k, sem limite diário.
  - **Marketing:** cobrado por contatos (Free até 1.000; Pro a partir de US$ 40 por 5.000).
  - Retenção de 30 dias; IP dedicado só a partir do Scale (US$ 30/mês).
  - **Templates:** envio por `template.id` + `variables`, com histórico de versões e exigência de template "published". A página não diz se é GA nem a qual plano pertence. [fonte: https://resend.com/docs/dashboard/templates/introduction, lido em 2026-10-09]
  - Região sa-east-1 não confirmada.
- **Avaliação (inferência):**
  - O Resend continua adequado como fonte editorial (Hosted Templates). **O Free (100/dia) é insuficiente em produção**, então é preciso prever o Pro (US$ 20/mês).
  - O Cloudflare Email Sending é mais barato e nativo, mas está em beta, sem templates e com cota diária opaca para contas novas. Fica como **fallback futuro**, não como substituto agora.

---

## L. Containers

- **Exige Workers Paid.** A página não diz se é beta ou GA.
- **Incluídos/mês:** 25 GiB-h de memória, 375 vCPU-min e 200 GB-h de disco.
- **Excedente:** US$ 0,0000025/GiB-s de memória, US$ 0,000020/vCPU-s e US$ 0,00000007/GB-s de disco.
- **Instâncias:** de `lite` (1/16 vCPU, 256 MiB) a `standard-4` (4 vCPU, 12 GiB).
- **Egress:** US$ 0,025/GB na América do Norte e Europa (1 TB incluído) e US$ 0,04/GB "everywhere else" (500 GB).
- Além disso, cobra Workers e Durable Objects subjacentes.
- [fonte: https://developers.cloudflare.com/containers/pricing/, lido em 2026-10-09; atualizada em 2026-10-05]
- **Avaliação:** não faz sentido aqui. O PDF sai pelo Browser Run, não há transcodificação de vídeo (mídia de vídeo fica nos providers) e o crop de imagem é feito no browser.

---

## M. Neon (agora "from Databricks", core "Lakebase Postgres")

- **Aquisição:** anunciada pela Databricks em **2025-05-14**. [fonte: https://www.databricks.com/company/newsroom/press-releases/databricks-agrees-acquire-neon-help-developers-deliver-ai-systems, lido em 2026-10-09]
  - Fechamento em ~junho de 2025, com a Lakebase lançada como derivada (fontes secundárias). [fonte: https://thenewstack.io/lakebase-is-databricks-fully-managed-postgres-database-for-the-ai-era/, via busca]
  - A página de preços da Neon se apresenta como "from Databricks", com o banco "Lakebase Postgres". A documentação mistura "Lakebase Postgres" e "Neon". [fonte: https://neon.com/pricing e https://neon.com/docs/guides/cloudflare-workers, lidos em 2026-10-09]
- **Planos** [fonte: https://neon.com/pricing e https://neon.com/docs/introduction/plans, lidos em 2026-10-09]:

  | | Free | Launch | Scale |
  |---|---|---|---|
  | Preço | US$ 0 | pay-as-you-go, **sem mínimo** | pay-as-you-go, sem mínimo |
  | Compute | 100 CU-h/projeto | **US$ 0,106/CU-h** | **US$ 0,222/CU-h** |
  | Storage | 1 GB/projeto (20 GB total) | **US$ 0,35/GB-mês** | US$ 0,35/GB-mês |
  | Projetos | 100 | 100 | 1.000 |
  | Branches/projeto | 10 | 10 (+US$ 1,50/branch-mês) | 25 |
  | Compute máximo | 2 CU (8 GB) | 16 CU | 16 CU autoscale ou 56 CU fixo |
  | Scale-to-zero | 5 min, fixo | 5 min, **pode desligar** | de 1 min a always-on |
  | Janela de restore (PITR) | 6 h (limite de 1 GB) | **até 7 dias** (default 1 dia) | até 30 dias |
  | Custo do histórico | — | US$ 0,20/GB-mês | US$ 0,20/GB-mês |
  | Snapshots | 1 manual | 100 manuais; agendados a US$ 0,09/GB-mês | idem |
  | Egress | 5 GB/projeto | 500 GB/projeto, depois US$ 0,10/GB | idem |
  | IP Allow, Private Networking, SLA, SOC 2/HIPAA | não | **não** | **sim** |
  | Protected branches | não | sim | sim |
  | Retenção de monitoramento | 1 dia | 3 dias | 14 dias |
  | Auth (MAU) | 60k | 1M | 1M |

  - Read replicas existem como computes separados que somam CU-h.
  - Logical replication: o tráfego conta como egress, mas a disponibilidade por plano não é declarada (não confirmado).
- **1 CU equivale a cerca de 4 GB de RAM.** `max_connections`: 0,25 CU → 104 (97 úteis); 0,5 CU → 209; 1 CU → 419. O PgBouncer da Neon aceita 10.000 clientes. [fonte: https://neon.com/docs/connect/connection-pooling, lido em 2026-10-09]
  - **Atenção:** duas configs Hyperdrive (cached e uncached) com ~100 conexões cada podem **exceder as 97 conexões de um compute de 0,25 CU**. É preciso reduzir o `max_size` do Hyperdrive ou dimensionar o compute.
- **Scale-to-zero:** reativação "within a few hundred milliseconds". Vale só para computes de até 16 CU. [fonte: https://neon.com/docs/introduction/scale-to-zero, lido em 2026-10-09]
  - **Não confirmado:** se conexões ociosas mantidas pelo pool do Hyperdrive (idle timeout de 10 min) impedem a suspensão.
- **Postgres 14, 15, 16, 17 e 18** são suportados. Minor **18.6** disponível na Neon desde 2026-08-18. A página não usa o rótulo "GA" ou "preview" para o 18. [fonte: https://neon.com/docs/postgresql/postgres-version-policy, lido em 2026-10-09]
- **Regiões:** a lista AWS inclui **`aws-sa-east-1` (São Paulo) disponível**. Regiões Azure estão deprecadas. **Object Storage, Functions e AI Gateway só existem em us-east-1, us-east-2, eu-central-1 e ap-southeast-1.** Lakebase Postgres está em todas as regiões AWS. Managed Better Auth roda na mesma região do banco. [fonte: https://neon.com/docs/introduction/regions, lido em 2026-10-09]
  - Aviso na mesma página: "Projects on the Free plan that have been inactive for 90 days or more are subject to deletion as of October 5, 2026". A frase está na seção Azure, então **o escopo não está confirmado**.
- **Neon Auth / Managed Better Auth:**
  - **O que é:** serviço gerenciado (REST) baseado em Better Auth, que armazena usuários e sessões no schema `neon_auth` do próprio banco. Cada branch tem auth isolado. Só AWS. **Não suporta projetos com IP Allow ou Private Networking.** **Não permite plugins, hooks ou opções customizadas.** Roda **Better Auth 1.7.6**. Está incluído em todos os planos pelo número de MAU. [fonte: https://neon.com/docs/auth/overview, lido em 2026-10-09]
  - **Status:** "Managed Better Auth is generally available", mas ainda "in active development".
  - **Suporta:** e-mail e senha, OAuth (Google, GitHub, Vercel), Email OTP, Admin, Organization (parcial), JWT, Magic Link, OpenAPI, Phone Number, webhooks e trusted domains.
  - **Coming soon:** MFA e arquiteturas frontend+backend separadas.
  - **Passkeys não aparecem.**
  - [fonte: https://neon.com/docs/auth/roadmap e https://neon.com/docs/auth/guides/plugins, lidos em 2026-10-09]
  - **Avaliação:** **não recomendável** para o projeto. Faltam passkeys, as regras de linking não podem ser customizadas (sem hooks), a política de sessão é própria do serviço e o RBAC por capability precisaria de integração. Também acopla auth ao Neon. Manter **Better Auth self-hosted no Worker**.
- **Outros produtos novos da Neon** (Functions, Object Storage, AI Gateway): irrelevantes para a stack e indisponíveis em sa-east-1.

---

## N. Alternativas de Postgres gerenciado (essencial)

| Provedor | Entrada | Brasil (sa-east-1) | Observações | Fonte |
|---|---|---|---|---|
| **PlanetScale Postgres** | **PS-5 single node a US$ 5/mês** (1/16 vCPU, 512 MiB); HA de 3 nós a partir de US$ 15 | Região `aws-sa-east-1` listada, mas **só com clusters "metal"** (sem PS-*; preço não exibido) | Pode ser criado e faturado via Cloudflare (Hyperdrive). Versões de PG não informadas. | https://planetscale.com/pricing e https://developers.cloudflare.com/hyperdrive/platform/pricing/, lidos em 2026-10-09 |
| **Supabase** | Free: 500 MB, 2 projetos, pausa após 1 semana inativo. **Pro a partir de US$ 25/mês** (inclui US$ 10 de crédito = Micro de 1 GB) | **sa-east-1 disponível** | PITR custa **US$ 100/mês por 7 dias**; backups diários de 7 dias no Pro | https://supabase.com/pricing e https://supabase.com/docs/guides/platform/regions, lidos em 2026-10-09 |
| **Prisma Postgres** | Free: 200k operações, 1 GB. Starter US$ 10 (1M ops, depois US$ 8/M); Pro US$ 49 | Não confirmado | Cobra por operação. Lista conexões "direct", mas TCP e Hyperdrive não estão confirmados. | https://www.prisma.io/pricing, lido em 2026-10-09 |
| **Xata** | micro (1 GB) a US$ 0,012/h (~US$ 9/mês) + US$ 0,28/GB-mês | Não confirmado | Branching e scale-to-zero (wake de ~1 s na cloud) | https://xata.io/pricing, lido em 2026-10-09 |
| **Crunchy Bridge** | Hobby-0 a US$ 9/mês; Standard-4 a US$ 70/mês; storage US$ 0,10/GB | Não confirmado | Aquisição pela Snowflake: conhecimento prévio, **não reconfirmado** hoje | https://www.crunchydata.com/pricing, lido em 2026-10-09 |
| **Neon (referência)** | Launch: ~US$ 19/mês always-on de 0,25 CU (cálculo abaixo) | **Sim** | Branching, PITR de 7 dias e scale-to-zero | ver M |

- **(inferência)** Para o Brasil, com PG gerenciado barato, branching e PITR, **Neon em sa-east-1 continua sendo a melhor relação**. A Supabase seria a alternativa com região BR, mas é mais cara para ter PITR. A PlanetScale só é barata nos EUA.

---

## O. Regiões e latência para usuários no Brasil

- **Fatos confirmados:**
  - Neon em `aws-sa-east-1`: sim (ver M).
  - D1 e R2: **sem** location hint para a América do Sul (ver D e E).
  - Placement só afeta handlers `fetch`; o default é rodar perto do usuário (ver A).
  - O pool do Hyperdrive fica em regiões próximas ao banco (ver B).
- **Não confirmado:** pool do Hyperdrive na América do Sul; latência medida entre PoPs Cloudflare no Brasil e a Neon sa-east-1; local de execução de Queue consumers e Cron; se o tráfego de zonas Free no Brasil é sempre servido por PoPs brasileiros.
- **Recomendações (inferência, a medir com benchmark real):**
  1. **Production na Neon `aws-sa-east-1`.** O usuário no Brasil chega ao Worker num PoP brasileiro, que fica perto do banco. Não é necessário placement hint, e as requests com várias queries ficam rápidas. Há também ganho de residência de dados para a LGPD.
  2. **Se o banco ficasse em us-east-1**, seria preciso usar `placement.region = "aws:us-east-1"` e aceitar uma ida e volta transcontinental por request, de cerca de 100–150 ms. É uma estimativa de conhecimento geral, **não medida**.
  3. **Jobs de Queue e Cron devem minimizar round-trips** (queries em lote, CTEs), porque podem rodar longe do banco.
  4. **R2:** o armazenamento fica fora do Brasil. A entrega pública é cacheada no edge. A transferência internacional de dados pessoais (avatares, PDFs de certificado) **precisa de base jurídica de transferência na LGPD**, a validar com jurídico.
  5. **Fazer um spike de latência no M0:** p50 e p95 de `SELECT 1` e de uma transação de 5 queries via Hyperdrive, a partir de São Paulo, com Neon sa-east-1 vs us-east-1, e com Queue consumer e Cron.

---

## Estimativa de custo mensal (centenas de alunos; inferência baseada nos preços acima)

| Item | Estimativa |
|---|---|
| Workers Paid: requests e CPU muito abaixo dos incluídos; Queues abaixo de 1M ops; Workflows abaixo de 500k steps; Browser Run abaixo de 10 h; Logs abaixo de 20M eventos ou 50 GB | **US$ 5** |
| R2: ~20 GB (10 GB grátis) | ~US$ 0,15 |
| Images Transformations Free (< 5.000 únicas/mês) | US$ 0 (fallback necessário se estourar) |
| Neon Launch, Production always-on de 0,25 CU (0,25 × 730 h × 0,106) | **~US$ 19,35** (0,5 CU: ~US$ 38,69) |
| Neon storage (2 GB) + histórico de 7 dias (~2 GB-mês) | ~US$ 0,70 + ~US$ 0,40 |
| Neon Staging com scale-to-zero (~20 CU-h) | ~US$ 2 |
| Neon Scale (se SLA ou IP Allow forem exigidos), Production always-on de 0,25 CU | ~US$ 40,50 |
| Resend Pro | US$ 20 |
| **Total típico** | **~US$ 45–70/mês** (sem Asaas e sem providers de vídeo) |

---

## Implicações para decisões

### Confirma
- **Workers Paid (US$ 5):** cobre com folga toda a carga de Workers, Queues, Workflows, Browser Run e Logs nessa escala. Static assets são grátis e ilimitados, e o SPA fallback é nativo.
- **SPA React 19 + Vite + Cloudflare Vite Plugin e `CLOUDFLARE_ENV` no build:** a documentação confirma que o env só é lido em dev e build, não no `wrangler deploy`.
- **PostgreSQL 18 no Neon via Hyperdrive + `pg`:** PG 18 é suportado pelos dois. A Neon e a Cloudflare recomendam Hyperdrive com driver nativo e string **direta (unpooled)**. Transações interativas e prepared statements de protocolo funcionam.
- **Migrations fora do Worker:** consistente com o Hyperdrive (sem advisory locks; migration tools costumam usá-los) e com a conexão direta da Neon para a role de migration.
- **Outbox + Queue + reconciler:** Queues é at-least-once, a DLQ apaga mensagens após 4 dias sem consumer e mensagens sem DLQ são apagadas. Isso **reforça que o PG precisa ser a fonte da verdade** e que o reconciler/sweep é obrigatório.
- **R2 canônico + presigned PUT + validação dos bytes no servidor:** presigned só assina Content-Type de forma documentada, não há POST policy e Content-Length/checksum não estão documentados. Logo, a **confirmação e validação pós-upload é indispensável**. Bucket locks atendem a retenção dos PDFs revogados.
- **Images Transformations Free com fallback estático:** confirmado. Acima de 5.000 únicas, novas transformações retornam erro 9422, sem cobrança.
- **PDF via Browser Run:** o nome está correto (renomeado em 2026-04-15). Há Quick Action com binding sem token e o custo fica dentro das 10 h incluídas.
- **Better Auth self-hosted:** o Neon Managed Better Auth não tem passkeys nem hooks e veta IP Allow.
- **Resend como fonte editorial:** o Cloudflare Email Sending está em beta e sem templates. Prever o Resend Pro (o Free tem limite de 100/dia).
- **Turnstile grátis.**

### Muda ou exige ajuste
1. **Cache do Hyperdrive:** **criar a config de produção com `--caching-disabled`** (ou dois bindings, sendo o uncached o default). Nunca usar config cacheada para auth, sessão, grants, Entitlement/Enrollment, financeiro ou admin. Isso deve ser escrito como decisão explícita (é default ON).
2. **Fencing e locks:** o **Hyperdrive não suporta advisory locks nem LISTEN/NOTIFY**. Projetar o fencing com lease e token em linha do PG (`FOR UPDATE SKIP LOCKED`, coluna `version` ou `lease_until`), sem `pg_advisory_lock`. Isso vale também para o runner de migrations (que roda por conexão direta, então tudo bem).
3. **Região do banco:** **Neon `aws-sa-east-1`** para Staging e Production, salvo se um benchmark do M0 mostrar o contrário. A decisão deve explicitar a região, que não aparecia no contexto.
4. **Dimensionamento de conexões:** somar o `max_size` de todas as configs Hyperdrive com as `max_connections` da Neon (97 úteis em 0,25 CU). Ajustar o `max_size` ou o tamanho mínimo do compute.
5. **Scale-to-zero em Production:** desligar no Launch (~US$ 19/mês) para evitar cold start de "algumas centenas de ms" em checkout e webhooks. Staging e Dev podem manter.
6. **Observabilidade:** a partir de 2026-12-01 a cobrança passa a ser por GB. Definir `head_sampling_rate`, desligar `invocation_logs` se forem redundantes e evitar logar payloads (também por privacidade). Sentry via `@sentry/cloudflare` + `@sentry/hono`, ou OTel export para Sentry.
7. **Config Workers:** omitir `nodejs_compat` com `compatibility_date >= 2026-08-04` (agora é default). Conferir a dependência do Better Auth e do Sentry em AsyncLocalStorage.
8. **Staging e Previews:** Workers Previews (≥ 4.135.0) dão ambientes por branch com bindings próprios, mas **Queues, Cron e rotas não funcionam em Preview**. **Manter Staging como Worker ou ambiente separado** para homologar o fluxo assíncrono e financeiro. Proteger Version URLs e Previews com Access (são públicos por padrão).
9. **Workers Builds:** se for usado, configurar o deploy da branch de produção como `wrangler versions upload` (sem promover). Isso respeita "Production manual, sem release automático a partir de push main".
10. **Webhooks Asaas:** **não ativar Bot Fight Mode** (aplica-se ao domínio inteiro) sem teste. Usar o slot único de WAF rate limiting do Free com cuidado e preferir o binding no Worker com chave por rota.
11. **Workflows:** opcional como executor de processos multi-etapas (emissão de certificado, reembolso), **mantendo o outbox e o reconciler** no PG. Não é substituto.
12. **LGPD e R2:** objetos ficam fora do Brasil (não há hint `sam`). Documentar a base de transferência internacional.

### Contradiz ou descarta
- **D1 como banco principal:** descartado. Não tem transações interativas documentadas, não tem região na América do Sul, tem teto de 10 GB e é single-writer.
- **Neon Managed Better Auth:** descartado. Não tem passkey nem hooks.
- **Containers:** sem uso no escopo.
- **Secrets Store:** em beta, não usar como dependência central.

### Riscos de custo e lock-in
- **Custo baixo e previsível hoje.** Os principais vetores de surpresa são:
  - Logs por GB após 2026-12-01.
  - Neon compute always-on e autoscaling sem teto. É preciso configurar CU máximo.
  - Resend acima de 3.000/mês.
  - Images acima de 5.000 únicas (no Free não cobra, mas quebra a transformação).
- **Lock-in Cloudflare:** baixo a médio. Hono, Drizzle e pg são portáveis. Queues, Workflows, Browser Run, R2 (compatível com S3) e Images exigem adapters, que já estão previstos.
  - O maior acoplamento seria adotar Workflows ou Durable Objects como fonte de estado. **Evitar isso e manter o PG como verdade.**
- **Lock-in e risco Neon:** o Postgres é padrão (`pg_dump` portátil). O risco é estratégico: a Neon está sob a Databricks, com foco em "Lakebase" e IA, e houve deprecação de regiões Azure e política de deleção de projetos Free inativos.
  - **Mitigação:** backups próprios com `pg_dump -Fc` + `age` (já decididos), migrations SQL puras e restauração ensaiada em outro provedor (Supabase sa-east-1 como alvo de DR possível).
- **Recursos em beta usados ou cogitados:** Smart Placement, Traces, Secrets Store, Email Sending, Images binding (status do Free não confirmado) e Rate Limiting binding (status não declarado). **Nenhum deve ser caminho crítico sem fallback.**
