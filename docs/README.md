# Índice canônico — NeuroCapacitar Hub vNext

**Estado:** decisões fechadas (2026-10-10), implementação não iniciada.

## Primeira leitura

- [AGENTS.md](../AGENTS.md): regras do agente.
- [README](../README.md) e [STATUS](implementation/STATUS.md): estado do repositório e execução comprovada.
- [Fluxo de trabalho com IA](operations/ai-development-workflow.md): DoR → DoD.

## Especificação vigente

- [Produto](../PRODUCT.md) · [Glossário](../CONTEXT.md) · [Visual](../DESIGN.md)
- [Arquitetura](architecture.md)
- [Domínio e dados](spec/domain.md) · [Contratos e integrações](spec/contracts.md) · [Segurança, operação e custos](spec/security-operations.md)
- [Decisões (índice)](decisions.md) e [ADRs](adr/README.md)
- [Roadmap M0–M10](roadmap.md) e [tarefas](tasks/README.md)

## Execução e operação

- [STATUS](implementation/STATUS.md) · [M0-01](implementation/M0-01.md) · [Modelo de tarefa](implementation/TEMPLATE-TAREFA.md) · [Prompt inicial](implementation/PROMPT-INICIAL.md)
- [Testes](operations/testing.md) · [Verificação de provider de vídeo](operations/video-provider-checklist.md) · [Banco e migrações](operations/database-and-migrations.md) · [Onboarding](operations/onboarding.md) · [CLIs Cloudflare e Neon: só o perfil `neurocapacitar`](operations/cli-profiles.md) · [Ambientes e release](operations/environment-and-release-safety.md) · [Topologia de instruções](operations/agent-instructions.md)
- [Template de Pull Request](../.github/PULL_REQUEST_TEMPLATE.md)

## Histórico e evidências

- [Registro do debate](review/registro-do-debate.md) (61 decisões) e [relatório final](review/relatorio-final.md).
- [Evidências de pesquisa](review/evidencias/) (legado L1–L4; plataforma, mercado e jurídico W1–W5).
- [Pacote B1–B16 arquivado](_historico/pacote-B1-B16-2026-10-09/): só história; não é fonte de requisito.

## Autoridade das fontes

- Decisões em `decisions.md` e nas ADRs prevalecem sobre o histórico. Uma decisão `superseded` é história.
- Especificação = comportamento esperado. Código e testes = comportamento observado, quando existirem. Um texto aqui **não afirma** que a feature existe.
- Documentos novos referenciam os contratos, não os copiam. Atualize o índice ao criá-los.
