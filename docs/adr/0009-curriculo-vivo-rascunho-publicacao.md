# ADR-0009 — Currículo vivo com rascunho e publicação atômica

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q22 (condicional), Q32 (decidido: opção B)
- **Substitui:** de B2, `CourseRelease` com `ModuleRevision`/`LessonRevision` imutáveis; e o clone de `CoursePublication` + `curriculum_key` do legado

## Contexto

O legado nasceu com "versão fixada por Matrícula", reverteu em ~24 h para currículo vivo, mas manteve a clonagem física por publicação. Isso gerou `curriculum_key`, projeção de watch entre publicações, identidade de discussão por `curriculum_key` e joins laterais em toda leitura de progresso; a revisão de 2026-07-22 achou 8 problemas, incluindo progresso perdido ao publicar (evidência: L2 §2.1–2.3). Revisões imutáveis (A) seriam o mesmo custo com outro nome; o responsável escolheu B (Q32).

## Decisão

- **Uma estrutura viva** de Módulos/Aulas por Course, mais **área de rascunho** editável. **Publicar** aplica o rascunho **atomicamente**, após validação.
- **IDs estáveis** de Module e Lesson; progresso, discussões, quiz e vídeo referenciam o ID diretamente. Proibido reintroduzir `CourseRelease`, revisões, `curriculum_key` ou clone por publicação.
- Alunos sempre leem o currículo vigente (sem coorte fixada).
- **`CourseCompletion` é fato histórico**: conclusão passada não é desfeita por mudança posterior; o certificado usa snapshot próprio.
- Validações de publicação herdadas como casos (ex.: vídeo sem player ou duração bloqueia; Aula obrigatória nunca disponível), a revalidar (evidência: L2 §2.2). Remoção de aula com progresso: arquivar, não apagar.
- Modelo físico do rascunho e catálogo de validações: PENDENTE (spec de domínio).

## Consequências

- Sem histórico de "o que o aluno viu"; só auditoria de quem publicou e quando.
- Edição de obrigatórias muda o denominador do progresso de quem está em andamento.
- Queries de leitura simples, sem laterais; menos testes "entre publicações".

## Como validar

- Testes de integração PG18: publicar com alunos em progresso mantém progresso; publicação concorrente é serializada; rascunho não vaza ao aluno.
- Nenhuma tabela ou coluna `revision`/`curriculum_key` no schema (gate de revisão).
