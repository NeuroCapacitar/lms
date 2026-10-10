# M10 — Migração do legado e lançamento

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega.** A v1 integral entra em Production por release manual com preflight; o legado é migrado **uma única vez, só ao final** (ETL), depois congelado em manutenção; o webhook do Asaas e o DNS de `app.neurocapacitar.com.br` passam para a vNext; o legado é desligado; 7 dias de estabilização e handoff. Big-bang: **nenhuma Production da vNext recebe tráfego público antes da v1 integral** (M0–M9 prontos), e o legado fica congelado (só segurança, legal e bloqueio de venda) até lá. **Gate de aceite:** Go/No-Go assinado pelo responsável (M10-01) com evidência por SHA; ensaio geral do ETL com dump real cifrado em Staging verificado (M10-10); preflight de Production verde (M10-02); cutover executado sem divergência de contagens.

**Regra de ouro do cutover.** Só há volta ao legado **antes da primeira operação nova** na vNext (primeiro login real, compra ou qualquer escrita). Depois disso, voltar perderia dados: corrige-se para frente.

**Pendências de terceiros (não bloqueiam o código; podem bloquear o Go/No-Go):** PENDENTE (advogado do cliente) textos, retenções e transferência internacional (M9-09, M7-05); PENDENTE (cliente) provedores e contas de teste de vídeo, manual de marca/logo positivo, destino da cópia off-cloud, ciência do risco do YouTube em curso pago; PENDENTE (contador) NFS-e (fora da v1); PENDENTE (responsável) higiene do repositório legado público e retenção dos dados do legado depois de desligado; PENDENTE (responsável/cliente) iPhone para o gate de M8-04.

**Notas de IDs.** M10-01..M10-03 mantidos, mas o antigo M10-02 ("release manual e cutover DNS") foi dividido: M10-02 fica com release/preflight em hostname de verificação e o cutover virou M10-12. Novos: M10-04..M10-11 (ETL, redirecionamentos) e M10-12 (cutover).

**Ordem de execução:** M10-04 → M10-05 → M10-06 → M10-07 → M10-08 → M10-09 → M10-10 → M10-11 → M10-01 → M10-02 → M10-12 → M10-03.

---

### M10-01 — Homologação integrada e Go/No-Go

**Dependências:** M7-09, M8-04, M9-04, M9-05, M9-06, M9-07, M9-08, M9-09, M9-10, M10-10, M10-11 · **Estado:** `not_started`

**Objetivo.** Decidir com evidência se a v1 pode ir a Production.

**Passos**
1. Fixar o SHA candidato (o mesmo que será publicado). Rodar em **Staging**: E2E completo (cadastro por magic link → compra em sandbox Pix/cartão → aula → quiz → certificado; Staff: matricular, reembolsar, revogar, reemitir) e testes de contrato dos adapters de vídeo com contas reais do cliente (adapter sem teste **não** é ativado na interface).
2. Executar a matriz adversarial abaixo, uma linha = uma evidência.
3. Checklist de gates: paridade de certificado (M7-09); PWA offline aprovado **ou** desligado (M8-04); ensaio de restauração (M9-05); textos jurídicos e aceite (M9-09); parecer de retenção (M7-05); destino da cópia off-cloud decidido; Bot Fight Mode desligado; domínio e e-mail (SPF/DKIM/DMARC) na Cloudflare; ETL ensaiado (M10-10); redirecionamentos (M10-11); cliente ciente do risco do YouTube.
4. Inventário de bloqueadores P0/P1 e de pendências de terceiros, cada uma resolvida ou **aceita por escrito** pelo responsável.
5. Decisão Go/No-Go assinada e registrada em `docs/implementation/STATUS.md` com SHA, data e evidências.

