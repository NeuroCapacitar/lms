# Decisões — índice

**Estado:** vigente em 2026-10-10. Cada linha aponta para a ADR que a sustenta. O histórico completo (61 decisões do debate, com status e observações) está em [review/registro-do-debate.md](review/registro-do-debate.md); o resumo com alternativas rejeitadas, riscos e pendências, em [review/relatorio-final.md](review/relatorio-final.md). O pacote anterior (B1–B16) está arquivado em [_historico/](_historico/pacote-B1-B16-2026-10-09/) e é só história.

| ADR | Decisão | Substitui |
|---|---|---|
| [0001](adr/0001-reescrita-sem-ponte-opennext.md) | Reescrever do zero, sem ponte OpenNext | — |
| [0002](adr/0002-lancamento-bigbang-etl-final-legado-congelado.md) | Big-bang, ETL único ao final, legado congelado | B15D (coexistência) |
| [0003](adr/0003-teto-de-custo-free-tier-first.md) | Teto de US$ 10/mês, free-tier-first | B15A (custos abertos) |
| [0004](adr/0004-spa-vite-hono-worker-sem-ssr.md) | SPA + Vite + Hono num Worker, sem SSR | — (B11 mantida) |
| [0005](adr/0005-banco-neon-free-hyperdrive-drizzle.md) | Neon Free, Hyperdrive sem cache, Drizzle 0.45 | B15B/B15C (ajustes) |
| [0006](adr/0006-assincrono-outbox-duas-filas.md) | Outbox/inbox + 2 filas | B12 (5 filas) |
| [0007](adr/0007-identidade-magic-link.md) | Magic link para todos | B3 (passkeys/Google+senha) |
| [0008](adr/0008-autorizacao-papeis-e-grants.md) | Papéis não exclusivos + grants granulares | — |
| [0009](adr/0009-curriculo-vivo-rascunho-publicacao.md) | Currículo vivo, publicação atômica | B2 (`CourseRelease`) |
| [0010](adr/0010-catalogo-course-offer-interesse.md) | Course 1:N Offer; interesse com ciclos | — |
| [0011](adr/0011-acesso-entitlement-prazo-ancora-drip.md) | Prazo por Offer; âncora de drip única | B2 (`EnrollmentEpisode`) |
| [0012](adr/0012-progresso-conclusao-quiz-discussoes.md) | Vídeo 90%, quiz simples, discussões mínimas | — |
| [0013](adr/0013-comercio-asaas-checkout-autenticado.md) | Asaas Hosted, login obrigatório, Pix+cartão 12x | — |
| [0014](adr/0014-fiscal-juridico-e-pedidos-por-email.md) | NFS-e fora; pedidos por e-mail; termos e aceite | — |
| [0015](adr/0015-video-seis-adapters-por-capabilities.md) | Seis adapters; YouTube com risco aceito | — |
| [0016](adr/0016-midia-r2-canonico.md) | R2 canônico, Images Free com fallback | Images Hosted |
| [0017](adr/0017-certificados-snapshot-browser-run-editor-visual.md) | Certificados: snapshot, Browser Run, editor visual | — |
| [0018](adr/0018-email-resend-free-templates-marketing.md) | Resend Free, templates hospedados, marketing | React Email |
| [0019](adr/0019-pwa-offline-student.md) | PWA offline do Student | — |
| [0020](adr/0020-marca-ui-tokens-experiencia-unica.md) | Tokens OKLCH, experiência única | B10 (shells distintos) |
| [0021](adr/0021-repositorio-github-free-ci-duas-camadas.md) | GitHub Free privado, CI em duas camadas | B14A (13 ferramentas) |
| [0022](adr/0022-toolchain-bun-ts-estavel.md) | Bun, TypeScript estável, libs delegadas | — |
| [0023](adr/0023-observabilidade-backup-operacao.md) | Observabilidade, backup, operação | B15C (6 h/trimestral) |
| [0024](adr/0024-processo-enxuto-um-dev-mais-ia.md) | Processo enxuto, regra de corte, spikes | B16 (pacote extenso) |
| [0025](adr/0025-clis-cloudflare-neon-so-perfil-neurocapacitar.md) | CLIs Cloudflare e Neon só com o perfil `neurocapacitar` | — |

## Convenção

Decisão substituída permanece como `superseded` e aponta para a substituta; nunca duas escolhas opostas como `accepted`. Mudança relevante: **evidência → opções → trade-offs → proposta → aprovação explícita → nova ADR ou emenda**. Não crie um segundo ledger.
