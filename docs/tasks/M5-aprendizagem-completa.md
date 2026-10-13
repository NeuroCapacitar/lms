# M5 — Aprendizagem completa

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Marco.** Completa a experiência de estudo: vídeo com seis providers por adapter (JMVStream, Panda, Cloudflare Stream, Mux, YouTube, Vimeo) sob um único contrato de progresso e player; quiz simples; discussões mínimas por aula; interesse em cursos ainda não abertos (CourseInterest com ciclos); uploads em R2 com Images Free e fallback; Ajuda/FAQ com pedido de suporte por e-mail; banners e mídia de login. **Gate de aceite:** (a) cada adapter só aparece na interface de Production **depois** de ter evidência registrada de teste de contrato com conta real fornecida pelo cliente — adapter sem conta/evidência fica `unverified` (código pronto, inativo) e entrar na v1 sem ele é decisão do responsável/cliente (PENDENTE cliente); (b) vídeo conclui no limiar de 90% e autoavança só em `ended` confiável; (c) quiz obrigatório conta para conclusão; (d) uma notificação por interesse por ciclo; (e) upload forjado/adulterado é rejeitado. Fontes: [registro do debate](../review/registro-do-debate.md) (Q12, Q13, Q24, Q36, Q41) e evidência W4 §4–7.

**Como ler.** Dependências em M0–M3 usam os IDs do backlog antigo (M2-02 identidade curricular/Lesson, M2-03 Course Builder, M3-01 Entitlement, M3-04 progresso/conclusão); confira com `docs/tasks/M0..M3`. Regras comuns: segredo de provider nunca volta ao navegador; nenhum iframe com URL arbitrária; todo listener `message` valida `event.origin` **e** `event.source`; entrada de Staff/aluno validada por Zod; Staff em "prévia de aluno" nunca grava progresso/tentativa/post. Ordem sugerida: 01 → 02 → 03 → 08 → (04, 05, 06, 07, 14, 15 em qualquer ordem) → 09 → 10 → 11 → 12 → 13.

**Removida/fundida:** a antiga M5-03 ("concluir seis adapters") foi dividida em M5-08..M5-13 (um adapter por tarefa) e a M5-03 passou a ser a suíte de contrato + trava de ativação; a antiga M5-02 foi separada em contrato/player (M5-02) e primeiro adapter real (M5-08). Novas: M5-14 (Ajuda/suporte), M5-15 (banners/login). Autoavanço e M5-02 seguem a decisão de vídeo do registro (Q24), sem anti-seek.

---

### M5-01 — VideoAsset e VideoProviderConnection com segredos cifrados

**Dependências:** M2-02, M1-05, M0-04 · **Estado:** `implemented` (2026-10-13; CI pendente; cofre real não exercitado, ver STATUS)

**Objetivo:** a Admin cadastra conexões com os providers (contas do cliente) sem que o segredo volte ao navegador; aulas apontam para um `VideoAsset` que usa uma conexão concreta.
**Passos:**
1. Migrations: `video_provider_connections` (provider, rótulo, `ciphertext`, `nonce`, `key_version`, status `active|disabled`), `video_assets` (conexão, provider, `external_id`, `managed|referenced`, estado `processing|ready|error|unavailable`, `duration_seconds`, capabilities declaradas). Várias conexões por provider; **sem** provider padrão por Course; um Course pode misturar providers.
2. Utilitário AES-GCM (WebCrypto): nonce aleatório de 96 bits por cifragem, AAD = id da conexão + provider, chaves versionadas num segredo do Worker (mapa `versão → chave`; chave mestra nunca no banco nem no dump).
3. UI Admin (só Admin gerencia credenciais): campos de segredo write-only; depois de salvo só aparece "configurado" e a versão da chave; rotação = enviar novo segredo (nova cifragem) ou trocar a versão da chave mestra com job de recifragem.
4. Trocar/desativar conexão não altera `VideoAsset` já existente nem histórico de progresso.
**Testes:** round-trip; nonce nunca repete em N cifragens; AAD trocado ou ciphertext adulterado falha; versão de chave desconhecida falha com erro claro; Suporte sem grant recebe 403 direto pela API; resposta/logs nunca contêm o segredo (scan).
**Aceite:** nenhuma rota devolve segredo (nem parcial); rotação preserva assets e funciona sem downtime.
**Fora do escopo / cuidados:** chave mestra perdida = conexões precisam ser recadastradas (documentar). Provider sem segredo (YouTube/Vimeo públicos) usa conexão sem credenciais. Credenciais reais só em Staging/Production, nunca em fixtures.

