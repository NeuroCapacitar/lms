# ADR-0021 — Repositório GitHub Free privado e CI em duas camadas

- **Estado:** accepted-conditional
- **Data:** 2026-10-10
- **Origem:** Q49, Q50 (Q20)
- **Substitui:** gates do legado (CodeQL, Biome/Ultracite, CodeRabbit)

## Contexto

No GitHub Free, repositório privado não tem branch protection, rulesets, environments com revisores, secrets de organização, secret scanning nem CodeQL; há 2.000 min/mês de Actions (evidência: W2 §8.1). O legado era público, o que dava esses controles de graça, mas guardava credenciais de migration de Production em workflow comum (L1 §5.2). Sua CI tinha mediana de 9,6 min e 43% de falhas recentes, e testes sobre prosa e YAML (L1 §5.3, §8.2). O motivo original da conta pessoal não está documentado.

## Decisão

- **Base:** repositório privado no GitHub Free. **Realizado em 2026-10-10:** criado na organização, `NeuroCapacitar/lms` (opção B da Q49), mantendo os mesmos limites do Free. Não assumir branch protection nem required checks como barreira.
- **Camada bloqueante:** TypeScript, Oxlint e Oxfmt, Vitest (unitário e PG18 real), build real do Worker, Playwright de fumaça, Gitleaks CLI, Knip, dependency-cruiser.
- **Camada consultiva:** Semgrep CE, actionlint e zizmor ao mudar workflow, Renovate com espera de 7 a 14 dias.
- **Retirados:** Socket, Scorecard, Graphify, CodeRabbit, CodeQL.
- Segredos de deploy e migration de Production ficam fora de workflows comuns; Production é publicada manualmente. Workers Builds só com `versions upload`.

## Consequências

Os controles viram disciplina e checagem local, não bloqueio da plataforma. Gitleaks via CLI (sem a action, que exige licença para organizações); Dependabot não faz security updates para Bun, então Renovate cobre. Minutos de Actions são limitados: manter job único e enxuto. Higiene do repositório público do legado fica como ação separada do responsável.

## Como validar

spike M0-11 (dependency-cruiser sob TS 7). Medir minutos mensais de Actions no primeiro mês e a duração da CI. Verificar que nenhum segredo de Production existe no GitHub e que `gitleaks` roda no hook e na CI.
