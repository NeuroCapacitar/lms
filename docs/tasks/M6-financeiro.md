# M6 — Financeiro

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Marco.** Vende cursos pagos com **Asaas Hosted Checkout** (Pix e cartão em até 12x sem juros ao comprador, sem boleto, login obrigatório, nenhum dado de cartão no Hub), concede acesso **somente** por Payment confirmado relendo a API do Asaas, reconcilia o que ficou incerto com poucas consultas, trata divergências em `FinancialReview`, faz reembolso integral por `RefundRequest` durável e mostra à Staff os dados que o contador precisa (NFS-e fica fora da v1). **Gate de aceite:** em Staging com o sandbox Asaas e na suíte PG18 de corridas, nenhum caminho (evento falso, duplicado, fora de ordem, preço alterado, resultado incerto, reembolso concorrente) concede acesso sem evidência nem o duplica; todo caminho deixa prova recuperável (FinancialEvent/auditoria). Fontes: [registro do debate](../review/registro-do-debate.md) (Q27–Q30, Q33, Q38) e evidências W4 §1 e §3, L3 §5.

**Como ler.** Dependências em M0–M5 usam os IDs do backlog antigo (M2-01 Course/Offer, M3-01 Entitlement/Enrollment, M1-05 reautenticação recente, M4-01..M4-08 outbox/filas/Cron/e-mail); confira com `docs/tasks/`. Ordem sugerida: 01 → 02 → 03 → 07 → 04 → 05 → 08 → 06. Regras comuns: dinheiro sempre em **centavos inteiros** (BRL), conversão decimal só na borda com o Asaas; **nenhuma chamada ao Asaas dentro de transação PG**; correlação de pagamento **pela sessão de checkout** (o `externalReference` do Payment gerado pelo Checkout vem nulo no legado); sem HMAC inventado; a API Key do Asaas e o token do webhook ficam em segredos do Worker, nunca no banco nem em logs; sandbox e Production com credenciais separadas; CI comum nunca faz estorno real. Pendências de terceiros nesta área: conta Asaas do cliente e sandbox (PENDENTE cliente), regras de nota fiscal (PENDENTE contador), termos e política de reembolso (PENDENTE advogado).

**Removida/fundida:** nenhuma. A antiga M6-03 foi dividida: M6-03 fica com a entrada do webhook e a nova **M6-07** com a matriz de liberação e o Payment autoritativo (fetch-on-notify). Nova **M6-08**: visão financeira para a Staff/contador.

---

### M6-01 — Offer paga, Order, CheckoutSession e Payment com snapshot

**Dependências:** M2-01, M3-01, M4-01 · **Estado:** `implemented` (2026-10-14; evidência e limites em `docs/implementation/STATUS.md`)

**Objetivo:** modelar a compra com Order, CheckoutSession e Payment distintos; o Order guarda para sempre as condições comerciais do momento da compra.
**Passos:**
1. Regras de publicação da Offer **paga** (só Admin): preço em centavos ≥ 1000 (R$ 10,00), meses de acesso obrigatórios, parcelas ≤ 12 e ≤ `floor(preço/1000)` (mínimo de R$ 10 por parcela). Ao publicar Offer paga em curso que já tenha aula YouTube, exibir o aviso do M5-13.
2. Migrations: `orders` (usuária, Offer, status, **snapshot** imutável: curso, Offer, título, preço, moeda BRL, meses de acesso, parcelas máximas, métodos), `checkout_sessions` (Order, id e URL do Asaas, estado, expira em), `payments` (Order, sessão, id do Asaas, id de parcelamento quando houver, método, valores, status do provider, `paid_at`), `financial_events` (append-only). Snapshot sem PII além do `user_id`.
3. v1: um Order ↔ uma sessão ativa; sessão expira em 60 min; depois, nova compra gera **novo Order**. O modelo não impede N sessões.
4. Máquina de estados do Order com transições explícitas e testadas (ao menos: `pending`, `paid`, `expired`, `canceled`, `refund_requested`, `refunded`, `disputed`, `review`); transição inválida lança erro de domínio.
**Testes:** alterar a Offer depois do Order não muda o snapshot; preço enviado pelo cliente é ignorado/rejeitado; `UNIQUE` impede dois pagamentos com o mesmo id do provider; atualização/DELETE em `financial_events` é recusada; parcela mínima e limite 12x.
**Aceite:** o Order reproduz exatamente o que foi vendido, mesmo após mudar a Offer; eventos financeiros só se acrescentam.
**Fora do escopo / cuidados:** sem cupom, sem preço por método (preço único; a vendedora absorve as taxas); acesso gratuito não usa nada disto (Entitlement sem Order, M3).

