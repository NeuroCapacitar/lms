# Runbook: fila travada, DLQ com itens, fila pausada

**Alertas:** `queue_slow:*` (P2), `queue_stuck:*` (P1), `dead_letter:finance` (P1), `dead_letter:general` (P2), `failed_items` (P3), `queue_paused:*` (P2), `job_failed:*` (P2).

## Fatos

- **O Postgres (outbox e inbox) é a verdade.** As duas Queues (`hub-finance`, `hub-general`) só aceleram; a entrega é *at-least-once*. O Cron de 30 min **republica** o que ficou esquecido, então um item parado até 60 min costuma se resolver sozinho.
- **A DLQ da Cloudflare apaga mensagens em 4 dias**, mas o estado `dead` no Postgres **permanece**: a decisão é sempre tomada na tela Operação, não na DLQ.
- `dead` = esgotou as tentativas (8). `failed` = falha definitiva (erro que repetir não resolve).

## Passos

1. **`/staff/operacao`**: veja a fila, a idade do item aberto mais antigo e a lista de itens `dead`/`failed` (id, tipo, **código do erro**, tentativas, id de correlação; nunca payload).
2. Leia o `lastErrorCode`. Causas comuns: `provider_503` (Resend/Asaas fora: espere o provedor), cota de e-mail (ver [cota-resend.md](cota-resend.md)), erro do código (abra issue com o id de correlação, **não** reenfileire em loop).
3. Corrigida a causa: **Reenfileirar** o item (grant `ops.queue`, reautenticação recente, **motivo obrigatório**, vai à auditoria). Um item por vez; confira que concluiu antes do próximo.
4. Fila **pausada** (kill switch, só Admin): confirme na auditoria quem pausou e por quê; **retome** só se o motivo acabou (Admin, com motivo).
5. Para **parar o dano** (provedor devolvendo erro em massa, e-mail errado saindo): **pausar a fila** (Admin) e depois investigar. Pausar não perde nada: os itens ficam `pending`.
6. `job_failed:<job>`: o job do Cron terminou com erro; o código do erro está na tela. Um job que falha não derruba os outros. Persistindo por 2 ciclos, trate como incidente de código.
7. Conferir: o alerta some em até 30 min; a contagem de `dead` volta a zero; a auditoria lista cada reenfileiramento.

## Não faça

- Apagar linha de `outbox_message` ou `inbox_event` no banco (a auditoria e a idempotência dependem delas).
- Reenfileirar item financeiro sem entender o erro: o reembolso e a concessão são idempotentes por chave, mas o resultado incerto pede conferência no provedor primeiro.
