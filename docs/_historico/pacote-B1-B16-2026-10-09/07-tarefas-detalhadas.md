# 07 — Backlog técnico detalhado, orientado a um desenvolvedor júnior

**Estado:** especificação de tarefas propostas; nenhuma foi executada. Os IDs servem à rastreabilidade. Nunca usar estes passos para contornar uma decisão canônica nem executar procedimentos destrutivos em Production sem o runbook correspondente.

## Como executar cada tarefa

1. **Antes:** leia a decisão e documentação vinculadas (DoR), inspecione o código atual, confirme o ambiente e mantenha um objetivo único por PR.
2. **Implemente:** siga os passos, escreva tests da regra e casos negativos; preserve ações externas após commit e autorizadores no servidor.
3. **Valide:** rode o conjunto estreito de testes e depois os gates do PR; registre comando, resultado e commit SHA.
4. **Revise:** examine diff, locks, escopo de PII, migrations e permissões; atualize docs canônicas se o contrato mudou.
5. **Marque completo somente quando:** objetivo + provas + critérios de aceite + revisão + ausência de riscos bloqueantes estiverem demonstrados (DoD). Se houver incompatibilidade externa, registre evidência e peça decisão, não invente solução.

## Dependências e critério comum de qualidade

Em cada PR relevante: TS7/format/lint, testes Vitest Node/workerd, PG18 real onde há persistência/concorrência, E2E seletivo, gitleaks/semgrep, docs:check e build. Banco Production requer migrations forward-only, preflight e role de migration separados. Nunca registrar credenciais em logs/artifacts.


## M0 — Fundação — 8 tarefas

### M0-01 — Criar repositório vNext e governança inicial

**Dependências:** nenhuma.

**Objetivo/implementação:**
1. Criar repositório novo sem copiar histórico legado.
2. fixar Bun/Node/TS e bun.lock.
3. configurar gitignore de .dev.vars e secrets.
4. criar pastas e scripts mínimos.
5. registrar licença e regras de contribuição.

**Como testar:** CI instala com frozen lockfile, gitleaks baseline, teste de ausência de secrets.

**Critério de aceite:** Checkout limpo instala e executa scripts mínimos sem serviços externos.

**Risco e cuidado:** GitHub Free privado não impõe protected branches; permitir apenas colaboradores necessários.

### M0-02 — Integrar SPA React com Hono no mesmo Worker

**Dependências:** M0-01.

**Objetivo/implementação:**
1. Adicionar Vite/CF plugin e React Compiler compatível.
2. montar TanStack Router e Query.
3. conectar Hono no Worker modular.
4. criar uma rota de health live mínima.
5. checar fallback de assets SPA.

**Como testar:** Build local, teste HTTP de health e navegação profunda, preview Staging.

**Critério de aceite:** `/app` e API servidos pelo mesmo hostname com JS/CSS válidos.

**Risco e cuidado:** Não usar Next, SSR, Server Actions nem Node-only APIs no Worker.

### M0-03 — Configurar Wrangler, tipos e isolamentos

**Dependências:** M0-02.

**Objetivo/implementação:**
1. Declarar bindings de Dev/Staging/Prod com nomenclatura clara.
2. gerar tipos Wrangler versionados.
3. catalogar variáveis sensíveis.
4. garantir CLOUDFLARE_ENV no build.
5. criar preflight de ambiente.

**Como testar:** wrangler types --check, build Staging, teste de binding errado falhando.

**Critério de aceite:** Staging rejeita configuração que aponte para Production.

**Risco e cuidado:** Secrets de Prod jamais no repo ou workflow comum.

### M0-04 — Estruturar PostgreSQL/Drizzle/Hyperdrive

**Dependências:** M0-02.

**Objetivo/implementação:**
1. Criar projeto Neon Dev/Staging isolados.
2. schema Drizzle mínimo e migrations SQL.
3. montar pg/Hyperdrive endpoint Neon direct e cache OFF.
4. roles runtime/migration.
5. scripts db:inspect e migrate:dev.

**Como testar:** Aplicar banco PG18 vazio duas vezes; teste conexão Workers e drift; validar role runtime sem DDL.

**Critério de aceite:** Conexão funciona local e em Staging com mesmo contrato schema.

**Risco e cuidado:** Migrations jamais no startup ou no Hyperdrive; não confiar em conexão errada.

### M0-05 — Configurar qualidade, segurança de dependências e CI

**Dependências:** M0-01,M0-02.

**Objetivo/implementação:**
1. Configurar TS7, Oxlint/Oxfmt, Knip, Semgrep CE, Gitleaks, actionlint/zizmor.
2. Socket/Dependabot Alerts/Renovate com permissões mínimas.
3. dividir GitHub Actions em poucos jobs.
4. publicar matriz de gates.

