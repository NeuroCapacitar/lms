# ADR-0026 — Spike M0-11: Bun 1.4, plugin de testes da Cloudflare e dependency-cruiser sob TypeScript 7

- **Estado:** accepted — spike **passou** (2026-10-10), com uma lacuna aberta (Postgres 18 local)
- **Data:** 2026-10-10
- **Origem:** tarefa M0-11 ([M0-fundacao.md](../tasks/M0-fundacao.md)); confirma Q51 e a [ADR 0022](0022-toolchain-bun-ts-estavel.md)
- **Substitui:** —

## Contexto

A [ADR 0022](0022-toolchain-bun-ts-estavel.md) fixou Bun 1.4, TypeScript 7 e `@cloudflare/vitest-plugin`, e previa fallback (pnpm, TypeScript 6) se o spike falhasse. O desenvolvimento é no Windows; o CI será Linux. Código do spike: branch descartável `spike/m0-11` (nunca mesclada); só esta ADR entra na `main`.

## Resultado

**Matriz testada (versões exatas):** Bun 1.4.2, Node 24.21.0, TypeScript 7.0.2, Vitest 5.0.3, `@cloudflare/vitest-plugin` 1.4.0, Wrangler 4.149.0 (workerd 1.20261006.1), dependency-cruiser 18.5.0, `@swc/core` 1.16.13, oxlint 1.87.0, oxfmt 0.72.0. Ambientes: Windows 11 Pro (10.0.26200) e GitHub Actions `ubuntu-latest` (job de verificação da branch do spike: sucesso).

| Passo | Windows | Linux (Actions) |
|---|---|---|
| `bun install --frozen-lockfile` | passou | passou |
| `bun.lock` regenerado do zero (sem lockfile nem `node_modules`) | **idêntico** ao versionado | não testado |
| `bun run verify:quick` | passou | passou |
| Vitest + plugin no workerd (3 testes: health 200 JSON, `/api/nada` 404 JSON, `navigator.userAgent` = `Cloudflare-Workers`) via `bunx vitest run` (Node pelo shebang) | passou; **5/5** execuções estáveis | passou |
| Idem com runtime Bun (`bunx --bun vitest run`) e com Node direto | passou | Bun: passou |
| Falha injetada no teste do Worker | o teste falhou (exit 1), como esperado | não testado |
| dependency-cruiser com regra que proíbe `src/features` importar `hono` e `src/server`/`src/web` | detectou **as 2 violações** (exit 2); árvore limpa: exit 0 | exit 2 com o import proibido |

**dependency-cruiser sob TypeScript 7.0.2:** funciona, com um aviso não fatal (`missing-typescript-transpiler`: ele exige TypeScript < 7 para o extrator `tsc`). Os três modos (`parser` padrão, `"tsc"` e `"swc"`) extraíram o mesmo grafo (8 módulos, 16 dependências, mesmas violações); o aviso aparece em todos. O pacote `@swc/core` teve o `postinstall` bloqueado pelo Bun (não confiável por padrão) e funciona mesmo assim pelo pacote binário da plataforma.

## Decisão

- Q51 **mantida**: Bun 1.4.2 e TypeScript 7.0.2 seguem como base; nenhum fallback é necessário agora. Versões acima ficam fixadas como matriz testada.
- Testes de Worker: `cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })` no `vitest.config.ts` e `import { exports } from 'cloudflare:workers'` com `exports.default.fetch(...)` (os helpers `env` e `SELF` de `cloudflare:test` estão marcados como deprecados). Scripts podem usar `vitest run` por `bun run`; Node e Bun passaram.
- dependency-cruiser: configurar `options.parser: "swc"` explicitamente (independente do TypeScript) e instalar `@swc/core`; **não** usar `bun pm trust`. Tolerar o aviso até o TypeScript 7.1 publicar a API; revisar então.
- Wrangler continua sob Node (o `bunx` respeita o shebang).

## Consequências

- M0-05 (CI) e M0-06 (testes) podem seguir com esta matriz. O CI Linux deve instalar Bun 1.4.2 (no spike: `npm install -g bun@1.4.2`; a action `setup-bun` não foi testada) e usar Node 24.21.0.
- **Lacuna:** a máquina do desenvolvimento **não tem Docker, WSL nem PostgreSQL local**, então Postgres 18 local/Testcontainers (M0-06) **não foi testado**. Opções a decidir antes do M0-06: Docker Desktop (exige WSL2 ou Hyper-V), um projeto Neon Free de teste (com o perfil `neurocapacitar`, ver [cli-profiles](../operations/cli-profiles.md)) ou binários portáteis do Postgres 18. No Linux do CI, o serviço de Postgres do Actions resolve.
- Não verificado: Bun no macOS, cobertura de testes (`@vitest/coverage-v8`), `wrangler dev` no Windows com o plugin, e Vitest com projetos múltiplos.

## Como validar

Reproduzir a tabela acima no M0-05/M0-06 com os arquivos definitivos. Se uma nova versão quebrar algo, voltar à matriz desta ADR e abrir nova decisão.