| Falha injetada | Resultado exigido |
|---|---|
| Duplo clique na matrícula gratuita | 1 direito, sem Order/Asaas |
| Duas conclusões simultâneas da última aula | 1 CourseCompletion e 1 intenção de certificado |
| Webhook repetido ou fora de ordem | Sem duplicidade; evidência monotônica |
| `CHECKOUT_PAID` isolado | Não concede acesso |
| Timeout após reembolso possivelmente aceito | Sem retry cego; reconciliação/revisão |
| Falha ao publicar na Queue após commit | Outbox pendente; recuperação republica |
| Consumer perde a lease após o provider aceitar | Fencing; reconciliação confere o efeito externo |
| Admin perde a última role Admin | Rejeitado em transação |
| Suporte sem grant chama reembolso direto | 403, sem efeito |
| Upload falso (GIF/HTML com MIME `image/webp`) | Não aprovado |
| Images devolve 9422 | Fallback estático |
| Certificado revogado durante prévia/download | Novos acessos falham; snapshot intacto |
| Restaurar banco pré-reembolso | Não reenvia reembolso; reconcilia no Asaas |
| Restaurar banco pré-eliminação LGPD | Eliminações reexecutadas |
| Logout de A, login de B | Nada de A visível a B |
| Quiz enviado offline | Bloqueado até haver conexão |
| PR malicioso altera workflow de CI | Sem acesso a secrets de Production; deploy exige SHA homologado |

**Testes.** Negativos: Go/No-Go falha se qualquer gate estiver sem evidência; preflight de M10-02 rejeita binding errado.

**Aceite.** Nenhum P0/P1 nem lacuna legal impeditiva aberta; decisão assinada.

**Fora do escopo / cuidados.** Marcos concluídos não substituem esta homologação. Sem dados reais de Production em testes (o ensaio do ETL é exceção controlada: M10-04).

---

### M10-02 — Release manual de Production e preflight (sem cutover)

**Dependências:** M10-01, M0-03, M0-09 · **Estado:** `not_started`

**Objetivo.** Colocar a vNext em Production **sem tráfego público**, em hostname de verificação, de forma reproduzível.

**Passos**
1. Verificar, **independentemente do workflow**, que a árvore-fonte é a homologada: SHA == candidato do Staging; build com `CLOUDFLARE_ENV=production` definido antes do build; `wrangler types --check`.
2. Script de preflight (sem imprimir segredos): bindings e IDs de Production corretos, guard de host/projeto Neon, Hyperdrive com cache desligado, segredos presentes, Queues/DLQs e cron existentes, drift de schema, backup fresco **e** dump pré-release (M9-05), Bot Fight Mode desligado, Turnstile, domínio do Resend verificado, webhook do Asaas **ainda no legado**.
3. Provisionar Worker, R2, Queues, Hyperdrive. Migrations aplicadas pelo responsável com a role de migration, fora do GitHub CI, forward-only; `drizzle-kit push` proibido.
4. `wrangler versions upload` e promoção manual; smoke sintético no hostname de verificação (health, login por magic link do responsável, página pública de certificado de teste); sem vendas e sem e-mails reais.
5. Registrar SHA, versão do Worker, migrations, manifest do backup.

**Testes.** Preflight **deve falhar** em cada caso provocado: binding de Staging, segredo ausente, SHA diferente, backup antigo, cache do Hyperdrive ligado.

**Aceite.** Production sobe e responde no hostname de verificação; evidência arquivada; nenhum secret em workflow comum.

**Fora do escopo / cuidados.** Production é deploy manual; nunca a partir de `push main`. Rollback de código não desfaz migrations (por isso expand/contract).

---

### M10-03 — Estabilização de 7 dias e handoff

**Dependências:** M10-12 · **Estado:** `not_started`

**Objetivo.** Operar com cuidado a primeira semana e entregar a operação.

**Passos**
1. Revisão diária por 7 dias: login/magic link, outbox e DLQ, webhook e reconciliação financeira, certificados, e-mail (cota do Resend), Sentry, Neon (armazenamento, CU-h, acordadas), R2, Workers; registrar anomalias e custo real contra o teto de US$ 10/mês de infraestrutura.
2. Tratar divergências do ETL (M10-10) e eventos órfãos do Asaas.
3. Revisar runbooks e donos; ensaio rápido de incidente (mesa).
4. Desligar de fato o legado (Vercel/crons/webhooks) e decidir a retenção dos dados legados (PENDENTE responsável/advogado); higiene do repositório legado público (PENDENTE responsável, fora da vNext).
5. Handoff documentado: onde estão backups e chaves, como fazer release, quem responde a quê, métricas e histórico de releases em `STATUS.md`.

