# M9-04 — matriz de provas de segurança (ameaça × fluxo × teste × resultado)

> **Estado:** matriz preenchida e **conferida por um teste** (`test/unit/hardening-matrix.test.ts`): toda referência (arquivo, dois-pontos duplos e trecho do título) abaixo precisa existir, então a matriz não apodrece quando um teste é renomeado ou apagado. **Aceite da tarefa** ("nenhuma linha vermelha em auth, financeiro ou privacidade"): o mesmo teste falha se uma linha dessas áreas virar `lacuna`. As linhas `ambiente` dependem de um ambiente real (domínio próprio, iPhone, painel da Cloudflare) e estão na seção "O que NÃO foi provado".

Legenda do resultado: **provado** (teste automatizado que falha se o controle sumir) · **parcial** (provado em parte; o que falta está dito) · **ambiente** (só se prova num ambiente real) · **lacuna** (sem prova).

## 1. XSS

| ID | Área | Ameaça | Fluxo | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| X1 | conteúdo | HTML ou script em texto rico (Tiptap) | aula, curso, FAQ | `test/pg/rich-text.pg.test.ts :: HTML como TEXTO não é alterado nem executado`; `src/features/content/rich-text.test.ts :: aceita todos os nós e marcas da allowlist`; `e2e/texto-rico.spec.ts :: corpus de XSS em JSON` | provado |
| X2 | conteúdo | HTML ou Markdown em discussões | discussão da aula | `src/features/discussion/discussion.test.ts :: HTML e Markdown ficam como TEXTO`; `test/pg/discussion.pg.test.ts :: HTML e Markdown ficam como texto; controle e bidi são removidos` | provado |
| X3 | conteúdo | XSS em título, resumo, ementa, nome e e-mail exibidos | catálogo, curso público, estudo, inscritos, prévia | `e2e/catalogo.spec.ts :: XSS em título e resumo aparece como texto e não executa`; `e2e/curso-publico.spec.ts :: XSS em título, descrição e ementa aparece como texto e não executa`; `e2e/estudo.spec.ts :: XSS em títulos aparece como texto e não executa`; `e2e/inscritos.spec.ts :: XSS em nome e e-mail aparece como texto`; `e2e/previa.spec.ts :: XSS no título e no texto aparece como texto` | provado |
| X4 | conteúdo | XSS na pergunta da Ajuda | FAQ e pedido de suporte | `test/pg/help.pg.test.ts :: XSS no texto da pergunta fica como TEXTO` | provado |
| X5 | privacidade | HTML do certificado (nome do titular, curso, assinatura) | emissão do PDF e validação pública | `src/features/certificate/render.test.ts :: só há UM script-like possível`; `src/features/certificate/render.test.ts :: o alt da assinatura leva o nome escapado`; `src/features/certificate/render.test.ts :: assinatura ou fonte que não sejam data URI do tipo certo`; `src/features/certificate/public.test.ts :: título do curso hostil é ESCAPADO nas tags` | provado |
| X6 | conteúdo | Meta tags do HTMLRewriter com título hostil | `/cursos/:slug` | `test/workers/course-page.test.ts :: título e descrição com aspas e < saem escapados`; `src/features/catalog/course-meta.test.ts :: título com aspas e < sai escapado em todas as tags` | provado |
| X7 | conteúdo | Link do banner com `javascript:`, `data:` ou host estranho | banners do painel | `src/features/banner/banner.test.ts :: recusa javascript:` | provado |
| X8 | plataforma | Script injetado apesar do escape (defesa em profundidade) | todas as páginas | `e2e/security.spec.ts :: CSP restrita, HSTS, nosniff, sem moldura`; `e2e/security.spec.ts :: nenhuma violação de CSP` | provado |

## 2. CSRF

