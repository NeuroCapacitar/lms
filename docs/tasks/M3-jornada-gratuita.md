# M3 — Jornada gratuita

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega e gate.** A primeira jornada completa de valor, sem dinheiro: a pessoa entra por magic link, se inscreve num curso **gratuito** (Entitlement transacional, **sem Order, Payment, CheckoutSession nem chamada ao Asaas**), estuda respeitando o drip D+N e a sequência guiada/livre, conclui aulas de texto e o curso, e a Staff matricula manualmente, suspende acesso e vê a prévia de aluno sem gravar progresso. **Gate de aceite:** o fluxo E2E roda em Staging com o curso demonstrativo (M2-07): inscrição única mesmo com duplo clique, módulo futuro sem conteúdo no payload, `CourseCompletion` criado uma única vez, expiração tratada por requisição, e nenhum registro de progresso gerado pela prévia. **Pré-requisitos:** M1 e M2 concluídos.

## Ordem recomendada

M3-01 → M3-02 → M3-03 → M3-04 → M3-06 → M3-07 → M3-05 (a E2E é a última).

## Invariantes do marco (valem em todas as tarefas)

- **Entitlement** é a fonte do direito; **Enrollment** é a projeção efetiva por (pessoa, curso). Toda Offer, inclusive a gratuita, tem prazo em **meses**; não há vitalício. A expiração é avaliada **a cada requisição** (comparando `agora` com a expiração efetiva), nunca por cron.
- **Âncora de drip única por (pessoa, curso):** definida no primeiro acesso, **nunca reiniciada**; recompra/nova inscrição após expirar **continua o progresso**. Não existe `EnrollmentEpisode`.
- Toda decisão de acesso passa por **uma** função de servidor; a UI só reflete. Resposta de aula bloqueada **não contém o conteúdo**.
- Valores marcados "(proposto)" e regras PENDENTES devem ser confirmados com o responsável antes de fixar.

---

### M3-01 — Entitlement e Enrollment transacionais
**Dependências:** M1-03, M2-01, M2-02 · **Estado:** `not_started`
**Objetivo:** existe um modelo de direitos de acesso e uma função única `resolveAccess(pessoa, curso, agora)` que diz se há acesso, até quando e por quê.
**Passos:**
1. Tabela `entitlement`: pessoa, curso, `offer_id` (nulo em matrícula manual), `source` (`free_offer|purchase|admin_grant`), `source_ref` (único por `source`, serve de idempotência), `starts_at`, `expires_at` (> `starts_at`), `revoked_at`/motivo, concedido por.
2. Tabela `enrollment` (uma linha por pessoa+curso, criada uma vez): `anchor_at` (definido na criação e **imutável**, protegido por trigger `BEFORE UPDATE` em migration revisada), `effective_expires_at` (maior `expires_at` entre os direitos não revogados), `suspended_at`/motivo. Recalculada na **mesma transação** de toda mudança de Entitlement.
3. Prazo = `starts_at` + N meses de calendário com regra de fim de mês testada (31/jan + 1 mês).
4. Concessões serializam pela linha do Enrollment (`INSERT … ON CONFLICT DO NOTHING`, depois `SELECT … FOR UPDATE`).
5. Regra de empilhamento: cada direito tem janela própria a partir da concessão; o efeito é a **maior** expiração (não soma) — **PENDENTE (confirmar com o responsável)**.
**Testes (PG18):** duas concessões simultâneas → uma linha de Enrollment e uma âncora; `UPDATE` da âncora falha; expiração: `agora` antes/depois da expiração muda o resultado sem nenhuma tarefa agendada; vários direitos (um expirado, um válido) → acesso válido; direito revogado não conta; pessoa suspensa → sem acesso; nova concessão depois de expirar mantém a âncora original.
**Aceite:** `resolveAccess` é a única fonte de decisão e passa em todos os casos acima.
**Fora do escopo / cuidados:** sem cron para expirar; sem `EnrollmentEpisode`; compra paga e revogação por reembolso são do M6; nunca ler a expiração só do cliente.

