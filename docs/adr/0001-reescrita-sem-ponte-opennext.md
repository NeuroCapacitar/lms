# ADR-0001 — Reescrever do zero, sem ponte OpenNext; o legado é especificação de casos

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q1, Q2 (registro do debate); B11 do pacote antigo
- **Substitui:** nada (reforça B11; reverte a recomendação de "ponte OpenNext opcional" de W5)

## Contexto

O objetivo (Q1) é sair da Vercel **e** reconstruir o domínio com menos complexidade acidental, com quatro critérios: custo recorrente sob controle; release reproduzível sem acoplamento à metadata do provedor; domínio sem clones de publicação, `curriculum_key`, anti-seek e papel exclusivo; conformidade mínima de consumidor/LGPD. O OpenNext só resolve a hospedagem e ainda exige mudanças de código (`sharp`, `pdfkit`, pool `pg`, Sentry v11, crons) (evidência: W5 §0). O vinext é 1.0 de 2026-09-28, com auditoria que achou 24 vulnerabilidades (W5 §0). O legado não registra o motivo da saída da Vercel; o indício é custo, release frágil (18 sucessos × 57 falhas) e borda Cloudflare (evidência: L1 §0, §5.8).

## Decisão

- A vNext é **reescrita do zero** em repositório novo. Nenhum código do legado é copiado; ele serve de **catálogo de casos e regras** (L1–L4), revalidadas antes de reproduzir.
- **Sem ponte OpenNext/vinext** para o legado nem para a vNext. TanStack Start e vinext ficam fora por ora (reavaliar só com requisito concreto de SSR de corpo de página).
- O legado fica na Vercel até o cutover ([ADR-0002](0002-lancamento-bigbang-etl-final-legado-congelado.md)).

## Consequências

- Custo da Vercel continua até o desligamento do legado.
- Risco clássico de reescrita: perda de correções implícitas e bugs de segurança em código novo assistido por IA (evidência: W5 §Riscos). Mitigação: casos do legado viram testes; spikes no M0.
- Esforço grande para 1 dev + agentes, sem prazo definido.

## Como validar

- Cada regra herdada do legado cita a evidência (L1–L4) e ganha teste na vNext.
- Spikes do M0 comprovam o runtime (workerd, `pg`, Hyperdrive) antes do M1.
- Reabrir apenas se o produto decidir que o modelo do legado basta.
