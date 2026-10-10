# ADR-0003 — Teto de infraestrutura de US$ 10/mês e free tier primeiro

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q8, Q20, Q39, Q43
- **Substitui:** premissa de custos do pacote antigo (Neon Launch, Resend Pro e afins como base)

## Contexto

W1 estimou ~US$ 45–70/mês para a pilha "recomendada" (Neon Launch always-on ~US$ 19, Resend Pro US$ 20, Workers Paid US$ 5) (evidência: W1 §Estimativa). Para ~20 alunos hoje e 2 cursos novos, o responsável fixou o teto (Q8) e esclareceu que ele cobre a **infraestrutura de desenvolvimento** (Q20); vídeo e Asaas são custos operacionais do cliente.

## Decisão

- Teto: **US$ 10/mês** (Workers Paid US$ 5 + US$ 5 de folga). Único custo certo: **Workers Paid**.
- Todo o resto no **free tier**: Neon Free, Resend Free, Sentry Free, GitHub Free, R2 e Images Transformations Free, Turnstile, Web Analytics.
- **Upgrade pago exige nova decisão explícita.** Gatilhos de revisão já definidos: Neon >600 MB, >70 CU-h/mês ou primeiro incidente de perda de dados (Q43); Resend com 60% da cota em 7 dias (Q39).
- Vídeo (JMVStream, Mux etc.), Asaas e serviços jurídicos/contábeis são decididos com o cliente, fora do teto.
- Logs: a cobrança de observabilidade passa a ser por GB em 2026-12-01 (W1); definir sampling e não logar payloads.

## Consequências

- Riscos aceitos: Neon Free sem SLA e com janela de restore de 6 h; Resend Free com 100 e-mails/dia compartilhados por login, transacionais e marketing; Sentry Free com 1 usuário.
- Cada peça móvel precisa degradar com segurança ao bater cota (e-mail adiado pela outbox; fallback estático de imagens).

## Como validar

- Acompanhar no Operations Center: CU-h e armazenamento Neon, cota Resend, transformações de imagem, invocações.
- Alertas nos gatilhos acima; revisão do teto a cada marco (sem inventar valores antes de medir).