| ID | Área | Ameaça | Fluxo | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| C1 | auth | POST de outro site com o cookie da sessão | toda rota com efeito | `src/server/security/security.test.ts :: Origin: null, origem parecida e origem com outra porta ou esquema são recusadas`; `src/server/security/security.test.ts :: com Origin errado, Sec-Fetch-Site: same-origin NÃO compensa`; `test/pg/auth.pg.test.ts :: POST com cookie de sessão mas sem cabeçalho Origin é recusado (CSRF)` | provado |
| C2 | auth | Cliente que não é navegador, `text/plain` ou origem estranha | API inteira | `src/server/security/security.test.ts :: sem Origin e sem Sec-Fetch-Site (cliente que não é navegador) é recusado`; `e2e/security.spec.ts :: POST sem Origin, com text/plain ou de origem estranha é recusado antes de qualquer rota` | provado |
| C3 | auth | Link de acesso consumido por prefetch, robô ou clique acidental | tela de confirmação do link | `e2e/login.spec.ts :: abrir a página não consome o link: o POST só acontece no clique`; `test/pg/link.pg.test.ts :: os endpoints nativos do plugin não são expostos` | provado |
| C4 | auth | Retorno do Google forjado (CSRF do OAuth) | entrar com Google | `test/pg/methods.pg.test.ts :: o retorno sem os cookies do início (CSRF do OAuth) ou com erro do Google é o mesmo redirecionamento genérico` | provado |
| C5 | financeiro | Webhook fora do CSRF mas autenticado (token ou assinatura) | Asaas e Resend | `test/pg/asaas-webhook.pg.test.ts :: autentica por token, não por cookie: passa sem Origin e sem CSRF`; `test/pg/asaas-webhook.pg.test.ts :: token ausente, errado, com prefixo ou de outro tamanho: 200 e NADA gravado`; `test/pg/resend-webhook.pg.test.ts :: assinatura inválida, ausente, de outro segredo ou expirada: 400 e NADA é gravado`; `test/workers/webhook.test.ts :: sem assinatura: 400 invalid_signature` | provado |

## 3. RBAC e acesso cruzado

| ID | Área | Ameaça | Fluxo | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| R1 | auth | Rota esquecida sem portão de sessão (deny-by-default) | **toda** rota registrada do Worker | `test/pg/deny-by-default.pg.test.ts :: toda rota que não é pública responde 401 sem sessão`; `test/pg/deny-by-default.pg.test.ts :: as listas de exceção não têm entrada velha`; `test/pg/deny-by-default.pg.test.ts :: uma sessão forjada (cookie inventado) também é 401` | provado |
| R2 | auth | Capacidade ausente ou trocada em rota da Staff | todo `/api/staff/*`, cada capacidade por chamada direta | `test/pg/staff-matrix.pg.test.ts :: toda rota /api/staff/* registrada está na matriz e nenhuma linha da matriz sobra`; `test/pg/staff-matrix.pg.test.ts :: o documento docs/spec/staff-matrix.md lista todas as linhas` | provado |
| R3 | auth | Aluno lê ou escreve em área de outra pessoa ou outro curso | discussão, direito, sessão, pedido, conclusão | `test/pg/discussion.pg.test.ts :: o aluno de OUTRO curso não lê nem escreve na conversa desta aula`; `test/pg/entitlement.pg.test.ts :: o direito é por (pessoa, curso): acesso a um curso não vale para o outro nem para outra pessoa`; `test/pg/auth.pg.test.ts :: o cookie de uma pessoa nunca devolve os dados de outra`; `test/pg/checkout.pg.test.ts :: pedido de OUTRA pessoa com o mesmo attemptId é um pedido dela`; `test/pg/completion.pg.test.ts :: pessoa NÃO inscrita: 403 no_access e nada gravado` | provado |
| R4 | auth | Suporte sem o grant chama a URL direta | reembolso, certificado, finanças | `test/pg/refund.pg.test.ts :: sem sessão 401; aluno e Suporte sem grant 403; com o grant mas SEM reautenticação 403 reauth_required`; `test/pg/finance-view.pg.test.ts :: só com finance.view: sem sessão 401, aluno 403, Suporte sem grant 403` | provado |
| R5 | auth | Perder o último Admin | suspensão e revogação de papel | `test/pg/suspension.pg.test.ts :: não suspende o último Admin ativo (nem a si mesmo)` | provado |
| R6 | auth | Conta suspensa continua usando o sistema | sessão, compra, estudo | `test/pg/checkout.pg.test.ts :: conta suspensa 403, e-mail não verificado 403, e o provider não é chamado nem o pedido criado`; `test/pg/completion.pg.test.ts :: acesso expirado ou conta suspensa: 403 e nada gravado` | provado |

## 4. SSRF e chamadas de saída