### M5-02 — Contrato de progresso e player de vídeo

**Dependências:** M5-01, M3-04 · **Estado:** `implemented` (2026-10-13; evidência em `docs/implementation/STATUS.md`)

**Objetivo:** um player e um contrato únicos que qualquer adapter implementa; conclusão pela política do Course (default 90%), autoavanço separado.
**Passos:**
1. Interface de adapter: `capabilities` (`reportsTime`, `reportsEnded`, `reportsSeek`, `resume`, `duration: api|player`, `managedUpload`, `signedPlayback`, `domainRestriction`), `buildEmbed(asset)` (host em allowlist por provider), `normalize(messageEvent)` → eventos `ready|play|pause|timeupdate(t)|seeked(t)|ratechange|ended|error|durationchange`.
2. Cliente: heartbeat a cada 15–30 s reproduzindo + envio em `pause`, `seeked`, `ended`, aba oculta (`visibilitychange`) e `pagehide` via `fetch(..., {keepalive:true})` **com o cabeçalho CSRF do projeto** (não usar `sendBeacon` para JSON). Payload `{lessonId, videoAssetId, playbackSessionId, seq, position}`.
3. Servidor `POST` com DTO Zod: reverifica Entitlement/expiração/drip/sequência a cada requisição; limita `position` a `[0, duration]`; ignora `seq` menor ou igual ao último; grava `max(position)` monotônico; conclui quando `max/duration ≥ threshold` do Course (default 0,90), de forma idempotente com evidência (provider, asset, posição, duração, horário do servidor). Seek permitido, sem anti-seek e sem botão manual de conclusão para vídeo.
4. Duração: vem do provider (API → gravada no `VideoAsset`; ou `player` → aceita-se o primeiro valor plausível e congela-se; mudança exige ressincronização pela Staff). PENDENTE (spike 4): confirmar a fonte por provider.
5. Autoavanço: preferência do aluno, default **desligada**; só com `ended` de adapter com `reportsEnded` confiável; contagem cancelável; nova verificação de drip/sequência no servidor; **sem autoplay** da próxima aula. Sem `reportsEnded`, botão "Próxima aula" manual.
6. Adapter falso (`FakeVideoAdapter`) com eventos roteirizados para testes e uma página só de Dev.
**Testes:** 89% não conclui e 90% conclui; seek direto ao limiar; `seq` antigo/duplicado; posição maior que a duração; rate 2×; duas abas; aula bloqueada por drip; acesso expirado no meio da reprodução (403 sem gravar); Staff em prévia não grava; mensagem de `origin`/`source` errados é ignorada; autoavanço OFF por padrão e cancelável; provider sem progresso.
**Aceite:** com o adapter falso, a aula conclui só pela política aprovada e o autoavanço é independente da conclusão.
**Fora do escopo / cuidados:** não prometer anti-seek nem extrapolar capabilities; cobertura de intervalos assistidos só como analytics futuro, sem efeito na conclusão.

### M5-03 — Suíte de contrato por adapter e trava de ativação

**Dependências:** M5-02 · **Estado:** `not_started`

