# Onboarding — antes do código M0

## O que já existe

- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` e a documentação vigente: [produto](../../PRODUCT.md), [arquitetura](../architecture.md), [especificação](../spec/domain.md), [ADRs](../adr/README.md), [roadmap](../roadmap.md), [tarefas](../tasks/README.md).
- Processo DoR/DoD, `STATUS.md` (M0 não iniciado), modelos de tarefa, ADR e PR.
- Histórico do debate e evidências em [docs/review/](../review/relatorio-final.md).

## O que deliberadamente ainda não existe

- `package.json`, `bun.lock`, scripts, configuração Wrangler, conta Cloudflare configurada ou projeto Neon.
- CI executável, banco provisionado, conta Asaas (sandbox) e Resend configuradas, credenciais.
- Deploy de Staging ou Production, testes passando, migrations aplicadas e dados reais de alunos.

## Pré-requisitos humanos para M0-01

1. Repositório GitHub **privado** já criado: `NeuroCapacitar/lms` (organização, Free). Não usar `NeuroCapacitar/hub` (legado) como destino.
2. Definir quem tem escrita e quem pode publicar em Staging. Production é manual, com credenciais isoladas.
3. Estação de desenvolvimento segura (Windows/PowerShell é suportado). Verificar a versão atual de Bun, Node LTS e Git; **testar o Bun 1.4 no Windows** (spike do M0).
4. Decidir apenas as versões técnicas comprovadas no M0; não copiar lockfile do legado.
5. Nenhuma credencial em `.env.example`; exemplos só com nomes e placeholders falsos.
6. Pendências externas que não bloqueiam o M0: contador (NFS-e), advogado do cliente, cliente (vídeo, marca, cópia off-cloud). Ver [STATUS](../implementation/STATUS.md).

## Antes de começar

Confira que os links de `docs/README.md` abrem, que não há credenciais reais nos arquivos e que a tarefa inicial é M0-01.

## Próximo passo

Autorizar M0-01 com [PROMPT-INICIAL](../implementation/PROMPT-INICIAL.md). Ao concluir, adicione os scripts Bun e atualize o README **somente** com comandos realmente executados.