**Como testar:** Typecheck+lint+secret-scan+build CI em PR; simular um check falho.

**Critério de aceite:** PR fornece resultados verificáveis antes de merge humano.

**Risco e cuidado:** Não presumir required checks obrigatórios em GitHub Free privado.

### M0-06 — Configurar Vitest Node/workerd, PostgreSQL e Playwright

**Dependências:** M0-02,M0-04.

**Objetivo/implementação:**
1. Separar Vitest domain e @cloudflare/vitest-plugin.
2. subir PG18 efêmero no CI.
3. criar teste Worker com binding e integração PG.
4. iniciar smoke Playwright Chromium.

**Como testar:** Teste passa num checkout novo no CI; caso de corrida básico; smoke HTTP/browser.

**Critério de aceite:** Infra local e CI produzem evidência reproduzível.

**Risco e cuidado:** Não reutilizar Neon Production ou chamar providers reais nos PRs.

### M0-07 — Criar base visual e documentação canônica

**Dependências:** M0-02.

**Objetivo/implementação:**
1. Definir tokens OKLCH e temas light/dark/system.
2. adicionar shadcn Luma/Base UI, Phosphor, Lexend.
3. criar Button/Input/Field/Layout.
4. publicar README/PRODUCT/CONTEXT/DESIGN e docs index.
5. script docs:check.

**Como testar:** Axe+keyboard em primitives e navegação; docs links; avaliação de contraste.

**Critério de aceite:** Um fluxo público mínimo possui acessibilidade e branding coerentes.

**Risco e cuidado:** Não copiar CSS petróleo do legado nem criar design system genérico amplo.

### M0-08 — Primeiro deploy Staging e observabilidade mínima

**Dependências:** M0-03,M0-04,M0-05,M0-06.

**Objetivo/implementação:**
1. Configurar Worker Staging, domínio isolado, health live/ready.
2. publicar via GitHub Actions sem credenciais Prod.
3. adicionar release ID/correlation e evlog mínimo.
4. rodar smoke e guardar evidência de SHA.

**Como testar:** Curl health, query PG protegida, logs sanitizados; falha proposital reportada.

**Critério de aceite:** Existe candidato Staging verificável com Worker real e Neon Staging.

**Risco e cuidado:** Não declarar production-ready só pelo deploy Staging.

## M1 — Identidade — 5 tarefas

### M1-01 — Integrar Better Auth e schema

**Dependências:** M0-04,M0-08.

**Objetivo/implementação:**
1. Gerar schema Better Auth conforme plugins.
2. integrar Drizzle num único journal.
3. configurar Google/senha/verified-email e origens.
4. proteger cookies em Production.
5. testar reset/sessão.

**Como testar:** Integração signup/login/reset, cookies, 7d rolling, revocation.

**Critério de aceite:** Usuário pode autenticar sem sessão armazenada no JavaScript.

**Risco e cuidado:** Linking automático somente com e-mails verificados compatíveis.

### M1-02 — Modelar Profile, Preferences e avatar

**Dependências:** M1-01.

**Objetivo/implementação:**
1. Criar UserProfile 1:1.
2. distinguir displayName/certificateName.
3. implementar tema e autoAdvance=false.
4. mapear avatar futuro MediaAsset.
5. expor DTO perfil.

**Como testar:** Validar alteração segura, falta de propriedade, autorização e tema.

**Critério de aceite:** Alteração perfil não muta snapshots históricos.

**Risco e cuidado:** Evitar generic PATCH do User e exposição de campo auth privado.

### M1-03 — Implementar RBAC roles e capabilities

**Dependências:** M1-01.

**Objetivo/implementação:**
1. Criar user_roles e grants normalizados.
2. definir capabilities tipadas e decisões deny-by-default.
3. aplicar middleware contexto no Hono.
4. autorizar casos de uso e recursos concretos.

**Como testar:** Testes Student/Support/Admin com requests diretas indevidas; ao menos um Admin ativo.

**Critério de aceite:** Negação real backend independe de UI desabilitada.

**Risco e cuidado:** Transação necessária ao remover grants/Admin ativo.

### M1-04 — Bootstrap Admin, convite Staff e suspensão

**Dependências:** M1-03.

**Objetivo/implementação:**
1. Criar inicialização segura sem senha padrão.
2. StaffInvitation de uso único e expiração.
3. convidar Student existente.
4. suspensão auditada e revogar sessão.
5. criar StaffShell mínimo.

**Como testar:** Uso duplo de convite, replay, último Admin, suspensão concorrente.

**Critério de aceite:** Admin inicial existe sem credencial hardcoded e Staff convidado não escala papel sozinho.

**Risco e cuidado:** Não ativar impersonation/admin plugin.

### M1-05 — Autenticação reforçada e segurança HTTP