| ID | Área | Ameaça | Fluxo | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| S1 | plataforma | Destino de chamada de saída montado com dado da requisição | **todo** `fetch` do Worker | `test/unit/outbound-network.test.ts :: só os arquivos da lista fazem chamada de rede`; `test/unit/outbound-network.test.ts :: os clientes dos provedores nunca importam o Hono`; `test/unit/outbound-network.test.ts :: nenhum destino é um endereço interno` | provado |
| S2 | privacidade | O navegador do PDF busca rede ou executa script | Browser Run (certificado) | `test/pg/certificate-renderer.pg.test.ts :: o bloqueio de rede`; `src/features/certificate/render.test.ts :: a CSP proíbe rede e script` | provado |
| S3 | financeiro | URL de checkout controlada por terceiro | Checkout do Asaas | `test/pg/checkout.pg.test.ts :: endereço fora da allowlist (host parecido, http, subdomínio)`; `src/features/commerce/checkout.test.ts :: recusa http, host parecido, subdomínio, credencial, porta, javascript:, data:`; `src/features/commerce/checkout.test.ts :: Production só aceita o domínio real` | provado |
| S4 | conteúdo | URL de vídeo ou embed de outro site | adapters de vídeo | `src/features/video/provider-adapter-contract.test.ts :: aceita entrada hostil`; `src/web/video/adapter-contract.test.ts :: embed fora da allowlist ou com origem diferente da do src`; `src/web/video/progress-reporter.test.ts :: o iframe só aceita https de host da allowlist` | parcial |
| S5 | plataforma | DSN do Sentry apontando para outro lugar | alertas ativos | `src/server/ops/sentry-alert.test.ts :: DSN inválido, sem https ou sem projeto numérico não faz requisição` | provado |

## 5. Upload e mídia

| ID | Área | Ameaça | Fluxo | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| U1 | conteúdo | MIME forjado, GIF ou HTML como `image/webp`, SVG | upload de capa, banner e assinatura | `test/pg/media.pg.test.ts :: Content-Type certo com bytes errados, script com cara de imagem e SVG: 422, asset rejeitado e objeto apagado`; `src/features/media/media.test.ts :: reconhece o tipo REAL pelos primeiros bytes`; `src/features/media/media.test.ts :: Content-Type certo com bytes errados, e o contrário, são recusados` | provado |
| U2 | conteúdo | Imagem gigante, minúscula ou de tamanho mentido | upload | `test/pg/media.pg.test.ts :: imagem gigante em pixels, minúscula, de proporção errada ou com tamanho diferente do declarado: recusada` | provado |
| U3 | conteúdo | Path traversal ou chave previsível | chave do objeto no R2 | `test/pg/media.pg.test.ts :: grava o asset pendente com chave OPACA` | provado |
| U4 | conteúdo | PUT pré-assinado de outro tipo ou sem confirmar | intenção e confirmação | `src/features/media/media.test.ts :: o PUT assina o Content-Type (mudar o tipo muda a assinatura) e a validade`; `test/pg/media.pg.test.ts :: PUT sem confirmar não publica nada; confirmar antes do PUT é 409 e continua pendente` | provado |
| U5 | conteúdo | **PUT pré-assinado reaproveitado DEPOIS da confirmação** (o objeto é trocado e publicado ou embutido no PDF) | publicar capa e banner; assinatura e fundo do certificado | `test/pg/media.pg.test.ts :: o objeto trocado no R2 NÃO é publicado`; `test/pg/media.pg.test.ts :: o objeto íntegro continua publicando`; `test/pg/certificate-renderer.pg.test.ts :: assinatura TROCADA no R2 depois da confirmação` | provado (**achado corrigido**, ver seção 9) |
| U6 | privacidade | Mídia privada servida a quem não pode | entrega autorizada | `test/pg/media.pg.test.ts :: o aluno que pode abrir a aula baixa o PDF com cabeçalhos privados` | provado |

## 6. Financeiro

