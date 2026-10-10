# ADR-0005 — PostgreSQL 18 no Neon Free via Hyperdrive, com Drizzle 0.45 e sem advisory locks

- **Estado:** accepted (região e orçamento de wake confirmados pelo spike M0-12, ver [ADR 0027](0027-spike-m0-12-regiao-neon-e-orcamento-de-compute.md); pendente apenas o consumo real em Staging)
- **Data:** 2026-10-10
- **Origem:** Q43, Q45, Q53; B11, B15A/B15B
- **Substitui:** Neon pago/PITR de 7 dias como base; qualquer uso de advisory locks do legado

## Contexto

Hyperdrive **não suporta advisory locks, LISTEN/NOTIFY nem PREPARE SQL**, e seu cache vem **ligado por padrão sem invalidar em writes** (evidência: W1 §B). O driver recomendado é `pg` por requisição; Drizzle v1 não é GA (0.45.4 é o `latest`) (W2 §2.7–2.8). Neon tem `aws-sa-east-1`; o Free dá 100 CU-h e 1 GB por projeto, scale-to-zero de 5 min e restore de 6 h (W1 §M). O legado já rodava Production no Neon Free (L1 §0).

## Decisão

- **Neon Postgres 18 Free**, 3 projetos (Dev/Staging/Production), sem branch por PR; São Paulo se o Free permitir.
- **Hyperdrive** com `pg` criado **por requisição** e **cache desligado**; conexão direta e role própria só para migrations, fora do Worker. Somar `max_size` do pool às conexões úteis do compute.
- **Sem advisory locks.** Fencing por lease em linha com `FOR UPDATE SKIP LOCKED` (conceito do legado, L1 §4.1).
- **Drizzle 0.45 fixado**, sem API relacional; migrations SQL revisadas à mão, forward-only; SQL cru só para locks/leases/constraints, em funções nomeadas e testadas em PG real. Proibido `drizzle-kit push` em Staging/Production.
- **Backup:** `pg_dump` diário e antes de cada release, cifrado com `age`, no R2; cópia semanal fora da Cloudflare (destino PENDENTE do cliente). Metas RPO ≤24 h, RTO ≤8 h, a demonstrar.

## Consequências

- Sem SLA nem PITR longo; perda possível de até 24 h. Wake de algumas centenas de ms no primeiro acesso.
- Risco estratégico do Neon sob a Databricks; mitigado por `pg_dump` portátil.
- Gatilhos de upgrade em [ADR-0003](0003-teto-de-custo-free-tier-first.md).

## Como validar

- spike M0-10 (`pg`+Hyperdrive+Drizzle no workerd) e M0-12 (latência São Paulo × us-east e orçamento de wake).
- Teste de que auth/sessão nunca leem de config com cache; ensaio de restauração semestral e antes do Go-Live.
