# NeuroCapacitar Hub vNext — pacote de especificação e execução

**Versão:** 2026-10-09 · **Situação:** decisões de arquitetura B1–B16 aprovadas; especificação consolidada para orientar a implementação. **Código vNext:** ainda não implementado neste pacote. **Aplicação legada:** não modificada.

## Ordem de leitura

1. [01 — Auditoria de consistência](01-auditoria-de-consistencia.md): substituições, tensões, riscos e validações obrigatórias.
2. [02 — Arquitetura consolidada](02-arquitetura-consolidada.md): visão do produto, infraestrutura, fluxos e escopo.
3. [03 — Modelo de domínio e dados](03-modelo-de-dominio-e-dados.md): agregados, invariantes, histórico e concorrência.
4. [04 — Contratos e integrações](04-contratos-e-integracoes.md): API, filas, vídeo, e-mail, mídia e certificados.
5. [05 — Segurança, operação e custos](05-seguranca-operacao-e-custos.md): proteção, backups, ambientes e go-live.
6. [06 — Plano mestre](06-plano-mestre-de-implementacao.md): milestones M0–M10 e dependências.
7. [07 — Tarefas detalhadas](07-tarefas-detalhadas.md): tarefas executáveis, DoR/DoD, procedimentos e testes.
8. [08 — Rastreabilidade e pendências](08-rastreabilidade-e-pendencias.md): requisitos → tarefas → provas; riscos e critérios de avanço.
9. [09 — Registro de decisões](09-registro-de-decisoes.md): índice canônico de decisões vigentes/substituídas.

## Como interpretar estes documentos

- **Aprovado** significa acordo de arquitetura/produto; **não** significa implementado ou testado.
- **Critério de aceite** significa teste ou evidência **a produzir**, e não prova de que já funciona.
- **Proposta de implementação** identifica nomes de arquivos, APIs e componentes sugeridos. Esses detalhes não substituem o contrato de domínio aprovado.
- **Pendente de validação** identifica pontos de compatibilidade, custo, segurança ou licenciamento que exigem um teste ou evidência real antes da adoção.
- O arquivo de handoff de 08/10/2026 fornece uma reconstrução estruturada das decisões B1–B11; as ratificações e revisões B12–B16 ocorreram nas rodadas posteriores, incluindo IMG-R1 a IMG-R6. Esta edição não pressupõe execução do código da vNext.
- **Prioridade em caso de contradição:** aprovação explícita mais recente → contrato de domínio vigente → ADR → proposta de implementação; o comportamento do legado é evidência, não autoridade da vNext.
- Os links de preços e documentação indicam verificação em outubro de 2026. Revalidar no provisionamento e antes do lançamento.

## Limites essenciais

- Repositório novo **privado de conta pessoal GitHub Free**. Sem GitHub Pro e sem depender de branch protection ou Environment Secrets para privado.
- Cloudflare Workers **Paid, base US$ 5/mês por conta**, não teto geral de gastos. **Images Hosted não será contratado**. Imagens canônicas no **R2**, transformações gratuitas públicas quando cabíveis; excedentes e fornecedores adicionais podem cobrar separadamente.
- **React SPA + Vite + Cloudflare Workers/Hono** em monólito modular; **Neon Postgres 18 + Drizzle + Hyperdrive**.
- **Nenhuma migração obrigatória dos dados beta/legado**; coexistência temporária e preservação de certificados/obrigações existentes.
- V1 inclui tudo que foi aprovado: livre/gratuito e pago, Auth/Staff, vídeo por provider, quizzes, discussões, certificados avançados, PWA offline seletiva, Resend, segurança e recuperação.

## Mapa das fases

`M0 Fundação → M1 Identidade → M2 Currículo/Autoria mínima → M3 Jornada gratuita → M4 Assíncrono → M5 Aprendizagem completa → M6 Comércio → M7 Certificados → M8 PWA → M9 Operações/refinamento → M10 Homologação e lançamento`.

Os marcos são de planejamento; dependências podem exigir trabalhar no núcleo assíncrono antes de completar M3 ou em UI/observabilidade desde M0. **Nenhum marco intermediário autoriza lançamento de v1 incompleta**.
