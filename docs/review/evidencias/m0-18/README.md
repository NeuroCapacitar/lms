# Evidências do spike M0-18 (2026-10-10)

Material da [ADR 0028](../../../adr/0028-spike-m0-18-evlog-e-sentry.md). O spike rodou **fora do repositório** (diretório descartável), em workerd local (`wrangler dev --local`, sem conta Cloudflare, sem deploy) e em Chromium headless. **Nenhuma conta Sentry foi usada**: o DSN apontava para um servidor local (`127.0.0.1:9999`) que gravava os envelopes recebidos. Os dados de teste (`pessoa@example.com`, `COOKIE_SECRETO`, `TOKEN_SECRETO`, `SEGREDO`, `/magic/AbCdEf0123456789XyZ`) são fictícios.

| Arquivo | Conteúdo |
|---|---|
| `worker-index.ts.txt` | Worker do spike: Hono + `evlog/hono` + `initWorkersLogger` (redaction) + `@sentry/hono/cloudflare` (`beforeSend`, `beforeBreadcrumb`) e rotas `/api/log` e `/api/boom` que injetam e-mail, cookie e token de propósito |
| `wrangler.jsonc.txt` | Configuração do Worker (`observability` ligado, `invocation_logs: false`) |
| `run-spike.mjs.txt` | Driver: servidor de ingestão falso, `wrangler dev`, requisições com cookie, `Authorization` e e-mail na URL |
| `evlog-eventos-redigidos.json` | Os dois wide events dos testes, como saem do `drain` (depois da redaction): e-mail, cookie, token e link mágico em `[REDACTED]`. Pilha removida (traz caminhos locais) |
| `sentry-worker-evento.json` | Evento recebido pelo servidor de ingestão a partir do Worker: mensagem com `[email]`, sem usuário, cabeçalhos, cookies nem query string; sem breadcrumbs |
| `client.ts.txt`, `spa-test.mjs.txt` | SPA do spike (`@sentry/react`) e teste em Chromium com cookie, `?email=…&token=…#frag` na URL |
| `sentry-spa-evento-com-scrubbing.json` | Evento do SPA com a configuração recomendada: URL só com origem e caminho |
| `sentry-spa-evento-sem-scrubbing.json` | **Controle negativo**: o mesmo SPA com a configuração padrão do SDK. A URL sai com e-mail, token e fragmento, e a mensagem com o e-mail |

Tamanhos medidos com `wrangler deploy --dry-run --outdir` (gzip): Hono puro 14,57 KiB; + evlog 37,14 KiB; + Sentry 128,31 KiB; ambos 151,60 KiB. SPA com `@sentry/react` (só erros, sem tracing nem Replay): 116 KB minificado, 39,65 KiB gzip.
