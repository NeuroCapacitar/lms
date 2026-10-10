# Evidências do spike M0-17 (2026-10-10)

Material da [ADR 0031](../../../adr/0031-spike-m0-17-htmlrewriter-meta-tags.md). O spike rodou **fora do repositório**, num Worker real descartável (`m0-17-spike`, workers.dev, plano Free) com o perfil `neurocapacitar`. Catálogo, textos e imagem fictícios. **O Worker continua no ar** até o responsável registrar o resultado dos validadores (ver STATUS); depois deve ser apagado.

| Arquivo | Conteúdo |
|---|---|
| `worker-index.ts.txt` | Worker: rota `/cursos/:slug`, catálogo fictício, `HTMLRewriter` com `setAttribute` (com `&` escapado) e `setInnerContent`, 404 único, cabeçalhos próprios |
| `index.html.txt` | O `index.html` do SPA com as meta tags em atributos vazios (placeholders) |
| `wrangler.jsonc.txt` | Configuração: `assets` com `run_worker_first` para `/cursos/*`, `CANONICAL_BASE` |
| `resposta-neuro-basico.html.txt` | Resposta real (com `User-Agent` de `LinkedInBot`) para o curso com título e descrição cheios de aspas, `<`, `>` e `&` |
| `og-padrao.png` | Imagem de teste 1200 × 630 usada em `og:image` |