**Objetivo:** garantir que nenhum adapter chegue à Staff/aluno sem prova com conta real.
**Passos:**
1. Suíte compartilhada `runAdapterContract(adapter, fixtures)` (offline, com fixtures gravadas): normalização de ID/URL, status, URL de reprodução, URL/iframe inseguro rejeitado, erro/timeout, falha de processamento, delete só de asset gerenciado (`managed`), eventos só se a capability for declarada.
2. Checklist manual com conta real (modelo único usado por M5-08..M5-13): play, pause, seek ao limiar, rate 2×, aba oculta, iPhone real em tela cheia e ao sair, `ended` com autoplay/loop desligados, perda de rede com flush, domínio não autorizado bloqueado, token/URL expirado, erro de vídeo removido. Resultado registrado em `docs/implementation/STATUS.md` (data, tipo de conta, resultado por item, o que não foi possível).
3. Trava: lista `VERIFIED_PROVIDERS` por ambiente (configuração revisada em PR); em Production o seletor de provider só mostra os verificados; em Dev/Staging os demais aparecem com aviso "não verificado".
**Testes:** teste de que provider fora da lista não é selecionável nem aceito pela API em Production; a suíte falha se um adapter reportar capability sem evento correspondente.
**Aceite:** a suíte roda no CI bloqueante para os seis adapters; ativar um provider exige entrada de evidência no STATUS.
**Fora do escopo / cuidados:** contas de teste são do cliente (PENDENTE cliente); sem conta, o adapter fica inativo — não simular com mocks e declarar "verificado".

### M5-04 — Quiz simples como Lesson

**Dependências:** M2-02, M3-04 · **Estado:** `not_started`

**Objetivo:** aula do tipo quiz com questões de escolha única ou múltipla, nota mínima e tentativas; o resultado é calculado só no servidor.
**Passos:**
1. Modelo: quiz (nota mínima %, tentativas máximas — **ilimitadas por padrão**, máximo opcional; feedback `imediato|só nota`; embaralhar opcional), questões (enunciado, opções, correta(s), pontos).
2. Pontuação: acerto total por questão (sem crédito parcial; regra documentada no código e testada); aprovado se `nota ≥ mínima`.
3. Tentativa: `quiz_attempts` com número sequencial protegido por `UNIQUE(user, quiz, n)` e lock; guarda **cópia das questões e respostas** daquela tentativa (editar o quiz depois não reescreve o histórico). Respostas corretas só saem depois da submissão e conforme o tipo de feedback.
4. Aprovação conclui a Lesson de forma idempotente; quiz **obrigatório** conta para conclusão do curso e para certificado; opcional não conta (regra do M3).
5. UI do aluno acessível (teclado, rótulos) e UI do Course Builder; submissão exige conexão (offline recusa, M8 respeita).
**Testes:** nota exatamente no limite; tentativas concorrentes no limite máximo; embaralhamento determinístico por tentativa; resposta adulterada/id de opção de outra questão; aluno sem acesso/aula bloqueada; Staff em prévia não grava; quiz editado após tentativas; submissão offline.
**Aceite:** não há como forjar nota pelo cliente; aprovação reflete no progresso e na conclusão.
**Fora do escopo / cuidados:** sem cronômetro, proctoring, correção manual, banco de questões ou crédito parcial.

### M5-05 — Discussões mínimas por aula

**Dependências:** M2-02, M1-03 · **Estado:** `not_started`

**Objetivo:** o aluno pergunta na aula; a Staff responde e modera; assíncrono, sem tempo real.
**Passos:**
1. Modelo: `discussion_posts` (lesson estável, autor, texto simples, estado `visible|hidden|deleted`) com **um nível** de resposta (resposta não tem resposta); `discussion_reports` (denúncia por pessoa, única por post).
2. Acesso: só quem tem direito efetivo e a aula liberada (drip/sequência) lê e escreve; Staff com grant "moderar discussões" oculta/restaura/exclui e responde, com motivo e auditoria; autor edita/exclui o próprio post.
3. Aviso fixo acima do campo: é proibido incluir dados identificáveis de pacientes. Botão "Denunciar" (limite por pessoa) alimenta fila de moderação da Staff.
4. Render como texto escapado (sem HTML/Markdown); limite de tamanho e de frequência.
**Testes:** aula retirada do currículo (posts preservados, ocultos); acesso cruzado direto pela API (outro curso/sem matrícula/expirado); XSS em texto e nome; moderação sem grant (403); resposta a resposta rejeitada; denúncia duplicada; prévia de Staff não cria post.
**Aceite:** aluno pergunta e Staff responde com contexto da aula; moderação auditada.
**Fora do escopo / cuidados:** sem DM, tempo real, ranking, curtidas, menções; notificação por e-mail de resposta fica **adiada**; nome exibido: só nome de exibição do Profile, nunca e-mail.

