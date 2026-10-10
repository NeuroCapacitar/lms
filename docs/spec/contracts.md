# Contratos HTTP, assíncronos, storage e integrações

**Estado:** especificação vigente (2026-10-10); código não implementado.

Rotas, nomes de filas e JSON abaixo são **ilustrativos**; o contrato é o comportamento. Domínio: [domain.md](domain.md). Decisões: `docs/review/registro-do-debate.md` e ADRs em `docs/adr/`. Marcações `PENDENTE (spike M0 #n)` usam a numeração dos nove spikes do M0 (1 auth/Hyperdrive, 2 Bun/TS7, 3 latência Neon, 4 JMVStream, 5 Asaas sandbox, 6 Browser Run, 7 imagens, 8 HTMLRewriter, 9 evlog/Sentry).

## 1. Regras gerais HTTP

- JSON **same-origin**; Hono RPC só para tipar o cliente React. Sem API pública nem `/api/v1` na v1.
- Toda entrada passa por **Zod** (tipos RPC não substituem validação em runtime); toda saída é **DTO explícito**, nunca registro Drizzle. Sem endpoints genéricos de update. Mutação por GET é proibida.
- Autorização no caso de uso: capability + recurso + estado, no servidor (deny-by-default). Controle visual nunca autoriza.
- **CSRF próprio para JSON** (`hono/csrf` só cobre content-types de formulário). Em método inseguro, o middleware exige, todos juntos: `Content-Type: application/json`; `Origin` na allowlist do ambiente (ausente = rejeita); `Sec-Fetch-Site` ∈ {`same-origin`, `none`} quando presente. Cookies host-only, `Secure`, `HttpOnly`, `SameSite=Lax`. Webhooks ficam fora deste middleware e têm autenticação própria (§4, §5).
- Erros com código estável para a UI e `correlationId` em log privado. Corpo com limite de tamanho por rota. Nenhum token/credencial de provider chega ao browser, exceto URL de upload assinada de curta validade.
- Assets estáticos com `not_found_handling: "single-page-application"`; navegação não invoca o Worker. `run_worker_first: ["/api/*"]` mais as rotas que usam HTMLRewriter (página do curso e validação de certificado; padrões `!` têm precedência). **HTMLRewriter só injeta meta tags nessas duas páginas**; nenhum SSR (PENDENTE, spike M0 #8: validadores LinkedIn/Meta).
- `clientOperationId` obrigatório em comandos vindos do outbox offline da PWA (§10). IDs de provider nunca provam autorização.
- Bot Fight Mode fica desligado até testar os webhooks (Asaas vem de nuvem). Rate limit crítico (login, link, reembolso) é contado no **Postgres**; o binding Rate Limiting da Cloudflare é só freio (por localização, eventualmente consistente).

## 2. Superfícies da API

| Superfície | Comandos/consultas essenciais | Política |
|---|---|---|
| Auth | pedir magic link, página de confirmação, confirmar, Google e senha (só aluno), perfil, sessões, convite Staff, reautenticação | §9; Staff só por link; Turnstile no pedido |
| Catálogo | listar Courses/Offers publicáveis, `CourseInterest` e ciclos de abertura | Público recebe só dados publicáveis; meta tags via HTMLRewriter |
| Learning | ler aula, progresso de vídeo, concluir aula de texto, `QuizAttempt`, discussões, denúncia | Revalidar Entitlement/expiração, drip, sequência e estado em **toda** mutação |
| Staff | course builder (rascunho/publicação), ofertas, matrícula manual, grants/papéis, inscritos, prévia de aluno, auditoria | Capability + recurso + estado + audit; prévia nunca grava progresso |
| Commerce | criar checkout (login obrigatório), consultar Order/Payment, solicitar `RefundRequest` | Valor e snapshot no servidor; oferta gratuita gera Entitlement sem Order/Payment/Asaas |
| Webhooks | Asaas, Resend (Svix) | Autenticar **antes** da inbox; inbox **antes** do ACK |
| Media | criar intenção de upload, assinar PUT, confirmar e validar bytes, resolver URL | MIME real + escopo de visibilidade |
| Certificate | emissão/consulta Staff, download privado, validação pública | Código opaco + rate limit; PDF nunca público |
| Operations | health live/ready mínimo, backlog, reenvio/ações auditadas | Detalhes só para quem tem grant |

## 3. Assíncrono

**Verdade = Postgres** (outbox de intenções, inbox de eventos externos, tabelas de comando). Queues só aceleram: a DLQ apaga após 4 dias, o Cron recupera.

- **Duas filas por ambiente:** `hub-finance` (eventos e comandos financeiros, refunds, concessão de acesso) e `hub-general` (e-mail, documentos/certificados, mídia, integrações); cada uma com sua DLQ. Nomes físicos isolados por ambiente.
- **Envelope** (sem PII nem payload financeiro completo): `{ "version": 1, "intentId": "uuid", "kind": "...", "correlationId": "..." }`. O consumer relê o estado no PG.
- Fluxo: a transação de negócio grava a intenção; **após o commit** publica na Queue. Publish perdido não perde a intenção.
- **Lease por linha:** claim com `SELECT … FOR UPDATE SKIP LOCKED` em função nomeada, gravando `locked_by`, `lease_expires_at` e token de fencing; toda escrita de resultado condiciona ao token. **Sem advisory locks** (Hyperdrive não os suporta). Chamada a provider **fora** de transação PG.
- **Cron a cada 30 min** (orçamento para acordar o Neon Free; PENDENTE spike M0 #3): varre outbox vencida, inbox não processada, Orders/CheckoutSessions pendentes ou ambíguas, `RefundRequest` em `unknown`, certificados pendentes, avisos de expiração e limpeza de mídia. Lotes limitados.
- **Hyperdrive com cache desligado** (config sem cache para auth, sessão, RBAC e financeiro); driver `pg`, um cliente por requisição (≤6 conexões simultâneas por invocação); sem LISTEN/NOTIFY nem PREPARE SQL.
- Entrega **at-least-once**; idempotência por comando; exactly-once não é prometido. DLQ e retry nunca são replay cego de operação irreversível.
- Observabilidade: um evento amplo por HTTP/job (evlog, a validar no spike M0 #9) com `correlationId`, ambiente, release, resultado, duração; allowlist sem PII/segredos; Sentry para erros relevantes. `AuditLog`, `FinancialEvent`, inbox e outbox são prova durável distinta de log.

**Fault matrix obrigatória (cada item com teste de falha injetada):** publish perdido; mensagem duplicada; payload de versão anterior; claim concorrente; crash entre "provider aceitou" e update no DB; lease perdido/expirado; DLQ; backlog sem jobs novos; provider 429/5xx/timeout; poison event; kill switch ativo; Neon dormindo/lento.

## 4. Asaas

- **Hosted Checkout** (`POST /v3/checkouts`): Pix e cartão até 12x sem juros (a vendedora absorve a taxa; o Checkout não cobra juros ao comprador), **sem boleto**. Nenhum dado de cartão passa pelo Hub. Login obrigatório; sem guest checkout.
- Ordem: Order + snapshot + CheckoutSession locais → chamada ao Asaas → URL. **Não há idempotency key nativa**: a intent durável é nossa; em timeout, procurar/reconciliar antes de recriar. Destino do redirect validado contra allowlist de hosts do Asaas. Notificações de cobrança do Asaas desligadas (o Hub envia os e-mails).
- **Webhook:** header `asaas-access-token` (sem HMAC) comparado em tempo constante; INSERT na inbox com UNIQUE `(provider, event_id)`; responder **HTTP 200 explícito** (201/204/3xx/4xx/5xx contam como falha e podem pausar a fila após ~15 tentativas; retenção de 14 dias). Duplicata, evento desconhecido e evento ignorado também recebem 200. Se a inbox **não** puder ser gravada, não há ACK (reentrega do Asaas). Token inválido não grava nem processa. Janela de 10 s: só autenticar + gravar; regra de negócio na Queue. Allowlist de IP é defesa adicional. Alertar: fila pausada ou nenhum webhook com Orders pendentes. PENDENTE (spike M0 #5): `sendType` (proposta: `NON_SEQUENTIALLY`) e resposta a token inválido.
- **Correlação:** `externalReference` chega nulo; correlacionar pela **sessão de checkout** (`checkoutSession` no Payment; `GET /v3/payments?checkoutSession=`), rejeitando identificadores conflitantes. O payload de `CHECKOUT_PAID` pode não trazer o Payment (PENDENTE, spike M0 #5).
- **Fetch-on-notify:** o evento é só dica; o estado vem de `GET /v3/payments/{id}`; máquina de estados monotônica (regressão ignorada e registrada; transição impossível → `FinancialReview`).

| Evento / situação | Efeito |
|---|---|
| `CHECKOUT_PAID`, retorno do checkout | Só dispara reconciliação (mesmo caso de uso idempotente); **nunca libera acesso** |
| Pix `PAYMENT_RECEIVED` | Libera (após reler o Payment) |
| Cartão `PAYMENT_CONFIRMED` | Libera, exceto análise de risco pendente/reprovada |
| Valor ≠ snapshot, evento desconhecido, resultado ambíguo | `FinancialReview`, sem concessão |
| `PAYMENT_REFUNDED`, chargeback, disputa | Revoga/suspende; `PAYMENT_PARTIALLY_REFUNDED` abre revisão. Política de chargeback: PENDENTE (cliente) |

- **Quota:** 25.000 req/12 h e 50 GETs concorrentes. Reconciliador **dirigido** (só pendentes/ambíguos, com backoff, headers `RateLimit-*`) mais uma varredura diária por janela de datas; sem polling cego.
- **Refund integral** via `RefundRequest` durável (`requested → submitting → submitted|unknown → done|failed|awaiting_external_authorization`), executado por quem tem o grant e com reautenticação recente. Em `unknown`, reler `refunds[]` antes de qualquer retry. Saldo insuficiente (Pix recente) é falha recuperável; estorno de cartão leva até 10 dias úteis. Política: 7 dias garantidos; depois, só exceção do Admin; refund revoga acesso e preserva o certificado emitido.
- Staff vê nome, CPF/CNPJ informado, valor, data e forma de pagamento; NFS-e fora da v1. Origem do CPF/CNPJ e se a página o exige: PENDENTE (spike M0 #5).
- Sandbox e Production isolados. O webhook do legado **não** é redirecionado; a troca ocorre só no cutover. Vendas do legado: histórico somente leitura; reembolso manual no painel Asaas + revogação manual.

## 5. Resend

- **Hosted Templates** são a fonte editorial; sem editor no Hub e sem React Email. Contrato no código: alias, variáveis tipadas, from/reply-to, prioridade de envio, política de falha. Preflight somente leitura valida `published` e variáveis em Staging e antes de Production.
- Templates: `email-verification`, `password-reset`, `staff-invitation`, `purchase-confirmed`, `access-granted`, `access-expiry-warning`, `certificate-issued`, `refund-completed`, `support-request`, `course-available`, **mais `magic-link`**. Quais dos dois primeiros subsistem com magic link como método base: PENDENTE (modelagem de auth).
- **Outbox transacional** com prioridade: link de login > transacional > marketing. Resend Free = **100/dia, 3.000/mês, 3 domínios**; o excedente é **adiado** (nunca descartado). Gatilho de upgrade: 60% da cota em 7 dias. Sem e-mail em massa no cutover.
- Sem tracking de open/click. Chave de idempotência do Resend por envio (janela de 23 h, confirmar). Estados `sending`, `acceptance_unknown`, `accepted`, `delivered`, `failed`, `suppressed`, `bounced`, `complained`; `acceptance_unknown` segue reconciliação, nunca retry cego.
- Webhook Resend: assinatura **Svix** verificada antes da inbox; processamento assíncrono. `EmailRecipientState` registra bounce/complaint; endereço suprimido não recebe marketing e aparece à Staff.
- Avisos de expiração 7 e 1 dia antes, com geração (`expectedExpiresAt`); `superseded` se o prazo mudar.
- **Marketing:** Resend Contacts/Segments/Topics; `MarketingPreference` com consentimento independente e unsubscribe autoritativo. Lead externo entra direto no Resend, sem `User`/`CourseInterest`. PENDENTE (verificar): cota de broadcasts no Free. Suporte humano por caixa de e-mail; `SupportRequest` gera e-mail, sem helpdesk inbound.

## 6. Vídeo

Seis adapters por capabilities: **JMVStream, Panda, Cloudflare Stream, Mux, YouTube, Vimeo**; providers podem se misturar num Course. `VideoAsset` identifica provider e conexão. Capabilities: `managedUpload`, `reportsTime`, `reportsEnded`, `reportsSeek`, `duration`, `resume`, `delete`. Nada é assumido sem declaração do adapter; sem iframe arbitrário.

**Contrato de progresso (comum):**
1. Eventos normalizados: `ready, play, pause, timeupdate(t), seeking, seeked(t), ratechange, ended, error, durationchange`.
2. Todo listener `message` valida `event.origin` (provider) **e** `event.source` (iframe da aula); os exemplos oficiais de Panda/JMV não o fazem.
3. **Duração vem do provider**, gravada no servidor ao processar o `VideoAsset`; nunca do cliente.
4. Heartbeat a cada 15–30 s tocando, mais envio em pause, seek, `ended` e aba oculta (`keepalive`/`sendBeacon`). Payload: `{lessonId, videoAssetId, playbackSessionId, seq, position, clientTs}`.
5. Servidor: revalida acesso/drip/sequência, limita posição a `[0, duração]`, ignora `seq` fora de ordem, guarda a **maior posição** (monotônica). Conclui com `maior/duração ≥ limiar` (Course; default 90%). Seek permitido, sem anti-seek, sem botão manual; conclusão **idempotente**.
6. **Autoavanço só em `ended`** de adapter com `reportsEnded` confiável; opt-in default OFF, cancelável, sujeito a nova checagem de drip no servidor. Sem autoplay.

**Provider × risco conhecido:** Panda: `panda_ended` não dispara com autoplay. YouTube: sem `timeupdate` (polling de `getCurrentTime`), `ended` = estado 0. Vimeo: `ended` não dispara com loop. JMVStream: eventos de saída (`timeupdate`/`ended`) **não confirmados** (PENDENTE, spike M0 #4). Navegador em aba oculta limita timers; iOS pode forçar fullscreen nativo.

- **Ativação:** um adapter só aparece na interface da Staff depois de passar nos testes de contrato com **conta real fornecida pelo cliente**.
- **YouTube em Course com Offer paga é permitido**, risco aceito pelo responsável (política da API proíbe cobrar para ver o player embutido). A UI da Staff mostra aviso ao anexar; ciência do cliente: PENDENTE (cliente).
- **Teste de contrato por provider:** normalização de IDs/status/URL; proteção de domínio; erro/timeout; upload e falha de processamento; delete só de ativo próprio; rejeição de URL/iframe inseguros; progresso (89% vs 90%, seek ao limiar, 2x, aba oculta, `ended`, troca de usuário no mesmo browser) e, no iPhone real, fullscreen e `ended`.

## 7. R2 e mídia

- R2 canônico. **Público: só capas e banners publicados.** **Privado: todo o resto** (aulas, assinatura, fundos, certificados, avatares). Sem Images Hosted. Custom domain na zona para cache/WAF; `r2.dev` só em desenvolvimento.
- **Master** editado/recortado no navegador; só ele sobe (câmera original não é guardada). Fluxo: intenção → presigned **PUT** curto (URL no domínio S3 do R2; CORS) → confirmação. Content-Type pode ser assinado; **Content-Length/checksum assinados não são garantidos** (PENDENTE, spike M0 #7), então o servidor valida **os bytes**: tamanho, magic bytes/MIME real, dimensões, ownership e SHA-256. `200` do PUT não torna o `MediaAsset` publicável.
- Upload incompleto expira em **24 h**; chave opaca imutável; exclusão após 0 referências efetivas (exceto purge de privacidade).
- **Variantes públicas:** Cloudflare Images Free, **5.000 transformações únicas/mês** (acima disso, erro 9422 sem cobrança). Variantes semânticas em allowlist, nunca dimensão arbitrária. **Fallback estático** (master/variante pré-gerada) em falha ou limite.
- **Privado:** GET assinado de curta validade após autorização; `Cache-Control: private, no-store`; sem cache compartilhado.
- **Bucket lock** para retenção do PDF revogado (90 dias, CONDICIONAL a parecer jurídico): lock por prefixo tem precedência sobre lifecycle; mecanismo (mover para prefixo travado) PENDENTE (modelagem). R2 não tem região na América do Sul: transferência internacional PENDENTE (advogado do cliente).
- Backups: dump cifrado com `age` no R2; inventário com SHA-256; cópia semanal fora da Cloudflare (destino PENDENTE, cliente).

## 8. Certificados e Browser Run

- `CourseCompletion` histórico → emissão **assíncrona** (fila `hub-general`): `completion elegível → intent única → pending/generating → ready|failed`. Falha não altera a conclusão; retry é seguro.
- Renderer recebe **snapshot imutável** (dados + layout) e assets curados. HTML/CSS escapado, **sem rede arbitrária** (`rejectRequestPattern`; Lexend Deca embutida). PDF por `env.BROWSER.quickAction("pdf", …)` (Browser Run, sem API token); armazenado no R2 **privado** com **SHA-256** e código opaco. Retries idempotentes: sessões do Browser Run caem em rollouts; Quick Actions têm limite de taxa. PENDENTE (spike M0 #6): `compatibility_date` mínima, fonte e paridade do editor A4 com o PDF.
- Revogação (só Admin) e reemissão (grant) são comandos auditados; o PDF original nunca é reescrito. Certificado emitido permanece após reembolso, com registro.
- **Página pública mínima** por código opaco: status e dados mínimos, **sem CPF, e-mail ou pagamento** e sem PDF irrestrito; rate limit por IP; meta tags via HTMLRewriter. Exibir o nome da pessoa e quando ela o confirma antes da 1ª emissão: PENDENTE (modelagem). Certificados migrados mantêm código, hash e URL.

## 9. Auth e magic link

- **Magic link é o método base de todos; Staff entra somente por ele** (o servidor rejeita senha/Google para quem tem papel de Staff). Aluno pode ainda usar Google e senha opcional; passkeys adiadas. Sessão em PostgreSQL, rolling de 7 dias. Better Auth em versão exata (`validateSchema:false` se necessário; PENDENTE, spike M0 #1).
- Fluxo: pedido (Turnstile validado no servidor; resposta neutra igual com ou sem conta) → e-mail → link abre **página de confirmação** (GET não consome o token; anti-scanner) → `POST` explícito consome e cria a sessão. Token **de uso único** e **expiração curta** (valor: PENDENTE, spike M0 #1; proposta ≤15 min).
- **Rate limit** por e-mail **e** por IP, com contadores no Postgres (nunca em memória do isolate). Sem isso o envio de links esgota os 100 e-mails/dia do Resend.
- **Reautenticação recente por novo link** para ações sensíveis: refund, grants/papéis, convite Staff, revogar certificado, credenciais de integração, manutenção. Janela: PENDENTE.
- Linking Google só com e-mail verificado dos dois lados. ≥1 Admin ativo (checado por transação). `StaffInvitation` por link; sem impersonation; prévia de aluno sem gravar progresso. Aceite versionado de termos no cadastro.

## 10. PWA offline (somente Student)

- Lease de acesso offline = `min(expiração do Entitlement, última verificação + 72 h)`. Caches e dados por usuário; logout e troca de usuário limpam tudo. Vídeo sempre online; submissão de quiz online; Staff só online.
- Sync: outbox offline **allowlisted** (ex.: progresso de aula de texto); cada comando traz `clientOperationId` e o servidor deduplica e **revalida acesso e drip** na hora do sync. Conflitos e lease expirado resultam em erro tipado, nunca em concessão.
- Gate de release: iPhone real (Safari/WebKit). `vite-plugin-pwa` em `injectManifest`.

## 11. Matriz de testes por contrato

| Contrato | Teste mínimo |
|---|---|
| HTTP/CSRF | Origin/Fetch Metadata/Content-Type; formulário cross-site; acesso cruzado direto pela API; DTO sem campos extras |
| Async | Fault matrix completa em PG18 real (lease, fencing, SKIP LOCKED concorrente) e em workerd (Queue/Cron) |
| Asaas | Eventos duplicados, fora de ordem, falsos, valor alterado, `CHECKOUT_PAID` sozinho, timeout/`unknown`, refund concorrente; sandbox em Staging |
| Resend | Svix inválido, duplicado, supressão, estouro de cota, `acceptance_unknown`, preflight de templates |
| Vídeo | Contrato por provider com conta real; progresso (§6) |
| R2/mídia | Upload adulterado (MIME/bytes), TTL 24 h, autorização do GET privado, fallback de imagem |
| Certificado | Snapshot↔PDF, escaping, SSRF, retry, SHA-256, página pública sem dado extra |
| Auth | Scanner pré-consome link, reuso, expiração, enumeração, rate limit, Turnstile, reautenticação, Staff sem senha/Google |
| PWA | Troca de usuário, logout, lease, offline→online, WebKit e iPhone real |

Vitest (Node, PG18 real) para domínio e locks; `@cloudflare/vitest-plugin` para Hono/Queues/Cron; Playwright para jornadas; smoke de sandbox em Staging. CI comum não gera efeito financeiro nem e-mail real.

## 12. Lacunas / PENDENTE

- **Spikes M0:** #1 expiração e janela do link, Better Auth+`pg`+Hyperdrive; #3 latência e orçamento de acordar Neon (frequência do Cron); #4 eventos e restrição de domínio do JMVStream; #5 payload `CHECKOUT_PAID`, CPF na página, `sendType`, token inválido, checkout por `externalReference`, prazo de estorno Pix; #6 `compatibility_date`, fonte, tempo do PDF; #7 checksum/Content-Length no PUT, Images e fallback; #8 validadores de preview; #9 evlog e Sentry.
- **Cliente:** contas de teste dos seis providers; ciência do risco do YouTube; política de chargeback; destino da cópia off-cloud.
- **Advogado/contador:** retenção de 90 dias do PDF revogado; transferência internacional (R2 sem São Paulo); NFS-e.
- **Modelagem:** nome na página pública e confirmação do nome; destino de `email-verification`/`password-reset`; mecanismo do bucket lock; identidade canônica de e-mail (lição do legado com Gmail); cota de broadcasts do Resend Free.