**Testes.** Critérios de saída definidos antes (sem P0/P1 abertos por N dias, backups verdes, custo dentro do teto); revisão de painéis e backlog.

**Aceite.** Handoff aceito pelo responsável; estabilização encerrada por decisão registrada.

**Fora do escopo / cuidados.** Ausência de reclamações não prova saúde: olhar os sinais.

---

### M10-04 — Inventário do legado e contrato do ETL

**Dependências:** M1-01, M3-01, M6-01, M7-01 · **Estado:** `not_started`

**Objetivo.** Saber exatamente o que existe no legado e o que migra, antes de escrever o ETL.

**Passos**
1. Com autorização do responsável (dono de Production): obter dump `pg_dump -Fc` **cifrado com `age`** do banco do legado (pode reaproveitar o backup existente). Guardar fora do repositório, do CI, de artifacts e de logs; **agentes de IA não leem o dump nem saídas com PII**: trabalhar com esquema, contagens e fixtures sintéticas.
2. Inventário por tabela: contagens, nulos, duplicidades (e-mails por caixa/pontos), estados anômalos (expirados, bloqueados, revogados), cursos legados, `content_release_*` e modos de drip, certificados (formatos `PRT-…` e Base64URL), pedidos (~40 colunas), objetos no R2.
3. Documento de mapeamento origem→destino (proposta: `docs/operations/etl-legado-mapeamento.md`): regra de transformação, o que **não** migra (eventos de analytics, posições parciais de vídeo; **comentários: decisão do responsável**, padrão proposto = não migrar; Staff: padrão proposto = recriar por convite).
4. Contrato técnico: tabelas de correspondência `legacy_map(entidade, legacy_id, novo_id)`, execução idempotente e re-executável (`etl_run`), `--dry-run`, relatório de contagens, nunca escrever no legado.
5. Plano de dados do ensaio em **Staging com dump real**: acesso restrito como Production, e-mails reais desligados (allowlist do Resend), eliminação do dado ao fim dos ensaios.

**Testes.** Revisão do mapeamento pelo responsável; checagem cruzada de contagens do inventário com o painel do legado.

**Aceite.** Mapeamento aprovado, anomalias listadas, decisões abertas (comentários, Staff, conteúdo de curso) respondidas.

**Fora do escopo / cuidados.** Tensão assumida: o AGENTS proíbe dumps de Production em código, testes, CI e artifacts; este ensaio fica fora de tudo isso e exige autorização explícita do responsável por execução. Nenhum PII em chat, commit ou prompt.

---

### M10-05 — Catálogo e currículo legados (pré-requisito do ETL)

**Dependências:** M10-04, M2-01, M2-02, M2-03, M5-03 · **Estado:** `not_started` — **PENDENTE (decisão):** o escopo do registro não lista conteúdo de curso; assumido aqui que cursos legados são recriados/importados antes do ETL.

**Objetivo.** Existirem na vNext Course, Offer, módulos e aulas equivalentes aos do legado, com mapeamento para IDs novos estáveis.

**Passos**
1. Para cada curso legado em uso: criar Course + Offer(s) (prazo em meses, preço em centavos, status) a partir do histórico; a Offer do legado que gerou Orders passa a ser referência do histórico.
2. Importar ou recriar a **publicação vigente** (módulos, aulas, D+N, obrigatória/opcional, vídeos por referência aos assets já nos provedores). Script de importação ou autoria manual: decidir pelo volume do inventário.
3. Preencher `legacy_map` para curso, módulo e aula (incluindo `curriculum_key` → aula nova), usado pelas conclusões (M10-07).
4. Preservar o `slug` do legado (ou tabela de alias) para M10-11.

