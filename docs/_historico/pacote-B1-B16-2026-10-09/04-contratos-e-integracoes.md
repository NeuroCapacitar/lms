# 04 — Contratos HTTP, Queues, storage e integrações

## 1. Regras gerais

- HTTP/JSON **same-origin**, Hono RPC para tipagem do cliente React; toda entrada não confiável validada por Zod e autorização executada no caso de uso. Não exigir API pública/versionamento `/api/v1` na v1.
- Respostas são **DTOs explícitos**, não registros brutos Drizzle. Mutações GET proibidas. Erros estáveis para UI e correlação em logs privados. API staff nunca substitui autenticação/capacidade/ownership por simples controle visual.
- `clientOperationId` em comandos sincronizados pela PWA. IDs de provider não são prova de autorização. Tokens e credenciais nunca atravessam para browser exceto URLs/token de upload de validade restrita.

## 2. Superfícies da API (rotas ilustrativas, não definitivas)

| Superfície | Comandos/consultas essenciais | Política |
|---|---|---|
| Auth | Better Auth handlers, perfil, sessões, convite Staff | Cookies host-only, origem confiável, sessão Postgres |
| Catálogo | Listar Courses/Offers, CourseInterest e ciclos de abertura | Público só recebe dados publicáveis |
| Learning | Ler release/aula, registrar conclusão, progresso, QuizAttempt, discussões | Revalidar entitlement, drip, mode e release em toda mutação |
| Staff | Course builder, ofertas, publicação, roles/capabilities, alunos | Capability + recurso + estado + audit |
| Commerce | Criar checkout, consultar Order/Payment, solicitar refund | Valor server-side + snapshot + transação curta |
| Webhooks | Asaas, Resend e provider vídeo, se aplicável | Segredo/assinatura provider **antes** da inbox/ACK |
| Media | Criar upload intent, assinar PUT, confirmar HEAD e validação, resolver preview | Allowlist MIME real + escopo de visibilidade |
| Certificate | Emissão/consulta Staff, download privado, verificação pública | Código opaco com rate limit; PDF privado |
| Operations | Health live/ready, backlog, ações auditadas | Health público mínimo; detalhes staff autorizados |

## 3. Mensagens assíncronas

Categorias Queues/DLQs aprovadas: `hub-finance-events`, `hub-finance-commands`, `hub-email`, `hub-documents`, `hub-integrations`. Isolar nomes físicos por ambiente. O transport envelope carrega identificador da intenção e versão de contrato, sem copiar payloads inteiros de aluno/financeiro ou segredos.

**Modelo conceitual:**

```json
{
  "version": 1,
  "intentId": "uuid",
  "kind": "email.purchase-confirmed",
  "correlationId": "opaque-id"
}
```

Este JSON é ilustrativo: a taxonomia final deve ser fechada por módulo. Produtores gravam intenção no **PostgreSQL na transação de negócio**, publicam Queue após commit. Falha do publish não perde a intenção; reconciliation Cron a reenvia. Consumer reclama ownership com lease/fencing, chama provider fora de transação e consolida resultado. `at-least-once` é expectativa; **exactly-once não é prometido**. DLQ e retries não são replays cegos de operações irreversíveis.

**Fault matrix obrigatória:** publish perdido; Queue duplicada; payload versão anterior; claim concorrente; consumer crash entre provider accepted e DB update; lease perdido; DLQ; backlog sem jobs novos; provider 429/5xx; poison event; kill switch ativado. Cada caso tem teste de integração/falha injetada.

## 4. Pagamentos Asaas

- **Hosted Checkout only**; nenhuma coleta de dados de cartão no Hub.
- Criar Order/snapshot antes da chamada externa; timeout/unknown state resulta em reconciliação, não duplicidade indiscriminada.
- Webhook Asaas autenticado pelo header `asaas-access-token` de segredo compartilhado; **não inventar assinatura HMAC de payload**. A autenticação ocorre antes de gravar inbox. Mapear eventos à matriz de estados local aprovada.
- `CHECKOUT_PAID` não libera direito. Pix/cartão exigem evidência financeira por Payment conforme thresholds de evento autorizados; estado incerto → FinancialReview.
- Refund apenas integral no Hub v1, intent durável, efeito externo fora da transação e audit; provider status aceito/desconhecido não autoriza retry cego. Suporte pode visualizar/operar apenas grants autorizados.
- Sandbox Staging e Production isolados. Na coexistência do legado, **não redirecionar webhooks legados à vNext**.

## 5. Resend e comunicação

**Templates editoriais hospedados no Resend**; contrato de template no código: alias/ID, variáveis tipadas, from/reply-to, política de envio, falha/compatibilidade. Revalidar saúde dos templates em Staging e preflight Production. Sem editor Hub e sem React Email editorial concorrente.

Templates v1: `email-verification`, `password-reset`, `staff-invitation`, `purchase-confirmed`, `access-granted`, `access-expiry-warning`, `certificate-issued`, `refund-completed`, `support-request`, `course-available`.