### M5-06 — CourseInterest e notificação por abertura

**Dependências:** M2-01, M4-04, M3-01 · **Estado:** `not_started`

**Objetivo:** usuária autenticada registra interesse num curso ainda não adquirível e recebe **um** e-mail a cada abertura de vendas, até retirar o interesse ou comprar.
**Passos:**
1. Modelo: `course_interests` (`UNIQUE(course, user)`, estados `active|withdrawn|converted`) e `course_availability_cycles` (um por abertura relevante).
2. Função transacional `openAvailabilityCycleIfNeeded(tx, courseId)` chamada pelos comandos de M2 (publicar/abrir/fechar vendas, adicionar Offer): cria ciclo só na transição não-adquirível → adquirível; acrescentar Offer a curso já adquirível **não** cria ciclo.
3. Fan-out: para cada interesse `active` elegível, `enqueueIntent` `course-available` com `dedupe_key = interesse+ciclo` (UNIQUE), em lotes; a cota do Resend é tratada pelo M4-08.
4. `converted` quando o direito efetivo é criado (M3/M6); interesse só pode ser criado se não há Offer adquirível e a pessoa não tem direito efetivo.
5. Contagens por curso/ciclo para a Staff (sem lista de e-mails exportável).
**Testes:** fechar e reabrir (2 e-mails, um por ciclo); duas execuções concorrentes do mesmo ciclo; Offer nova em curso já aberto; retirar interesse antes do envio; 150 interesses com cota de 100/dia.
**Aceite:** no máximo uma mensagem por (interesse, ciclo); repete a cada reabertura.
**Fora do escopo / cuidados:** leads externos/landing não criam User nem interesse; aviso solicitado não exige consentimento de marketing; sem descadastro por token (retirar na conta).

### M5-07 — Uploads em R2, validação de bytes e Images Free com fallback

**Dependências:** M2-03, M0-03, M1-03 (spike M0-16) · **Estado:** `not_started`

**Objetivo:** capas/banners públicos e documentos privados enviados direto ao R2 com segurança, entrega barata e sem quebrar quando a cota de transformação acabar.
**Passos:**
1. Navegador recorta/converte e envia **só o master editado**. `POST /api/media/intents` (propósito, tipo, tamanho) cria `media_assets` em `pending_upload` com chave opaca e devolve PUT pré-assinado curto (validade de poucos minutos, `Content-Type` e tamanho assinados). SigV4 com WebCrypto ou biblioteca mínima justificada no PR.
2. `POST /api/media/:id/confirm`: `HEAD` do objeto, confere tamanho e dono, lê os primeiros bytes (assinatura mágica real), lê dimensões do cabeçalho **antes** de qualquer decodificação e rejeita acima do limite do propósito; só então `ready`. "200 no PUT" não publica nada.
3. Públicos (capa, banner): publicar = copiar para o bucket público e **só depois** atualizar o ponteiro. Privados (material de aula, ativos do certificado): GET assinado curto após autorização, `Cache-Control: private`, `Content-Disposition: attachment` para documentos; allowlist de tipos.
4. Entrega pública com variantes semânticas fixas (Images Free, 5.000 transformações únicas/mês); largura arbitrária recusada; falha/limite → `<img>` cai para o master estático.
5. Referências contadas na mesma transação que muda o ponteiro; limpeza em job (M4-03) de uploads incompletos >24 h e de objetos com zero referência >24 h, relendo a contagem sob lock.
**Testes:** MIME/extensão forjados; arquivo de bytes errados com `Content-Type` certo; imagem gigante; path traversal na chave; PUT sem confirmar; fallback quando a transformação falha; corrida referência × limpeza; URL assinada expirada; aluno de outro curso baixa o PDF (403).
**Aceite:** imagem publicada aparece e cai no fallback sem erro visível; documento privado só baixa autorizado.
**Fora do escopo / cuidados:** sem Images Hosted/Direct Creator Upload; sem guardar original da câmera; domínio público do bucket e comportamento de limite: PENDENTE (spike 7). Limites de tamanho de partida do legado: banner 4:1 (1680×420) até 5 MiB; confirmar.

