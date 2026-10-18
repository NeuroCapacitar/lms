# Runbooks (M9-06)

Passo a passo curto, sem plantão 24/7. **Escritos por mim e ainda não seguidos por outra pessoa**: o aceite do M9-06 exige que alguém que não os escreveu os execute em Staging (ver [alertas e SLOs](../alerts-and-slos.md), "Pendências"). Se um passo não bater com a realidade, corrija o runbook no mesmo dia.

Regras que valem em todos:

1. **Production nunca sem autorização explícita do responsável**; Staging para treinar.
2. CLIs Cloudflare, Neon e Sentry **só com `--profile neurocapacitar`**, verificando antes a identidade (`neon me`, `cf auth whoami`; nunca `wrangler whoami`) — [cli-profiles.md](../cli-profiles.md).
3. **Nunca** colar token, senha, chave ou URL de banco em chat, log, issue ou commit.
4. Antes de mexer: anote o horário, o alerta (`P?:codigo`) e o que viu. Depois: confira o alerta sumir no próximo ciclo do Cron (até 30 min).
5. Ação da Staff com efeito (reenfileirar, kill switch, reembolso) pede **grant, reautenticação recente e motivo**, e fica na auditoria.

| Situação | Alerta típico | Runbook |
| --- | --- | --- |
| Webhook do Asaas falhando ou pagamento não aparece | `webhook_silent:asaas`, `finance_orders_stuck`, `finance_review_open` | [asaas-webhook.md](asaas-webhook.md) |
| Fila ou DLQ com itens | `queue_stuck:*`, `queue_slow:*`, `dead_letter:*`, `failed_items`, `queue_paused:*` | [fila-e-dlq.md](fila-e-dlq.md) |
| Banco indisponível ou no limite | `cron_silent`, `database_size_*`, 503 em `/api/health/ready` | [neon-indisponivel-ou-no-limite.md](neon-indisponivel-ou-no-limite.md) |
| Cota ou webhook do Resend | `email_quota_exhausted`, `email_quota_upgrade`, `webhook_silent:resend` | [cota-resend.md](cota-resend.md) |
| Restaurar de backup | perda de dados | [../backup-and-restore.md](../backup-and-restore.md) |
| Certificado `failed` | `certificate_failed` | [certificado-failed.md](certificado-failed.md) |
| Trocar um segredo | rotina ou vazamento | [rotacao-de-segredos.md](rotacao-de-segredos.md) |
| Release com problema | erro após deploy | [rollback-de-release.md](rollback-de-release.md) |
| Dados pessoais expostos ou suspeita | qualquer | [incidente-dados-pessoais.md](incidente-dados-pessoais.md) |
