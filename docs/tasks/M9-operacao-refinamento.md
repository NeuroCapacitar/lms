# M9 — Operação e refinamento

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega.** A v1 deixa de ser "funciona" e passa a ser "operável por uma equipe de 1 dev + 1 Admin + 3 Suportes": Staff completo por grants; painel de **contagens de fatos** e **fila operacional** (sem CSV, sem clickstream); analytics first-party; preferência de marketing com Resend Contacts/Segments e unsubscribe autoritativo; hardening transversal com matriz de provas; backup com restauração **ensaiada**; alertas P0–P3 e runbooks (sem plantão 24/7); performance dentro do free tier; UX/acessibilidade finais; textos jurídicos reais com aceite versionado; procedimento manual para pedidos por e-mail. **Gate de aceite:** matriz de hardening verde (M9-04); ensaio de restauração concluído com RPO ≤ 24 h e RTO ≤ 8 h **medidos** (metas, não garantias); WCAG 2.2 AA verificado (contraste calculado, axe, teclado, leitor de tela); runbooks ensaiados; textos jurídicos e aceite implementados (redação pelo advogado do cliente).

**Pendências de terceiros (não inventar):** PENDENTE (cliente) destino da cópia semanal fora da Cloudflare; PENDENTE (advogado do cliente) termos, privacidade, política de reembolso, retenções, transferência internacional, prazos do canal do titular; PENDENTE (contador) NFS-e (fora da v1: o Hub apenas guarda e mostra à Staff nome, CPF/CNPJ informado, valor, data e forma de pagamento); PENDENTE (verificação) cota de broadcasts do Resend Free.

**Notas de IDs.** M9-01..M9-06 mantidos, com M9-06 reduzido a alertas/runbooks: o antigo "operação, alertas, performance e UX final" foi dividido porque eram quatro assuntos. Novos: M9-07 (performance e custo), M9-08 (UX/acessibilidade final), M9-09 (textos jurídicos reais; o mecanismo de aceite versionado já é o M1-09), M9-10 (pedidos por e-mail).

---

### M9-01 — Staff completo, painel de fatos e fila operacional

**Dependências:** M1-03, M1-10, M2-03, M3-06, M3-07, M4-05, M5-14, M6-04, M6-08, M7-04 · **Estado:** `in_progress` (feitos: a matriz com a prova, o painel de fatos, a fila de ações e a leitura da auditoria; pendentes, e dependem de decisão: ficha da pessoa, modo de manutenção e a fila de pedidos de suporte; ver `docs/implementation/STATUS.md`)

**Objetivo.** Cada pessoa da Staff vê e faz exatamente o que seus grants permitem, e sabe o que precisa de ação.

**Passos**
1. Matriz `capacidade × tela × endpoint` (deliverable): só Admin = criar curso, oferta/preço/disponibilidade, template e emitente de certificado, revogar certificado, convidar Staff e gerir papéis/grants, credenciais de integração, manutenção. Delegáveis por grant = editar curso (inclui publicar), matricular/suspender, editar matrícula de suporte, reembolsar, revisão financeira, ver pedidos/análise financeira, reemitir certificado, moderar discussões, editar FAQ/Ajuda, ver auditoria, operar fila. Sem grant: ver inscritos, cursos e fila, prévia de aluno, responder pedidos de suporte.
2. **Painel** com contagens de fatos (pessoas inscritas por curso, acessos expirando em 7 dias, conclusões, certificados emitidos/falhos, pedidos pagos/pendentes/reembolsados, interesses ativos, denúncias abertas), cada uma com definição e período escritos na tela.
3. **Fila operacional**: itens acionáveis com idade (FinancialReview, RefundRequest pendente/incerto, certificado `failed`/`awaiting_name` antigo, e-mail falho/suprimido, outbox/DLQ atrasada, denúncia, pedido de suporte). Cada item só mostra ação a quem tem o grant.
4. Listas paginadas por cursor (TanStack Table 9, `size="sm"`); Recharts só se houver gráfico simples. Shell com sidebar/gaveta.
5. Completar só o que faltar na matriz. Já existem: matrícula manual/suspensão/lista de inscritos (M3-06), prévia de aluno (M3-07), shell e equipe (M1-10), FAQ/Ajuda (M5-14), dados financeiros (M6-08), tela de operação inicial (M4-05). Podem faltar: ficha unificada da pessoa, moderação, visualização de auditoria, modo de manutenção.

**Testes.** Cada capacidade por **chamada direta de API** sem grant (403) e com grant; acesso cruzado (IDOR); remover grant com sessão aberta (efeito na próxima requisição); último Admin não removível sob concorrência; paginação com 10 mil linhas sintéticas e `EXPLAIN` das contagens; prévia de aluno não grava progresso.

