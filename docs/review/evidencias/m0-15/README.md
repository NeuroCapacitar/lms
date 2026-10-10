# Evidências do spike M0-15 (2026-10-10)

Material da [ADR 0030](../../../adr/0030-spike-m0-15-browser-run-pdf.md). O spike rodou **fora do repositório**, num Worker real descartável (`m0-15-spike`, workers.dev, plano Workers Free, binding `BROWSER`) com o perfil `neurocapacitar`. O Worker foi **apagado** ao final; nenhum R2, Hyperdrive ou banco foi criado. Nomes e dados do certificado são fictícios.

| Arquivo | Conteúdo |
|---|---|
| `worker-index.ts.txt` | Worker do spike: HTML A4 paisagem autocontido (CSS inline, CSP, fonte em `data:`), escape de texto, variantes de teste e `env.BROWSER.quickAction('pdf', …)`. A fonte vem de um módulo `font.ts` (Lexend Deca latin, variável, em base64) que não foi copiado (53 KB) |
| `wrangler.jsonc.txt` | Configuração (`browser.binding = "BROWSER"`, data de compatibilidade 2026-10-01) |
| `run.mjs.txt` | Roteiro de chamadas (variantes, repetição, concorrência), espaçadas por causa do limite de 1 requisição a cada 10 s do plano Free |
| `analyze.mjs.txt` | Análise do PDF com pdf.js: tamanho da página, posição e fonte de cada trecho de texto, SHA-256 |
| `render.mjs.txt` | Renderização do PDF com pdf.js em Chromium para PNG |
| `certificado-amostra.pdf` / `.png` | PDF gerado pelo Browser Run (versão final do HTML) e sua renderização |
