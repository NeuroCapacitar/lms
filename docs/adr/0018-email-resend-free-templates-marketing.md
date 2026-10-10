# ADR-0018 — E-mail: Resend Free, Hosted Templates, outbox transacional e marketing com consentimento próprio

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q16, Q39 (Q20, Q52)
- **Substitui:** —

## Contexto

O Resend Free permite 3.000 e-mails por mês e 100 por dia. Esse limite é compartilhado por links de login, transacionais e marketing, e o login por magic link para todos torna a cota vulnerável a abuso (evidência: W3 §7.2, W2 §12, registro Q52). O legado usava Hosted Templates mas ainda mantinha React Email, um modelo híbrido; não tinha marketing nem consentimento (L3 §6.3, §6.7). A idempotência do Resend vale 24 h.

## Decisão

- Resend Free, sem upgrade pago sem nova decisão (teto de Q20). Gatilho de reavaliação: 60% da cota em 7 dias.
- Hosted Templates do Resend são a fonte editorial; sem React Email. Variáveis sem HTML e sempre com valor ou fallback. Previstos 10 templates mais o de magic link.
- Outbox transacional em PG; o excedente da cota é adiado, não descartado. `Idempotency-Key` igual ao id do comando. Webhook do Resend verificado (Svix) sobre o corpo bruto.
- Pedido de magic link protegido por Turnstile, rate limit por e-mail e IP, para não esgotar a cota.
- Marketing (preferência, Contacts, Segments) com consentimento independente, revogável e registrado. Sem e-mail em massa no cutover.
- Tokens e URLs de login não ficam em payload de outbox nem em logs. Como o link é enviado: PENDENTE (spike M0-10).

## Consequências

Uma cota diária pequena obriga prioridade e atraso do que não é crítico. Nova cota ou plano pago exige decisão do cliente. Verificar se broadcasts têm cota própria: PENDENTE (cliente/pesquisa na conta). Cloudflare Email Sending segue só como fallback futuro (beta, sem templates; W1 §K).

## Como validar

Teste de excedente de cota com a outbox, de duplicidade por idempotência e de Turnstile no pedido de link. Medir o consumo real de e-mails por dia no Staging antes do Go-Live.
