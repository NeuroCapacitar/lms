# ADR-0004 — SPA React + Vite + Hono num Worker, sem SSR

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** B11, Q46; Q51 (ferramentas)
- **Substitui:** nada (B11 reafirmado, com a regra de HTMLRewriter explicitada)

## Contexto

A área logada é a maior parte do produto; as páginas públicas são poucas. Meta tags de compartilhamento (WhatsApp, LinkedIn) precisam estar no HTML servido, mas isso se resolve sem SSR de React: Worker com `run_worker_first` + `HTMLRewriter` no `index.html` (evidência: W5 §6). TanStack Start ainda era RC e React Router v8 não suporta SPA mode com o plugin Cloudflare (W5 §0). O legado pagava SSR sem cache (53 `force-dynamic`, 0 cache) (L1 §14.2).

## Decisão

- **React 19 SPA + Vite + Cloudflare Vite Plugin**, TanStack Router/Query, **Hono** (RPC) em um Worker; Zod nas bordas; sem Next.js, RSC, Server Actions, TanStack Start nem SSR.
- **Públicas:** página por curso, validação de certificado, login/cadastro, Termos/Privacidade/Ajuda. Sem vitrine em lista.
- **HTMLRewriter só em curso e validação de certificado**: `title`, `description`, `og:*`, canonical, `robots`. Texto escapado (nunca `{ html: true }` com dado do banco); falha ou timeout cai no shell sem alteração.
- `run_worker_first: ["/api/*", rotas públicas acima]`; CSRF próprio para JSON; Bot Fight Mode desligado até testar webhooks.

## Consequências

- Corpo da página renderiza no cliente; SEO de conteúdo rico fica fora da v1 (reabrir só com requisito concreto).
- Navegações nas rotas públicas invocam o Worker (custo desprezível na escala).
- Responsabilidade total por cache e autorização (lição de W5 §Riscos).

## Como validar

- spike M0-17: HTMLRewriter com Sharing Debugger da Meta e Post Inspector do LinkedIn (o comportamento dos crawlers não é confirmado oficialmente).
- Teste de que navegação a `/cursos/*` passa pelo Worker; teste de XSS no head.
