# M9-07 — evidência de desempenho (parcial, medida SEM o Staging)

> **O que isto é e o que NÃO é.** Medições feitas em 2026-10-17 no banco de testes do responsável (Postgres descartável por teste, **latência de rede alta**, ~80 ms por ida ao banco) e com dados sintéticos. Servem para **comparar** rotas e provar uma otimização, **não** são a latência de produção, nem CPU do Worker, nem consumo do Neon. O que exige o Staging (passos 1, 3, 5 e 6 da tarefa) **não foi feito** e depende de autorização explícita do responsável (publicar e rodar carga lá). Estimativa sem medição não vale.

## 1. Idas ao banco por rota quente (cada `query` do `pg`, com BEGIN e COMMIT)

Teste: `test/pg/hot-path-budget.pg.test.ts` (o teto de cada rota é o valor medido e quebra o CI se a rota passar a fazer mais idas).

| Rota | Idas ao banco |
| --- | --- |
| `GET /api/me/access` | 9 |
| `GET /api/catalog/courses` | 15 |
| `POST /api/lessons/:id/complete` (aula de texto) | 20 |
| `GET /api/courses/:id/outline` (mapa) | 20 |
| `GET /api/lessons/:id` (aula de texto) | 21 |
| `POST /api/lessons/:id/video-progress` (heartbeat, a cada 15–30 s por pessoa assistindo) | 22 (21 quando repetido) |

**Onde está o custo** (lista completa das instruções na saída do teste):
1. **A sessão é lida duas vezes por requisição** (`session` + `user`: o portão dos Termos e depois a própria rota): 2 das 9 idas de `/me/access`, 2 de toda rota autenticada.
2. **O mapa, a aula, a conclusão e o heartbeat recarregam a árvore do currículo publicado** (estado, conteúdo, módulos, aulas, conclusões: 6 a 7 consultas) para decidir drip e sequência. No heartbeat são 17 instruções dentro de uma transação, a cada batida.

## 2. Otimização aplicada e medida: o travamento do vídeo

`reportVideoProgress` travava o registro do vídeo com `FOR UPDATE`. Como todas as pessoas que assistem ao MESMO vídeo leem esse registro, entravam em fila.

| Cenário (mesmo banco) | Antes | Depois |
| --- | --- | --- |
| 1 heartbeat sozinho | 1810 ms | 1799 ms |
| 20 leituras de aula simultâneas (sem trava) | 1815 ms | 1802 ms |
| **20 heartbeats simultâneos no MESMO vídeo** | **5315 ms** | **1860 ms** |

Mudança: `FOR SHARE` em vez de `FOR UPDATE` (`src/server/learning/video-progress.ts`). Continua protegendo contra mudança concorrente do registro; quem congela a duração faz `UPDATE ... WHERE duration_seconds is null` (condicional, já existia). Os 23 testes de `video-progress.pg.test.ts` (inclusive os de concorrência) passam.

## 3. EXPLAIN com 10 mil matrículas

Teste (só roda com `EXPLAIN=1`, fora do CI): `test/pg/explain-evidence.pg.test.ts`. Saída completa: `explain-10k.txt` (88 instruções, plano completo das acima de 8 ms).

- **Caminho quente (sessão, mapa, aula, catálogo, heartbeat):** toda instrução abaixo de 0,1 ms, usando índice; as varreduras sequenciais são de tabelas de 1 a 6 linhas (`lesson`, `course`, `legal_document_version`). Nenhum índice a criar.
- **Painel (M9-01):** a consulta de acesso, 32,9 ms (varre `enrollment`, 10 mil linhas, e agrega); as demais, abaixo de 0,1 ms.
- **Fila (M9-01):** todas abaixo de 0,15 ms.
- **Análise do curso (M9-02):** o resumo (acesso, parados, faixas), **101,7 ms** com 10 mil pessoas (varre `lesson_completion` e `video_progress` do curso inteiro); a tabela por aula, 8,8 ms. A análise das ofertas, abaixo de 0,15 ms.
- **Leitura:** em ~20 pessoas inscritas (a escala do produto) isso é desprezível; com 10 mil (500 vezes mais) continua em 33 ms e 102 ms, sem índice novo e sem rollup. Um índice em `lesson_completion (course_id)` e `video_progress (course_id)` só valeria a pena bem acima disso; **não criei nenhum**.

