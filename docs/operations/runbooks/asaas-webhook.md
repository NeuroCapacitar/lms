# Runbook: webhook do Asaas falhando ou pagamento que não aparece

**Alertas:** `webhook_silent:asaas` (P3), `finance_orders_stuck` (P1), `finance_review_open` (P2, P1 depois de 24 h). **Dinheiro de cliente**: trate no mesmo dia útil.

## O que o sistema garante (para você não se assustar)

- O webhook **autenticado** vai para uma inbox durável e responde **HTTP 200 em todo caminho de sucesso, inclusive duplicata**; 5xx só se a inbox não conseguir gravar (aí o Asaas reenvia).
- **Token errado = 200 sem gravar nada** (de propósito: não ensinar o atacante). Logo, **um token trocado só de um lado deixa o webhook "silencioso" sem erro visível**.
- `CHECKOUT_PAID` **não concede acesso**: o pagamento é relido na API do Asaas. O reconciliador (Cron) fecha pedidos pendentes com sessão ativa há mais de 10 min, com recuo de 10 min a 6 h. 429 do Asaas interrompe o lote sem erro do job.

## Passos

1. **Tela Operação** (`/staff/operacao`): veja "Último evento" do Asaas, pedidos pendentes e o job `finance.reconcile`. `provider_unavailable` no job = o Asaas não respondeu à leitura.
2. **Status do Asaas** (página pública de status do provedor, por quem tem o link): se estiver fora, **espere**; o reconciliador recupera sozinho. Não reembolse nem libere acesso à mão por causa de atraso.
3. Webhook silencioso com pedidos esperando: confira no painel do Asaas se o **endpoint** e o **token de autenticação** são os do ambiente e se a fila de envio do Asaas não está pausada. O token vive em `ASAAS_WEBHOOK_TOKEN` (segredo do Worker): ver [rotacao-de-segredos.md](rotacao-de-segredos.md). Se trocar um lado, troque o outro **juntos**.
4. Pedido pago no Asaas e **sem acesso** depois de 2 h: abra a **Revisão financeira** (`/staff/financeiro`, grant `finance.review`), confira o pagamento no painel do Asaas e resolva com motivo (isso concede ou nega pelo caminho idempotente por pedido).
5. Evento fora de ordem, duplicado ou valor diferente do pedido **não** é falha: vira revisão ou é ignorado pela regra; não force.
6. Conferir: o alerta some no próximo ciclo; o pedido muda de estado; a auditoria mostra a decisão.

## Não faça

- Reenviar webhook em massa do painel do Asaas "para garantir" (duplicatas são seguras, mas gastam a cota de consultas do banco; ver o runbook do Neon).
- Dar acesso manual por matrícula para "resolver rápido" um pedido pago: isso cria um acesso sem o pedido (use a revisão financeira).
