# ADR-0006 — Assíncrono: outbox/inbox no Postgres e duas Queues por ambiente

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q44 (delegada ao desenvolvimento); B12
- **Substitui:** as cinco Queues/DLQs de B12 (a parte "cinco filas"; outbox e Cron permanecem)

## Contexto

Queues é **at-least-once**; mensagens sem DLQ são apagadas e a DLQ sem consumer apaga em **4 dias** (evidência: W1 §C). Logo, o Postgres precisa ser a fonte da verdade. O legado provou o modelo (outbox/inbox, `SKIP LOCKED`, lease com fencing por `locked_by`, DLQ operada por humano), e sofreu com o transporte (cron HTTP de 30 min) (evidência: L1 §4, §14.1). Para ~20 alunos, cinco filas são custo operacional sem ganho.

## Decisão

- **Fonte da verdade:** tabelas outbox/inbox no PG. Webhooks persistem na inbox **antes** do ACK. Queue só acelera.
- **Duas Queues por ambiente:** `hub-finance` (dinheiro, acesso) e `hub-general` (e-mail, certificado, mídia, demais), **cada uma com DLQ**. Alocação exata por tópico: PENDENTE (spec de contratos).
- **Cron de reconciliação a cada 30 min** (também limita o acordar do Neon Free, [ADR-0005](0005-banco-neon-free-hyperdrive-drizzle.md)); recupera mensagens perdidas ou expiradas na DLQ.
- Idempotência por comando; **fencing por lease em linha** (`FOR UPDATE SKIP LOCKED`, `locked_by`/`lease_until`), sem advisory locks; tentativas limitadas com backoff e jitter; `dead_letter` e `superseded` distintos; reprocesso manual com motivo e auditoria.
- Nenhuma chamada a provider dentro de transação PG.

## Consequências

- Recuperação de falhas pode atrasar até ~30 min; é o preço do orçamento do Neon Free.
- Mais código de sweeper do que confiar na fila; em troca, nada se perde com a retenção da Queue.
- Revisável se o custo operacional de duas filas pesar.

## Como validar

- Testes: evento duplicado e fora de ordem, crash entre commit e envio, lease perdido, DLQ cheia e reconciliação recuperando.
- spike M0-14 (webhook Asaas sandbox) exercita inbox + ACK 200.
