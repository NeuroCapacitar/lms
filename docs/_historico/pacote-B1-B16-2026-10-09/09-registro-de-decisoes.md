# 09 — Registro consolidado de decisões vigentes e substituídas

**Estado global:** B1–B16 fechados com aprovações; IMG-R1..R6 aprovadas após reabrir o storage. Este índice resume decisões vigentes, não substitui as especificações detalhadas. IDs de bloco indicam sua origem histórica; não implicam que todos os números individuais foram reproduzidos aqui.

| ID / bloco | Decisão vigente | Estado | Substituição / condição |
|---|---|---|---|
| B1 | Course 1:N Offers, Offer 1 Course v1; CourseInterest autenticado com ciclos; FAQ/banner/login media; catálogo Hub | Aprovado | Cupons/bundles/preview livre deferidos; leads externos só Resend |
| B2 | CourseRelease e revisions imutáveis; Module/Lesson estáveis; drip D+N; guided/free; mandatory-only progress; video 90%; quiz/discussions; seis providers | Aprovado | CoursePublication clonado, curriculum_key, anti-seek, 99.9% substituídos |
| B3 | Better Auth, Google+senha/passkey opcional, 7d PG session, UserProfile, roles+grants, StaffInvitation, ≥1 Admin | Aprovado | Sem impersonation, Admin Plugin, MFA obrigatória staff |
| B4 | Asaas Hosted, auth verified buyer, Order/CheckoutSession/Payment separados, full refund, entitlement vs enrollment, reconcile-first | Aprovado | Sem guest checkout, refund parcial via Hub, preço em Course |
| B5 + IMG-R | MediaAsset/VideoAsset, R2 canônico público/privado, master browser-edited, presigned PUT, transforms públicas Free | Aprovado | Images Hosted/Direct Creator Upload substituídos |
| B6 | Template editor visual contido, Browser Run PDF, snapshot+SHA+R2 privado, revogação/reemissão, purge 90d | Aprovado | Sem PNG persistida, sem download público indiscriminado; 90d sujeito a revisão jurídica |
| B7 | Student PWA offline seletivo, cache por User, lease 72h, sync idempotente, video online, quizzes submetidos online | Aprovado | Web Push deferido; SW atualização em fronteira segura |
| B8 | Resend Hosted Templates transacionais; outbox/delivery; Contacts marketing opt-in; Lark Mail suporte | Aprovado | React Email editorial e helpdesk Hub rejeitados |
| B9 | Métricas first-party de fatos operacionais, Student Progress autorizado, analytics sem evento genérico, sem CSV | Aprovado | Opt-out de fatos operacionais, LearningEvent/firehose e CDP/SaaS analíticos rejeitados |
| B10 | Tailwind4, shadcn Luma/Base UI, Lexend Deca, Phosphor, OKLCH, WCAG2.2 AA, Student/Staff shells | Aprovado | Biome/ícones Hugeicons/Manrope não canônicos; motion baixo |
| B11 | React SPA + Vite CF plugin + Hono RPC, Drizzle+Neon PG18 via Hyperdrive, TS7, Bun tooling, Vitest/Playwright, Oxlint/Oxfmt | Aprovado | Next/TanStack Start/SSR/oRPC/Biome não fazem parte da v1 |
| B12 | Cinco Queues/DLQs; outbox e cron; R2; Browser Run; Turnstile seletivo; rate limits; safe degradation | Aprovado | Hosted Images alterado posteriormente; sem DO/KV/D1/workflows obrigatórios |
| B13 | evlog/Workers Logs/Traces, Sentry, Web Analytics, Ops Center, SLOs e incident runbooks | Aprovado | Sem log SaaS/drain externo obrigatório |
| B14A | Semgrep CE, Gitleaks, Socket, Renovate, Dependabot Alerts, actionlint/zizmor, Scorecard CLI, Knip | Aprovado | CodeQL/Harden-Runner/CodeRabbit privado não contratados |
| B14B | Vitest Node/workerd, PG18 integrações reais, Playwright, CI por risco, architectural dependency-cruiser | Aprovado | Scorecard não bloqueante, Graphify opcional |
| B14C | Cookies/CSRF/CSP, server RBAC, projections, offline threats, uploads, SSRF, AES-GCM, ASVS | Aprovado | Sem RLS obrigatório, DAST/pentest comercial obrigatório |
| B15A | 3 ambientes/projetos Neon, CI GitHub Free, deploy Production admin controlado, Workers Paid, isolate secrets | Aprovado | GitHub Pro não adotado; secrets Prod fora CI comum |
| B15B | Drizzle forward-only, expand/contract, schema drift, DDL timeouts, direct PG migration, backups por risco | Aprovado | Sem db push Production, rollback SQL automático |
| B15C | pg_dump `-Fc` 6h, age+R2, off-cloud weekly, restore drill e reconcile, 48h/14d/4w | Aprovado | RPO/RTO metas provisórias; políticas jurídicas a validar |
| B15D | Coexistência com legado, DNS em etapas, cutover, version promotion, smoke/Go-No-Go, 7d estabilização | Aprovado | Sem rollback DNS cego após novas operações |
| B16A | Docs canônicas, ADRs, repositório single-package feature-first, scripts Bun, Router generated, AGENTS curto | Aprovado | Documentos não são evidência de implementação |
| B16B | Fundação+entregas verticais, DoR/DoD, M0–M10, matrizes/testes, auditoria final antes de construir | Aprovado | Marcos não são releases parciais de Production |

## Convenção para alterações futuras

Uma decisão substituída **permanece no registro histórico como `superseded`** e aponta para a substituta. Nunca preservar simultaneamente duas escolhas opostas como 'aprovadas'. Alteração relevante exige: evidência, opções, impactos em dados/segurança/custo, nova decisão ratificada e mudanças na documentação canônica correspondente.

## Fontes e revisão técnica (09/10/2026)

- Handoff estruturado das decisões B1–B11, datado de 08/10/2026; aprovações posteriores de B12–B16 e IMG-R na conversa.
- Legado inspecionado `https://github.com/NeuroCapacitar/hub` — apenas referência.
- Documentation links em [01 Auditoria](01-auditoria-de-consistencia.md) e [05 Operação e custos](05-seguranca-operacao-e-custos.md).
