# ADR-0032 — M9-07: cache curto nas rotas públicas, sessão lida uma vez, Cron mantido em 30 min e Workers Paid no fim do desenvolvimento

- **Estado:** accepted (decididas pelo agente em 2026-10-17 por delegação expressa do responsável: "analise e tome a melhor decisão"; o Workers Paid é decisão do próprio responsável)
- **Data:** 2026-10-17
- **Origem:** medição do M9-07 no Staging e no banco de testes ([evidência](../review/evidencias/m9-07/README.md)) e pedido explícito do responsável
- **Substitui:** —  (refina a [ADR 0027](0027-spike-m0-12-regiao-neon-e-orcamento-de-compute.md) e a [ADR 0003](0003-teto-de-custo-free-tier-first.md); não contradiz nenhuma)

## Contexto

Medido no Staging (2026-10-17): com 20 requisições simultâneas o Worker devolve Cloudflare Error 1102 (`exceededCpu`) em 1,3% a 4% das requisições, porque a conta está no plano gratuito do Workers (10 ms de CPU por requisição). A [ADR 0029](0029-spike-m0-10-better-auth-magic-link.md) já registrava que o Workers Paid é indispensável. O consumo do Neon medido (≈ 6 CU-h em 7,3 dias) confirma o modelo da ADR 0027 (o Cron de 30 min sozinho ≈ 32 CU-h/mês). Também medido: as rotas públicas que tocam o banco respondiam `no-store`, então **qualquer visitante anônimo ou robô acordava o Neon**; e cada rota autenticada lia a sessão duas vezes (2 idas ao banco de 9 em `/me/access`, 2 de 22 no heartbeat).

## Decisão

1. **Workers Paid (US$ 5/mês): adiado, por decisão do responsável.** Reavaliar quando o desenvolvimento estiver concluído e só faltar ir para Production. Até lá o Staging aguenta carga baixa (até ~10 requisições simultâneas sem erro medido); erro 1102 sob carga maior é esperado e **não é defeito do código**. O Workers Paid é **pré-requisito do Go/No-Go de Production** (ADR 0029): Production sem ele não sobe.
2. **Cache de borda curto nas rotas públicas sem sessão: adotado.** `GET /api/public/courses/:slug`, `GET /cursos/:slug` (página com meta tags) e `GET /api/public/login-media` guardam a resposta por **60 s** (curso que não existe: **30 s**), pelo Cache API do Worker (`src/server/http/public-cache.ts`).
   - **Seguro:** só GET; só dado público e igual para todos; a chave é o caminho (sem host, consulta nem cookie); só se guarda leitura bem-sucedida do banco (falha e SPA pura nunca); a cópia sai sem `set-cookie` nem `x-request-id`; falha ou ausência do cache cai no caminho de sempre; quem pede recebe os mesmos cabeçalhos de cache de antes. **Nada de sessão, preço cobrado, pedido ou dado de pessoa passa por aqui:** a compra confere preço e oferta no servidor na criação do pedido, então um preço antigo na tela por até 60 s não cobra errado.
   - **Alinha com o projeto:** o M2-04 já pedia "cache curto" para dado não sensível; o ADR 0003 manda caber no free tier; o ADR 0027 manda proteger o orçamento de acordar do Neon.
   - **Limite assumido:** não há como limpar um ponto de presença de dentro do Worker; uma publicação demora **até 60 s** para aparecer na página pública (a prévia da Staff não passa por aqui).
   - **Não verificável no Staging:** o Cache API **não funciona em `*.workers.dev`**; só no domínio próprio. Os testes rodam no `workerd` (Cache API real); a conferência em Production é item do checklist de lançamento (`x-public-cache: hit` na segunda visita).
3. **Cron: mantido em 30 minutos** (ADR 0027 confirmada pela medição). Mudar para 60 min economizaria ≈ 16 CU-h/mês, mas dobraria o atraso de recuperação (outbox, inbox, pedidos pendentes, emissão de certificado) e os limiares de alerta do Operations Center foram desenhados em torno de 30 min; o consumo medido está dentro do modelo e o maior risco sem controle era o tráfego anônimo, tratado pelo item 2. **Regra de saída (mais cedo que a da ADR 0027):** se a projeção mensal medida (`compute_time_seconds` do projeto) passar de **55 CU-h**, mudar para 60 min **antes** do gatilho de 70 e antes de pensar em plano pago. Não adotado: janela só diurna (esconde falhas à noite, justamente quando ninguém olha).
4. **Sessão lida uma vez por requisição: adotado** (`withSessionOnce`, `src/server/auth/session-once.ts`). O `Auth` já nasce por requisição, então o memo vale só para uma requisição; só o pedido simples é lembrado, a chave é o cookie, **qualquer outra chamada da API de autenticação esquece**, e leitura que falha não é lembrada. Revogar uma sessão continua valendo na requisição seguinte. Efeito medido: −2 idas ao banco em toda rota autenticada (9 → 7; heartbeat 22 → 20).
5. **Heartbeat leve: não adotado agora.** A regra do M5-02 (reverificar acesso, drip e sequência a cada envio) fica como está: é a mais segura e o ganho (22 → ~15 idas) é pequeno na escala do produto (~20 pessoas, ~1 envio por segundo). Se a CPU medida no plano pago pedir, o desenho que preserva as invariantes é: **verificação completa no primeiro envio da aula e quando o envio concluiria a aula; só acesso (matrícula, direito, suspensão) nos envios intermediários**, porque o drip só abre com o tempo e a conclusão (única escrita que dá efeito) continua passando pela regra inteira.
6. **Cache do currículo publicado por versão: não adotado.** Memória do Worker não dura entre requisições, então seria KV ou similar: custo, invalidação ao publicar e mais uma superfície de dado desatualizado, sem evidência de necessidade na escala do produto. Reabrir só se a medição no plano pago mostrar rota quente acima do orçamento.

Também aplicado e medido (sem decisão nova): `FOR SHARE` no registro do vídeo do heartbeat (20 heartbeats simultâneos no mesmo vídeo: 5315 ms → 1860 ms).

## Consequências

- Menos acordadas do Neon por visitante anônimo e menos CPU nas páginas de curso (a CPU da página de curso era 14–15 ms; um acerto de cache não consulta o banco nem reescreve o HTML).
- Uma página pública pode estar até 60 s defasada depois de publicar; o aviso fica documentado.
- O Staging (workers.dev) NÃO exercita o cache; só Production (domínio próprio) e os testes do `workerd`.
- Workers Paid continua sendo custo certo (US$ 5) e pré-requisito de Production; adiar a contratação não muda o teto de US$ 10/mês.
- Orçamentos de idas ao banco por rota (`test/pg/hot-path-budget.pg.test.ts`) passam a ser o guarda de regressão: `/me/access` 7, catálogo 13, concluir 18, mapa 18, aula 19, heartbeat 20.

## Como validar

- `test/workers/public-cache.test.ts` (Cache API real: miss e hit, chave, expiração, falha do cache, o que nunca é guardado) e `test/unit/session-once.test.ts` (as regras do memo).
- `test/pg/hot-path-budget.pg.test.ts` (idas por rota) e os testes de auth e de vídeo existentes.
- **Pendente em Production:** `x-public-cache: hit` na segunda visita ao domínio próprio; consumo real de CU-h comparado ao modelo; CPU por rota no plano pago.