## 4. Imagens (erro 9422)

Já provado: `e2e/curso-publico.spec.ts` responde 502 "erro 9422" nas variantes do Images e confere que a imagem estática continua aparecendo (`src/web/components/public-image.tsx`). Contador de 5.000 transformações únicas por mês: **não medido** (precisa do Staging).

## 5. O que NÃO foi feito (precisa do Staging e da sua autorização)

1. **Neon Free:** acordadas por dia, CU-h por mês contra o gatilho de 70, cold start da primeira requisição da manhã (passo 1).
2. **Hyperdrive:** soma do `max_size` contra as conexões úteis do compute (passo 2); leitura da configuração real não feita.
3. **CPU-ms por rota quente** no Worker real (passo 3): este documento só conta idas ao banco.
4. **Outras franquias:** Browser Run, Queues, Workers Logs, R2 e o contador do Images (passo 5).
5. **Teste de carga leve versionado** em Staging (passo 6; nunca em Production).
6. **Orçamento das rotas quentes:** "nenhuma rota acima do orçamento após a medição" continua com o valor PENDENTE (depende dos itens 1 e 3).

## 6. Oportunidades medidas que mexem em regra ou segurança (decisão do responsável)

| Opção | Ganho medido | O que muda |
| --- | --- | --- |
| **A. Ler a sessão uma vez por requisição** (lembrar o resultado do `getSession` dentro da requisição) | −2 idas em toda rota autenticada (9 → 7 em `/me/access`; 22 → 20 no heartbeat) | Núcleo de autenticação (48 pontos de uso). Mesmo resultado dentro da mesma requisição, mas é código sensível: precisa de revisão e de teste de revogação e renovação de sessão |
| **B. Heartbeat leve**: não recarregar a árvore do currículo a cada batida | 22 → cerca de 15 idas (−7), a rota mais frequente | Hoje o servidor reverifica acesso, **drip e sequência** a cada envio (decisão do M5-02). Reverificar só o acesso (matrícula, direito, suspensão) e deixar drip e sequência para o início da aula relaxa essa regra |
| **C. Guardar a árvore do currículo publicado por versão** (`curriculum_state.published_version`) | −6 a −7 idas no mapa, na aula, na conclusão e no heartbeat | Cache novo (memória do Worker não dura entre requisições; seria KV ou similar, com custo e invalidação por publicação); o Hyperdrive fica com cache desligado por decisão (ADR) |

---

# Parte 2 — medido NO STAGING (2026-10-17, autorizado pelo responsável)

> Autorização: "autoirizado prossiga", depois de eu pedir para publicar no Staging e rodar medição e carga leve (só Staging, dados sintéticos, identidade do perfil `neurocapacitar` verificada antes). Publicado o commit `abafe707cab3` (sem migrations). **Nada foi feito em Production.** Carga só com GET, só em rotas públicas (sem conta de teste: não havia como obter uma sessão sem a sua ajuda).

## 7. Configuração real lida (somente leitura)

| Item | Valor |
| --- | --- |
| Neon | Free, região `aws-sa-east-1` (São Paulo), PostgreSQL 18, compute **fixo de 0,25 CU**, 12 MB de dados |
| `max_connections` do Postgres | **112**, 4 reservadas ao sistema (108 úteis) |
| Hyperdrive de Staging | `origin_connection_limit` **20**, cache **desligado** (como o ADR manda) |
| Passo 2 da tarefa (soma do `max_size` ≤ conexões úteis) | **Cumprido no Staging:** 20 ≤ 108. Production tem outro Hyperdrive: conferir quando houver |
| Plano do Worker | A conta tem só a assinatura **"R2 Paid"**; **não há "Workers Paid"**. O Worker roda no plano gratuito (limite de **10 ms de CPU por requisição** e de 100 mil requisições por dia) |

