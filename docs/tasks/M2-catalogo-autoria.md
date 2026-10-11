# M2 — Catálogo e autoria

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega e gate.** O Admin cria um Course com Offer (gratuita ou paga, prazo em meses, sem vitalício); a Staff autora o currículo vivo (módulos planos e aulas de texto) em **rascunho** e o publica de forma **atômica**; o aluno logado vê o catálogo; qualquer pessoa vê a página pública do curso, com meta tags corretas para compartilhamento. **Gate de aceite:** Admin cria o curso demonstrativo; Suporte **com** grant `course.edit` edita e publica e Suporte **sem** grant recebe 403 pela API; publicação concorrente e com falha no meio deixa o publicado íntegro; rascunho e curso oculto nunca aparecem a quem não é Staff; a página pública passa nos validadores do LinkedIn e do Meta (resultado a registrar, não presumir). **Pré-requisitos:** M1 concluído; ADR "passou" do M0-17 para a M2-06. Sem releases imutáveis, sem revisões por publicação, sem `curriculum_key`, sem clone de publicação.

## Ordem recomendada

M2-01 → M2-02 → M2-05 → M2-03 → M2-07 → M2-04 → M2-06.

## Regras para todas as tarefas

- Estrutura física (nomes de tabelas/colunas) é sugestão; o que vale é o comportamento. Migrations SQL revisadas, forward-only.
- Dinheiro sempre em **centavos inteiros BRL**; nunca `float`. Invariantes em `CHECK`/`UNIQUE` no banco, não só no código.
- Autorização por capability no servidor (M1-03): `course.create` e `offer.manage` só Admin; `course.edit` delegável (inclui publicar).
- Testes de persistência e concorrência em Postgres 18 real.

---

### M2-01 — Course, Offer e disponibilidade
**Dependências:** M1-03, M0-04 · **Estado:** `implemented` (verificação local; ver STATUS). Estados da Offer: `draft|active|paused|archived` (spec de domínio).
**Objetivo:** existe o cadastro de cursos e ofertas com regras comerciais corretas, e a visibilidade do curso é separada da disponibilidade de inscrição.
**Passos:**
1. Tabela `course`: id, `slug` único, título interno, `sequence_mode` (`guided|free`, escolha obrigatória, sem default), estado (`draft|published|archived`), criado por. Textos exibidos ao público ficam no conteúdo do M2-02.
2. Tabela `offer`: `course_id` (obrigatório; cada Offer pertence a **um** Course), `kind` (`free|paid`), `price_cents` (0 para gratuita, >0 para paga), moeda fixa BRL, `access_months` inteiro ≥1 (**toda** Offer tem prazo; sem vitalício), `max_installments` (1–12 sem juros; 1 se gratuita), `status` (`draft|open|paused|closed`), nome.
3. Comandos: criar Course (`course.create`), criar/editar/pausar Offer (`offer.manage`); slug só muda enquanto o curso nunca foi publicado (proposto; preserva URLs históricas).
4. DTOs separados: público/aluno (sem campos internos) e Staff.
**Testes (PG18):** `CHECK` recusa preço negativo, gratuita com preço, paga sem preço, prazo 0 ou nulo, parcelas fora de 1–12; slug duplicado falha; Suporte sem `offer.manage` recebe 403 ao editar Offer mesmo com `course.edit`; Offer pausada/encerrada não é "adquirível"; DTO público não contém campos internos.
**Aceite:** só Offer `open` de curso publicado é considerada adquirível (função única reutilizada por M3-02 e M6).
**Fora do escopo / cuidados:** sem cupom, bundle, preço promocional, vitalício, landing CMS nem moeda além de BRL. Pagamento e Order são do M6.