### M5-08 — Adapter JMVStream

**Dependências:** M5-03 · **Estado:** `not_started`

**Objetivo:** reproduzir e (se a conta permitir) enviar vídeo pela JMVStream, o provider atual do legado.
**Passos:**
1. Cliente da API: `POST /v2/authenticate` devolve JWT de ~4 h (renovar sob demanda, nunca persistir o JWT); listar/consultar vídeo e status (`COMPLETED|CONVERTING|ERROR|AWAIT_CONVERSION`). A doc não lista webhooks: atualizar status por consulta (botão da Staff + job do Cron), não por polling contínuo.
2. Embed restrito ao host JMV na allowlist e à restrição de domínio da conta.
3. Eventos do player via `postMessage`: `timeupdate` e `ended` **não confirmados na doc** — o spike M0-13 decide. Se `ended` não for provado, `reportsEnded=false` (sem autoavanço).
4. Upload gerenciado S3 multipart pré-assinado (até 5 TB), **somente** se o plano do cliente expõe API (listada no plano Full) e o teste real passar; senão, `referenced`.
**Testes:** fixtures de status/erro; token expirado renova; domínio não autorizado; contrato do M5-03; checklist real com conta do cliente.
**Aceite:** com conta real, aula toca, reporta o que a capability declara e conclui a 90%; evidência no STATUS.
**Fora do escopo / cuidados:** plano contratado e permissões de API: PENDENTE (cliente). Banda "ilimitada" sem cláusula escrita é risco contratual, não garantia.

### M5-09 — Adapter Cloudflare Stream

**Dependências:** M5-03 · **Estado:** `not_started`

**Objetivo:** reproduzir/enviar vídeo pelo Cloudflare Stream da conta do cliente.
**Passos:**
1. Conexão com credenciais de API da conta; criar upload direto (managed) e consultar estado de processamento.
2. Reprodução assinada: `requireSignedURLs` + signing key; gerar o token **localmente** (WebCrypto) com `exp` curto e `allowedOrigins` do Hub.
3. Player SDK do Stream: `timeupdate`, `seeking/seeked`, `ratechange`, `ended`, `durationchange`; `currentTime` inteiro (suficiente para 90%). Capabilities completas.
4. Excluir só asset `managed`; asset `referenced` nunca é apagado.
**Testes:** token expirado/origem inválida; vídeo ainda processando; contrato do M5-03; checklist real.
**Aceite:** upload→processamento→reprodução assinada→conclusão a 90% com conta real.
**Fora do escopo / cuidados:** o Stream é cobrado à parte do Workers Paid (custo do cliente, por minuto armazenado/entregue); legendas por IA fora da v1; sem DRM.

### M5-10 — Adapter Mux

**Dependências:** M5-03 · **Estado:** `not_started`

