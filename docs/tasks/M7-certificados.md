# M7 — Certificados

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega.** Quem conclui um curso recebe, de forma assíncrona e sem duplicidade, um certificado em PDF imutável (HTML/CSS controlado, renderizado pelo Browser Run Quick Action `/pdf`, guardado no R2 privado com SHA-256), com código opaco, página pública mínima de validação, revogação (só Admin), reemissão (por grant) e editor visual A4 para o Admin (mantido por decisão do responsável, Q15, como exceção à regra de corte). **Gate de aceite:** (1) PDF gerado no Browser Run **real** em Staging, com hash conferido; (2) paridade prévia↔PDF comprovada (M7-09); (3) as provas adversariais abaixo passam (duas conclusões simultâneas, revogação durante download, objeto adulterado, enumeração de códigos); (4) nenhum dado além do permitido aparece na página pública. Sem o gate de paridade, a emissão não vai para Production.

**Pendências deste marco (não inventar):** PENDENTE (modelagem) se a página pública mostra o nome da pessoa e em que momento o nome é confirmado (M7-07, M7-08); PENDENTE (advogado do cliente) retenção de 90 dias do PDF revogado e transferência internacional do PDF para o R2 (M7-05); PENDENTE (spike M0-15: Browser Run PDF com Lexend Deca) sintaxe exata das opções, tolerância de paridade e comportamento de bloqueio de rede.

**Notas de IDs.** M7-01..M7-05 mantidos. A parte "página pública" do antigo M7-04 virou M7-08 (tarefa própria, por causa da lacuna do nome); o antigo PoC do renderer foi fundido com o renderer de produção em M7-02 (não há PoC descartável). Novos: M7-06 (emitente/assinatura), M7-07 (nome do certificado), M7-08 (página pública), M7-09 (gate de paridade).

Ordem sugerida: M7-01 → M7-06 → M7-02 → M7-07 → M7-03 → M7-09 → M7-04 → M7-08 → M7-05.

---

### M7-01 — Domínio Certificate e CourseCompletion → intenção única de emissão