## 8. Cold start do Neon (banco ocioso por ~7 min, depois a primeira requisição que usa o banco)

| Requisição | Tempo total |
| --- | --- |
| `GET /api/health/live` (sem banco), 1ª e 2ª | 0,49 s e 0,43 s |
| `GET /api/health/ready` (usa o banco) **1ª, com o banco frio** | **1,10 s** |
| `GET /api/health/ready`, 2ª a 6ª (banco acordado) | 0,32 a 0,64 s |

Estes tempos incluem a conexão desta máquina até a borda (~80 ms de ida, ~0,35 s só de rede e TLS). **O banco frio acrescentou cerca de 0,7 s** à primeira requisição.

## 9. Consumo do Neon e orçamento de acordar

- **Retrato antes da carga** (2026-10-17 14:48 UTC): `compute_time_seconds` = 21.674 e `active_time_seconds` = 85.236 desde a criação do projeto (2026-10-10 08:09 UTC, 7,3 dias). Como 21.674 ≈ 85.236 × 0,25, o primeiro valor já é em **CU-segundos: ≈ 6,0 CU-h**, ou **0,83 CU-h por dia, 25 CU-h por 30 dias** (inclui o desenvolvimento e os testes).
- **O Cron de 30 em 30 minutos sozinho** (48 acordadas por dia, cada uma mantém o compute ligado ~5 min até a suspensão): ≈ 4,2 h ligado por dia × 0,25 CU = **≈ 1,05 CU-h/dia, ≈ 32 CU-h por 30 dias**. É o piso: quase todo o consumo observado.
- Contra os números do projeto (free tier de 100 CU-h e gatilho de 70): o Cron deixa ~38 CU-h de folga até o gatilho, ou seja, **cerca de 5 horas por dia de compute ligado a mais** por tráfego de gente. Banco ligado o dia inteiro = 6 CU-h/dia = 180 CU-h/mês, **acima do free tier**.
- **Risco medido:** as rotas públicas que tocam o banco (`/api/public/courses/:slug`, `/api/public/login-media`, `/api/health/ready`) respondem `Cache-Control: no-store`, e a página `/cursos/:slug` é montada pelo Worker com consulta ao banco a cada visita. **Qualquer visitante anônimo, robô de busca ou monitor acorda o Neon.** No pior caso (uma visita a cada 5 min) o banco nunca suspende.
- **O custo marginal da carga NÃO foi medido:** os contadores do Neon não mudaram nos minutos seguintes à carga (a métrica atualiza com atraso). Fica para uma leitura posterior (ver "não feito").

## 10. Carga leve no Staging (`bun run load:staging`, GET, rotas públicas)

Versionada em `scripts/load-staging.ts`: recusa qualquer endereço que não seja o Worker `hub-staging` (testado em `test/unit/load-staging.test.ts`), no máximo 20 simultâneas (o limite do Hyperdrive) e 300 s, e imprime p50, p95, p99 e erros por rota.

**10 simultâneas, 60 s: 5.027 requisições, 91 por segundo, 0 erros.** p95 de 77 a 205 ms (rotas sem banco 77–79 ms, com banco 98 ms, páginas de curso ~200 ms).

**20 simultâneas, 25 a 60 s: ~190 requisições por segundo, de 1,3% a 4,0% de erros 503 (123 a 166 por rodada), todos nas rotas que usam o banco e, sobretudo, nas páginas de curso** (`/api/public/courses/:slug` ≈ 3% e `/cursos/:slug` ≈ 3% das requisições; `health/ready` e `login-media` ≈ 0,4%; rotas sem banco 0 erro). A latência das que responderam ficou igual à de 10 simultâneas (p95 ≤ 200 ms).

