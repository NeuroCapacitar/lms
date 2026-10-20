# ADR-0034 — Registro das revogações e suspensões fora do banco

- **Estado:** accepted (decidida pelo responsável em 2026-10-19: "concordo com você", sobre a minha recomendação)
- **Data:** 2026-10-19
- **Origem:** lacuna do M9-05 (reconciliação pós-restore): o que a Staff revoga ou suspende DEPOIS de um backup "volta a valer" quando o banco é restaurado, e a auditoria também é restaurada
- **Substitui:** — (estende o padrão do `purge-log/` da [M7-05](../implementation/STATUS.md) e a [ADR 0033](0033-m9-05-m9-06-backup-agendado-alertas-e-registro-de-incidentes.md))

## Contexto

Reembolso e estorno se recuperam relendo o Asaas. Revogar um **certificado**, revogar um **direito de acesso** e **suspender ou reativar** uma conta ou matrícula são decisões da Staff que só existem no banco. Restaurar um backup anterior as desfaz, sem aviso. A exclusão LGPD já tem registro fora do banco (M9-10); estas não tinham.

## Decisão

1. **Um gatilho em `audit_log`** (migration 0044) cria uma linha de `revocation_journal` para cada `certificate.revoke`, `entitlement.revoke`, `enrollment.suspend`, `enrollment.reinstate`, `account.suspend` e `account.reactivate`, **na mesma transação** da ação. Por ser no banco, cobre **todo caminho** (tela, reembolso, futuro) sem depender de cada função lembrar. A migration reconstrói o diário a partir da auditoria existente.
2. **O job `revocation.export` do Cron** grava cada linha no **R2 privado** em `revocation-log/<id da auditoria, 12 dígitos>-<ação>.json` (o bucket sobrevive a uma restauração do Neon) e só então marca `exported_at`. Idempotente; falha do R2 deixa a linha para o ciclo seguinte; sem R2 ou sem pendência o job nem acorda o Neon. O alerta **`revocation_export_stuck`** (P2) acende com revogação sem registro há mais de 2 h.
3. **O registro tem só ids, a ação, a categoria (do certificado) e o instante.** **Nunca** motivo, nota, nome nem e-mail: o texto livre fica na auditoria.
4. **A reaplicação** (`bun run restore:reconcile <ambiente> reapply-revocations --log-dir <pasta>`) reduz o registro ao **estado final** de cada alvo, na ordem da auditoria: revogar certificado e direito vale uma vez (o banco impede desfazer); suspender e reativar valem pelo **último** evento (uma suspensão já levantada não volta a bloquear). Cada passo é idempotente, conta aplicado / já estava / ausente na cópia restaurada, e audita `restore.revocation_reapplied` só com ids.

## Consequências

- A janela de perda é de até um ciclo do Cron (30 min) mais a falha do R2; o alerta cobre o atraso maior.
- **O registro fica no bucket de mídia privada**, não no de backup (o Worker não tem acesso ao de backup, por desenho). Para reaplicar, o operador baixa `revocation-log/` com um token do R2 de **leitura** desse bucket (a criar; o do backup não serve).
- Reativação e reintegração entram no diário de propósito: sem elas a reaplicação bloquearia quem já foi liberado.
- Revogação **por reembolso ou estorno** também entra (é `entitlement.revoke`); a reaplicação é redundante com a releitura do Asaas e inofensiva.
- Fora do escopo: a **volta** de uma revogação (não existe: é definitiva) e a recuperação de pedidos criados depois do backup (continua manual).

## Como validar

`bunx vitest run --project pg test/pg/revocation-journal.pg.test.ts` e `bunx vitest run --project unit test/unit/revocation-log.test.ts`; `bun run db:drift`.