| ID | Área | Ameaça | Fluxo | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| F1 | financeiro | Preço, e-mail ou callback vindos do cliente | abrir o checkout | `test/pg/checkout.pg.test.ts :: corpo com preço, e-mail ou callback 400`; `test/pg/checkout.pg.test.ts :: pessoa verificada: pedido com o preço do SNAPSHOT` | provado |
| F2 | financeiro | Preço da oferta muda depois da compra | evidência do pagamento | `test/pg/payment-evidence.pg.test.ts :: o preço da Offer mudar DEPOIS da compra não afeta` | provado |
| F3 | financeiro | `CHECKOUT_PAID` sozinho libera acesso | webhook do Asaas | `test/pg/payment-evidence.pg.test.ts :: CHECKOUT_PAID sozinho (sem pagamento no corpo) nunca libera` | provado |
| F4 | financeiro | Webhook repetido, simultâneo ou fora de ordem | inbox e evidência | `test/pg/asaas-webhook.pg.test.ts :: o mesmo event id duas vezes: 200 nas duas e UMA linha`; `test/pg/asaas-webhook.pg.test.ts :: entregas simultâneas do mesmo evento`; `test/pg/payment-evidence.pg.test.ts :: evento atrasado (PENDING depois de RECEIVED): regressão ignorada e registrada` | provado |
| F5 | financeiro | Valor divergente do pedido | evidência e revisão | `test/pg/payment-evidence.pg.test.ts :: valor diferente (um centavo): revisão amount_mismatch`; `test/pg/reconciliation.pg.test.ts :: APROVAR valor divergente: exige motivo` | provado |
| F6 | financeiro | Reembolso reenviado às cegas após resultado incerto | executor do reembolso | `test/pg/refund.pg.test.ts :: resultado AMBÍGUO depois de o Asaas aceitar: fica unknown, NUNCA reenvia`; `test/pg/restore-reconcile.pg.test.ts :: o executor de reembolso NÃO reenvia o que já existe no Asaas` | provado |
| F7 | financeiro | Duas compras do mesmo curso em corrida | concessão | `test/pg/payment-evidence.pg.test.ts :: duas compras do mesmo curso pagas em corrida` | provado |
| F8 | financeiro | Dois Suportes pedem o mesmo reembolso | `RefundRequest` | `test/pg/refund.pg.test.ts :: dois pedidos simultâneos de dois Suportes: exatamente UM é criado` | provado |

## 7. Prévia

| ID | Área | Ameaça | Fluxo | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| P1 | auth | A prévia da Staff grava progresso, direito ou auditoria | prévia de aluno | `test/pg/preview.pg.test.ts :: percorrer o curso inteiro na prévia não cria linha em entitlement, enrollment, lesson_completion nem course_completion`; `test/pg/preview.pg.test.ts :: a prévia é só leitura: POST, PUT, PATCH e DELETE nas rotas de prévia não existem (404)` | provado |
| P2 | auth | Aluno (inclusive matriculado) usa a prévia | prévia | `test/pg/preview.pg.test.ts :: aluno MATRICULADO também não usa a prévia (o papel de Staff é que vale)`; `test/pg/discussion.pg.test.ts :: a Staff na PRÉVIA não cria post` | provado |
| P3 | plataforma | **Version URLs e Preview URLs públicas** (versões antigas alcançáveis, com o mesmo banco) | Worker de Staging e de Production | `scripts/preflight.test.ts :: Version URLs e Preview URLs ligadas (ou sem a chave) são recusadas` | provado no build e **no Staging** (404 nas Version URLs depois do deploy); **achado corrigido**, ver seção 10 |

## 8. Incidentes adversariais exigidos (08 §4 do pacote anterior)