**Aceite.** Matriz completa e testada; nenhum endpoint genérico de update.

**Fora do escopo / cuidados.** Sem CSV, sem clickstream, sem mega dashboard. Contagens fazem consultas ao Neon Free: custo de acordar e CPU entram em M9-07.

---

### M9-02 — Analytics first-party (fatos derivados)

**Dependências:** M3-04, M5-04, M5-06, M6-06 · **Estado:** `in_progress` (passos 1 e 3 feitos; o passo 2, `EXPLAIN` e rollup, pendente: ver `docs/implementation/STATUS.md`)

**Objetivo.** Responder perguntas de curso e oferta com dados que já existem, sem coletar eventos novos.

**Passos**
1. Consultas agregadas: progresso por pessoa e por curso (quem tem grant de ver inscritos), contagem de inativos há 14 e 30 dias, aprovação/tentativas por quiz, conclusão por aula e distribuição da maior posição de vídeo, funil de oferta (interesse → checkout criado → pago/expirado), conversão de CourseInterest.
2. Índices guiados por `EXPLAIN`; se uma consulta passar do orçamento de M9-07, criar rollup diário no cron existente (sem novo cron).
3. Telas só para Staff com grant; texto de privacidade descreve fatos operacionais identificáveis (não "anônimos").

**Testes.** Matemática das métricas com dados sintéticos; limites de 14/30 dias; visão restrita por grant; orçamento de consulta; nenhuma tabela de eventos brutos criada.

**Aceite.** Números reproduzíveis à mão num conjunto pequeno; sem CSV nem exportação.

**Fora do escopo / cuidados.** Não alegar causalidade (aviso → compra). Sem pixels de terceiros no Hub.

---

### M9-03 — Preferência de marketing e Resend Contacts/Segments

**Dependências:** M4-04, M4-07 (webhook Resend), M4-08 (cota), M1-02, M5-06, M9-09 (texto do consentimento) · **Estado:** `not_started`

**Objetivo.** Consentimento de marketing próprio, separado, revogável, sincronizado com o Resend sem nunca reinscrever quem saiu.

**Passos**
1. Tabela de consentimento (estado atual + histórico append-only com versão do texto aceito), **independente** de CourseInterest e dos termos; caixa desmarcada por padrão.
2. Sincronização por outbox para Resend Contacts/Segments, idempotente; **reenvio de sincronização nunca muda opt-out para opt-in**.
3. **Unsubscribe autoritativo:** descadastro vindo do Resend (link/webhook/reconciliação periódica) grava opt-out no Hub; opt-out do Hub atualiza o Resend; opt-in novo só por ação explícita da pessoa no Hub. Opt-out sempre vence.
4. **Verificar a cota** com conta Free real antes de ativar: broadcasts contam nos 100/dia e 3.000/mês? limite de contatos? PENDENTE (verificação). Se compartilham a cota dos transacionais, broadcast fica desativado ou limitado; o envio em massa é feito no painel do Resend, não pelo Hub. No livro-razão do M4-08, marketing é a classe de menor prioridade e nunca disputa cota com `magic-link`.
5. Lead de landing externa **não** cria User nem CourseInterest.

**Testes.** Opt-in/opt-out; corrida bounce × unsubscribe; webhook Svix falso rejeitado; re-sync não reinscreve; supressão por bounce não vira opt-in; remoção do contato quando a conta é eliminada (M9-10).

**Aceite.** Preferência first-party respeitada em todos os casos; decisão sobre broadcasts documentada com evidência da conta Free.

**Fora do escopo / cuidados.** Sem CMS/editor de e-mail marketing. **Sem e-mail em massa no cutover.**

---

### M9-04 — Hardening transversal (matriz de provas)

**Dependências:** M1-05, M5-07, M6-06, M7-04, M8-04 · **Estado:** `not_started`

**Objetivo.** Provar, por teste, os controles de segurança de todos os fluxos antes da homologação.

