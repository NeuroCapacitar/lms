# ADR-0011 — Acesso: Entitlement, prazo por Offer e âncora de drip única por pessoa e curso

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q31, Q33, Q61.2
- **Substitui:** `EnrollmentEpisode` (interrupção total criava episódio novo e reiniciava o drip)

## Contexto

O padrão Concessão → Matrícula do legado equivale a Entitlement → Enrollment, com expiração validada por requisição e cron só para materializar e avisar (evidência: L3 §4.1–4.2). No legado, a âncora do drip era preservada em renovação e **reiniciada** na recompra após perda total (L2 §3.1). O responsável decidiu que a recompra continua o progresso (Q31) e que não há acesso vitalício (Q61.2).

## Decisão

- **Entitlement** é o direito (fonte); **Enrollment** é a projeção efetiva por (pessoa, curso). Toda mutação altera o Entitlement e recompõe a projeção.
- **Toda Offer, inclusive gratuita, tem prazo em meses; não há vitalício.** Expiração avaliada **por requisição**.
- **Âncora de drip D+N única por (pessoa, curso)**: definida no **primeiro acesso**, nunca reiniciada. Recompra após expirar **continua o progresso**. Sem `EnrollmentEpisode`.
- Origens: compra paga, oferta gratuita, `admin_grant` (matrícula manual pela Staff com grant, **com duração**). Bloqueio de plataforma prevalece sobre a matrícula sem apagar dados.
- Reembolso revoga o Entitlement correspondente ([ADR-0008](0008-autorizacao-papeis-e-grants.md) para quem executa).
- ETL: âncora migrada do legado.

## Consequências

- Quem recompra tarde encontra módulos já liberados (âncora antiga); é consequência aceita da regra.
- A regra do legado "maior atraso D+N cabe na duração do acesso" precisa ser reavaliada: PENDENTE (spec de domínio).
- Mudança no contrato dos documentos antigos (sem episódios).

## Como validar

- Testes PG18: compra → expira → recompra mantém progresso e âncora; compra concorrente não duplica Entitlement; free sem Order.
- Teste de expiração por requisição sem depender do cron.