| ID | Área | Falha injetada | Resultado exigido | Prova | Resultado |
| --- | --- | --- | --- | --- | --- |
| A1 | financeiro | Duplo clique na matrícula gratuita | um direito, sem Asaas nem Order | `test/pg/free-enrollment.pg.test.ts :: 10 requisições simultâneas: exatamente UM direito (um 201 e nove 200)` | provado |
| A2 | privacidade | Duas conclusões simultâneas da última aula | uma conclusão e uma intenção de certificado | `test/pg/certificate.pg.test.ts :: duas conclusões SIMULTÂNEAS da última aula (conexões separadas): 1 conclusão, 1 certificado, 1 intenção` | provado |
| A3 | financeiro | Webhook repetido ou fora de ordem | sem duplicidade, estados monotônicos | ver F4 | provado |
| A4 | financeiro | Timeout após reembolso possivelmente aceito | sem reenvio cego | ver F6 | provado |
| A5 | plataforma | Publicação na Queue falha depois do commit | outbox pendente e o Cron republica | `test/pg/cron.pg.test.ts :: republica a intenção pending esquecida, sem tocar na linha, e registra a execução` | provado |
| A6 | financeiro | Consumidor perde o lease depois de o provedor aceitar | fencing impede o commit antigo | `test/pg/consumer.pg.test.ts :: lease perdido durante o handler: o resultado é descartado e a linha fica com quem assumiu`; `test/pg/fault-matrix.pg.test.ts :: F06 lease perdido: o worker lento não conclui, o que assumiu conclui, e o efeito não dobra` | provado |
| A7 | auth | Admin perde o último papel de Admin | operação rejeitada | ver R5 | provado |
| A8 | auth | Suporte chama a URL de reembolso direto | 403 sem efeito | ver R4 | provado |
| A9 | conteúdo | GIF ou HTML com MIME `image/webp` | não é aprovado para publicação | ver U1 e U5 | provado |
| A10 | conteúdo | Images Free devolve 9422 | a variante cai no master seguro | `e2e/curso-publico.spec.ts :: a variante falha (cota do Images): cai no master estático, sem erro visível`; `e2e/banners.spec.ts :: se a variante da imagem falhar, troca uma vez para o master e não quebra a tela` | provado |
| A11 | privacidade | Revogar certificado durante prévia ou download | novos acessos falham, snapshot intacto | `test/pg/certificate-lifecycle.pg.test.ts :: com reautenticação revoga: grava quem, quando, categoria e nota; novos downloads falham na hora; o PDF e o snapshot ficam` | provado |
| A12 | financeiro | Restaurar o banco de antes do reembolso | não reenviar; reconciliar no Asaas | `test/pg/restore-reconcile.pg.test.ts :: reembolso feito DEPOIS do backup: o pedido fecha em refunded e o acesso é revogado` | provado (dublê do Asaas) |
| A13 | privacidade | Restaurar o banco de antes de uma exclusão LGPD | reexecutar a exclusão | `test/pg/privacy-requests.pg.test.ts :: quem foi excluído e "voltou" na cópia restaurada é excluído de novo` | provado |
| A14 | privacidade | Revogações feitas depois do backup | voltam a valer revogadas | `test/pg/revocation-journal.pg.test.ts :: a cópia restaurada tem tudo ativo: a reaplicação revoga, suspende e respeita o último evento` | provado |
| A15 | auth | Sair da conta A e entrar como B, offline | nada de A aparece para B | `e2e/offline-purga.spec.ts :: A estuda; B entra (online): o que era de A é apagado antes de B ver qualquer dado local` | provado (Chromium; **WebKit e iPhone dependem do gate M8-04**) |
| A16 | auth | Quiz enviado offline | bloqueado até a conectividade | `test/pg/offline-sync.pg.test.ts :: comando FORA da allowlist (quiz, vídeo, qualquer outro) é recusado por item`; `e2e/offline.spec.ts :: quiz nunca é guardado (só online)` | provado |
| A17 | plataforma | PR malicioso altera o workflow do CI | sem acesso a segredos de Production | `.github/workflows/ci.yml :: permissions:`; `.github/workflows/ci.yml :: TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres` | parcial (ver seção 9) |

## 9. Passos 2 e 3 da tarefa

| ID | Área | Controle | Prova | Resultado |
| --- | --- | --- | --- | --- |
| G1 | plataforma | CSP e cabeçalhos de segurança na SPA e na API | `src/server/security/security.test.ts :: toda resposta da API leva os cabeçalhos, inclusive as recusadas e as 404`; `src/server/security/security.test.ts :: a CSP da API é a mais fechada e a API nunca é cacheável`; `e2e/security.spec.ts :: a API responde com CSP fechada, no-store e nosniff` | provado |
| G2 | plataforma | CORS: a API nunca se abre a outro site | `test/pg/cors.pg.test.ts :: uma página de outro site não recebe permissão para ler a API`; `test/pg/cors.pg.test.ts :: o pré-voo (OPTIONS) de outra origem não é atendido` | provado |
| G3 | auth | Cookie de sessão | `test/pg/auth.pg.test.ts :: o cookie sai com HttpOnly, Secure, SameSite=Lax, 7 dias e prefixo __Secure- em https` | provado |
| G4 | auth | Turnstile e limites no pedido de link | `test/pg/link.pg.test.ts :: recusa origem errada, Turnstile inválido e entrada inválida sem enviar nada`; `test/pg/link.pg.test.ts :: os endpoints nativos do plugin não são expostos` | provado |
| G5 | privacidade | Limites de frequência (discussão, Ajuda, validação pública) | `test/pg/discussion.pg.test.ts :: o limite de frequência (5 por 10 minutos) vale por pessoa e solta depois da janela`; `test/pg/help.pg.test.ts :: limite de 3 pedidos por 10 minutos por pessoa (429)`; `test/pg/certificate-public.pg.test.ts :: limite por IP: depois do máximo, 429; outro IP não é afetado` | provado |
| G6 | privacidade | Dado pessoal e segredo nos logs | `test/unit/no-pii-in-logs.test.ts :: nenhuma chamada escreve e-mail, token, senha, cookie ou segredo`; `e2e-journey/jornada.spec.ts :: latência das chamadas principais e logs com id de correlação, sem e-mail nem token` | provado |
| G7 | privacidade | Payload da outbox nunca leva dado pessoal | `test/pg/outbox.pg.test.ts :: rejeita payload com dado pessoal ou fora do contrato` | provado |
| G8 | plataforma | Segredos no histórico (Gitleaks) | `.github/workflows/ci.yml :: Gitleaks (histórico completo)` | provado no CI (não rodou localmente: sem o binário) |

