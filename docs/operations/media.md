# Mídia: R2, upload e entrega (M5-07)

Como a mídia funciona e o que falta para ATIVÁ-LA em cada ambiente. O código está pronto e testado com armazenamento em memória; **nada foi exercitado contra um R2 real** (ver `docs/implementation/STATUS.md`).

## O que o código faz

- **Upload:** o navegador recorta ao centro (capa 16:9, 1280×720; banner 4:1, 1680×420), converte (WebP, ou JPEG) e envia só o master. `POST /api/media/intents` cria o asset `pending_upload` com chave opaca `m/<id>` e devolve um PUT pré-assinado de 5 minutos (SigV4 com WebCrypto, assina o `Content-Type`). `POST /api/media/:id/confirm` lê o objeto e confere tamanho, assinatura mágica, dimensões do cabeçalho (sem decodificar), proporção e SHA-256; só então `ready`. "200 no PUT" não publica nada.
- **Público (capa e banner):** ao PUBLICAR o currículo, o master é copiado para o bucket público e só depois o ponteiro de `course_content` muda (a transação ainda recusa ponteiro para mídia não copiada). A página pública monta a variante do Images (`/cdn-cgi/image/width=…`) e o fallback estático; o `<img>` troca para o master uma vez e some se o master também falhar.
- **Privado (material de aula, ativos do certificado):** entregue por `GET /api/media/:id/content` DEPOIS de autorizar (Staff com `staff.read`, ou quem pode abrir uma aula que referencia a mídia: acesso, expiração, drip e sequência). O Worker lê do R2 e entrega com `Cache-Control: no-store` (imposto pelo middleware de segurança do `/api`), `nosniff`, CSP `sandbox` e `attachment` para PDF. **Desvio do texto da tarefa:** não há "GET assinado" reutilizável; cada requisição reautoriza, e nenhuma URL vazada serve depois (a banda de ~20 alunos passa pelo Worker sem custo relevante).
- **Referências e limpeza:** `media_reference` (um objeto por espaço do dono). O job `media.cleanup` (Cron, só acorda se houver trabalho e houver R2 configurado) expira uploads pendentes >24 h, tomba objetos `ready` sem referência há >24 h relendo a contagem sob trava do asset, e depois apaga os objetos do R2 fora de transação (se o R2 falhar, repete no ciclo seguinte).

## Para ativar (nada disto foi feito; precisa de autorização contextual)

Tudo no perfil `neurocapacitar` (`--profile neurocapacitar`, com a identidade conferida antes), por ambiente (Staging primeiro):

1. **Buckets:** um PRIVADO (uploads e privados) e um PÚBLICO (capa e banner), por ambiente. R2 é free tier; confirmar que a conta tem o R2 habilitado.
2. **Bindings** no `wrangler.jsonc` do ambiente: `MEDIA_PRIVATE` e `MEDIA_PUBLIC` (`r2_buckets`). Só entram depois de os buckets existirem (um binding para bucket inexistente derruba o deploy), por isso hoje não estão no arquivo. Rodar `bun run types` e commitar o resultado.
3. **Token de API do R2** (S3): criar no painel (Object Read & Write limitado aos dois buckets) e gravar como Worker Secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, mais a variável `R2_PRIVATE_BUCKET_NAME`. Nunca no repositório.
4. **CORS do bucket privado:** permitir `PUT` do origin do app (`APP_BASE_URL`) com o cabeçalho `Content-Type`. Sem isso o navegador bloqueia o upload.
5. **Domínio público da mídia** (custom domain na zona; `r2.dev` só em desenvolvimento): definir a variável `MEDIA_PUBLIC_BASE_URL`, acrescentar o host a `img-src` em `public/_headers` e habilitar o **Cloudflare Images Transformations** na zona (Free: 5.000 transformações únicas por mês; acima disso o erro 9422 faz o `<img>` cair no master). O CSP atual já aceita `blob:` (prévia) e `https://*.r2.cloudflarestorage.com` (PUT); estreite o `connect-src` para o host exato da conta no momento da ativação.
6. **Verificação real (registrar no STATUS):** subir capa e banner reais, confirmar, publicar o curso e ver a imagem na página pública (variante e fallback com a transformação forçada a falhar); baixar um PDF de aula como aluno autorizado e conferir os 403/404 dos não autorizados; rodar o `media.cleanup` com um órfão de teste; conferir que os cabeçalhos assinados no PUT (Content-Type) são mesmo aplicados pelo R2 (spike M0 #7) e o comportamento de limite do Images (spike M0-16).

Nota (M5-15): banners do painel e imagens do login usam o MESMO bucket público e as mesmas variantes (`banner_wide`, `login_side`): a ativação acima basta; nada novo para criar. A página de banners só mostra o que está publicado E já copiado para o bucket público.

## Limites e decisões em aberto

- Banner 4:1 (1680×420) até 5 MiB e capa 16:9 até 3 MiB: valores de partida (legado); confirmar com o cliente.
- Material de aula: o servidor, a autorização e a entrega estão prontos, mas NÃO há tela para anexar material a uma aula nem lista de materiais para o aluno (fica para uma tarefa própria). Ativos do certificado: o propósito existe; o consumidor é o M7.
- R2 não tem região na América do Sul: base jurídica da transferência internacional PENDENTE (advogado do cliente).
- Sem Images Hosted, sem original da câmera, sem SVG (pode carregar script), sem GIF.
