# M4 — Assíncrono e e-mail

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Marco.** Entrega a base que torna seguro tudo o que fala com o mundo externo: outbox/inbox em Postgres (fonte da verdade), **duas** Queues por ambiente (`hub-finance` e `hub-general`, cada uma com DLQ), Cron de reconciliação a cada 30 min, e-mail transacional via Resend Hosted Templates (10 templates + magic link) com webhook Svix e supressão, adiamento do excedente da cota Free e um Operations Center inicial. **Gate de aceite:** fault matrix inteira com um teste por linha (PG18 real + workerd) passando; em Staging, uma mensagem sobrevive a "publish perdido" e a "consumer morto" e chega ao fim sem ação manual; nenhum e-mail excede a cota diária; Staff vê fila travada e DLQ sem ver segredos. Fonte das decisões: [registro do debate](../review/registro-do-debate.md) (Q39, Q43, Q44, Q54) e evidência L3 §6.

**Como ler.** Dependências em M0–M3 usam os IDs do backlog antigo (M0-03 Wrangler/bindings, M0-04 Postgres/Drizzle/Hyperdrive, M0-08 deploy Staging, M1-01 Better Auth, M1-03 RBAC); confira com `docs/tasks/M0..M3` se foram renumerados. "Spike N" = spike N da lista do M0 (3 = latência/orçamento Neon, 5 = webhook Asaas, 9 = evlog/Sentry). Ordem sugerida: 01 → 02 → 03 → 06 → 04 → 07 → 08 → 05. Regras que valem para todas as tarefas: payload de Queue e de outbox leva **só IDs** (nunca e-mail, nome, token, segredo); **nenhuma chamada a provider dentro de transação PG**; tempo de lease sempre pelo `now()` do banco, não pelo relógio do Worker; sem advisory locks.

**Removida/fundida:** nenhuma. A antiga M4-02 ("cinco filas") passa a duas filas (Q44). Novas: M4-06 (fault matrix, antes diluída nas outras), M4-07 (webhook Resend), M4-08 (cota Free).

---

### M4-01 — Núcleo Postgres de outbox e inbox com lease por linha

**Dependências:** M0-04, M1-03 · **Estado:** `verified` no CI (2026-10-12; Staging pendente, ver STATUS)

**Objetivo:** gravar uma "intenção" (e-mail, chamada a provider, tarefa) na **mesma transação** da mudança de domínio e poder reivindicá-la com segurança por vários workers, sem perder nem duplicar o efeito além do at-least-once. O inbox guarda eventos externos (Asaas, Resend) antes de qualquer processamento.
**Passos:**
1. Migration SQL (revisada à mão, forward-only): `outbox_messages` (id, kind, queue `finance|general`, `dedupe_key` UNIQUE, payload só-IDs jsonb, estado `pending|leased|delivered|failed|dead|superseded`, attempts, `available_at`, `lease_owner`, `lease_until`, `lease_version`, `correlation_id`, `last_error_code`) e `inbox_events` (provider, `event_id`, UNIQUE(provider, event_id), payload limitado, estado, mesma estrutura de lease). Índice parcial nas linhas reivindicáveis.
2. Função nomeada `claimOutbox(n, owner)` em SQL cru: `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING`, reivindicando `pending` com `available_at <= now()` **e** `leased` com `lease_until < now()`; cada claim incrementa `lease_version` (fencing).
3. `completeOutbox/failOutbox/requeue` só atualizam `WHERE id=$1 AND lease_version=$2`; zero linhas afetadas = lease perdido, o worker descarta o resultado e **não** repete o efeito.
4. API `enqueueIntent(tx, input)` que **exige** o `tx` da transação de domínio (tipo impede chamada fora dela) e valida `kind` e payload com Zod.
5. Backoff exponencial com jitter e teto de tentativas; esgotado → `dead` (não apaga). Retenção: entregues/superseded 30 dias, `dead` 180 dias (valores do legado; ajustar só com motivo).
**Testes:** PG18 real com duas conexões reivindicando ao mesmo tempo (nenhuma linha em dois workers); lease expirado reassumido e o worker antigo falha ao concluir; `dedupe_key` repetida não duplica; rollback da transação de domínio não deixa intenção órfã; payload com campo de PII é rejeitado pelo Zod; teste estático/lint que falha se `enqueueIntent` for chamado sem `tx`.
**Aceite:** intenção é durável mesmo se nada for enfileirado; claim concorrente é provadamente exclusivo; fencing impede conclusão por worker com lease perdido.
**Fora do escopo / cuidados:** não usar `pg_advisory_lock`; não usar a Queue como armazenamento; não criar `BaseRepository`/barramento de eventos genérico. SQL cru só nestas funções nomeadas e testadas.

### M4-02 — Duas Queues por ambiente, DLQs e consumers tipados