**Dependências:** M1-01,M1-03.

**Objetivo/implementação:**
1. Implementar recent reauth com prova real compatível com método Google/passkey/senha.
2. CSRF para mutações Hono.
3. cookies e headers CSP baseline.
4. rate limits/TURNSTILE seletivo.

**Como testar:** Tentativas cross-site, JSON inválido, role spoof, sessão antiga; login OAuth permanece válido.

**Critério de aceite:** Refund e grant críticos exigirão recent proof reutilizável.

**Risco e cuidado:** Não considerar sessão 'fresh' sinônimo automático de reauth recente.

## M2 — Catálogo e autoria — 4 tarefas

### M2-01 — Modelar Course, Offer e disponibilidade

**Dependências:** M1-03,M0-04.

**Objetivo/implementação:**
1. Criar Course sem preço direto.
2. Offer free/paid com BRL cents e condições.
3. catálogo e estados de venda/visibilidade separados.
4. snapshots comerciais tipados.
5. DTOs público/staff.

**Como testar:** Testes curso oculto, Offer pausada, preço negativo, admin false edit.

**Critério de aceite:** Catálogo não divulga drafts nem permite adquirir Offer indisponível.

**Risco e cuidado:** Não criar bundles/coupon engine ou landing CMS.

### M2-02 — Implementar identidade curricular e CourseRelease

**Dependências:** M2-01.

**Objetivo/implementação:**
1. Modelar Module/Lesson estáveis, revisions imutáveis e associação ordenada por release.
2. criar draft/publish/retire com transação.
3. remover curriculum_key e clones.
4. exigir validações pedagógicas.

**Como testar:** Release race, revision immutable, CourseCompletion persistindo após release.

**Critério de aceite:** Mudar uma aula pequena cria revisão, mudança material exige nova identidade.

**Risco e cuidado:** Não usar CoursePublication clone legado.

### M2-03 — Criar autoria mínima Course Builder

**Dependências:** M2-02,M0-07.

**Objetivo/implementação:**
1. UI Staff cria/edita curso, oferta, módulo plano e aula content tipada.
2. Tiptap allowlist com sanitização.
3. salvar explícito e dirty blocker.
4. publicar com preview seguro.

**Como testar:** Playwright staff publish, field server validation, XSS, a11y.

**Critério de aceite:** Staff cria Course básico e publica uma release válida.

**Risco e cuidado:** Não criar editor Notion-like ou HTML livre.

### M2-04 — Publicar catálogo Student e consultas de Course

**Dependências:** M2-01,M2-02,M0-07.

**Objetivo/implementação:**
1. Criar rotas públicas e privadas, search params tipados, filtros e estados de UI.
2. URL e query state via TanStack.
3. cache client apenas dados não sensíveis.

**Como testar:** E2E catálogo, skeleton/empty/error, CORS/PII.

**Critério de aceite:** Visitante visualiza apenas Course/Offer publicáveis.

**Risco e cuidado:** Não depender de optimistic update para publicação ou permissão.

## M3 — Jornada gratuita — 5 tarefas

### M3-01 — Entitlement e Enrollment transacionais

**Dependências:** M1-03,M2-01,M2-02.

**Objetivo/implementação:**
1. Criar direito com fontes purchase/free_offer/admin_grant.
2. Enrollment projeção, expiração em cada request e episódio de drip.
3. consolidar múltiplos direitos.
4. ajustar âncora em recompras contínuas.

**Como testar:** PG18 locks, múltiplos entitlements, expiração durante request, revogação.

**Critério de aceite:** Acesso sempre deriva dos direitos válidos e do estado atual.

**Risco e cuidado:** Não depender de cron para retirar acesso expirado.

### M3-02 — Implementar inscrição gratuita

**Dependências:** M3-01,M2-04.

**Objetivo/implementação:**
1. Comando Hono autenticado verificado.
2. checar Offer=free e release elegível.
3. criar Entitlement idempotente e recompor Enrollment.
4. retornar estado de acesso.
5. nenhum import Asaas no caminho.

**Como testar:** Duplo clique concorrente, usuário suspenso, revogado, Offer desativada; spy garante zero calls Asaas.

**Critério de aceite:** Aluno obtém acesso gratuito, sem Order ou Payment.

**Risco e cuidado:** Não criar Payment R$0 e não contornar verificação de conta.

### M3-03 — Resolução de aula e regras de drip

**Dependências:** M3-01,M2-02.

**Objetivo/implementação:**
1. Resolver CourseRelease vigente, release relativa D+N, guide/free por Course e opcionais.
2. regras no domínio, server autorizador único.
3. criar Student lesson workspace.

**Como testar:** Módulo futuro não expõe payload, opcional não bloqueia, free/guided, expiração.

