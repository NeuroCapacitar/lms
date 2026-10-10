# ADR-0023 — Observabilidade, backup e operação dentro do free tier

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q53, Q54 (Q43, Q20)
- **Substitui:** backup a cada 6 h do legado

## Contexto

O legado tinha Sentry só em Production, sem uptime nem cron monitor, e backup agendado no GitHub que atrasou de 3h34 a 5h08 numa cadência de 6 h (evidência: L1 §3.5, §6). O Neon Free tem PITR de 6 h e 1 GB, sem SLA (W1 §M). Workers Logs passa a cobrança por GB em 2026-12-01 (W1 §I). O Sentry Free tem 1 usuário (W2 §11). `evlog` não foi pesquisado.

## Decisão

- Observabilidade: `evlog` (a validar), Workers Logs e Traces, Sentry Free, Web Analytics, Operations Center, SLOs, alertas P0 a P3 e runbooks. Sem plantão 24/7. Sem PII em logs, Sentry sem PII padrão e replays desligados.
- Alertas próprios: webhook Asaas ausente com pedidos pendentes e fila pausada (retenção de 14 dias), backup sem frescor, DLQ não vazia.
- Backup: `pg_dump -Fc` diário e antes de cada release, cifrado com `age`, no R2; chave privada fora do CI. Cópia semanal cifrada fora da Cloudflare (destino PENDENTE: cliente). Ensaio de restauração semestral e antes do Go-Live, com reconciliação pós-restore.
- Metas (a demonstrar, não garantias): RPO até 24 h, RTO até 8 h.
- Neon Free em Production; gatilhos de upgrade: mais de 600 MB, mais de 70 CU-h por mês, ou o primeiro incidente de perda de dados.

## Consequências

Sem PITR longo, a perda real pode chegar a 24 h. O executor agendado do `pg_dump` (um Worker não roda `pg_dump`) é PENDENTE; repositório administrativo isolado só se necessário. Upgrade pago exige nova decisão (teto de Q20).

## Como validar

spike M0-18 (`evlog` e Sentry 11 no Worker) e M0-12 (orçamento de acordar o Neon). Ensaio de restauração com medição de RTO e conferência de pagamentos e revogações.