**Dependências:** M4-01, M0-03 · **Estado:** `verified` no CI (2026-10-12; Queue real só no Staging, ver STATUS)

**Objetivo:** acelerar a entrega do outbox via `hub-finance` (webhooks Asaas, pagamento, reembolso, reconciliação) e `hub-general` (e-mail, interesse, limpeza, certificado no M7), cada uma com DLQ, em Dev/Staging/Production isolados.
**Passos:**
1. Declarar no Wrangler, por ambiente, as duas filas e as duas DLQs (nomes exatos conforme convenção do M0-03); `wrangler types --check` verde.
2. Envelope versionado `{v, kind, intentId, correlationId}` com Zod; versão desconhecida ou `kind` desconhecido → DLQ + alerta (nunca `ack` silencioso).
3. Consumer: recebe `intentId`, faz `claimOutbox` daquela linha, executa o handler do `kind` e conclui com fencing. Handler lança erro tipado `Transient` (→ `retry` com atraso) ou `Permanent` (→ `failOutbox` e `ack`).
4. Produtor pós-commit: `ctx.waitUntil(queue.send(...))` best-effort; falha no envio é registrada e **não** falha a requisição (o Cron do M4-03 recupera).
5. Consumer da DLQ: marca a linha `dead` no Postgres com o motivo e gera sinal de alerta (a DLQ da Cloudflare retém só 4 dias; o Postgres é a verdade).
6. Concorrência/lote iniciais baixos (proteger conexões do Neon Free via Hyperdrive); valores justificados no PR. Kill switch por categoria lido de tabela `system_flags` (consumer pausa e devolve com atraso).
**Testes:** `@cloudflare/vitest-plugin` com mensagem duplicada, versão antiga, `kind` desconhecido, handler Transient/Permanent, DLQ; handler demonstrativo só executa após claim válido; kill switch ligado não consome nem perde mensagens.
**Aceite:** um efeito demonstrativo roda exatamente uma vez no caminho feliz e no máximo uma vez "efetivo" sob duplicata; mensagens venenosas terminam `dead` e visíveis.
**Fora do escopo / cuidados:** não criar cinco filas (decisão Q44; revisável só com nova decisão); não colocar PII/segredo no envelope; não presumir exactly-once.

### M4-03 — Cron de reconciliação a cada 30 minutos

**Dependências:** M4-01, M4-02 (spike M0-12 para o orçamento) · **Estado:** `verified` no CI (2026-10-13; Cron real e soak de CU-h só no Staging, ver STATUS)

**Objetivo:** toda intenção pendente avança ou chega a estado investigável sem ação manual, acordando o Neon Free o mínimo possível.
**Passos:**
1. `triggers.crons = ["*/30 * * * *"]` por ambiente; o handler `scheduled` abre **uma** conexão, roda os jobs e fecha.
2. Lista simples de jobs nomeados `{name, run(ctx)}` (sem framework): (a) reivindicar leases vencidos e republicar `pending` antigos nas filas; (b) processar `inbox_events` pendentes; (c) liberar mensagens adiadas (M4-08); (d) retenção/purga das tabelas do M4-01; (e) ganchos que M5-07 (limpeza de órfãos R2) e M6-04 (reconciliação Asaas) registram.
3. Cada job tem lease em linha própria (`job_runs`) para que execuções sobrepostas não dupliquem trabalho; registrar início, fim, contagem e erro em `job_runs`.
4. Sair cedo: se a primeira consulta mostrar nada a fazer, encerrar sem as demais.
5. Orçamento: registrar duração de cada execução e conferir CU-h no painel Neon durante a soak em Staging. Premissa **a validar** (não é resultado): 48 execuções/dia, cada uma mantendo o compute ativo ~5 min antes do scale-to-zero ≈ 4 h/dia de compute. Gatilho de upgrade do registro (Q43): >70 CU-h/mês; Staging pode rodar com frequência menor enquanto não houver teste.
**Testes:** falha injetada: publish perdido (linha `pending` antiga sem mensagem na fila), lease vencido, provider fora do ar; duas execuções simultâneas do Cron; job que lança erro não impede os demais; Cron com banco acordando devagar (timeout) termina com erro registrado.
**Aceite:** em Staging, uma intenção cuja mensagem foi descartada é concluída pelo Cron em ≤ 2 ciclos; `job_runs` mostra a última execução.
**Fora do escopo / cuidados:** não aumentar a frequência para "ficar mais rápido" (cada execução custa CU-h do Neon Free); varredura cega de provider é proibida aqui (reconciliação Asaas é só de pendentes, ver M6-04).

### M4-04 — Entrega transacional via Resend (Hosted Templates)

**Dependências:** M4-01, M4-02, M1-01 · **Estado:** `implemented` (2026-10-13; CI pendente; Resend real e modelos hospedados não exercitados, ver STATUS)