**Critério de aceite:** Aluno vê e acessa apenas conteúdo liberado para sua situação.

**Risco e cuidado:** Não calcular acesso apenas na UI.

### M3-04 — Conclusão manual e progresso obrigatório

**Dependências:** M3-03.

**Objetivo/implementação:**
1. Modelar LessonProgress/Completion, evidência method/timestamp e CourseCompletion histórica.
2. progresso percentual só mandatory.
3. recalcular após release preservando história.

**Como testar:** PG concorrência última aula, duplicata, remoção lição, atualização CourseRelease.

**Critério de aceite:** Conclusão histórica nasce uma vez e mantém estabilidade mesmo com release nova.

**Risco e cuidado:** Não inferir conclusão de vídeo a partir de aba aberta.

### M3-05 — Primeira jornada E2E gratuita

**Dependências:** M3-02,M3-04.

**Objetivo/implementação:**
1. Preparar fixtures curso gratuito com módulos e lições.
2. criar E2E cadastro/login→inscrição→abrir aula→completar→reentrar.
3. medir latência e logs.

**Como testar:** Playwright Chromium e integração PG, negativos de auth.

**Critério de aceite:** Jornada completa comprovada em Staging sem dependências de Asaas.

**Risco e cuidado:** Não considerar M3 concluído com testes unitários apenas.

## M4 — Assíncrono e e-mail — 5 tarefas

### M4-01 — Núcleo Postgres outbox e intent API

**Dependências:** M0-04,M1-03.

**Objetivo/implementação:**
1. Schema Outbox, dedupe key, states/attempts/lease.
2. registrar intent na transação de domínio.
3. criar claim/fencing e requeue seguros.

**Como testar:** PG duplicate claims, lost lease, retry after commit, no provider I/O em transação.

**Critério de aceite:** Intenção é durável e não se perde quando enqueue falha.

**Risco e cuidado:** Não usar Queue como banco autoritativo.

### M4-02 — Provisionar Queues/DLQs e consumers

**Dependências:** M4-01,M0-03.

**Objetivo/implementação:**
1. Criar cinco filas por ambiente e DLQs.
2. contracts de envelope versionados.
3. consumer tipado com retry classificado.
4. backpressure e idempotência.

**Como testar:** Workerd Queue tests, mensagens duplicadas/old schema, DLQ.

**Critério de aceite:** Consumer executa um efeito demonstrativo só após claim válido.

**Risco e cuidado:** Não publicar payloads PII/segredos em Queue.

### M4-03 — Agendamento e reconciliação geral

**Dependências:** M4-01,M4-02.

**Objetivo/implementação:**
1. Criar rotina Cron consolidada de pending claims/recovery.
2. definir leases e saúde.
3. alertar backlog/oldest/outbox, recovery sweeps por classe.

**Como testar:** Fault-injection publish lost, old queued, provider down; test cron Staging.

**Critério de aceite:** Intenção pendente progride ou chega a estado investigável sem ação manual obrigatória.

**Risco e cuidado:** Limite de Cron Free não é alvo; Workers Paid não elimina necessidade de economia Neon.

### M4-04 — Entrega transacional Resend e templates

**Dependências:** M4-01,M4-02,M1-01.

**Objetivo/implementação:**
1. Criar EmailTemplateContract, hosted aliases/variables.
2. fake delivery Dev e Staging allowlist.
3. entregar confirmação transacional, webhook Svix, recipient state.
4. redaction.

**Como testar:** Mock Resend accepted/unknown/retry, signed webhook, success in Staging.

**Critério de aceite:** Notificação pode falhar sem bloquear acesso; delivery e-mail rastreado.

**Risco e cuidado:** Não persistir corpo/tokens nem criar templates React Email paralelos.

### M4-05 — Observabilidade e Operations Center inicial

**Dependências:** M4-01,M0-08.

**Objetivo/implementação:**
1. Expandir evlog wide events, Sentry filtrado, CF logs/traces e Web Analytics privacidade.
2. construir staff Ops read-only com PG/Queue counters.
3. health/release signals.

**Como testar:** Correlation HTTP→Queue→provider; PII scan em logs; simular DLQ.

**Critério de aceite:** Staff identifica bloqueio de fila e erro relevante sem visualizar secrets.

**Risco e cuidado:** Sentry não substitui audit log financeiro.

## M5 — Aprendizagem completa — 7 tarefas

### M5-01 — VideoAsset e VideoProviderConnection

**Dependências:** M2-02,M1-05,M0-04.

**Objetivo/implementação:**
1. Modelar capabilities, múltiplas conexões por provider e lifecycle.
2. criptografar segredos AES-GCM versionado.
3. UI Staff mascarada e rotação.
4. VideoAsset usa connection concreta.

