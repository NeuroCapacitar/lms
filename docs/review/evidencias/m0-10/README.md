# Evidências do spike M0-10 (2026-10-10)

Material da [ADR 0029](../../../adr/0029-spike-m0-10-better-auth-magic-link.md). O spike rodou **fora do repositório** (diretório descartável), em duas etapas contra o projeto Neon de testes `hub-test` (sem dado real): (1) workerd local (`wrangler dev --local`) com o Hyperdrive local apontando ao Neon; (2) um **Worker real descartável** (`m0-10-spike`, workers.dev) com um Hyperdrive descartável (cache desligado), no plano Workers Free. Ao final foram apagados o Worker, o Hyperdrive e as tabelas do spike. Valores de teste fictícios (`aluno1@example.com` etc.); o segredo do Better Auth e a chave das rotas de diagnóstico eram aleatórios e morreram com o Worker.

| Arquivo | Conteúdo |
|---|---|
| `worker-index.ts.txt` | Worker do spike: Hono + Better Auth 1.7.7 (adapter Drizzle, `pg` por requisição, plugin `magicLink`, plugin `captcha` opcional) + rotas de confirmação por POST e rotas `/_spike/*` protegidas por chave |
| `schema.ts.txt`, `schema.sql.txt` | Tabelas do Better Auth (`user`, `session`, `account`, `verification`, `rate_limit`) em Drizzle e o SQL equivalente (colunas em `snake_case`), mais as tabelas de apoio do spike |
| `wrangler.jsonc.txt` | Configuração do Worker descartável (o ID do Hyperdrive citado já foi apagado) |
| `flow.mjs.txt` | Roteiro de testes (modos `basic`, `rate`, `seq`), usado no local e no edge: link duas vezes, expirado, GET/HEAD, origem, sessão rolling, revogação, rate limit, bloqueio de e-mail de Staff, 20 fluxos em sequência, conexões |
| `cpu.mjs.txt` | Medição do custo do `scrypt` do Better Auth no Node (referência de V8) |
| `cpu-wall-por-rota.json` | CPU e tempo de parede (ms) por requisição, no Worker real, lidos do `wrangler tail` |

Resultado do roteiro: local 20/20; no edge, `basic` 15/15, `rate` 2/2 e `seq` 2/2.
