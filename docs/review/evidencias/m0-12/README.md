# Medições brutas do spike M0-12 (2026-10-10)

Saídas JSON das medições descritas na [ADR 0027](../../../adr/0027-spike-m0-12-regiao-neon-e-orcamento-de-compute.md). Sem credenciais nem dados reais; os projetos Neon, os Hyperdrive e o Worker de teste foram apagados ao final.

| Arquivo | Conteúdo |
|---|---|
| `warm-sa.json`, `warm-use1.json` | medição **direta** (desta máquina até o banco): 30 conexões novas, 100 queries simples, 30 × 5 queries, com as amostras brutas |
| `cold-sa-east-1-N.json`, `cold-us-east-1-N.json` | despertar frio **direto** (1 amostra por arquivo, 6 por região, após 6 min de ociosidade) |
| `wk-sa-N.json`, `wk-use1-N.json` | Worker (colo GRU) → Hyperdrive (cache desligado) → Neon: estatísticas por cenário, 3 rodadas por região |
| `wk-cold-sa-N.json` | despertar frio via Worker → Hyperdrive, São Paulo, 5 amostras |
