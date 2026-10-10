# Ambientes, credenciais e releases — contrato inicial

**Estado:** procedimento aprovado, ainda não executado. Detalhes e justificativas: [segurança e operação](../spec/security-operations.md), [ADR 0003](../adr/0003-teto-de-custo-free-tier-first.md), [ADR 0005](../adr/0005-banco-neon-free-hyperdrive-drizzle.md), [ADR 0021](../adr/0021-repositorio-github-free-ci-duas-camadas.md), [ADR 0023](../adr/0023-observabilidade-backup-operacao.md).

| Superfície | Development | Staging | Production |
|---|---|---|---|
| Runtime | local (workerd) | Worker dedicado | Worker dedicado |
| PostgreSQL | PG18 local ou projeto Neon Free próprio | projeto Neon Free | projeto Neon Free (região São Paulo se o plano permitir) |
| R2 | recursos de teste | buckets e chaves separados | buckets e chaves separados |
| Queues | simuladas | `hub-finance` e `hub-general` + DLQs | `hub-finance` e `hub-general` + DLQs |
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

## Catálogo de variáveis e segredos (somente nomes e responsável)

**Nomes propostos, ainda não criados.** Cada um nasce na tarefa que o usa, que confirma o nome. Valores nunca entram no repositório, em logs, em artefatos nem no CI comum. `vars` do `wrangler.jsonc` só para valores públicos e não sensíveis; o preflight (`bun run preflight <ambiente>`) rejeita `vars` fora da lista de `scripts/environments.ts`.

| Nome (proposto) | Onde vive | Dono | Tarefa |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Worker Secret, por ambiente | responsável | M1-01 |
| `TURNSTILE_SECRET_KEY` | Worker Secret, por ambiente | responsável (conta Cloudflare do projeto) | M1-06 |
| `RESEND_API_KEY` | Worker Secret, por ambiente (Production fora do CI comum) | responsável | M4-04 |
| `RESEND_WEBHOOK_SECRET` | Worker Secret, por ambiente | responsável | M4-07 |
| `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` | Worker Secret; sandbox em Staging, conta real só em Production | cliente (conta Asaas) | M6-02, M6-03 |
| `VIDEO_SECRETS_MASTER_KEY` | Worker Secret, por ambiente (chave de cifra AES-GCM das credenciais de vídeo) | responsável | M5-01 |
| `SENTRY_DSN` | `vars` (não é segredo) | responsável | M0-18 |
| `DATABASE_URL_MIGRATION` (conexão direta, role de migração) | **fora do Worker**: máquina do responsável ou CI de Staging; Production só manual | responsável | M0-04 |
| Binding Hyperdrive (`HYPERDRIVE`), R2, filas | `wrangler.jsonc` por ambiente (IDs e nomes não são segredos) | responsável | M0-04, M4, M5 |
| `CLOUDFLARE_API_TOKEN` (CI de Staging) | segredo do GitHub, escopo mínimo, **só conta do projeto**; nunca de Production | responsável | M0-05 |
| Chave privada `age` do backup | fora de GitHub, Worker e R2 | responsável | M9-05 |

Regras de ambiente: um Worker por ambiente (`hub`, `hub-staging`, `hub-production`), cada um com seus próprios recursos; a tabela de recursos permitidos por ambiente fica em `scripts/environments.ts` e o build (`bun run build:staging` ou `build:production`) só termina se o preflight aprovar.
