# Prompt sugerido para iniciar o desenvolvimento com IA

Copie a mensagem abaixo **somente depois de preparar o repositório novo** e quando quiser autorizar a execução de M0-01:

> Vamos iniciar a implementação do NeuroCapacitar Hub vNext pelo **M0-01**, exclusivamente. Leia `AGENTS.md`, `docs/README.md`, `docs/implementation/STATUS.md` e a tarefa M0-01 em `docs/tasks/M0-fundacao.md`, com as ADRs 0021 e 0022. Inspecione o estado real do repositório antes de modificar arquivos. Preserve o legado e respeite o teto de infraestrutura de US$ 10/mês (só o Workers Paid, US$ 5, é custo certo) e o GitHub Free privado. Apresente um plano curto para M0-01, execute apenas o escopo autorizado, verifique com comandos reais e reporte arquivos alterados, testes e resultados, bloqueios e próximo passo. **Não avance para outra tarefa sem minha autorização.** Se houver incompatibilidade de stack ou serviço pago extra, apresente evidência e alternativas antes de alterar uma decisão aprovada.

## Prompts para tarefas posteriores

Substitua o ID por uma tarefa realmente liberada, exigindo a consulta às dependências e às ADRs. Um agente não deve se autoconceder permissão para implementar um marco inteiro.

## Como distinguir plano de código

Antes de M0-01, `AGENTS.md` e os documentos são só orientação. `bun run verify` não existe até ser adicionado ao `package.json` e testado. Não interprete checklists como verificação executada.
