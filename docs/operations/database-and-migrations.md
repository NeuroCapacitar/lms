# Banco de dados e migrações

**Estado:** procedimento vigente desde o M0-04 (2026-10-10). Decisões: [ADR 0005](../adr/0005-banco-neon-free-hyperdrive-drizzle.md) e [ADR 0027](../adr/0027-spike-m0-12-regiao-neon-e-orcamento-de-compute.md). Contas: só o perfil `neurocapacitar` ([cli-profiles](cli-profiles.md)).

## Recursos (criados em 2026-10-10)

| Ambiente | Projeto Neon (Free, PG 18, São Paulo) | Hyperdrive (cache desligado) | Worker |
|---|---|---|---|
| Development | `hub-development` | `hub-development` | `hub` (local, workerd) |
| Staging | `hub-staging` | `hub-staging` | `hub-staging` (deploy no M0-08) |
| Production | `hub-production` (**vazio**, sem migração e sem Worker) | `hub-production` | `hub-production` (nunca implantado antes do M10) |

IDs de Hyperdrive e hosts diretos estão em `scripts/environments.ts` (não são segredos). Os projetos `neuro-development` e `neurocapacitar-lms-ci*` pertencem ao legado: **não usar**.

## Roles

- **Migração (DDL):** `neondb_owner`, dono do banco, **só pela conexão direta e fora do Worker**. Nunca no Worker, em HTTP, Cron ou startup.
- **Runtime (só DML):** `hub_runtime`, sem `CREATE`, sem `ALTER`/`DROP`, sem acesso ao journal de migrações. É a role do Hyperdrive e do Worker. Criada por `bun run db:roles <ambiente>` (idempotente) com `HUB_RUNTIME_PASSWORD` do ambiente (mín. 32 caracteres, nunca impressa).

## Credenciais (nunca no repositório)

- **Runtime de desenvolvimento:** `.env` local (ignorado pelo Git), variável `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (ver `.env.example`). Sem ela o `bun run dev` não inicia, porque o binding Hyperdrive exige uma conexão local.
- **Migração:** não fica em arquivo. Obtenha na hora, com o perfil do projeto, e passe por variável de ambiente do comando:

```bash
DATABASE_URL_MIGRATION="$(neon connection-string --project-id <id> --pooled false --ssl require --role-name neondb_owner --profile neurocapacitar)" bun run db:migrate dev
```

`--role-name neondb_owner` é obrigatório (o projeto tem duas roles: a de migração e `hub_runtime`). Se o migrator tentar reaplicar uma migração antiga, compare o `created_at` do journal do banco (`drizzle.__drizzle_migrations`) com o `when` de `drizzle/meta/_journal.json` e o hash do SQL: o migrator só compara o carimbo (aconteceu no Staging em 2026-10-10; o SQL era idêntico e só o carimbo foi corrigido).

IDs dos projetos: `neon projects list --org-id <org> --profile neurocapacitar`. Os scripts **recusam** host de pooler (`-pooler`), host diferente do aprovado para o ambiente e, em Production, exigem `CONFIRM_MIGRATE_PRODUCTION=<host>` (execução manual do responsável, com backup e Go/No-Go).

## Fluxo de uma mudança de schema

1. Edite `src/db/schema.ts`.
2. `bun run db:generate` gera o SQL em `drizzle/`; **revise o SQL à mão** (índices, locks, valores padrão) antes do commit. Forward-only, expand/contract; nada de `drizzle-kit push` ou `migrate`.
3. `bun run db:drift` (também no CI) falha se o schema e as migrações divergirem.
4. `bun run db:migrate dev`, depois `test:db` (ver abaixo), depois Staging; Production só na release manual.
5. Arquivos gerados (`drizzle/`, `worker-configuration.d.ts`, `routeTree.gen.ts`) não são editados nem formatados à mão.

## Testes de integração do banco

`bun run test:db` (precisa de `DATABASE_URL_MIGRATION` e `DATABASE_URL_RUNTIME` do **dev**; sem elas os testes são pulados): migração aplicada duas vezes (a segunda é no-op), runtime recebe `permission denied` em `CREATE`/`ALTER`/`DROP`, não lê o journal e consegue DML.

## Regras do Hyperdrive

Cache de query **desligado** (confirmado por `wrangler hyperdrive get`); conexão direta; um cliente `pg` por requisição, fechado no fim (`src/db/client.ts`). **Proibidos:** advisory locks (`pg_advisory_lock`), `LISTEN/NOTIFY` e `PREPARE` em SQL. Fencing por lease em linha (`FOR UPDATE SKIP LOCKED`).

`GET /api/health/ready` faz `SELECT 1` e **acorda o Neon Free**: a proteção do endpoint (limite de taxa ou acesso restrito) é pendência do M4/M9.
