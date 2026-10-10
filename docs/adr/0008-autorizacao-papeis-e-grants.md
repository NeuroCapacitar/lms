# ADR-0008 — Autorização: papéis não exclusivos e grants granulares, deny-by-default

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q25, Q34, Q42; B3
- **Substitui:** o papel único e exclusivo e os grants em `text[]` do legado

## Contexto

O legado tinha papel único `admin|support|student` e grants em arrays com CHECKs enormes; quem aceitava convite de Staff perdia a experiência de aluno; não havia middleware central, só 124 chamadas a `requirePermission`, e um teste lia o código-fonte procurando strings (evidência: L3 §2.1–2.5). O achado F-001 (P1) mostrou `support` cruzando fronteiras por gate de papel e não de capacidade.

## Decisão

- Papéis `student` (implícito), `support`, `admin`, **não exclusivos**, mais **grants normalizados** em tabela. Autorização **deny-by-default** por capacidade, recurso e estado, **no servidor** (middleware/caso de uso central); o controle visual não autoriza.
- **Só Admin:** criar curso; oferta, preço e disponibilidade; template e emitente do certificado; revogar certificado; convidar Staff e gerir papéis/grants; credenciais de integração; manutenção.
- **Delegável por grant ao Suporte:** editar curso (detalhes, módulos, aulas, quizzes, recursos **e publicar**); matricular manualmente/suspender acesso; editar matrícula de suporte; reembolsar; revisão financeira; ver pedidos/análise financeira; reemitir certificado; moderar discussões; editar FAQ/Ajuda; ver auditoria; operar fila.
- **Sem grant:** ver inscritos, cursos e fila; prévia de aluno; responder pedidos de suporte.
- ≥1 Admin ativo, com trava no banco; sem impersonation nem edição genérica de User; mudança de papel/grant revoga sessões e é auditada.
- Catálogo final de nomes de grants: PENDENTE (spec de domínio).

## Consequências

- Mais tabelas e testes que o array do legado; em troca, constraints simples e auditoria por grant.
- Grants dependentes (ex.: reembolso exige ver financeiro) precisam de regra explícita.

## Como validar

- Testes de acesso cruzado direto pela API, por grant e por estado (usuário suspenso, grant removido sem logout).
- Teste de corrida: remoção simultânea de dois Admins preserva ≥1 (lock de linha, [ADR-0005](0005-banco-neon-free-hyperdrive-drizzle.md)).

## Emenda (2026-10-10, M1-03)

- **Catálogo fechado** em `src/features/identity/capabilities.ts`: 7 só-Admin, 11 delegáveis (`course.edit`, `access.grant`, `enrollment.support_edit`, `refund.execute`, `finance.review`, `finance.view`, `certificate.reissue`, `discussion.moderate`, `help.edit`, `audit.view`, `ops.queue`) e `staff.read` (leitura básica, sem grant). O nome `access.grant` (spec de domínio) substitui `enrollment.manage` (sugestão da tarefa). Um teste compara o CHECK do banco com o catálogo.
- **Invariante do Admin sob concorrência:** trava `FOR UPDATE` só nas linhas de papel de Admin e leitura das suspensões **depois** da trava, em instrução separada (uma junção na consulta travada deixava passar um Admin suspenso por operação concorrente em READ COMMITTED; achado dos testes).
- **Mudança de papel, grant ou suspensão encerra as sessões** da pessoa e grava auditoria na mesma transação; conta suspensa não ganha sessão nova.
