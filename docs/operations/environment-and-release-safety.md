# Ambientes, credenciais e releases — contrato inicial

**Estado:** procedimento aprovado, ainda não executado. Detalhes e justificativas: [segurança e operação](../spec/security-operations.md), [ADR 0003](../adr/0003-teto-de-custo-free-tier-first.md), [ADR 0005](../adr/0005-banco-neon-free-hyperdrive-drizzle.md), [ADR 0021](../adr/0021-repositorio-github-free-ci-duas-camadas.md), [ADR 0023](../adr/0023-observabilidade-backup-operacao.md).

| Superfície | Development | Staging | Production |
|---|---|---|---|
| Runtime | local (workerd) | Worker dedicado | Worker dedicado |
| PostgreSQL | PG18 local ou projeto Neon Free próprio | projeto Neon Free | projeto Neon Free (região São Paulo se o plano permitir) |
| R2 | recursos de teste | buckets e chaves separados | buckets e chaves separados |
| Queues | simuladas | `hub-finance` e `hub-general` + DLQs | `hub-finance` e `hub-general` + DLQs |
| Providers | fake ou sandbox | sandbox/teste | live somente após o Go/No-Go |
| Segredos | locais, nunca commitados | escopo Staging | fora do CI comum do GitHub |
| Dados | sintéticos | sintéticos | reais |

- **Custo:** o único custo certo é o Workers Paid (US$ 5/mês); teto de infraestrutura US$ 10/mês. Nenhum plano pago extra sem decisão explícita.
- **GitHub:** Free privado, sem branch protection nem environments garantidos. Staging pode ser publicado por um token limitado; Production exige processo manual fora do workflow comum e comprovação do SHA homologado.
- **Build:** `CLOUDFLARE_ENV` precisa ser selecionado **no build** do Vite Plugin. Todo ambiente tem preflight (bindings, Hyperdrive, R2, filas, DNS, segredos, providers).
- **Banco:** SQL versionado, forward-only, expand/contract, conexão direta ao Neon (nunca pelo Hyperdrive); **sem `drizzle-kit push` e sem reset remoto genérico** em Staging ou Production. Hyperdrive com cache de query desligado.
- **Backups:** `pg_dump` cifrado com `age` no R2 privado, diário e antes de cada release, mais cópia semanal fora da Cloudflare; ensaio de restauração semestral e antes do Go-Live. Nunca restaurar e liberar efeitos externos sem conciliar pagamentos, revogações e exclusões posteriores.
- **Legado:** continua em `app.neurocapacitar.com.br` até o cutover; congelado (só segurança, legal e bloqueio de venda). O DNS só muda no M10; depois da primeira operação nova, voltar o DNS ao legado **não** é rollback seguro.
- **Não publicar** a vNext incompleta a alunos reais. O Go/No-Go do M10 exige QA, segurança, auth, financeiro, certificados, PWA, backups e smoke tests.
