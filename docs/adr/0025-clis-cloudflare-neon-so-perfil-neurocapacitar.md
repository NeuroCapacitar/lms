# ADR-0025 — CLIs da Cloudflare e da Neon só com o perfil `neurocapacitar`

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** instrução explícita do responsável (2026-10-10), após criar perfis nas CLIs
- **Substitui:** —

## Contexto

A máquina do responsável guarda várias contas nas CLIs (Neon: `DEFAULT`, `neurocapacitar`, `junior-pessoal`; Cloudflare: `default`, `junior-pessoal`, `neurocapacitar`). Verificado em 2026-10-10: o perfil ativo da Neon é `DEFAULT` (outra conta); `wrangler whoami` sem `--profile` mostra o login pessoal; o Wrangler ainda não está autenticado no perfil `neurocapacitar`. Um comando sem perfil explícito pode, portanto, atingir recursos de outra conta.

## Decisão

Qualquer uso de `cf`, `wrangler` e `neon` neste projeto é **estritamente restrito ao perfil `neurocapacitar`** (`neurocapacitar.projetos@gmail.com`): `--profile neurocapacitar` explícito em todo comando remoto, verificação de identidade (`neon me`, `cf auth whoami`) antes do primeiro comando da sessão, parada imediata se o e-mail divergir, e nenhuma operação de login, logout, criação ou troca de perfil sem autorização. Detalhes e comandos: [cli-profiles.md](../operations/cli-profiles.md).

## Consequências

- Todo script, tarefa e runbook que chame `wrangler` ou `neon` remoto precisa do `--profile`. No CI vale o token da conta do projeto.
- O M0-03 em diante depende de o responsável autenticar o Wrangler no perfil (`wrangler login --profile neurocapacitar`).
- Custo: um flag a mais por comando e uma checagem por sessão; em troca, nenhum recurso de outra conta é tocado.

## Como validar

Identidade confirmada por `neon me --profile neurocapacitar` e `cf auth whoami --profile neurocapacitar` (feito em 2026-10-10). Revisão de PR: nenhum comando remoto sem `--profile neurocapacitar`.