**Objetivo:** reproduzir/enviar vídeo pelo Mux do cliente.
**Passos:**
1. Conexão com token de acesso; upload direto (managed) e webhook/consulta de "asset pronto" (se webhook, autenticado e via inbox do M4-01).
2. Reprodução assinada com JWT RS256 gerado localmente (WebCrypto); o `exp` **deve exceder a duração** do vídeo; restrição de domínio/referrer.
3. Mux Player/eventos idênticos ao `HTMLMediaElement` (`timeupdate`, `seeked`, `ratechange`, `ended`); duração via API.
**Testes:** `exp` menor que a duração (rejeitar na construção do token); chave privada nunca sai do servidor; webhook duplicado; contrato do M5-03; checklist real.
**Aceite:** upload→pronto→reprodução assinada→conclusão a 90% com conta real.
**Fora do escopo / cuidados:** DRM (Widevine/FairPlay) fora da v1; custo por minuto é do cliente.

### M5-11 — Adapter Panda Video

**Dependências:** M5-03 · **Estado:** `not_started`

**Objetivo:** reproduzir/enviar vídeo pela Panda do cliente.
**Passos:**
1. Conexão com chave de API; upload (TUS ou URL) se a capability for confirmada; status por webhook (via inbox) ou consulta.
2. Eventos `window.postMessage` (`panda_timeupdate`, `panda_seeked`, `panda_ended`, `panda_speed_update`, `panda_error`); o exemplo oficial **não** valida origem — o adapter valida `origin` e `source`.
3. `panda_ended` **não dispara com autoplay ligado**: embed sempre com autoplay desligado; se mesmo assim `ended` não chegar no teste, `reportsEnded=false`.
4. Proteção por domínios permitidos configurada na conta (contornável; sem prometer DRM).
**Testes:** mensagem de origem falsa ignorada; autoplay desligado verificado na URL; contrato do M5-03; checklist real.
**Aceite:** reprodução e conclusão a 90% com conta real; capabilities reportadas corretamente.
**Fora do escopo / cuidados:** moeda/valor do plano e excedente de banda: PENDENTE (cliente); recursos de IA (quiz/legendas) ignorados.

### M5-12 — Adapter Vimeo

**Dependências:** M5-03 · **Estado:** `not_started`

**Objetivo:** reproduzir vídeo hospedado no Vimeo do cliente (somente referenciado).
**Passos:**
1. Entrada por URL/ID do Vimeo, normalizada e validada; metadados (duração, disponibilidade) por oEmbed ou API conforme o que a conta permitir.
2. Player.js oficial: `timeupdate` (~250 ms), `seeked`, `playbackratechange`, `ended` (não dispara com `loop`: embed sem loop), `durationchange`.
3. Privacidade por restrição de domínio da conta; vídeo sem permissão de embed mostra erro claro à Staff.
**Testes:** URL maliciosa/host diferente rejeitado; vídeo privado sem permissão; `ended` com loop desligado; contrato do M5-03; checklist real.
**Aceite:** reprodução e conclusão a 90% com conta real.
**Fora do escopo / cuidados:** sem upload gerenciado; `getPlayed()` fora do contrato; limite de banda (2 TB/mês no plano Core, com risco de suspensão) e planos em reorganização: avisar o cliente (PENDENTE cliente).

### M5-13 — Adapter YouTube (com aviso para a Staff em curso pago)

**Dependências:** M5-03 · **Estado:** `not_started`

**Objetivo:** permitir YouTube como provider, inclusive em curso pago, com risco aceito pelo responsável e visível à Staff.
**Passos:**
1. Entrada por URL/ID normalizada; embed `youtube-nocookie` com allowlist; IFrame API.
2. Sem evento `timeupdate`: polling de `getCurrentTime()` (respeitar aba oculta/throttling; heartbeat do M5-02); seek **inferido** por salto de posição; `onStateChange` `ENDED=0` → `ended`; `onPlaybackRateChange`. Duração do player (`getDuration`), sob a regra de M5-02.
3. Aviso na UI da Staff **ao anexar** YouTube a curso com Offer paga **e** ao criar/publicar Offer paga num curso que já tenha aula YouTube (gancho consumido pelo M6-01): texto claro de que os termos do YouTube proíbem cobrar pelo conteúdo no player embutido e que o link do vídeo pode vazar. É aviso, não bloqueio.
4. Não modificar nem esconder partes do player; nada em segundo plano.
**Testes:** polling com aba oculta; seek por salto; `ended`; ID inválido/host estranho; aviso aparece nos dois caminhos; contrato do M5-03.
**Aceite:** aula YouTube conclui a 90%; aviso presente; evidência registrada.
**Fora do escopo / cuidados:** risco aceito (Q41); ciência do cliente recomendada (PENDENTE cliente); vídeo removido/privado vira estado `unavailable` para a Staff.