### M6-02 — Hosted Checkout Asaas

**Dependências:** M6-01, M1-01 · **Estado:** `not_started`

**Objetivo:** a pessoa autenticada e verificada é levada ao checkout hospedado com o preço correto, sem que o Hub toque em dados de cartão.
**Passos:**
1. `POST` de criação com DTO Zod `{offerId, attemptId (UUID do cliente)}` e **nada mais** (preço, e-mail, callbacks rejeitados). Bloqueios antes de qualquer cobrança: sem sessão (401), e-mail não verificado, conta suspensa, Offer fechada/não paga, direito efetivo já existente ao curso; tentativa repetida com o mesmo `attemptId` reaproveita a sessão ativa.
2. Gravar Order + sessão (`creating`) e **confirmar a transação antes** de chamar o Asaas; depois `POST /v3/checkouts` com métodos Pix e cartão, parcelamento até o limite do snapshot, expiração de 60 min, `successUrl/cancelUrl/expiredUrl` do Hub (páginas autenticadas) e `externalReference` = id do Order. Item: nome ≤ 30 e descrição ≤ 150 caracteres (truncar com teste de Unicode), valor decimal exato a partir dos centavos, imagem exigida pelo Asaas (arte da marca). Conferir o corpo exato na referência e no sandbox (spike 5).
3. Validar a URL devolvida: HTTPS e host exatamente na allowlist por ambiente; só então persistir e responder.
4. Timeout/erro ambíguo: sessão `unknown` — **não recriar nem reutilizar** até expirar a janela de 60 min; se um pagamento aparecer sem correlação, vira `FinancialReview` (M6-04). Rejeição conhecida: `failed`.
5. Não enviar `customerData` sem `cpfCnpj` (no legado o sandbox rejeitou); o Asaas coleta nome/CPF/CNPJ. Testar no sandbox se `customerData` parcial é aceito e o que o Checkout exige.
6. Checklist da conta (registrar no STATUS): webhook com token ≥ 32 caracteres e `sendType` não sequencial; notificações de cobrança do Asaas **desligadas** (o Hub usa Resend; evita custo e mensagem duplicada); Bot Fight Mode da Cloudflare desligado até os webhooks serem testados.
**Testes:** sandbox real em Staging; timeout após aceite; dois cliques/abas simultâneos (um Order); preço malicioso; conta suspensa/sem e-mail verificado; host fora da allowlist; Offer fechada entre abrir a página e criar.
**Aceite:** a pessoa chega ao Checkout com o valor do snapshot em Pix e cartão até 12x; nenhuma ambiguidade gera segunda cobrança.
**Fora do escopo / cuidados:** sem guest checkout, sem checkout próprio, sem boleto (a referência do Checkout só lista Pix/cartão). Cartão **sem juros ao comprador** e a página pedindo CPF: PENDENTE (spike 5/sandbox). Cartão parcelado gera um parcelamento com várias cobranças: o comportamento dos eventos é PENDENTE (sandbox) e alimenta M6-07.

### M6-03 — Webhook Asaas: inbox antes do ACK

**Dependências:** M6-02, M4-02 · **Estado:** `not_started`