### M2-02 — Currículo vivo: rascunho e publicação atômica
**Dependências:** M2-01 · **Estado:** `not_started`
**Objetivo:** a Staff edita um rascunho do curso (detalhes, módulos e aulas) e o publica numa única transação; quem estuda só enxerga o publicado, e os ids de módulo e aula nunca mudam.
**Passos:**
1. Modelo sugerido: tabelas de rascunho (`course_draft`, `module_draft`, `lesson_draft`) e tabelas publicadas (`course_content`, `module`, `lesson`) com os **mesmos ids estáveis**. Módulo: título, posição, `drip_days` (inteiro ≥0, D+N). Aula: título, posição, `kind` (só `text` neste marco), `is_optional`, corpo (M2-05), `retired_at`.
2. Rascunho único por curso com contador `draft_rev` (concorrência otimista; conflito → 409 com mensagem clara).
3. `publish(courseId)`: trava a linha do curso (`FOR UPDATE`), valida o rascunho, aplica sobre as tabelas publicadas por id, **aposenta** (`retired_at`) o que saiu do rascunho em vez de apagar, incrementa `published_version` (contador simples) e grava `audit_log`. Tudo ou nada.
4. Validações de publicação: título não vazio; ≥1 módulo; todo módulo com ≥1 aula; ≥1 aula obrigatória; `drip_days` ≥0; corpo de aula válido; falha devolve a lista de problemas.
5. Reordenar e mover aula de módulo mantém os ids.
**Testes (PG18):** duas publicações simultâneas se serializam e o resultado é consistente; falha injetada no meio da publicação deixa o publicado idêntico ao anterior; leitura durante a transação aberta vê só a versão antiga; aula retirada continua com o mesmo id e some do que o aluno vê; reordenar não troca ids; edições concorrentes do rascunho geram 409; publicar sem mudanças é um no-op explícito.
**Aceite:** nenhum leitor vê estado misto; ids estáveis comprovados por teste.
**Fora do escopo / cuidados:** **não** criar `CourseRelease`, revisões imutáveis, `curriculum_key` nem clones (decisão Q32); sem histórico de versões navegável. Aulas só de texto (vídeo e quiz entram no M5 por migration de expansão). A conclusão histórica por curso é do M3-04.

### M2-05 — Conteúdo rico seguro (Tiptap JSON + renderização por allowlist)
**Dependências:** M0-07 · **Estado:** `not_started`
**Objetivo:** aulas e descrições usam texto rico guardado como JSON validado e exibido por um renderizador React que só conhece nós permitidos.
**Passos:**
1. Esquema Zod da allowlist: parágrafo, títulos 2–3, listas, citação, quebra de linha; marcas negrito/itálico; link com `http`, `https` ou `mailto`. Limites de tamanho e profundidade (proposto: 100 KB).
2. Validação **no servidor** em todo comando que grava conteúdo; nó, marca ou atributo desconhecido é rejeitado.
3. Componente `RichTextView` que monta elementos React a partir do JSON (sem HTML em string); links externos com `rel="noopener noreferrer nofollow"`.
4. Componente de edição Tiptap restrito às mesmas extensões.
**Testes:** `<script>` e `onerror` em texto aparecem como texto; link `javascript:` rejeitado; nó desconhecido e conteúdo grande rejeitados; ida e volta editor → JSON → visualização estável; corpus de XSS conhecido sem execução.
**Aceite:** nenhuma rota grava conteúdo sem passar pela validação.
**Fora do escopo / cuidados:** sem imagens, embeds, iframes, HTML livre nem editor estilo Notion; mídia só no M5.

### M2-03 — Course Builder mínimo (Staff)
**Dependências:** M2-02, M2-05, M1-10 · **Estado:** `not_started`
**Objetivo:** o Admin cria cursos e ofertas; o Suporte com grant edita o currículo e publica, tudo pela interface e com autorização no servidor.
**Passos:**
1. Telas: lista de cursos (somente leitura para quem não tem grant); criar curso e Offer (Admin); editor com abas Detalhes, Currículo e Oferta (aba visível só ao Admin); publicar com resumo do que muda (adicionadas, alteradas, aposentadas) e **pré-visualização do rascunho** com o mesmo renderizador.
2. React Hook Form + Zod; erros de validação do servidor mapeados por campo.
3. Salvar explícito, aviso de alterações não salvas ao sair (bloqueio do roteador) e tratamento do 409.
4. Reordenação por **botões** acessíveis (subir/descer) com anúncio por `aria-live`.
**Testes (Playwright + API direta):** Admin cria curso → Suporte com `course.edit` edita e publica; Suporte sem grant recebe 403 em toda escrita; Suporte com `course.edit` mas sem `offer.manage` não altera Offer; erro de servidor aparece no campo; axe e teclado nas telas; XSS no título não executa.
**Aceite:** curso básico é criado, publicado e aparece na lista por quem de direito.
**Fora do escopo / cuidados:** sem arrastar-e-soltar obrigatório, sem editor visual, sem importação em lote; preço e disponibilidade só Admin; sem confiar em campo escondido na UI.