**Como testar:** Teste crypo roundtrip/nonce, rotacionar, autorização, asset state.

**Critério de aceite:** Credencial nunca volta plaintext ao client e troca de conexão não invalida histórico.

**Risco e cuidado:** Sem provider default Course, sem iframe arbitrário.

### M5-02 — Adapter primeiro provider e Player contrato

**Dependências:** M5-01,M3-04.

**Objetivo/implementação:**
1. Escolher primeiro provider para spike de upload/playback.
2. implementar contracts duration/resume/ended e limite de seek.
3. player mostra capabilities e alertas.
4. conclusão Course threshold.

**Como testar:** Testar 89%/90%, seek, ended, autoAdvance=false, provider sem progress.

**Critério de aceite:** Lição conclui somente pela política aprovada, autoavanço separado.

**Risco e cuidado:** Não prometer anti-seek nem extrapolar capabilities.

### M5-03 — Concluir seis adapters de vídeo

**Dependências:** M5-02,M4-03.

**Objetivo/implementação:**
1. Implementar JMVStream, Panda, CF Stream, Mux, YouTube, Vimeo por capabilities.
2. managed upload quando existente e referenced-only para vídeo externo.
3. domain protection/adapters cleanup.

**Como testar:** Fixtures por provider, Staging contract smoke, invalid domain, client-only vs managed delete.

**Critério de aceite:** Cada provider roda com contrato real e relata capacidades/limites.

**Risco e cuidado:** Não criar 'generic embed' arbitrário e não apagar linked external asset.

### M5-04 — QuizLesson, tentativas e scoring

**Dependências:** M2-02,M3-04.

**Objetivo/implementação:**
1. Modelar tipos single/multiple, weighted points e shuffle.
2. controlar attempts (default unlimited), score/pass/submit, feedback immediate/score_only.
3. implementar UI + server submit.

**Como testar:** Score boundary, attempts concorrentes, shuffle deterministic, permission, offline submit reject.

**Critério de aceite:** Quiz integra progresso e conclusão sem manipulação de score cliente.

**Risco e cuidado:** Não adicionar timer/proctoring/correção manual.

### M5-05 — Discussões pedagógicas por Lesson

**Dependências:** M2-02,M1-03.

**Objetivo/implementação:**
1. Criar thread post/reply com ownership e status/moderação.
2. Staff pode responder/moderar se grant.
3. UI assíncrona acessível.

**Como testar:** Testes discussão lesson retirada, acesso cruzado, HTML XSS, moderador inadequado.

**Critério de aceite:** Aluno pergunta e Staff responde com persistência e contexto.

**Risco e cuidado:** Sem DM/realtime/social ranking.

### M5-06 — CourseInterest e notificação por abertura

**Dependências:** M2-01,M4-04,M3-01.

**Objetivo/implementação:**
1. Modelar interest active/withdrawn/converted e ciclo disponibilidade.
2. detecção transição não-adquirível→adquirível.
3. registrar outbox por ciclo e cada interest elegível.
4. analytics derivados.

**Como testar:** Fechar/reabrir, adicionar Offer com vendas já abertas, duas execuções concorrentes.

**Critério de aceite:** Uma notificação por interesse/ciclo, repetível em cada reabertura até withdraw/conversion.

**Risco e cuidado:** Não criar leads externos no Hub nem pedir consentimento marketing geral para aviso solicitado.

### M5-07 — Material de aula, R2 uploads e Images Free

**Dependências:** M2-03,M0-03,M1-03.

**Objetivo/implementação:**
1. Implementar crop browser master editado, R2 presigned upload, confirmação conteúdo real e visibilidade.
2. CDN público, transforms semânticas e fallback estático, private URLs.
3. cleanup zero-refs 24h orphan.

**Como testar:** Upload forge MIME, path traversal, fallback quando Images quota falha, R2 delete ref race.

**Critério de aceite:** UI entrega imagem publicada e documento privado com proteção e custo limitado.

**Risco e cuidado:** Não usar Images Hosted/Direct Creator Upload nem revelar master de assinatura.

## M6 — Financeiro — 6 tarefas

### M6-01 — Modelar Offer paga, Order e snapshot

**Dependências:** M2-01,M3-01,M4-01.

**Objetivo/implementação:**
1. Criar snapshot imutável de preço/métodos/duração por Order, CheckoutSession, Payment e external IDs.
2. TTL60m e geração de novo Order após expiração.

**Como testar:** Alterar Offer após Order, requests duplicados, preço client malicioso.

**Critério de aceite:** Order mantém condições comerciais históricas invariáveis.

**Risco e cuidado:** Sem campos PII desnecessários no snapshot.

### M6-02 — Hosted Checkout Asaas

**Dependências:** M6-01,M1-01.