**Passos**
1. Criar a matriz `ameaça × fluxo × teste × resultado` e preencher com evidência. Linhas mínimas: **XSS** (Tiptap/allowlist, discussões, HTML de certificado, meta tags do HTMLRewriter); **CSRF** (CSRF próprio para JSON, tela de confirmação do magic link, webhooks fora do CSRF mas autenticados); **RBAC** (cada capacidade por chamada direta, acesso cruzado); **SSRF** (Browser Run bloqueando rede, URLs de vídeo/adapters, qualquer fetch com URL de usuário); **upload** (MIME forjado, GIF/HTML como `image/webp`, path traversal, presigned PUT reaproveitado); **financeiro** (preço do cliente, webhook repetido/fora de ordem, `CHECKOUT_PAID` sozinho, valor divergente); **preview** (prévia de aluno sem gravar, Version URLs/Previews protegidas).
2. CSP final (incluindo o que o PDF/headless precisa), CORS, cookies, rate limits e Turnstile no pedido de link; Bot Fight Mode **desligado** até testar webhooks reais.
3. Varredura de logs por PII e de segredos (Gitleaks) no histórico.
4. Incluir as provas adversariais do pacote anterior (08 §4) que dependem deste marco (ver M10-01).

**Testes.** A própria matriz; scanners (Semgrep CE, Gitleaks) como apoio, nunca como único controle.

**Aceite.** Nenhuma linha vermelha em auth, financeiro ou privacidade.

**Fora do escopo / cuidados.** Pen test externo é opcional e não está no escopo.

---

### M9-05 — Backups, retenção e ensaio de restauração

**Dependências:** M4-03, M5-07, M6-06, M7-05 · **Estado:** `not_started`

**Objetivo.** Banco recuperável, com efeitos externos reconciliados.

**Passos**
1. Job diário `pg_dump -Fc` com cliente PG18, conexão **direta** ao Neon (não Hyperdrive), role somente leitura, cifra `age` (chave privada **fora** do CI), saída no R2 em bucket separado da mídia, com token de escopo mínimo; manifest com SHA-256, tamanho e versão de migration. Executor: repositório administrativo isolado só se necessário (GitHub Free; o agendador atrasa horas, por isso o alerta de frescor é obrigatório).
2. Dump **antes de cada release** (script manual exigido pelo preflight de M10-02).
3. Retenção e lifecycle/bucket lock com valores aprovados pelo responsável (backups contêm PII: alinhar com M9-09).
4. **Cópia semanal fora da Cloudflare:** script agnóstico (S3-compatível) que leva o dump cifrado mais recente; destino PENDENTE (cliente). Decidir se PDFs de certificado e mídia entram (PDF de certificado é evidência com hash e, por inferência, não se regenera byte a byte).
5. **Ensaio de restauração** (semestral e antes do Go-Live): baixar → decifrar → `pg_restore` em PG18 descartável e em projeto Neon Dev; medir tempo (RTO ≤ 8 h) e idade do dump (RPO ≤ 24 h).
6. **Reconciliação pós-restore** (script + runbook): colocar o outbox em quarentena; conferir no Asaas pagamentos/reembolsos desde a data do dump; reaplicar revogações de certificado/acesso e eliminações LGPD (log fora do banco, M9-10); só então reabrir o outbox. Neon Free (PITR curto) não substitui estes backups.

**Testes.** Dump corrompido detectado por SHA; decifrar sem chave falha; token do job não lê a mídia; alerta de backup velho; restore de dump antigo: **banco pré-reembolso não reenvia o reembolso (reconcilia no Asaas)**, **pré-eliminação LGPD reexecuta a eliminação**, certificado revogado depois do dump volta revogado, nenhum e-mail reenviado.

**Aceite.** Ensaio registrado (data, duração, resultado, falhas) e RPO/RTO medidos.

**Fora do escopo / cuidados.** Nunca restaurar direto em Production sem revisão. Chave privada `age` nunca no GitHub.

---

### M9-06 — Alertas, SLOs e runbooks

**Dependências:** M4-05, M4-06, M4-08, M9-01, M9-05 · **Estado:** `not_started`

**Objetivo.** Saber quando algo quebra e ter um passo a passo escrito, sem plantão 24/7.

**Passos**
1. Completar a taxonomia **P0–P3** (o M4-05 já criou os alertas iniciais de fila, DLQ, Cron e cota) com limites propostos e ajustados por dados: P0 (site/checkout/webhook inoperante, banco inacessível), P1 (DLQ com mensagens, outbox atrasada, backup > 26 h), P2/P3 (cota de e-mail, certificado `failed`, erros no Sentry). Canais gratuitos (Sentry Free com 1 usuário, e-mail); monitor sintético de `/health/ready`: ferramenta PENDENTE (dentro do free tier). Documentar o tempo de resposta esperado (horário comercial).
2. Gatilhos de upgrade (nova decisão, nunca automática): Neon > 600 MB, > 70 CU-h/mês ou primeiro incidente de perda de dados; Resend: gatilho "60% da cota em 7 dias" já implementado no M4-08 (leitura adotada lá: 60% da cota mensal; a confirmar com o responsável) — aqui só entra na taxonomia e no runbook.
3. Runbooks curtos: webhook Asaas falhando; fila/DLQ; Neon indisponível ou no limite; cota do Resend; restauração (M9-05); certificado `failed`; rotação de segredos; rollback de release; **incidente com dados pessoais** (avaliar risco relevante; comunicação à ANPD em 3 dias úteis, 6 para pequeno porte conforme fonte secundária a validar com o advogado; registro de todos os incidentes por ≥ 5 anos; consulta que lista titulares afetados).
4. Exercícios de falha em Staging seguindo os runbooks (as falhas de fila/lease já são provadas por teste no M4-06; aqui se prova que **a pessoa** reconhece o alerta e executa o passo): publish na Queue falha depois do commit; consumer perde a lease; Browser Run fora do ar; Resend fora do ar.
5. Custo de logs: `head_sampling_rate`, sem payloads, atenção à cobrança por GB a partir de 2026-12-01.

