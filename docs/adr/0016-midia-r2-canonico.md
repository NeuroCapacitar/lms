# ADR-0016 — Mídia: R2 canônico, upload com validação dos bytes e Images Free com fallback

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** B5/IMG-R mantido (Q60), Q20
- **Substitui:** —

## Contexto

O legado normalizava imagens com Sharp e gerava PNG/PDF com dependências nativas que não rodam em Workers (evidência: L2 §11). No R2, a presigned URL só assina `Content-Type` de forma documentada; `Content-Length` e checksum não estão documentados (W1 §E). O Images Free dá 5.000 transformações únicas por mês e, acima disso, novas transformações retornam erro 9422 sem cobrança (W1 §F). Images Hosted cobra por imagem armazenada e entregue.

## Decisão

- **R2 é a fonte canônica** de mídia; **não** usar Images Hosted.
- Bucket **público** só para capas e banners, por domínio próprio na zona Cloudflare (`r2.dev` é só desenvolvimento). Todo o restante é **privado** e sempre servido após autorização. Enquadramento da mídia de login: a fechar na modelagem.
- O master é editado e recortado no navegador. Upload por presigned PUT; o servidor confirma e valida os bytes (HEAD, tamanho, magic bytes, SHA-256) antes de aceitar. O original da câmera não é guardado por padrão.
- Entrega pública usa transformações do Images Free, com **fallback estático** (variante pré-gerada ou master) quando a cota esgotar. Dado sensível nunca vai a cache de CDN.

## Consequências

Custo praticamente zero nessa escala, mas o R2 não tem região na América do Sul, o que exige base jurídica de transferência internacional (PENDENTE: advogado). Se o volume de transformações ultrapassar a cota, o fallback degrada a imagem, não quebra a página. Mais código de validação no Worker.

## Emenda (2026-10-13, M5-07): entrega privada pelo Worker

- Mídia privada NÃO sai por GET pré-assinado reutilizável: `GET /api/media/:id/content` autoriza a cada requisição (Staff, ou quem pode abrir uma aula que referencia a mídia), lê do R2 pelo binding e entrega com `no-store`, `nosniff`, CSP `sandbox` e `attachment` para PDF. Motivo: nenhuma URL vazada serve depois, o acesso expirado ou revogado corta na hora e não exige credencial S3 para leitura; o custo (banda de ~20 alunos pelo Worker) é desprezível. O PUT de envio continua pré-assinado (o navegador sobe direto ao R2).
- Capa e banner só vão ao bucket público quando o currículo é PUBLICADO (cópia primeiro, ponteiro depois); rascunho nunca fica público.

## Como validar

spike M0-16 (transformação de imagens com fallback; confirmar uso do binding Images no plano Free e o comportamento do erro 9422). Testes de upload com tipo falsificado, tamanho excedido e objeto ausente; teste de autorização cruzada em objetos privados.