### M2-07 — Curso demonstrativo (seed e fixtures)
**Dependências:** M2-02 · **Estado:** `not_started`
**Objetivo:** um comando cria, de forma repetível, um curso gratuito sintético usado nos testes e na jornada do M3.
**Passos:**
1. `scripts/seed-demo.ts` cria o curso "Curso Demonstrativo" (guiado), Offer gratuita de 3 meses e 3 módulos (D+0, D+7, D+14) com aulas de texto, uma opcional; publica pelas funções de domínio.
2. O script recusa rodar contra Production (confere o ambiente e o nome do banco).
3. Helper de fixtures para testes de integração com os mesmos dados.
**Testes:** rodar duas vezes não duplica; recusa em ambiente Production; conteúdo publicado passa pelas validações do M2-02.
**Aceite:** Dev e Staging têm o curso demonstrativo após o comando.
**Fora do escopo / cuidados:** só dados sintéticos; nada de conteúdo real nem de e-mails reais.

### M2-04 — Catálogo do aluno
**Dependências:** M2-01, M2-02, M0-07 · **Estado:** `not_started`
**Objetivo:** a pessoa logada vê os cursos visíveis, com resumo da oferta e estado (inscrições abertas ou encerradas).
**Passos:**
1. `GET /api/catalog/courses` (autenticado): só cursos publicados e visíveis; por curso, título, resumo e resumo da Offer aberta (gratuito/preço, prazo em meses). Sem vitrine pública em lista.
2. Tela `/cursos` com busca e filtro por `search params` tipados (Zod) no TanStack Router; estados de carregando, vazio e erro.
3. Cache do cliente só para dados não sensíveis, com `staleTime` curto.
**Testes:** sem sessão → 401; rascunho, arquivado e curso nunca publicado não aparecem; Offer pausada/encerrada mostra "inscrições encerradas" sem ação; resposta não contém campos internos; Playwright dos três estados de UI.
**Aceite:** visitante logado vê apenas o que é publicável.
**Fora do escopo / cuidados:** botão "Inscrever-se" é do M3-02; "tenho interesse" (CourseInterest) é do M5; sem otimismo de UI para permissão.

### M2-06 — Página pública do curso com meta tags (HTMLRewriter)
**Dependências:** M2-02, M2-01, M0-17 · **Estado:** `not_started`
**Objetivo:** `/cursos/:slug` abre para qualquer pessoa e compartilha com título, descrição e imagem corretos nas redes.
**Passos:**
1. Incluir o caminho em `run_worker_first`. O Worker busca o `index.html` nos assets e reescreve `title`, `description`, `og:*`, `twitter:*` e `canonical` com `HTMLRewriter`, a partir do curso **publicado**; URL canônica vem de configuração, nunca do cabeçalho `Host`.
2. `GET /api/public/courses/:slug` com DTO público: título, resumo, descrição (renderizador do M2-05), ementa só com títulos de módulos, resumo da Offer aberta. Imagem `og:image` padrão estática até existir capa (M5).
3. Página React: Offer gratuita aberta → "Entrar para se inscrever" (leva ao login; inscrição no M3-02); paga → sem compra até o M6.
4. Slug inexistente, rascunho e arquivado respondem 404 idêntico, sem vazamento.
**Testes:** `curl` com UA de crawler devolve as tags certas; título com aspas e `<` sai escapado; slug inexistente = rascunho (mesma resposta); cabeçalho `Host` forjado não altera a canônica; revisão manual nos validadores LinkedIn/Meta após o deploy em Staging, resultado anotado no `STATUS.md`.
**Aceite:** prévia correta nos dois validadores.
**Fora do escopo / cuidados:** sem SSR de página inteira; Termos/Privacidade/Ajuda públicos são de outro marco; redirecionar `/comprar/[slug]` legado é do M10.

---

**Notas de migração.** Antigo M2-02 (identidade curricular + `CourseRelease` com revisões imutáveis) foi **substituído** pelo currículo vivo com rascunho e publicação atômica (Q32), mantendo o ID M2-02. Antigo M2-03 mantido, mas o Suporte com grant também edita e publica (Q42). Antigo M2-04 passou a catálogo autenticado; a página pública (M2-06) é nova. Novos: M2-05 (conteúdo rico), M2-06, M2-07 (seed).
