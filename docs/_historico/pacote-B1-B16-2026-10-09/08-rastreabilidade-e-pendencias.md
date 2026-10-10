# 08 — Matriz de rastreabilidade, validações externas e risco residual

**Situação documental:** decisões B1–B16 e IMG-R aprovadas, implementação não iniciada. Esta matriz serve para acompanhar requisitos → tarefas → evidências. Os testes listados são **exigências futuras**, não resultados já obtidos.

## 1. Requisitos de produto e domínio

| ID | Requisito aprovado | Tarefas principais | Evidência necessária |
|---|---|---|---|
| PROD-01 | Course 1:N Offer, Offer 1 Course v1 | M2-01,M2-04 | Schema + APIs + E2E catálogo |
| PROD-02 | Interesse autenticado por Course, ciclos de reabertura | M5-06,M4-04 | Teste fechar/abrir/reabrir; outbox dedupe por ciclo |
| PROD-03 | FAQ, banners, login media administrável | M2-03,M5-07,M9-01 | CRUD Staff, autorização, mídia R2, teste visual |
| LEARN-01 | CourseRelease + Module/Lesson identity/revision | M2-02,M3-03 | Publicação atômica e histórico preservado |
| LEARN-02 | Drip por Module D+N / guided/free | M3-01,M3-03 | Testes relógio, sequência, opcionais |
| LEARN-03 | Progress obrigatório, threshold vídeo 90% default | M3-04,M5-02 | 89/90%; sem anti-seek, optional excluded |
| LEARN-04 | Autoavanço só no `ended`, opt-in default off | M1-02,M5-02 | Eventual next, countdown e cancelável |
| LEARN-05 | Quiz submit/pass, tentativas, score, shuffle | M5-04 | Casos de score/attempt, servidor decide |
| LEARN-06 | Discussões pedagógicas assíncronas | M5-05 | Ownership/moderação e XSS tests |
| LEARN-07 | Seis adapters por VideoAsset/capability | M5-01,M5-02,M5-03 | Suite de contratos por provider |
| IDENT-01 | Better Auth Google/senha/verificação/sessão 7d | M1-01 | Integração auth e linking / reset |
| IDENT-02 | UserProfile prefs, nomes distintos | M1-02 | Snapshot histórico imutável |
| IDENT-03 | Roles/grants normalizados, ≥1 Admin | M1-03,M1-04 | Testes concorrentes e bypass direto API |
| IDENT-04 | StaffInvitation e suspensão/recent reauth | M1-04,M1-05 | Replay, sessão revogada, métodos Google/passkey |
| FREE-01 | Matrícula gratuita sem Order/Asaas | M3-01,M3-02,M3-05 | PG concurrence + E2E + spy provider zero calls |
| ACCESS-01 | Entitlement autoridade, Enrollment projeção | M3-01,M6-03 | ExpiresAt request-time e múltiplas fontes |
| FIN-01 | Order/CheckoutSession/Payment separados, snapshot, TTL60m | M6-01,M6-02 | Retry checkout, valor íntegro e imutabilidade |
| FIN-02 | Webhook autenticado, Payment autoritativo | M6-03 | `CHECKOUT_PAID` insuficiente; signed/auth event tests |
| FIN-03 | Conciliador e revisão de ambiguidades | M6-04 | Provider timeout, stale event, replay |
| FIN-04 | Refund integral assíncrono e dispute suspend | M6-05,M6-06 | Corrida, unknown acceptance, rollback state |
| CERT-01 | CertificateTemplate advanced controlled A4 | M7-03 | Playwright drag/keyboard, parity PDF |
| CERT-02 | CourseCompletion imutável e PDF Browser Run | M7-01,M7-02 | Emissão exactly-once effect sob at-least-once jobs |
| CERT-03 | PDF R2 privado, SHA, código público opaco | M7-04 | Test enumeration, authorized download, sha |
| CERT-04 | Revogação/reemissão, purge90d/tombstone | M7-04,M7-05 | Clock, R2 failure retry, legal approval |
| MEDIA-01 | R2 master editado, sem Images Hosted | M5-07 | Upload real+validation+signed PUT, no original camera |
| MEDIA-02 | Public CDN transforms Free + static fallback | M5-07 | Simular 9422, size allowlist e fallback |
| MEDIA-03 | Privado autorizado, zero orphan references | M5-07,M7-02 | ACL cross user, reference race, cleanup |
| EMAIL-01 | Hosted Templates Resend e contracts tipados | M4-04 | Staging templates and sender smoke |
| EMAIL-02 | Transactional email via PG outbox | M4-01,M4-04 | Unknown ack, Svix validation, bounce |
| EMAIL-03 | Marketing preference/contacts, unsub autoridade | M9-03 | Opt-out não reinscrito |
| EMAIL-04 | Interesse interno ≠ marketing externo | M5-06,M9-03 | Landing external não cria User/CourseInterest |
| PWA-01 | Offline student, video/staff online only | M8-01,M8-02 | Browser offline navigation/data minimization |
| PWA-02 | Lease `min(expiry,lastVerified+72h)` | M8-02 | Relógio, dispositivo, expiração, reconexão |
| PWA-03 | Sync allowlisted/idempotente; quiz submit online | M8-03,M8-04 | Dup event, revoked, stale release, quiz offline denied |
| PWA-04 | Update safe boundary + cache purge per User | M8-01,M8-04 | User A→B, dirty form, upload/quiz/video interruption |
| ANALYT-01 | Fatos first-party, sem firehose/clickstream | M9-02 | Query math, views autorizadas |
| ANALYT-02 | Student progress + course/offer insights | M9-02,M9-01 | Filtros 14/30d, CourseRelease breakdown |
| UI-01 | Lexend Deca/Phosphor/shadcn Luma/Base UI | M0-07,M9-06 | Brand review and WCAG2.2 AA evidence |
| UI-02 | Student mobile-first, Staff desktop responsive | M0-07,M9-01 | Chrome/mobile/WebKit keyboard tests |