**Testes.** Contagem de módulos/aulas obrigatórias igual ao legado; cronograma D+N idêntico; aula sem mapeamento falha a verificação.

**Aceite.** Para todo curso com acesso ativo, toda aula do legado tem destino mapeado.

**Fora do escopo / cuidados.** Não migrar publicações aposentadas. Vídeos não são movidos (ficam nos provedores).

---

### M10-06 — ETL: usuários, perfis e contas

**Dependências:** M10-04, M1-01, M1-02, M1-06, M1-07, M1-09 · **Estado:** `not_started`

**Objetivo.** Cada pessoa do legado entra na vNext com a identidade correta e sem ganhar privilégio.

**Passos**
1. `User`/`Profile`: e-mail normalizado, `emailVerified` somente se verificado no legado, `displayName` e `certificateName` (a pessoa reconfirma o nome antes de novo certificado, M7-07). Papel = Student; pessoas bloqueadas no legado entram suspensas.
2. Contas: vínculo Google quando o e-mail é verificado; **hash de senha só se for compatível** com a versão do Better Auth da vNext (o spike M0-10 mede scrypt do Better Auth, mas não cobre os hashes do legado; testar compatibilidade no inventário de M10-04 com conta sintética; PENDENTE). Se não, a pessoa entra por magic link (método base para todos).
3. Consentimento de marketing **não** migra por padrão (opt-out até novo consentimento; confirmar com o advogado). Aceite de termos: primeiro login exige os novos termos (M9-09).
4. Staff: não migra (recriar por `StaffInvitation`), salvo decisão registrada em M10-04.

**Testes.** Reexecução sem duplicar; e-mails duplicados por caixa/pontos; Google sem e-mail verificado não faz linking; bloqueado continua sem acesso; hash migrado autentica com **conta sintética** (nunca com senha real); senha/hash ausentes de logs; nenhum papel de Staff criado.

**Aceite.** Contagem de usuários igual ao esperado do inventário; todos os casos acima verdes no ensaio.

**Fora do escopo / cuidados.** Nenhuma senha em texto; nenhum e-mail enviado pelo ETL.

---

### M10-07 — ETL: acessos (`expiresAt`), âncora de drip e conclusões

**Dependências:** M10-05, M10-06, M3-01, M3-04 · **Estado:** `not_started`

**Objetivo.** Ninguém ganha nem perde acesso, módulo liberado ou conclusão por causa da migração.

**Passos**
1. Concessões do legado → `Entitlement` com o `expiresAt` **original** (sem estender), fonte `legacy_import`; `Enrollment` recomputado pelo caso de uso (não inserido direto). Revogadas/bloqueadas ficam revogadas.
2. **Âncora de drip** única por (pessoa, curso): derivada de `content_release_started_at` quando o legado estava em modo agendado; para matrículas em `full_access`, âncora tal que nenhum módulo já liberado seja bloqueado. Conferir contra a regra do legado.
3. `CourseCompletion` com a data original e `LessonCompletion` das aulas concluídas, via `legacy_map` (M10-05). Posições parciais de vídeo não migram.

**Testes.** Para cada pessoa: conjunto de aulas liberadas calculado pela regra do legado == vNext; acesso expirado continua expirado; revogada não reativa; reexecução idempotente; nenhuma conclusão sem aula mapeada.

**Aceite.** Comparação por pessoa sem divergência (M10-10).

**Fora do escopo / cuidados.** Não reiniciar âncora; não conceder acesso a quem não tinha. Sem e-mail "acesso liberado".

---

### M10-08 — ETL: certificados com mesmo código, hash e URL + PDFs no R2 privado

**Dependências:** M10-06, M10-07, M7-01, M7-08 · **Estado:** `not_started`

**Objetivo.** Certificados já emitidos continuam válidos nos mesmos links e com os mesmos bytes.

