# ADR-0022 — Toolchain: Bun fixado, TypeScript estável mais recente e escolhas de frontend delegadas

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q51 e escolhas delegadas (rodada 6/7)
- **Substitui:** referência ao `@cloudflare/vitest-pool-workers` (deprecado)

## Contexto

Em 2026-10-09: TypeScript 7.0.2 estável, sem API programática até a 7.1; Oxlint type-aware exige TS 7; Bun 1.4 foi reescrito de Zig para Rust e mudou códigos de erro no Windows; `vitest-pool-workers` foi substituído por `@cloudflare/vitest-plugin`; Hono 5 e `@cloudflare/vite-plugin` 2 estão em RC/beta (evidência: W2 §1, §4, §6, §7). O dev trabalha no Windows.

## Decisão

- **Bun** como gerenciador, versão exata (1.4.x) e lockfile v2; **Node 24 LTS** para Wrangler e tooling. **TypeScript** estável mais recente (7.0.x), `strict`, `types` explícitos, sem `baseUrl`.
- Oxlint e Oxfmt (versões exatas); Knip; dependency-cruiser pelo extrator swc até o TS 7.1. Vitest com `@cloudflare/vitest-plugin` e PG18 real; Playwright.
- Fixar Hono 4.13.x, `@cloudflare/vite-plugin` 1.x, Vite 8; Renovate com espera de 7 a 14 dias.
- Frontend: React Hook Form + Zod; reordenação por botões acessíveis (WCAG 2.5.7), Pragmatic DnD só se compensar; `vite-plugin-pwa` em `injectManifest` (ADR-0019); Tiptap com JSON validado e render por allowlist (links só `https` e `mailto`); Phosphor; TanStack Table 9 e Recharts só na Staff.
- Drizzle 0.45 fixado, migrations SQL revisadas e forward-only.

## Consequências

Muitas majors recentes: aceitar churn e fixar tudo. Phosphor está sem release desde 2025-05-22 (risco baixo). Dependabot não faz security updates para Bun. Fallbacks se o spike falhar: pnpm no lugar de Bun, TS 6.0.3 no lugar do 7; trocar exige ADR.

## Como validar

spike M0-11: Bun 1.4 no Windows e no Linux do CI (`bun install --frozen-lockfile`), `@cloudflare/vitest-plugin`, Oxlint type-aware, dependency-cruiser sob TS 7, `wrangler types --check`. Nada disso foi executado ainda.
