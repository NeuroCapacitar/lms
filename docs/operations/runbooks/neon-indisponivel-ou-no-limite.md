# Runbook: banco indisponível ou no limite (Neon e Hyperdrive)

**Sinais:** `/api/health/ready` devolve 503 (`/api/health/live` continua 200), rotas com banco devolvem 500/503, alerta `cron_silent` (o Cron não grava `job_run`), `database_size_upgrade` (P3) ou `database_size_critical` (P1). **O Cron não consegue avisar de um banco fora do ar**: sem monitor sintético este é um P0 que depende de alguém ver o site.

## Antes de tudo: qual é a causa

| Causa | Como reconhecer | Quem resolve |
| --- | --- | --- |
| **Cota diária do Hyperdrive Free (100.000 consultas/dia)** | `wrangler tail` mostra `Connection terminated unexpectedly` (~30 ms) e **nenhuma sessão `hub_runtime`** no `pg_stat_activity` do Neon; o banco responde por conexão direta. **Ocorreu em 2026-10-17**, causada por teste de carga | **Espere o reset às 00:00 UTC (21:00 em Brasília)** ou contrate o Workers Paid (decisão do responsável). `cf hyperdrive restart` não resolve; **não troque as credenciais** da configuração |
| Neon **suspenso** (scale-to-zero, 5 min) | a 1ª requisição leva ~0,7 s a mais; **não é falha** | nada |
| Neon fora do ar ou projeto suspenso/apagado | conexão direta também falha; o console do Neon mostra o estado | status do Neon; sem SLA no Free; se perda de dados: [backup-and-restore.md](../backup-and-restore.md) |
| **Limite de armazenamento** (Free: 1 GB; alerta em 600/900 MB) | `database_size_*`; gravações recusadas perto do limite | abra a decisão de upgrade (responsável); veja o que cresce (auditoria, `inbox_event`, `outbox_message`, e-mails) antes de apagar qualquer coisa |
| Limite de computação (CU-h) | console do Neon (`active_time_seconds`) > 70 CU-h/mês | responsável; regra de saída da ADR 0032 (55 CU-h projetados) |
| Limite de conexões | erro de "too many connections"; o Hyperdrive de Staging usa `origin_connection_limit` 20, abaixo das 108 utilizáveis | conferir se algo abre conexões fora do Hyperdrive |

## Passos

1. `curl -s -o /dev/null -w '%{http_code}' <url>/api/health/ready` (e `live`). Anote a hora.
2. Confirme a identidade do CLI (`neon me`) e olhe o projeto no console do Neon (estado do compute, uso).
3. Teste a **conexão direta** (role de migração, nunca imprima a URL): se ela funciona e o site não, a causa é o **Hyperdrive** (cota ou configuração).
4. `wrangler tail <worker> --format json --profile neurocapacitar`: leia só o erro (mensagem e código), nunca o corpo de requisições.
5. **Não** rode migration, restauração nem `drizzle-kit push` para "consertar". Não rode carga contra o ambiente.
6. Voltou: rode o smoke (`bun run smoke <url> <sha-completo>`) e confira o Cron (próximo ciclo grava `job_run`). Itens do outbox e da inbox se acumulam durante a queda e o Cron os processa; **confira a fila** depois ([fila-e-dlq.md](fila-e-dlq.md)) e os pedidos pendentes ([asaas-webhook.md](asaas-webhook.md)): o Asaas reenvia webhooks que recebeu 5xx.

## Não faça

- Rodar teste de carga em Staging sem calcular **requisições × idas ao banco** (cada rota quente faz de 7 a 20 idas; o teto é 100 mil por dia).
- Apagar dados para "liberar espaço" sem decisão (auditoria é append-only por desenho).
