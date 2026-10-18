# ADR-0033 — M9-05 e M9-06: backup agendado no próprio repositório, retenção por ciclo de vida do R2, `backup_run`, alertas pelo Sentry e registro de incidentes no banco

- **Estado:** accepted (decididas pelo responsável em 2026-10-18, uma a uma, depois de eu detalhar as opções; o que está marcado "agente" foi escolhido por mim dentro dessas decisões)
- **Data:** 2026-10-18
- **Origem:** [evidência do M9-05](../review/evidencias/m9-05/README.md), [alertas e SLOs](../operations/alerts-and-slos.md) e a rodada de decisões do responsável
- **Substitui:** — (refina o §5 de [segurança e operação](../spec/security-operations.md), que propunha "repositório administrativo isolado, só se necessário", e a retenção "14 diários + 4 semanais"; refina a [ADR 0023](0023-observabilidade-backup-operacao.md); não contradiz nenhuma)

## Decisões do responsável

| # | Decisão | Observação |
| --- | --- | --- |
| A1 | O executor do backup é um **workflow no mesmo repositório do produto** (`.github/workflows/backup-staging.yml`) | recomendação contrária minha (repositório administrativo isolado) registrada abaixo |
| A2 | Retenção por **ciclo de vida do R2**: `daily/` 14 dias, `weekly/` 35 dias, `release/` 90 dias | o backup de `release/` deixa de ser "sem prazo": dado pessoal eliminado sai dos backups em até 90 dias |
| A3 | **Sem trava de bucket (bucket lock)** no início | pode ser reaberta só para `release/` |
| A4 | **Sem cópia fora da Cloudflare** no início | a Cloudflare é ponto único de falha para dados e backups; risco aceito |
| B1 | O Worker sabe do último backup por uma **tabela `backup_run`** gravada pelo executor | o Worker não toca o bucket de backup |
| B2 | Monitor de "site fora" pelo **Sentry** (Uptime Monitor e/ou Cron Monitor), a confirmar no plano | ver "Sentry" abaixo |
| B3 | Entrega ativa dos alertas pelo **Sentry** | com controle de repetição (feito no PR seguinte) |
| B4 | Registro de incidentes: o repositório administrativo não existe, então **uma tabela no banco** | feito no PR seguinte |
| B5 | Workers Logs mantidos em 100% (sem `head_sampling_rate`) | |

## O que foi feito neste PR

- **Workflow `backup-staging.yml`**: diário (03:17 UTC) e manual (`daily` ou `release`); `pg_dump -Fc` com cliente PG18, `age` com a chave **pública**, envio ao bucket `hub-staging-backups`, registro em `backup_run`, cópia para `weekly/` aos domingos. **Só Staging.**
- **Migration 0041 `backup_run`** (uma linha por backup enviado: objeto, SHA-256, tamanho, nº de migrations, versão do PG, instante) e os alertas **`backup_never`** (P2) e **`backup_stale`** (P1, mais de 26 h, pelo relógio do banco).
- **Role `hub_backup`** (`bun run db:roles:backup`): lê tudo (`pg_read_all_data`) e só tem **INSERT em `backup_run`**; sem UPDATE, sem DELETE, sem DDL, sem `neon_superuser`. Testada no PG18 local.
- **Regras de ciclo de vida** aplicadas ao bucket `hub-staging-backups` (3 regras, verificadas).

## Riscos aceitos (A1) e mitigações

- **Sem branch protection nem environments no GitHub Free privado**, o segredo do banco de Staging fica acessível a qualquer workflow que alguém com permissão de escrita no repositório consiga disparar a partir de uma branch (a linha `if: github.ref == 'refs/heads/main'` do arquivo não protege contra um workflow alterado na própria branch). Quem tem escrita hoje: o responsável e o agente com a credencial dele. O CI já usa um banco de testes remoto, então o risco não é novo, mas **a URL do backup lê o banco inteiro de Staging**.
- **Mitigação:** a role só lê (e insere em `backup_run`); o token do R2 vale só para o bucket de backup; o dado de Staging é sintético; a chave **privada** do `age` nunca vai ao GitHub (um workflow malicioso consegue **ler** o banco, não decifrar backups antigos).
- **Production NÃO usa este modelo**: a spec e a [ADR 0021](0021-repositorio-github-free-ci-duas-camadas.md) proíbem credencial de Production no GitHub comum. O executor do backup de Production (provavelmente manual ou na máquina do responsável, com a mesma `backup.ts`) fica para o **M10**; **isto precisa ser decidido antes do Go-Live**, porque sem backup de Production o M10-01 não passa.

## Sentry (B2 e B3): o que a documentação diz e o que falta confirmar

- O Sentry tem **Uptime Monitor** (HTTP, intervalos de 1, 5, 10, 20, 30 min ou 1 h) e **Cron Monitor** (check-in por DSN). Os planos **pagos** incluem **1 de cada**; monitores a mais custam por monitor (US$ 1,00 por Uptime e US$ 0,78 por Cron, só com orçamento pago-por-uso). **Não consegui confirmar o que o plano gratuito (Developer) inclui**, e a conta já tem um Cron Monitor do legado (`hub-outbox-production`), que não é meu e não foi tocado.
- **Antes de criar qualquer monitor, o responsável confere o uso na página de faturamento do Sentry**: se criar exigir orçamento pago, **não criar** (teto de US$ 10/mês, ADR 0003).
- **Cuidado com o banco:** um Uptime Monitor em `/api/health/ready` a cada poucos minutos mantém o Neon acordado o mês todo (≈ 180 CU-h contra os 100 do plano gratuito). Monitorar **`/api/health/live`** (não toca o banco) e, se houver mais de um monitor, `ready` no máximo de hora em hora (≈ +15 CU-h/mês).
- **Dead man's switch do Cron:** um Cron Monitor que o `ops.alerts` avisa a cada ciclo (30 min) detecta Worker, Cron ou banco fora do ar sem monitor externo e sem acordar o Neon além do Cron. Fica para o PR da entrega dos alertas, **se o plano permitir**.

## Consequências

- Backup diário de Staging automático depois que o responsável criar os segredos e variáveis do workflow (lista no cabeçalho do arquivo e no runbook) e **aplicar a migration 0041 no Staging ANTES de rodar `db:roles:backup`** (o `GRANT INSERT` falha sem a tabela).
- O alerta `backup_never` aparece no Staging até o primeiro backup agendado rodar: é correto, hoje não há backup agendado.
- Cada backup é um objeto do R2 contado nos 10 GB gratuitos; a retenção por ciclo de vida elimina a necessidade de script de limpeza (o `planRetention` de `scripts/backup/backup-core.ts` fica como referência e teste da política).
- **Fica para os próximos PRs:** `alert_state` e envio ao Sentry com no máximo um evento por código a cada 24 h (B3); `privacy_incident` (B4); eventual Cron Monitor (B2).

## Como validar

`bunx vitest run --project unit src/features/ops` (alertas) e `bunx vitest run --project pg test/pg/operations.pg.test.ts` (leitura de `backup_run`, hash/tipo/tamanho inválidos recusados); `bun run db:drift`; `bunx wrangler r2 bucket lifecycle list hub-staging-backups --profile neurocapacitar` (3 regras); o workflow só se prova com os segredos reais (`workflow_dispatch` em `main`).
