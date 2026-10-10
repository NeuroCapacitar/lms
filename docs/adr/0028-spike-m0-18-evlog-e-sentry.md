# ADR-0028 — Spike M0-18: evlog para logs e Sentry 11 para erros, com redaction obrigatória

- **Estado:** accepted — spike **passou** (2026-10-10), com condições
- **Data:** 2026-10-10
- **Origem:** tarefa M0-18 ([M0-fundacao.md](../tasks/M0-fundacao.md)); refina a [ADR 0023](0023-observabilidade-backup-e-operacao.md)
- **Substitui:** —
- **Dados brutos:** [evidencias/m0-18/](../review/evidencias/m0-18/README.md)

## Contexto

A ADR 0023 previa um wide event por requisição via `evlog` e erros no Sentry Free, ambos `PENDENTE (spike M0-18)`: maturidade do `evlog` e estado do `@sentry/hono`. O requisito de privacidade é mais forte que o de conveniência: nenhum e-mail, cookie, token de login ou link mágico pode sair em log ou em erro. O spike rodou em Worker descartável no **workerd local** (`wrangler dev --local`) e em Chromium. Não houve deploy, conta Cloudflare nem conta Sentry: o DSN apontava para um servidor local que gravou os envelopes. O comportamento em Staging real fica para o M0-08.

## Resultado

**evlog 2.30.1 (MIT)**
- Roda no workerd com `nodejs_compat`: `evlog/hono` (middleware) e `evlog/workers` (`initWorkersLogger`). Um wide event por requisição, com `method`, `path` (**sem query string**), `status`, `durationMs`, `service`, `environment` e o que o código acrescenta com `log.set()`. Erros viram `error: { name, message, stack }` e o status 500.
- **Redaction** (aplicada antes do console e do drain): com `paths` (`**.cookie`, `**.authorization`, `**.token`, `**.password`) e `patterns` (link mágico `/magic/<token>`, e-mail), o e-mail em campo, em texto livre e na mensagem do erro saiu `[REDACTED]`; token, cookie e link mágico também. Com os `builtins` padrão o e-mail sai **mascarado só em parte** (`p***@***.com`); por isso o e-mail é tratado por `pattern` próprio (mascaramento parcial ainda é dado pessoal).
- Cabeçalhos (`Cookie`, `Authorization`) **não** entram no evento por padrão.
- Custo no bundle: Hono puro 14,57 KiB gzip; com evlog 37,14 KiB (+22,6 KiB).
- Maturidade, lida no GitHub: criado em 2026-01-24 (9 meses), 1,9 mil estrelas, 19 issues abertas, último push em 2026-10-09, releases a cada poucos dias na série 2.x. **Uma pessoa concentra a autoria** (845 commits do maior contribuidor; entre os cinco primeiros, os outros quatro são bots) → risco de "fator ônibus 1" e de mudanças de API frequentes.
- **Achado:** o `requestId` é tomado do cabeçalho `x-request-id` enviado pelo cliente (testado: `req-1`). É dado controlado por quem chama; o wrapper deve usar `cf-ray` ou um id gerado, sem confiar no cabeçalho.

**Sentry 11.6.0 (MIT)**
- `@sentry/hono` **já é estável** na 11.6.0 (a ADR 0023 o dava como alpha). `@sentry/hono/cloudflare` (middleware `sentry(app, options)`), `@sentry/cloudflare` e `@sentry/react` rodam no workerd e no Chromium e entregaram o envelope. A exceção proposital chegou com a mensagem já sem e-mail.
- Custo: Worker +113,7 KiB gzip sobre o Hono com evlog (151,6 KiB no total, longe do limite); SPA 39,65 KiB gzip (só erros, sem tracing nem Replay).
- **Achado grave (controle negativo):** com a configuração padrão do SDK, o evento do SPA sai com a **URL completa**, incluindo `?email=…&token=…#fragmento`, e a mensagem do erro com o e-mail. Link mágico e convites trafegam por URL, então o `beforeSend` que corta a URL é **obrigatório**, não opcional.
- **Achado:** o SDK copia as linhas de `console` para `breadcrumbs`, e o evlog escreve o wide event no console. Mesmo redigido, isso duplica contexto no Sentry. `beforeBreadcrumb: () => null` elimina os breadcrumbs (testado no Worker e no SPA).
- Free ("Developer"): 5.000 erros/mês, 1 usuário, 30 dias (página de preços, lida em 2026-10-10); Team US$ 26/mês é decisão fora do teto.

**Workers Logs e Web Analytics (documentação oficial lida em 2026-10-10; não testado em Staging)**
- Workers Logs: no plano Free, 200 mil eventos/dia e 3 dias de retenção; no Paid, 20 milhões/mês e 7 dias. JSON estruturado é indexado por campo. **A partir de 2026-12-01** a cobrança passa ao modelo de Observabilidade (Free: 0,5 GB/dia de ingestão e 7 dias, e a ingestão **para** ao fim da cota; Paid: 50 GB incluídos, depois US$ 0,25/GB). Um wide event tem menos de 1 KB, então ~50 milhões de eventos cabem nos 50 GB.
- Web Analytics: gratuito, por snippet JavaScript, sem trocar DNS nem usar proxy. A documentação diz que não coleta dados pessoais, mas **não detalha** cookies nem armazenamento local: não foi verificado.