### M3-02 — Inscrição gratuita
**Dependências:** M3-01, M2-04, M1-09 · **Estado:** `not_started`
**Objetivo:** a pessoa logada clica em "Inscrever-se" num curso com Offer gratuita aberta e passa a ter acesso, uma única vez, sem pagamento.
**Passos:**
1. `POST /api/courses/:id/enroll` (autenticado, termos aceitos, conta ativa): valida que a Offer é `free`, está **aberta** e o curso está publicado (função de "adquirível" do M2-01); cria Entitlement `free_offer` e recompõe o Enrollment na mesma transação; retorna o estado de acesso.
2. Idempotência: se já há acesso válido, devolve o estado atual sem novo direito; se expirou, cria novo direito e mantém âncora e progresso.
3. Botão e estados na página do curso e no catálogo; fluxo "login com retorno" usando `returnTo` apenas como **caminho relativo interno** (validado; nada de URL externa).
4. Regra de arquitetura (dependency-cruiser): o módulo de matrícula **não** importa nada de pagamentos/Asaas.
**Testes (PG18 + API):** 10 requisições simultâneas → exatamente um Entitlement; pessoa suspensa → 403; Offer pausada depois de carregada a página → erro `offer_unavailable`; Offer paga nesta rota → recusada; sem aceite de termos → bloqueio; sem sessão → 401; reinscrever após expirar mantém a âncora; a regra do dependency-cruiser falha se alguém importar o adapter de pagamentos.
**Aceite:** pessoa recebe acesso gratuito, sem Order nem Payment, e o duplo clique não cria direito duplicado.
**Fora do escopo / cuidados:** não criar Payment de R$ 0; compra e checkout são do M6; interesse por curso fechado é do M5.

### M3-03 — Resolução de aula, drip D+N e sequência
**Dependências:** M3-01, M2-02 · **Estado:** `not_started`
**Objetivo:** o aluno vê o mapa do curso e só abre as aulas liberadas para a situação dele; o servidor decide sempre.
**Passos:**
1. Função pura de domínio `computeLessonAccess` (módulo `drip_days`, `anchor_at`, `agora`, `sequence_mode`, aulas obrigatórias concluídas, aula opcional, retirada) com códigos de motivo: `no_access`, `expired`, `suspended`, `drip_locked` (com data de liberação), `sequence_locked`, `retired`.
2. Regras: módulo libera em `âncora + N dias` contados em **dias civis de America/Sao_Paulo** (proposto; confirmar); `free` = qualquer aula liberada; `guided` = a aula só abre após as **obrigatórias anteriores** concluídas, e **opcionais nunca bloqueiam**; acesso expirado bloqueia tudo.
3. `GET /api/courses/:id/outline` (módulos e aulas com estado e data de liberação, títulos sim, conteúdo não) e `GET /api/lessons/:id` (conteúdo só se permitido; caso contrário o código de motivo, **sem** corpo).
4. Telas: início do curso com o mapa, página da aula (anterior/próxima) e mensagem de "Libera em dd/mm".
**Testes:** unitários em tabela (fronteira de meia-noite, D+0, módulo sem dias, opcional, guided × free); API: resposta de módulo futuro **não contém** o campo de conteúdo; opcional não bloqueia a próxima; aula retirada não aparece; pessoa não inscrita ou de outro curso → 403; acesso expirado → bloqueado mesmo com aula "liberada"; re-inscrição não reinicia o drip; Playwright com relógio controlado.
**Aceite:** aluno vê e abre só o liberado; nenhum vazamento de conteúdo bloqueado.
**Fora do escopo / cuidados:** não calcular acesso na UI; vídeo/quiz são do M5; sem aula "desbloqueada" por exceção da Staff.

### M3-04 — Conclusão manual da aula de texto e progresso obrigatório
**Dependências:** M3-03 · **Estado:** `not_started`
**Objetivo:** o aluno conclui aulas de texto pelo botão "Concluir"; o progresso conta só as obrigatórias, e a conclusão do curso nasce uma única vez.
**Passos:**
1. Tabela `lesson_completion` (pessoa, aula, quando, método `manual`), única por pessoa+aula. `POST /api/lessons/:id/complete`: só aula de texto, com acesso, liberada e (se guiada) disponível; idempotente.
2. Progresso = obrigatórias concluídas ÷ obrigatórias publicadas não retiradas; opcionais ficam fora do cálculo e podem ser concluídas.
3. Tabela `course_completion` (única por pessoa+curso; `completed_at`; total de obrigatórias no momento). Criada **na mesma transação** da última obrigatória, depois de travar a linha do Enrollment (`FOR UPDATE`). Persiste mesmo que o currículo mude depois.
4. Botão "Concluir", barra de progresso e mensagem de conclusão do curso.
**Testes (PG18):** duas conclusões simultâneas da última aula → um só `course_completion`; repetir a conclusão é no-op; aula opcional não altera o percentual; publicar nova aula obrigatória depois da conclusão não apaga nem duplica a conclusão (o percentual pode cair); aula retirada sai dos totais; aula não liberada ou sem acesso → recusada; conclusão por pessoa sem inscrição → 403.
**Aceite:** conclusão histórica única e estável.
**Fora do escopo / cuidados:** vídeo **nunca** conclui por aba aberta e não tem botão manual (M5); sem conclusão manual pela Staff; sem outbox/certificado agora (gancho é do M7-01). Momento de reconhecer a conclusão quando a retirada de uma aula deixa tudo concluído: **PENDENTE (decisão do responsável)**.

