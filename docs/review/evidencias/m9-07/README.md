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
