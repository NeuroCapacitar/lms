# L3 — Legado NeuroCapacitar Hub: identidade, autorização, acesso, financeiro e comunicação

> Investigação somente leitura do repositório legado `NeuroCapacitar/hub`, clonado em
> `scratchpad/legacy-hub`. Commit inspecionado: `ed882138` (merge do PR #263, 2026-10-06).
> Data da investigação: 2026-10-09. Nada foi modificado. Não executei scripts, testes, banco,
> provedores nem rede, exceto `gh` em modo leitura (lista de issues e PRs e corpo de alguns PRs).
> Nenhum valor de segredo foi lido nem copiado.

## 0. Método e legenda de evidência

- **[V]** fato verificado por mim no código, schema, migration, teste ou configuração do commit
  inspecionado (com `arquivo:linha`).
- **[Doc]** afirmação da documentação canônica, ADR, revisão ou PR do legado. Descreve o que o
  legado declara ter feito ou homologado; não verifiquei em runtime.
- **[Inf]** inferência minha a partir de [V] e [Doc].

O legado é **fonte de exemplos e contexto, não fonte normativa da vNext** (AGENTS.md §2).
Onde o legado diverge dos invariantes da vNext (por exemplo, checkout guest-first), isso está
marcado explicitamente.

Dimensão do legado [V]: Next.js 16.3.6, React 19.3, Drizzle 0.45, `pg` 8.23, Better Auth
1.7.6, Resend 6.30 e Sentry 10.68 (`package.json`). Hospedado na Vercel `gru1`
(`vercel.json`). São 106 migrations em `src/db/migrations` (topo:
`0106_better_auth_rate_limits.sql`), 551 arquivos de teste e cerca de 23 mil linhas apenas em
`src/features/payments` (código + testes). O PR #257 registra 3.868 testes passando [Doc].
O repositório tem **0 issues** (o GitHub Issues não é usado) e **264 PRs**.

---

## 1. Better Auth

### 1.1 Versão e pacotes [V]

- `better-auth` 1.7.6, `@better-auth/core` 1.7.6, `@better-auth/utils` 0.4.2 e
  `@better-auth/infra` 0.4.12 (`package.json:5-7,27`). Em 2026-09-27 a versão era 1.6.25
  (`advisor-plans/google-oauth-best-practices-2026-09-27.md:3`); houve upgrade depois disso.
- Configuração única em `src/lib/auth.ts:203-327`, com singleton preguiçoso `getAuth()`
  (`:329-337`). O cliente é `createAuthClient()` sem plugins (`src/lib/auth-client.ts`).

### 1.2 Configuração completa [V] (`src/lib/auth.ts`)

| Item | Valor | Linha |
|---|---|---|
| `basePath` | `/api/auth` | 234 |
| `rateLimit` | `customRules` + `customStorage.consume` no PostgreSQL | 235-238 |
| `advanced.trustedProxyHeaders` | `true` | 239-241 |
| `trustedOrigins` | `BETTER_AUTH_URL` + `NEXT_PUBLIC_APP_URL` + extras da env | 242-245 |
| Adapter | `drizzleAdapter(pg)`, `usePlural`, tabelas `users/accounts/sessions/verifications` | 246-255 |
| `account.accountLinking` | `enabled:true`, `allowDifferentEmails:false`, `disableImplicitLinking:false`, `updateUserInfoOnLink:false` | 256-262 |
| `account.encryptOAuthTokens` | `true` | 263 |
| `emailAndPassword` | habilitado, `requireEmailVerification:true`, `minPasswordLength:8`, `resetPasswordTokenExpiresIn:3600`, `revokeSessionsOnPasswordReset:true` | 265-275; `src/lib/password-policy.ts:1-9` |
| `onPasswordReset` | marca `users.email_verified=true`; se falhar, apaga sessões e lança erro | 161-201, 272-274 |
| `databaseHooks.session.create.before` | bloqueia sessão de Student com `platformBlockedAt` (`ACCOUNT_SUSPENDED`) | 276-289 |
| `emailVerification` | `expiresIn:3600`, `sendOnSignUp:false`, `sendOnSignIn:false`, `autoSignInAfterVerification:false`; o sender delega ao desafio próprio do Hub | 290-314 |
| `socialProviders.google` | só quando `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` existem juntos; `overrideUserInfoOnSignIn:true`, `disableImplicitSignUp:true`, `disableIdTokenSignIn:true`, `disableSignUp:!AUTH_PUBLIC_SIGNUP_ENABLED`; `mapProfileToUser` customizado | 315-324; `src/lib/auth-policy.ts:238-285` |
| `plugins` | `dash()` + `sentinel()` (só com `BETTER_AUTH_API_KEY` e fora de E2E) + `nextCookies()` | 216-229, 325 |

**Ausentes [V]:** nenhum bloco `session` de topo (não há `expiresIn`, `updateAge`,
`cookieCache` nem `freshAge` configurados; o `session:` da linha 277 está dentro de
`databaseHooks`), nenhum passkey, magic link, email OTP, `twoFactor`, Admin Plugin nem
Organization Plugin.

**Sessão [Inf]:** sem configuração explícita, valem os defaults do Better Auth (7 dias com
renovação diária e cookie cache desligado, segundo a documentação oficial). Não confirmei isso
em `node_modules`, que não está instalado no clone. A vNext exige sessão rolling de 7 dias; o
legado chega a algo equivalente **por omissão, não por contrato testado**.

### 1.3 2FA/MFA: implementado e removido [V]/[Doc]

- A tabela `two_factors` e a coluna `users.two_factor_enabled` permanecem só como histórico de
  migration (`src/db/schema.ts:291-323`).
- `src/lib/mfa-removal-contract.test.ts` garante que não existem plugin `twoFactor`, a flag
  `PRIVILEGED_MFA_ENFORCED` nem páginas de segundo fator.
- Decisão de 2026-09-01: "não adotar MFA administrativo neste momento"
  (`docs/decisions.md:219-220`). O plano `plans/004-security-and-public-boundaries.md:162`
  queria 2FA obrigatória para papéis privilegiados; foi abandonado.
- **Mitigação substituta [V]:** step-up por senha no reembolso (ver §5.9).

### 1.4 Cadastro, verificação e recuperação [V]/[Doc]

- **O signup nativo é sempre bloqueado:** `POST sign-up/email` responde 404
  `email_confirmation_required` mesmo com o cadastro público ligado
  (`src/app/api/auth/[...all]/route.ts:265-277`), porque gravaria senha antes da prova da caixa.
- `AUTH_PUBLIC_SIGNUP_ENABLED` tem default `false` (`src/lib/env.ts:36`;
  `docs/domain/identity-and-authorization.md:79-81`). Quando ligado, `/cadastro` usa a rota
  própria `POST /api/account/registrations`: coleta só nome e e-mail, cria `pending_signups` e
  um desafio HMAC (`account_email_challenges`) e responde sempre 202 neutro
  (`src/app/api/account/registrations/route.ts`). A conta Student nasce **verificada, sem
  credencial e sem sessão** só depois de um `POST` explícito que consome o desafio. O token
  viaja no fragmento da URL e o `GET` não muda estado (`docs/domain/identity-and-authorization.md:87-95`).
- **Reivindicação de conta legada não verificada [Doc]:** na transação, consome o desafio,
  apaga credencial e sessões anteriores à prova e só então marca o e-mail como verificado.
  Isso mitiga o *pre-account hijacking*.
- `GET /api/auth/verify-email` nativo não marca estado: redireciona (303) para
  `/confirmar-email?legacy=1` (`route.ts:189-201`).
- `POST send-verification-email` sempre responde `200 {status:true}`, sem enumeração; limite de
  3 por hora (`route.ts:101-141`; `auth-policy.ts:360-386`).
- `POST change-email` nativo responde 404. A troca de e-mail é um fluxo próprio com duas provas
  (endereço atual e novo), avisos aos dois endereços, revogação de sessões e advisory locks em
  ordem lexical (`route.ts:312-317`; `docs/domain/identity-and-authorization.md:142-189`).
- **Reset de senha [V]:** `request-password-reset` e `reset-password` passam por
  `withAccountPasswordResetOperation`, que registra a operação em
  `account_password_reset_operations` sob advisory lock compartilhado com a troca de e-mail,
  aplica rate limit HMAC por IP, e-mail e token e falha fechado com 503
  (`route.ts:322-347`; doc `:151-171`). Resposta pública neutra com tempo mínimo de 250 ms
  [Doc]. O e-mail de reset fica **fora da outbox** porque a URL contém token
  (`docs/decisions.md:250-262`, DEC-DISC-015).
- **A senha é opcional [Doc]:** contas criadas por compra, convite ou Google podem não ter
  credencial. A "primeira senha" é criada pelo próprio fluxo de reset (`/recuperar-senha`).

### 1.5 Google e linking [V]/[Doc]

- `/entrar` usa Google só para conta existente (sem `requestSignUp`); `/cadastro` envia
  `requestSignUp:true` somente com o cadastro público ligado; caso contrário, o guard
  responde 404 (`auth-policy.ts:222-236`; `route.ts:279-296`).
- **Primeiro vínculo [Doc]:** exige `email_verified` do Google **e** `users.email_verified`
  local (default do Better Auth `requireLocalEmailVerified`). É proibido configurar
  `requireLocalEmailVerified:false` ou `trustedProviders` (DEC-DISC-020,
  `docs/decisions.md:356-414`). A justificativa cita o advisory de *pre-account hijacking* via
  linking implícito, corrigido no Better Auth 1.6.11
  (`advisor-plans/google-oauth-best-practices-2026-09-27.md`).
- `mapGoogleProfileToUser` (`auth.ts:40-144`) segue esta ordem: (1) procura `accounts`
  google + `sub`; havendo mais de um, falha fechado. (2) Se não houver vínculo, busca candidatos
  pela função SQL `canonicalize_auth_email_identity`; se houver mais de um, falha fechado
  (`email:null`). (3) Preserva o nome, o e-mail e a imagem locais; a foto do Google só entra
  quando não há imagem local.
- Índice único `(provider_id, account_id)` em `accounts` (`schema.ts:359-363`), criado
  depois de um preflight de colisões (`scripts/preflight-google-identities.ts`, migration 0095/0096).
- Tokens OAuth cifrados; sem escopos de produto (`auth.ts:263`).
- Vínculo explícito autenticado por `linkSocial` nas Configurações
  (`docs/domain/account-profile-and-access.md`).

### 1.6 Identidade canônica de e-mail [V]

- Função SQL `public.canonicalize_auth_email_identity` (`src/db/migrations/0097_identity_email_challenges.sql:3-30`).
  Para gmail/googlemail, remove pontos e `+tag` e converte para `@gmail.com`. Para
  fastmail/hotmail/icloud/live/mac/me/outlook/proton/yahoo/zoho, remove `+tag`.
- Índices únicos `users_email_lower_unique_idx` e `users_email_identity_unique_idx` sobre a
  função (`schema.ts:297-302`). O espelho em TypeScript é `normalizeBuyerEmail`
  (`src/lib/email-identity.ts:1-38`).
- **Origem [Doc]:** incidente de homologação Sandbox. O Sentinel do Better Auth normalizava
  pontos e `+tag` do Gmail, mas a identidade da compradora não, e a ativação divergiu
  (`docs/integrations/asaas.md:719-723`).

### 1.7 Rate limit do auth [V]/[Doc]

- O storage customizado `consumeBetterAuthRateLimit` (`src/lib/better-auth-rate-limit-storage.ts`)
  faz `INSERT … ON CONFLICT DO UPDATE` atômico em `better_auth_rate_limits`, com chave
  **HMAC-SHA-256** (IP + path) derivada de `BETTER_AUTH_SECRET`. Buckets já bloqueados não são
  regravados. A janela é renovada a cada request permitido, ou seja, é deslizante por extensão.
- **Bug corrigido em 2026-10-03 [Doc]:** até o PR #250 o storage era a memória do processo
  (default do Better Auth), sem coordenação entre instâncias serverless
  (`docs/reviews/2026-10-03-rate-limits-project-audit.md:118-122`).
- Regras especiais do Better Auth 1.7.6 [Doc]: 3 requisições a cada 10 s em
  `/sign-in`, `/sign-up`, `/change-password` e `/change-email`; 3 a cada 60 s em
  recuperação/OTP. O Hub sobrescreve só `/send-verification-email` (3 por hora).

### 1.8 `@better-auth/infra` (Dash + Sentinel) [V]/[Inf]

- [V] Importa `dash` e `sentinel` (`auth.ts:3`). O Sentinel é configurado com
  `credentialStuffing: { enabled:true, thresholds:{ block:5, challenge:3 } }` (`auth.ts:219-227`).
  Ambos dependem de `BETTER_AUTH_API_KEY` (+ `BETTER_AUTH_API_URL` e `BETTER_AUTH_KV_URL`
  opcionais) e ficam desligados em E2E (`auth-policy.ts:388-408`).
- [Inf] É a infraestrutura gerenciada da Better Auth: um painel (dash) e um serviço de
  segurança contra credential stuffing (sentinel), externos ao app. Isso implica enviar
  telemetria de autenticação a um terceiro.
- [Doc] **A presença em Production nunca foi confirmada:** "A presença e operação do Sentinel
  continuam sendo configuração externa a confirmar em Production"
  (`docs/domain/identity-and-authorization.md:50-51`; audit 2026-10-03 `:120`).

### 1.9 Schema de auth [V] (`src/db/schema.ts`)

- `users(id text, name, email unique, email_verified, image, two_factor_enabled[legado], timestamps)` (285-304).
- `sessions(id, expires_at, token unique, ip_address, user_agent, user_id→cascade)` (325-339).
- `accounts(id, account_id, provider_id, user_id, access/refresh/id tokens, expirations, scope, password)`
  com unique `(provider_id, account_id)` (341-366).
- `verifications(id, identifier, value, expires_at)` (368-374). **Também é reutilizada pelo
  Hub** para tokens de confirmação de reembolso (§5.9).
- Tabelas próprias do Hub em torno do auth: `pending_signups`, `account_email_challenges`,
  `account_email_challenge_rate_limits`, `account_email_change_requests`,
  `account_password_reset_operations`, `staff_invitations` e `better_auth_rate_limits`
  (1383-1611, 2100).
- O trigger `users_create_student_profile` (migration `0041`) cria o Profile `student` junto
  com cada User [Doc].

---

## 2. Autorização

### 2.1 Modelo [V]

- **Papel único e exclusivo:** `roleEnum = admin | support | student` em `profiles.role`
  (`schema.ts:31, 376-381`). Não há plugin Admin nem Organization (ADR-0001).
- **Grants de Suporte desnormalizados** em dois arrays `text[]`, com CHECK constraints
  enormes que fazem a allowlist e impedem duplicatas (`schema.ts:382-479`):
  - `support_permission_grants` (13 mutações delegáveis): `createCourse`,
    `manageCourseDetails`, `manageCourseContent`, `manageCourseAvailability`,
    `manageCourseCertificate`, `manageEnrollmentSupport`, `manageEnrollmentAccess`,
    `reissueCertificates`, `manageCertificateIssuerProfile`, `executeRefund`,
    `manageFinancialOperations`, `manageFinancialReviews`, `manageOperations`;
  - `support_permission_views` (4 views protegidas): `viewFinancialAnalysis`,
    `viewFinancialOrders`, `viewFinancialReviews`, `viewAudit`.
  - Admin e Student persistem arrays vazios (check).
- **Matriz central:** 41 capacidades em `AuthPermission` (`src/lib/auth-policy.ts:10-50`).
  - Admin tem todas (`:58-99`, `:174-176`).
  - Suporte tem 12 capacidades padrão sem grant, entre elas `viewAdminPanel`, `viewStudents`,
    `viewCourses`, `viewOperations`, `manageFaq`, `manageBanners` e `manageAuthMedia`
    (`:101-114`), além de grants condicionados a views pré-requisito (`:120-136`, `:170-207`).
  - Student não tem nenhuma.
- **Admin-only por decisão [Doc]:** `manageStaffAccess`, bootstrap, credenciais, segurança,
  manutenção de banco, moderação (`manageContent`) e emissão/revogação/reconciliação de
  certificados (ADR-0017).

### 2.2 Como é checado [V]

- `requirePermission(permission)` (`src/lib/auth-permissions.ts:7-17`) chama `requireSession`
  e `canPerform`; quando nega, faz `redirect("/app")`. Há 124 chamadas a
  `requirePermission(` fora dos testes.
- `requireSession` (`src/lib/session.ts:123-150`) resolve a sessão do Better Auth e **relê o
  Profile do banco a cada request** (role, grants, views, bloqueio). Por isso uma mudança de
  grant vale sem logout. Também grava `last_access_at` no máximo a cada 5 minutos.
- O enforcement fica em Server Actions, Route Handlers e loaders de página (Next.js). **Não há
  middleware central de autorização**; `src/proxy.ts` só injeta correlation ID e modo de
  manutenção.
- Uma Student com bloqueio de plataforma é barrada no hook de criação de sessão
  (`auth.ts:276-289`), no catch-all do auth (`route.ts:80-99`, 403 `ACCOUNT_SUSPENDED`) e nos
  guards de página (`session.ts:128-130`).

### 2.3 Gestão de equipe e proteção do último Admin [V]

`changeStaffAccessAction` (`src/features/admin/staff-actions.ts:55-200`):

- exige `manageStaffAccess` e proíbe autoalteração (`:58-63`);
- serializa por `pg_advisory_xact_lock('staff-access-management')` (`:73`) e revalida que o
  ator ainda é Admin (`:76-84`);
- **último Admin:** recusa o rebaixamento se `count(*) where role='admin' <= 1` (`:129-136`).
  [Inf] Conta admins por papel, não admins "ativos": não existe bloqueio de Admin, então hoje
  é equivalente, mas a vNext exige "≥1 Admin ativo";
- um Student só vira equipe aceitando convite; essa action não promove Student (`:100-104`);
- mudança de papel revoga as sessões do alvo (`:158-162`), com auditoria before/after, motivo e
  correlação (`:164-176`).

Convites (`staff_invitations`) [Doc]: validade de 7 dias, token HMAC gerado na entrega com
geração rotacionável e consumo por `POST` explícito. O aceite não autentica, e o Student que
aceita **perde a experiência de aluno**, porque o papel é único
(`docs/domain/identity-and-authorization.md:97-124`; ADR-0017).

### 2.4 Impersonation [V]

Não existe; nenhuma ocorrência de `impersonat*` em `src`. O ADR-0017 apenas a lista entre as
operações que seriam Admin-only.

### 2.5 Testes de acesso cruzado [V]

- `src/lib/auth-policy.test.ts`: matriz de grants e views (por exemplo, "does not let a
  Support grant authorize another mutation" e "requires the related protected view before a
  financial change").
- `src/features/admin/server-authorization-contract.test.ts` **lê o código-fonte e procura a
  string** `requirePermission("…")` em cada função (`:1-40`). É um teste frágil e não prova o
  comportamento.
- Route tests reais: `src/app/api/admin/operations/courses/[courseId]/students/[userId]/route.test.ts`
  ("does not disclose whether an out-of-scope student exists") e
  `src/app/api/account/avatar/route.test.ts` ("derives avatar ownership from the session and
  never accepts a user id", "denies … to a suspended Student", "rejects cross-origin upload").
- E2E: "admin is authorized and a student is redirected away from admin" e "support
  navigation and student Sheet preserve the role boundary"
  (`tests/e2e/critical-journeys.spec.ts:1038,1050`).
- **Achado histórico [Doc]:** F-001 (P1), em que `support` atravessava fronteiras
  administrativas por gates `viewAdminPanel` ou por papel em vez de capacidade
  (`docs/reviews/2026-08-23-production-readiness-audit.md:122-175`). Foi corrigido depois com
  capacidades específicas.

---

## 3. Conta, perfil e LGPD

- **Dados pessoais coletados [V]:** nome e e-mail (`users`), imagem (URL do Google ou avatar
  próprio), `profiles.phone` (**coluna existe, `schema.ts:395`, mas não é usada em nenhum
  código de aplicação**: a busca por `.phone|phone:` só a encontra no schema),
  `last_access_at`, IP e user agent em `sessions`. **Não coleta CPF, endereço nem data de
  nascimento** (não há ocorrência de `cpf` em `src` fora de testes/adapters). O checkout
  descarta CPF, telefone e endereço vindos do Asaas (`docs/integrations/asaas.md:257-261`).
- **Avatar [Doc]/[V]:** JPG, PNG ou WebP estático de até 5 MiB, validado pelo conteúdo, com
  recorte manual no browser e conversão para WebP 512×512. Fica em R2 privado com chave
  contendo o `userId` da sessão, é servido por `GET /api/account/avatar` com
  `Cache-Control: private, no-store` e um `revision` opaco (hash da chave). Órfãos são
  limpos após 24 h. O fallback é: imagem própria, depois Google, depois iniciais
  (`src/lib/session.ts:38-56`; `docs/domain/identity-and-authorization.md:201-212`).
- **Configurações:** Student em `/app/configuracoes`; Admin e Suporte em
  `/admin/configuracoes?tab=perfil`. Não há rota de Conta separada (REG-IDA-009).
- **Exclusão de conta, exportação de dados e direitos LGPD [V]/[Doc]: não existem.** O
  workflow de solicitações e anonimização **foi removido** "porque não havia solicitante"
  (`docs/decisions.md:121-124`, DEC-DISC-008; `docs/domain/certificates-and-data-rights.md:244-248`).
  Um pedido real é tratado como incidente manual.
- **Política de privacidade [V]:** `src/app/politica-de-privacidade/page.tsx` (57 linhas) é
  um "Aviso de privacidade" mínimo sobre dados de aprendizagem, analytics opcional (opt-out),
  retenção de 12/13 meses, suporte (90 dias) e certificado revogado (**PDF removido após 60
  dias**). Não cita controlador, base legal, dados financeiros, Asaas, Resend, Google, Sentry,
  cookies, DPO nem compartilhamento. Não há termos de uso nem aceite no cadastro; o único
  link para o aviso está nas Configurações do Student.
- **Analytics de aprendizagem:** opt-out, ratificado juridicamente em 2026-08-21 (DEC-DISC-009).

---

## 4. Acesso (Concessão → Matrícula)

### 4.1 Modelo [V]

- **Concessão** (`enrollment_grants`, `schema.ts:872-920`) é a fonte do direito, com
  `source_type`:
  - `paid_order`: exige `order_id`;
  - `manual`: exige `manual_reference`;
  - `free_enrollment`: sem nenhum dos dois; no máximo uma por User+Course (índice parcial).
  
  Os estados são `active | expired | refunded | disputed | cancelled`, com
  `base_expires_at`/`effective_expires_at` e CHECKs de forma.
- **Matrícula** (`enrollments`, `schema.ts:835-870`) é a projeção única por User+Course, com
  `status active|expired|revoked`, `content_release_mode full_access|scheduled` e marcadores
  de aviso de expiração 7d/1d.
- **Equivalência com a vNext [Inf]:** Concessão = `Entitlement` e Matrícula = `Enrollment`.
  O padrão é idêntico ao da vNext (ADR-0004). Toda mutação altera a Concessão e recompõe a
  projeção (`rebuildEnrollmentProjection`).

### 4.2 Expiração [V]

- É validada **por requisição**: `resolveCourseAccess` e `resolveLessonAccess` filtram
  `e.starts_at <= now() and e.expires_at >= now()` (`src/features/enrollments/access.ts:36-37,127-128`)
  e `rules.ts:116` nega quando `now > expiresAt`.
- O cron diário `/api/cron/enrollments` (`vercel.json`, `0 10 * * *`) materializa as
  expirações e gera avisos de 7 e 1 dia.
- Ajustes de validade (`extend_days`, `extend_months`, `set_exact_expiration`) exigem motivo e
  registro em `enrollment_expiration_adjustments`. A reversão foi removida por ser insegura
  (REG-COM-006, `docs/domain/commerce-and-access.md:224-226`).

### 4.3 Concessão manual, bloqueio e revogação [Doc]/[V]

- `manual` é usada pelo bootstrap e seed local (ADR-0004). Também existe um `full_access`
  administrativo único por episódio, com motivo (REG-COM-005).
- `blockEnrollmentAccess` cancela as concessões elegíveis com motivo `manual_access_block`;
  `restoreEnrollmentAccess` restaura só essas (REG-COM-007).
- Revogação financeira só em `paid_order`, com razões neutras `payment_refund` e
  `payment_dispute`.
- **O bloqueio de plataforma prevalece sobre Matrícula** e não apaga nada (REG-IDA-004).

### 4.4 Curso gratuito (ADR-0016) [Doc]/[V]

- `price_in_cents = 0` com Curso ativo, listado, com vendas abertas e Publicação publicada.
- Uma Student autenticada chama `enrollFreeCourseAction`. Sob lock de Conta+Curso, o sistema
  cria ou reativa a concessão `free_enrollment`, registra o evento e recompõe a Matrícula.
  **Sem Order, Checkout ou Asaas.**
- Uma concessão efetiva de outra origem torna a operação um no-op. Uma concessão gratuita
  expirada pode ser reativada só por ação explícita; concessão terminal ou Matrícula revogada
  não é reativada.
- Testes: `src/features/enrollments/free-enrollment.test.ts` ("keeps the service outside paid
  infrastructure…") e `free-enrollment.integration.test.ts`.
- Isso é **igual à vNext**.

---

## 5. Financeiro e Asaas

### 5.1 Histórico [Doc]

- O gateway anterior era o **AbacatePay**, substituído pelo Asaas entre julho e agosto de 2026
  (`docs/Plano de migracao.md`; `docs/reviews/2026-07-30-asaas-sprint-review.md`). A troca
  "exige redesenhar a fronteira entre o gateway e o domínio financeiro".
- O corte comercial em Production foi em 2026-08-21. A **conta Asaas foi trocada em
  2026-08-25**, o que exigiu versionar para `v3` o namespace de `localStorage`/`sessionStorage`
  da tela de compra, para não reutilizar URLs de checkout da conta anterior (PR #73;
  `docs/integrations/asaas.md:224-228`). O PR #75 foi um diagnóstico temporário do estado da
  conta Production.
- Primeira venda real: 2026-08-26 (`asaas.md:30-32`).

### 5.2 Fluxo de compra [V]/[Doc]

- **Entrada:** link estável `/comprar/[slug]`, usado pela landing page externa. O `GET` é
  público e read-only. Um Client Component cria ou reutiliza um UUID `checkoutAttemptId` no
  `sessionStorage`, faz **um** `POST /api/checkouts/course` e redireciona para o Checkout
  hospedado. O host de destino é validado contra uma allowlist exata
  (`sandbox.asaas.com`, `www.asaas.com`, `asaas.com`) (`asaas.md:282-336`).
- **Body:** exatamente `checkoutAttemptId` + (`courseId` xor `courseSlug`). Nome, e-mail, CPF,
  preço e callbacks são rejeitados. Respostas: `200` ready, `202` processing/incerto,
  `502` rejeição conhecida, `429` com `Retry-After` e `503` genérico.
- **Bloqueios antes da cobrança:** Admin, Suporte e Student com bloqueio geral recebem 403; o
  E2E também cobre Matrícula ativa ou revogada ("authenticated purchase blocks active, revoked,
  blocked, and team accounts before charge", `critical-journeys.spec.ts:254`).
- **Cronograma:** se houver Módulos com liberação atrasada, o comprador revisa o cronograma; o
  servidor compara o digest antes de criar o Pedido (REG-COM-001).
- **Sequência:** o Pedido é persistido **antes** da chamada externa (reserva `pending`); depois
  passa a `creating`, então `active` (com URL) ou `failed`/`uncertain`. A expiração da sessão
  Asaas é de **60 minutos** (`src/features/payments/checkout.ts:26`; limites de 10 a 1440 em
  `asaas-client.ts:94-95`).
- **Callbacks:** sucesso em `/app/checkout/sucesso` (autenticado) ou `/checkout/sucesso`
  (público); cancelamento e expiração em `/checkout/cancelado|expirado?attemptId=`. **Callback
  nunca é autoridade de pagamento.**
- **Compra por visitante não logado: SIM, é o fluxo principal (guest-first)** (DEC-DISC-007).
  O Pedido público nasce **sem PII**; o Asaas coleta os dados. Depois do evento autoritativo,
  o Hub consulta `GET /v3/customers/{id}` (só `id`, `name` e `email`), cria a Conta local
  **não verificada** ou vincula pela identidade canônica e envia `email.purchase-confirmed`.
  **Isso diverge da vNext**, que exige identidade autenticada e verificada antes do Asaas.

### 5.3 Hospedado versus transparente [Doc]

- Usa **somente o Checkout hospedado Asaas** (`/v3/checkouts`), com item inline e
  `imageBase64` do logo rasterizado em PNG. Não há produto remoto.
- O checkout transparente com a API de cartão foi rejeitado por escopo PCI
  (`docs/reviews/2026-08-03-asaas-installment-interest-research.md:264-271`).
- Não envia `customer` nem `customerData`: no Sandbox, `customerData` sem `cpfCnpj` foi
  rejeitado com `invalid_object`, e o Hub não coleta CPF (`asaas.md:91-93, 659-663`).

### 5.4 Meios, parcelamento e juros [Doc]/[V]

- Pix e/ou cartão por Curso (`billingTypes`). Cartão `DETACHED` ou `INSTALLMENT` até
  `maxInstallmentCount`. **Teto comercial de 12x**; o padrão de novos cursos é Pix + cartão em
  até 3x (DEC-DISC-011).
- **Preço único** para Pix, à vista e parcelado; **a vendedora absorve as taxas.** O Checkout
  hospedado **não permite juros de parcelamento** por sessão, e o campo `interest` é juro de
  mora (`docs/reviews/2026-07-30-asaas-payment-configuration-research.md`;
  `2026-08-03-asaas-installment-interest-research.md:29-60`). O experimento de "preço maior
  por parcela via Fatura" foi **pausado** (PR #26 não mergeado).
- **Mínimo de R$ 10,00 (1000 centavos)** por curso pago e por parcela. O teto efetivo é
  `floor(price/1000)`, limitado entre 1, o teto configurado e 12 (`asaas.md:113-125`;
  DEC-DISC-010).
- **Boleto:** não suportado (só aparece como rótulo de exibição em `src/features/admin/order-filters.ts:118`).
  **Cupons:** inexistentes. **Nota fiscal/NFS-e:** inexistente.
- **Parcelamento [Doc]:** cada parcela tem seu `payment.id`. O Hub guarda
  `provider_installment_id`, consulta `GET /v3/installments/{id}` antes de decidir, valida o
  bruto agregado contra o snapshot, sincroniza as parcelas em `asaas_installment_payments` e
  estorna pelo `POST /v3/installments/{id}/refund`. O Asaas devolve **uma evidência de estorno
  por parcela**; o Hub só confirma quando a soma bate exatamente
  (`asaas-sprint-review.md:30-35`).

### 5.5 Dinheiro [V]

- Centavos inteiros em todo o domínio (`orders.amount_in_cents`, `paid_amount_in_cents`,
  `net_amount_in_cents`, `fee_amount_in_cents`). A conversão para o decimal em reais é exata e
  só ocorre na borda HTTP (`asaas-money.ts`; teste "converts decimal provider values to exact
  safe cents").
- **Tolerância zero:** o `value` bruto deve igualar o snapshot (DEC-DISC-003).

### 5.6 Webhooks [V]/[Doc]

- **Autenticação:** só o header estático `asaas-access-token`, comparado por SHA-256 +
  `timingSafeEqual` (`src/features/payments/asaas-webhook-inbox.ts:21-38`). O token precisa
  ter ao menos 32 caracteres; sem isso, a rota responde 503 (`route.ts:80-82`). **Não há HMAC
  do corpo nem allowlist de IP** (o Asaas não oferece HMAC; `asaas.md:367-369`).
- **Tamanho:** limite de 256 KiB por stream antes do JSON (`src/app/api/webhooks/asaas/route.ts:20-60`).
- **Persist-before-200:** `INSERT … ON CONFLICT (provider, event_key) DO NOTHING`. Duplicata
  responde 200, falha de banco responde 503, e eventos desconhecidos também são persistidos
  (`asaas-webhook-inbox.ts:40-80`; `route.ts:107-121`). O payload expira em 30 dias e é
  sanitizado.
- **Processamento:** após a resposta, `scheduleAfterResponse` processa o próprio evento (prazo
  de 45 s) e drena até 5 mensagens da outbox (`route.ts:123-149`). O cron
  `/api/cron/asaas-webhooks` (`15,45 * * * *`) é a recuperação, com lease de 6 min e deadline
  de 270 s.
- **Worker [Doc]:** `FOR UPDATE SKIP LOCKED`, lote de 50, 5 tentativas, backoff exponencial a
  partir de 1 min e stale lock após 10 min. O processamento tem duas fases: `prepare` (HTTP
  externo fora da transação) e `process` (transação com `lockOrder`). **Nenhuma chamada HTTP
  dentro da transação PG.**
- **Ordem:** a matriz de precedência resolve chegadas fora de ordem. O Staging usa envio
  sequencial no Asaas [Doc].

### 5.7 Eventos tratados [V] (`src/features/payments/asaas-financial-events.ts:84-119`)

- **Checkout:** `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED`, `CHECKOUT_EXPIRED`.
- **Pagamento:** `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
  `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`,
  `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_REFUND_DENIED`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`.
- **Risco:** `PAYMENT_AWAITING_RISK_ANALYSIS`, `PAYMENT_APPROVED_BY_RISK_ANALYSIS`,
  `PAYMENT_REPROVED_BY_RISK_ANALYSIS`.
- **Disputa e chargeback:** `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`,
  `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`. Todos **revogam**, assim como `PAYMENT_REFUNDED`
  (`:84-91`).

**Matriz aprovada (ADR-0005, `asaas.md:433-501`):**

- `CHECKOUT_PAID` **nunca** libera.
- **PIX** libera em `PAYMENT_RECEIVED`. **Cartão** libera em `PAYMENT_CONFIRMED` sem risco
  `AWAITING` ou `REPROVED`; uma aprovação de risco posterior destrava a confirmação já
  armazenada (`:686-699`).
- Reembolso, disputa e chargeback **prevalecem e revogam**. Pagamento tardio não reativa
  estado adverso. Cancelamento ou expiração tardios não revogam Pedido pago.
- `provider_payment_status` só avança (`CONFIRMED→RECEIVED`); uma regressão abre Revisão.
- `PAYMENT_PARTIALLY_REFUNDED` sempre abre Revisão `partial_refund`.
- Valor divergente, referência conflitante ou evento desconhecido: Revisão ou alerta, sem
  efeito.
- **Revisão pendente bloqueia a concessão, mas não bloqueia a revogação.**
- Exceção [Doc]: se `getInstallment` falhar em evento adverso com `provider_installment_id`
  idêntico ao do Pedido, o sistema revoga **sem esperar o enriquecimento** e abre
  `event_anomaly` (`asaas.md:411-422`).

### 5.8 Revisão manual [V]/[Doc]

- Tipos: `amount_mismatch`, `terminal_conflict`, `event_anomaly`, `partial_refund`,
  `uncertain_result` e `buyer_identity` (`schema.ts:152-159`). Revisões são únicas por
  `webhook_event_id`.
- **Somente `amount_mismatch` aceita aprovar ou rejeitar.** Aprovar exige o valor observado
  persistido na própria Revisão e nenhuma outra Revisão pendente no Pedido (teste "blocks
  approval before writes or access when another review on the order is pending").
- `buyer_identity` só fecha com **reembolso integral confirmado**. `terminal_conflict`,
  `event_anomaly` e `uncertain_result` exigem conciliação. `partial_refund` exige tratamento
  específico.
- Ações exigem `manageFinancialReviews`, motivo e auditoria.

### 5.9 Reembolso [V]/[Doc]

- Só **reembolso integral**. A sequência em `src/features/payments/refunds.ts` é:
  1. step-up por senha: `confirmRefundPasswordAction` **lê o hash de
     `accounts.password` diretamente** e usa `verifyPassword` do `@better-auth/utils`
     (`:101-115`);
  2. o token de confirmação (TTL de **10 min**) é gravado na tabela `verifications` do Better
     Auth (`:17, 117-142`);
  3. limite de 5 falhas em 15 min por ator (`:18-19`);
  4. reserva local `processing` e **uma** mutação no Asaas;
  5. resultado: `failed` (rejeição definitiva, aceita nova solicitação), `uncertain`
     (timeout, 5xx ou resposta incoerente; exige conciliação, **sem repetição cega**) ou
     `confirmed`.
- **Correlação [Doc]:** o `Payment` gerado pelo Checkout volta com **`externalReference=null`**,
  então a correlação aceita ID do pagamento + `checkoutSession` exatos e rejeita qualquer
  identificador conflitante (`asaas.md:530-538, 726-732`).
- **Conta sem senha local (Google ou convite)** precisa criar senha via `/recuperar-senha` para
  conseguir reembolsar (`docs/domain/account-profile-and-access.md`).
- O PR #243 corrigiu "a corrida que apagava a senha na confirmação de reembolso".
- **Chargeback:** tratado como disputa (revoga). **Não há fluxo de contestação** no Hub.

### 5.10 Reconciliação [Doc]

- **Por Pedido:** `GET /v3/payments/{id}` (+ parcelas), aplicando a mesma matriz via
  `decideQueriedAsaasPayment`.
- **Por extrato:** `GET /v3/financialTransactions` paginado com cursor transacional em
  `asaas_statement_import_cursors`. **Não correlaciona** tarifa com Pedido por proximidade.
- Ambas exigem `manageFinancialOperations`. O cliente respeita `429`, `Retry-After` e
  `RateLimit-Reset`, com fila só **intraprocesso** (máximo de 30 s por espera)
  (`asaas.md:269-281`).
- Limites do Asaas: 25.000 requisições por 12 h e 50 GETs concorrentes.
- `financial_events` é a trilha append-only normalizada.

### 5.11 Dashboards e KPIs [Doc]

- "Recebimento confirmado" é o bruto dos Pedidos com evidência de pagamento, incluindo os que
  depois viraram `refunded` ou `disputed`. "Potencial em Checkouts ativos" **não é recebível**
  (`advisor-plans/open-checkout-vs-receivable-kpi-research-2026-09-26.md`). O líquido é
  estimado.
- Defeitos abertos de semântica (`advisor-plans/finance-system-metrics-review-2026-09-26.md`):
  - CORRECTNESS-01: o filtro de checkouts encerrados esconde os cancelados;
  - CORRECTNESS-02: `CHECKOUT_PAID` permanece dentro do "potencial";
  - CORRECTNESS-03: o bruto histórico muda quando o Pedido vira `refunded`;
  - CORRECTNESS-04: um reembolso parcial em Revisão não marca o líquido como incompleto.
- A pesquisa também aponta o estado `creating` sem timeout de limpeza: só reservas `pending`
  sem evidência são removidas após 15 minutos.

### 5.12 Modelo de dados financeiro [V]

`orders` concentra cerca de 40 colunas (`schema.ts:1241-1370`):

- Pedido: status canônico, snapshots de preço, oferta, duração, slug, item e cronograma;
- sessão de checkout: `provider_checkout_id`, `checkout_url`, tentativas, erro e
  `checkout_status`;
- pagamento: `provider_payment_id`, `provider_installment_id`, método, `paid_at`, valores
  líquido e tarifa, data do provedor, recibo;
- 6 status brutos do provedor (checkout, pagamento, risco, liquidação, reembolso, disputa);
- identidade da compradora: `customer_email` e `customer_name`.

[Inf] É exatamente o acoplamento que a vNext evita ao separar Order, CheckoutSession e
Payment.

---

## 6. Outbox, efeitos transacionais e e-mail

### 6.1 Outbox [Doc]/[V]

- `outbox_messages` é gravada **na mesma transação** do efeito de domínio
  (`docs/operations/outbox-and-transactional-effects.md`).
- Estados: `pending`, `processing`, `retrying`, `delivered`, `dead_letter` e `superseded`.
- Entrega: claim `SKIP LOCKED`, lease de 10 min com fencing por `locked_by`, 5 tentativas com
  backoff exponencial e jitter de 12,5%.
- O **payload contém só IDs**: nunca nome, e-mail, token ou URL. O delivery relê os dados e
  gera o token HMAC no último momento.
- Drain pós-resposta: até 5 mensagens em 15 s. Fallback pelo cron `15,45 * * * *`.
- Retenção: entregues e superseded por 30 dias; dead letter por 180 dias.
- O reprocessamento é manual, Admin-only (`retryOutbox`), com motivo e auditoria.

### 6.2 E-mails transacionais [V] (`schema.ts:200-226`)

| Tópico | Alias do template | Observação |
|---|---|---|
| `auth.email-verification` | `auth-email-verification` | **React Email local**, não é Hosted |
| `auth.password-reset` | `auth-password-reset` | **Fora da outbox** (token na URL) |
| `auth.account-activation` | (reset Better Auth) | v1 histórico, bloqueado para novos Pedidos |
| `auth.email-change-confirmation` | `email-change-confirmation` | 2 etapas |
| `email.email-change-notice` | `email-change-notice` | Enviado aos 2 endereços |
| `auth.staff-invitation` | `staff-invitation` | |
| `email.purchase-confirmed` | `purchase-confirmed` | CTA "Confirmar e-mail" ou "Acessar Curso", decidido na 1ª entrega; ledger `purchase_confirmation_intents` |
| `email.access-released` | `access-released` | v1 histórico |
| `email.access-expiry-warning` | `access-expiry-warning` | 7d e 1d; payload v2 com geração `expectedExpiresAt` |
| `email.certificate-issued` | `certificate-issued` | Só depois de `certificate.render` |
| `email.course-sales-opened` | `course-sales-opened` | Um por `CourseInterest` |
| `email.support-request` | `support-request` | `replyTo` = e-mail do aluno; 3 a cada 10 min |

Também passam pela outbox `certificate.render` e `payments.checkout-cancel` (fechar vendas
cancela checkouts ativos).

### 6.3 Resend Hosted Templates versus React Email [V]/[Doc]

- **10 aliases Hosted publicados** em um catálogo único, compartilhado por
  Dev/Staging/Prod (`docs/integrations/resend-templates.md:66-79`).
- O checker somente leitura `bun run check:resend-templates` usa a chave administrativa só no
  shell e verifica status `published`, variáveis e envelope.
- **Porém `@react-email/components` continua em uso [V]:** `sendTransactionalEmail` chama
  `render(react)` (`src/features/email/server.ts:2,125`), e o e-mail de verificação usa o
  componente local `EmailVerificationEmail` (`:178-186`; `docs/integrations/resend.md:120-130`).
  É um **modelo híbrido**, que a vNext proíbe ("sem React Email concorrente").

### 6.4 Expiração (supersede-expiry-warning-v1) [Doc]

- **Incidente F-004** (audit 2026-08-23): o aviso de expiração podia entregar uma geração
  obsoleta.
- Correção: payload v2 com a validade exata como geração. O delivery relê a Matrícula e
  termina `superseded` quando houve `changed`, `inactive`, `expired` ou `wrong_window`.
- O script `ops:supersede:expiry-warning-v1` (dry-run, depois execute com confirmação literal)
  limpou as mensagens v1 pendentes antes de religar os jobs
  (`outbox-and-transactional-effects.md:205-237`).

### 6.5 Lifecycle, bounce e complaint [Doc]

- `email_messages` guarda `sending`, `acceptance_unknown`, `accepted`, `delayed`,
  `delivered`, `failed`, `suppressed`, `bounced` e `complained`. A chave de idempotência do
  Resend tem janela de 23 h; o fingerprint é um HMAC do request (`resend.md:91-118`).
- Webhook `/api/webhooks/resend` verificado por **Svix**, com inbox mínima (sem corpo nem
  destinatário) e processamento pelo cron a cada 30 min.
- **Bounce e complaint não alteram Conta, Matrícula nem Pedido e não disparam ação
  automática**: o Admin é encaminhado ao painel Resend (ADR-0013).

### 6.6 DMARC [Doc]

- Registro `p=none; pct=100; rua=…; adkim=r; aspf=r` desde 2026-08-29; a progressão foi
  **adiada** por decisão do responsável (`docs/operations/dmarc-rollout.md:16-49`).
- Analisador local `ops:analyze:dmarc` com proteção contra zip bomb, `DOCTYPE` e `ENTITY`.
- O envio é feito pelo **domínio raiz** `neurocapacitar.com.br`, não por subdomínio; o risco de
  reputação foi aceito (`resend.md:36-55`).

### 6.7 Marketing e consentimento [V]

- **Não existe.** Não há ocorrência de `unsubscribe`, `marketing`, `consentimento` ou `opt-in`
  em `src`.
- `email.course-sales-opened` vai para quem registrou interesse autenticado, **sem opt-out
  nem link de descadastro**.
- Development e Staging usam allowlist de destinatários (DEC-DISC-016).

---

## 7. Segurança

| Tema | Estado | Evidência |
|---|---|---|
| CSRF | Better Auth: `trustedOrigins` + cookies padrão. Server Actions: proteção de origem do Next. Route Handlers próprios: **checagem de `Origin` ad hoc**, só em alguns (por exemplo, avatar `hasTrustedOrigin`, `src/app/api/account/avatar/route.ts:31-41,82`). Não há guard central nem checagem de `Content-Type` nos JSON públicos. | [V] |
| Headers | `next.config.ts:55-80`: Permissions-Policy, Referrer-Policy, HSTS (prod), `nosniff`, `X-Frame-Options`. | [V] |
| CSP | `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` fora de prod), `img-src https:`, `frame-src` JMVStream, `frame-ancestors 'none'` (`src/lib/content-security-policy.ts:15-30`). O plano de CSP bloqueante com nonce não foi concluído (`plans/004…:167`). | [V] |
| Rate limit | Todo em PostgreSQL com chaves HMAC, conforme a tabela abaixo. | [V]/[Doc] |
| IP do cliente | `CLIENT_IP_SOURCE = x-forwarded-for` (última entrada) ou `cloudflare` (`cf-connecting-ip`); IP desconhecido em prod **falha fechado** (`src/lib/client-ip.ts`). | [V] |
| Validação | Zod em só cerca de 10 módulos (env, inputs de conta, staff, certificados). O resto usa parsers manuais. Corpo JSON público limitado a 4 KiB (`request-body-limits.ts:54`). | [V] |
| Uploads | Multipart limitado por bytes reais e timeout. PUT presigned create-only (`If-None-Match`) com confirmação HEAD (PR #245). Proveniência de assets validada (PR #248). | [Doc] |
| PII em logs e Sentry | `logOperationalEvent` sanitiza atributos (`observability.ts:49-60`). Sentry com `sendDefaultPii:false` e `beforeSend*` sanitizers (`sentry-options.ts:164-185`). PRs #128, #129 e #191 removeram PII implícita e dados aninhados do usuário. | [V]/[Doc] |
| Segredos | `BETTER_AUTH_SECRET` é **reutilizado como chave HMAC** do rate limit do auth, do rate limit do checkout, do fingerprint do Resend e da idempotência da ativação (`better-auth-rate-limit-storage.ts:6-10`; `asaas.md:307-309`; `resend.md:100-101`). | [V]/[Doc] |
| Bootstrap Admin | Só fora de prod; `Bearer INTERNAL_BOOTSTRAP_SECRET`; 404 em prod (`auth-policy.ts:287-315`). | [V] |
| Return-to | Allowlist estrita: só `/comprar/<slug>`, sem `?`, `#`, `%`, `\` ou controles, até 256 caracteres (`src/lib/auth-return-to.ts`). | [V] |
| RLS | Não usado; avaliado como aceitável para single-tenant com acesso só pelo backend (audit 2026-08-23 `:432-437`). | [Doc] |

Rate limits existentes [Doc] (`docs/reviews/2026-10-03-rate-limits-project-audit.md:104-112`):

| Superfície | Limite |
|---|---|
| Cadastro e desafios de e-mail | 3 por identidade e 10 por IP, por hora |
| Reset de senha | 3 por e-mail, 10 por IP e 10 por token, por hora |
| Checkout público | 5 por IP+Curso a cada 10 min |
| Certificado público | 20 por IP por minuto |
| Formulário de suporte | 3 por usuário a cada 10 min (advisory lock) |
| Better Auth | regras do framework, com storage em PG |

Lacunas apontadas [Doc]: comentários, progresso de vídeo e interesse não têm orçamento de
frequência. A borda (Cloudflare WAF) foi recomendada mas **não aplicada**, porque o DNS está
na Hostinger e não há proxy.

---

## 8. Operações manuais, scripts e o que indicam

| Script | O que faz | Indício |
|---|---|---|
| `db:cleanup:production` (`scripts/cleanup-production-test-data.ts`, `src/db/production-cleanup.ts`) | Trunca cerca de 40 tabelas operacionais preservando `users`, `accounts`, `profiles` e `sessions`. Exige journal em `0043`. | Limpeza única de dados de teste antes do go-live do Asaas, que "pressupõe a limpeza dos Pedidos de teste" (`asaas.md:76-80`). Production nasceu com dados de teste misturados. |
| `ops:reconcile:legacy-purchase-confirmations` (`src/tooling/purchase-confirmation-cutover`) | Corte das mensagens v1 (`auth.account-activation`, `email.access-released`) para `email.purchase-confirmed`, sem reenviar quando houve aceite ou o resultado é ambíguo. | Mudança de contrato de e-mail com mensagens em voo; risco de **e-mail duplicado ou ausente** gerido manualmente. |
| `ops:supersede:expiry-warning-v1` | Supersede de avisos v1. | Bug F-004 de geração obsoleta. |
| `ops:audit:buyer-identities` (`identity-collision-audit.ts`) | Auditoria somente leitura de colisões pela identidade canônica; o modo detalhado exige `IDENTITY_AUDIT_CONFIRMATION=read-only`. | Risco de contas duplicadas criadas por compras guest-first antes da canonicalização. |
| `db:preflight:google-identities` | Detecta duplicidades `(provider_id, account_id)` e colisões canônicas antes da migration de índice único. | A falta de unique constraint permitia corrida no linking. |
| Diagnósticos temporários Asaas e R2 (PRs #75, #78, #80–#84) | Sondas em CI para estado da conta e credenciais. | Dificuldade de verificar a configuração real de Production sem acesso direto. |
| Série de cerca de 25 PRs de backup (#86–#121) | Endurecimento de `pg_dump` e TLS em Neon PG18. | Operação de backup/restore cara e frágil. |

O PR #262 ("configurar identidade do merge de reconciliação") e o #263 são ajustes no workflow
de release, não incidentes financeiros.

---

## 9. Issues e PRs

- **Issues:** `gh issue list --state all --limit 100` retornou vazio; o rastreio é feito em
  documentos e PRs.
- **PRs relevantes (264 no total):**
  - Pagamentos: #18–#21 (contenção e migração Asaas), #26 (juros por parcela, **pausado**),
    #27 ("launch with seller-absorbed Asaas checkout"), #38–#41 (`imageBase64` obrigatório e
    rasterizado), #73 (checkout URLs obsoletas após troca de conta), #208 (handoff automático).
  - Auth: #202 (recuperação terminal), #241 (Google sign-in + signup explícito; migrations
    0095/0096), #243 (onboarding verificado, convites, perfil e a corrida que apagava a senha
    no reembolso; migration 0103).
  - Segurança: #128/#129/#191 (PII no Sentry), #140 (limite do corpo Resend), #146 (sanitizar
    iframe de vídeo e entidades XML), #231 (grants granulares de Suporte), #245 (moderação
    Admin-only, bloqueio de liberação com outra Revisão pendente, PUT create-only), #248
    (ownership de assets), #250 (rate limit compartilhado do Better Auth).
  - Custo: #257 reduziu os workers de 4 para 2 execuções por hora para cortar custo de
    Function na Vercel.
  - Dependências: vários bumps fechados sem merge (TypeScript 7.0.2, vitest 5, react-table 9).
    Revisões automáticas (CodeRabbit) estavam frequentemente indisponíveis.
- **Dores recorrentes [Inf]:**
  1. Integração de pagamento e troca de conta/gateway: dois gateways e duas contas Asaas em
     dois meses.
  2. Corte de contratos de e-mail com mensagens em voo (v1 para v2).
  3. Identidade da compradora guest-first: normalização, colisões e linking com o Google.
  4. Release e backup na Vercel + Neon: dezenas de PRs de CI e backup.
  5. Divergência entre documentação e código, admitida em várias revisões.

---

## 10. Regras implícitas e edge cases cobertos por testes

| Arquivo | O que cobre |
|---|---|
| `src/features/payments/asaas-financial-events.test.ts` | PIX só em RECEIVED com valor exato; cartão só em CONFIRMED; risco pendente nunca concede; risco reprovado vira Revisão; risco tardio não revoga; refund e chargeback revogam; pagamento tardio após estado adverso vira Revisão; checkout cancelado ou expirado tardio não revoga; IDs locais conflitantes não escolhem Pedido; evento desconhecido gera alerta sem efeito; decimal convertido para centavos exatos; captura recusada sem acesso; revogação sem o agregado de parcelas. |
| `asaas-webhook-processor.test.ts` (2.147 linhas), `asaas-webhook-worker(.integration).test.ts` | Lock do Pedido, CAS, retries, stale lock, 5ª tentativa terminal, PG real. |
| `src/features/payments/order-identity.test.ts` | Vincula Student existente sem sobrescrever; índice canônico do Gmail; cria Student não verificado; rejeita bloqueio de plataforma; rejeita Matrícula revogada no Curso (permite em outro); corrida de e-mail falha fechado; retry CAS idêntico; CAS divergente rejeitado; duplicidades legadas falham fechado. |
| `refunds.test.ts` | Token e auditoria na mesma transação; limite de senha; reserva única e uma mutação; parcelamento pelo endpoint agregado; `externalReference=null` com sessão exata; resposta de outro pagamento vira `uncertain`; webhook que vence a corrida com resposta ou timeout. |
| `payment-reviews.test.ts` | Só `amount_mismatch` aceita decisão; motivo obrigatório; outra Revisão pendente bloqueia a aprovação. |
| `public-checkout.test.ts`, `checkout.test.ts`, `checkout-recovery.test.ts` | Checkout anônimo sem PII; chave HMAC; janela coordenada; `Retry-After`; reuso do UUID. |
| `reconciliation.test.ts` (1.186 linhas) | Conciliação por pagamento e extrato com cursor. |
| `src/features/enrollments/rules.test.ts` | Janela de 12 meses; renovação a partir da validade atual; extensão de expirado a partir de agora; avisos 7d/1d sem duplicata; liberação agendada e âncora preservada; perda total reinicia. |
| `free-enrollment.test.ts` / `.integration` | No-op com concessão ativa; reativação da mesma linha expirada; Matrícula revogada bloqueia; fora da infraestrutura paga. |
| `src/features/account/email-challenges.test.ts` | Signup pendente só com IDs; conta verificada é suprimida; Staff nunca é reivindicada pelo signup público; IP desconhecido em prod falha fechado; consumo por POST atômico; replay; reivindicação apaga credencial e sessões pré-prova; prova de compra. |
| `src/features/admin/staff-invitations.test.ts`, `staff-role-transition.integration.test.ts` | Convite com outbox sem token nem e-mail; aceite sem sessão; Student bloqueado não é promovido. |
| `src/lib/auth-policy.test.ts`, `mfa-removal-contract.test.ts`, `password-policy.test.ts`, `google-oauth-flow.test.ts`, `better-auth-rate-limit-storage.test.ts`, `auth-return-to.test.ts`, `client-ip.test.ts` | Políticas de auth. |
| `src/features/outbox/*.test.ts`, `expiry-warning.integration.test.ts`, `src/features/email-delivery/lifecycle.integration.test.ts` | Fencing, superseded, gerações e lifecycle Resend. |
| `tests/e2e/critical-journeys.spec.ts` (1.541 linhas) | Handoff com um checkout e ativação; compra autenticada; remontagem que reusa o UUID; bloqueio antes da cobrança; colisão anônima abre Revisão; login e recuperação sem enumeração; signup verifica antes de criar a conta; gratuito com handoff; reembolso exige senha e confirmação destrutiva; fronteira Admin/Suporte/Student. |

Regras implícitas relevantes [Inf]:

- Compradora = Aluno; não há compra para terceiros nem presente.
- Uma Conta de equipe (Admin/Suporte) **não pode comprar**.
- Matrícula revogada no Curso impede recompra (a compra é forçada para Revisão e reembolso).
- Fechar vendas cancela checkouts ativos; um pagamento confirmado depois disso ainda concede.
- Curso "Em breve" coleta interesse autenticado.
- Taxas são sempre absorvidas pela vendedora.
- A conta criada por compra **não é verificada** pelo pagamento (`advisor-plans/email-verification-purchase-proof-2026-09-27.md`).

---

## 11. Divergências e contradições encontradas

1. **Revogação de sessão no reset.** `AUTH_PASSWORD_POLICY.revokeSessionsOnPasswordReset: true`
   (`src/lib/password-policy.ts:8`) contradiz `docs/domain/account-profile-and-access.md`
   ("A configuração atual não revoga a sessão existente no reset; a tela do Pedido permanece
   autenticada na outra aba"). Fluxo de reembolso para conta sem senha possivelmente quebrado
   [Inf].
2. **Financeiro Admin-only versus delegável.** ADR-0005 e `asaas.md:579-583` dizem que
   `manageFinancialReviews` e `manageFinancialOperations` são exclusivos de Admin; ADR-0017 e o
   código os tornam delegáveis a Suporte (`auth-policy.ts:120-136`). A própria revisão de
   métricas registra que o "guia de comércio" está desatualizado.
3. **Retenção do PDF de certificado revogado.** O legado declara 60 dias no aviso de
   privacidade; a vNext aprovou 90 dias, pendente de validação jurídica.
4. **"Sem React Email".** O catálogo Hosted é a fonte declarada, mas a verificação de e-mail
   ainda usa React Email local.
5. **Matriz de autorização testada por string.** Os testes de contrato leem o código-fonte em
   vez de chamar a API.

---

## 12. Lições para a vNext

### 12.1 Manter (validado pelo legado)

- **Precedência financeira do ADR-0005, inteira:**
  - `CHECKOUT_PAID` não concede; PIX em `RECEIVED`; cartão em `CONFIRMED` sem risco
    pendente ou reprovado; adversos prevalecem;
  - pagamento tardio não reativa; cancelamento tardio não revoga; status do provedor só
    avança;
  - tolerância de valor zero em centavos;
  - Revisão bloqueia a concessão, não a revogação;
  - a decisão é uma **função pura** (`decideAsaasFinancialEvent`) testada isoladamente e
    reutilizada pela conciliação.
- **Inbox persist-before-200** com unique `(provider, event_key)`, persistência de eventos
  desconhecidos, retenção e sanitização do payload. Processamento em duas fases, **HTTP fora
  da transação** e `lockOrder` no Pedido.
- **Correlação exata**, nunca por aproximação: `externalReference` opaco + `checkoutSession` +
  `payment.id`/`installment.id`. Aceitar `externalReference=null` só com sessão exata (fato do
  Sandbox).
- **Parcelamento:** agregado `installment.id`, consulta ao agregado antes de decidir,
  reembolso pelo endpoint de installment e soma exata das evidências por parcela. Preço único
  com taxas absorvidas e piso de R$ 10 por parcela.
- **RefundRequest durável** com estados `processing/failed/uncertain/confirmed`, sem repetição
  cega, step-up recente e motivo.
- **Entitlement como ledger e Enrollment como projeção**, com origens explícitas
  (`paid_order`, `manual`, `free_enrollment`) e CHECK de forma. Expiração validada por request
  **e** materializada por job. Gratuito sem Order nem Asaas.
- **Outbox** com payload só de IDs, token gerado no delivery, chave idempotente versionada,
  estado `superseded` distinto de falha e "gerações" para mensagens dependentes de estado (aviso
  de expiração).
- **Identidade:**
  - signup sem senha antes da prova da caixa, consumo por `POST` explícito e token no fragmento;
  - linking Google só com prova local e claim verificado, sem `trustedProviders` nem
    `requireLocalEmailVerified:false`, com `sub` como identidade e unique
    `(provider_id, account_id)`;
  - linking não altera nome, e-mail nem papel;
  - reset neutro e anti-enumeração;
  - mudança de papel revoga sessões; mudança de grant vale na próxima leitura.
- **Allowlist estrita de return-to** e de host de redirect do checkout.
- **Rate limits atômicos com chave HMAC**, sem IP nem e-mail em claro, falhando fechado sem IP
  confiável.
- Lifecycle Resend separado da "entrega" da outbox, com webhook Svix e inbox mínima.

### 12.2 Retirar (não reproduzir)

- **Checkout guest-first e tudo o que ele exige:**
  - enriquecimento de cliente pós-pagamento (`asaas-customer-enrichment`);
  - criação de conta por pagamento e `resolveLocalOrderIdentity`;
  - Revisão `buyer_identity` e fluxo "reembolsar para corrigir identidade";
  - desafio `purchase_verification` com CTA decidido na entrega;
  - auditoria de colisões de compradora.
  
  Na vNext a identidade é autenticada e verificada antes do Asaas, o que elimina uma classe
  inteira de complexidade e incidentes.
- **React Email concorrente** (`render(react)` em `src/features/email/server.ts`). Todo envio
  deve usar Hosted Template.
- **Leitura direta de `accounts.password` e uso de `verifications` do Better Auth** para o
  step-up do reembolso. Usar a re-autenticação ou sessão fresca suportada pelo Better Auth, ou
  uma tabela própria; nunca as tabelas internas.
- **Arrays `text[]` com CHECK gigante** para grants, e **papel único exclusivo**, que obriga o
  Student promovido a perder a área de aluno (ADR-0017). A vNext usa papéis não exclusivos e
  grants normalizados.
- Testes de autorização por **string match no código-fonte**.
- Tabelas e colunas mortas trazidas por migration (`two_factors`, `profiles.phone` sem uso,
  `reversed_adjustment_id`): não criar campos sem uso.
- Dependência opcional de `@better-auth/infra` (Dash/Sentinel) **sem confirmação de que está
  ativa**. Se a vNext quiser algo assim, deve ser decisão explícita (custo, terceiro e
  privacidade).
- Crons a cada 30 minutos como mecanismo principal de processamento: na vNext usar Queues +
  reconciler.

### 12.3 Simplificar

- `orders` com cerca de 40 colunas vira **Order** (contrato e snapshot), **CheckoutSession**
  (tentativa, URL, expiração e estado do link) e **Payment** (IDs, método, status do provedor,
  bruto, líquido, tarifa e datas).
- A identidade de e-mail canônica ficou opinativa (remove pontos e `+tag` em 12 provedores;
  `0097…sql:20-27`). Com checkout autenticado, a vNext talvez precise só de
  `lower(trim(email))` unique + linking verificado. **Decidir explicitamente** em vez de
  herdar: a regra existe por causa do Sentinel e do guest-first.
- A troca de e-mail com dupla prova e ordem de advisory locks (`identity-and-authorization.md:142-189`)
  é complexa. Avaliar se a v1 precisa dela ou se basta um fluxo mais simples (prova do novo
  endereço + aviso ao antigo + revogação de sessões).
- Múltiplos tópicos v1/v2 e scripts de corte: começar com contratos versionados desde o
  início e evitar renomear tópicos.
- Separar chaves HMAC por finalidade (rate limit, fingerprint de e-mail, tokens de desafio e
  idempotência), em vez de reutilizar `BETTER_AUTH_SECRET`.

### 12.4 Adicionar (lacunas do legado)

- **Contrato explícito de sessão** (7 dias rolling, `updateAge`, `freshAge`, cookie cache
  off/on) com teste, em vez de default implícito.
- **Middleware Hono central** de autenticação, CSRF (Origin + `Content-Type` + Fetch Metadata) e
  capability deny-by-default para **todas** as rotas mutáveis. O legado só tem checagens ad hoc.
- **CSP sem `'unsafe-inline'`**, com nonce ou hash. Com SPA + Vite isso é mais viável que no
  Next.
- **Testes de acesso cruzado reais pela API** (Suporte sem grant, Student em rota admin,
  usuário A no recurso de B) para cada endpoint mutável.
- **"≥1 Admin ativo"** contando também bloqueio e desativação de Admin, sob lock.
- **Rate limit no Workers:** binding de Rate Limiting/Durable Object/KV ou PG, coordenado entre
  isolates. A lição do legado é que o storage em memória **não** funciona em serverless.
  Separar limite de borda (WAF) de quota de negócio.
- **Defesa em profundidade no webhook Asaas:** o token estático é a única autenticação.
  Considerar **reconsultar o pagamento na API** (`GET /v3/payments/{id}`) antes de conceder,
  ou deixar a concessão no reconciler. Limitar por IP de borda sem descartar reentregas.
- **Timeout ou reconciliação para `CheckoutSession` em `creating` ou `uncertain`**
  (gap documentado).
- **Correlação do checkout autenticado pelo `externalReference`/sessão para o `user_id`, nunca
  pelo e-mail do cliente Asaas.** Sem `customerData` (exige CPF), o comprador digita dados no
  Asaas que **podem divergir** do e-mail da Conta.
- **Exclusão de conta, exportação de dados e canal LGPD** com política jurídica, e um aviso de
  privacidade completo (controlador, bases legais, operadores: Asaas, Resend, Google,
  Cloudflare, Neon e Sentry). O legado removeu o workflow por falta de demanda.
- **Marketing com consentimento independente**, descadastro (`List-Unsubscribe`) e supressão.
  O legado envia `course-sales-opened` sem opt-out.
- **Política de bounce, complaint e supressão** com efeito no produto (por exemplo, marcar o
  endereço como não entregável e pedir atualização), não só no painel.
- **KPIs financeiros com semântica única** desde o início: vendas confirmadas por evidência
  histórica; estornos e disputas como movimentos separados; potencial ≠ recebível; líquido
  marcado como incompleto quando há reembolso parcial pendente.
- Decisão sobre **CPF e NFS-e** se houver obrigação fiscal; o legado não coleta CPF nem emite
  nota.
- Passkeys opcionais (no escopo da vNext; inexistentes no legado).

### 12.5 Riscos para a vNext

1. **E-mail do pagador ≠ e-mail da Conta** no Checkout hospedado sem `customerData`. Exige
   correlação por referência e sessão e uma regra explícita sobre qual e-mail recebe os avisos
   do Asaas.
2. **`Payment.externalReference=null`** nos pagamentos gerados por Checkout (evidência
   Sandbox). Qualquer reconciliador que dependa só de `externalReference` falha.
3. **Eventos de risco do cartão nunca foram observados no Sandbox** (`asaas.md:735-737`). O
   ramo é coberto só por testes, com risco de comportamento real diferente.
4. **Mínimos e configuração da conta Asaas** (mínimo por parcela) afetam as opções exibidas; o
   piso interno deve ser ≥ ao da conta.
5. **Troca de conta Asaas** invalida URLs persistidas no cliente. Versionar o storage local e
   tratar sessões antigas como expiradas.
6. **Quota Asaas** de 25 mil requisições por 12 h e 50 GETs concorrentes é por conta. No
   Workers, uma fila intraprocesso não coordena nada; usar a concorrência da Queue.
7. **O Better Auth muda rápido** (1.6.25 → 1.7.6 em cerca de 10 dias; advisory de linking em
   versões < 1.6.11). Fixar a versão e testar o linking e o gate social de verificação na versão
   instalada.
8. **Reputação do domínio raiz** no Resend e DMARC ainda em `p=none`.
9. **Dados de teste em Production:** o legado precisou de um script de limpeza no go-live. Na
   vNext, isolar Sandbox e Production desde o primeiro dia.
10. **Divergência entre documentação e código** foi recorrente (§11). Manter a documentação
    canônica mínima e testes como fonte de verdade.
11. **Custo:** a Vercel forçou a redução da cadência dos workers (PR #257). Na vNext, medir as
    invocações de Queue/Cron e as conexões Hyperdrive.

---

## Apêndice — Índice rápido de evidências

- Auth: `src/lib/auth.ts`, `src/lib/auth-policy.ts`, `src/lib/password-policy.ts`,
  `src/lib/better-auth-rate-limit-storage.ts`, `src/lib/session.ts`, `src/lib/email-identity.ts`,
  `src/app/api/auth/[...all]/route.ts`, `src/db/migrations/0097_identity_email_challenges.sql`,
  `src/lib/mfa-removal-contract.test.ts`.
- RBAC: `src/lib/auth-permissions.ts`, `src/features/admin/staff-actions.ts`,
  `docs/adr/0001-custom-rbac.md`, `docs/adr/0017-support-granular-permissions.md`,
  `docs/domain/identity-and-authorization.md`.
- Acesso: `src/db/schema.ts:835-995`, `src/features/enrollments/access.ts`,
  `docs/adr/0004-…`, `docs/adr/0016-…`, `docs/domain/commerce-and-access.md`.
- Financeiro: `src/features/payments/*`, `src/app/api/webhooks/asaas/route.ts`,
  `docs/integrations/asaas.md`, `docs/adr/0005-…`, `docs/decisions.md` (DEC-DISC-002/003/007/010/011),
  `docs/reviews/2026-07-30-asaas-*.md`, `docs/reviews/2026-08-03-asaas-installment-interest-research.md`,
  `advisor-plans/finance-system-metrics-review-2026-09-26.md`,
  `advisor-plans/open-checkout-vs-receivable-kpi-research-2026-09-26.md`,
  `advisor-plans/email-verification-purchase-proof-2026-09-27.md`.
- Comunicação: `src/features/outbox/*`, `src/features/email/server.ts`,
  `docs/operations/outbox-and-transactional-effects.md`, `docs/integrations/resend*.md`,
  `docs/operations/dmarc-rollout.md`.
- Segurança: `src/lib/content-security-policy.ts`, `next.config.ts`, `src/lib/client-ip.ts`,
  `docs/reviews/2026-10-03-rate-limits-project-audit.md`,
  `docs/reviews/2026-08-23-production-readiness-audit.md`,
  `plans/004-security-and-public-boundaries.md`.
- Operação: `vercel.json`, `scripts/*.ts`, PRs #26, #73, #75, #241, #243, #245, #248, #250, #257.