**Testes.** Cada alerta disparado de propósito; cada runbook seguido por quem não o escreveu.

**Aceite.** Runbooks revisados e exercícios registrados.

**Fora do escopo / cuidados.** Não contratar SaaS de observabilidade; Sentry não substitui a auditoria financeira.

---

### M9-07 — Performance e orçamento de custo (Neon, Workers, acordar)

**Dependências:** M0-12 (spike de latência/acordar), M9-01, M9-02, M7-08 · **Estado:** `in_progress` (feitos: idas ao banco e EXPLAIN, uma otimização medida, configuração, cold start, consumo estimado e carga leve no Staging; achado: Error 1102 por limite de CPU do plano gratuito do Worker; pendentes: rotas logadas em Staging, custo marginal no Neon, plano do Worker, outras franquias: ver `docs/implementation/STATUS.md` e `docs/review/evidencias/m9-07/README.md`)

**Objetivo.** Provar, por medição, que a v1 cabe no free tier e no teto de US$ 10/mês (só Workers Paid é custo certo).

**Passos**
1. **Orçamento de acordar do Neon Free:** contar acordadas por dia (cron de 30 min, backups, tráfego anônimo, página pública); medir CU-h/mês em Staging com tráfego sintético contra o gatilho de 70 CU-h. Cold start da primeira requisição da manhã registrado.
2. Conexões: soma do `max_size` do Hyperdrive ≤ conexões úteis do compute (≈ 97 em 0,25 CU, a confirmar); `pg` por requisição, cache do Hyperdrive desligado.
3. Workers: CPU-ms por rota quente (login, aula, heartbeat de vídeo de 15–30 s, progresso) contra a franquia; heartbeat **leve** (sem recarregar o workspace inteiro).
4. `EXPLAIN` do caminho quente e índices; consultas de M9-01/M9-02.
5. Outras franquias: Browser Run (horas), Queues (operações), Workers Logs, R2, Images (5.000 transformações únicas/mês com contador e fallback estático).
6. Teste de carga leve em Staging com dados sintéticos (nunca em Production). Registrar números reais e gatilhos.

**Testes.** Cenários de carga reproduzíveis (script versionado); falha proposital: Images devolvendo 9422 mantém a imagem estática.

**Aceite.** Relatório com valores medidos e limites; nenhuma rota quente acima do orçamento definido após a medição (valor PENDENTE da medição).

**Fora do escopo / cuidados.** Sem infraestrutura de carga paga. Estimativas sem medição não valem.

---

### M9-08 — UX e acessibilidade finais (WCAG 2.2 AA)

**Dependências:** M0-07, M9-01 · **Estado:** `in_progress` (passos 1, 3 e 5 feitos, 2 e 4 parciais: leitor de tela manual e pendências do checklist; ver `docs/implementation/STATUS.md` e `docs/operations/accessibility-checklist.md`)

**Objetivo.** Verificar, no produto inteiro, os critérios assumidos em design.

**Passos**
1. **Contraste calculado** por script sobre os tokens OKLCH (claro/escuro; texto, ação, foco, estados hover/disabled), incluindo botão laranja com texto escuro; falha quebra o CI.
2. Checklist WCAG 2.2 AA: 2.4.11 (foco não encoberto por barras fixas), 2.5.7 (alternativa a arrastar: editor de certificado e reordenação por botões), 2.5.8 (alvos), 3.2.6, 3.3.7, 3.3.8 (login sem teste cognitivo; caminho acessível do Turnstile).
3. **WCAG 2.2.2:** nada em movimento automático por mais de 5 s sem controle de pausa (carrossel de banners, mídia de login, contagem de autoavanço). Sem adaptação a `prefers-reduced-motion` (decidido).
4. axe e teclado em CI nos fluxos críticos; leitor de tela manual (NVDA/VoiceOver) em: link de login, compra, aula, quiz, certificado, principais telas da Staff; 360–1440 px.
5. Declaração de acessibilidade e canal de contato; linguagem neutra ("Boas-vindas", "Pessoas inscritas").