## 11. ACHADO: Cloudflare Error 1102 "Worker exceeded resource limits" (`exceededCpu`)

- **O que é:** os 503 NÃO vêm do código do produto (não têm `x-request-id`): são a página de erro da própria Cloudflare, **Error 1102, "Worker exceeded CPU time limit"**. Confirmado com `wrangler tail`: `outcome: "exceededCpu"` (17 de 327 invocações amostradas durante 25 s de carga a 20 simultâneas), com `cpuTime: 10` ms.
- **Causa provável (não 100% provada):** a conta está no **plano gratuito do Workers (10 ms de CPU por requisição)**. A CPU por requisição medida no tail (amostra, com o tail ligado, então os valores absolutos são indicativos): rotas sem banco ~2 ms (p50); `login-media` 6 ms; `health/ready` 7 ms; páginas de curso 14–15 ms (p50), com picos de 40–120 ms. Esses picos parecem ser o início de um isolado novo do Worker (carregar o pacote: Hono, zod, drizzle, pg, Better Auth), que só aparece quando a carga força a Cloudflare a abrir mais isolados (por isso 10 simultâneas não erram e 20 erram). **Não distingui "isolado novo" de "página de curso pesada"**, nem testei com o plano pago.
- **Consequência:** **a v1 NÃO cabe no plano gratuito do Workers** (nem a rota mais simples de quem estuda tem folga: sessão + acesso). O ADR 0003 já prevê o **Workers Paid (US$ 5/mês)** como único custo certo; ele ainda **não está contratado**. Com o plano pago o limite de CPU sobe (padrão 30 s) e o teto de 100 mil requisições por dia some. Contratar é decisão e despesa do responsável: **não fiz**.
- **Medição do próprio dia:** a carga gastou cerca de 33 mil das 100 mil requisições diárias do plano gratuito.

## 12. O que continua NÃO feito

1. **Rotas de quem está logado em Staging** (sessão, mapa, aula, concluir, heartbeat): não havia sessão disponível (nenhum navegador conectado). O script aceita o cookie de uma conta de teste em `LOAD_COOKIE` (nunca na linha de comando) e então inclui `/api/me/access` e `/api/catalog/courses`; o heartbeat de vídeo não pode ser medido no Staging (o curso de demonstração não tem vídeo e nenhum provedor de vídeo foi verificado).
2. **Custo marginal da carga no Neon** (os contadores atrasam): ler de novo mais tarde.
3. **CPU-ms limpa** (sem o tail ligado) e **por isolado novo versus morno**: precisa do plano pago para a carga não ser cortada, ou de métricas de CPU do Worker por consulta (a API de telemetria devolveu 400 na primeira tentativa e não insisti).
4. Browser Run (horas), Queues (operações), Workers Logs (volume), R2 e o contador de 5.000 transformações do Images: não medidos.
5. **Orçamento final das rotas quentes** ("nenhuma acima do orçamento"): continua PENDENTE até o plano do Worker ser decidido.

## 13. Decisões do responsável, medidas (acrescenta à tabela da seção 6)

| Opção | Evidência | O que muda |
| --- | --- | --- |
| **D. Contratar o Workers Paid (US$ 5/mês)** | O Error 1102 sob 20 simultâneas (1,3% a 4%) e o limite de 100 mil requisições por dia | Despesa recorrente prevista no ADR 0003. Sem isso a v1 não é estável |
| **E. Cache de borda curto nas rotas públicas** (`/api/public/courses/:slug`, `/cursos/:slug`, `login-media`) | Hoje `no-store` e cada visita acorda o banco | Menos acordadas do Neon e menos CPU; o dado é público (o M2-04 já fala em "cache curto"); precisa decidir o prazo e a invalidação ao publicar |
| **F. Cron de 60 em 60 minutos em vez de 30** | O Cron de 30 min custa ≈ 32 CU-h/mês; de 60 min seria ≈ 16 | Mais latência na emissão de certificados e na republicação do outbox (M7-02, M4-03) |
