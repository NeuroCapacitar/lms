# ADR-0027 — Spike M0-12: região do Neon (São Paulo) e orçamento de compute no Free

- **Estado:** accepted — spike **passou** (2026-10-10); confirma Q43
- **Data:** 2026-10-10
- **Origem:** tarefa M0-12 ([M0-fundacao.md](../tasks/M0-fundacao.md)); [ADR 0005](0005-banco-neon-free-hyperdrive-drizzle.md)
- **Substitui:** —
- **Dados brutos:** [evidencias/m0-12/](../review/evidencias/m0-12/README.md)

## Contexto

A ADR 0005 previa Neon Free em `aws-sa-east-1` se o plano permitisse, e o cron de reconciliação a cada 30 min dentro do gatilho de 70 CU-h/mês. O spike mede a latência real Worker → Hyperdrive → Neon nas duas regiões candidatas e o despertar frio. Tudo com o perfil `neurocapacitar` (ver [cli-profiles](../operations/cli-profiles.md)). Recursos descartáveis, já **apagados**: 2 projetos Neon Free (PG 18), 2 configs Hyperdrive (cache desligado), 1 Worker de teste (workers.dev, protegido por token). O Workers Paid **não** está contratado: o Worker e o Hyperdrive rodaram no plano Free.

## Resultado

**Latência Worker → Hyperdrive → Neon** (Worker no colo GRU, São Paulo; 3 rodadas por região; cada rodada: 30 conexões novas + `select 1`, 100 queries em conexão aberta, 30 × 5 queries sequenciais). Medianas das 3 rodadas:

| Cenário | São Paulo `aws-sa-east-1` | us-east-1 |
|---|---|---|
| Query simples (p50) | **5 a 8 ms** | 120 a 137 ms |
| 5 queries sequenciais (p50) | **25 a 38 ms** | 598 a 687 ms |
| Conexão nova + `select 1` (p50) | **7 a 9 ms** | 132 a 134 ms |
| Pior caso observado (max) | 94 ms | 691 ms |

São Paulo é ~15 a 20 vezes mais rápido por query. Medição direta, da máquina do desenvolvimento até o banco: 112 ms (SP) contra 148 ms (us-east) por query; ela mostra a distância da máquina, não do Worker, e não decide.

**Despertar frio** (primeira query depois de 6+ min ocioso; o Free suspende em 5 min):
- Via Worker → Hyperdrive, São Paulo, n = 5: 595, 628, 633, 656 e **1119 ms** (p50 633 ms). A conexão ao Hyperdrive custa 2 a 4 ms; o despertar aparece na primeira query.
- Direto da máquina, n = 6 por região: SP 1,55 a 2,43 s (p50 1,65 s), us-east 1,71 a 2,70 s (p50 1,88 s), incluindo TCP/TLS/autenticação a ~110–150 ms.
- Limite proposto (p95 ≤ 5 s): atendido com folga. Amostra pequena (n = 5): a incerteza do p95 é alta.

**Constatações:** (1) São Paulo está disponível no Neon Free e aceita PG 18. (2) O pool do Hyperdrive **não impede** o scale-to-zero: o endpoint passou a `idle` ~5 min após a última query (estado `active` às 07:17:17Z, `idle` às 07:18:05Z, última query ~07:12–07:13Z). (3) Compute do Free: 0,25 CU fixo (mín = máx), retenção de histórico de 6 h. (4) Hyperdrive criado com `--caching-disabled` e `origin_connection_limit` de 20. (5) O Worker Free executou ~280 queries e 31 conexões por requisição sem atingir limite de CPU ou de subrequisições. (6) As métricas de consumo do projeto (`active_time_seconds`, `compute_time_seconds`) ficaram em 0 durante o spike: **o consumo real não foi medido**.

## Orçamento de CU-h (modelo, não medição)

Premissas: 0,25 CU; suspensão após 5 min de ociosidade (observada); cada despertar mantém o compute ativo ~5,1 min; mês de 31 dias; o compute cobrado só enquanto ativo.

| Intervalo do cron | Horas ativas/dia (sem tráfego) | CU-h/mês |
|---|---|---|
| 5 min (ou menos) | 24 (nunca suspende) | **186**: estoura o Free |
| 15 min | 8,2 | 63 |
| **30 min (decidido)** | **4,1** | **32** |
| 60 min | 2,0 | 16 |

Com tráfego de alunos (janelas de T horas/dia em que o compute já estaria ativo; o cron só soma fora delas): T = 0 → 32; T = 3 → ~51; T = 6 → ~70; T = 8 → ~83 CU-h/mês. O gatilho de upgrade (70 CU-h/mês, ADR 0005) corresponde a ~6 h/dia de compute ativo por tráfego. Estimativa a calibrar com `active_time_seconds` real em Staging.

## Decisão

- **Região: `aws-sa-east-1` (São Paulo)** para Development (se usar Neon), Staging e Production. Q43 confirmada; sem Smart Placement (o Worker e o banco já estão na mesma cidade).
- **Cron de reconciliação a cada 30 min**; nunca abaixo de 10 min (abaixo de ~5 min o compute não suspende e o Free estoura). Se o consumo se aproximar de 70 CU-h/mês, passar para 60 min antes de pensar em plano pago.
- Hyperdrive com cache desligado e origem direta (sem pooler da Neon), como na ADR 0005.

## Consequências

- O despertar frio (~0,6 a 1,1 s na primeira query) é aceitável para o aluno; o primeiro acesso depois de ociosidade pode ser mais lento, e o consumidor de fila e o cron precisam tolerar essa primeira query lenta (timeouts ≥ 5 s).
- O plano Free não permite desligar o scale-to-zero; upgrade pago continua condicionado aos gatilhos e à decisão do responsável.
- **Não verificado:** consumo real de CU-h; p95 do despertar com n maior; latência em horários de pico; Hyperdrive no plano Paid (limites diferentes); Postgres 18 local para testes (M0-06): usar um projeto Neon Free de teste, com o perfil `neurocapacitar`.

## Como validar

Em Staging (M0-08 em diante), comparar `active_time_seconds` do projeto com este modelo durante uma semana; repetir a medição de despertar com n ≥ 30 se houver reclamação de lentidão.
