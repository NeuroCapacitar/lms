# Ambientes, credenciais e releases — contrato inicial

**Estado:** procedimento aprovado, ainda não executado. Detalhes e justificativas: [segurança e operação](../spec/security-operations.md), [ADR 0003](../adr/0003-teto-de-custo-free-tier-first.md), [ADR 0005](../adr/0005-banco-neon-free-hyperdrive-drizzle.md), [ADR 0021](../adr/0021-repositorio-github-free-ci-duas-camadas.md), [ADR 0023](../adr/0023-observabilidade-backup-operacao.md).

| Superfície | Development | Staging | Production |
|---|---|---|---|
| Runtime | local (workerd) | Worker dedicado | Worker dedicado |
| PostgreSQL | PG18 local ou projeto Neon Free próprio | projeto Neon Free | projeto Neon Free (região São Paulo se o plano permitir) |
| R2 | recursos de teste | buckets e chaves separados | buckets e chaves separados |
| Queues | simuladas (`hub-finance`, `hub-general`) | `hub-staging-finance` e `hub-staging-general` + DLQs `…-dlq` | `hub-production-finance` e `hub-production-general` + DLQs `…-dlq` |
| Providers | fake ou sandbox | sandbox/teste | live somente após o Go/No-Go |
| Segredos | locais, nunca commitados | escopo Staging | fora do CI comum do GitHub |
| Dados | sintéticos | sintéticos | reais |

- **Custo:** o único custo certo é o Workers Paid (US$ 5/mês); teto de infraestrutura US$ 10/mês. Nenhum plano pago extra sem decisão explícita.
- **GitHub:** Free privado, sem branch protection nem environments garantidos. Staging pode ser publicado por um token limitado; Production exige processo manual fora do workflow comum e comprovação do SHA homologado.
- **Build:** `CLOUDFLARE_ENV` precisa ser selecionado **no build** do Vite Plugin. Todo ambiente tem preflight (bindings, Hyperdrive, R2, filas, DNS, segredos, providers).
- **Banco:** SQL versionado, forward-only, expand/contract, conexão direta ao Neon (nunca pelo Hyperdrive); **sem `drizzle-kit push` e sem reset remoto genérico** em Staging ou Production. Hyperdrive com cache de query desligado.
- **Backups:** `pg_dump` cifrado com `age` no R2 privado, diário e antes de cada release, mais cópia semanal fora da Cloudflare; ensaio de restauração semestral e antes do Go-Live. Nunca restaurar e liberar efeitos externos sem conciliar pagamentos, revogações e exclusões posteriores.
- **Legado:** continua em `app.neurocapacitar.com.br` até o cutover; congelado (só segurança, legal e bloqueio de venda). O DNS só muda no M10; depois da primeira operação nova, voltar o DNS ao legado **não** é rollback seguro.
- **Não publicar** a vNext incompleta a alunos reais. O Go/No-Go do M10 exige QA, segurança, auth, financeiro, certificados, PWA, backups e smoke tests.

## Contas e CLIs: só o perfil `neurocapacitar`

Cloudflare (`cf`, `wrangler`) e Neon (`neon`) só podem ser usados com o perfil **`neurocapacitar`** (`neurocapacitar.projetos@gmail.com`), sempre com `--profile neurocapacitar` explícito e identidade verificada antes do primeiro comando da sessão. Nenhum outro perfil da máquina (`DEFAULT`, `default`, `junior-pessoal`) pertence ao projeto. Regra completa, verificação e estado atual: [cli-profiles.md](cli-profiles.md) ([ADR 0025](../adr/0025-clis-cloudflare-neon-so-perfil-neurocapacitar.md)).

## Staging: publicação (M0-08)