**Objetivo/implementação:**
1. Validar User verified+buyer=beneficiary.
2. criar Order antes da chamada Asaas.
3. adapter usa valores server-side e idempotency key.
4. persistir resposta/estado unknown seguro.

**Como testar:** Asaas sandbox, timeout accepted, concurrent checkout, eligible methods.

**Critério de aceite:** Aluno é conduzido ao Hosted Checkout com preço correto e sem coletar cartão.

**Risco e cuidado:** Sem guest checkout, sem checkout próprio.

### M6-03 — Webhook inbox e matriz Payment

**Dependências:** M6-02,M4-02.

**Objetivo/implementação:**
1. Autenticar asaas-access-token.
2. persistir raw limitado 30d.
3. normalizar/claim evento.
4. aplicar matriz Pix/cartão/dispute/refund e FinancialEvent append-only sob lock.

**Como testar:** Fake/missing auth, duplicate/out-of-order, CHECKOUT_PAID alone, value mismatch.

**Critério de aceite:** Apenas evidência Payment segura concede Entitlement, ambiguidade FinancialReview.

**Risco e cuidado:** Não inventar HMAC Asaas; nunca liberar com informação incerta.

### M6-04 — Reconciliação financeira e comandos de revisão

**Dependências:** M6-03,M4-03.

**Objetivo/implementação:**
1. Consultar provider por IDs exatos.
2. distinguir retry local x reconciler externo.
3. registrar FinancialReview e capacidades finance.view/reconcile/review.
4. UI operacional auditada.

**Como testar:** Testes stale job, payment unknown, conflicting value, staff role checks.

**Critério de aceite:** Estado incerto converge sem duplicar direito ou registrar falso pagamento.

**Risco e cuidado:** Acesso continua fail-closed em divergência.

### M6-05 — Reembolso integral assíncrono

**Dependências:** M6-04,M1-05.

**Objetivo/implementação:**
1. Modelar RefundRequest, comando com recent reauth/capability.
2. transição de suspensão, chamada provider via Queue fora da transação.
3. finalize/refund failure reconcile.

**Como testar:** Duplo clique, accepted-unknown, disputa concorrente, timeout, refund parcial externo.

**Critério de aceite:** Reembolso confirmado revoga direito, falha inequívoca restaura quando cabível, histórico preservado.

**Risco e cuidado:** Não criar refund parcial interno ou endpoint livre de valor.

### M6-06 — End-to-end comercial e auditoria

**Dependências:** M6-02,M6-03,M6-04,M6-05.

**Objetivo/implementação:**
1. Simular checkout/cartão/Pix, webhooks, entitlement e expiração.
2. usar sandbox e dados sintéticos.
3. comprovar interações Staff/Student e logs.

**Como testar:** Suite PG racing + sandbox staged smoke + E2E checkout simulated.

**Critério de aceite:** Todos os caminhos financeiros normais e adversariais deixam prova recuperável.

**Risco e cuidado:** Não fazer reembolso financeiro destrutivo em CI comum.

## M7 — Certificados — 5 tarefas

### M7-01 — Domínio Certificate e CourseCompletion→intent

**Dependências:** M3-04,M4-01.

**Objetivo/implementação:**
1. Modelar Certificate/Template/snapshot/tombstone e único emissor automático por primeira conclusão elegível.
2. status pending e outbox.

**Como testar:** Duas conclusões simultâneas, repeat processing, disabled policy, failed PDF.

**Critério de aceite:** Falha PDF não remove CourseCompletion nem duplica Certificate.

**Risco e cuidado:** Não guardar PNG renderizada.

### M7-02 — PoC renderer Browser Run e PDF R2

**Dependências:** M7-01,M5-07.

**Objetivo/implementação:**
1. Implementar renderer HTML/CSS A4 com campos escapados e assets privados curados.
2. testar Quick Action /pdf e dimensões.
3. salvar bytes PDF imutáveis/hash em R2.

**Como testar:** Test PDF metadata/parity/sha, remote binding, resource injection/timeout.

**Critério de aceite:** PDF gerado no runtime real, hash reproduzível dos bytes gerados e PDF acessível só autorizado.

**Risco e cuidado:** Não incluir links externos ou fallback automático Gotenberg.

### M7-03 — Editor visual de templates

**Dependências:** M7-02,M0-07.

**Objetivo/implementação:**
1. Campos pré-definidos drag/resize/keyboard, warnings overlap e overflow, undo, fonts curadas, fundo A4.
2. Draft/published, snapshot layout nos certificados.

**Como testar:** Playwright editor, a11y teclado, tamanho A4, visual diff renderer.

**Critério de aceite:** Staff publica template válido e renderer o utiliza sem HTML livre.

**Risco e cuidado:** Não criar Figma/Canva nem histórico editorial ilimitado.