## 10. Achados desta tarefa (corrigidos)

1. **PUT pré-assinado reaproveitado (U5).** O PUT do upload vale por 5 minutos e **não é de uso único**; a confirmação gravava o SHA-256, mas **nada o conferia depois**: o objeto podia ser trocado e então **copiado para o bucket público** (`publishPublicMedia`) ou **embutido no HTML do certificado**. Agora os dois conferem o SHA-256 gravado antes de usar: divergente = `MediaIntegrityError` (409 `media_integrity`) ao publicar e `signature_unavailable` ou `background_unavailable` ao renderizar. Risco real baixo (só Staff envia mídia), mas era uma falha de integridade.
2. **Version URLs públicas (P3).** Confirmei no Staging: `https://<8 primeiros caracteres da versão>-hub-staging.<conta>.workers.dev/api/health/live` respondia **200** (cada versão publicada fica alcançável, **inclusive as antigas, com o mesmo banco**). A configuração agora traz `preview_urls: false` em Staging e Production e **o preflight barra o build que as ligar**. **Verificado depois do deploy do Staging (`05b9841`, 2026-10-20): as Version URLs, a da versão atual e a antiga (`a7898350`), passaram a responder 404, e a URL principal segue em 200.** Production ainda não existe; a configuração dela já traz o mesmo ajuste.
3. **Sem prova de "negado por padrão" (R1)** e **sem prova de CORS (G2)**, **sem inventário de chamadas de saída (S1)** e **sem varredura de log (G6)**: viraram testes (`deny-by-default`, `cors`, `outbound-network`, `no-pii-in-logs`).

## 11. O que NÃO foi provado (honesto)

- **Bot Fight Mode desligado** até testar webhooks reais: é uma configuração da zona no painel da Cloudflare; só existe com o domínio próprio (M10-02). **Sem prova.**
- **CSP final com o PDF e o domínio real de Production**, **cookies com o prefixo `__Secure-` e HSTS em domínio próprio**: provados em teste e no Staging (`workers.dev`); a conferência final é do M10-01.
- **Linhas de PWA e offline em WebKit e iPhone**: dependem do aceite do gate M8-04 (pendente do responsável).
- **S4 (vídeo)**: o contrato dos adapters recusa entrada hostil, mas **nenhum adapter real existe** (M5-08 a M5-13 dependem de contas do cliente); a prova por adapter real fica para cada um.
- **A17 (CI)**: o `ci.yml` não usa nenhum segredo (banco local no próprio job) e só lê o repositório; **a ausência de proteção de branch no GitHub Free** significa que um workflow alterado numa branch roda com as permissões do arquivo dele. Nenhum segredo de Production existe no GitHub (AGENTS.md §3), mas o workflow de **backup do Staging** (ADR 0033) **terá** segredos de Staging: risco aceito e registrado.
- **Semgrep CE** não foi rodado (a tarefa o trata como apoio, nunca como controle único; o binário não está instalado e instalar é um download).
- **Pen test externo**: fora do escopo da tarefa.
- **Varredura de PII nos LOGS REAIS do Staging** (Workers Logs) **não foi feita**: o teste é estático (o que o código pode escrever) e o `e2e-journey` confere o log de uma jornada.
