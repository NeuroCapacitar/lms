# ADR-0013 — Comércio: Asaas Hosted Checkout com compra autenticada e acesso só por Payment confirmado na API

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q27, Q28, Q30, Q61.5 (confirma B4 com ajustes de contrato)
- **Substitui:** —

## Contexto

O legado vendia por visitante não logado (guest-first) e correlacionava pagamentos por heurística, porque o Payment do Checkout volta com `externalReference` nulo (evidência: L3 §5.2, §5.9). O Asaas é o PSP mais barato em cartão entre os que publicam tabela e é o único com NFS-e integrada, mas não tem `Idempotency-Key`, usa token estático no webhook e só aceita HTTP 200 como sucesso (evidência: W4 §1.4, §1.6, §2). O Checkout hospedado aceita apenas `PIX` e `CREDIT_CARD` na referência (W4 §1.1).

## Decisão

- Login obrigatório antes de comprar; sem guest checkout. `Order`, `CheckoutSession` e `Payment` são distintos; `Order` guarda snapshot; valores em centavos de BRL.
- Asaas Hosted Checkout (`POST /v3/checkouts`), Pix + cartão até 12x sem juros ao comprador (taxas absorvidas pelo cliente), sem boleto.
- Acesso: Pix libera em `PAYMENT_RECEIVED`, cartão em `PAYMENT_CONFIRMED`, sempre relendo o Payment na API. `CHECKOUT_PAID` e o retorno do checkout só disparam reconciliação, nunca concedem acesso.
- Webhook: validar `asaas-access-token` em tempo constante, persistir na inbox (`UNIQUE(provider, event_id)`) antes do ACK e responder sempre HTTP 200 explícito. Correlação pela sessão de checkout (`checkoutSession`), não por `externalReference`.
- Reembolso integral via `RefundRequest` durável, por quem tem o grant; nunca chamada ao provider dentro de transação PG; sem idempotency key, reler o Payment antes de qualquer retry. Política: 7 dias garantidos desde a compra; depois, só exceção do Admin. Reembolso revoga acesso; certificado emitido permanece com registro.
- Vendas do legado: histórico somente leitura; reembolso manual no painel Asaas mais revogação manual.
- Desligar as notificações de cobrança do Asaas (o Hub envia os e-mails).

## Consequências

Custo do Asaas é do cliente (Q20). Sem boleto, perde-se parte do público; mudar exige nova decisão. Política de chargeback (suspender ou revogar) fica PENDENTE.

## Como validar

spike M0-14 (webhook Asaas em sandbox): payload de `CHECKOUT_PAID`, CPF exigido na página, juros de parcelamento, filtro de `GET /v3/checkouts`, prazo de estorno Pix. Testes com eventos duplicados, fora de ordem e resultado incerto, e reembolso concorrente.
