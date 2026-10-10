# L1 — Legado NeuroCapacitar Hub: arquitetura, infraestrutura, operação, DX, qualidade, custos e observabilidade

- **Data da investigação:** 2026-10-09
- **Repositório:** `NeuroCapacitar/hub` (clone read-only em `scratchpad/legacy-hub`)
- **SHA analisado:** `main` = `ed88213831bf5a4b6e5b697bcefe752789917895`; `origin/staging` = `5c55e82eade41357ba0f1eb46f8e1e46d704a4ea` (2 commits à frente, só documentação de checkpoint — PR #264)
- **Escopo deste relatório (L1):** arquitetura, infraestrutura, operação, DX, qualidade, custos, observabilidade. Domínio de identidade/financeiro/comunicação e produto/marca estão nos relatórios L3/L4.

## Método, legenda e limites

Legenda usada em todo o documento:

- **[F]** fato verificado diretamente (arquivo:linha, `git`, `gh api`/`gh run`/`gh pr` read-only).
- **[D]** fato **documentado pelo próprio legado** (runbook/review), não verificado por mim no provedor externo.
- **[I]** inferência minha, com o raciocínio indicado.

Limites:

- Não acessei consoles Vercel, Neon, Sentry, Cloudflare, Asaas, Resend nem JMVStream. Afirmações sobre estado externo são [D].
- Não li valores de secrets. Listei somente **nomes** de variáveis/secrets. Uma tentativa de inspecionar o formato de senhas de fixtures de teste foi bloqueada pela política de segurança e não foi contornada; recomendo varredura Gitleaks no histórico (seção 12).
- `gh run list` foi limitado aos 1.500 runs mais recentes (de 2.594 no total), cobrindo 2026-08-22 → 2026-10-09.
- Contagens de testes por regex (`it(`/`test(`) são aproximações; quando existe número reportado por execução real (PR #257), uso esse.
- Classificação de PRs por tema é heurística sobre títulos [I].

---

## 0. Sumário executivo (achados mais decisivos)

1. **O produto é pequeno; a operação foi enorme.** [F] ~133,6 mil linhas TS de código + ~100,8 mil linhas de teste + ~6,0 MB de Markdown/CSV em 4 meses (2026-06-05 → 2026-10-06), um único autor humano e ~171 PRs de branches `codex/*`. [D] o backup cifrado de Production tinha ~205 KB (`docs/operations/production-backup-restore.md`), e Development tinha 8 Pedidos (`docs/operations/database-and-migrations.md`). A complexidade operacional não foi puxada por escala.
2. **O pipeline de release foi o componente mais frágil, mais do que a aplicação.** [F] `Deploy Vercel production`: 18 sucessos × 57 falhas desde 2026-08-22; `Prepare Production release`: 1 × 4. As falhas concentram-se em verificar o alias/SHA da Vercel, a cota de branches Neon e diagnósticos temporários, não em regressões de código (seção 5.6).
3. **Custo e limites de plataforma moldaram a arquitetura.** [F] Os crons passaram de 1 min/5 min (`36019cf0`) para 15 min (`99768e07`, 2026-08-31) e depois para 30 min (`9021ef78`, PR #257, "fix: reduce scheduled worker cost"). [D] Vercel Pro; Neon **Free** em Production (PITR de 6 h, 1 GB, limite de 10 branches, branch não protegida); Sentry Free; R2 Free.
4. **O assíncrono foi bem desenhado e deve ser reaproveitado como conceito.** [F] Outbox/inbox duráveis em PG, `FOR UPDATE SKIP LOCKED`, lease com fencing por `locked_by`, DLQ, chaves idempotentes e `scheduled_job_leases`. O problema era o transporte (cron HTTP de 30 min + drain `after()`), não o modelo.
5. **A documentação virou livro-razão operacional e teste.** [F] São 307 arquivos `.md`, 47 PRs de "record/checkpoint" e testes que fazem asserções sobre a prosa de docs e o YAML de workflows (`src/tooling/operational-documentation-contract.test.ts`, `release-workflows.test.ts` com 111 `toContain`). Mudar uma cadência de cron tocou ~34 arquivos (PR #257). Ainda assim, `README.md`/`release-state.md` em `main` e `plans/README.md` estão desatualizados.
6. **Arquitetura de código: módulos-deus e acoplamento cíclico.** [F] `admin/server.ts` (4.369 linhas), `courses/server.ts` (3.285), `admin/authoring.ts` (2.980) e `admin/actions.ts` (2.216, `"use server"`). As features importam umas às outras em ciclos. São ~577 chamadas `.query(` com SQL cru, enquanto o Drizzle serve quase só para schema/migrations. Há Zod em apenas 10 arquivos de runtime.
7. **Banco:** [F] 59 tabelas, 41 enums, 107 migrations em ~4 meses. Há drift manual reconciliado (`0020_reconcile_schema_after_manual_changes.sql`) e 10 funções + 9 triggers PL/pgSQL (append-only financeiro, revogação de sessão, perfil automático, e-mail canônico). Os guards de migration são excelentes.
8. **Observabilidade mínima e parcialmente "no papel".** [D] Sentry só em Production. Não há uptime nem cron monitor configurado externamente (`observability-and-recovery.md:93`). Os logs ficam no runtime da Vercel, com retenção curta. Não há métricas de pool nem SLO ratificado. O cron agendado do GitHub para backup atrasou de 3h34 a 5h08 (`2026-08-26-production-readiness-requalification.md:17`).
9. **Repositório PÚBLICO** [F] (`gh repo view`: `visibility: PUBLIC`). Estão expostos IDs de projeto/branch Neon, hostnames de endpoint, IDs de time/projeto/deployments Vercel e ~4.700 linhas de inventário da máquina pessoal (`C:\Users\Junior\...`) em CSVs de auditoria. O Environment `production-backup` guarda `BACKUP_DATABASE_URL`/`NEON_API_KEY`/`VERCEL_TOKEN` **sem branch policy** (API). Ser público também dava de graça Actions ilimitado, CodeQL, secret scanning e rulesets, recursos que um repo privado no GitHub Free perde ou limita.
10. **Não há registro explícito do "porquê" de sair da Vercel** [F: não encontrado]. A evidência indireta [I] aponta custo de execução de crons/funções, um pipeline de release acoplado à CLI/metadata da Vercel, a necessidade de borda Cloudflare (WAF) com DNS na Hostinger, R2 já na Cloudflare e dependências Node-only (sharp/pdfkit) difíceis de portar (seção 5.8).

---

## 1. Stack real e versões; como o Next.js é usado

### 1.1 Dependências e ferramentas (fonte: `package.json`)

| Item | Versão | Evidência |
|---|---|---|
| Next.js | 16.3.6 | `package.json:34` [F] |
| React / React DOM | 19.3.0 | `package.json:40` [F] |
| TypeScript | **6.0.3** (não 7) | `package.json:73` [F] |
| Better Auth | 1.7.6 (+ `@better-auth/infra` 0.4.12) | `package.json:26` [F] |
| Drizzle ORM / Kit | ^0.45.3 / ^0.31.11 | `package.json:30,66` [F] |
| `pg` (node-postgres) | 8.23.0 | `package.json:37` [F] |
| Zod | ^4.6.5 | `package.json:50` [F] |
| Sentry | `@sentry/nextjs` 10.68.0 | `package.json:16` [F] |
| sharp / pdfkit | 0.35.5 / 0.20.2 | `package.json:46,36` [F] |
| Resend + React Email | ^6.30 / ^1.0.12 (React Email mantido como rollback; `knip.jsonc:37`) | [F] |
| UI | Tailwind 4.3.3, `radix-ui` 1.6.7, Hugeicons, Tiptap 3.31.3, dnd-kit, TanStack Table, Embla, react-day-picker, react-easy-crop, sonner, next-themes; shadcn `radix-luma` com registries `@reui`/`@svgl` (`components.json`) | [F] |
| Lint/format | Biome 2.5.0 via **Ultracite 7.8.3** (`biome.jsonc` estende `ultracite/biome/core,react,next`) | [F] |
| Testes | Vitest 4.1.11, Playwright 1.63.0, axe-core 4.13, jsdom | [F] |
| Outros | Knip ^6.38, Lefthook ^2.1.14, Dependabot semanal agrupado → `staging` (`.github/dependabot.yml`) | [F] |
| Runtime/pacotes | `packageManager: bun@1.3.11`, `engines.node: 24.x` | `package.json:137,79` [F] |

`tsconfig.json` [F] usa `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns` e `target ES2017`, com o plugin `next`.

Dependências **Node-only** relevantes para a portabilidade a Workers [F]: `sharp` (8 arquivos de runtime, p.ex. `src/features/storage/course-cover-upload.ts`, `src/features/certificates/rendering.ts`), `pdfkit` (`src/features/certificates/pdf-document.ts`), `@aws-sdk/client-s3` (2), `node:crypto` (46 arquivos), `node:fs` (4). O `next.config.ts` precisou de `serverExternalPackages: ["pdfkit"]` e `outputFileTracingIncludes` para sharp e fontes de certificado.

### 1.2 Como o Next.js é usado [F]

- **App Router** com grupos `(admin)`, `(auth)`, `(student)`, mais `api/`, `certificados/`, `checkout/`, `comprar/`, `manutencao/` e `politica-de-privacidade/`. São 38 `page.tsx`, 3 `layout.tsx` e 46 `route.ts`.
- **Server Actions:** 11 módulos `"use server"` com 3.991 linhas no total. O maior é `src/features/admin/actions.ts` (2.216 linhas, 34 chamadas SQL diretas), seguido de `auth-media/actions.ts` (561) e `(student)/app/actions.ts` (279). Há 47 `formData.get(` em runtime.
- **RSC/SSR dinâmico:** são 163 arquivos `"use client"`, 53 ocorrências de `export const dynamic = "force-dynamic"` e 46 de `revalidatePath`. Não há `"use cache"`, `unstable_cache`, `revalidateTag`, ISR nem `cacheLife`: zero ocorrências. O Next foi usado como servidor dinâmico, sem aproveitar o cache.
- **Route Handlers:** Better Auth (`api/auth/[...all]`), checkout, webhooks (Asaas, Resend), uploads/URLs assinadas, 6 crons, 5 health checks (`health`, `ready`, `r2`, `resend`, `sentry`), PDFs/preview de certificado e uma rota de teste `api/e2e/email-deliveries` presente no bundle de produção, protegida por `isIsolatedE2eRuntime` (`src/lib/env.ts:114`).
- **Proxy (middleware do Next 16):** `src/proxy.ts` (48 linhas) propaga `x-correlation-id` e aplica o modo de manutenção fail-closed (`APPLICATION_MAINTENANCE_MODE=full` → 503/rewrite).
- **`after()`:** usado diretamente em `src/lib/auth-password-reset.ts:79` e via `scheduleAfterResponse` para drenar a outbox após a resposta (`src/features/outbox/background-drain.ts`, 5 mensagens/15 s).
- **Runtime/limites:** mais de 20 rotas com `runtime = "nodejs"` e crons com `maxDuration` de 300 s ou 800 s (`src/app/api/cron/*/route.ts`).
- **Instrumentação:** `src/instrumentation.ts` (Sentry server só em produção, `onRequestError`) e `instrumentation-client.ts`.
- **Config** (`next.config.ts`): CSP e headers globais (linhas ~47-80), `images.remotePatterns` (JMVStream CDN, R2), `redirects`, `deploymentId`, `reactCompiler: true`, `output: "standalone"` apenas fora da Vercel (resquício do alvo VPS/Coolify) e `withSentryConfig` só em produção.
- **`vercel.json`** [F]: `regions: ["gru1"]`, `installCommand: "bun install --frozen-lockfile --force"` (após o incidente de cache de 2026-10-03), `ignoreCommand` que só builda `main`/`staging`, `git.deploymentEnabled.staging=false` e 6 crons.
- **`AGENTS.md:95-105`** [F] contém um bloco auto-inserido pelo `next dev` ("This is NOT the Next.js you know..."): a versão do framework estava à frente do conhecimento dos agentes, o que exigia ler `node_modules/next/dist/docs`.

---

## 2. Estrutura de pastas, tamanhos e limites entre camadas

### 2.1 Volume por área [F] (arquivos `.ts/.tsx`; linhas sem testes / linhas de testes)

| Pasta | Arquivos | Testes | Linhas src | Linhas teste |
|---|---:|---:|---:|---:|
| `src/app` | 336 | 129 | 38.278 | 23.857 |
| `src/components` | 163 | 55 | 20.432 | 5.372 |
| `src/lib` | 94 | 44 | 4.668 | 6.177 |
| `src/db` | 56 | 36 | 5.067 | 3.517 |
| `src/tooling` (ops/release tooling) | 49 | 30 | 4.410 | 5.145 |
| `scripts` | 53 | 5 | 6.593 | 352 |
| `tests/e2e` | 8 | — | 2.784 | — |
| **`src` total** | **1.217** | **551** | **133.584** | **100.790** |

Features [F]:

| Feature | Arquivos | Linhas src | Linhas teste |
|---|---:|---:|---:|
| admin | 82 | 15.051 | 9.565 |
| payments | 73 | 10.187 | 12.876 |
| courses | 56 | 6.890 | 6.607 |
| certificates | 58 | 4.942 | 5.504 |
| storage | 60 | 4.559 | 3.513 |
| outbox | 17 | 3.038 | 3.924 |
| account | 28 | 3.015 | 2.475 |
| jmvstream | 27 | 2.772 | 1.476 |
| enrollments | 16 | 2.309 | 3.172 |
| email / email-delivery | 9 / 16 | 1.571 / 1.170 | 1.894 / 1.026 |
| auth-media, learning-analytics, comments, operations, banners, maintenance, progress, videos, support | 2–16 cada | 93–1.303 | — |

Total versionado: 1.858 arquivos [F].

### 2.2 Módulos-deus e hotspots [F]

Maiores arquivos de runtime: `src/features/admin/server.ts` 4.369; `src/features/courses/server.ts` 3.285; `src/features/admin/authoring.ts` 2.980; `src/db/schema.ts` 2.500; `src/features/admin/actions.ts` 2.216; `src/app/(admin)/admin/(dashboard)/page.tsx` 1.811; `src/components/lesson-kind-controls.tsx` 1.563; `src/app/(student)/app/aulas/[lessonId]/page.tsx` 1.493; `src/features/payments/asaas-webhook-processor.ts` 1.486; `src/features/certificates/server.ts` 1.473; `src/features/outbox/delivery.ts` 1.372.

Arquivos mais alterados (commits) [F]: `admin/actions.ts` (91), `db/schema.ts` (80), journal de migrations (74), `admin/server.ts` (73), páginas de cursos admin (69/68), `courses/server.ts` (66), página de aula (64) e `src/tooling/release-workflows.test.ts` (48). O teste de contrato dos workflows mudou quase tanto quanto o núcleo de domínio.

O legado já reconhecia o problema [D]: `plans/README.md:33` ("módulos centrais grandes concentram consultas, regras, efeitos e apresentação") e `docs/architecture.md:244-250` (plano 008, "tamanho como sinal").

### 2.3 Limites entre camadas: o declarado e o real

Declarado [D] (`docs/architecture.md:34-61`): apresentação em `src/app`/`src/components`; aplicação/domínio em `src/features/<cap>`; `src/lib` transversal; persistência em `src/db` "e SQL explícito nas features"; sem repositório genérico.

Real [F]:

- **SQL cru como padrão:** ~577 chamadas `.query(` em runtime (ex.: `admin/authoring.ts` 36, `admin/actions.ts` 34, `certificates/templates.ts` 27, `enrollments/server.ts` 26), contra ~126 templates `sql\`` e uso praticamente nulo do query builder Drizzle. O Drizzle (`src/db/index.ts`) serve ao schema, às migrations e ao adapter Better Auth (`getDb` só em `src/lib/auth.ts`, `src/lib/session.ts` e na rota dev de bootstrap). As transações usam o helper manual `withPostgresTransaction` (`src/db/transaction.ts:4-29`).
- **Server Actions acessam o banco diretamente**, sem caso de uso intermediário (`admin/actions.ts`).
- **Grafo de dependência entre features com ciclos:** admin↔courses, courses↔certificates, certificates→admin, enrollments↔courses, outbox↔payments, outbox↔account, storage↔courses/certificates/auth-media. `maintenance` importa 8 features. `admin` funciona como "hub" porque `admin/audit-log` (o escritor comum de auditoria) é importado por 9 arquivos de outras features.
- **Apresentação dentro de features:** 14 `.tsx` não-teste em `src/features` (ex.: `admin/enrollment-expiration-controls.tsx` importa `@/components/ui/*`). Há 11 arquivos de features importando `@/components`/`@/app`, e até tipos de componente entram no servidor (`admin/support-server.ts` importa `StudentSheetPayload` de `@/components/admin/...`).
- **Rotas importando `@/db` diretamente:** 9 arquivos em `src/app` (ex.: `api/courses/[courseId]/cover/[variant]/route.ts`).
- **Validação de entrada:** Zod aparece em apenas 10 arquivos de runtime (ex.: `src/lib/env.ts:27`, `account/public-signup-input.ts`, `certificates/command-input.ts`). Até 2026-09-12 parte do authoring dependia de `required`/`min`/hidden inputs do navegador (`docs/reviews/2026-09-12-master-plan-with-implementation-report.md:2232-2258`, "PR 06"). A correção foi um parser manual (`authoring-input.ts`), "sem adicionar Zod".
- **Fronteira server/client** apenas por convenção e `import "server-only"` (92 arquivos). Não havia dependency-cruiser nem regra automatizada de camadas.

[I] Para a vNext isso confirma a necessidade de casos de uso explícitos, DTO/Zod na borda e fiscalização automatizada de limites (já prevista no `AGENTS.md` da vNext).

---

## 3. Banco de dados

### 3.1 Configuração [F]

- `drizzle.config.ts`: um único schema `./src/db/schema.ts`, `out: ./src/db/migrations`, conexão `DATABASE_URL_DIRECT ?? DATABASE_URL` normalizada para `sslmode=verify-full` (`src/db/connection-url.ts`).
- Pool (`src/db/pool-policy.ts:9-37`): `max 10` local; **`max 3` por instância na Vercel**; pool de readiness `max 1`. O próprio legado aponta que isso não limita a soma entre instâncias (`docs/reviews/2026-10-03-rate-limits-project-audit.md:150`).
- `src/db/index.ts` registra listener de `error` no `pg.Pool` para não virar `uncaughtException` (`observability-and-recovery.md`, seção de correlação).

### 3.2 Schema [F]

59 tabelas (`pgTable`), 41 `pgEnum`, 0 views. Agrupamento:

- **Identidade/Better Auth:** users, two_factors (legado inativo), sessions, accounts, verifications, profiles, pending_signups, account_email_challenges, account_email_challenge_rate_limits, staff_invitations, account_email_change_requests, account_password_reset_operations, better_auth_rate_limits.
- **Catálogo/conteúdo:** courses, course_sale_interests, course_publications, modules, lessons, jmvstream_folders, jmvstream_video_assets, staged_lesson_resource_uploads.
- **Acesso/progresso:** enrollments, enrollment_grants, enrollment_expiration_adjustments, enrollment_events, lesson_progress, lesson_watch_progress, course_completions, lesson_comments.
- **Comércio:** orders, purchase_confirmation_intents, webhook_events, payment_reviews, refund_requests, asaas_financial_transactions, asaas_installment_payments, financial_events, asaas_statement_import_cursors, public_checkout_rate_limits.
- **Certificados:** certificates, certificate_revocation_tombstones, certificate_issuer_profiles, certificate_templates, certificate_template_asset_cleanup, public_certificate_rate_limits.
- **Operação/e-mail:** outbox_messages, email_messages, resend_webhook_events, scheduled_job_leases, audit_logs, support_requests.
- **Editorial/analytics:** app_settings, dashboard_banners, faq_items, auth_media_slides, staged_admin_image_uploads, learning_analytics_preferences, learning_analytics_events, learning_analytics_daily_metrics.

### 3.3 Migrations [F]

- **107 migrations** (`0000_fast_firelord.sql` → `0106_better_auth_rate_limits.sql`), journal com 107 entradas e snapshots `0000`–`0106`, criadas entre 2026-06 e 2026-10 (~1 migration a cada 1,1 dia).
- Nomenclatura mista: nomes aleatórios Drizzle (`0074_boring_nitro`, `0065_gray_siren`) e descritivos (`0102_account_password_reset_operation_guard`).
- 182 KB de SQL. Maiores: `0074_boring_nitro.sql` 25 KB (trilha financeira), `0020_reconcile_schema_after_manual_changes.sql` 15 KB e `0000` 14 KB.
- **Drift manual comprovado:** o cabeçalho de `0020_reconcile_schema_after_manual_changes.sql:1-2` diz "Reconciles branches whose Drizzle journal stopped at 0019 but received later schema changes manually". A auditoria de 2026-07-20 já registrava que "a linha de migrations não reproduz o schema atual" (`plans/README.md:21`).
- **PL/pgSQL:** 10 funções e 9 triggers, concentrados em 4 migrations:
  - `0041_public_signup_student_profiles.sql:8`: `create_student_profile_for_user()` + trigger `users_create_student_profile`;
  - `0065_gray_siren.sql:15,29`: `revoke_sessions_after_profile_role_change()`, `revoke_sessions_after_two_factor_change()`;
  - `0074_boring_nitro.sql:220-671`: `record_financial_{order,webhook,statement,refund,review}_event()` + `prevent_financial_event_mutation()` (append-only via trigger `financial_events_append_only`);
  - `0097_identity_email_challenges.sql:3`: `canonicalize_auth_email_identity(text)`.
  - O GitHub classifica 59.037 bytes como PLpgSQL (`gh api repos/NeuroCapacitar/hub/languages`) [F]. [I] Esse número é a heurística de linguagem do GitHub sobre parte dos `.sql`, não o volume real de lógica procedural, que está nos ~10 objetos acima.
- **Regras de execução** [D, implementação em `scripts/migrate-*.ts`, `src/db/migration-*.ts`] (`docs/operations/database-and-migrations.md:56-90`):
  - endpoint direto obrigatório (recusa `-pooler`);
  - advisory lock de sessão;
  - **uma transação por arquivo**, necessária por causa de `ALTER TYPE ... ADD VALUE` usado em migration posterior;
  - validação de hash do journal em Staging/Production/E2E;
  - allowlist de compatibilidade de ledger só em Development;
  - guards por host + project ID + branch ID aprovados (`src/db/neon-database-target.ts`, `staging-target.ts`);
  - `db:migrations:check` (cadeia local) e `db:migrations:inspect` (catálogo remoto read-only).
- **Readiness checa o journal:** `/api/health/ready` exige a migration mínima declarada em `src/db/migration-state.ts` (`observability-and-recovery.md:263-268`).
- **Política:** forward-only, compatível com o código anterior durante a janela migration→promoção (`database-and-migrations.md:325-348`).
- **Inconsistência:** o script `"db:push": "drizzle-kit push"` continua em `package.json:111`, embora o runbook diga "não use `db:push`" [F].

### 3.4 Ambientes Neon [D]

- **Production:** projeto `damp-snow-…`, branch `br-dark-boat-…`, `aws-sa-east-1`.
- **Development e Staging:** migrados em 2026-10-04 para um projeto não-produtivo separado (`shy-bar-…`), branches filhas de `nonprod-base`, cutover ainda "em andamento" (`database-and-migrations.md:32-46`, PR #251).
- **CI:** usa PostgreSQL 18 local no runner. Antes de 2026-08-31 a CI criava branches Neon efêmeras e precisava de um workflow "janitor" (`cleanup-ci-neon-branches.yml`, removido em `99768e07`; 115 execuções registradas).
- **Neon Free** em Production (`production-backup-restore.md:32,52`; `database-and-migrations.md:447-452`):
  - PITR de no máximo 6 h e 1 GB de histórico;
  - branch `production` sem proteção ("proteção de branch exige plano pago");
  - limite de 10 branches por projeto, que bloqueou releases e exigiu limpeza manual de backups de release (`2026-08-29-repository-health-audit.md:44`; 7 falhas no passo "Create Staging Neon backup without compute", seção 5.6).

### 3.5 Backups e restore [D salvo indicação]

- Workflow `backup-production-database.yml` [F]: cron `17 */6 * * *`, Environment `production-backup`. Faz `pg_dump` PostgreSQL 18 com cifragem `age` 1.3.1 e envia ao bucket R2 dedicado (`neurocapacitar-production-backups`), com Bucket Lock/lifecycle nas classes `frequent`/`daily`/`weekly`, manifestos e checker de frescor de 6h30 (`scripts/check-production-backup.ts`).
- O restore em alvo descartável foi ensaiado: RTO medido de 105 s, 46 tabelas e 537 constraints (`production-backup-restore.md`, estado 2026-08-27).
- O release com migration exige backup fresco e cria uma branch Neon de recuperação sem compute, com expiração de 14 dias (`deploy-vercel.yml:389-431`).
- **Histórico de execução** [F]: 149 sucessos / 63 falhas desde 2026-08-22 (42 falhas só em 2026-08-26, durante o setup; depois falhas esporádicas em 09-16, 09-27, 09-29). Mediana de 1,1 min.
- **Dor:** problemas de TLS/libpq no runner (CA ausente), corpo `Readable` não reexecutável no PUT ao R2 (precisou virar `Buffer`), versão `18.6 (3484359)` do Neon rejeitada pelo parser (PRs #111-#120, #162-#169) e **atraso do agendador do GitHub de 3h34–5h08** numa cadência de 6 h (`2026-08-26-production-readiness-requalification.md:17,147`).

---

## 4. Processamento assíncrono

### 4.1 Outbox transacional [F código + D runbook]

- Contrato: `src/features/outbox/rules.ts`; persistência `server.ts`; runner `runner.ts`; entrega Resend `delivery.ts` (1.372 linhas). Runbook em `docs/operations/outbox-and-transactional-effects.md`.
- **Claim** atômico `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT $2)` com `attempts+1`, `locked_at` e `locked_by` (`src/features/outbox/server.ts:55-80`). Lease de 10 min; lease abandonado volta a ser elegível.
- **Fencing:** toda transição terminal confere `status='processing'` e `locked_by`. Perder o lease gera `lease_lost` e encerra o lote sem contabilizar (`outbox-and-transactional-effects.md:174-205`).
- Até **5 tentativas**, backoff exponencial de 1 min com jitter de até 12,5%. Payload de versão desconhecida vai para `dead_letter`. Existe o estado terminal `superseded`, separado de falha.
- **Idempotência:** chave por tópico/agregado/versão (ex.: `certificate.render/<id>/v1`); `idempotencyKey` repassada ao Resend, que só deduplica por 24 h. O runbook admite explicitamente "ao menos uma vez" após essa janela.
- **Catálogo de tópicos:** `certificate.render`, `email.certificate-issued`, `email.access-expiry-warning` (v2, com gerações `current/changed/inactive/expired/wrong_window`), `auth.email-verification`, `auth.staff-invitation`, `auth.email-change-confirmation`, `email.purchase-confirmed`, `email.support-request` e tópicos v1 históricos bloqueados para reprocessamento.
- **Payload sem PII** (somente IDs). O token HMAC é derivado no momento da entrega e vai no fragmento da URL.
- **Drain após a resposta** (`background-drain.ts:5-6`): 5 mensagens / 15 s via `after()`. O cron é a recuperação.
- **DLQ operada por humano:** `retryOutbox` (somente Admin, exige motivo, grava `outbox.requeued` em `audit_logs` na mesma transação) e "Encerrar sem reprocessar" (`superseded`).
- **Retenção:** delivered/superseded 30 dias; dead_letter e auditorias 180 dias. Roda na manutenção diária desde o PR #257.

### 4.2 Inboxes e workers [F]

- `webhook_events` (Asaas) e `resend_webhook_events` (Resend). Persistência antes do `200`, claim com `SKIP LOCKED` (`payments/asaas-webhook-inbox.ts:112`, `asaas-webhook-worker.ts:105,155`, `email-delivery/worker.ts:52`). O payload bruto Asaas é sanitizado após 30 dias.
- Outros claims `SKIP LOCKED`: `maintenance/server.ts:226` e `certificates/template-asset-cleanup.ts:157`.
- **Exclusão mútua de jobs:** `scheduled_job_leases` (`src/features/operations/scheduled-job-lease.ts`), sem depender de sessão PG.
- **Config central** (`src/config/scheduled-jobs.ts:1-38`): `deadlineMs` 270 s com lease de 6 min para os jobs de 30 min; 12 min com lease de 15 min para os diários.
- **Guards:** `CRON_SECRET` (Bearer), kill switch `SCHEDULED_JOBS_ENABLED` e kill switches por provider (`ASAAS_WEBHOOK_ENABLED`, `PAYMENTS_CHECKOUT_MODE`).
- **Reconciliação Asaas** (`payments/reconciliation.ts`, 1.256 linhas) usa a mesma matriz financeira do webhook (`docs/architecture.md:126-142`). A coordenação de quota Asaas (25.000 req/12 h, 50 GETs concorrentes) é **em memória por processo** (`2026-10-03-rate-limits-project-audit.md:130-134`).

### 4.3 Agendamento: evolução e dor [F]

| Data/commit | asaas-webhooks | outbox / jmvstream / resend | diários |
|---|---|---|---|
| `36019cf0` (2026-08-25) | `* * * * *` (1 min) | `*/5` | enrollments 10:00 UTC, maintenance 04:00 UTC |
| `99768e07` (2026-08-31) | `*/15` | `*/15` | idem |
| `9021ef78` (2026-10-06, PR #257 "reduzir custo de execução dos workers") | `15,45` (30 min) | `15,45` | idem |

- Corpo do PR #257 [F]: "Reduz Asaas, JMVStream, outbox e Resend de quatro para duas execuções por hora… piloto monitorável". Também moveu a retenção da outbox para a manutenção diária e eliminou uma chamada duplicada de expiração JMV. O diff tocou ~34 arquivos, incluindo 10 docs e vários testes que fixam a cadência em prosa.
- **Staging não tem cron:** a execução é manual por `Run Staging jobs` (antes havia agendamento no GitHub Actions; 256 execuções registradas).
- **Vercel Cron não repete invocações falhas** e admite perda ou duplicação; a idempotência ficava toda no Hub (`rate-limits-project-audit.md:162-166`).
- **[I] Consequências:** a recuperação de webhook/e-mail podia atrasar até ~30 min; o custo/invocação de cron era uma preocupação recorrente; não havia fila real (cada "fila" era uma tabela + cron HTTP + lease). A vNext (Queues + DLQ + outbox/inbox PG + sweeps) mira exatamente esse ponto.

---

## 5. CI/CD, release e saída da Vercel

### 5.1 Workflows em `main` [F]

| Workflow | Gatilho | O que faz | Environment |
|---|---|---|---|
| `ci.yml` (CI) | PR → `main`/`staging`, manual | **Job único** com 15 gates (abaixo) | — |
| `deploy-staging.yml` ("Prepare Vercel staging") | push `staging`, manual (`migration-only`, `seed-only`, `migrate-and-deploy`, `verify`) | Valida SHA, migra/inspeciona Neon de Staging, faz build/deploy por Vercel CLI no Custom Environment `staging`, grava `githubCommitSha` no metadata e roda smoke | `vercel-staging` |
| `deploy-vercel.yml` ("Deploy Vercel production", 548 linhas) | manual (`release-staging`/`hotfix`) | Verifica alias Staging=SHA, ancestralidade, CI verde no SHA exato, avança `main` por push, aguarda build Production sem domínio, exige backup fresco, cria branch Neon, migra, audita journal, faz smoke do deployment não promovido, promove, faz smoke público e confere metadata | `vercel-staging` + `vercel-production` |
| `prepare-production-release.yml` | manual | Detecta divergência `main`→`staging` e abre PR `sync/production-into-staging-*` | `vercel-staging` |
| `backup-production-database.yml` | cron 6 h, manual | pg_dump + age → R2 | `production-backup` |
| `cleanup-neon-release-backups.yml` | manual (dry-run/execute) | Limpa branches Neon de release | por ambiente |
| `cleanup-production-test-data.yml` | manual (plan/execute + frase de confirmação) | Apaga dados de teste em Production após branch de backup | `vercel-production` |
| `reset-staging.yml` | manual | Reset guardado do Staging com backup | `vercel-staging` |
| `migrate-development.yml` | manual | Migra Neon Development (exige CI verde em `main`) | `neon-development` |
| `run-staging-jobs.yml` | manual | Chama os workers de Staging; verifica lifecycle Resend | `vercel-staging` |
| `verify-production-sentry.yml` | manual (frase `EMIT_SENTRY_PRODUCTION_READINESS`) | Emite evento controlado e verifica release/source maps/alerta | `vercel-production` |

Também [F]: CodeQL (default setup, 37 execuções) e Dependabot (51 execuções). Workflows removidos ou só em branches: `cleanup-ci-neon-branches.yml` (removido em `99768e07`), `verify-staging-resend-lifecycle.yml` (removido em `09d4ef8f`), `Diagnose Production R2`/`Diagnose Production Asaas` (3 falhas cada, criados em branches de diagnóstico).

**Gates da CI** (`ci.yml:48-153`, `docs/operations/testing-and-ci.md`) [F], na ordem:

1. checkout completo;
2. `bun install --frozen-lockfile`;
3. `docs:check`;
4. `db:migrations:check`;
5. `typecheck`;
6. `ultracite check`;
7. `vitest`;
8. `bun audit --production`;
9. criação de 2 bancos no service container `postgres:18-alpine`;
10. migrations no banco de integração;
11. integração PG;
12. migrations no banco E2E;
13. Playwright (Chromium desktop + mobile);
14. relatório/artefato do Playwright;
15. `next build` com env sintética + Knip.

O gate "Enforce the pull request flow" (`ci.yml:48-62`) falha em PR para `main` que não seja `hotfix/*` com label `hotfix`. Duração [F]: mediana de 9,6 min, p90 de 11,7 min (runs com sucesso); meta documentada de p50 < 8 min (`testing-and-ci.md:104-110`).

### 5.2 Fluxo de branches [F/D]

- `feature/*|fix/*|chore/*` → `staging` → `main` → Production (`docs/operations/release-flow.md:12-50`). Depois de um release, `main` e `staging` apontam para o mesmo SHA (fast-forward feito pelo próprio workflow, `deploy-vercel.yml:332-338`, `git push origin "${CANDIDATE_SHA}:refs/heads/main"`).
- **Hotfix:** `hotfix/*` → `main` (sem migration). Antes do próximo release, roda `Prepare Production release`, que cria o PR `sync/production-into-staging-<run>-<attempt>[-conflict]` (`release-flow.md:52-79`).
- **Rulesets** [F via `gh api`]:
  - `protect-release-branches` (`main`, `staging`): impede deleção e non-fast-forward e exige o check `CI`, com `strict=false`.
  - `protect-staging-pull-requests`: exige PR em `staging`, com 0 aprovações.
  - Sem bypass actors.
- **Environments** [F via `gh api`]: `vercel-production` e `vercel-staging` têm custom branch policy. `production-backup`, `neon-development`, `Production`, `staging` e `vercel-preview` **não têm branch policy**. Nenhum ambiente exige revisores.
- **Secrets por ambiente (nomes)** [F]:
  - `vercel-production`: `DATABASE_URL_DIRECT`, `HEALTHCHECK_SECRET`, `RESTORE_R2_*`, `SENTRY_READINESS_*`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_TOKEN`;
  - `production-backup`: `BACKUP_DATABASE_URL`, `BACKUP_R2_*`, `NEON_API_KEY`, `VERCEL_TOKEN`.
  - [I] A credencial de migração de Production vive em um workflow comum do GitHub, exatamente o que o `AGENTS.md` da vNext proíbe ("Segredos de deploy/migration Production fora de workflows comuns do GitHub").

### 5.3 Estatísticas de execução (2026-08-22 → 2026-10-09; 1.500 runs) [F]

| Workflow | Sucesso | Falha | Outros |
|---|---:|---:|---|
| CI | 322 | 102 | 30 cancelados, 2 startup_failure |
| Prepare Vercel staging | 135 | 45 | 4 skipped, 3 cancelados |
| **Deploy Vercel production** | **18** | **57** | — |
| Prepare Production release | 1 | 4 | — |
| Backup Production database | 149 | 63 | — |
| Verify Sentry Production readiness | 3 | 12 | — |
| Run Staging jobs | 256 | 17 | 1 startup_failure |
| Cleanup Neon release backups | 59 | 2 | — |
| Migrate Neon development | 1 | 2 | — |

- Últimas 3 semanas: CI com 36 sucessos e 27 falhas.
- **Passo que falhou** nas 30 falhas de CI mais recentes [F]: static+unit 15; Playwright 8; integração PG 3; build 2; Knip 1; regra de PR 1.
- **Passo que falhou** nas 45 falhas de deploy mais recentes [F]:
  - "Verify exact Staging deployment" 10 e "Confirm Staging deployment and smoke" 5 (resolver alias/SHA na Vercel);
  - "Create Staging Neon backup without compute" 7 (cota de branches Neon);
  - "Temporary Production R2 environment diagnostic", "R2 bucket correction" e "Asaas URL correction": 6 no total (diagnósticos temporários embutidos no workflow);
  - promoção/push/aguardar build: 6;
  - backup ausente: 2;
  - o restante, falhas isoladas.
  - Vários runs partiram de branches de debug (`debug/vercel-token-transport`, `codex/debug-production-r2-env`, `codex/fix-production-asaas-url*`).
- Total histórico: 2.594 runs de Actions (`gh api …/actions/runs`).

### 5.4 Incidentes e eventos operacionais [D, com PR/commit F]

- **2026-07-25 a 07-27:** migração "Vercel-first" saindo de VPS/Coolify (`docs/superpowers/specs/2026-07-25-vercel-first-migration-design.md`; `docs/operations/vercel-migration-status.md:9`). [D] Vercel Pro confirmada pela proprietária (`vercel-migration-status.md:36`).
- **2026-07-31:** gateway AbacatePay → Asaas (PR #19, `docs/Plano de migracao.md`, 98 KB).
- **2026-08-23:** auditoria de readiness `NO-GO` com 2 P1 (Support atravessando fronteira de autorização; recuperação dependente da janela curta do Neon) (`docs/reviews/2026-08-23-production-readiness-audit.md:16-36`).
- **2026-08-25/26:** "janela emergencial" com inputs `emergency_skip_backup`/`emergency_skip_ci` no workflow de Production. "Production está no ar e o checkout real já registrou uma venda" ainda sob `NO-GO` (`2026-08-26-production-readiness-requalification.md:13-24`). Os bypasses foram removidos no PR #141 (`docs/superpowers/plans/2026-08-29-production-no-emergency-bypass.md`).
- **2026-08-30:** durante o release protegido foi preciso corrigir variáveis de Production na Vercel (`ASAAS_API_BASE_URL` e nomes dos buckets R2), alinhar temporariamente credenciais `RESTORE_R2_*` e liberar cota Neon apagando 4 backups de release (`2026-08-29-repository-health-audit.md:37-53`).
- **2026-08-31:** simplificação de CI e release (`99768e07`, −3.992/+1.522 linhas em 59 arquivos): CI passou de multi-job com branches Neon para job único com PG local.
- **2026-10-03:** build Production reaproveitou cache de dependências, carregou `@noble/hashes` 2.x no PDFKit e falhou com `ERR_PACKAGE_PATH_NOT_EXPORTED` (`docs/operations/deploy-and-incidents.md:29-33`; PR #249 → `installCommand … --force`).
- **2026-10-06:** sequência de 5 PRs (#258-#262) para fazer o gate de release reconhecer o SHA do deployment de Staging no metadata da Vercel e a identidade Git do merge de reconciliação, seguida do PR #264 (hotfix) só para registrar o checkpoint em docs.

### 5.5 Fluxo de documentação de release [F]

- `docs/operations/release-state.md` em `main` diz que Production serve `10c9cb8` (checkpoint de 2026-09-03), e `README.md:101-104` também. Houve, porém, releases de Production bem-sucedidos em 09-04, 09-05, 09-06, 09-08, 09-11, 09-12, 09-17, 10-01, 10-03 e 10-06 (runs F).
- A atualização só existe em `staging` (PR #264, 2 commits à frente de `main`). [I] Registrar o estado do release em arquivo versionado cria um ciclo: documentar o release exige outro PR, que só chega a `main` no release seguinte.
- `plans/README.md:328-342` marca os planos 001-012 como `TODO`, embora CI, outbox, observabilidade e outros estejam implementados [F]: o índice ficou obsoleto.

### 5.6 Padrões de dor no release (síntese) [I sobre evidência F]

1. Duas branches persistentes + hotfix + PR de sincronização exigiram vários PRs duplicados (mesma correção para `main` e para `staging`: #126/#127, #128/#129, #130/#131, #162/#164/#165/#166, #167/#169).
2. A prova de identidade do deploy dependia de parsear JSON da Vercel CLI (`vercel@57.0.0 inspect/list`, `deploy-vercel.yml:72-117,172-198`), algo frágil a mudanças de metadata (PRs #258-#260).
3. Toda a segurança estava no YAML (gates de branch/SHA). A proteção externa (environment policy) existia só para 2 dos 7 ambientes.
4. A configuração do ambiente (variáveis Vercel) não era versionada nem validada antes do release. Erros só apareciam no smoke de Production (Asaas URL, buckets R2).
5. Os limites de plano (Neon Free: 10 branches) transformaram backup de release em falha de release.

### 5.7 Alinhamento com a vNext (para referência)

O `AGENTS.md` da vNext já incorpora várias lições:

- deploy manual de Production com verificação independente;
- segredos de migration/Production fora dos workflows comuns;
- não confiar em branch protection no GitHub Free privado;
- sem `push main` → release;
- `CLOUDFLARE_ENV` antes do build.

### 5.8 Por que sair da Vercel — evidência

- **[F] Não existe** no legado documento de decisão de saída da Vercel. `docs/Plano de migracao.md` trata da troca de gateway de pagamento, não de plataforma. `docs/architecture.md:13` admite: "O racional histórico para a escolha de Next.js, React, Postgres/Neon e Vercel não foi localizado."
- Evidências indiretas:
  - **Custo de execução:** PR #17 (2026-07-28, "ci: reduce redundant Vercel build usage", desliga preview em push de `main`; `elasticConcurrencyEnabled=false`) e PR #257 (2026-10-06, "reduzir custo de execução dos workers") [F].
  - **Limites de Function/cron:** `maxDuration` de 800 s depende de Fluid Compute/plano; o cron mais frequente que diário exclui o Hobby (`rate-limits-project-audit.md:162-166`) [D].
  - **Borda/WAF:** a pesquisa de 2026-10-03 escolhe Cloudflare WAF como borda, condicionada a mover o DNS (hoje Hostinger, `docs/integrations/resend.md:59`) e fechar o bypass `*.vercel.app` (`rate-limits-project-audit.md:94,120-128,179-185`). Também propõe migrar rotas progressivamente para Workers + Hyperdrive, "a migração do Next.js 16 deve seguir … vinext (beta) ou OpenNext" (`:194`) [D].
  - **R2 já é Cloudflare** e os backups também [F/D].
  - **Release acoplado à Vercel CLI/metadata**, com 57 falhas (seção 5.3) [F].
- [I] A combinação "custo de invocações + necessidade de borda Cloudflare + pipeline frágil acoplado à Vercel + R2 já na Cloudflare" explica a decisão. O planejamento da vNext (`docs/planning/01-auditoria-de-consistencia.md:21`) registra a troca para "React SPA + Vite + Hono num Worker, sem SSR/RSC/Server Actions". **Não há** no legado medição de fatura da Vercel; o argumento de custo é qualitativo.

---

## 6. Observabilidade

### 6.1 Sentry [F código; D estado externo]

- **Production-only por código:** `src/instrumentation.ts:16-26` e `instrumentation-client.ts:308-318` só chamam `init` se `runtimeEnvironment === "production"`. Staging, Preview, E2E e dev não têm Sentry (decisão de 2026-09-11, `advisor-plans/sentry-production-only-observability-2026-09-11.md`, motivada por ruído e quota Free).
- `onRequestError` adiciona a tag `correlation_id`. Os hooks `beforeSend*` removem query strings e códigos públicos de certificado; PII implícita foi desativada (PRs #128/#129, #191).
- Spans e Application Metrics de baixa cardinalidade (`hub.operation.count`, `hub.operation.duration`) via `observeOperation` (`src/lib/observe-operation.ts`).
- **Cron monitor só no código:** `withMonitor("hub-outbox-production", …)` em `src/app/api/cron/outbox/route.ts:33-47`. Os outros 5 crons não têm monitor.
- **Estado externo** [D] (`docs/operations/observability-and-recovery.md`):
  - dois projetos Sentry com sobreposição (`hub-web` e `hub-production`; `:70-91`);
  - três Issue Alerts, dois redundantes;
  - "**Não há cron monitor, uptime monitor, alerta de métrica ou dashboard customizado configurado**" (`:93`);
  - plano gratuito (`:60`).
- Upload de source maps no build Production (`next.config.ts`, `sourcemaps.deleteSourcemapsAfterUpload`). Workflow `verify-production-sentry.yml` com 3 sucessos e 12 falhas [F].

### 6.2 Logs, health e backlog [F/D]

- `logOperationalEvent` (`src/lib/observability.ts`) emite JSON com `correlationId`, `operation`, `outcome`, `durationMs`, `errorCode` e `provider`, com sanitizador de chaves sensíveis.
- **Destino:** logs de runtime da Vercel, sem log drain. A auditoria de 2026-10-03 relata que "a agregação geral de status expirou" ao consultar 7 dias (`rate-limits-project-audit.md:84`) [D].
- `GET /api/health` (liveness) e `GET /api/health/ready` (Bearer `HEALTHCHECK_SECRET`, timeout 1 s, transação read-only, journal mínimo), além de `/health/r2`, `/health/resend` e `/health/sentry` usados nos smokes de release.
- **Admin > Operação:** snapshot de backlog sem PII com limiares nomeados (`outbox_pending_stale` 15/60 min, `webhook_ready_stale` 15 min, `webhook_retry_stale` 6 h, `webhook_failed_stale` 24 h, `webhook_payload_retention_risk` 25 dias) (`observability-and-recovery.md:270-289`). **Não dispara alerta**: depende de alguém abrir a página.
- **SLO:** nenhum ratificado. Propõe 30 dias de baseline (`:291-305`).
- **Lacunas reconhecidas:**
  - sem métricas de pool (`totalCount`/`idleCount`/`waitingCount`) nem de conexões Neon (`rate-limits-project-audit.md:148-152`);
  - sem uptime externo;
  - atraso do agendador do GitHub no backup;
  - Staging sem nenhuma telemetria de erro.

---

## 7. Segurança e limites

### 7.1 Headers/CSP [F]

- `next.config.ts` (headers globais): CSP, `Permissions-Policy` (camera/geolocation/microphone off), `Referrer-Policy strict-origin-when-cross-origin`, HSTS 1 ano com `includeSubDomains` (só produção), `X-Content-Type-Options nosniff` e `X-Frame-Options DENY`. A rota de PDF de certificado relaxa para `SAMEORIGIN`.
- CSP (`src/lib/content-security-policy.ts:15-30`): `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` fora de produção), `style-src 'unsafe-inline'`, `img-src 'self' blob: data: https:` (amplo), `frame-src 'self' https://player.jmvstream.com` e `frame-ancestors 'none'`. [I] Sem nonce: o App Router com scripts inline forçou `'unsafe-inline'`. Uma SPA Vite na vNext permite CSP sem `unsafe-inline` para scripts.

### 7.2 Rate limiting implementado [F/D]

- **Contadores PostgreSQL atômicos com chave HMAC** (sem IP bruto), em tabelas próprias: `better_auth_rate_limits` (0106), `public_certificate_rate_limits` (20/min/IP), `public_checkout_rate_limits` (5/10 min por IP+curso, com `Retry-After`) e `account_email_challenge_rate_limits` (3/identidade e 10/IP por hora). Suporte: 3/10 min por usuário com advisory lock (`rate-limits-project-audit.md:98-110`).
- **Better Auth usava storage em memória por processo** até a migration 0106 (P1 na auditoria, `:114-118`). Pelo checkpoint em `staging` (PR #264), 0106 chegou a Production no release de 2026-10-06 [D].
- **Sem WAF/borda:** o DNS está na Hostinger e a Cloudflare só no R2. A recomendação é Cloudflare WAF Rate Limiting após mover o DNS e fechar o bypass da origem (`:179-185`) [D].
- **JSON público:** limite de 4 KiB e timeout de 15 s (`src/lib/request-body-limits.ts`) [D/F].
- **Sem limite de frequência** em comentários, progresso de vídeo e interesse em curso (P2, decisão de produto pendente, `:136-142`).
- **Plano 004** (`plans/004-security-and-public-boundaries.md`, 2026-07-20): partia de rate limit em `Map` local, `X-Forwarded-For` ingênuo, `error.message` exposto e sem CSP. Tudo isso foi corrigido depois.
- **2FA/MFA:** planejado para Admin/Suporte e depois **removido por decisão de produto em 2026-09-01** (`docs/decisions.md:219`). A tabela `two_factors` ficou como legado inativo, e o teste `src/lib/mfa-removal-contract.test.ts` garante a ausência.
- **Code Scanning** encontrou 2 `js/xss-through-dom` nos iframes JMVStream e 1 `js/double-escaping`, corrigidos no PR #146 (`2026-08-29-repository-health-audit.md:59-75`).
- `docs/operations/security-audit-environment.md` [D] descreve o ambiente isolado de auditoria (limites de CPU/memória, FS read-only). É processo, não controle de runtime.

---

## 8. Testes

### 8.1 Volume [F]

- **Unit/componente (Vitest):** 551 arquivos `*.test.ts(x)` em `src` (+5 em `scripts`), ~2.900 chamadas `it(`/`test(` por regex. O PR #257 reporta execução real de **541 arquivos / 3.868 testes**. Evolução [D]: 310 testes em 2026-07-20 (`plans/README.md`), 1.981 em 2026-08-23 (audit) e 3.868 em 2026-10-06.
- **Integração com PostgreSQL 18 real:** 15 arquivos `*.integration.test.ts` (financeiro, webhook worker Asaas, outbox, expiração, free enrollment, content release, emissão concorrente de certificado, continuidade de publicação/discussão, staff role, support, cleanup de produção). Rodam em série (`vitest.integration.config.ts`, `fileParallelism: false`, timeout 120 s) no service container da CI.
- **E2E Playwright:** 44 testes em 3 specs (`tests/e2e/critical-journeys.spec.ts` com 1.541 linhas, `accessibility.spec.ts` com axe, `keyboard-accessibility.spec.ts`). Projetos `chromium-desktop` e `chromium-mobile` (Pixel 7, tag `@mobile`); `workers: 1`, `fullyParallel: false`, `retries: 1` na CI. Três webServers: **Asaas falso** (`scripts/e2e-asaas.ts`), **object storage S3 local** (`scripts/e2e-object-storage.ts`) e Next (`playwright.config.ts:200-226`). Seed E2E com 925 linhas (`scripts/seed-e2e.ts`).
- **Razão teste/código:** 100,8 mil linhas de teste para 133,6 mil de fonte. Não há threshold de cobertura configurado (`vitest.config.ts`).

### 8.2 Qualidade dos testes [F/I]

- **Testes sobre texto:** ~80 arquivos de teste leem arquivos com `readFileSync`. ~28 leem fonte de página/rota/componente (padrão `*-source.test.ts`, ex.: `src/components/auth-shell-source.test.ts`), 6 leem YAML de workflows (`src/tooling/release-workflows.test.ts` com 111 `toContain`) e 4+ leem docs, como `src/tooling/operational-documentation-contract.test.ts`, que testa frases de `README.md`, `release-state.md`, reviews e runbooks. [I] Isso protege contra regressões de configuração, mas encarece qualquer refatoração e transforma prosa em contrato executável. A primeira falha registrada em 2026-07-20 já era um teste procurando "texto literal que foi movido" (`plans/README.md`, baseline).
- **Pontos fortes:** integração de concorrência em PG real (emissão de certificado, rate limit concorrente com 12 consumos / limite 3 [D]), E2E de jornadas críticas com pagamento simulado, testes de acessibilidade (axe + teclado) e matriz de eventos financeiros (ver L3).
- **Instabilidade:** 43% das execuções de CI falharam nas últimas 3 semanas (27/63). Metade das falhas foi em static/unit e ~27% no E2E (seção 5.3).

---

## 9. Readiness e auditorias: achados, dívidas e riscos abertos

### 9.1 Linha do tempo de vereditos [F arquivos; D conteúdo]

| Data | Documento | Veredito |
|---|---|---|
| 2026-07-20 | `plans/README.md` (auditoria integral) | Roadmap com 10 problemas: migrations não reproduzem o schema, corrida na emissão de certificado, sem CI/E2E/integração, rate limit local, sem 2FA, sem telemetria/readiness/restore, módulos grandes |
| 2026-08-23 | `docs/reviews/2026-08-23-production-readiness-audit.md` | **NO-GO** (0 P0, 2 P1, 5 P2, 3 P3) |
| 2026-08-25 | `…-2026-08-23-production-readiness-requalification.md` | NO-GO mantido |
| 2026-08-26 | `…-2026-08-26-production-readiness-requalification.md` | NO-GO para nova promoção; Production no ar com venda real |
| 2026-08-29 | `2026-08-29-repository-health-audit.md` | **AMARELO**; 10 achados (CORRECTNESS-01/02, DX-01, ARCH-01, SECURITY-01/02/03, TEST-01, DOCS-01, DEPENDENCY-01) |
| 2026-09-01 | `…-2026-09-01-production-readiness-requalification.md` | GO não emitido só por testes locais |
| 2026-09-03 | `2026-09-03-readiness-remediation-requalification.md:12` | **GO** para novas features e promoções |
| 2026-09-12 | `2026-09-12-master-plan-with-implementation-report.md` (120 KB) | 12 PRs de remediação, com status anotado |
| 2026-10-03 | `2026-10-03-rate-limits-project-audit.md` + `…-cloudflare-rate-limit-research.md` | Proposta; Cloudflare como borda |

### 9.2 Achados principais e estado

- **Autorização de Support** atravessando banners/analytics (P1, 08-23): remediado com permissões granulares (PR #231, ADR 0017) [D].
- **Recuperação de banco** (P1): backup independente R2 + restore ensaiado (RTO 105 s) [D]. **Abertos:**
  - PITR Neon Free de 6 h;
  - branch `production` não protegida;
  - atraso do agendador do GitHub;
  - "não comprova PITR em ponto histórico… nem entrega de alerta" (`observability-and-recovery.md:398`).
- **Master plan 09-12:**
  - uma única verdade de progresso;
  - separar conclusão de progressão;
  - tracking de vídeo e regra de 100% (fronteira linear validada);
  - carga horária draft/publicado;
  - integridade Course→Publication→Module→Lesson;
  - validação server-side de input administrativo;
  - corrida de slug (`23505`);
  - preview admin de material privado;
  - cobertura de teclado;
  - envelhecimento de `release-state.md`;
  - garantia de CI no SHA promovido.
  - A maioria foi marcada "COMPLETO", com escopos parciais declarados (ex.: validação só no authoring) [D].
- **Riscos e dívidas abertos no último estado:**
  - DMARC em `p=none` em observação [D];
  - MFA administrativo fora do produto [D];
  - sem uptime/cron monitor/alertas de métrica [D];
  - sem SLO [D];
  - Better Auth Sentinel não confirmado em Production [D];
  - coordenação de quota Asaas por processo [D];
  - anti-spam de comentários e política de frequência do player pendentes [D];
  - Cloudflare WAF não aplicado e DNS na Hostinger [D];
  - Staging compartilha buckets R2 de Development, plano JMVStream de Production e estrutura Resend, com "isolamento incompleto" (`environment-and-local-development.md:46-50`) [D];
  - cutover de Neon não-produtivo incompleto [D];
  - docs de estado desatualizados em `main` [F];
  - `db:push` ainda exposto [F];
  - módulos-deus (plano 008 não executado) [F];
  - Dependabot com 5 PRs abertos, incluindo majors (Vitest 5, Sentry 11) [F].

---

## 10. Instruções de agentes e tooling de IA

### 10.1 Inventário [F]

- `AGENTS.md` (262 linhas):
  - ritual "AI-Driven Development ON - Date…" na primeira mensagem (`:3-7`);
  - princípios anti-bajulação/evidência;
  - higiene de repositório;
  - leitura obrigatória de `docs/README.md`;
  - **tentativa obrigatória de CodeRabbit** para mudanças de código/workflow/migration (`:90`);
  - bloco Next.js auto-inserido;
  - seções extensas de estilo TS/React (duplicando o linter);
  - **Graphify como etapa obrigatória de mapeamento** (`:253-262`).
- Contexto de produto: `CONTEXT.md` 208, `PRODUCT.md` 184 e `DESIGN.md` 768 linhas. Índice em `docs/README.md` (16 KB). Frontmatter `status/owner/last_verified_commit` validado por `bun run docs:check` (`scripts/check-docs.ts`, 643 linhas; "53 documentos canônicos" segundo o PR #257).
- `.agents/skills/external-deliberation/`: skill própria em TS com testes e Vitest. `.agents/skills/find-skills/`.
- `.claude/skills/neon`, `.claude/skills/neon-postgres`.
- `.codex/hooks.json`: hook `PostToolUse` que chama `node ".agents/skills/impeccable/scripts/hook.mjs"`. Esse caminho é **ignorado pelo Git** (`.gitignore`: `/.agents/skills/*` exceto `external-deliberation`), portanto o hook quebra em clones limpos [F].
- `.codex/skills/graphify/` (vendorizado, com LICENSE/NOTICE). `graphify-out/` é ignorado.
- `skills-lock.json`: **62 skills** de terceiros (emilkowalski, mattpocock, coderabbitai, better-auth, vercel, neon, cloudflare, shadcn, superpowers etc.).
- `.impeccable/critique/*` (7 críticas de UI), `.mcp.json` (servidor MCP `reui`), `components.json` com registries externos.
- Planejamento gerado por IA versionado:
  - `advisor-plans/` (48 arquivos);
  - `design-plans/` (15);
  - `research/` (25);
  - `docs/superpowers/plans|specs/` (77);
  - `docs/reviews/` (44, contando CSVs/JSON/PS1);
  - `plans/` (17).
- **Autoria dos PRs:** 171 de 230 PRs humanos vêm de branches `codex/*` [F]. PRs gigantes:
  - #33/#32: +101 mil linhas, 400 arquivos;
  - #243: +90,7 mil;
  - #19: +87 mil;
  - #237 "consolidate recent Hub updates": 393 arquivos.
  - Também há desalinhamento entre o nome da branch e o conteúdo: #241 `codex/graphify-adoption` entregou Google sign-in; #250 `codex/graphify-usage-policy` entregou rate limits.

### 10.2 O que virou sobrecarga [F/D]

- **CodeRabbit:** pelo menos 11 corpos de PR registram skip ou indisponibilidade ("revisões desativadas para a base staging", "conta não tem seat atribuído", "autenticação ausente" — PRs #251, #249, #257). O ritual era exigido pelo `AGENTS.md` e pelo template de PR mas raramente rodava.
- **Graphify:** a atualização foi recusada por falta de chave LLM ("67 documentos precisam de extração semântica", `rate-limits-project-audit.md:90`). Era obrigatório para tarefas de arquitetura e dependia de artefato local não versionado (8.461 nós).
- **Auditoria de instruções (2026-09-06/08):** foram commitados no repo público `docs/reviews/2026-09-06-instructions-inventory.csv` (1.560 linhas), `…-audit-coverage.csv` (1.560), `2026-09-08-instruction-state.csv` (1.583), `…-remediation-changes.csv`, `…-personal-skills-audit.md` (86 KB), `…-other-plugin-skills-audit.md` (56 KB) e `remediate-instructions.ps1` (72 KB). Quase todas as linhas contêm caminhos `C:\Users\Junior\...` de skills pessoais e de outros projetos ("Araute", "Hub Imports"). É sobrecarga e vazamento de ambiente pessoal.
- **Docs como contrato executável:** os testes de prosa e de YAML (seção 8.2) faziam cada mudança operacional tocar código, testes e 5-10 docs. PR #257: ~34 arquivos para mudar 4 linhas de `vercel.json`.
- **Volume de docs:** ~6,0 MB de `.md/.csv/.ps1` contra ~7,8 MB de `.ts/.tsx` (incluindo testes). São 307 arquivos `.md` com 86 mil linhas e 47 PRs de "record/checkpoint/docs".

### 10.3 O que funcionou [I sobre evidência]

- Regras de evidência ("não declarar deploy sem prova", separar implemented/verified/deployed) e de proteção de `main`/`staging`. A vNext herdou isso.
- Planos com passos verificáveis e "STOP conditions" (master plan) produziram remediações rastreáveis.
- Runbooks com guards de alvo (host/project/branch) e frases de confirmação evitaram operações destrutivas no ambiente errado.
- Workflows destrutivos com modo `plan`/`dry-run` obrigatório.

---

## 11. Variáveis de ambiente e serviços externos (somente nomes)

Fonte: `.env.example` (~110 nomes) [F]. Os valores de exemplo são placeholders e identificadores públicos (Sentry org/projeto), sem segredos.

| Serviço | Variáveis |
|---|---|
| Neon/Postgres | `DATABASE_URL`, `DATABASE_URL_DIRECT`, `STAGING_DATABASE_HOST`, `STAGING_NEON_PROJECT_ID`, `STAGING_NEON_BRANCH_ID`, `DEVELOPMENT_DATABASE_HOST`, `DEVELOPMENT_NEON_PROJECT_ID`, `DEVELOPMENT_NEON_BRANCH_ID`, `PRODUCTION_DATABASE_HOST`, `PRODUCTION_NEON_PROJECT_ID`, `PRODUCTION_NEON_BRANCH_ID`, `NEON_API_KEY`, `PROTECTED_DATABASE_HOSTS`, `PGSSLROOTCERT`, `E2E_DATABASE_URL`, `SMOKE_DATABASE_URL`, `CERTIFICATE_CONCURRENCY_DATABASE_URL`, `LOCAL_DATABASE_NAMES` |
| Confirmações/operadores | `STAGING_OPERATION_CONFIRMATION`, `DEVELOPMENT_OPERATION_CONFIRMATION`, `SHARED_DEVELOPMENT_SEED_CONFIRMATION`, `RESTORE_CONFIRMATION`, `EXPIRY_WARNING_V1_CONFIRMATION`, `STAGING_ADMIN_EMAIL/PASSWORD`, `DEVELOPMENT_ADMIN_EMAIL/PASSWORD`, `DEVELOPMENT_STUDENT_EMAIL/PASSWORD` |
| Better Auth / Google | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `AUTH_PUBLIC_SIGNUP_ENABLED`, `BETTER_AUTH_API_KEY`, `BETTER_AUTH_API_URL`, `BETTER_AUTH_KV_URL` (Better Auth Infra/Sentinel), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `INTERNAL_BOOTSTRAP_SECRET` |
| App/Vercel | `NEXT_PUBLIC_APP_URL`, `NEXT_ALLOWED_DEV_ORIGINS`, `APPLICATION_MAINTENANCE_MODE`, `VERCEL_ENV`, `VERCEL_TARGET_ENV`, `NEXT_PUBLIC_VERCEL_TARGET_ENV`, `VERCEL_BRANCH_URL`, `VERCEL_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `CLIENT_IP_SOURCE`, `CERTIFICATE_PUBLIC_BASE_URL`, `SUPPORT_EMAIL` |
| Jobs/health | `CRON_SECRET`, `SCHEDULED_JOBS_ENABLED`, `HEALTHCHECK_SECRET`, `RECOVERY_DRILL_*` (6) |
| Resend | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_READINESS_SECRET`, `RESEND_FROM_EMAIL`, `DEVELOPMENT_EMAIL_RECIPIENT_ALLOWLIST`, `STAGING_EMAIL_RECIPIENT_ALLOWLIST`, `STAGING_RESEND_USES_PRODUCTION` |
| Asaas | `ASAAS_API_KEY`, `ASAAS_API_BASE_URL`, `ASAAS_USER_AGENT`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_WEBHOOK_ENABLED`, `PAYMENTS_CHECKOUT_MODE` |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_RELEASE`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_PROJECT_ID`, `SENTRY_AUTH_TOKEN`, `SENTRY_READINESS_SECRET`, `SENTRY_READINESS_AUTH_TOKEN`, `SENTRY_READINESS_ALERT_NAME` |
| JMVStream | `JMVSTREAM_API_BASE_URL`, `JMVSTREAM_API_TOKEN`, `JMVSTREAM_PLAN_ID`, `JMVSTREAM_AUTH_RESOURCE`, `DEVELOPMENT_JMVSTREAM_PLAN_ID`, `DEVELOPMENT_JMVSTREAM_USES_PRODUCTION`, `STAGING_JMVSTREAM_USES_PRODUCTION` |
| Cloudflare R2 (app) | `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`, `R2_OBJECT_PREFIX`, `STAGING_R2_USES_DEVELOPMENT`, `E2E_R2_BUCKET_NAME` |
| Backup/restore | `BACKUP_DATABASE_URL`, `BACKUP_CADENCE_HOURS`, `BACKUP_R2_ACCOUNT_ID`, `BACKUP_R2_BUCKET_NAME`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENT`, `RESTORE_R2_ACCESS_KEY_ID`, `RESTORE_R2_SECRET_ACCESS_KEY`, `RESTORE_MANIFEST_KEY`, `RESTORE_AGE_IDENTITY_FILE`, `RESTORE_DATABASE_URL` |
| E2E | `E2E_TEST_MODE` (+ overrides em `playwright.config.ts:126-164`) |

Serviços externos [F/D]:

- **Infra:** Vercel (Pro), Neon (Free; 2 projetos + CI histórico), Cloudflare R2 (buckets privado/público de app + bucket de backup), Hostinger (DNS).
- **Produto:** Asaas (sandbox no Staging), Resend (com webhooks e Hosted Templates), JMVStream (vídeo/upload multipart), Google OAuth, Better Auth Infra (opcional).
- **Engenharia:** Sentry (Free), GitHub (Actions/CodeQL/Dependabot/secret scanning), CodeRabbit (opcional, raramente disponível), age, e o MCP reui.
- [I] São **mais de 14 serviços e ~110 variáveis** para um produto single-tenant com centenas de alunos previstos. As flags `*_USES_PRODUCTION` e `*_USES_DEVELOPMENT` mostram o compartilhamento de recursos entre ambientes como exceção permanente.

---

## 12. GitHub: issues, PRs e riscos do repositório público

### 12.1 Issues e PRs [F]

- **0 issues.** Todos os itens de `/issues` da API são PRs. O backlog vivia em Markdown (`plans/`, `advisor-plans/`, `docs/reviews/`).
- **264 PRs:** 218 merged, 41 fechados sem merge, 5 abertos (todos Dependabot: vitest 5.0.3, dotenv 18, @sentry/core 11.2, grupos dev/prod). Autores: `juniordinizm` 230, `app/dependabot` 34. Bases: `staging` 150, `main` 114. Prefixos de branch: `codex/` 171, `fix/` 21, `staging` 20 (promoções), `dependabot/` 34.
- **Tamanho:** mediana de 4 arquivos por PR; p90 de 67; vários com mais de 100 mil linhas (seção 10.1).
- **Temas** (heurística por título, [I]): ~138 dos 230 PRs humanos são de CI/release/staging/backup/Neon/Sentry/migration, 47 são "docs/record/checkpoint" e ~30 são claramente de produto/feature.
- **Padrões recorrentes:**
  1. correções duplicadas para `main` e `staging`;
  2. ciclos de "fix → record evidence → reconcile";
  3. ajustes do gate de release por mudanças da Vercel;
  4. Sentry readiness/PII (PRs #126-#133);
  5. backup/restore (PRs #111-#120, #162-#169);
  6. uploads R2 grandes/replayable (PRs #158-#161, #170-#173).

### 12.2 Repositório público: verificado e riscos [F]

`gh repo view NeuroCapacitar/hub` retorna `visibility: PUBLIC`, `isPrivate: false`, 2 stars e 0 forks. [D] O repositório migrou de `juniordinizm/hub` para `NeuroCapacitar/hub`.

Riscos observados:

1. **Topologia de infraestrutura exposta:**
   - IDs de projeto/branch Neon em 10+ docs (57 ocorrências de `br-…` em `docs/`) e no código-guard `src/db/neon-database-target.ts`;
   - hostnames de endpoint Neon (`ep-…`) em docs e testes;
   - time e projeto Vercel (`team_…`, `prj_…`, `vercel-migration-status.md:36-44`);
   - 24 IDs de deployment (`dpl_…`);
   - nomes de buckets R2 (`neuro-prod-private/public`, `neurocapacitar-production-backups`);
   - domínios e e-mails operacionais.
   - [I] Nada disso é credencial, mas reduz o custo de reconhecimento para um atacante.
2. **Strings de conexão em fixtures de teste** com formato `postgresql://user:<senha>@ep-….neon.tech` (13 ocorrências, ex.: `src/db/e2e-database-guard.test.ts:8-12`, `src/lib/run-development-script.test.ts:32-33`), algumas com hostnames que parecem reais. **Não inspecionei as senhas** (bloqueado pela política). **Recomendação:** rodar Gitleaks/trufflehog em todo o histórico antes de qualquer reaproveitamento e rotacionar credenciais se algo real for encontrado. [D] Secret scanning + push protection estão ativos desde o PR #143.
3. **Ambiente pessoal vazado:** CSVs de auditoria de instruções com ~4.700 linhas de caminhos `C:\Users\Junior\...` (seção 10.2) e o e-mail pessoal do mantenedor em `docs/superpowers/plans/2026-08-19-resend-neurocapacitar-brand-refresh.md:116`.
4. **Environments sem branch policy contendo segredos de Production** (`production-backup`: `BACKUP_DATABASE_URL`, `NEON_API_KEY`, `VERCEL_TOKEN`). A proteção depende só do `if:` no YAML, e o próprio runbook reconhece que "o gate no YAML não substitui a proteção externa" (`release-flow.md:40-45`). PRs de fork não recebem secrets [D], mas qualquer colaborador com write poderia disparar a partir de outra branch.
5. **Superfície de engenharia social:** runbooks detalhados de operação de Production (sequência de release, frases de confirmação, endpoints de health/smoke).

O que o público **dava de graça** e a vNext privada no GitHub Free perde ou limita [I, com base em conhecimento geral de planos GitHub; confirmar na doc vigente]:

- minutos ilimitados de Actions. Medi ~890 min de wall time nos últimos 30 dias e ~4.400 min em 48 dias desde 08-22; o plano privado Free tem cota mensal limitada;
- CodeQL default setup;
- secret scanning/push protection;
- rulesets e branch policy de environments efetivos.
- O `AGENTS.md` da vNext já registra que GitHub Free + privado não garante esses controles.

---

## 13. Ritmo, volume e churn

- **Commits** [F]: 982 em `main` (977 do mesmo autor sob duas grafias, 4 do Dependabot e 1 do github-actions), de 2026-06-05 (`70f9ec4d` "Initial commit from Create Next App") a 2026-10-06. Por mês (todos / sem merge): jun 251/250; jul 104/102; ago 322/250; set 262/221; out (até dia 6) 43/25. Zero reverts.
- **Tipos convencionais** (sem merge): feat 354, fix 204, docs 99, test 70, chore 28, ci 23, refactor 10, ops 5. São 44 `fix|ci|chore` com escopo `ci/deploy/release/ops/sentry/restore/backup/staging/actions`.
- **Churn por pasta** (adições/remoções em commits sem merge): `src/app` +115,9k/−42,7k (2.382 toques); `src/components` +36,4k/−8,2k; `src/features/admin` +33,9k/−7,6k; `src/features/payments` +31,2k/−5,7k; `docs/superpowers` +34,2k; `docs/reviews` +22,8k; `src/db` +714k (snapshots JSON do Drizzle); `.github` 157 toques.
- **Estabilidade:** 526 dos 666 arquivos de runtime em `src` (79%) foram alterados desde 2026-09-01 [F]. [I] Não há núcleo estável: o código inteiro foi reescrito ou ajustado no último mês de vida do legado.
- **Marcos:**
  - jun: scaffold e features base;
  - jul: arquitetura, auditoria e Vercel;
  - 31/07: Asaas;
  - ago: staging, readiness, backups e go-live;
  - set: remediação, permissões, design system, free enrollment, Google OAuth;
  - out: onboarding verificado, rate limits, Neon não-produtivo, custo de crons.

---

## 14. Lições para a vNext

### 14.1 Manter (conceitos comprovados no legado)

- **Outbox/inbox duráveis em PostgreSQL:**
  - claim `FOR UPDATE SKIP LOCKED`;
  - lease com **fencing por dono** (`locked_by`) em toda transição terminal;
  - tentativas limitadas com backoff + jitter;
  - `dead_letter` e `superseded` distintos;
  - payload só com IDs (sem PII), com token derivado no momento da entrega;
  - chave idempotente por tópico/agregado/versão;
  - reprocessamento manual com motivo + auditoria na mesma transação.
  - (`src/features/outbox/server.ts:55-80`; runbook `outbox-and-transactional-effects.md:174-249`.) Na vNext, Queue acelera e o reconciler/sweep recupera, mas a semântica deve ser a mesma.
- **Webhook = persistir antes do 2xx** + worker transacional + reconciliação que reutiliza a **mesma** matriz de decisão (`docs/architecture.md:126-142`).
- **Lease de job em tabela** (`scheduled_job_leases`) com deadline interno menor que o limite do runtime e kill switches por job/provider.
- **Guards de migration:**
  - alvo aprovado por host + project ID + branch ID;
  - recusa de pooler;
  - advisory lock;
  - uma transação por arquivo (enum);
  - validação de hash do journal;
  - `check` local e `inspect` read-only;
  - readiness exigindo a migration mínima.
- **Backup independente:** `pg_dump` + `age` → R2 com Bucket Lock/lifecycle, manifesto e checker de frescor, restore ensaiado com RTO medido, gate de release exigindo backup fresco. A vNext já prevê isso; agendar fora do cron do GitHub ou monitorar atraso.
- **CI com PostgreSQL 18 real** em service container (sem branches Neon efêmeras): a simplificação de 2026-08-31 eliminou custo, cota e um workflow janitor.
- **E2E com providers falsos locais** (Asaas falso, S3 local) e testes de concorrência em PG real.
- **Rate limit transacional em PG com chave HMAC** para quotas ligadas a negócio (checkout, desafios de e-mail, certificado público). Borda (WAF/binding) só para volume.
- **Correlation ID** ponta a ponta e sanitização de PII antes de qualquer telemetria. Sentry com escopo deliberado.
- **Readiness autenticada** separada de liveness. Smokes pós-deploy com status esperados (ex.: webhook sem assinatura → 400/401).
- **Workflows destrutivos com modo `plan`/dry-run + frase de confirmação + backup antes.**
- **Regras de evidência para agentes:** separar implemented/verified/deployed; não declarar deploy sem prova.

### 14.2 Evitar

- **Módulos-deus e Server Actions com SQL direto:** `admin/server.ts` 4.369 linhas; `admin/actions.ts` 2.216 linhas com 34 queries. Na vNext: caso de uso por comando, DTO/Zod na borda HTTP, adapters por provider e dependency-cruiser ativo desde M0.
- **Ciclos entre features** e "admin" como dependência universal. Colocar a auditoria em um módulo transversal pequeno, não em `admin`.
- **Validação de servidor dependente de atributos HTML.** Zod em toda entrada (o legado tinha Zod em apenas 10 arquivos).
- **Drift de schema** (migration `0020_reconcile_schema_after_manual_changes`) e `db:push` disponível. Remover qualquer caminho de `push` para ambientes remotos.
- **Duas branches persistentes com sincronização manual e PRs duplicados.** Se mantiver `main`/`staging`, automatizar a reconciliação e proibir correções paralelas.
- **Release acoplado a metadata/CLI do provedor** (parse de `vercel inspect/list`). Preferir que o próprio artefato carregue o SHA (ex.: variável injetada no build + endpoint `/version`) e verificar pelo endpoint.
- **Configuração de ambiente não versionada** (variáveis Vercel corrigidas na hora do release). A vNext deve ter `wrangler` config + `wrangler types --check` + preflight de bindings/secrets **antes** do deploy.
- **Segredos de migração/Production em Environments do GitHub** (e sem branch policy).
- **Documentação como livro-razão de estado** (`release-state.md`, checkpoints, "aplicado em X em data Y" em runbooks) e **testes que fazem asserções sobre prosa/YAML.** Estado de deploy vem de sistemas (deploy log, endpoint de versão, catálogo de migrations), não de Markdown. Testes verificam comportamento, não texto.
- **Commitar artefatos de auditoria do ambiente pessoal** (CSVs com caminhos locais, scripts de remediação de skills) e planos/pesquisas de IA no repositório de produto. Eles poluem o contexto e, num repo público, vazam dados.
- **Ritual obrigatório de ferramentas indisponíveis** (CodeRabbit sem seat, Graphify sem chave). A vNext já descarta CodeRabbit/CodeQL como gates.
- **Next.js sem uso de cache:** foram 53 `force-dynamic` e 0 cache, ou seja, pagava-se o custo de SSR sem o benefício. Na SPA da vNext, cuidar de cache HTTP explícito apenas para conteúdo público.
- **Cron HTTP como fila** e redução de frequência por custo, trocando latência de recuperação por dinheiro.
- **Dependências Node-only no runtime** (sharp, pdfkit, AWS SDK). A vNext já definiu crop no browser + Images/fallback e PDF via Browser Run.
- **Staging compartilhando recursos de Development/Production** (R2, JMVStream, Resend) por flags `*_USES_*`.

### 14.3 Complexidade acidental (cortar ou não reproduzir)

- O pipeline de release de 548 linhas (`deploy-vercel.yml`) dedicado a provar que o alias Vercel aponta para o SHA certo. Mais `prepare-production-release.yml`, `sync/production-into-staging-*`, diagnósticos temporários embutidos no workflow e 57 falhas de deploy.
- `docs:check` (643 linhas), `documentation-facts`/`relations`, contratos sobre README/reviews e 47 PRs de checkpoint documental.
- ~80 testes que leem arquivos-fonte, YAML ou docs como texto (`*-source.test.ts`, `release-workflows.test.ts` com 111 `toContain`).
- Cinco perfis de ambiente (Development local, E2E, Preview "dormente", Staging, Production) + Development compartilhado + Neon CI histórico + ~110 variáveis.
- Dois projetos Sentry, alertas redundantes, workflow de "readiness Sentry" com 12 falhas em 15.
- Modelo de currículo com `course_publications` clonadas, `curriculum_key`, fronteira linear validada de vídeo e gerações de aviso de expiração v1/v2. Detalhe de domínio no L3/L4, mas citado aqui pelo custo de migrations/testes. A vNext já proíbe reintroduzir isso.
- Skills/instruções em excesso (62 skills bloqueadas, hooks quebrados, Graphify obrigatório, ritual de saudação).
- Retenção e limpeza de branches Neon de release por cota do plano Free.

### 14.4 Complexidade que protege dinheiro, acesso e privacidade (manter, mesmo que custe)

- **Dinheiro:**
  - trilha `financial_events` **append-only por trigger** (`0074_boring_nitro.sql:671`, `prevent_financial_event_mutation`);
  - Pedido/snapshot persistido **antes** da chamada ao provider;
  - inbox Asaas autenticada + dedupe;
  - correlação apenas por identificadores exatos;
  - revisão manual (`payment_reviews` único por webhook) para casos ambíguos;
  - nunca repetir automaticamente uma mutação com resultado incerto;
  - leitura de `RateLimit-Reset` com teto de espera.
- **Acesso:**
  - concessão + projeção de matrícula recompostas **na mesma transação** que a evidência financeira;
  - revogação de sessões por trigger na troca de papel (`0065_gray_siren.sql:15`);
  - deny-by-default no servidor (a falha P1 de Support mostra o custo de não ter);
  - readiness fail-closed;
  - modo manutenção fail-closed no proxy.
- **Certificados:**
  - emissão só pela transação que cria a primeira conclusão (lock por conta+curso);
  - claim com fencing no render;
  - PUT condicional no R2 + SHA-256 verificado antes de redirecionar para URL assinada curta;
  - estados `pending/ready/failed/revoked` sem URL fora de `valid+ready`.
- **Privacidade:**
  - payloads de outbox/auditoria sem PII;
  - rate limits com HMAC (sem IP bruto);
  - sanitização de payload bruto de webhook após 30 dias;
  - retenção explícita de analytics (12/13 meses) e outbox (30/180 dias);
  - scrubbing de PII no Sentry;
  - tokens de e-mail no fragmento da URL e consumo só por POST;
  - e-mail canônico no banco (`canonicalize_auth_email_identity`).
- **Recuperação:**
  - backup cifrado independente do provedor de banco, com lock;
  - restore ensaiado;
  - gate de release com backup fresco;
  - migrations forward-only compatíveis com a versão anterior.

---

*Arquivos auxiliares desta análise (fora do repositório legado): `scratchpad/tools/*.js`, `scratchpad/runs_all.json`, `scratchpad/prs.json`, `scratchpad/reports_runs.json`.*