### M5-14 — Ajuda, FAQ e pedido de suporte por e-mail

**Dependências:** M4-04, M2-03, M1-03 · **Estado:** `not_started`

**Objetivo:** uma única entrada "Ajuda" com FAQ editável e formulário que envia o pedido ao suporte por e-mail.
**Passos:**
1. FAQ: itens (categoria, pergunta, resposta em Tiptap JSON com render por allowlist, ordem por botões acessíveis, publicado/rascunho); edição exige o grant "editar FAQ/Ajuda".
2. Formulário (login obrigatório): categoria, mensagem com limite de tamanho, contexto opcional (curso/aula); aviso para não enviar dados de pacientes; limite de 3 pedidos a cada 10 minutos por pessoa.
3. Grava `support_requests` e `enqueueIntent` `support-request` para o endereço de suporte (configuração; PENDENTE cliente) com `replyTo` = e-mail da pessoa (validado, sem injeção de cabeçalho). Resposta humana acontece fora do Hub (sem helpdesk).
4. A tela de login e a Ajuda mostram o endereço de suporte para quem não consegue entrar. A Ajuda traz o texto de como pedir desistência/exclusão/dados/troca de e-mail **por e-mail ao suporte** (texto jurídico: PENDENTE advogado).
**Testes:** limite de frequência; e-mail com quebra de linha no `replyTo`; XSS no FAQ e no pedido; pedido sem login (401); Suporte sem grant não edita FAQ; falha do Resend não perde o pedido.
**Aceite:** pedido chega ao suporte em Staging com `replyTo` correto; FAQ publicado aparece ao aluno.
**Fora do escopo / cuidados:** sem busca/chatbot, sem processo automatizado de exclusão/desistência; retenção do texto dos pedidos: PENDENTE (advogado).

### M5-15 — Banners do painel e mídia da tela de login

**Dependências:** M5-07, M2-03 · **Estado:** `not_started`

**Objetivo:** Staff publica banners no painel do aluno e imagens na tela de acesso, sem violar acessibilidade.
**Passos:**
1. Banners (proporção/limites de M5-07), texto alternativo obrigatório, link só interno ou `https` em allowlist, janela de exibição opcional; ordem por botões; publicar objeto **antes** do ponteiro.
2. Mídia de login: até 5 imagens decorativas com fallback estático padrão; não carrega em telas pequenas.
3. **Nenhum conteúdo se move sozinho por mais de 5 s sem controle de pausa** (WCAG 2.2.2): por padrão sem rotação automática, navegação manual; se houver rotação, botão pausar/retomar visível e operável por teclado, e a rotação para sozinha após um ciclo.
4. Permissão: padrão só Admin; confirmar o grant com M1 (PENDENTE: o catálogo atual não cita banners).
**Testes:** link `javascript:`/host estranho rejeitado; imagem sem alt rejeitada; banner apontando para objeto ainda não publicado nunca aparece; teste automatizado de que não há animação sem botão de pausa; fallback quando a mídia falha.
**Aceite:** banner e mídia aparecem em Staging e passam na verificação de acessibilidade do item 3.
**Fora do escopo / cuidados:** sem `prefers-reduced-motion` (decisão do registro, Q48), mas a restrição de 5 s/pausa permanece; copy editorial por slide é lacuna do legado (PENDENTE cliente).
