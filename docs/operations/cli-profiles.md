# CLIs Cloudflare e Neon: só o perfil `neurocapacitar`

**Estado:** regra vigente desde 2026-10-10 (decisão do responsável; [ADR 0025](../adr/0025-clis-cloudflare-neon-so-perfil-neurocapacitar.md)). Vale para qualquer pessoa ou agente de IA que opere este projeto.

## Regra

Qualquer uso das CLIs da **Cloudflare** (`cf`, `wrangler`) e da **Neon** (`neon`) neste projeto fica **estritamente restrito ao perfil `neurocapacitar`**, ligado ao e-mail `neurocapacitar.projetos@gmail.com`. Nenhum outro perfil, conta, token ou login pode ser usado, nem para leitura.

A máquina do responsável tem outros perfis que **não pertencem a este projeto**: `DEFAULT`/`default` e `junior-pessoal` (outras contas pessoais e outros projetos, como `polaris`). Nunca usá-los, mesmo que sejam o perfil ativo.

## Como cumprir

1. **Sempre passe `--profile neurocapacitar` explicitamente.** Nunca confie no perfil ativo, no padrão da CLI ou na vinculação de diretório: eles já apontaram para outra conta (ver "Estado verificado").
2. **Antes do primeiro comando remoto de cada sessão, confirme a identidade** (comandos somente leitura) e **pare se o e-mail não for exatamente o acima**:
   - Neon: `neon me --profile neurocapacitar` → `Email  neurocapacitar.projetos@gmail.com`.
   - Cloudflare: `cf auth whoami --profile neurocapacitar` → `"email": "neurocapacitar.projetos@gmail.com"`.
   - **Não use `wrangler whoami` para verificar:** ele não aceita `--profile` e mostra o login padrão, que não é o do projeto.
3. **Em scripts, documentação, tarefas e CI:** todo comando `wrangler` ou `neon` que fale com a nuvem leva `--profile neurocapacitar` (no CI, o equivalente é um token da conta do projeto, nunca o de outra conta).
4. **Variáveis de ambiente de credencial** (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY` e afins) podem sobrepor o perfil: confirme que não estão definidas, ou que são da conta do projeto. Nunca imprima seus valores.
5. **É proibido** sem autorização explícita do responsável: `login`/`logout`/`auth create|delete|activate|deactivate`, trocar o perfil ativo ou o padrão, `wrangler ... --temporary`, e usar chaves de API de outro perfil. Desvio ou dúvida: pare e reporte.
6. Comandos locais e offline (`vite`, `wrangler types`, `neon --help`) não autenticam; ainda assim, não os use com binding remoto.

## Estado verificado (2026-10-10, somente leitura)

| Item | Resultado |
|---|---|
| Neon, perfil ativo | `DEFAULT` (outra conta). **Sempre** `--profile neurocapacitar` |
| `neon me --profile neurocapacitar` | e-mail `neurocapacitar.projetos@gmail.com`, OAuth |
| `cf auth whoami --profile neurocapacitar` | e-mail `neurocapacitar.projetos@gmail.com`; este diretório está vinculado ao perfil `neurocapacitar` no `cf` |
| `wrangler whoami` (sem `--profile`) | mostra **outra conta** (login pessoal): **não usar sem `--profile`** |
| `wrangler ... --profile neurocapacitar` | perfil criado com `wrangler auth create neurocapacitar` (feito pelo responsável em 2026-10-10; `wrangler login --profile ...` não o cria). Verificado: `wrangler auth list` mostra `neurocapacitar`, e um comando com `--profile neurocapacitar` e `WRANGLER_LOG=debug` usa a conta `90058d5a...` (a mesma do `cf auth whoami --profile neurocapacitar`), não a conta pessoal |
| Variáveis de credencial no ambiente do agente | nenhuma definida |

Na primeira sessão, antes de a regra existir, rodei `wrangler whoami` **sem** `--profile` (somente leitura), que usou a conta pessoal e não o perfil do projeto. Nada foi criado, alterado ou provisionado por esse comando.

## Como verificar o Wrangler

`wrangler whoami` não serve (não aceita `--profile`). Use `wrangler auth list` (deve listar `neurocapacitar`) e compare o ID da conta usada com o de `cf auth whoami --profile neurocapacitar`: rode um comando somente leitura, por exemplo `WRANGLER_LOG=debug wrangler hyperdrive list --profile neurocapacitar`, e confira `accounts/<id>` nas linhas de depuração. Se o Wrangler pedir `CLOUDFLARE_API_TOKEN` ou oferecer `--temporary`, o perfil não está autenticado: pare. Não contornar com `--temporary`, token de outra conta ou o login padrão.

## Relacionado

[Ambientes e release](environment-and-release-safety.md) · [AGENTS.md](../../AGENTS.md) · [tarefas M0](../tasks/M0-fundacao.md)
