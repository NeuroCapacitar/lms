# Instruções de agentes — arquitetura, compatibilidade e manutenção

**Estado:** configuração do starter kit; não comprova funcionamento de agentes externos.  
**Fonte única de política:** [`AGENTS.md`](../../AGENTS.md). Não adicionar regras de negócio em entradas secundárias.

## Objetivo

Um conteúdo canônico, vários pontos de entrada. Codex, Copilot e outros agentes podem descobrir `AGENTS.md` nativamente. Claude Code suporta `CLAUDE.md` e, nas versões atuais, também `AGENTS.md` diretamente, mas o import explícito é compatível com mais ambientes.

## Distribuição PORTÁTIL (recomendada para Windows / GitHub Free privado)

| Caminho | Formato | Função |
| --- | --- | --- |
| `AGENTS.md` | arquivo regular | Fonte de verdade das instruções |
| `CLAUDE.md` | arquivo regular de **uma linha**: `@AGENTS.md` | Importação nativa Claude Code, sem cópia de regras |
| `.github/copilot-instructions.md` | ponte curta com `@../AGENTS.md` | Copilot CLI importa; outros Copilot recebem indicação do arquivo canônico |

**Importante:** a interpretação de `@../AGENTS.md` não é uniforme em todas as interfaces Copilot. GitHub Copilot CLI documenta importação com `@`; GitHub.com Chat pode não expandi-la e o cloud agent normalmente já descobre `AGENTS.md`. Para Chat, abra ou anexe `AGENTS.md` quando o ambiente não o injetar automaticamente. Não afirmar compatibilidade sem testar a interface real.

**Por que não duplicar o texto?** Um arquivo copiado fica desatualizado ou contraditório. O import mantém *um único conteúdo normativo*, embora os entrypoints não sejam byte a byte idênticos.

## Distribuição SYMLINK (somente para checkouts compatíveis)

Nesta variante, `CLAUDE.md` é um symlink para `AGENTS.md` e `.github/copilot-instructions.md` é um symlink para `../AGENTS.md`. São links relativos dentro do mesmo repositório; o objeto Git precisa ter modo `120000`.

Em Linux/macOS, links costumam funcionar. No Windows, o Git pode fazer checkout do objeto de link como **arquivo comum contendo apenas `AGENTS.md` ou `../AGENTS.md`** quando `core.symlinks=false`. Claude Code documenta explicitamente que, no Windows, a forma `@AGENTS.md` é preferível ao symlink. O suporte de symlink nas diferentes interfaces Copilot também precisa ser testado; não presumir carregamento automático do alvo.

Se optar pela variante com symlinks, verifique **no ambiente real**, após `git clone`:

```bash
# Linux/macOS / Git Bash com suporte a links
ls -l CLAUDE.md .github/copilot-instructions.md
# Confirmar tipos armazenados no Git
 git ls-files -s AGENTS.md CLAUDE.md .github/copilot-instructions.md
```

Se `CLAUDE.md` for texto contendo apenas `AGENTS.md`, o link não funcionou no checkout. Substitua os symlinks pelos shims portáteis e registre a alteração no Git antes de usar um agente. Não mude `core.symlinks` em um checkout existente como se isso recriasse automaticamente todos os links.

## Como comprovar que as instruções foram carregadas

- **Codex:** verifique que a sessão reporta/usa o `AGENTS.md` de raiz; instruções mais próximas em subpastas são cumulativas, não cópias arbitrárias.
- **Claude Code:** use `/context` e confirme `CLAUDE.md` importado. O Claude documenta uso de `@AGENTS.md` e a possibilidade de ler `AGENTS.md` diretamente em versões recentes.
- **Copilot CLI:** use `/instructions` para inspecionar quais arquivos foram carregados; valide a importação e ausência de conflitos.
- **Copilot Chat / Code Review:** confirme empiricamente o contexto carregado para a interface utilizada, pois suporte a AGENTS e imports varia por superfície.

**Teste operacional:** peça ao agente para indicar qual documento é canônico e identificar uma invariante de alto risco (por exemplo, matrícula gratuita sem Asaas e ausência de deploy automático de Production). Isso é um smoke de instruções, não prova formal de comportamento seguro.

## Instruções profundas e economia de contexto

`AGENTS.md` orienta regras sempre presentes. O detalhe pertence a `docs/spec`, `docs/tasks`, `docs/adr`, `docs/operations`, `docs/implementation` e, mais tarde, guias por domínio. Não importar todo o planejamento automaticamente no começo de cada chat; carregar apenas a documentação da tarefa.

Não criar dezenas de regras específicas de ferramenta sem benefício mensurável. Se surgir nova instrução para agentes, **primeiro verifique se já está contida** no `AGENTS.md`; corrija a fonte, não a ponte. Valide compatibilidade após updates dos clientes.

## Verificação automatizada

```bash
node scripts/check-agent-instructions.mjs
```

Este comando usa apenas Node.js, que já está previsto no M0, e funciona antes de existir `package.json`. Ele confere os entrypoints e detecta symlinks quebrados, stubs desatualizados e sinais de duplicação. Ele **não comprova** que um produto externo carregará os arquivos automaticamente.

## Referências oficiais (consultadas em 09/10/2026)

- Claude Code: <https://code.claude.com/docs/en/memory>
- GitHub Copilot: <https://docs.github.com/en/copilot/reference/custom-instructions-support>
- Copilot CLI: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions>
- Codex / instruções: <https://developers.openai.com/api/docs/guides/latest-model>
- Convenção AGENTS.md: <https://agents.md/>
- Git `core.symlinks`: <https://git-scm.com/docs/git-config>
