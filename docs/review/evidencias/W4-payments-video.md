# W4 — Pagamentos (Asaas e alternativas) e Vídeo (6 adapters): pesquisa técnica

- **Data da pesquisa e da leitura das fontes:** 2026-10-09 (todas as URLs abaixo lidas nesta data, salvo indicação).
- **Escopo:** reavaliar as decisões B4 (Asaas Hosted Checkout, Order/CheckoutSession/Payment, reconcile-first, refund integral) e B2 (seis providers de vídeo, threshold 90%, autoavanço só em `ended`) do `docs/planning/09-registro-de-decisoes.md`.
- **Método:** documentação oficial (docs.asaas.com, docs.stripe.com, developers.cloudflare.com, mux.com, bunny.net, docs.pandavideo.com, jmvstream.com, developers.google.com, help.vimeo.com, WebKit, MDN, Chrome) e páginas de preços. Resultados de busca e blogs de terceiros aparecem marcados como **indicativos**.
- **Limitação:** a cota de WebSearch da sessão (compartilhada entre agentes) acabou no meio da pesquisa. Depois disso continuei só com WebFetch em URLs oficiais conhecidas. Os itens que ficaram sem confirmação estão marcados como **"não confirmado"**. Não inventei preço nenhum. Câmbio, quando aparece, é premissa explícita.
- **Convenção:** "doc oficial" = página do próprio provedor; "terceiros" = blog, agregador ou concorrente.

---

## PARTE 1 — PAGAMENTOS

### 1. Asaas

#### 1.1 Produtos hospedados: Checkout (`/v3/checkouts`) × Link de pagamento (`/v3/paymentLinks`) × fatura (`invoiceUrl`)

| Aspecto | **Asaas Checkout** (`POST /v3/checkouts`) | **Link de pagamento** (`POST /v3/paymentLinks`) | **Cobrança + fatura hospedada** (`POST /v3/payments` → `invoiceUrl`) |
|---|---|---|---|
| Natureza | Sessão de pagamento efêmera, com itens, expiração e callbacks | Link reutilizável. Cada preenchimento gera uma nova cobrança e um novo customer | Cobrança (Payment) criada antes. O pagador abre a fatura Asaas |
| Métodos | `billingTypes`: **somente `CREDIT_CARD` e `PIX`** na referência OpenAPI. O changelog cita boleto, mas a referência não lista (**divergência**: tratar boleto como **não suportado** no Checkout até prova em sandbox) | `UNDEFINED` (pagador escolhe), `BOLETO` (exige `dueDateLimitDays`), `CREDIT_CARD`. Parcelado só com cartão | `BOLETO`, `CREDIT_CARD`, `PIX`, `UNDEFINED` (enum do filtro de listagem) |
| Tipos | `chargeTypes`: `DETACHED`, `INSTALLMENT` (`maxInstallmentCount` 1–21), `RECURRENT` | `DETACHED`, `INSTALLMENT`, `RECURRENT` | Avulsa, parcelamento e assinatura por endpoints próprios |
| Expiração | `minutesToExpire` de 10 a 1440 min. Depois de expirar, criar outro Checkout | Ativo até desabilitar | Vencimento (`dueDate`) |
| Callbacks | `successUrl` e `cancelUrl` (obrigatórias), `expiredUrl` | Não documentado na página lida | — |
| Dados do pagador | `customerData` (name, cpfCnpj, email, phone, endereço) **ou** `customer`, ou o pagador preenche na página. A referência OpenAPI **não** tem a propriedade `customer`, embora a prosa a cite (divergência) | Customer criado no preenchimento. Pode **duplicar** CPF/CNPJ | Customer prévio obrigatório |
| Vínculo com Payment | O objeto Payment tem o campo **`checkoutSession`**, e `GET /v3/payments` aceita o **filtro `checkoutSession`** (e `externalReference`) | O Payment tem o campo `paymentLink` (não é filtrável) | Payment id conhecido desde o início |
| Eventos | `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED`, `CHECKOUT_EXPIRED`, mais os `PAYMENT_*` da cobrança gerada | `PAYMENT_*` | `PAYMENT_*` |

Detalhes práticos da referência do Checkout:
- `items[]` exige `imageBase64`, `name` (até 30 caracteres), `quantity` e `value`. `description` aceita até 150 caracteres.
- `externalReference` aceita até 200 caracteres.
- A resposta traz `id` e `link`. A URL do Checkout segue o formato `https://asaas.com/checkoutSession/show?id=...`.
- Cancelamento: `POST /v3/checkouts/{id}/cancel`.

O payload de exemplo de `CHECKOUT_CREATED` traz `checkout.id` mas **não** traz `externalReference` nem payment id. O exemplo de `CHECKOUT_PAID` não aparece na página. **Não confirmado** se ele inclui o payment id. Por isso a conciliação deve usar `GET /v3/payments?checkoutSession={checkoutId}`.

Fontes: https://docs.asaas.com/docs/checkout-asaas · https://docs.asaas.com/reference/criar-novo-checkout · https://docs.asaas.com/docs/faq-do-asaas-checkout · https://docs.asaas.com/docs/eventos-para-checkout · https://docs.asaas.com/docs/introdu%C3%A7%C3%A3o-1 · https://docs.asaas.com/changelog/checkout-asaas-disponível-para-integrações-via-api · https://docs.asaas.com/docs/criando-um-link-de-pagamentos · https://docs.asaas.com/reference/listar-cobrancas · https://docs.asaas.com/docs/checkout-para-cart%C3%A3o-de-cr%C3%A9dito

#### 1.2 Customer e CPF/CNPJ
- `POST /v3/customers`: os campos obrigatórios do schema são **`name` e `cpfCnpj`**. Fonte: https://docs.asaas.com/reference/criar-novo-cliente
- No Checkout, nenhum campo de `customerData` está marcado como obrigatório no schema. Como o Asaas precisa de customer com CPF/CNPJ para cobrar, **inferi** que a página hospedada pede CPF quando o dado não vem preenchido (**não confirmado**, testar em sandbox).
- Implicação para a vNext: como o B4 exige comprador autenticado e verificado, o Hub deve **pré-preencher `customerData`** (nome, e-mail e CPF, se coletado) para reduzir atrito e evitar customers duplicados. A coleta de CPF no Hub é dado pessoal sensível de cadastro. Validar com a política de privacidade (fora deste escopo).

#### 1.3 Métodos de pagamento
- **Pix, cartão à vista, cartão parcelado (até 21x no Checkout):** confirmados.
- **Boleto:** confirmado em `/v3/payments` e em link de pagamento. No Checkout, **não confirmado** por causa da divergência descrita em 1.1.
- **Juros do parcelamento repassados ao comprador:** as páginas do Checkout **não tratam do assunto** (não confirmado).
- **Débito:** existe como `billingType` de resposta (`DEBIT_CARD`).
- **Pix Automático:** é "acesso controlado". A ativação passa pela equipe de integração e funciona por API própria (autorização com QR composto, "Jornada 3"), **não pelo Checkout**. Fonte: https://docs.asaas.com/docs/automatic-pix. Irrelevante para venda avulsa.