## Decisão

1. **evlog adotado**, versão **fixada exata** (2.30.1), isolado em um único módulo (`src/server/logging.ts`) que configura redaction, id da requisição e campos permitidos. Nenhum código de domínio importa `evlog` direto. Assim, trocar por um logger próprio de `console.log(JSON.stringify(...))` custa um arquivo. O Renovate **não** faz merge automático do evlog: cada atualização passa por leitura do changelog e pelo teste de redaction.
2. **Redaction padrão do projeto** (testada no CI a partir do M0-08): `paths` `**.cookie`, `**.authorization`, `**.token`, `**.password`, `**.secret`; `patterns` para e-mail e para o caminho do link mágico/convite; `builtins` de cartão, IPv4, telefone, JWT, bearer e IBAN. Sem query string, sem corpo de requisição, sem cabeçalhos. IDs internos (`u_123`) são permitidos, e-mail nunca. Campo novo em `log.set()` só entra com revisão.
3. **Sentry** (`@sentry/hono/cloudflare` e `@sentry/react`, 11.6.0, fixados): `dataCollection` mínima (**no Sentry 11 `sendDefaultPii` não existe mais e o padrão é coletar tudo**: cookies, cabeçalhos, corpos, query string e variáveis das pilhas; o spike passou com `sendDefaultPii` ignorado e salvo só pelo `beforeSend`); `beforeSend` que apaga `user`, `request.cookies`, `headers`, `data`, `query_string`, reduz `request.url` a origem e caminho (sem query nem fragmento) e troca e-mails em mensagens por `[email]`; `beforeBreadcrumb: () => null`; **sem Replay e sem tracing** (`tracesSampleRate: 0`: cabe nos 5.000 erros do Free); `environment` explícito e `release` igual ao commit. Source maps privados: **não verificado**, fica para o M0-08/M9. O Sentry não substitui a auditoria financeira nem o Operations Center.
4. **Workers Logs** ligado com `invocation_logs: false` (evita duplicar o wide event). Acompanhar a cota, porque no Free a ingestão para ao fim do dia e no Paid o excedente é custo fora do teto.
5. **Web Analytics: condicional.** Só ligar no M0-08 depois de abrir o Staging no navegador e confirmar que não grava cookie nem armazenamento; caso contrário, fica de fora. Quando ligado, a CSP do M1-05 precisa permitir o domínio do beacon (a confirmar).
6. **Pendência do responsável:** criar a conta e o projeto Sentry (plano Developer) e fornecer os dois DSNs (Worker e SPA); não posso criar contas. Sem isso, o M0-08 publica só com Workers Logs.

## Consequências

- Custo: nenhum além do Workers Paid já previsto. Peso do Worker +22,6 KiB (evlog) e +113,7 KiB (Sentry), gzip, dentro dos limites; SPA +39,65 KiB gzip, carregado em todas as páginas (avaliar carregar o Sentry depois da primeira renderização).
- A redaction é uma lista de proibição: um campo novo com dado pessoal e nome inesperado vaga. Mitigação: allowlist por revisão de `log.set()` e teste que injeta e-mail, cookie e token em cada rota nova.
- Riscos aceitos: evlog depende de uma pessoa e muda rápido (mitigado por versão fixa e fronteira de módulo); o Sentry guarda a pilha e a mensagem do erro, que podem conter dado de usuário (mitigado por `beforeSend`, não eliminado).

## Como validar

Feito no spike: exceção proposital chega ao servidor de ingestão sem e-mail, cookie nem token; log de requisição com e-mail e cookie de teste sai redigido; controle negativo prova que o SPA vaza URL sem o `beforeSend`. **Ainda não verificado:** logs em `Queue` e `Cron` (o spike só cobriu HTTP; fica para o M4); envio a um projeto Sentry real, filtros do lado do servidor e source maps; Workers Logs e Web Analytics em Staging publicado (M0-08); comportamento do evlog sob `vite preview`/plugin Cloudflare Vite (usei `wrangler dev` direto).

## Emenda (2026-10-10, M0-08)

Verificado no Staging real: o evento do Worker e o do SPA chegaram aos projetos `hub-vnext-worker` e `hub-vnext-web` sem e-mail, cookie, query, fragmento nem usuário. O Sentry ainda preencheu `user.geo` (país e cidade, derivados do IP no recebimento): ligado `scrubIPAddresses` nos dois projetos. O Workers Logs persistido, consultado com `cf observability telemetry query`, não trouxe e-mail, token nem cookie; os valores de query string aparecem como `REDACTED` nos metadados da própria Cloudflare. O `wrangler tail` mostra a URL com query string e o `x-request-id` enviado pelo cliente nos metadados do evento (só na transmissão ao vivo, não no log persistido): usar o `tail` com cuidado.