**Dependências:** M3-04 (CourseCompletion), M4-01 (outbox), M5-04 (quiz obrigatório compõe a conclusão) · **Estado:** `implemented` (2026-10-14; sem renderer e sem tela; a política não exige template porque o M7-03 não existe; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** A primeira conclusão elegível de (pessoa, curso) cria **uma** intenção de emissão na mesma transação; falha de PDF nunca remove a conclusão nem duplica o certificado.

**Passos**
1. Migration SQL (revisada à mão): `certificate` (id, user_id, course_id, completion_id **UNIQUE**, `code` UNIQUE, status `awaiting_name|queued|rendering|ready|failed|revoked|superseded`, `snapshot` jsonb tipado, `pdf_key`, `pdf_sha256`, `predecessor_id`, timestamps). Código = 16 bytes CSPRNG em Base64URL (22 caracteres), sem prefixo.
2. Na transação que insere `CourseCompletion` com `INSERT … ON CONFLICT DO NOTHING RETURNING`: só o **vencedor** do insert cria o `certificate` e a linha de outbox `certificate.render` (dedupe `certificate:<id>`). Nenhuma chamada externa dentro da transação.
3. Elegibilidade: curso com certificado habilitado e template publicado (M7-03). Sem política, a conclusão existe e nada é criado; Admin pode "emitir pendentes" em lote depois (comando explícito, não backfill silencioso).
4. O `snapshot` (nome confirmado, título, carga horária, datas, emitente, signatário, layout) congela quando o estado passa a `queued` (depois de M7-07) e nunca mais muda.
5. Consumer idempotente com claim por lease e fencing (padrão do M4-01); estado `failed` permite nova tentativa sem criar outro certificado.

**Testes.** PG18 real: duas conclusões simultâneas da última Lesson → 1 CourseCompletion, 1 certificate, 1 outbox; mesma mensagem processada 2×; política desabilitada; curso sem aulas obrigatórias nunca conclui; quiz obrigatório pendente impede conclusão; acesso expirado depois da conclusão não apaga o certificado; falha do renderer deixa `failed` e a conclusão intacta.

**Aceite.** Constraints de banco garantem unicidade (não só código); testes acima verdes em PG18; nenhuma tabela guarda PNG/preview.

**Fora do escopo / cuidados.** Reembolso **não** revoga certificado (ver M7-04). Não usar Queue como fonte da verdade; não reaproveitar código de certificado.

---

### M7-02 — Renderer HTML/CSS → Browser Run `/pdf` → R2 privado + SHA-256

**Dependências:** M7-01, M5-07 (R2 privado), M0-15 (spike Browser Run) · **Estado:** `implemented` (2026-10-15; renderer de produção com Browser Run e R2 testado só com um Browser Run FALSO; o aceite com o PDF real em Staging segue PENDENTE; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** Gerar o PDF A4 a partir de HTML/CSS controlado e guardá-lo como evidência imutável com hash.

**Passos**
1. Função pura `renderCertificateHtml(snapshot) → string`: A4 paisagem (`@page`), **todo** dado escapado por uma única função, sem JS, sem `<img>`/`<link>` remotos, QR gerado localmente (SVG).
2. Fonte **Lexend Deca** versionada no repositório (conferir licença) e embutida em base64 no `@font-face`; assinatura lida do R2 **privado** pelo Worker e embutida como data URI (nunca URL pública).
3. Chamar `env.BROWSER.quickAction("pdf", …)` com `printBackground`, `preferCSSPageSize` e bloqueio de toda requisição externa (`rejectRequestPattern`); sintaxe exata PENDENTE (spike M0-15).
4. Validar a resposta (começa com `%PDF-`, 1 página, tamanho máximo), calcular SHA-256 no Worker e gravar em `certificates/<id>/<sha256>.pdf` com PUT condicional `If-None-Match: *`; só então marcar `ready` (fencing; commit depois do PUT).
5. Erros classificados: transitório (backoff via outbox) × definitivo (`failed` + alerta). Sem fallback automático para outro renderizador.

**Testes.** Nome com acentos/ç/ã, 80+ caracteres e apóstrofo; injeção (`<script>`, `</style>`, `"onload=`); HTML com `<img src="http://…">` **não** dispara requisição (verificar em Browser Run real, em Staging); timeout; resposta não-PDF; crash depois do PUT e antes do commit → retry adota o objeto existente se o hash coincidir (412 tratado); lease perdida → commit antigo rejeitado; Browser Run fora do ar → `failed` sem efeito colateral.

**Aceite.** PDF real em Staging: 1 página A4 paisagem, texto selecionável, Lexend Deca embutida (checar com `pdffonts`), hash recalculado do objeto == hash gravado; objeto inacessível sem rota autorizada. Registrar horas de Browser Run consumidas (franquia Paid: 10 h/mês; acima, cobrança por hora → custo a monitorar).

**Fora do escopo / cuidados.** Nunca regenerar um PDF "para conferir" (bytes mudam); a conferência é re-hash do objeto. Mock não prova nada: o teste que vale roda com o binding real. `pdf-lib`/Gotenberg só por decisão explícita futura.

---

### M7-03 — Editor visual de template A4 (mantido)

**Dependências:** M7-02, M7-06, M0-07 (base visual) · **Estado:** `implemented` (2026-10-14; sem a prévia em PDF real e com a prévia da tela em DOM, não em iframe; evidência e desvios em `docs/implementation/STATUS.md`)

**Objetivo.** O Admin posiciona campos pré-definidos sobre um fundo A4 com ponteiro **e** teclado, e publica o template do curso.

**Passos**
1. Tabela `certificate_template` (course_id, `draft|published|superseded`, `layout` jsonb validado por Zod, `background_key`, versão otimista). Um `published` e no máximo um `draft` por curso. Só Admin cria, edita e publica.
2. Campos fixos (lista inicial herdada do legado, confirmar na modelagem): nome, título do curso, carga horária, data de conclusão, data de emissão, emitente, CNPJ, signatário, cargo, assinatura, código, QR. Cada um com x/y/largura/altura em mm, fonte (allowlist: Lexend Deca), tamanho, cor, alinhamento. Sem campos livres nem HTML.
3. Tela: página A4 em escala; ponteiro (arrastar/redimensionar) e teclado (selecionar campo → setas movem 1 mm; Shift+setas 5 mm; Alt+setas redimensionam) mais painel numérico (alternativa a arrastar, WCAG 2.5.7); foco visível; desfazer/refazer; avisos de sobreposição e de **overflow** medidos com o nome mais longo.
4. Fundo A4 pelo pipeline R2 (M5-07) com o componente único de crop (preset A4 paisagem), privado.
5. Prévia = **a mesma** `renderCertificateHtml` (M7-02) em iframe `sandbox` sem scripts, com dados de exemplo; "Prévia em PDF" chama o renderer real, só Admin, com rate limit.
6. Publicar valida o layout no servidor (campos obrigatórios presentes, dentro da página) e congela; certificados já emitidos mantêm o snapshot antigo.

**Testes.** Playwright: fluxo completo só com teclado e só com ponteiro/toque; axe; layout inválido (fora da página, NaN, campo duplicado) rejeitado no servidor; Suporte chamando a API direto → 403; dois Admins no mesmo rascunho (conflito de versão); publicar não altera certificados emitidos.

**Aceite.** Admin publica um template válido por teclado e por ponteiro; M7-09 verde com esse template.

**Fora do escopo / cuidados.** Não é Figma/Canva; sem histórico ilimitado de versões; sem HTML/CSS livre. Em telas estreitas o editor pode ficar somente leitura (proposta; confirmar). Escopo mínimo: se estourar, cortar recursos do editor antes de cortar o gate de paridade.

---

### M7-04 — Emissão, entrega ao aluno, revogação (Admin) e reemissão (grant)

**Dependências:** M7-02, M7-07, M4-04 (e-mail), M1-05 (reautenticação recente), M6-05 (reembolso) · **Estado:** `implemented` (2026-10-14; sem PDF real: o objeto do download é de teste; a dependência do M7-07 foi contornada usando o nome do perfil, o nome confirmado ficou para o M7-07; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** Ciclo de vida completo do certificado com autorização no servidor e cópia antiga nunca alterada.

**Passos**
1. Ao chegar a `ready`: outbox de e-mail "certificado emitido" (Hosted Template, M4-04). Falha de e-mail não muda o certificado.
2. Download do aluno: rota autenticada, só dono e `ready`; stream pelo Worker com `Cache-Control: private, no-store` (sem URL pré-assinada reutilizável); recalcula o SHA-256 e recusa se divergir (alerta).
3. **Revogar: só Admin**, com reautenticação recente (novo magic link), categoria padronizada + nota interna, em transação; novos downloads falham na hora; auditoria.
4. **Reemitir: grant** `certificate.reissue` (Suporte). Cria certificado novo (código novo, nome atual confirmado, template publicado vigente), marca o anterior `superseded`, lock por (pessoa, curso); só o mais recente é reemitível; auditoria com motivo.
5. Reembolso (M6-05) **não** revoga e o M6 não chama o M7: o registro "acesso reembolsado em <data>" gravado pelo M6 é exibido à Staff junto do certificado.
6. Tela Staff: certificados por pessoa, `failed`/`awaiting_name` antigos e "tentar de novo" (grant da fila operacional).

**Testes.** Revogar durante download/prévia (novos acessos falham, snapshot intacto); Suporte chamando revogar direto → 403; reemissão concorrente → 1 novo; código nunca reutilizado; objeto R2 adulterado → download falha com alerta; e-mail não reenviado em reprocessamento; reembolso mantém certificado válido.

**Aceite.** Matriz de permissões (Admin / Suporte com grant / Suporte sem grant / aluno dono / terceiro) verde por chamada direta de API.

**Fora do escopo / cuidados.** Sem edição do PDF; sem revogação por Suporte; sem refund parcial. Reemissão não "corrige" o PDF antigo: ele fica inválido.

---

### M7-05 — Retenção de 90 dias do PDF revogado (CONDICIONAL) e purge com tombstone

**Dependências:** M7-04, M4-03 (cron/reconciler), parecer do advogado do cliente · **Estado:** `not_started`

**Objetivo.** Eliminar o PDF revogado depois do prazo aprovado, mantendo só o mínimo para a página pública continuar respondendo "revogado".

**Passos**
1. **Pré-condição:** parecer do advogado do cliente registrado (prazo, base legal, transferência internacional do PDF para o R2, sem região na América do Sul). Valor proposto: 90 dias; configurável (`REVOKED_PDF_RETENTION_DAYS`). Sem parecer, o gate Go/No-Go (M10-01) bloqueia Production.
2. Ao revogar, gravar `revoked_at` e o **tombstone mínimo** permanente (hash do código, status, `revoked_at`, SHA-256 do PDF). Tombstone antes, exclusão depois.
3. Job de purge (cron/outbox, idempotente, com retry): em `revoked_at + prazo`, apaga o objeto R2, zera `pdf_key` e remove do snapshot o que é dado pessoal.
4. R2: lifecycle conta a idade desde a criação do objeto, não desde a revogação → ao revogar, copiar para o prefixo `revoked/` e aplicar lifecycle nele; bucket lock tem precedência sobre lifecycle. O job é o mecanismo primário; lifecycle/lock são rede de segurança. PENDENTE (verificar em Staging).
5. Registrar a eliminação em log durável fora do banco também (reexecutável após restauração, ver M9-05).

**Testes.** Erro do R2 + reexecução; fuso/UTC; purge antes do prazo bloqueado; revogado purgado → download 404/410 e página pública ainda "revogado"; certificado reemitido não é purgado junto; restaurar dump anterior ao purge → purge reexecuta.

**Aceite.** Depois do prazo, o objeto não existe mais e a validação pública responde corretamente, sem revalidação indevida.

**Fora do escopo / cuidados.** O prazo é decisão jurídica, não do desenvolvedor. Não apagar tombstone. Não aplicar a certificados válidos.

---

### M7-06 — Emitente, signatário e assinatura privada

**Dependências:** M7-01, M5-07, M1-03 · **Estado:** `implemented` (2026-10-14; R2 real NÃO exercitado; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** Admin cadastra o emitente (razão social, CNPJ) e, por curso, signatário (nome, cargo, imagem de assinatura) sem que a assinatura vaze.

**Passos**
1. Tabelas `certificate_issuer` (global) e dados de signatário por curso (sem fallback global, como no legado após a emenda de 2026-09-24; confirmar na modelagem). Só Admin edita.
2. Validar CNPJ pelos dígitos verificadores; normalizar texto (NFC).
3. Assinatura: upload pelo pipeline R2 (master editado no navegador, bytes validados), **privado**; só o renderer (servidor) a lê; a UI do Admin a exibe por rota autorizada.
4. Entrada no `snapshot` no momento da emissão (M7-01).

**Testes.** Suporte sem acesso (403); URL da assinatura nunca em resposta pública nem em HTML da página de validação; CNPJ inválido; imagem forjada (MIME falso) rejeitada; trocar o signatário não altera snapshots emitidos.

**Aceite.** Emitente e signatário aparecem no PDF de teste; a imagem de assinatura não é alcançável sem sessão Admin.

**Fora do escopo / cuidados.** Sem assinatura ICP-Brasil (não exigida para curso livre); o certificado não diz "reconhecido pelo MEC".

---

### M7-07 — Nome do certificado confirmado antes da 1ª emissão

**Dependências:** M7-01, M1-02 (Profile com `displayName`/`certificateName`) · **Estado:** `not_started` — **PENDENTE de modelagem:** momento da confirmação e se reconfirma a cada emissão. Não implementar antes da escolha do responsável.

**Objetivo.** Evitar o erro mais comum de reclamação (nome incorreto): a pessoa confirma o nome que vai no PDF **antes** de ele ser gerado.

**Passos (proposta a aprovar)**
1. Na conclusão, se `certificateNameConfirmedAt` é nulo, o certificado fica `awaiting_name`; a pessoa vê aviso no app e recebe e-mail transacional.
2. Tela de confirmação: mostra o nome, permite corrigir, exige ação explícita ("Confirmar"); ao confirmar, congela o snapshot e passa a `queued`.
3. Validação no servidor: NFC, sem caracteres de controle/zero-width/bidi, tamanho limitado e testado no layout (M7-09).
4. Depois da emissão, mudar o nome só via reemissão (M7-04): o aluno edita `certificateName` no perfil (auditado) e pede reemissão por e-mail ao suporte.

**Testes.** Corrida: confirmar duas vezes; confirmar em duas abas; concluir dois cursos seguidos; nome com bidi/zero-width rejeitado; Staff não consegue editar o nome do aluno por endpoint genérico.

**Aceite.** Nenhum PDF é gerado com nome não confirmado; fluxo coberto por E2E.

**Fora do escopo / cuidados.** Sem edição genérica de User pela Staff. Alternativas ainda abertas: confirmar no primeiro acesso ao curso, ou uma vez por conta.

---

### M7-08 — Página pública mínima de validação

**Dependências:** M7-04, M2-06 (meta tags por HTMLRewriter), M0-17 (spike com validadores LinkedIn/Meta) · **Estado:** `implemented` (2026-10-15; sem nome do titular por padrão — decisão PENDENTE; nada exercitado em Staging; validadores do LinkedIn e Meta não rodaram; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** Quem tem o código confirma estado, curso, carga horária e data, sem expor dados pessoais além do decidido.

**Passos**
1. Rota `/certificados/:code` (mesmo caminho do legado), `noindex`; aceita código novo e legado `PRT-…` (M10-08).
2. DTO explícito: estado (válido/revogado/substituído), curso, carga horária, data de emissão, emitente. **Nome do titular: constante `PUBLIC_NAME_MODE = none | masked | full`, padrão `none` até decisão** (sem nome a página não prova a quem pertence; com nome é dado pessoal acessível a quem tiver o código de 128 bits). **Nunca** CPF, e-mail, pagamento, motivo interno nem link para PDF.
3. Meta tags (Open Graph) por HTMLRewriter com dados escapados; mesmo respeitando o modo do nome.
4. Rate limit com o binding do Cloudflare (permissivo, por localização) como freio; sem cache de revogação por padrão (revogação imediata). Atenção: tráfego anônimo acorda o Neon Free — reavaliar em M9-07.
5. Resposta genérica idêntica para código inexistente.

**Testes.** Enumeração (tempo e corpo iguais para códigos inválidos); revogado/substituído; tombstone após purge mostra "revogado"; 429 no excesso; teste de contrato do DTO (campos proibidos ausentes); HTML de meta sem injeção.

**Aceite.** Página funcional em Staging; DTO fechado por teste; decisão do nome registrada.

**Fora do escopo / cuidados.** Botão "Adicionar ao LinkedIn" e Open Badges não foram decididos (evidência: W3 §4.5); não incluir sem decisão.

---

### M7-09 — Gate de paridade prévia ↔ PDF (P-18)

**Dependências:** M7-02, M7-03 · **Estado:** PARCIAL (2026-10-15): a comparação automática de posição e conteúdo do PDF com o layout (inclusive o PDF REAL do Browser Run como fixture) está `implemented`; faltam a conferência humana do Admin, o QR lido por leitor, `pdffonts` e mais de um leitor de PDF; evidência em `docs/implementation/STATUS.md`

**Objetivo.** Provar que o que o Admin vê na prévia é o que sai no PDF; sem isso, a emissão não vai para Production.

**Passos**
1. Fixtures: nomes curto, longo, com acentos/ç/ã, apóstrofo; três layouts (padrão, denso, com fundo).
2. Job de CI com Playwright Chromium: HTML → PDF local, detectando regressão do HTML (**não** prova o Browser Run).
3. Execução em Staging com Browser Run real (manual ou workflow dedicado): extrair caixas de texto/imagens do PDF (por exemplo `pdftotext -bbox-layout`) e comparar com as caixas do layout em mm, tolerância definida pelo spike M0-15 (PENDENTE); conferir fontes embutidas, 1 página, A4.
4. Conferência humana pelo Admin: sem recorte, QR legível por leitor, texto selecionável.
5. Registrar evidência (SHA, versões, PDFs de teste sem dados reais).

**Testes.** O próprio gate; incluir caso que **deve falhar** (campo fora da página).

**Aceite.** Gate verde registrado em `STATUS.md`. Se falhar: bloquear emissão em Production; alternativa (template padrão fixo, sem editor) só com aprovação do responsável.

**Fora do escopo / cuidados.** Paridade em outros navegadores/leitores de PDF fica fora; testar ao menos dois leitores.
