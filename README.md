# NeuroCapacitar Hub vNext

> Novo LMS da NeuroCapacitar. **Este repositório está na fase de preparação (antes do M0).** Contém instruções de trabalho e especificações aprovadas, **não** um aplicativo construído, instalado ou deployado.

## Como começar

1. Leia [`AGENTS.md`](AGENTS.md) (regras para agentes de IA; Claude Code encontra [`CLAUDE.md`](CLAUDE.md)).
2. Abra o [índice documental](docs/README.md) e o [registro de status](docs/implementation/STATUS.md).
3. Execute **somente a tarefa autorizada**, começando por [M0-01](docs/tasks/M0-fundacao.md).
4. Use o [fluxo de desenvolvimento](docs/operations/ai-development-workflow.md) para planejar, validar e registrar a entrega.

## Estado

- Decisões fechadas em 2026-10-10 após reabertura completa ([relatório final](docs/review/relatorio-final.md)); 24 [ADRs](docs/adr/README.md).
- Código da vNext: **não implementado**. M0–M10: **planejados** em [docs/roadmap.md](docs/roadmap.md) e [docs/tasks/](docs/tasks/README.md).
- Legado Next/Vercel (`NeuroCapacitar/hub`): **referência de casos**; não copiar nem modificar.
- `package.json`, `bun.lock`, `wrangler.jsonc`, projetos Neon e Cloudflare **ainda não existem**; a criação segura é parte do M0.

## Mapa técnico resumido

React 19 SPA + Vite/Cloudflare Vite Plugin e Hono no mesmo Worker; PostgreSQL 18 no Neon (free tier) via Hyperdrive e Drizzle; R2 para mídia e certificados; Better Auth com magic link; Asaas Hosted Checkout; Resend; outbox no Postgres com 2 Queues; Browser Run para PDF; PWA offline para o aluno. GitHub Free privado; Production publicada manualmente. **Teto de infraestrutura: US$ 10/mês** (só o Workers Paid, US$ 5, é custo certo).

## Documentação

[Produto](PRODUCT.md) · [Glossário](CONTEXT.md) · [Visual](DESIGN.md) · [Arquitetura](docs/architecture.md) · [Domínio](docs/spec/domain.md) · [Contratos](docs/spec/contracts.md) · [Segurança e operação](docs/spec/security-operations.md) · [Roadmap](docs/roadmap.md) · [Decisões](docs/decisions.md)

`README.md` será ampliado no M0, quando os comandos e o runtime **existirem e forem testados**. Não copie comandos Next/Vercel do legado.

## Instruções para agentes

`AGENTS.md` é a fonte única; `CLAUDE.md` importa `AGENTS.md`; o Copilot usa uma ponte. Ver [topologia](docs/operations/agent-instructions.md). Validar com `node scripts/check-agent-instructions.mjs`.

## Comandos verificados (M0-01)

Pré-requisitos: Bun 1.4.2 e Node 24.21.0 (`.node-version`).

```bash
bun install --frozen-lockfile
bun run verify:quick   # typecheck (TypeScript 7.0.2) + oxlint --deny-warnings + oxfmt --check
```

Verificados num checkout limpo em 2026-10-10 (ver [STATUS](docs/implementation/STATUS.md)). `dev`, `test` e `verify` ainda não existem.