- **Comando local:** `bun run deploy:staging` (com `VITE_SENTRY_DSN` no ambiente). Recusa árvore suja e commit que não esteja no GitHub, constrói com o preflight, publica com `--profile neurocapacitar` e imprime o SHA. Depois, `bun run smoke <url> <sha>` confere `live` e `ready` (consulta o Neon Staging) e que o `releaseId` é o SHA esperado.
- **Segredo do Worker:** `wrangler secret put SENTRY_DSN --name hub-staging --profile neurocapacitar` (o valor sai de `sentry dsn list neurocapacitar/hub-vnext-worker`).
- **CI (manual):** `.github/workflows/deploy-staging.yml` (`workflow_dispatch`, só em `main`/`staging`). **Ativo desde 2026-10-10:** o responsável criou os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`, e as variables `VITE_SENTRY_DSN` e `STAGING_URL` foram definidas com `gh variable set` (valores públicos). Primeira execução completa com sucesso no commit `1390e43`. O procedimento de criação, para referência: (1) no painel da Cloudflare, *My Profile > API Tokens > Create Token* na conta do projeto (`neurocapacitar.projetos@gmail.com`), com a permissão **Workers Scripts: Edit** (e **Workers Observability: Read**, se quiser consultar logs) e recurso limitado à conta do projeto; (2) no GitHub, *Settings > Secrets and variables > Actions*: secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`, variables `VITE_SENTRY_DSN` e `STAGING_URL`. **Limitação:** a permissão de editar Workers vale para a conta inteira, então o token de Staging **também poderia publicar** o Worker de Production; por isso nenhum token vai ao GitHub antes de existir Production, e o Production continua só manual (decisão a rever no M10).

## Catálogo de variáveis e segredos (somente nomes e responsável)

**Nomes propostos, ainda não criados.** Cada um nasce na tarefa que o usa, que confirma o nome. Valores nunca entram no repositório, em logs, em artefatos nem no CI comum. `vars` do `wrangler.jsonc` só para valores públicos e não sensíveis; o preflight (`bun run preflight <ambiente>`) rejeita `vars` fora da lista de `scripts/environments.ts`.