Transacional sem tracking open/click, outbox durável, callback Resend assinado no formato real Svix, `EmailRecipientState` com supressões. Não confundir accepted/delivered/failed. Retry somente se efeito seguramente reexecutável; status acceptance_unknown segue reconciliação/avaliação. Avisos expiração 7 e 1 dia antes, superseded quando prazo muda.

Marketing externo por Resend Contacts/Segments/Topics; `MarketingPreference` opt-in do Hub e unsubscribe autoritativo. Leads de landing page externa entram diretamente no Resend; nenhuma criação automática de usuário ou interesse Hub. Suporte humano via Lark Mail; Hub gera SupportRequest e e-mail, não helpdesk inbound.

## 6. Vídeo — adapter por capabilities

Seis providers v1: **JMVStream, Panda Video, Cloudflare Stream, Mux, YouTube e Vimeo**. Quatro primeiros podem oferecer managed upload segundo capability; YouTube e Vimeo são referenciados. É possível misturar providers no mesmo Course. `VideoAsset` identifica provider e conexão concreta. Não implementar suporte universal de `ended`, resume, duration, delete, captions, processing sem confirmação do adapter.

**Teste contratual por provider:** normalize external IDs, status, playback URL, proteção de domínio, error/timeout, upload completion, processing failure, delete only for owned assets, unsafe URL/iframe rejection, duration/seek/resume/end only if provider supports. O YouTube em Course pago terá aviso de proteção inferior, sem proibição indevida.

## 7. R2 mídia — após IMG-R1..R6

- Bucket/prefixo **público** apenas para imagens publicadas e amplamente visíveis (capas e banners); bucket **privado** para aulas, certificados, assinatura e assets Staff sensíveis.
- Editar crop/conversão no browser, enviar somente o **master editado**. Gerar intenção de upload e URL `PUT` S3 assinada de curta validade; browser envia direto; backend confirma HEAD/tamanho/assinatura real/dimensões/ownership. A simples resposta `200 PUT` não torna o MediaAsset publicável.
- Usar `MediaAsset` com versão de chave opaca imutável, contagem ou relações de referências e limpeza em background idempotente; TTL de upload incompleto 24h; exclusão só após 0 referências efetivas. Exceção para purges obrigatórios de privacidade.
- Entrega pública por CDN com variantes semânticas restritas. **Cloudflare Images Free 5.000 transformações únicas/mês** para imagens externas/R2; fallback estático quando limite ultrapassar ou transformação falhar. Nunca permitir dimensão dinâmica arbitrária que consuma toda quota; não depender de Images binding pago para fluxo gratuito público.
- Entrega privada com GET assinado após autorização ou streaming protegido, sem cache compartilhado de dados de aluno.
- Backups de masters e PDF: R2 canônico, inventário, SHA/digest e cópia seletiva de recuperação (não duplicação operacional de todos os vídeos).

## 8. Certificados / Browser Run

Editor controlado de geometria A4 e campos pré-definidos; dados semânticos e layout congelados no momento da emissão. `CertificateRenderer` recebe snapshot e assets curados; HTML escapado, sem rede arbitrária; Quick Action `/pdf` com tempo/cotas monitorados, invocação por job e persistência R2 privada. Falha mantém CourseCompletion e permite retry seguro de emissão pendente, sem alterar Certificate concluído. Assinatura e fundo em R2 privado acessíveis pelo renderer sem tornar URLs públicas permanentes.

Ciclo: `eligible completion → intent unique → pending/generating → pdf ready|failed`; revogação/reemissão são comandos auditados, não reescrita do PDF original. Verificação pública só status e dados mínimos; download requer autorização. Retenção de PDF revogado 90 dias desde `revokedAt` como decisão técnica/produto **pendente de parecer jurídico**; purge tenta excluir fisicamente e conserva tombstone mínimo.

**PoC obrigatória:** usar runtime/capabilities vigentes do Browser Run; documentações atuais requerem `compatibility_date` ≥ `2026-03-24` para Quick Action e modo remoto ao testar o binding localmente: https://developers.cloudflare.com/browser-run/quick-actions/ .

## 9. Resiliência e observabilidade

A cada HTTP/job um evento amplo estruturado via evlog, com `correlationId`, `environment`, `release`, resultado e duração. Workers Logs primário, amostragem de sucessos, retenção curta, sem PII/segredos por allowlist. Sentry somente erros importantes e traces com coleta seletiva. Web Analytics manual/privacidade, sem replay; métricas operacionais derivadas de Postgres e filas. `AuditLog`, `FinancialEvent`, inbox/outbox são provas duráveis distintas dos logs. Tracing entre Queue/outbox/provider explícito e útil para incidentes.

## 10. Testes por contrato

- Vitest Node: domínio puro, React, serializers e regras; PG18 real em service/container para lock e constraints.
- `@cloudflare/vitest-plugin`: Hono e workerd com bindings simulados/controlados, Queues/Cron/adapters.
- Playwright: primeiro caminho de curso gratuito, auth, financeiro simulado, quiz, certificado, offline e RBAC; WebKit e iOS real nos recursos offline críticos.
- Sandbox/Smoke Staging: OAuth, Asaas, Resend, R2, Browser Run, vídeo, Neon Hyperdrive.
- Não gerar efeitos financeiros reais ou envios não autorizados em CI comum.
