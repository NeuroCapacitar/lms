# Architectural Decision Records (ADRs)

**Estado:** 27 ADRs vigentes em 2026-10-10, uma por decisão difícil de reverter. O índice com o que cada uma substitui está em [../decisions.md](../decisions.md); o histórico do debate, em [../review/registro-do-debate.md](../review/registro-do-debate.md).

Crie uma ADR **somente** para decisão arquitetural relevante e cara de reverter; não uma por campo, componente ou script. Formato em [TEMPLATE.md](TEMPLATE.md). Uma mudança aprovada marca a anterior como `superseded` e aponta para a nova: nunca duas escolhas opostas `accepted`.

| ADR | Tema |
|---|---|
| 0001 | Reescrever do zero, sem ponte OpenNext |
| 0002 | Big-bang, ETL único ao final, legado congelado |
| 0003 | Teto de custo e free-tier-first |
| 0004 | SPA + Vite + Hono num Worker, sem SSR |
| 0005 | Banco: Neon Free, Hyperdrive, Drizzle |
| 0006 | Assíncrono: outbox/inbox + 2 filas |
| 0007 | Identidade: magic link |
| 0008 | Autorização: papéis e grants |
| 0009 | Currículo vivo com rascunho e publicação |
| 0010 | Catálogo: Course, Offer, interesse |
| 0011 | Acesso: prazo e âncora de drip |
| 0012 | Progresso, conclusão, quiz e discussões |
| 0013 | Comércio: Asaas e checkout autenticado |
| 0014 | Fiscal, jurídico e pedidos por e-mail |
| 0015 | Vídeo: seis adapters por capabilities |
| 0016 | Mídia: R2 canônico |
| 0017 | Certificados |
| 0018 | E-mail: Resend e marketing |
| 0019 | PWA offline do Student |
| 0020 | Marca, UI e tokens |
| 0021 | Repositório, GitHub e CI |
| 0022 | Toolchain |
| 0023 | Observabilidade, backup e operação |
| 0024 | Processo enxuto e regra de corte |
| 0025 | CLIs Cloudflare e Neon só com o perfil `neurocapacitar` |
| 0026 | Spike M0-11: Bun, plugin de testes e dependency-cruiser |
| 0027 | Spike M0-12: região do Neon (São Paulo) e orçamento de compute |
| 0028 | Spike M0-18: evlog e Sentry 11, com redaction obrigatória |
| 0029 | Spike M0-10: Better Auth 1.7.7, magic link com confirmação por POST |
| 0030 | Spike M0-15: Browser Run gera o PDF do certificado (A4, Lexend Deca, CSP obrigatória) |
| 0031 | Spike M0-17: meta tags por HTMLRewriter (aceite pendente dos validadores) |
| 0032 | M9-07: cache curto nas rotas públicas, sessão lida uma vez, Cron em 30 min, Workers Paid no fim |
| 0033 | M9-05 e M9-06: backup agendado no próprio repositório, retenção por ciclo de vida do R2, `backup_run`, alertas pelo Sentry, registro de incidentes no banco |

Cada spike do M0 que concluir terá sua ADR (numeração seguinte, 0032 em diante) com o resultado "passou" ou "reabrir decisão".
