# ADR-0024 — Processo enxuto para 1 dev com IA: regra de corte, exceções deliberadas e spikes no M0

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q6, Q7, Q10, Q11, Q57, Q58, Q59 (e Q3)
- **Substitui:** pacote de documentação B1–B16 (vira histórico, `superseded`)

## Contexto

Em 4 meses, um autor humano produziu no legado cerca de 133 mil linhas de código, 100 mil de teste e 307 arquivos `.md`, para um produto de poucos alunos; testes liam prosa e YAML (evidência: L1 §0, §8.2). Hoje: 1 dev (júnior ou pleno) com agentes de IA, 4 h por dia, cerca de 20 alunos e 2 cursos novos, sem prazo. O big-bang (Q3) obriga a v1 inteira antes de Production.

## Decisão

- **Regra de corte da v1:** entra só o que for (a) obrigação legal ou de segurança, (b) paridade com o legado, (c) risco de incidente de dinheiro, acesso ou privacidade, ou (d) valor pedagógico claro a baixo custo.
- **Exceções deliberadas** (Q14, Q15, Q16): PWA offline (ADR-0019), editor visual de certificado (ADR-0017), marketing, banners e mídia de login (ADR-0018).
- Tecnologia chata e documentada vence a elegante; toda peça móvel nova se justifica por dinheiro, acesso, privacidade ou durabilidade. O responsável revisa e é dono de Production.
- Documentação enxuta: `AGENTS.md` curto, `PRODUCT`, `CONTEXT` e `DESIGN` curtos, arquitetura em 1 página, domínio e contratos, cerca de 20 ADRs, `STATUS.md` único, roadmap M0–M10 e tarefas. Sem testes sobre prosa ou YAML.
- Ordem de risco: núcleo cedo em Staging; adapters extras, PWA offline e editor de certificado no fim. Sem prazos inventados.
- **Spikes no M0** (cada um vira ADR curta, passou ou reabrir): 1 Better Auth, magic link, Hono, Hyperdrive, `pg` e Drizzle no workerd; 2 Bun 1.4, plugin de testes Cloudflare e dependency-cruiser sob TS 7; 3 latência Neon São Paulo e orçamento de acordar o banco; 4 player JMVStream real; 5 webhook Asaas em sandbox; 6 Browser Run com Lexend Deca; 7 imagens com fallback; 8 HTMLRewriter com validadores LinkedIn e Meta; 9 `evlog` e Sentry 11.

## Consequências

As exceções aumentam o escopo e o tempo até Production, e o legado fica congelado por tempo indefinido (custos continuam). Escopo novo exige evidência, opções e aprovação explícita.

## Como validar

`STATUS.md` registra cada spike com resultado real. Revisar a regra de corte a cada marco; a v1 só segue ao Go-Live com os spikes resolvidos.