**Testes.** O próprio checklist; regressão de contraste.

**Aceite.** Evidência por critério; pendências listadas com dono.

**Fora do escopo / cuidados.** Legendas (WCAG 1.2.2, nível A) dependem do provider; legenda própria não entrou na v1 (Q17): registrar a lacuna ao responsável, orientar a publicar vídeos com legenda e dizer o que não conforma na declaração. Símbolo de acessibilidade (LBI art. 63): conferir com o advogado.

---

### M9-09 — Textos jurídicos reais, páginas públicas e integração com checkout

**Dependências:** M1-09 (mecanismo de aceite versionado e declaração 18+), M6-02, M5-14 · **Estado:** `not_started`

**Objetivo.** Trocar os textos provisórios do M1-09 pelos textos do advogado do cliente e ligar o aceite ao resto do produto. **A redação é do advogado** (Q38, pré-requisito do Go-Live); o Hub só implementa exibição e registro.

**Passos**
1. Receber do advogado: Termos de uso (público 18+), Privacidade, Política de reembolso (7 dias garantidos desde a compra; depois, exceção do Admin) e canal do titular. Guardar como arquivos versionados com hash e publicar como nova versão em `legal_document_version`; páginas públicas `Termos`/`Privacidade` sem login.
2. Checkout exibe termos e política de reembolso antes do pagamento e guarda as versões no snapshot da Order (confirmar com o advogado).
3. Aviso permanente nas discussões proibindo dados identificáveis de pacientes (texto aprovado) e a seção de Ajuda sobre pedidos por e-mail (M5-14, M9-10) com o texto final.
4. Pontos PENDENTES (advogado): retenções (pedidos de suporte, backups, logs), transferência internacional (Cloudflare e Resend sem cláusulas-padrão da ANPD, a validar), retenção de logs de acesso (Marco Civil art. 15, 6 meses, a confirmar), cookies (sem banner enquanto só houver necessários e analytics sem cookies, a verificar).
5. Pessoas importadas do legado (M10-06) aceitam a nova versão no primeiro login (já garantido pelo M1-09; incluir no ensaio de M10-10).

**Testes.** Nova versão publicada força novo aceite; replay de versão antiga rejeitado; checkout sem os textos exibidos falha o E2E; nenhuma página de Production mostra texto marcado como provisório (teste que procura o marcador).

**Aceite.** Textos reais publicados e aceite funcionando; sem texto provisório em Production.

**Fora do escopo / cuidados.** O desenvolvedor não redige cláusulas nem interpreta a lei.

---

### M9-10 — Procedimento manual de pedidos por e-mail (Q21)

**Dependências:** M9-09, M5-14 (formulário/Ajuda), M3-06, M6-05, M7-04 · **Estado:** `not_started`

**Objetivo.** Desistência, exclusão, dados e troca de e-mail **sem funcionalidade própria**, por e-mail ao suporte, com procedimento escrito e prova de que a Staff o executa.

**Passos**
1. Runbook para a Staff: confirmação de recebimento imediata (modelo de resposta), prazo interno de resposta (PENDENTE advogado; o Decreto 7.962 cita resposta em até 5 dias), validação de identidade (pedido do e-mail da conta, ou confirmação por link ao e-mail cadastrado).
2. Casos: (a) **desistência/reembolso** dentro de 7 dias via `RefundRequest` por quem tem o grant; (b) **exclusão/anonimização** com checklist (o que se elimina × o que se retém por obrigação fiscal/legal, a confirmar com contador/advogado; remover contato do Resend); (c) **acesso/portabilidade** (exportação); (d) **troca de e-mail** (a confirmar: só Admin, confirmando ambos os endereços).
3. Operações que exigirem SQL/script: script versionado, com `--dry-run` e testado em PG real; nunca SQL avulso em Production; registrar cada execução.
4. Registro das eliminações **também fora do banco** (reexecutável após restauração, M9-05).

**Testes.** Os 3 Suportes executam cada caso em Staging com dados sintéticos; medir tempo; revisão dos modelos de resposta pelo advogado.

**Aceite.** Runbook aprovado; ensaio de cada caso registrado.

**Fora do escopo / cuidados.** Sem botão de exclusão, exportação ou troca de e-mail para o aluno. Reembolso de venda do legado é manual no Asaas (M10-09).