| Nome (proposto) | Onde vive | Dono | Tarefa |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Worker Secret, por ambiente (Development: `.env` local, ignorado pelo Git; Staging e Production: ainda não criado) | responsável | M1-01 |
| `APP_BASE_URL` | `vars` do `wrangler.jsonc` por ambiente (valor público; única origem confiável do Better Auth; Staging e Production só https sem localhost, conferido pelo preflight) | responsável | M1-01 |
| `TURNSTILE_SECRET_KEY` | Worker Secret, por ambiente (Development: `.env`, com a chave de teste da Cloudflare) | responsável (conta Cloudflare do projeto) | M1-06 |
| `VITE_TURNSTILE_SITE_KEY` | variável de build (chave pública do widget); ausente em build de produção = captcha indisponível | responsável | M1-06 |
| `EMAIL_FROM`, `RESEND_TEMPLATE_MAGIC_LINK`, `RESEND_TEMPLATE_REAUTH_LINK`, `RESEND_TEMPLATE_STAFF_INVITATION` | `vars` do `wrangler.jsonc` por ambiente (públicas). Hoje: remetente `NeuroCapacitar <acesso@neurocapacitar.com.br>` (domínio **já verificado** no Resend) e os IDs dos modelos publicados `vnext-magic-link`, `vnext-reauth-link` e `vnext-staff-invitation` (`63dee257-f261-4c40-b4f2-550596c5efcd`; o Gitleaks os ignora por `.gitleaks.toml`, só para `RESEND_TEMPLATE_*`) (`1b066eb8-2a71-4e41-94b7-15475b1e3d4d`; fonte do texto: `docs/operations/email-templates/`) | responsável | M1-06 |
| `RESEND_API_KEY` | Worker Secret por ambiente. Staging: chave `vnext-hub-staging`, **só envio**, restrita ao domínio, criada em 2026-10-10 (as chaves `hub-*` e `Vercel staging` são do legado) | responsável | M1-06 |
| `EMAIL_ALLOWLIST` | Worker Secret (Staging): destinatários permitidos, separados por vírgula; são e-mails de pessoas e não entram no repositório. Hoje `neurocapacitar.projetos@gmail.com` e os aliases de teste `neurocapacitar.projetos+aluna-m3@gmail.com` e `neurocapacitar.projetos+suporte-m3@gmail.com` (2026-10-12, jornada do M3-05; chegam à mesma caixa). Ausente = sem filtro | responsável | M1-06 |
| `RESEND_API_KEY` | Worker Secret, por ambiente (Production fora do CI comum) | responsável | M4-04 |
| `RESEND_WEBHOOK_SECRET` | Worker Secret, por ambiente. Staging: criado em 2026-10-13 com o endpoint `https://hub-staging.neurocapacitar-projetos.workers.dev/api/webhooks/resend` | responsável | M4-07 |
| `EMAIL_HASH_KEY` | Worker Secret, por ambiente (≥ 32 caracteres aleatórios; identifica o destinatário na supressão; trocá-la invalida as supressões). Staging: criado em 2026-10-13 | responsável | M4-07 |
| `SUPPORT_INBOX_EMAIL` | Worker Secret (destino do modelo `vnext-support-request`; endereço da equipe). Staging: `neurocapacitar.projetos@gmail.com` desde 2026-10-13 | responsável | M4-04 |
| `FINANCE_SECRETS_MASTER_KEY` | Worker Secret (formato do cofre: `1:<base64 de 32 bytes>`; versionada); cifra o CPF/CNPJ do pagador. Sem ela o documento NÃO é guardado | responsável pelo ambiente (nunca no banco nem em log) | M6-08 |
| `ASAAS_API_BASE_URL` | variável (opcional; padrão `https://api-sandbox.asaas.com`; Production usa a base real) | responsável pelo ambiente | M6-02 |
| `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` | Worker Secret; sandbox em Staging, conta real só em Production | cliente (conta Asaas) | M6-02, M6-03 |
| `VIDEO_SECRETS_MASTER_KEY` | Worker Secret, por ambiente (cofre das chaves AES-256-GCM das credenciais de vídeo). Formato `1:<base64 de 32 bytes>,2:<base64 de 32 bytes>`: a versão mais alta cifra, as outras só abrem. Gerar com `openssl rand -base64 32` por versão. **Perdida, as conexões precisam ser recadastradas**; guardar uma cópia fora do Cloudflare. Rotação: acrescentar a versão nova (mantendo a antiga), usar "Recifrar com a chave atual" na tela Vídeo e só então retirar a antiga. **Ainda não criada em nenhum ambiente** | responsável | M5-01 |
| `SENTRY_DSN` (Worker) | **Worker Secret** por ambiente (criado no Staging em 2026-10-10 com `wrangler secret put`); ausente = Sentry desligado | responsável | M0-08 |
| `VITE_SENTRY_DSN` (SPA) | variável de build (público por desenho do Sentry); no CI, variável do GitHub Actions; nunca no repositório | responsável | M0-08 |
| `DATABASE_URL_MIGRATION` (conexão direta, role de migração) | **fora do Worker**: máquina do responsável ou CI de Staging; Production só manual | responsável | M0-04 |
| Binding Hyperdrive (`HYPERDRIVE`), R2, filas | `wrangler.jsonc` por ambiente (IDs e nomes não são segredos) | responsável | M0-04, M4, M5 |
| `CLOUDFLARE_API_TOKEN` (CI de Staging) | segredo do GitHub, escopo mínimo, **só conta do projeto**; nunca de Production | responsável | M0-05 |
| Chave privada `age` do backup | fora de GitHub, Worker e R2 | responsável | M9-05 |

Regras de ambiente: um Worker por ambiente (`hub`, `hub-staging`, `hub-production`), cada um com seus próprios recursos; a tabela de recursos permitidos por ambiente fica em `scripts/environments.ts` e o build (`bun run build:staging` ou `build:production`) só termina se o preflight aprovar.

## Login com Google (M1-07)

- Segredos do Worker, por ambiente: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (`wrangler secret put … --env <ambiente> --profile neurocapacitar`). **Opcionais**: sem as duas o Google fica desligado (botão e rotas somem) e o resto funciona.
- No Google Cloud do cliente (**pendência do responsável/cliente**): cliente OAuth do tipo "Aplicativo da Web" com a origem do ambiente e o URI de redirecionamento `<APP_BASE_URL>/api/auth/callback/google` (Staging: o host `workers.dev`; o domínio definitivo entra no M10). Escopos `openid`, `email` e `profile`.
- O Google **só liga a uma conta existente** (depois de entrar por link) e exige e-mail verificado e igual; nunca cria conta. O login por senha exige **Workers Paid** (CPU do scrypt, ver ADR 0029); sem ele, só o link e o Google ficam viáveis em produção.
