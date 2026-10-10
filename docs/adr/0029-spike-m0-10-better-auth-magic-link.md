# ADR-0029 — Spike M0-10: Better Auth 1.7.7 com magic link, confirmação por POST e sessão em Postgres funciona no Worker real

- **Estado:** accepted — spike **passou** (2026-10-10), com condições
- **Data:** 2026-10-10
- **Origem:** tarefa M0-10 ([M0-fundacao.md](../tasks/M0-fundacao.md)); valida a [ADR 0007](0007-identidade-magic-link.md)
- **Substitui:** —
- **Dados brutos:** [evidencias/m0-10/](../review/evidencias/m0-10/README.md)

## Contexto

A ADR 0007 depende de provar Better Auth, Hono, Hyperdrive, `pg` e Drizzle juntos no workerd, com link que não vira sessão em GET, uso único, expiração curta, sessão de 7 dias em Postgres, rate limit em banco e Turnstile. O spike foi feito em duas etapas: workerd local contra o Neon de testes (`hub-test`, São Paulo) e depois num **Worker real descartável** (`m0-10-spike`) com Hyperdrive descartável (cache desligado), no plano Workers **Free**, com o perfil `neurocapacitar`. Tudo foi apagado ao final (Worker, Hyperdrive e as tabelas).

## Resultado

**Fluxo completo (versão fixada: `better-auth` 1.7.7, MIT; peer `drizzle-orm` ^0.45.2 atendido pelo 0.45.4 do projeto)**
- Instância do Better Auth e cliente `pg` **por requisição** (adapter Drizzle, `advanced.database.validateSchema: false`, `cookieCache` desligado, `ipAddressHeaders: ['cf-connecting-ip']`). Funcionou no workerd local e no edge, sem remendo.
- **Link para página de confirmação:** o `sendMagicLink` recebe o token e monta `https://…/entrar/confirmar#token=…`. Com o token no **fragmento**, ele nem chega ao servidor nem a logs de acesso. A página só mostra um botão; quem cria a sessão é um `POST /api/entrar/confirmar` nosso, que confere a origem e chama `auth.api.magicLinkVerify` no servidor. O `GET /api/auth/magic-link/verify` nativo (que cria sessão em GET) é **bloqueado** (404, GET e HEAD): testado que não cria sessão.
- Testes no edge, todos aprovados: link usado duas vezes falha; link expirado falha; GET e HEAD não criam sessão; POST de outra origem recusado (403); revogar a sessão no banco vale na hora; **sessão de 7 dias com renovação rolling** (`updateAge` de 1 dia: sessão envelhecida volta a ~7 dias no uso seguinte); token guardado com **hash** (`storeToken: 'hashed'`); cookie `__Secure-better-auth.session_token`, `HttpOnly; Secure; SameSite=Lax`, `Max-Age=604800`.
- **Rate limit em banco** (`storage: 'database'`): 5 pedidos de link por minuto por IP, o sexto devolve 429. No edge o contador usa o **IP real de `cf-connecting-ip`** (que o cliente não consegue forjar); o Better Auth normaliza IPv6 para o bloco /64 (a chave gravada termina em `…:da00:0000:0000:0000:0000`).
- **20 fluxos completos em sequência** (pedido + confirmação) no edge: todos com sucesso, ~430 ms por fluxo incluindo as idas e voltas do próprio roteiro. Conexões no Neon ao final: 10 ociosas e **0 presas** (o Neon enxerga as conexões do pool do Hyperdrive, não as do Worker; um vazamento apareceria como conexão em transação ou como crescimento a cada rodada, e não apareceu).
- **E-mail de Staff não nasce por cadastro livre:** um hook `databaseHooks.user.create.before` que consulta uma tabela de e-mails de Staff/convites recusa a criação (403) e nenhum usuário é criado. A criação de Staff passa pelo fluxo de convite (M1), que cria o usuário antes do link.
- **Turnstile:** o plugin `captcha` do Better Auth cobre o Turnstile (`provider: 'cloudflare-turnstile'`, `endpoints: ['/sign-in/magic-link']`, cabeçalho `x-captcha-response`). Testado com as chaves de teste publicadas pela Cloudflare: sem token 400 (`MISSING_RESPONSE`), chave que sempre falha 403 (`VERIFICATION_FAILED`), chave que sempre passa 200. O plugin **só é exportado por `better-auth/plugins`** (não há subcaminho próprio); o custo no bundle foi de +2,3 KiB gzip.

**Medidas no Worker real (plano Free, colo GRU, Neon em São Paulo; CPU e tempo de parede em ms, lidos do `wrangler tail`)**