#### 1.4 Webhooks: autenticação, entrega, reentrega e pausa

| Item | Comportamento documentado |
|---|---|
| Autenticação | Token estático configurado no webhook (`authToken`), enviado no header **`asaas-access-token`**. Não há HMAC de payload. A doc proíbe usar a API Key como authToken. O Asaas não envia Bearer nem Basic: validar esses esquemas pode causar 403 |
| IPs oficiais (produção) | 52.67.12.206, 18.230.8.159, 54.94.136.112, 54.94.183.101. Os IPs 54.207.175.46 e 54.94.35.137 foram desativados em 23/10/2024 (changelog), mas ainda aparecem na página em inglês. O sandbox pode usar IPs adicionais |
| Sucesso | **Somente HTTP 200.** 201, 204, 3xx, 4xx e 5xx contam como falha. Redirecionamentos não são seguidos |
| Timeout | Até **10 s** (FAQ de webhooks) |
| Garantia | **At-least-once.** O `id` do evento é igual nas reentregas e serve de chave de idempotência |
| Ordem | `sendType`: `SEQUENTIALLY` preserva a ordem, mas um evento lento ou falho **atrasa os seguintes** (head-of-line). `NON_SEQUENTIALLY` não garante ordem e tem mais vazão |
| Retentativas | Backoff progressivo em 15 tentativas: 0 s, 30 s, 1 min, 3,5 min, 5 min (e-mail 1), 15 min, 25 min, 1 h, 1 h, 1 h (e-mail 2), 1 h, 1 h, 2 h, 2 h, 3 h (e-mail 3 e **fila interrompida**) |
| Fila interrompida | Os eventos continuam sendo gerados e armazenados, mas não são enviados até a reativação (painel ou `interrupted: false` via API). Retenção de **14 dias**: depois disso, exclusão permanente. `POST /v3/webhooks/{id}/removeBackoff` remove a penalização (rate limit mais restrito). A pausa afeta só aquele webhook |
| Limites | Até **10 webhooks por conta**. Logs em Integrações → Logs de Webhooks |
| Recomendação oficial | Receber → **persistir** → responder 200 → processar de forma assíncrona. Tolerar campos novos no payload |

Fontes: https://docs.asaas.com/docs/sobre-os-webhooks · https://docs.asaas.com/docs/fila-pausada · https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas · https://docs.asaas.com/docs/faq-de-webhooks · https://docs.asaas.com/docs/tipos-de-envio · https://docs.asaas.com/docs/ips-oficiais-do-asaas · https://docs.asaas.com/changelog/atualização-na-lista-de-ips-oficiais-dos-webhooks-asaas

**Pegadinhas para Hono/Workers:**
1. Responder com `c.body(null, 204)` ou `201` **é contado como falha** e pode levar à pausa da fila. É obrigatório retornar 200 explícito.
2. A janela de 10 s acomoda bem "autenticar + INSERT no inbox via Hyperdrive". A regra de negócio deve ir para a Queue.
3. O token é estático e não há timestamp assinado. Uma requisição capturada pode ser reenviada (replay), e a deduplicação por `event.id` resolve isso. Somado a "reconsultar o recurso na API antes de agir" (fetch-on-notify), o efeito de eventos forjados ou repetidos fica neutralizado.
4. A allowlist de IP pode ficar numa regra WAF na frente da rota ou numa checagem de `CF-Connecting-IP` no Worker. Ela é defesa adicional, não substitui o token.

#### 1.5 Eventos de cobrança e sequências típicas (doc oficial)
- **Pix:** `PAYMENT_CREATED` → `PAYMENT_RECEIVED`. Pix não passa por `CONFIRMED`. `RECEIVED` significa "valor disponível na conta".
- **Cartão de crédito:** `PAYMENT_CREATED` → `PAYMENT_CONFIRMED` → (32 dias) → `PAYMENT_RECEIVED`.
- **Boleto:** `CREATED` → `CONFIRMED` → `RECEIVED`.
- **Estorno:** `CONFIRMED|RECEIVED` → `PAYMENT_REFUNDED`. Existem também `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS` ("liquidação já agendada") e `PAYMENT_REFUND_DENIED` (só boleto).
- **Chargeback:** `PAYMENT_CHARGEBACK_REQUESTED`. Com disputa, segue para `PAYMENT_CHARGEBACK_DISPUTE`. Se o lojista ganhar: `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` → `CONFIRMED|RECEIVED`. Se perder: `PAYMENT_REFUNDED`.
- **Outros relevantes:** `PAYMENT_AWAITING_RISK_ANALYSIS`, `PAYMENT_APPROVED_BY_RISK_ANALYSIS`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS`, `PAYMENT_AUTHORIZED` (captura pendente), `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `PAYMENT_DELETED`, `PAYMENT_RESTORED`, `PAYMENT_UPDATED`, `PAYMENT_OVERDUE`, `PAYMENT_CHECKOUT_VIEWED`.
- Fonte: https://docs.asaas.com/docs/webhook-para-cobrancas
- **Implicação:** o "threshold de evidência financeira" do B4 fica naturalmente assim: **Pix = `RECEIVED`; cartão = `CONFIRMED`**. Chargeback e estorno revogam ou suspendem o Entitlement conforme a política. `CHECKOUT_PAID` serve só como **gatilho de reconsulta**.