## 2. Plataforma, segurança, operação e documentação

| ID | Regra aprovada | Tarefas | Evidência |
|---|---|---|---|
| PLAT-01 | SPA Vite + Hono same Worker, no SSR | M0-02,M0-08 | Staging deploy real, deep-link test |
| PLAT-02 | TS7 + Oxlint/Oxfmt + Bun tooling | M0-01,M0-05 | Frozen lock install, build and check |
| PLAT-03 | Neon PG18 + Drizzle/Hyperdrive cache OFF | M0-04,M0-06 | Connectivity and consistency, migrations |
| PLAT-04 | 3 projects Neon/env isolated | M0-03,M0-04,M10-02 | Preflight and wrong-binding rejection |
| ASYNC-01 | 5 Queues+DLQs with PG outbox authority | M4-01,M4-02,M4-03 | Fault injection crash/duplicate/lease |
| OBS-01 | evlog+CF Logs/Traces+Sentry/WebAnalytics | M4-05,M9-06 | Redaction, correlation and alert test |
| SEC-01 | GitHub Free private/CI tools/release isolation | M0-05,M10-02 | SHA verified and Production secrets not in CI |
| SEC-02 | CSRF/CSP/RBAC/SSRF/XSS/upload hardening | M1-05,M5-07,M9-04 | OWASP risk matrix tests |
| SEC-03 | Secrets AES-GCM & rotation | M5-01,M9-04 | No plaintext UI, key transition rehearsal |
| OPS-01 | pg_dump+age+R2/off-cloud backups | M9-05 | Decrypt+restore drill and off-cloud integrity |
| OPS-02 | Backup/revocation/provider reconciliation | M9-05,M7-05,M6-04 | No resurrect delete, no duplicate effects |
| OPS-03 | DNS cutover separate legacy, no blind rollback | M10-02 | Smoke canonical hostname and legacy links |
| OPS-04 | Go/No-Go + 7d stabilization | M10-01,M10-03 | Signed checklist, daily incident/cost review |
| DX-01 | Canonical docs/ADRs and docs:check | M0-07,M9-06 | Link, contracts and cross-refs checks |
| DX-02 | DoR/DoD/PR gates by risk, tests workerd | M0-05,M0-06,M10-01 | Suite and acceptance evidence |

## 3. Pendências de validação — não são novos requisitos aprovados