**Objetivo:** receber eventos do Asaas sem perder nenhum e sem agir sobre eles dentro da requisição.
**Passos:**
1. Rota `POST /api/webhooks/asaas` fora de CSRF/sessão (o Asaas não é navegador): limite de tamanho do corpo, header `asaas-access-token` comparado em tempo constante com o segredo do ambiente.
2. Token ausente/inválido: **não grava**, conta como métrica/alerta e responde 200 (decisão do registro: responder sempre 200, para não pausar a fila do Asaas nem revelar a validade do token).
3. Evento autenticado: `INSERT ... ON CONFLICT (provider, event_id) DO NOTHING` no inbox (M4-01) com payload sanitizado e retenção de 30 dias; **só depois** responder **HTTP 200 explícito** (nunca 201/204); então publicar na `hub-finance` (best-effort; o Cron recupera). Evento desconhecido também é gravado.
4. Única exceção ao 200: indisponibilidade do inbox (não foi possível gravar) → 500 para forçar reentrega do Asaas. PENDENTE (responsável): o registro diz "sempre 200"; se mantiver 200 mesmo assim, a recuperação depende só do reconciliador (M6-04).
5. Extrair apenas ids (evento, pagamento, sessão de checkout, parcelamento); a correlação é feita na M6-07 pela **sessão de checkout** lida da API.
6. Allowlist de IPs do Asaas como camada **opcional** extra (WAF ou `CF-Connecting-IP`); o token continua sendo a autenticação.
**Testes:** token ausente/falso (200, nada gravado); mesmo `event_id` duas vezes; corpo gigante; JSON inválido; resposta tem exatamente status 200; evento desconhecido; inbox indisponível; resposta em < 10 s com Hyperdrive.
**Aceite:** nenhum evento autenticado é perdido; nenhuma regra de negócio roda na requisição.
**Fora do escopo / cuidados:** o Asaas pode pausar a fila após ~15 falhas e guarda eventos por 14 dias: alerta de silêncio de webhook no M6-04 e runbook de reativação (manual, auditada) no M9. Não confiar em `externalReference`.

### M6-07 — Matriz de liberação e Payment autoritativo

**Dependências:** M6-03, M3-01, M4-04 · **Estado:** `not_started`

**Objetivo:** um único caso de uso idempotente, usado pelo webhook, pela página de retorno e pelo reconciliador, que lê o Payment **na API do Asaas** e decide o que fazer.
**Passos:**
1. `applyPaymentEvidence(paymentId)`: (a) fora da transação, `GET /v3/payments/{id}` (e o parcelamento, se houver); (b) em transação, trava o Order (`FOR UPDATE`), confirma que `checkoutSession` do Payment pertence ao Order, compara `value` bruto com o snapshot (**tolerância zero**), aplica a matriz, acrescenta `financial_event`.
2. Matriz: `CHECKOUT_PAID` só dispara a reconsulta, **nunca** libera; **Pix** libera em `PAYMENT_RECEIVED`; **cartão** libera em `PAYMENT_CONFIRMED`, exceto risco pendente/reprovado (aprovação posterior destrava); reembolso, disputa e chargeback **prevalecem e revogam** (política de chargeback do legado; PENDENTE confirmar com o responsável); `PAYMENT_PARTIALLY_REFUNDED`, valor divergente, referência conflitante, regressão de status ou evento desconhecido → `FinancialReview` sem efeito de acesso; cancelamento/expiração tardios não revogam Order já pago; status do provider só avança.
3. Liberar = chamar `grantEntitlement` (M3-01) na **mesma transação**, idempotente pelo id do Payment, com meses do snapshot; recompra após expirar continua o progresso e a âncora de drip (regra do M3). Depois, `purchase-confirmed` pelo outbox.
4. Página de retorno do checkout (autenticada, só dona do Order) chama o mesmo caso de uso uma vez e mostra "processando" se ainda não houver evidência; limite de chamadas por Order.
5. Duas compras do mesmo curso pagas em corrida: a segunda vai a `FinancialReview` (duplicidade) para reembolso.
**Testes (PG18 real + sandbox):** evento duplicado/fora de ordem; `CHECKOUT_PAID` sozinho não libera; Pix só em RECEIVED e cartão só em CONFIRMED; valor diferente; checkout de outro Order; webhook × retorno × reconciliador simultâneos (1 Entitlement); revisão pendente bloqueia concessão mas não a revogação; comportamento de cartão parcelado (PENDENTE sandbox).
**Aceite:** só evidência segura de Payment concede acesso; qualquer ambiguidade fica fail-closed e investigável.
**Fora do escopo / cuidados:** nunca liberar com informação incerta; não criar endpoint que conceda acesso por parâmetro do cliente.

