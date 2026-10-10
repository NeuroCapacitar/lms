# ADR-0015 — Vídeo: seis adapters por capabilities, YouTube permitido em curso pago, ativação após teste real

- **Estado:** accepted-conditional
- **Data:** 2026-10-10
- **Origem:** Q36, Q41 (Q41.1 revisada nas rodadas 6 e 7, Q41.2), Q61.3
- **Substitui:** recomendação de reduzir a 2 adapters (rejeitada) e a leitura "YouTube só em curso gratuito" (Q41.1 inicial)

## Contexto

Seis providers têm semânticas diferentes de evento: Panda não emite `ended` com autoplay, YouTube não tem `timeupdate`, e os eventos de saída da JMVStream não estão confirmados; os exemplos oficiais de Panda e JMV não validam `event.origin` (evidência: W4 §4–§7). A política do YouTube proíbe cobrar para assistir no player embutido (III.F.3.a). O legado nunca validou o player JMVStream real (L2 §4.3).

## Decisão

- Seis adapters na v1: JMVStream, Panda, Cloudflare Stream, Mux, YouTube, Vimeo, via `VideoAsset.provider` e capabilities (`reportsTime`, `reportsEnded`, `reportsSeek`, `resume`, `duration`). Sem iframe arbitrário.
- YouTube **permitido** em curso pago; risco aceito pelo responsável. Aviso na UI da Staff ao anexar YouTube a curso com Offer paga; ciência do cliente recomendada.
- Um adapter só é ativado na interface depois de passar nos testes de contrato com conta real, fornecida pelo cliente. Custos de vídeo são do cliente.
- Contrato de progresso: eventos normalizados; validar `event.origin` e `event.source`; duração vinda do provider (nunca do cliente); heartbeat de 15–30 s mais envio em pause, seek, ended e aba oculta; servidor limita a posição, ignora fora de ordem e conclui de forma idempotente. Conclusão em 90% (seek permitido); autoavanço só em `ended` de adapter com `reportsEnded`.
- Legenda é requisito de publicação (WCAG 1.2.2, nível A); verificar suporte por adapter.

## Consequências

Matriz de testes grande (6 providers x navegadores x play, seek, taxa, fullscreen, aba oculta). Riscos: violação dos termos do YouTube, vídeo removido ou vazado por link; Vimeo tem teto de banda com suspensão (W4 §6). Seis adapters em big-bang é risco declarado.

## Como validar

spike M0-13 (player JMVStream real: `ended`, duração, restrição de domínio). Por adapter: 89% vs 90%, seek ao limiar, 2x, aba oculta mais de 5 min, iOS Safari em fullscreen, perda de rede com flush, troca de usuário. Gate: adapter sem teste fica desativado.