#### 1.6 Idempotência, sandbox e rate limits
- **Idempotência de requisição:** **não há header Idempotency-Key documentado** (não aparece em checkout nem em refund). A idempotência fica do nosso lado. Na criação do Checkout: Order e CheckoutSession locais criados antes, com `externalReference` = id local. Em caso de timeout, procurar antes de recriar. **Não confirmado** se existe `GET /v3/checkouts` com filtro por `externalReference`. Testar.
- **Sandbox:** base `https://api-sandbox.asaas.com` (citada na referência de estorno). A API Key é por ambiente. O sandbox pode usar outros IPs de webhook.
- **Rate limits** (https://docs.asaas.com/reference/api-limits):
  - Cota de **25.000 requisições por 12 h** por conta.
  - Até **50 GETs concorrentes**.
  - Limites por endpoint (não listados) informados pelos headers `RateLimit-Limit/Remaining/Reset`.
  - A doc avisa que, **se for constatado polling, a cota não é aumentada**.
  - Implicação: o reconciliador deve ser **dirigido**, consultando só Orders pendentes ou ambíguas com backoff, e nunca fazer varredura cega periódica.

#### 1.7 Reembolso
- Endpoint: `POST /v3/payments/{id}/refund`.
  - Body opcional: `value` (sem valor = estorno integral), `description`, `splitRefunds`.
  - Pix aceita estorno integral ou vários parciais até o total.
  - Cartão pode ser estornado quando `CONFIRMED` ou `RECEIVED`. A página não diz se aceita estorno parcial de cartão.
  - O estorno de cartão leva até **10 dias úteis** para aparecer na fatura do pagador.
  - Pix: as taxas não são devolvidas. Um **estorno logo após o recebimento pode falhar com 400 por saldo insuficiente**.
  - Status do objeto refund: `PENDING`, `AWAITING_CRITICAL_ACTION_AUTHORIZATION`, `AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION`, `CANCELLED`, `DONE`.
  - **Sem chave de idempotência documentada.** Fonte: https://docs.asaas.com/reference/estornar-cobranca
- **Prazo máximo para estornar Pix (ex.: 90 dias): não confirmado** na doc do Asaas.
- **Implicações para o `RefundRequest` do B4:**
  1. Antes de qualquer retry, reler `GET /v3/payments/{id}` e conferir `status`/`refunds[]`. Retry cego pode estornar duas vezes.
  2. O estado `AWAITING_CRITICAL_ACTION_AUTHORIZATION` indica que o estorno pode exigir **aprovação humana no painel** (evento crítico). Isso precisa ser modelado como estado "aguardando autorização externa".
  3. O 400 por saldo insuficiente é falha **recuperável e operacional**, não terminal.

#### 1.8 Chargeback
- Os eventos estão em 1.5.
- Há API de disputa (changelog de dez/2024): `POST` de disputa com `files`. O `id` é do **chargeback**, não da cobrança.
- Fontes: https://docs.asaas.com/reference/chargeback-1 · https://docs.asaas.com/changelog/permitir-a-realização-de-solicitações-de-disputas-e-consultas-de-chargebacks-através-da-api
- Formatos e prazos da disputa: **não confirmados**.

#### 1.9 Split
- Existe no Checkout (`splits[]`: `walletId`, `fixedValue`, `percentageValue`, `totalFixedValue`) e no estorno (`splitRefunds`).
- Há eventos `PAYMENT_SPLIT_*`. Irrelevante para single-tenant sem coprodução.

#### 1.10 NFS-e pelo Asaas
- API de notas fiscais:
  - Agendar nota vinculada a `payment`, `installment` ou `customer`.
  - Para o código do serviço municipal, usar `municipalServiceId` quando a prefeitura tem listagem, ou `municipalServiceCode` manual (obrigatório no **Portal Nacional**, que não expõe lista).
  - Exigências por município em `GET /v3/fiscalInfo/municipalOptions`.
  - Eventos: `INVOICE_AUTHORIZED`, `INVOICE_ERROR`, `INVOICE_PROCESSING_CANCELLATION`, `INVOICE_CANCELED`, `INVOICE_CANCELLATION_DENIED`.
  - "Nem todos os municípios permitem cancelamento automático."
  - Novos campos de IBS/CBS (Reforma Tributária) no objeto `taxes`. A página foi atualizada em 2026-09-10.
- **Custo:** R$ 0,49 por nota emitida (página de preços).
- **Lista de municípios atendidos e requisito de certificado A1: não confirmados.**
- Fontes: https://docs.asaas.com/docs/faq-de-notas-fiscais · https://docs.asaas.com/docs/emitindo-notas-fiscais-de-servico · https://www.asaas.com/precos-e-taxas
- **Implicação:** é uma vantagem real do Asaas sobre Stripe, Mercado Pago e Pagar.me para quem precisa emitir NFS-e de cursos (serviço). Mas a emissão fiscal precisa de decisão contábil (CNAE, município, regime) **antes** de entrar no escopo.

#### 1.11 Taxas e prazos (página oficial, valores "padrão" — a conta real mostra as taxas em Menu > Taxas)
Fonte: https://www.asaas.com/precos-e-taxas. Há promoção nos 3 primeiros meses a partir do cadastro.

| Item | Regular | Promo (3 meses) |
|---|---|---|
| Pix recebido | R$ 1,99 / transação | R$ 0,99 |
| Boleto recebido | R$ 1,99 | R$ 0,99 |
| Cartão à vista | 2,99% + R$ 0,49 | 1,99% + R$ 0,49 |
| Cartão 2–6x | 3,49% + R$ 0,49 | 2,49% + R$ 0,49 |
| Cartão 7–12x | 3,99% + R$ 0,49 | 2,99% + R$ 0,49 |
| Cartão 13–21x | 4,29% + R$ 0,49 | 3,29% + R$ 0,49 |
| Débito | 1,89% + R$ 0,35 | — |
| Antecipação cartão | 1,25% a.m. (à vista) / 1,70% a.m. (parcelado) | — |
| Notificações | E-mail+SMS R$ 0,99 por cobrança paga. WhatsApp R$ 0,55 por mensagem | — |
| NFS-e | R$ 0,49 por nota | — |
| Transferência Pix PJ | 30 grátis por mês, depois R$ 2,00 | — |

- **Prazos:** cartão em D+32 (FAQ da página). Pix vai direto para `RECEIVED` (saldo disponível). Antecipação de cartão em até 2 dias úteis, sujeita a análise.
- **Atenção:** desligar as notificações de cobrança do Asaas se o Hub mandar os próprios e-mails (Resend). Do contrário entra R$ 0,99 por cobrança e o aluno recebe comunicação duplicada.

#### 1.12 SDK e Workers
- O Asaas tem **SDK oficial só em Java**. Para Node existem pacotes não oficiais (`asaas`, `asaas-node`, `asaas-node-sdk` 0.1.0 gerado de OpenAPI), todos imaturos. Fonte: https://docs.asaas.com/docs/sdks
- Para Workers, **`fetch` direto com tipos próprios e Zod** é o caminho natural. A API é REST/JSON com header `access_token`, sem mTLS e sem dependência Node. Não há impedimento técnico conhecido.

---

### 2. Alternativas no Brasil

Exemplo numérico com **ticket de R$ 497,00** (premissa ilustrativa). Os valores são **listas públicas** e os prazos de liquidação diferem.

| Provedor | Pix | Boleto | Cartão à vista | Parcelado | Checkout hospedado | Webhook | NFS-e | Fonte / confiança |
|---|---|---|---|---|---|---|---|---|
| **Asaas** | R$ 1,99 (0,40%) | R$ 1,99 | 2,99%+0,49 = **R$ 15,35** (D+32) | 7–12x: R$ 20,32 | Sim (`/v3/checkouts`, Pix+cartão) | Token estático + IP. Doc detalhada de retry e pausa | **Sim** (R$ 0,49) | Oficial |
| **Mercado Pago** (Checkout Pro) | 0,99% = R$ 4,92 | R$ 3,49 | 4,98% D0 = R$ 24,75 · 4,49% D14 · 3,98% D30 = R$ 19,78 | Não confirmado (tipicamente com juros pagos pelo comprador) | Sim, maduro e com alta confiança do consumidor | HMAC-SHA256 (`x-signature`). Notificação "fina" (só id), exige consulta | Não | Preços **via busca** citando página oficial (a página oficial deu 403 ao WebFetch). Webhook: doc oficial |
| **Stripe Brasil** | 1,19% = R$ 5,91, **por convite** | R$ 3,45, **sem estorno** e sem disputa | 3,99%+R$ 0,39 = R$ 20,22 | **Não documentado para BR.** A página de installments lista só México, Japão e Mastercard Installments | Sim (Checkout) | HMAC + timestamp, retry por 3 dias, melhor doc do mercado | Não | Oficial (https://stripe.com/br/pricing, https://docs.stripe.com/payments/installments) |
| **Pagar.me** (Stone) | 0,99% = R$ 4,92 | não listado | 4,19% = R$ 20,82 ("dia seguinte*") | não listado | Link/checkout (sem detalhes) | não pesquisado | Não | Oficial parcial (https://pagar.me/precos/) |
| **Efí** (ex-Gerencianet) | 1,19% = R$ 5,91 (Pix Automático R$ 3,50) | R$ 3,45 | 3,49% = R$ 17,35 (até 31 dias) | 2–6x 3,99% / 7–12x 4,39% (recebe por parcela) | Link de pagamento grátis | **Não confirmado.** A API Pix da Efí historicamente exige **certificado mTLS**, o que em Workers pediria binding `mtls_certificates` | Não pesquisado | Oficial (https://sejaefi.com.br/tarifas) |
| **Iugu** | 0,99% | R$ 2,19 | 3,34% | 4,28% / 4,79% | Sim | — | — | **Terceiros** (blog). Mensalidade R$ 149 no plano Essencial. Não confirmado |
| **AbacatePay** | **R$ 0,80 fixo** | R$ 2,50 | **não publicado** | até 12x | Checkout e link | Sim (assinatura não documentada na página lida) | Não | Oficial parcial (https://www.abacatepay.com/, https://docs.abacatepay.com/). Só CNPJ. Split "em desenvolvimento" |
| **Pagou** | R$ 0,99 | R$ 2,49 | **"em breve"** (3,49%) | — | Link sem código | Sim | — | Oficial (https://pagou.com.br/). **Sem cartão hoje**: inviável como único PSP |

Leitura crítica:
- **Pix:** taxa fixa (Asaas R$ 1,99, AbacatePay R$ 0,80, Pagou R$ 0,99) ganha de percentual em tickets acima de ~R$ 200. Para curso de centenas de reais, o Asaas fica entre os mais baratos em Pix e **é o mais barato em cartão à vista e parcelado** entre os que publicam tabela, embora o recebimento do cartão seja em D+32.
- **Stripe:** perde no Brasil para venda B2C de curso. Não tem parcelamento documentado para BR, Pix é por convite, boleto não tem estorno, não emite NFS-e e a disputa custa R$ 55. A qualidade de engenharia é superior, mas não compensa essas lacunas de produto local.
- **Mercado Pago:** é a alternativa mais forte em confiança do comprador e conversão. Em compensação, o cartão é mais caro, não emite NFS-e e o modelo de notificação exige consulta a cada evento (o que, na verdade, combina com fetch-on-notify).
- **AbacatePay e Pagou:** são jovens e orientados a desenvolvedores. A Pagou não tem cartão. A AbacatePay não publica a taxa de cartão nem a política de estorno. Risco de maturidade alto para sistema financeiro com reconciliação.
- **Reputação de desenvolvedores** (Reclame Aqui, fóruns): **não pesquisada** por causa do fim da cota de busca.

**Recomendação: manter o Asaas** (ver "Implicações"), com ajustes de contrato. Mercado Pago fica como plano B documentado, sem implementar.

---

### 3. Boas práticas de integração (referências de engenharia)

1. **Fulfillment pelo webhook e pela página de retorno, sempre pela API.** A Stripe recomenda que webhook e landing page chamem a mesma função `fulfill_checkout(sessionId)`. Essa função deve ser idempotente e segura a chamadas concorrentes, reler a sessão na API, conferir `payment_status` e registrar o fulfillment. Citação curta: "Perform fulfillment only once per payment" (https://docs.stripe.com/checkout/fulfillment, lida em 2026-10-09). Tradução para o B4: o retorno do checkout **não concede acesso por si só**, mas pode **disparar a reconciliação síncrona** (`GET /v3/payments?checkoutSession=`). Se a API mostrar `RECEIVED` (Pix) ou `CONFIRMED` (cartão), o acesso é concedido pelo **mesmo** caso de uso idempotente do webhook. A UX melhora sem quebrar a regra.
2. **Ordem não garantida e duplicatas.** A Stripe diz que não garante ordem: deduplicar por event id e, se preciso, consultar a API para obter objetos ausentes (https://docs.stripe.com/webhooks). No Asaas, mesmo em `SEQUENTIALLY`, há duplicatas.
3. **Inbox durável:** autenticar, `INSERT ... ON CONFLICT (provider, event_id) DO NOTHING`, responder 200 e só então enfileirar. O processamento é **fetch-on-notify**: o evento é tratado como dica e o estado verdadeiro vem de `GET /v3/payments/{id}`. Isso elimina a dependência de ordem, porque a máquina de estados aplica a projeção do estado atual.
4. **Máquina de estados monotônica do Payment local**, com transições permitidas explícitas:
   - `pending → confirmed|received`;
   - `confirmed → received`;
   - `confirmed|received → refund_in_progress → refunded`;
   - `→ chargeback_requested → chargeback_dispute → (reversal → confirmed|received) | refunded`.
   - Transições "para trás" vindas de eventos atrasados são **ignoradas e registradas**. Transições impossíveis vão para `FinancialReview`.
5. **Reconciliador dirigido:** Orders com CheckoutSession `ACTIVE` e idade maior que N minutos, ou Payments em estado intermediário. Usar backoff e respeitar a cota de 25k/12h e a regra anti-polling do Asaas. Somar uma varredura diária **por janela de datas** (`dateCreated[ge]`, `paymentDate[ge]`) para pegar o que escapou.
6. **Monitorar a saúde do webhook:** a fila pausa depois de cerca de 15 falhas (~12 h de backoff acumulado) e os eventos somem após 14 dias. É preciso alerta próprio (por exemplo, "nenhum webhook recebido em X horas enquanto existem Orders pendentes"), além do e-mail do Asaas. A reativação pela API (`interrupted: false`) deve ser ação manual e auditada.
7. **Reembolso idempotente:** `RefundRequest` durável com estados `requested → submitting → submitted|unknown → done|failed|awaiting_external_authorization`. Em `unknown` (timeout), **reler o Payment** e nunca reenviar às cegas. A chamada ao provider fica fora da transação PG, com claim/lease e fencing (como já está no contrato 04).

---

## PARTE 2 — VÍDEO

### 4. Panda Video
- **Preços** (https://www.pandavideo.com/pricing; a página `/br/precos` deu 404 em 2026-10-09):
  - Bronze **$17.90**/mês: 200 GB de armazenamento e 500 GB de banda.
  - Silver **$37.90**: 512 GB e 1 TB.
  - Gold **$97.90**: 1 TB e 4 TB (inclui anti-download e legendas IA grátis).
  - Enterprise sob consulta.
  - Excedente: armazenamento $0,06/GB e banda **$0,03/GB**. A página inicial cita **$0,06/GB pós-pago** para banda, o que é uma **divergência**.
  - **Moeda:** a página mostra "$". Partes da página usam vírgula decimal ("$17,90"). O preço em BRL para conta brasileira **não foi confirmado**.
  - Trial de 14 dias com banda limitada a 100 GB.
- **API:**
  - Upload direto, em duas etapas, por URL externa, por m3u8 e via **TUS**.
  - Webhooks (criar e consultar).
  - Analytics e retenção por vídeo.
  - Fonte: índice https://docs.pandavideo.com/llms.txt
- **Eventos do player** (https://docs.pandavideo.com/reference/receive-events.md): entregues por `window.postMessage`, com `{message, currentTime, video}`.
  - Os 18 eventos: `panda_timeupdate`, `panda_progress` (buffer, **não** reprodução), `panda_ready`, `panda_play`, `panda_pause`, `panda_seeking`, `panda_seeked`, **`panda_ended`**, `panda_enterfullscreen`, `panda_exitfullscreen`, `panda_captionsenabled`, `panda_captionsdisabled`, `panda_languagechange`, `panda_canplay`, `panda_error`, `panda_speed_update`, `panda_smart_search`, `panda_ai_quiz`.
  - **Caveat oficial:** `panda_ended` **não dispara com autoplay ligado**. Isso é compatível com "sem autoplay" da vNext, mas exige garantir autoplay desligado na configuração do player e na URL.
  - O exemplo oficial **não valida `event.origin`**. O adapter precisa validar.
  - Há também a lib `api.v2.js` (`PandaPlayer`, `onEvent`).
- **Proteção:**
  - Domínios permitidos e bloqueados, por conta ou pasta. A própria doc reconhece que dá para contornar.
  - "DRM Watermark" Regular sem custo: marca d'água com os dados do espectador e criptografia no player.
  - **Advanced a $0,60/GB de banda.**
  - Anti-download só no Gold.
  - **HLS Encryption:** segmentos cifrados e chave entregue por URL assinada de curta duração (vale só para uploads novos).
  - JWT por grupo de watermark (segredo do grupo).
  - **Não há Widevine/FairPlay**. O "DRM" da Panda é watermark mais criptografia própria. Um concorrente (JMV) diz o mesmo, mas a fonte tem viés.
- **Legendas e IA:** legendas IA grátis no Gold, dublagem IA, quiz, mapa mental (marketing).

### 5. JMVStream (JMV Technology)
- **Existência:** confirmada. Empresa **brasileira**, CNPJ 05.487.918/0001-20, ASN 271437, datacenter próprio no Brasil "desde 2003".
- **Escala declarada pelo próprio fornecedor:** "10.000+ clientes", "13 PB/mês", logos de SBT, Band, TV Cultura. Foco histórico em streaming ao vivo, WebTV e OTT. Fonte: https://jmvstream.com/
- **Preços** (https://jmvstream.com/pt-br/hospedagem-de-videos, "atualizada em 30/04/2026"):

  | Plano | Preço | Armazenamento | API REST |
  |---|---|---|---|
  | Starter | R$ 49,90 (rotulado "anual"; valor mensal real **não confirmado**) | 250 GB | não listada |
  | Professional | R$ 119 | 1 TB | não listada |
  | Full | R$ 299 | 2 TB | **listada só no Full** |
  | Enterprise | sob consulta | sob medida | ilimitada |

  - "Banda 100% ilimitada... Sem taxa de excedente. Nunca." **Não há cláusula de uso razoável escrita**, o que é um risco contratual e não uma vantagem garantida.
  - AES-128, token por sessão, bloqueio de domínio, watermark dinâmico (planos não especificados). Widevine/FairPlay só no Full, segundo o blog da própria JMV. **Não confirmado** na página de preços.
- **API** (https://jmvstream.com/pt-br/developer):
  - JWT de 4 h obtido por `POST /v2/authenticate`.
  - Vídeos e galerias em v1. Status de job `COMPLETED|CONVERTING|ERROR|AWAIT_CONVERSION`.
  - Upload S3/MinIO multipart com URLs pré-assinadas (até 5 TB).
  - A doc **não documenta webhooks** nem eventos do player. As URLs assinadas aparecem só de passagem ("secret do plano").
- **Player postMessage** (página https://jmvstream.com/en/?p=14301, vista apenas via snippet de busca; o WebFetch devolveu a landing page):
  - Comandos IN: `jmvplayer-play`, `-pause`, `-jump`, `-skip`, `-stop`, mais `jmvplayer-sync` para receber estado.
  - **Os eventos OUT (`timeupdate` e `ended`) não foram confirmados.**
  - O texto sugere configuração com apoio da equipe ("você pode informar à equipe após quanto tempo...").
- **Maturidade:** empresa sólida em infraestrutura, mas **API de VOD pouco autosserviço** para LMS. Há link m3u8 direto, o que permite usar player próprio.

### 6. Cloudflare Stream, Mux, Bunny, Vimeo, YouTube e VdoCipher

**Cloudflare Stream** (https://developers.cloudflare.com/stream/pricing/, atualizada em 2026-09-08):
- **Preço:**
  - Armazenamento **$5 por 1.000 min/mês**, pré-pago em blocos de $5. Ao esgotar, uploads ficam bloqueados.
  - Entrega **$1 por 1.000 min**, com banda incluída.
  - Encoding grátis.
  - Pré-carregamento e buffer **são cobrados**. A entrega web é arredondada ao segmento de 4 s.
  - A página não diz se Stream está incluído no Workers Paid. **Tratar como assinatura à parte**.
- **Segurança** (https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/):
  - `requireSignedURLs` e **signing keys** com geração local do token (sem chamada de API por token).
  - `exp` de até 24 h, `accessRules` por IP ou país (até 5), `allowedOrigins`.
  - **Workers binding** com `generateToken()` (1 h).
  - **Sem DRM documentado.**
- **Player SDK** (https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/using-the-player-api/): eventos padrão de mídia, incluindo `timeupdate`, `ended`, `seeking`, `seeked`, `ratechange`, `play`, `pause` e `durationchange`. `currentTime` aparece documentado como **inteiro** (granularidade de segundos; suficiente para 90%).
- **Legendas:** geração por IA (PT incluído), upload WebVTT de até 10 MB por idioma. Custo das legendas IA **não informado** (https://developers.cloudflare.com/stream/edit-videos/adding-captions/).

**Mux** (https://www.mux.com/pricing):
- **Pay-as-you-go:**
  - **100.000 minutos de entrega grátis por mês** e crédito de uso de **$20/mês**.
  - 1080p basic: input grátis, armazenamento **$0,003/min/mês**, entrega **$0,001/min** depois dos 100k.
  - Plus: input $0,03125/min.
  - Planos: Launch ($20 por $100 de crédito) e Scale ($500 por $1.000).
  - Mux Player, Mux Data, **legendas automáticas on-demand**, signed URLs e restrição de domínio estão incluídos.
- **DRM** (https://www.mux.com/docs/guides/protect-videos-with-drm): Widevine, FairPlay e PlayReady. **$100/mês + $0,003 por licença**. Exige qualidade `plus`/`premium` e certificado FairPlay próprio.
- **Signed playback** (https://www.mux.com/docs/guides/secure-video-playback):
  - JWT **RS256** gerado localmente (claims `sub`, `aud`, `exp`, `kid`). Viável em Workers com WebCrypto.
  - Restrições por referrer e por user agent.
  - Atenção: o `exp` deve **exceder a duração do vídeo**.
- **Player** (https://www.mux.com/docs/guides/player-api-reference/html): eventos **idênticos ao HTMLMediaElement** (`timeupdate`, `ended`, `seeking`, `ratechange`...) e `currentTime` nativo.

**Bunny Stream** (https://bunny.net/pricing/stream/, https://bunny.net/pricing/cdn/, https://bunny.net/docs/stream-drm):
- **Preço:**
  - Encoding grátis. Armazenamento a partir de $0,01/GB por região de replicação. Mínimo de $1/mês.
  - Entrega pela CDN: rede Standard **América do Sul $0,045/GB** (EU/NA $0,01). Rede **Volume $0,005/GB** (10 PoPs; **não confirmado** se há PoP no Brasil).
- **MediaCage:**
  - Basic: clear-key por sessão, só browser, sem custo.
  - **Enterprise: Widevine + FairPlay, $99/mês + $0,005 por licença** (até 20k/mês). Widevine L3 limitado a 480p e sem proteção contra captura de tela.
- **Token no embed:** pares `token`/`expires`.
- **Eventos do player (player.js): não confirmados nesta sessão.** A página de doc foi movida e deu 404.

**Vimeo** (help center):
- Plano **Core**: 2 TB/mês de banda, domain-level embed privacy, "hide from Vimeo".
- **Studio**: $400/mês (anual, 10 assentos), **36 TB/ano**.
- O limite geral é de **2 TB/mês**. Se for excedido duas vezes em 12 meses (ou 10 TB uma vez), o Vimeo contata o cliente, dá 7 dias e pode suspender a conta.
- Preços de Core e Creator: **não confirmados** (a página de preços é renderizada em JS).
- Fontes: https://help.vimeo.com/hc/en-us/articles/12426275404305-Bandwidth-on-Vimeo · https://help.vimeo.com/hc/en-us/articles/49786876885137-About-the-Vimeo-Core-plan · https://help.vimeo.com/hc/en-us/articles/47197205924241-About-the-Vimeo-Studio-plan
- **Player.js** (https://raw.githubusercontent.com/vimeo/player.js/master/README.md):
  - `timeupdate` "geralmente a cada 250 ms".
  - `ended` (não dispara com loop), `seeking`, `seeked`, `playbackratechange`.
  - **`getPlayed()`** devolve os intervalos efetivamente reproduzidos.
- Os planos estão sendo renomeados e reorganizados ("rolling out gradually"), sinal de **instabilidade comercial**.

**YouTube** (https://developers.google.com/youtube/iframe_api_reference e https://developers.google.com/youtube/terms/developer-policies):
- **IFrame API:** **não tem evento timeupdate**. É preciso fazer polling de `getCurrentTime()`. `onStateChange` com `ENDED=0`, `onPlaybackRateChange`, `onAutoplayBlocked`. Player mínimo de 200×200.
- **Políticas, risco material:**
  - **III.F.3.a:** "must not charge users to watch content in an embedded YouTube player".
  - III.F.3.b: proibido condicionar o vídeo a ação diferente do play (login comum é permitido).
  - III.I.6: proibido modificar ou bloquear partes do player.
  - III.I.9: proibido player em background.
  - III.E.1: proibido cache ou offline.
- Para curso **pago** (e não só "proteção inferior"), isso é **conflito direto com os termos**. Vídeo unlisted também não tem controle de acesso: o link vaza.

**VdoCipher:** a página de preços não trouxe valores (planos anuais por crédito de banda, trial de 5 GB). **Preço não confirmado.** É referência de DRM Widevine/FairPlay com watermark dinâmico, mas não está na lista atual.

### 7. Confiabilidade da medição de progresso

**Fatos de plataforma:**
- `timeupdate` dispara entre ~4 Hz e 66 Hz conforme a carga, segundo o MDN (https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event). No Vimeo, "geralmente a cada 250 ms".
- **Abas em background (Chrome)** (https://developer.chrome.com/blog/timer-throttling-in-chrome-88):
  - Timers de páginas ocultas rodam **1×/s**.
  - Depois de **5 min oculta, silenciosa por 30 s e com cadeia ≥ 5**, rodam **1×/min**.
  - Página que tocou áudio nos últimos 30 s fica isenta.
  - Consequência: **o polling do YouTube e os heartbeats via `setInterval` ficam imprecisos em aba oculta ou vídeo mudo**. Eventos postMessage de player em iframe não são timers da página, mas os timers internos do iframe também sofrem throttling.
- **iOS Safari** (https://webkit.org/blog/6784/new-video-policies-for-ios/): sem `playsinline`, o iPhone **exige fullscreen nativo**. Vídeos com autoplay pausam quando saem da viewport. Com players de terceiros em iframe, a vNext não controla `playsinline`. **Testar** no iPhone se os eventos continuam chegando em fullscreen e se `ended` chega ao sair do fullscreen. Comportamento **não confirmado** por provider.
- **Seek e playbackRate:**
  - Panda emite `seeking`/`seeked`/`speed_update`.
  - Vimeo emite `seeked`/`playbackratechange` e oferece `getPlayed()`.
  - Stream e Mux têm os eventos nativos `seeking`/`seeked`/`ratechange`.
  - YouTube tem só `onPlaybackRateChange`. Seek precisa ser inferido por salto de `getCurrentTime()`.

**Diferenças de `ended`:**

| Provider | `ended` | Ressalva |
|---|---|---|
| Stream, Mux | Nativo | — |
| Panda | `panda_ended` | **Não dispara com autoplay** |
| Vimeo | `ended` | Não dispara com loop |
| YouTube | Estado `0` | — |
| JMV | **Não confirmado** | — |
| Bunny | **Não confirmado** | — |

**Como LMSs medem:** há dois modelos:
- **(a) % máximo atingido** (posição). É simples, mas burlável por seek.
- **(b) cobertura de intervalos assistidos** (union de segmentos, heartbeat). É o modelo do xAPI Video Profile, com as extensões `played-segments`, `progress` e `completion-threshold` no namespace https://w3id.org/xapi/video. O conteúdo do perfil **não foi relido nesta sessão** (redirect).
- **A decisão vigente (B2 e `03-modelo...`) escolhe explicitamente o modelo (a):** "buscar ao limiar pode concluir; não implementar fronteira linear/anti-seek". Portanto **não** recomendo trocar para cobertura sem nova decisão. A cobertura pode ser coletada **só como métrica analítica**, se houver valor.

**Riscos de 6 providers vs. 1–2:**
- Seis semânticas de evento (postMessage com formatos diferentes, polling no YouTube, OUT events desconhecidos na JMV).
- Seis esquemas de token e assinatura.
- Quatro fluxos de upload gerenciado (TUS, S3 multipart, direct upload, URL).
- Seis formatos de webhook de processamento.
- Seis entradas de CSP `frame-src`/`connect-src` e validações de `origin`.
- Matriz de testes de 6 × (Chrome, Firefox, Safari macOS, iOS Safari, Android) × (play, seek, rate, background, fullscreen, ended).
- Seis contas e cobranças, com segredos AES-GCM e rotação por conexão.
- Dois providers com **risco contratual** (YouTube com ToS e Vimeo com limite de banda e suspensão) e um com **API imatura** (JMV).
- O custo de manutenção cresce de forma linear, mas o valor para um LMS single-tenant com poucos cursos é quase nulo além do 2º provider.

### 8. Estimativa de custo (30 h de catálogo; 500 alunos × 10 h/mês)

**Premissas:**
- Catálogo de 30 h = **1.800 min**. Consumo de **5.000 h/mês = 300.000 min/mês**.
- Bitrate médio entregue: **cenário A 2,5 Mbps ≈ 1,125 GB/h** (ABR 720p/1080p), ou seja, **5.625 GB/mês**. **Cenário B 4 Mbps ≈ 1,8 GB/h**, ou seja, **9.000 GB/mês**.
- Armazenamento por GB de ~60–90 GB (renditions).
- Sem DRM, salvo indicação. Preços em USD de lista, sem impostos (IOF e câmbio à parte).

| Provider | Cálculo | **Cenário A** | Cenário B | Observações |
|---|---|---|---|---|
| **Cloudflare Stream** | Armaz. 2 × $5 = $10. Entrega 300 × $1 = $300. Buffer +0–10% | **≈ $310–340** | ≈ $310–340 | Por minuto, independe do bitrate |
| **Mux** (basic 1080p) | Armaz. 1.800 × $0,003 = $5,40. Entrega (300k − 100k) × $0,001 = $200. Crédito −$20 | **≈ $185** | ≈ $185 | DRM somaria +$100/mês + $0,003/licença + input plus de $56 (uma vez) |
| **Bunny Stream** Standard | 5.625 GB × $0,045 (AS) + ~$1 armaz. | **≈ $254** | ≈ $406 | — |
| **Bunny Stream** Volume | 5.625 GB × $0,005 + ~$1 | **≈ $29** | ≈ $46 | PoP no Brasil não confirmado (latência). MediaCage Enterprise +$99 + ~$0,005/licença |
| **Panda Video** (Gold) | $97,90 + (5.625 − 4.000) GB × $0,03 | **≈ $147** | ≈ $248 | Com excedente a $0,06: $195 / $398. Moeda BRL não confirmada. **Watermark Advanced: +$3.375/mês** (5.625 × $0,60) |
| **JMVStream** (Full) | R$ 299 fixo, banda "ilimitada" | **R$ 299** | R$ 299 | Sem fair use escrito. Preço mensal vs anual não confirmado |
| **Vimeo** | 5,6–9 TB/mês > 2 TB/mês (Core). Studio = 36 TB/ano ≈ 3 TB/mês | **Custom/Enterprise sob consulta** | idem | Self-serve inviável nesse volume |
| **YouTube** | $0 | $0 | $0 | **Proibido cobrar para assistir no player embutido** (III.F.3.a) |
| **VdoCipher** | — | não confirmado | — | — |

**Custo marginal por 1.000 h entregues (cenário A):**

| Provider | Custo por 1.000 h |
|---|---|
| Stream | $60 |
| Mux | $60 (depois de ~1.667 h/mês grátis) |
| Bunny Standard (AS) | $50,6 |
| Bunny Volume | $5,6 |
| Panda (excedente a $0,03) | $33,8 |
| JMV | $0 declarado |

**Cenário realista menor (1.000 h/mês):**
- Stream ≈ $70.
- **Mux ≈ $0–5** (fica dentro dos 100k min grátis).
- Panda ≈ $37–42.
- Bunny Standard ≈ $52.

O consumo de 10 h/aluno/mês é alto para curso gravado. Vale **medir o legado** antes de decidir.

---

## Implicações para decisões

### A. Pagamentos (B4): **manter Asaas**, com sete ajustes de contrato

1. **Manter o Asaas Checkout (`/v3/checkouts`)** para Pix e cartão, à vista e parcelado (até 21x). Ele já é hospedado, tem `externalReference`, expiração e callbacks, e a ligação **Payment ↔ `checkoutSession`** existe e é filtrável. As taxas são as mais baixas em cartão entre os PSPs com tabela pública, e o Asaas tem NFS-e integrada (R$ 0,49).
2. **Boleto:** não prometer no Checkout. A referência OpenAPI só aceita `PIX`/`CREDIT_CARD`. Se boleto for requisito, usar `/v3/payments` (`BOLETO` ou `UNDEFINED`) com `invoiceUrl` (fatura hospedada). Isso exige customer com CPF antes. **Pedir decisão de produto** sobre boleto.
3. **Gatilho de acesso:** concedido apenas por **Payment** em `RECEIVED` (Pix) ou `CONFIRMED` (cartão), sempre por **reconsulta à API** (fetch-on-notify). `CHECKOUT_PAID` e o retorno do checkout só **disparam reconciliação**. O retorno do checkout pode chamar a mesma função idempotente, como recomenda a Stripe, para liberar o acesso na hora sem violar a regra.
4. **Webhook:** responder **HTTP 200 explícito** (nunca 201 ou 204). Persistir no inbox com UNIQUE `(provider, event_id)` em até 10 s. Usar `NON_SEQUENTIALLY`, porque a lógica não deve depender de ordem e isso evita head-of-line blocking. Validar `asaas-access-token` em tempo constante, com allowlist de IP como camada extra. Alertar sobre ausência de webhooks e fila pausada (retenção de 14 dias).
5. **Reconciliador dirigido e respeitoso à cota** (25k/12h; polling detectado bloqueia o aumento de cota). Consultar `GET /v3/payments?checkoutSession=` e `?externalReference=`, mais uma varredura diária por janela de datas.
6. **RefundRequest:**
   - Sem idempotency key no provider: estado `unknown` exige releitura de `refunds[]`.
   - Modelar `AWAITING_CRITICAL_ACTION_AUTHORIZATION` como espera por aprovação humana no painel.
   - Tratar 400 por saldo insuficiente (Pix recém-recebido) como recuperável.
   - Chargeback (`PAYMENT_CHARGEBACK_REQUESTED`) deve suspender ou revogar o Entitlement conforme a política (**decisão pendente**).
7. **Desligar as notificações de cobrança do Asaas** (o Hub usa Resend) e **validar em sandbox** os pontos não confirmados:
   - payload de `CHECKOUT_PAID`;
   - CPF exigido na página;
   - juros do parcelamento;
   - existência de `GET /v3/checkouts?externalReference=`;
   - prazo de estorno Pix.

**Plano B documentado (não implementar):** Mercado Pago Checkout Pro (HMAC, notificação fina, Pix 0,99%). Manter um port `PaymentProvider` estreito, sem abstração multi-PSP antecipada. **Descartar Stripe** (sem parcelamento BR documentado, Pix por convite, boleto sem estorno) e **Pagou** (sem cartão).

### B. Vídeo (B2): **reduzir de 6 para 2 adapters na v1** (1 primário gerenciado + 1 legado), com YouTube e Vimeo fora de aula paga

- **Primário (escolher por spike de 1–2 dias com dados reais de consumo do legado):**
  - **Mux:** menor custo no volume provável (100k min/mês grátis), player com eventos idênticos ao HTMLMediaElement, signed JWT RS256 local, legendas automáticas grátis e DRM real opcional.
  - **ou Cloudflare Stream:** alinhamento de plataforma (Workers binding, signing keys, `allowedOrigins`, mesma conta e fatura), mas custo por minuto maior no volume alto e sem DRM.
  - Minha recomendação técnica é **Mux**, se custo e qualidade do player pesarem mais, e **Stream**, se consolidação operacional e de fornecedor pesar mais. As duas superam as outras opções no contrato de progresso.
- **Legado (somente se o inventário mostrar conteúdo que não compensa migrar):** **Panda** (eventos ricos e documentados: `panda_ended`, `seeked`, `speed_update`, webhooks, TUS) ou **JMV** (barato e "ilimitado", mas **OUT events e webhooks não documentados**; exige prova de `ended` antes de aceitar). Se o conteúdo legado puder ser re-hospedado, **zero adapters de legado**.
- **YouTube:** **não usar em Lesson de Course pago.** A política III.F.3.a proíbe cobrar para assistir no player embutido. Isso **contradiz** o contrato 04 §6 ("aviso de proteção inferior, sem proibição indevida") e exige **decisão e, idealmente, validação jurídica**. Uso aceitável: trailer público ou página de vendas.
- **Vimeo:** descartar. O limite de 2 TB/mês com suspensão inviabiliza o self-serve no volume estimado, e os planos estão em reorganização.
- **Bunny:** fica como alternativa de custo (Volume $0,005/GB) caso o spike reprove Mux e Stream. Os eventos do player não foram confirmados.
- **Arquitetura:** manter `VideoAsset.provider` + `VideoProviderConnection` + capabilities (já decididos), de modo que adicionar provider depois seja barato, sem implementar seis agora. Avaliar no spike **um player próprio único** (HLS via hls.js ou Media Chrome) para providers que entregam m3u8 assinado (Stream, Mux, JMV). Isso uniformiza os eventos.

### C. Contrato de progresso (fiel ao B2 aprovado)

1. **Adapter → eventos normalizados:** `ready`, `play`, `pause`, `timeupdate(t)`, `seeking`, `seeked(t)`, `ratechange(r)`, `ended`, `error`, `durationchange(d)`. Cada adapter declara as capabilities `reportsTime`, `reportsEnded`, `reportsSeek`, `resume` e `duration`. Sem `reportsEnded` confiável, **não há autoavanço**: o botão "Próxima aula" fica manual.
2. **Validação de origem:** todo listener `message` valida `event.origin` contra o origin do provider **e** `event.source` contra o `contentWindow` do iframe. Panda e JMV não fazem isso nos exemplos oficiais.
3. **Conclusão (regra B2):** `maxPosition / duration ≥ threshold` (default 0,90). **Seek até o limiar conclui.** Sem anti-seek e sem fronteira linear. A `duration` vem do **servidor** (metadado do provider gravado no VideoAsset ao processar), nunca do cliente.
4. **Envio:**
   - Heartbeat a cada 15–30 s durante a reprodução, mais flush em `pause`, `seeked`, `ended`, `visibilitychange:hidden` e `pagehide` via `fetch(..., {keepalive:true})` ou `sendBeacon`.
   - Payload `{lessonId, videoAssetId, playbackSessionId, seq, position, clientTs}`.
   - O servidor revalida acesso (Entitlement, drip, sequência), faz clamp em `[0, duration]`, ignora `seq` antigo e grava `max(position)` de forma monotônica.
   - A conclusão é **idempotente** (`LessonCompletion` com evidência: provider, asset, posição, duração, timestamps do servidor).
5. **Autoavanço:** só com `ended` do adapter que declara `reportsEnded`. Opt-in default OFF, contagem cancelável, e sempre sujeito a nova verificação de drip e sequência no servidor. `ended` **não** é requisito de conclusão (a conclusão já ocorre no limiar).
6. **Testes obrigatórios por adapter** (amplia o "89/90%" de M5-02):
   - 89% vs 90%;
   - seek direto ao limiar;
   - playbackRate 2×;
   - aba oculta por mais de 5 min com vídeo mudo (throttling);
   - iOS Safari em fullscreen nativo e saída;
   - `ended` com autoplay e loop desligados;
   - perda de rede com flush via keepalive;
   - troca de usuário no mesmo browser.
7. **Opcional (requer decisão; não altera B2):** coletar intervalos assistidos (`getPlayed()` no Vimeo, `played` TimeRanges nos players nativos) só para analytics de engajamento, sem efeito na conclusão.

---

### Itens não confirmados (para validação em sandbox ou com fornecedor)
- Asaas:
  - boleto no Checkout;
  - payload de `CHECKOUT_PAID`;
  - CPF obrigatório na página do Checkout;
  - juros do parcelamento;
  - `GET /v3/checkouts` com filtros;
  - prazo de estorno Pix;
  - municípios e requisitos de NFS-e;
  - reputação.
- Panda: moeda BRL e excedente ($0,03 vs $0,06).
- JMV: OUT events, webhooks, mensal vs anual, Widevine.
- Bunny: eventos do player e PoP Brasil na rede Volume.
- Vimeo: preços de Core e Creator.
- VdoCipher: preços.
- Mercado Pago: tabela oficial (403) e parcelamento.
- AbacatePay: taxa de cartão e estorno.
- Efí: exigência de mTLS (conhecimento prévio, não relido).
- Iugu: preços só de terceiros.