**Passos**
1. Importar cada certificado com `code` original (`PRT-…` ou Base64URL), `issued_at`, estado (válido/revogado, categoria) e `source = legacy_import`.
2. Copiar cada PDF do R2 do legado para o R2 **privado** da vNext; recalcular SHA-256 e comparar com o hash do legado; divergência = erro bloqueante. **Nunca regenerar.**
3. Montar o `snapshot` a partir dos dados do legado (sem layout novo). Reemitir um certificado legado cria novo certificado vNext e marca o antigo `superseded` (M7-04).
4. Revogados: se já passaram da retenção do legado, importar só o tombstone; se não, aplicar a retenção da vNext contando de `revoked_at` original (M7-05).
5. Certificados pendentes no legado são **resolvidos antes** do cutover (esvaziar a fila no legado), para não disparar e-mails em massa.

**Testes.** Para cada código: página pública `/certificados/:code` mostra o mesmo estado; hash do objeto == hash legado; código legado aceito pela rota; revogado continua revogado; nenhum e-mail enviado.

**Aceite.** 100% dos certificados verificados (volume atual pequeno); PDFs abrem e têm hash igual.

**Fora do escopo / cuidados.** Sem PNG de prévia; sem PDF público (o legado tinha, a vNext não).

---

### M10-09 — ETL: financeiro histórico somente leitura

**Dependências:** M10-06, M6-01, M6-08 (visão financeira e cifragem de CPF/CNPJ) · **Estado:** `not_started`

**Objetivo.** A Staff consulta vendas antigas sem que elas gerem acesso, webhook ou reembolso na vNext.

**Passos**
1. Tabelas **separadas** do domínio vivo (`legacy_order`/`legacy_payment`): nome, CPF/CNPJ informado, valor em centavos, data, forma de pagamento, IDs do Asaas.
2. Tela de consulta para quem tem o grant financeiro, marcada "Histórico do sistema anterior", sem ações.
3. **Reembolso de venda do legado: manual no painel do Asaas + revogação manual** do acesso na vNext (instrução exibida na tela). Nenhum `RefundRequest` para pedido legado.
4. CPF/CNPJ importado **cifrado em repouso e mascarado por padrão**, com o mesmo utilitário e a mesma auditoria de revelação do M6-08; fora de logs e de listagens; acesso só por grant.

**Testes.** Totais por status em centavos == legado; endpoint de reembolso rejeita pedido legado; Suporte sem grant não vê; eventos do Asaas para pagamento legado **não** concedem acesso (vão para revisão financeira).

**Aceite.** Somas conferem; nenhuma ação financeira disponível sobre histórico.

**Fora do escopo / cuidados.** NFS-e fora da v1. Não recriar Order/Payment vivos.

---

### M10-10 — Verificação do ETL e ensaio geral

**Dependências:** M10-05, M10-06, M10-07, M10-08, M10-09 · **Estado:** `not_started`

**Objetivo.** Provar, com dump real cifrado em Staging, que o ETL final vai dar certo.

**Passos**
1. Rodar o ETL completo em Staging (dump real cifrado; regras de M10-04), cronometrando.
2. Verificações automáticas: contagens por entidade (legado × vNext, diferenças explicadas), somas financeiras, `legacy_map` sem órfãos, nenhuma linha viva criada para financeiro legado, **zero e-mails** na outbox.
3. Verificação por pessoa: com ~20 alunos hoje, conferir **100%** (acesso, expiração, módulos liberados, conclusões, certificados) em vez de amostragem; se o inventário mostrar volume maior, amostragem estratificada.
4. Segundo ensaio depois de corrigir falhas; registrar tempo total (define a janela do cutover).
5. Apagar os dados reais do Staging ao final e registrar a eliminação.

**Testes.** Reexecução do ETL sobre o mesmo destino (idempotência); ETL com dump alterado propositalmente (e-mail duplicado, aula sem mapa) deve falhar de forma clara.

**Aceite.** Relatório sem divergência não explicada; tempo medido; dados reais eliminados do Staging.

**Fora do escopo / cuidados.** O ensaio não substitui a verificação final no cutover (M10-12).