### M6-04 — Reconciliação e FinancialReview

**Dependências:** M6-07, M4-03 · **Estado:** `not_started`

**Objetivo:** resolver o que o webhook não resolveu, gastando pouquíssimas consultas do Asaas.
**Passos:**
1. Job do Cron (M4-03) **só** sobre Orders com sessão ativa há mais de N minutos, sessões `unknown` e Payments em estado intermediário; consulta `GET /v3/payments?checkoutSession=` (ids exatos), com backoff por Order, teto de consultas por execução e respeito a 429/`RateLimit-*`. Quota do Asaas: 25.000 requisições por 12 h e polling constatado impede aumento — justificar no PR o teto escolhido. **Sem varredura cega diária.**
2. Marcar `expired`/`canceled` só depois de confirmar que a API não mostra pagamento da sessão.
3. `financial_reviews` com tipos (`amount_mismatch`, `terminal_conflict`, `event_anomaly`, `partial_refund`, `uncertain_result`, `unknown_checkout`, `duplicate_purchase`); grant "revisão financeira" para resolver, sempre com motivo e auditoria; só `amount_mismatch` admite aprovar (com valor observado gravado e nenhuma outra revisão pendente no Order); os demais exigem reconciliação/reembolso.
4. Alerta de saúde: "nenhum webhook recebido há X horas com Orders pendentes" (limite justificado no PR).
**Testes:** job obsoleto repetido; pagamento incerto; valor conflitante; 429 do Asaas interrompe o lote sem erro; teto de consultas respeitado com 500 pendentes; Suporte sem grant recebe 403 direto pela API; sessão `unknown` com pagamento órfão vira revisão.
**Aceite:** estado incerto converge sem duplicar direito nem registrar pagamento falso; acesso continua fail-closed em divergência.
**Fora do escopo / cuidados:** não apagar Orders pendentes para "limpar"; a UI de revisão é só a lista e as ações desta tarefa.

### M6-05 — Reembolso integral por RefundRequest

**Dependências:** M6-04, M1-05 · **Estado:** `not_started`

**Objetivo:** reembolsar integralmente, com política de 7 dias, sem estornar duas vezes e sem chamar o provider dentro de transação.
**Passos:**
1. A pessoa pede **por e-mail ao suporte**; a Staff cria o `RefundRequest` (grant "executar reembolso"; reautenticação recente por novo link; motivo obrigatório). Política: **até 7 dias** desde a compra (marco = confirmação do pagamento; PENDENTE advogado: termo inicial e contagem), qualquer Suporte com o grant; **depois dos 7 dias, só o Admin** (exceção). Sempre valor integral; nenhum campo de valor na API.
2. Estados: `requested → submitting → submitted | unknown → done | failed | awaiting_external_authorization`. Ao pedir, o acesso é **suspenso** (fail-closed); falha inequívoca restaura.
3. Executor na `hub-finance` com lease/fencing: antes de qualquer chamada, **reler** o Payment; `POST /v3/payments/{id}/refund` sem `value`. `unknown` (timeout): reler o Payment e `refunds[]`, **nunca** reenviar às cegas. Estorno de parcelamento: PENDENTE (sandbox: endpoint por parcelamento no legado).
4. `AWAITING_CRITICAL_ACTION_AUTHORIZATION` = espera por aprovação humana no painel do Asaas; erro 400 por saldo insuficiente (Pix recente) é recuperável (a Staff tenta de novo depois).
5. Confirmado (evento + releitura): Entitlement revogado com motivo `refund`, Order `refunded`, `refund-completed` pelo outbox; o **certificado já emitido permanece**, com registro do reembolso (nenhuma chamada de revogação ao M7).
**Testes:** duplo clique; pedido simultâneo de dois Suportes; disputa chegando junto; timeout após aceite; reembolso parcial feito por fora no painel (→ revisão); dia 7 e dia 8 (limites e fuso America/Sao_Paulo); Suporte tentando depois do prazo (403); falha de e-mail não desfaz.
**Aceite:** reembolso confirmado revoga o direito e preserva histórico; falha inequívoca restaura; nunca há segundo estorno.
**Fora do escopo / cuidados:** sem reembolso parcial nem endpoint de valor livre; **venda do legado**: histórico somente leitura, reembolso manual no painel do Asaas com revogação manual — o Hub não oferece botão para elas; sem estorno real no CI comum.

