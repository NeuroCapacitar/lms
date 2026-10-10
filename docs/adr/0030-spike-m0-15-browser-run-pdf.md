# ADR-0030 — Spike M0-15: Browser Run gera o PDF do certificado fiel, com a Lexend Deca e tempo previsível

- **Estado:** accepted — spike **passou** (2026-10-10), com condições
- **Data:** 2026-10-10
- **Origem:** tarefa M0-15 ([M0-fundacao.md](../tasks/M0-fundacao.md)); valida a decisão de certificado por HTML/CSS controlado via Browser Run (B7/Q15, [ADR 0014](0014-certificados.md) se existir no índice)
- **Substitui:** —
- **Dados brutos:** [evidencias/m0-15/](../review/evidencias/m0-15/README.md)

## Contexto

O certificado é gerado de forma assíncrona a partir de HTML/CSS controlado, num PDF imutável guardado no R2 com SHA-256. O spike mede, num Worker real descartável (plano Free, binding `BROWSER`), se o PDF sai em A4 com a fonte da marca, se o texto de usuário é seguro, e quanto tempo leva. Binding: `"browser": { "binding": "BROWSER" }`; o método `quickAction()` exige `compatibility_date` de 2026-03-24 ou posterior e não precisa de token de API.

## Resultado

**Fidelidade (conferida com pdf.js: tamanho, posição e fontes; e a renderização em Chromium)**
- Página **297,0 × 209,9 mm** (A4 paisagem), 1 página, com `@page { size: A4 landscape; margin: 0 }` e `preferCSSPageSize: true`.
- Posições: um campo posicionado em `left: 20mm` aparece com texto em **x = 20,0 mm** e outro em `left: 150mm` em **x = 150,0 mm**: erro abaixo de 0,1 mm em relação ao HTML.
- **Lexend Deca embutida a partir de um `data:` URI** (sem nenhum link externo no HTML). Os cinco pesos usados (300, 400, 500, 600, 700) aparecem no PDF como `LexendDeca_700wght` etc.; acentos e `ç ã Á Ñ ú` corretos; cor de fundo (`printBackground`) preservada.
- O texto do PDF é **selecionável e extraível** com acentos. As fontes são embutidas como **Type 3** (o Skia converte a fonte variável em contornos por peso), não como TrueType: a aparência é fiel, o arquivo tem ~70 KB e a busca de texto funciona.
- Controle visual: renderização do PDF em Chromium (pdf.js) idêntica ao HTML esperado ([amostra](../review/evidencias/m0-15/certificado-amostra.png)). Só consegui conferir com **o pdf.js** (extração e renderização); **não abri em Acrobat nem no leitor do Edge/Preview**.

**Tempo e comportamento**
- Primeira chamada (isolate frio) 2,7 s; seis chamadas seguidas: **1,06 a 1,51 s** (mediana ~1,1 s), contra 0,8 a 1,3 s medidos no servidor.
- No plano Free, **1 requisição por 10 s** e 10 minutos de navegador por dia: três chamadas simultâneas devolveram **HTTP 429** (`Rate limit exceeded`, código 2001) em duas delas. No Paid o limite é de 30 por segundo e sem teto diário de horas (página de limites da Cloudflare, lida em 2026-10-10).
- Formato inválido (`format: 'a99'`) devolve HTTP 400 com lista dos valores aceitos, e o erro chega como `Response` (não como exceção). Um HTML de 8 MB num campo gastou 10,3 s e ainda gerou um PDF de 1 página: **não há falha limpa para entrada gigante**, então o limite de tamanho é nosso.
- **O PDF não é determinístico:** o mesmo HTML gerou 6 SHA-256 diferentes em 6 chamadas (o PDF carrega a data de criação). O SHA-256 identifica o arquivo **guardado**, não o conteúdo; reemitir significa novo arquivo e novo hash.

