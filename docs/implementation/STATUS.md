# Estado de implementação — Hub vNext

**Atualização:** 2026-10-10  
**Estado:** M0 em andamento (M0-01 `verified` localmente; ainda sem CI)  
**Próximo marco:** M0 — Fundação e spikes  
**Próxima tarefa recomendada:** M0-02 (não autorizada)  
**Task em execução:** nenhuma  
**Última tarefa comprovadamente verificada:** M0-01 (2026-10-10)

> Nunca marcar tarefa ou marco como concluído com base em decisão, texto de plano, instrução para IA ou intenção. Só evidências reais de arquivos, comandos, testes, SHA e homologação justificam o status.

## Marcos

| Marco | Status | Evidência |
|---|---|---|
| M0 Fundação e spikes | `in_progress` | M0-01 `verified` (ver registro abaixo) |
| M1 Identidade e Staff | `not_started` | — |
| M2 Catálogo e autoria | `not_started` | — |
| M3 Jornada gratuita | `not_started` | — |
| M4 Assíncrono e e-mail | `not_started` | — |
| M5 Aprendizagem completa | `not_started` | — |
| M6 Comércio | `not_started` | — |
| M7 Certificados | `not_started` | — |
| M8 PWA | `not_started` | — |
| M9 Operação e refinamento | `not_started` | — |
| M10 Migração e lançamento | `not_started` | — |

## Registro de tarefas concluídas

Ao concluir uma tarefa, acrescente: `ID`, SHA, arquivos, comandos executados, resultados, evidências, pendências e responsável pela homologação.
### M0-01 — verified (2026-10-10; SHA no commit desta branch)

- **SHA:** ver o commit da branch `feat/m0-01-governanca` (o SHA não pode constar neste arquivo sem alterar o próprio commit).
- **Arquivos:** `package.json`, `bun.lock`, `bunfig.toml`, `.node-version`, `tsconfig.json`, `.oxfmtrc.json`, `.gitignore` (negação de `.dev.vars.example`), `LICENSE`, `CONTRIBUTING.md`, `scripts/check-agent-instructions.mjs` (JSDoc), `README.md`, `AGENTS.md`.
- **Versões fixadas (exatas):** Bun 1.4.2, Node 24.21.0, TypeScript 7.0.2, oxlint 1.87.0, oxfmt 0.72.0, @types/node 24.19.2. Provisórias até o spike M0-11.
- **Executado e passou:** `bun install` e, em cópia limpa dos arquivos versionáveis (sem `node_modules`), `bun install --frozen-lockfile` e `bun run verify:quick` (exit 0). Testes negativos na cópia: erro de tipo, formatação errada e `debugger`/variável não usada falham o respectivo script. `git check-ignore` confirma que `.dev.vars`, `.env*`, `.wrangler/`, `dist/` e chaves são ignorados e que `.dev.vars.example` não é.
- **Gitleaks 8.30.1** (release oficial `gitleaks/gitleaks`, `windows_x64.zip`, 8.438.883 bytes, checksum SHA-256 conferido contra o `checksums.txt` do mesmo release; guardado fora do projeto): `gitleaks git` no histórico (2 commits, todas as refs) e `gitleaks dir` no diretório de trabalho (sem `node_modules`) = **no leaks found**. Teste negativo em repositório temporário descartável com um token falso aleatório no formato `ghp_...`: **1 achado, exit 1**. O Gitleaks ainda não está no CI (M0-05).
- **Desvios do plano:** (1) não há script `test`: não existe nada a testar e a tarefa proíbe script sem utilidade; chega no M0-06. (2) `lint` usa `--deny-warnings`, para que aviso falhe. (3) oxfmt só cobre código e configuração (`.oxfmtrc.json` ignora `docs/**`, `*.md`, lockfile e manifesto), para não reformatar a documentação. (4) `typecheck` cobre só `scripts/*.mjs`, o único código existente. (5) `.dev.vars.example` não foi criado: ainda não há variáveis. (6) `LICENSE` deixa o titular como PENDENTE.
- **Riscos:** versões provisórias; GitHub Free privado sem branch protection (trabalho em branch, revisão humana).


## Bloqueios e pendências externas

- Repositório vNext criado em 2026-10-10: `NeuroCapacitar/lms` (privado, organização, GitHub Free; opção B da Q49 realizada). Contém só documentação; M0-01 não foi executado.
- Contas Cloudflare e Neon (Development, Staging, Production) não provisionadas.
- Spikes do M0 não executados: nenhuma compatibilidade foi testada (Better Auth + Hyperdrive, Bun/Windows, JMV, Asaas sandbox, Browser Run, Images, HTMLRewriter, evlog/Sentry).
- Terceiros: contador (NFS-e), advogado do cliente (termos, retenções, transferência internacional), cliente (provedores de vídeo e contas de teste, manual de marca e logo positivo, destino da cópia off-cloud). Ver [relatório final](../review/relatorio-final.md#7-pendências-que-dependem-de-terceiros).

## Regra de atualização

Atualize após cada tarefa verificada; registre impedimentos reais. Não acrescente datas, deploys ou testes fictícios. Não inicie uma tarefa nova automaticamente.