### M7-04 — Emissão/revogação/reemissão e verificação

**Dependências:** M7-02,M7-03,M4-04.

**Objetivo/implementação:**
1. Ligar CertificateRenderer a intent, PDF ready.
2. e-mail.
3. público status mínimo/code opaco.
4. Staff revoke/reissue audit/authorization.
5. privado PDF access.

**Como testar:** Teste code enumeration, revoked no download, reissue new code, corrupt pdf hash.

**Critério de aceite:** Cópia anterior nunca é alterada e válida/revogada é exibida corretamente.

**Risco e cuidado:** Não expor e-mail/CPF/motivo interno nem permitir PDF público irrestrito.

### M7-05 — Retenção e purge de documentos revogados

**Dependências:** M7-04,M4-03.

**Objetivo/implementação:**
1. `revokedAt + 90d` para PDF privado, tombstone mínimo e limpeza R2 retry, manutenção diária.
2. integrar retenção assets e auditoria.

**Como testar:** Simular erro R2 e reexecução, timezone, documento revogado offline/online.

**Critério de aceite:** Depois do prazo produto PDF físico é eliminado sem revalidação indevida.

**Risco e cuidado:** Revisão LGPD jurídica obrigatória antes de Production.

## M8 — PWA — 4 tarefas

### M8-01 — Manifest PWA e Service Worker safe update

**Dependências:** M3-05,M0-07.

**Objetivo/implementação:**
1. Configurar manifest/icon/install e cache do app shell.
2. update download silencioso com safe boundary.
3. não cachear admin/financeiro.

**Como testar:** PWA install, reload durante vídeo/quiz/form dirty, fallback offline.

**Critério de aceite:** Update não interrompe ação crítica e páginas staff permanecem online-only.

**Risco e cuidado:** Não aplicar autoUpdate cego.

### M8-02 — Storage offline isolado e lease

**Dependências:** M8-01,M3-01.

**Objetivo/implementação:**
1. IndexedDB por User, lastVerifiedAt, cache de conteúdo seletivo visitado.
2. lease min(expiresAt,72h).
3. purge logout/cross-account.
4. certificados preview com marca de validação anterior.

**Como testar:** Teste user A→B, relógio manipulado, expirado sem rede, cache eviction.

**Critério de aceite:** Nunca mostrar a B dados A, acesso offline expira conforme política.

**Risco e cuidado:** Offline não garante DRM nem revogação de arquivo externo.

### M8-03 — Outbox offline e sincronização

**Dependências:** M8-02,M3-04.

**Objetivo/implementação:**
1. Commands allowlisted, clientOperationId, queue local, retry.
2. revalidar entitlement/release no server, conflitos e version changed.

**Como testar:** Teste dup sync, revoked while offline, lesson removed, malformed commands.

**Critério de aceite:** Reconexão converge sem criar progressos indevidos.

**Risco e cuidado:** QuizAttempt submit permanece online-only.

### M8-04 — Validação multiplataforma e offline certificates

**Dependências:** M8-03,M7-04.

**Objetivo/implementação:**
1. Testar Chromium Android, Chrome/Edge desktop e WebKit.
2. validar Safari iOS real para conteúdo crítico.
3. preview snapshot e PDF somente se baixado.
4. revocation ao sync.

**Como testar:** Playwright offline/network throttling, iOS checks, PWA update, corrupted cache.

**Critério de aceite:** Jornada aprende offline e retorna com status coerente.

**Risco e cuidado:** Não inferir compatibilidade iOS real a partir de emulação desktop.

## M9 — Operação e refinamento — 6 tarefas

### M9-01 — Staff completo e projeções administrativas

**Dependências:** M1-03,M2-03,M6-04,M7-04.

**Objetivo/implementação:**
1. Completar Support/Admin Course/finance/operations/student, comandos específicos, grants, read models paginados.
2. UX mobile appropriate e auditoria.

**Como testar:** Testes cada capability inclusive chamada direta API, paginar dados sintéticos.

**Critério de aceite:** Staff visualiza superfícies pertinentes sem poder mutar o que não tem grant.

**Risco e cuidado:** Não criar PATCH genérico nem mega dashboard.

### M9-02 — Analytics first-party e interesse/Offer

**Dependências:** M3-04,M5-04,M5-06,M6-06.

**Objetivo/implementação:**
1. Queries agregadas PostgreSQL por CourseRelease e Student autorizado, inactivity 14/30, Quiz/Video aggregate, Offer funnel e CourseInterest conversion.
2. indices conforme explain.

**Como testar:** Test query budgets, view grants, preview anon/PII, metrics math.

**Critério de aceite:** Analytics deriva dos dados sem event firehose e sem CSV.

**Risco e cuidado:** Não alegar causalidade de aviso → compra.