| Rota | n | CPU p50 / máx | Parede p50 / máx |
|---|---|---|---|
| `POST /api/auth/sign-in/magic-link` (pedido) | 50 | 9 / 67 | 44 / 169 |
| `POST /api/entrar/confirmar` (cria usuário e sessão) | 24 | 12 / 46 | 79 / 172 |
| `GET /api/auth/get-session` | 4 | 19 / 20 | 59 / 61 |
| `hashPassword` (scrypt do Better Auth) | 3 | 82 / 125 | 84 / 130 |

- O máximo de cada rota é a primeira requisição de um isolate novo (carrega o Better Auth). No Node o scrypt custou ~54 ms (V8), coerente com os 82 ms medidos no Worker.
- **Tempo de inicialização do Worker: 56 ms** (limite de 1 s). **Tamanho:** 2,4 MB bruto e **437 KiB gzip** (Better Auth, Drizzle, `pg` e Hono), dentro do limite de 10 MB comprimido do Paid e do de 3 MB do Free.
- **O limite de CPU do plano Free (10 ms por requisição) não cabe:** o pedido de link tem mediana de 9 ms, e confirmar, 12 ms. Com o **Workers Paid** (já previsto, ainda não contratado) o limite padrão é de 30 s e o fluxo cabe com folga. O scrypt (só para quem optar por senha) tem ~80 a 125 ms de CPU por criação ou verificação de senha.

**Achados que mudam a implementação**
1. **Falha na verificação responde com redirect 3xx**, não com JSON (o plugin redireciona para a página de erro). O endpoint de confirmação deve converter qualquer 3xx em 400 JSON; sem isso o cliente seguiria o redirect e receberia o HTML da SPA.
2. **Há três camadas de limite** no pedido de link: a regra padrão do plugin (5 por minuto), `customRules` do rate limit global (prevalece sobre as demais) e a opção `rateLimit` do plugin. Configurar só uma não basta: no spike, um valor alterado só no plugin não surtiu efeito porque a regra em `customRules` vencia. Uma única fonte de verdade para o número.
3. O Better Auth **não verifica o schema no CI por conta própria**; com `validateSchema: false`, tabela ou coluna divergente só aparece em execução. O teste de CI do M1-01 deve comparar o schema Drizzle do projeto com `getAuthTables()` da versão fixada (nomes de modelos e campos).
4. O link de acesso é montado por nós; o `url` que o plugin entrega (que aponta para o GET nativo) **não deve ser enviado**.
5. Variáveis do `wrangler dev` (`.dev.vars`) só valem depois de reiniciar o servidor.

## Decisão

1. **Better Auth fixado em 1.7.7** (exato; atualizações só com leitura do changelog e rodando os testes deste roteiro). Instância e cliente `pg` por requisição; Drizzle como adapter; `validateSchema: false` com teste de schema no CI.
2. **Fluxo de magic link como no spike:** token no fragmento, página de confirmação por GET sem efeito, sessão só em `POST` com verificação de origem, `GET`/`HEAD` nativos de verificação bloqueados, falhas convertidas em JSON, token com hash, expiração de 10 minutos (valor a confirmar no M1-01).
3. **Sessão:** 7 dias com `updateAge` de 1 dia, sem cache de cookie; revogação imediata.
4. **Rate limit em banco** (`storage: 'database'`) com IP de `cf-connecting-ip`; um único lugar define o limite do pedido de link.
5. **Turnstile** pelo plugin `captcha` no endpoint de pedido (import por `better-auth/plugins`).
6. **Staff:** e-mail de Staff não pode nascer por cadastro livre (hook na criação de usuário); entra por convite.
7. O `hashPassword` só roda para quem optar por senha; **o plano Workers Paid é requisito prático** (CPU do Free não comporta nem o fluxo base).

## Consequências

- Custo: nenhum novo; reforça que o Workers Paid (US$ 5) é indispensável a partir do M1.
- Peso: o Worker do spike (Better Auth, Drizzle, `pg` e Hono) pesa 437 KiB gzip; o Worker atual do projeto, com Hono e `pg`, é bem menor. Longe do limite.
- O pedido de link sai do isolate com ~9 ms de CPU e ~45 ms de parede: aceitável.
- Dependência de uma biblioteca com regressões em patches (ADR 0007): versão exata, teste de fluxo no CI e política de atualização manual mitigam.

## Como validar

Feito no spike (local e no Worker real): todos os testes listados acima. **Ainda não verificado:** envio real por Resend (sender falso nesta etapa); `Turnstile` com chave real e widget no navegador; Google e senha (fora do escopo); reautenticação recente por novo link (M1); CSRF de formulário com cookies de terceiros; comportamento sob concorrência real (as 20 sequências foram sequenciais, não paralelas); o fluxo no navegador (o roteiro usou `fetch`, sem página de confirmação com JavaScript).