**Segurança (o ponto principal)**
- **O JavaScript da página executa**: uma tag `<script>` sem escape alterou o título do PDF. A opção `setJavaScriptEnabled: false` foi ignorada pelo serviço (o script rodou mesmo assim).
- **Bloqueio de rede:** com `rejectRequestPattern: ['^https?://.*']`, uma imagem que apontava para o próprio Worker **não foi buscada** (o log só registrou o acesso do controle sem bloqueio). Sem a opção, a imagem é buscada.
- **CSP no próprio HTML** (`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">`) **bloqueou o script** (o título ficou "Certificado") sem atrapalhar a fonte em `data:` nem o CSS. É a defesa que funciona de verdade contra execução.
- **Escape:** um nome com `<script>…</script><img src=…>` e aspas, passado pelo escape, apareceu literalmente no PDF e nada executou nem foi buscado.
- **Estouro de layout:** um nome longo sem proteção fez o Chrome reduzir a página inteira (texto em x = 13,5 mm em vez de 20 mm). Com `max-width`, `overflow: hidden` e `text-overflow: ellipsis` nos campos, um nome de ~300 caracteres ficou truncado com reticências e o layout permaneceu intacto.
- **Ligaduras:** com as ligaduras padrão, "Certificado" foi extraído como `Certi\0cado` (a ligadura "fi" sem mapeamento Unicode). Com `font-variant-ligatures: none` a extração saiu correta.

## Decisão

1. **Browser Run via `env.BROWSER.quickAction('pdf', { html, pdfOptions, … })`** é a geração oficial do PDF. O binding no Worker de certificados, em fila ([ADR 0006](0006-assincrono-outbox-duas-filas.md)), com a data de compatibilidade atual.
2. **Contrato do HTML do certificado:** documento autocontido (CSS inline, fonte Lexend Deca em `data:`, imagens em `data:`), **sem nenhum recurso externo**; `@page` com `size: A4 landscape; margin: 0` e `preferCSSPageSize: true`; `printBackground: true`; `font-variant-ligatures: none`; campos com `max-width`, `overflow: hidden` e `text-overflow: ellipsis`.
3. **Defesa em três camadas, todas obrigatórias:** (a) todo texto de usuário passa por escape de HTML; (b) `<meta>` de CSP `default-src 'none'` com `style-src 'unsafe-inline'`, `font-src data:`, `img-src data:`; (c) `rejectRequestPattern: ['^https?://.*']` em toda chamada. Teste de CI com um nome malicioso que prove que nada executa nem é buscado.
4. **O SHA-256 é do arquivo guardado.** O PDF é gravado no R2 privado **uma vez** e nunca regenerado "em silêncio"; reemissão cria novo arquivo e novo hash (a revogação e a reemissão já são auditadas, ADR 0017). Validar pelo hash de um PDF regenerado não funciona.
6. Limite de tamanho dos campos de texto no nosso lado (nome e curso) antes de montar o HTML.
5. **Plano Free não serve para produção** (1 requisição por 10 s): o Workers Paid, já necessário (ADR 0029), elimina o limite. A fila de emissão deve tratar 429 com *retry* e *backoff*.
7. **Plano B (biblioteca de PDF) não foi acionado** e não está adotado.

## Consequências

- Custo: Browser Run no Free tem 10 min/dia; no Paid, as horas além do incluído são cobradas (preço não verificado; cerca de 1,1 s por certificado). Emissão em massa (turma inteira) deve ser espaçada pela fila.
- O arquivo é fiel, mas **Type 3**: leitores muito antigos ou ferramentas de acessibilidade podem tratá-lo pior que TrueType; aceitável para um certificado de leitura e impressão.
- O JavaScript executando na página é um risco do serviço, não nosso: a CSP no HTML e o bloqueio de rede o neutralizam, mas **uma falha de escape + CSP removida** voltaria a expor. Por isso a CSP e o teste ficam travados em CI.

## Como validar

Feito no spike: tamanho A4, posição ao milímetro, fonte e acentos, escape, bloqueio de rede, CSP, tempo, repetição, limite do Free, entradas inválidas e gigantes. **Ainda não verificado:** gravação no R2 (nenhum bucket foi criado; fica para o M7 com o bucket real); abertura em Acrobat e no leitor do Edge/Preview; impressão física; certificado com logotipo e imagens em `data:`; comportamento sob carga real no Paid; preço exato do Browser Run no Paid; renderização de caracteres fora do subconjunto latino (só o subconjunto `latin` da Lexend Deca foi embutido).