**Objetivo:** enviar os e-mails do produto pelo outbox, com template editorial hospedado no Resend e contrato tipado no código; falhar no e-mail nunca bloqueia acesso.
**Passos:**
1. `EmailTemplateContract` por template: alias do Resend, variáveis (Zod), remetente, `replyTo`, classe de prioridade, `critical` sim/não. Lista inicial = os 10 do contrato antigo — `email-verification`, `password-reset`, `staff-invitation`, `purchase-confirmed`, `access-granted`, `access-expiry-warning`, `certificate-issued`, `refund-completed`, `support-request`, `course-available` — **mais** `magic-link`. Confirmar com M1 quais seguem necessários (com magic link como método base, `email-verification`/`password-reset` só servem a senha opcional do aluno).
2. Adapter `ResendMailer` por `fetch` (sem React Email): envia `template` + variáveis, com chave de idempotência do Resend (janela de ~23 h no legado) derivada do `intentId`; sem tracking de abertura/clique.
3. Tabela `email_messages` (sem corpo, sem destinatário em claro, sem token): estados `queued|sending|accepted|acceptance_unknown|delivered|delayed|bounced|complained|failed|suppressed|blocked`. Timeout/5xx → `acceptance_unknown`: repetir **só** com a mesma chave dentro da janela; fora dela, marcar para revisão.
4. `magic-link` segue caminho direto (sem outbox: o token vive só em memória), usando o mesmo adapter e a contabilidade de cota do M4-08; consumido pelo hook do M1.
5. Dev: adapter falso gravando em tabela de captura. Staging: Resend real **somente** para destinatários numa allowlist; os demais viram `blocked`. Verificador de templates (publicados, variáveis batem) rodando em Staging e no preflight de Production.
6. Redaction: nenhum log/Sentry contém e-mail, token ou URL de link.
**Testes:** mock do Resend em accepted/429/5xx/timeout; mesma intenção entregue 2× produz 1 envio; variável faltando/extra falha antes do envio; allowlist em Staging; envio real em Staging com conta de teste; PII scan nos logs do teste.
**Aceite:** falha de e-mail não desfaz matrícula, pagamento ou reembolso; cada envio é rastreável por `email_messages`; nenhum template React Email no repositório.
**Fora do escopo / cuidados:** marketing/broadcast (consentimento próprio, M9); e-mail de resposta de discussão (adiado); texto editorial vive no Resend, não no Hub. Domínio de envio e DKIM/SPF/DMARC dependem da zona DNS movida no M0.

### M4-05 — Observabilidade e Operations Center inicial

**Dependências:** M4-01, M4-02, M0-08 (spike M0-18) · **Estado:** `not_started`

**Objetivo:** a Staff enxerga fila travada, DLQ, última execução do Cron, silêncio de webhook e cota de e-mail; o desenvolvedor segue uma requisição de ponta a ponta.
**Passos:**
1. Logging por evento amplo com `evlog` **se** o spike 9 passou; senão JSON estruturado próprio com o mesmo contrato (`correlationId`, ambiente, release, resultado, duração). Allowlist de campos; nunca PII/segredo.
2. Propagar `correlation_id` HTTP → outbox → envelope → provider.
3. Sentry Free (1 usuário) com `beforeSend` que remove PII; Workers Logs/Traces ligados; Web Analytics sem replay.
4. Página Staff "Operação" (somente leitura por padrão): contagem por fila/estado, idade da mais antiga, DLQ, última execução de cada job, último webhook recebido por provider, cota de e-mail usada. Ações (reenfileirar item `dead`, com motivo e auditoria) exigem o grant "operar fila operacional"; kill switch e manutenção só Admin.
5. Alertas iniciais P0–P3 (taxonomia completa e runbooks no M9): mais antiga > limite, DLQ > 0, Cron sem rodar > 90 min, cota de e-mail ≥ gatilho. Entrega por Sentry; e-mail de alerta só com dedupe e limite diário (conta na cota do M4-08).
**Testes:** correlação em um teste que percorre HTTP→Queue→provider falso; varredura de PII em logs/eventos Sentry de teste; simular DLQ e ver na tela; Suporte sem grant não vê ações; nenhuma resposta da API contém segredos.
**Aceite:** em Staging, derrubar um handler propositalmente mostra a fila travada e o alerta; auditoria registra a ação de reenfileirar.
**Fora do escopo / cuidados:** Sentry não substitui trilha financeira/auditoria durável; sem plantão 24/7; limites de alerta são valores iniciais e devem ser justificados no PR, não inventados como "SLO".

### M4-06 — Fault matrix executável

**Dependências:** M4-01, M4-02, M4-03 · **Estado:** `implemented` (2026-10-13; CI pendente, ver STATUS)