### M9-03 — Marketing preference e Resend Contacts

**Dependências:** M4-04,M1-02,M5-06.

**Objetivo/implementação:**
1. Consent first-party separado de CourseInterest, sincronizar eligible marketing User via outbox.
2. Resend Segments/Topics, unsubscribe inbound.
3. landing externa não cria user.

**Como testar:** Test opt-in/out, bounce/unsubscribe race, re-sync não reinscreve.

**Critério de aceite:** Preferência first-party é respeitada e lead externo não contaminou Hub.

**Risco e cuidado:** Não implementar CMS/email marketing local.

### M9-04 — Security hardening transversal

**Dependências:** M1-05,M5-07,M6-06,M7-04,M8-04.

**Objetivo/implementação:**
1. Revisar CSP final + headless PDF, CSRF, rate limits, R2 ACL, secrets, uploads, SSRF, RBAC matrix, public cert tokens e logs PII.

**Como testar:** OWASP ASVS scoped tests, Gitleaks/Semgrep/Socket, Playwright axe, pen test manual opcional.

**Critério de aceite:** Nenhum fluxo crítico com falha conhecida de auth/fin/privacidade.

**Risco e cuidado:** Não usar scanner como único controle de segurança.

### M9-05 — Backups, retenção e recovery drill

**Dependências:** M4-03,M5-07,M6-06,M7-05.

**Objetivo/implementação:**
1. Automatizar pg_dump -Fc/age 6h no executor isolado, manifest SHA, R2 locks/retention, off-cloud weekly.
2. testar pg_restore com reconciliação privacy/finance.

**Como testar:** Restore PostgreSQL18 isolado, key custody, detect stale backups, restore RPO/RTO measured.

**Critério de aceite:** Banco e mídia essenciais são recuperáveis sem executar efeitos duplicados.

**Risco e cuidado:** Secrets age decrypt fora GitHub, nenhum restore direto Prod sem revisão.

### M9-06 — Operação, alertas, performance e UX final

**Dependências:** M4-05,M9-01,M9-02,M9-05.

**Objetivo/implementação:**
1. Alert P0/P1, SLI/SLO baselines, Worker CPU/Neon CU/Queues R2 costs.
2. performance Query indexes, UI audits WCAG, responsividade e feedback.

**Como testar:** Synthetic uptime, fault drill queue/prov, k6-like tests sem prod, axe manual.

**Critério de aceite:** Equipe tem indicadores e runbooks e app usável em mobile/desktop.

**Risco e cuidado:** Não contratar SaaS observabilidade ou load infra prematuramente.

## M10 — Production — 3 tarefas

### M10-01 — Homologação integrada e prova Go/No-Go

**Dependências:** M5-07,M6-06,M7-05,M8-04,M9-06.

**Objetivo/implementação:**
1. Rodar E2E full Staging, providers sandbox, backup drill, auth/CSRF/RBAC/PWA, security.
2. inventariar blockers e registrar evidências por SHA.

**Como testar:** Gate checklist e testes negativos, responsável assina decisão Go/No-Go.

**Critério de aceite:** Nenhum P0/P1 ou gap legal impeditivo aberto.

**Risco e cuidado:** Marcos anteriores concluídos não substituem homologação v1 integral.

### M10-02 — Release manual seguro e cutover DNS

**Dependências:** M10-01.

**Objetivo/implementação:**
1. Validar exact source tree Staging, schema Drift, backups, secrets prod fora GitHub.
2. provisionar Worker Prod.
3. aplicar migrations compatíveis.
4. publicar versão, smoke, cutover separado de nameservers.

**Como testar:** Rehearsal DNS/OAuth/Webhook/R2/cert URLs, version smoke, fallback policies.

**Critério de aceite:** VNext recebe primeiras operações reais sem afetar links de legado.

**Risco e cuidado:** Depois de novas operações, rollback DNS ao legado é inseguro.

### M10-03 — Estabilização e handoff operacional

**Dependências:** M10-02.

**Objetivo/implementação:**
1. Executar monitoramento diário por 7d de Auth, Queue, finance, cert, Sentry, Neon/R2/Workers.
2. registrar incidentes e custo real.
3. revisar runbooks/owner.

**Como testar:** Revisar dashboard, backlog, incident tabletop; critérios saída da estabilização.

**Critério de aceite:** Handoff técnico documentado, métricas e histórico de release acessíveis.

**Risco e cuidado:** Não confundir ausência de erros reportados com sistema saudável.

## Inventário

**Total: 58 tarefas detalhadas**. Este inventário cobre a sequência M0–M10; ainda é necessário decompor cada tarefa quando uma integração concreta demonstrar tamanho excessivo. Nenhuma tarefa será marcada como pronta apenas porque outra tarefa a referenciou.