| ID | Pendência concreta | Quando resolver | Se falhar |
|---|---|---|---|
| P-01 | Compatibilidade de TS7 com Oxfmt/Ultracite/Router/Better Auth e infra Workers no conjunto de versões efetivo | M0 | Fixar versões compatíveis; se exigir troca arquitetural/custo, nova decisão |
| P-02 | Integridade do assembly Vite+Hono, asset routing e Cloudflare Vite Plugin/React Compiler | M0 | Spike técnico e ajuste documentado |
| P-03 | GitHub Free repo privado: deploy Prod com SHA e secrets fora CI; autenticação/verificação independente do workflow | M0/M10 | Bloquear produção até controle viável |
| P-04 | Workers Paid quotas reais, Cron/Queues/Hyperdrive e prevenção de custo excessivo | M0/M4 | Ajustar configuração dentro do Paid, não desabilitar invariantes |
| P-05 | Neon Free compute/storage por projeto e conexões reais com Hyperdrive | M0/M9 | Upgrade Neon baseado em uso real; não sacrificar SQL correctness |
| P-06 | R2 custom domain/CDN + Images Free 5k uniques e fallback 9422 | M5 | Pré-gerar variantes semânticas suficientes sem Images Hosted |
| P-07 | Browser Run Quick Action `/pdf`: ambiente remoto, preço, rendering A4 e fontes/assinatura privadas | M7 | Reavaliar adapter render sem modificar domínio de certificados |
| P-08 | Disponibilidade/permissões dos 6 providers de vídeo, especialmente `ended` e managed upload | M5 | Capability degradada explicitamente, sem fingir suporte |
| P-09 | Prova recent reauth real de conta Google-only/passkey-only no Better Auth | M1 | Não liberar refund/grant/credential update até resolver |
| P-10 | Webhook Asaas/teste com token correto; sandbox vs Production isolados e transição do legado | M6/M10 | Fail-closed, FinancialReview e bloquear produção paga |
| P-11 | Templates hospedados Resend, variáveis e lifecycle/webhooks, limites Contacts/Segments | M4/M9 | Corrigir contratos/quotas, sem reintroduzir templates editoriais Hub |
| P-12 | Questões jurídicas: retenção 90d PDF revogado, outbox e-mail, backups, auditoria, dados pessoais | Antes M10 | Parecer jurídico e decisão de ajuste explícita se exigido |
| P-13 | Restore completo banco/R2/imagens/providers, chaves `age`, RPO/RTO e evidência independente de revogações | M9 | Não liberar Production com plano não ensaiado |
| P-14 | DNS atual, Cloudflare nameservers, Vercel legado, Google OAuth/Asaas webhooks/R2 CORS e links históricos | M10 | Adiar cutover mantendo legado |
| P-15 | Safari iOS real, PWA storage eviction, update safe boundary, privacy multi-account | M8 | Bloquear offline release se experiência crítica falhar |
| P-16 | Segurança repo privado: permissões Socket/Semgrep Apps, licenças, SAST/secret baselines | M0 | Usar somente componentes open source validados; revisão manual |
| P-17 | Mensuração de Workers CPU, Neon CU, R2/Browser Run e franquias, sem considerar US$5 teto total | M0/M9 | Ajustar capacidade/planos apenas com prova |
| P-18 | Conteúdo/UX do editor avançado versus PDF e perfis históricos de emitente | M7 | Bloquear emissão até paridade snapshot↔PDF comprovada |
| P-19 | Recuperação do legado e certificados históricos durante convivência, políticas contratuais de alunos antigos | M10 | Preservar acesso legado, sem exigir migração automática |

## 4. Matriz de prova para incidentes adversariais

| Falha injetada | Resultado exigido |
|---|---|
| Duplo clique na matrícula gratuita | Um direito válido, sem Asaas/Order |
| Duas conclusões simultâneas da última Lesson | Um CourseCompletion e uma intenção de certificado |
| Webhook financeiro repetido/fora de ordem | Sem duplicidade, estados monotônicos de evidência |
| Timeout após refund possivelmente aceito | Sem retry cego; reconciler/FinancialReview |
| Queue publish falha após commit PG | Outbox pendente e recovery reapublica |
| Consumer perde lease após provider aceitar | Fencing impede commit antigo; reconciliação verifica efeito externo |
| Admin perde última role Admin | Operação rejeitada transacionalmente |
| Support chama URL de refund direto | 403/negado pelo serviço, sem efeito |
| Upload fake GIF/HTML com MIME `image/webp` | Não aprovado para publicação |
| Images Free retorna 9422 | Variante estática ou master seguro continua disponível |
| Revogar Certificate durante preview/download | Novos acessos autorizados falham; snapshot histórico intacto |
| Restaurar banco pré-refund | Não reenviar refund automaticamente; reconciliar Asaas |
| Restaurar banco pré-delete LGPD | Preservar evidence de purge e reexecutar exclusões exigíveis antes de liberar |
| Logout User A; login User B offline | Nenhum cache/outbox/PDF de A é mostrado a B |
| PWA offline tenta quiz submit | Bloqueio até conectividade e verificação de tentativa |
| Push de PR malicioso altera workflow CI | Sem acesso a secrets de Production; deploy independente exige SHA homologado |

## 5. Como preencher evidências durante implementação

Para cada entrega, registrar pelo menos: `Requirement ID`, `Task ID`, PR/commit SHA, testes executados (comandos e results), evidência de Staging, limitações conhecidas, responsável e decisão de aceite. Esse registro pode ficar na descrição do PR e em notas do marco; não exige plataforma de project management paga. **Não marcar tarefa como `verified` antes de haver evidência.**