**Objetivo:** provar, linha a linha, que o desenho tolera as falhas previstas.
**Passos:** criar suíte tabular (um teste nomeado por linha) com: (1) publish perdido; (2) Queue entrega duplicada; (3) payload de versão anterior; (4) claim concorrente; (5) consumer morre entre "provider aceitou" e "gravei no banco"; (6) lease perdido; (7) mensagem vai à DLQ; (8) backlog sem jobs novos (só o Cron resolve); (9) provider 429/5xx; (10) poison event; (11) kill switch ativado. Para (5), o handler demonstrativo deve reler o estado do provider antes de repetir (sem retry cego).
**Testes:** PG18 real + workerd com falha injetada por ponto (adapter falso que lança em passos configuráveis).
**Aceite:** 11 linhas, 11 testes verdes; a suíte roda no CI bloqueante.
**Fora do escopo / cuidados:** não afirmar exactly-once; cada nova categoria (M5/M6/M7) acrescenta suas linhas, não cria outra matriz.

### M4-07 — Webhook Resend (Svix) e supressão

**Dependências:** M4-04, M4-01 · **Estado:** `not_started`

**Objetivo:** refletir entrega/bounce/complaint em `email_messages` e impedir novos envios a endereços problemáticos.
**Passos:**
1. Rota `POST /api/webhooks/resend`: ler o corpo **bruto**, verificar assinatura Svix (`svix-id`, `svix-timestamp`, `svix-signature`, HMAC-SHA256 com o segredo do endpoint, tolerância de tempo ~5 min, comparação em tempo constante). Inválida → 400 sem gravar.
2. Inbox mínimo: tipo do evento, id do e-mail no Resend, instante; sem corpo e sem destinatário. Resposta 200 após o `INSERT ... ON CONFLICT DO NOTHING`; processamento pelo outbox/Cron.
3. Mapear eventos de entrega (delivered, delayed, bounced, complained, failed/suppressed — conferir a lista vigente na doc e no sandbox) para o estado de `email_messages`.
4. `EmailRecipientState` por **hash HMAC** do e-mail normalizado: hard bounce/complaint → `suppressed`; o outbox não envia a endereço suprimido (exceto decisão em contrário, abaixo).
5. Bounce/complaint **não** alteram User, Enrollment ou Order; aparecem na tela Staff.
**Testes:** assinatura válida/ausente/adulterada/expirada; evento duplicado; evento fora de ordem (delivered depois de bounced não "desfaz"); supressão bloqueia próximo envio; teste real em Staging com endereço de teste do Resend.
**Aceite:** estado de entrega reflete eventos reais em Staging; nenhum e-mail ou corpo persistido no inbox.
**Fora do escopo / cuidados:** PENDENTE (responsável): se `magic-link` ignora supressão por complaint (padrão proposto: não ignora, a tela orienta contatar o suporte). Resend Free pode limitar endpoints/webhooks: PENDENTE (verificar na conta).

### M4-08 — Cota do Resend Free: adiar o excedente

**Dependências:** M4-04 · **Estado:** `not_started`

**Objetivo:** nunca estourar 100 e-mails/dia (3.000/mês) nem deixar e-mail de baixa prioridade bloquear login/pagamento.
**Passos:**
1. Livro-razão `email_send_ledger` (dia, contagem aceita) alimentado a cada envio aceito; limites diário/mensal em configuração (valores do plano Free hoje: 100 e 3.000).
2. Classes de prioridade: (1) `magic-link`; (2) financeiro (`purchase-confirmed`, `refund-completed`); (3) acesso/certificado/suporte; (4) aviso de expiração e `course-available`; (5) marketing (M9). Reserva configurável para a classe 1; classes baixas só enviam enquanto houver folga.
3. Sem folga ou resposta 429 do Resend: **não** é falha — reagendar (`available_at` para a próxima janela) sem consumir tentativa; `magic-link` sem cota mostra mensagem clara ao usuário e gera alerta P1.
4. Alerta de upgrade: soma dos últimos 7 dias ≥ 60% da cota (interpretação a confirmar com o responsável: 60% da cota **mensal**, i.e. 1.800); mostrar na tela de Operação.
5. Fuso/virada do dia da cota do Resend: PENDENTE (verificar); enquanto isso usar janela conservadora (UTC) com margem.
**Testes:** rajada de 150 intenções de `course-available` em um dia (100 saem, 50 adiadas, ordem de prioridade respeitada, nenhuma perdida); 429 simulado; `magic-link` com cota esgotada; virada de dia.
**Aceite:** excedente fica `pending` com nova data, nunca `failed`; classe 1 sempre passa antes das demais.
**Fora do escopo / cuidados:** cota própria de broadcasts/Contacts: PENDENTE (verificar no M9); sem e-mail em massa no cutover (decisão Q39). Upgrade pago exige nova decisão (teto de infraestrutura).
