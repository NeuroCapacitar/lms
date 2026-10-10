# ADR-0010 — Catálogo: Course 1:N Offer, Order com snapshot e CourseInterest com ciclos

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q23; B1
- **Substitui:** o modelo do legado em que preço e prazo vivem no próprio `courses` (sem entidade Offer)

## Contexto

No legado, `courses` concentra identidade comercial e oferta (preço, meios de pagamento, parcelas, duração) e a ADR local recusou a entidade Offer como "prematura" (evidência: L2 §1.1). O interesse de venda não podia ser rearmado após notificado (L2 §1.3). O curso gratuito já funciona sem Order, Checkout ou Asaas (L2 §1.4, L3 §4.4). O responsável manteve a Offer separada (Q23).

## Decisão

- **Course 1:N Offer**; cada Offer pertence a um único Course na v1 (sem bundles, cupons ou preview livre).
- **Offer:** gratuita ou paga; preço em **centavos inteiros de BRL**; **meses de acesso** (obrigatório, [ADR-0011](0011-acesso-entitlement-prazo-ancora-drip.md)); parcelas; status. Só o Admin cria/edita Offers (ADR-0008).
- **Order guarda snapshot** da Offer (preço, prazo, parcelas) na compra; mudança posterior não altera pedidos existentes.
- **CourseInterest:** só de usuário autenticado, com **ciclos de abertura** (reabrir vendas permite novo aviso). Leads externos e landing pages não criam User, interesse nem matrícula.
- Oferta gratuita gera Entitlement transacional sem Order/Payment/CheckoutSession/Asaas.
- Dimensões de disponibilidade (entrega × vitrine × vendas) e constraints de preço mínimo: PENDENTE (spec de domínio).

## Consequências

- Mais uma entidade e um join para o checkout; em troca, múltiplas ofertas por curso sem duplicar conteúdo.
- ETL do legado cria uma Offer por curso a partir de `courses` (preço, `access_duration_months`).

## Como validar

- Testes: alteração de Offer após checkout aberto; Offer gratuita sem chamada Asaas; interesse reaberto em novo ciclo notifica uma vez.
- Constraint de banco: Offer ↔ um Course.