---

### M10-11 — Redirecionamentos de URLs históricas e validação de certificado

**Dependências:** M10-05, M10-08, M7-08, M2-04, M2-06 · **Estado:** `not_started`

**Objetivo.** Links já divulgados (landing pages externas, QR dos PDFs, e-mails) continuam funcionando.

**Passos**
1. Mapa de rotas do legado (inventário M10-04 e evidência L2 §10): `/comprar/[slug]` → página do curso na vNext (login obrigatório antes de comprar; sem Order criado pelo redirect); `/certificados/[code]` mantido; `/certificados/[code]/preview` e `/pdf` públicos → página de validação (a vNext não tem PDF público); `/checkout/{sucesso,cancelado,expirado}` e `/app/checkout/sucesso` → telas equivalentes; `/app/aulas/[lessonId]` → aula pelo mapa (`legacy_map`); `/politica-de-privacidade` → página de Privacidade.
2. Implementar no Worker (rotas atendidas antes da SPA), com tabela versionada e testes; 302 durante a estabilização e 301 depois (proposta). Slug desconhecido → 404 amigável.
3. Destinos apenas de uma lista fixa (nunca derivados de parâmetro do usuário). Repassar `utm_*`.

**Testes.** Cada URL histórica → destino esperado (GET/HEAD); open redirect impossível; slug inválido; código legado `PRT-…` validado; meta tags do HTMLRewriter na página do curso e na validação.

**Aceite.** Tabela de redirecionamentos 100% coberta por teste, executada contra o Staging com os slugs reais.

**Fora do escopo / cuidados.** Não recriar o handoff anônimo do legado: sem guest checkout.

---

### M10-12 — Cutover: legado em manutenção, ETL final, webhook e DNS

**Dependências:** M10-02, M10-10, M10-11, M10-01 · **Estado:** `not_started`

**Objetivo.** Trocar o sistema em uma janela curta, com ponto de não retorno explícito.

**Passos**
1. **Antes (D-7…D-1):** zona DNS já na Cloudflare com todos os registros copiados (MX/SPF/DKIM/DMARC conferidos); TTL do registro de `app.neurocapacitar.com.br` reduzido; **vendas do legado pausadas** e checkouts pendentes (Pix) drenados ou expirados; aviso aos alunos **no próprio legado** (sem e-mail em massa); dump pré-cutover do legado e backup pré-release da vNext.
2. **Janela:** (a) legado em manutenção (`APPLICATION_MAINTENANCE_MODE=full`); (b) dump final do legado, cifrado, com checksum; (c) ETL final em Production vNext executado pelo responsável com preflight; (d) verificações automáticas de M10-10 **são gate**: divergência → abortar (ainda há volta).
3. Trocar o **webhook do Asaas** para o endpoint da vNext (URL e token novos); eventos de pagamentos que o legado criou e a vNext desconhece vão para revisão financeira (não concedem acesso); conciliar por API os pagamentos ocorridos entre o dump e a troca.
4. Trocar o **DNS** de `app.neurocapacitar.com.br` para o Worker de Production; smoke público: login por magic link, validação de certificado com código legado, `/comprar/[slug]`, webhook, e-mail transacional (cota), Turnstile.
5. **Ponto de não retorno:** primeira operação nova na vNext. Antes dele: reverter DNS e webhook, tirar o legado da manutenção. Depois: só correção para frente.
6. Desligar o legado (crons, webhooks, vendas) depois do smoke; manter o dump cifrado final até a decisão de retenção.

**Testes.** Ensaio do roteiro (inclusive o rollback pré-ponto de não retorno) em Staging; checklist da janela com responsável por passo.

**Aceite.** Contagens finais == esperado; webhook e DNS apontando para a vNext; legado fora; primeira compra/login reais observados sem erro.

**Fora do escopo / cuidados.** Sem e-mail em massa; sem abrir vendas antes de o webhook novo ser testado; cuidado com Bot Fight Mode (desligado) e com o prazo de propagação do DNS.