### M6-08 — Dados financeiros para a Staff e o contador

**Dependências:** M6-07, M5-01 (utilitário AES-GCM) · **Estado:** `not_started`

**Objetivo:** a Staff com permissão vê pedidos e pagamentos com o que o contador precisa; a nota fiscal é feita fora do Hub.
**Passos:**
1. Depois de confirmado o pagamento, ler `GET /v3/customers/{id}` e guardar **nome, CPF/CNPJ informado** (se o Asaas devolver), valor, data, forma de pagamento e parcelas; CPF/CNPJ cifrado em repouso (reaproveitar o utilitário do M5-01) e **mascarado por padrão**; revelar completo grava auditoria. Confirmar com o responsável a cifragem e a retenção (LGPD).
2. Telas (TanStack Table) de Pedidos/Pagamentos com filtros por período, curso e status, com os grants "ver pedidos/análise financeira" e "revisão financeira"; sem o grant, 403 direto pela API.
3. Exportação CSV do período **somente se o contador pedir** (PENDENTE contador: campos e periodicidade); mesma regra de máscara e auditoria.
4. Análise simples (Recharts só na Staff): recebido confirmado por período, reembolsos, pendentes; "recebido" não inclui potencial de checkouts abertos.
**Testes:** Suporte sem grant; CPF nunca em log/Sentry; revelação gera auditoria; pagamento sem CPF devolvido mostra "não informado"; valores em centavos sem erro de arredondamento.
**Aceite:** a Staff autorizada consegue montar a lista mensal para o contador sem acessar o painel do Asaas.
**Fora do escopo / cuidados:** **NFS-e fora da v1** (sem emissão, sem integração fiscal); regra de 01/11/2026 e forma da lista: PENDENTE (contador).

### M6-06 — End-to-end comercial e auditoria

**Dependências:** M6-02, M6-03, M6-07, M6-04, M6-05, M6-08 · **Estado:** `not_started`

**Objetivo:** provar a jornada de compra inteira e as adversariais, deixando trilha de auditoria completa.
**Passos:**
1. Servidor falso do Asaas para o CI (checkout, payments, eventos duplicados/fora de ordem/atrasados, 429, timeout) e Playwright: login por magic link → compra Pix → acesso liberado; compra cartão parcelada; expiração do acesso por requisição; recompra depois de expirar continuando o progresso.
2. Smoke manual em Staging com o **sandbox real** e dados sintéticos (nunca pessoas reais); registrar no STATUS comandos, data e resultado, e o que o sandbox não permitiu simular.
3. Reembolso dentro e fora dos 7 dias; chargeback simulado; revisão financeira resolvida; conferir que cada passo deixou `financial_events` + auditoria + log com `correlation_id`, sem segredo/PII.
4. Revisão de diff do módulo financeiro (permissões extras, segredos, chamadas ao provider em transação).
**Testes:** suíte de corridas PG18 (webhook × retorno × reconciliador × reembolso); Playwright de fumaça no CI bloqueante; smoke real só manual.
**Aceite:** todos os caminhos normais e adversariais passam; nenhum deixa acesso indevido; a trilha de auditoria reconstrói cada decisão.
**Fora do escopo / cuidados:** sem estorno destrutivo em CI comum; nenhuma credencial de Production fora do processo manual de release; Go-Live comercial real só no M10.