### M3-06 — Matrícula manual, suspensão de acesso e lista de inscritos
**Dependências:** M3-01, M1-03 · **Estado:** `not_started`
**Objetivo:** a Staff com grant matricula uma pessoa com duração em meses e suspende acesso; qualquer Staff vê quem está inscrito.
**Passos:**
1. `POST /api/staff/enrollments` (`enrollment.manage`): pessoa **já cadastrada**, curso, meses (inteiro ≥1), motivo, `requestId` (vira `source_ref`, evita duplicidade); cria Entitlement `admin_grant` e recompõe o Enrollment; `audit_log`.
2. `POST …/suspend` e `…/reinstate` (`enrollment.manage`): preenche/limpa `suspended_at` com motivo; não altera direitos nem a âncora.
3. Ajuste de prazo **somente de matrícula `admin_grant`** (`enrollment.support_edit`), nunca de compra.
4. Lista paginada de inscritos por curso (qualquer Staff, sem grant): nome, e-mail, situação, expiração e % de progresso.
**Testes (PG18 + API):** Suporte sem grant → 403 nas escritas e 200 na lista; duplo envio com o mesmo `requestId` → um direito; suspensão vale na requisição seguinte e reinstalar mantém a âncora; matrícula não cria Order/Payment; pessoa inexistente → erro claro; auditoria registra autor, alvo e motivo.
**Aceite:** a Staff resolve "preciso liberar/bloquear essa pessoa" sem tocar no banco.
**Fora do escopo / cuidados:** não criar usuário pela matrícula (a pessoa se cadastra por link antes — limitação a confirmar); sem revogação por reembolso (M6); sem exceção de conclusão.

### M3-07 — Prévia de aluno (Staff, sem gravar progresso)
**Dependências:** M3-03, M3-04, M1-10 · **Estado:** `not_started`
**Objetivo:** qualquer Staff abre o curso publicado como o aluno vê, para revisar o conteúdo, sem criar matrícula nem progresso.
**Passos:**
1. Rotas separadas `/api/staff/preview/courses/:id/outline` e `…/lessons/:lessonId` devolvendo o **mesmo formato** das rotas do aluno, com `preview: true`; acesso por papel Staff (sem grant); ignoram direito, drip e sequência.
2. Nenhuma rota de escrita do aluno aceita a Staff sem matrícula real; a UI de prévia usa os mesmos componentes, com faixa fixa "Prévia — nada é gravado" e "Concluir" desabilitado.
3. Staff que também está matriculada continua estudando normalmente pelas rotas do aluno.
**Testes:** percorrer o curso inteiro em prévia não cria linha em `entitlement`, `enrollment`, `lesson_completion` nem `course_completion`; aluno comum chamando a rota de prévia → 403; tentativa de concluir aula em prévia → recusada pelo servidor; a faixa aparece e é acessível (axe).
**Aceite:** prévia sem nenhum efeito colateral comprovado no banco.
**Fora do escopo / cuidados:** não é impersonation nem login como o aluno; prévia de **rascunho** é do Course Builder (M2-03).

### M3-05 — Primeira jornada E2E gratuita
**Dependências:** M3-02, M3-03, M3-04, M3-06, M3-07 · **Estado:** `not_started`
**Objetivo:** provar de ponta a ponta, em Staging, a jornada gratuita e as ações de Staff, sem dependência do Asaas.
**Passos:**
1. Usar o curso demonstrativo (M2-07) e dois usuários sintéticos (aluno e Suporte com grant).
2. Playwright (Chromium): cadastro/login por magic link → inscrição → abrir aula D+0 → ver D+7 bloqueado → concluir obrigatórias → conclusão do curso → sair e reentrar. Local/CI usa o remetente falso do M1-06; em Staging o link chega a uma caixa de teste (passo assistido, anotado como tal).
3. Fluxo da Staff: matricular manualmente, suspender, reativar e abrir a prévia.
4. Medir a latência das chamadas principais e conferir que os logs trazem `correlation id` sem e-mail ou token.
**Testes:** os fluxos acima mais negativos de autenticação (sem sessão, sessão expirada, acesso a aula de outro curso).
**Aceite:** jornada completa executada em Staging, com comandos, resultados e SHA registrados em `docs/implementation/STATUS.md`.
**Fora do escopo / cuidados:** testes unitários sozinhos não fecham o M3; não registrar resultado que não foi executado; nenhum dado real.

---

**Notas de migração.** M3-01..M3-05 preservados, adaptados ao modelo novo: removidos o "episódio de drip" e a recomposição por `CourseRelease` do antigo M3-01/M3-03/M3-04 (decisões Q31/Q33 e Q32); o percentual é calculado sobre o currículo vivo publicado. Novos: M3-06 (matrícula manual, Q17) e M3-07 (prévia de aluno, Q25).
