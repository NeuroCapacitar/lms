# ADR-0031 — Spike M0-17: meta tags dinâmicas por HTMLRewriter na SPA (tecnicamente aprovado; falta o resultado dos validadores)

- **Estado:** accepted-conditional — a parte técnica **passou** (2026-10-10) e o **Sharing Debugger do Meta leu tudo corretamente**; falta o **Post Inspector do LinkedIn**, que falhou por **erro de conexão** (ver "Validadores") e ainda não foi concluído
- **Data:** 2026-10-10
- **Origem:** tarefa M0-17 ([M0-fundacao.md](../tasks/M0-fundacao.md)); antecede a M2-06
- **Substitui:** —
- **Dados brutos:** [evidencias/m0-17/](../review/evidencias/m0-17/README.md)

## Contexto

A página pública do curso (`/cursos/:slug`) precisa compartilhar com título, descrição e imagem corretos, sem SSR. O Worker busca o `index.html` dos assets e reescreve as meta tags com `HTMLRewriter`. O spike rodou num Worker real descartável (`m0-17-spike`, workers.dev, com `assets` e `run_worker_first: ['/cursos/*']`), com um catálogo fictício e uma imagem de teste de 1200 × 630.

## Resultado (técnico, verificado)

- **Funciona:** `GET /cursos/:slug` devolve o `index.html` do SPA com `title`, `description`, `canonical`, `og:*` e `twitter:*` trocados. O `User-Agent` de crawler (`LinkedInBot`, `facebookexternalhit`) recebe a mesma resposta que um navegador. O resto do SPA (`/`, rotas profundas, `/assets/*`) continua servido pelos assets.
- **Desenho seguro por construção:** o `index.html` traz as tags com **atributos vazios** (`<meta property="og:title" content="">`), e o Worker só chama `setAttribute` em elementos que já existem e `setInnerContent` (texto) no `<title>`. Sem montar HTML por concatenação de strings.
- **Escape:** o `<title>` sai escapado (`&amp;`, `&lt;`, `&gt;`). **Achado:** em **atributos** o `HTMLRewriter` escapa só as aspas (`"` → `&quot;`) e deixa `&`, `<` e `>` crus. Sem aspas soltas não há injeção, mas um texto que já contenha entidades (por exemplo um título digitado como `Tom &amp; Jerry`) seria lido como `&` pelos validadores. **Regra:** escapar `&` antes do `setAttribute` (`value.replaceAll('&', '&amp;')`); com isso, o texto literal chega aos validadores sem alteração. Testado com um título com `"`, `<`, `>`, `&`, `&amp;`, `&copy;` e `AT&T`.
- **Slug inexistente = rascunho = arquivado:** respostas **byte a byte idênticas** (corpo e cabeçalhos, exceto data), todas 404. O catálogo é consultado com `Object.hasOwn`, então `__proto__`, `constructor` e `toString` também dão 404. Maiúsculas e `%2F` no slug dão 404; barra final dá 200; `%00` é recusado antes do Worker (400).
- **Canônica vem de configuração:** `Host` forjado não chegou ao Worker (a Cloudflare responde 530 para host desconhecido) e `X-Forwarded-Host` foi ignorado; `canonical`, `og:url` e `og:image` saem de `CANONICAL_BASE`.
- **Cabeçalhos:** copiar os cabeçalhos do asset para a resposta vazou `CF-Cache-Status: HIT` e poderia vazar `etag` e `last-modified` de outro arquivo. A resposta passou a ser montada com cabeçalhos próprios: `content-type`, `cache-control: public, max-age=0, must-revalidate` e `x-content-type-options: nosniff`. O Worker responde antes do cache da Cloudflare para essas rotas: cada acesso lê o curso do banco (decidir TTL curto no M2-06).
- **Imagem:** `og:image` precisa ser uma URL absoluta, pública, PNG/JPEG; a de teste (20 KB, 1200 × 630) é servida pelos assets.

## Validadores (resultado do responsável, 2026-10-10)

- **Meta (Sharing Debugger):** **passou.** Código de resposta 200; URL canônica correta; prévia com a imagem de 1200 × 630, o título `Neurociência & Reabilitação — "Módulo 1" <básico>` e a descrição `Curso introdutório: "avaliação" e condutas. Inclui <b>negrito</b> & aspas ' e ".`, com aspas, `<`, `>` e `&` exibidos como texto, sem avisos. O Meta também leu as tags `twitter:*`. `og:image:alt` veio vazio: a M2-06 deve preencher o texto alternativo da imagem.
- **LinkedIn (Post Inspector):** **não concluído.** A ferramenta respondeu "Unable to connect to server. Bad DNS, bad gateway, or invalid server address" e "We cannot display a preview for this URL": o crawler nem chegou a ler a página. O Worker estava no ar (HTTP 200 com `User-Agent` de `LinkedInBot`, `HEAD` e `facebookexternalhit`), o DNS resolve e o TLS verifica. Causa **não identificada**; hipótese principal: o LinkedIn não alcança subdomínios `*.workers.dev`. Para separar as causas: inspecionar um site qualquer que funcione (controle da ferramenta) e `https://hub-staging.neurocapacitar-projetos.workers.dev/` (outro Worker no mesmo domínio). Se o `workers.dev` for a causa, o LinkedIn só poderá ser validado no domínio definitivo.

## Decisão

1. **HTMLRewriter com placeholders no `index.html`** é o mecanismo da M2-06: tags com atributos vazios no HTML estático, e o Worker as preenche com `setAttribute` (com `&` escapado) e `setInnerContent`.
2. Só `/cursos/:slug` e a validação pública de certificado têm meta tags dinâmicas (sem SSR). O caminho entra em `run_worker_first`.
3. Resposta de slug inexistente, rascunho e arquivado: **a mesma função**, mesmo corpo e mesmos cabeçalhos. Busca no catálogo por igualdade exata (`Object.hasOwn` ou consulta parametrizada), nunca por acesso a propriedade.
4. Cabeçalhos da resposta montados do zero; canônica e imagem a partir de configuração, nunca de `Host`.
5. **Pendência do aceite:** o Meta passou; falta o LinkedIn (ver acima). Se, num domínio aceito pelo LinkedIn, ele não ler as tags, a rota dedicada de HTML mínimo (plano B da tarefa) entra em nova ADR. A M2-06 só pode **ser concluída** com o LinkedIn registrado; ela já pode ser planejada porque o mecanismo está provado no Meta.

## Consequências

- Sem custo extra; o rewriter acrescenta uma leitura do catálogo por visita (pequena, mas fora de cache).
- O `index.html` do projeto passa a conter placeholders de meta tags; a SPA deve ignorá-los.
- Uma imagem `og:image` padrão estática atende até existir capa por curso (M5).

## Como validar

Verificado no spike: tudo acima no Worker real (curl com UA de crawler, escape, 404 idêntico, Host forjado, cabeçalhos, imagem). **Não verificado:** Post Inspector do LinkedIn (falhou na conexão, causa desconhecida); cache dos validadores (o LinkedIn guarda a prévia por dias: usar URLs novas a cada teste); X/Twitter Card Validator (descontinuado, não testado); WhatsApp e Telegram (leem Open Graph, não testados); imagens por curso.
