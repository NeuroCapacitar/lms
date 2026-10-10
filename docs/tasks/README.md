# Backlog de tarefas — como executar

**Estado:** plano vigente (2026-10-10); nenhuma tarefa executada. Marcos e gates: [roadmap](../roadmap.md). Estado real: [STATUS](../implementation/STATUS.md).

| Marco | Arquivo |
|---|---|
| M0 Fundação e spikes | [M0-fundacao.md](M0-fundacao.md) |
| M1 Identidade e Staff | [M1-identidade.md](M1-identidade.md) |
| M2 Catálogo e autoria | [M2-catalogo-autoria.md](M2-catalogo-autoria.md) |
| M3 Jornada gratuita | [M3-jornada-gratuita.md](M3-jornada-gratuita.md) |
| M4 Assíncrono e e-mail | [M4-assincrono-email.md](M4-assincrono-email.md) |
| M5 Aprendizagem completa | [M5-aprendizagem-completa.md](M5-aprendizagem-completa.md) |
| M6 Financeiro | [M6-financeiro.md](M6-financeiro.md) |
| M7 Certificados | [M7-certificados.md](M7-certificados.md) |
| M8 PWA | [M8-pwa.md](M8-pwa.md) |
| M9 Operação e refinamento | [M9-operacao-refinamento.md](M9-operacao-refinamento.md) |
| M10 Migração e lançamento | [M10-migracao-lancamento.md](M10-migracao-lancamento.md) |

## Como executar uma tarefa (para quem está começando)

1. **Autorização:** só faça a tarefa para a qual recebeu autorização explícita, por ID. Nunca avance sozinho para a próxima.
2. **Antes (DoR):** leia a tarefa, as ADRs e a especificação que ela cita; veja `STATUS.md`; confirme dependências concluídas; inspecione o checkout real (`git status`, `package.json`, testes existentes).
3. **Implemente em pequeno:** um comportamento testável por PR. Escreva os testes da regra e os casos negativos (acesso cruzado, dado duplicado, falha do provider). Efeitos externos só depois do commit no banco.
4. **Valide:** rode primeiro o teste focado, depois as verificações existentes. Registre comando, resultado e SHA. Se algo não puder rodar (serviço ou ambiente ausente), diga exatamente o que faltou: o status é `implemented` ou `blocked`, nunca `verified`.
5. **Revise o diff:** segredos, dados pessoais, permissões extras, migrations, mudança de contrato. Atualize a documentação só se o contrato mudou.
6. **Registre:** atualize o `STATUS.md` somente com evidência. Relate o próximo ID recomendado, **sem executá-lo**.
7. **Quando algo não bate:** pare. Se uma decisão parece errada ou um spike falha, junte a evidência e peça decisão ao responsável. Não contorne.

## Regras comuns de qualidade

- Cada PR relevante: TypeScript, Oxlint/Oxfmt, Vitest, Postgres 18 real onde houver persistência ou concorrência, Playwright seletivo, Gitleaks, Knip, dependency-cruiser e build do Worker (nomes planejados; confirme no `package.json`).
- Banco: migrations SQL forward-only e revisadas à mão; role de migration separada; nada destrutivo em Staging ou Production.
- Nunca registre credenciais, dados reais de alunos ou dumps de Production em código, testes, logs, prompts ou artifacts.
- Production é sempre manual, com preflight e autorização explícita.
- **CLIs Cloudflare e Neon: só o perfil `neurocapacitar`** (`neurocapacitar.projetos@gmail.com`), com `--profile neurocapacitar` em todo comando remoto e identidade verificada antes (ver [cli-profiles](../operations/cli-profiles.md), ADR 0025).

## Formato de cada tarefa

`ID — título · dependências · estado · objetivo · passos · testes · aceite · fora do escopo/cuidados`. Os passos e nomes de arquivo são sugestões; o contrato está nas ADRs e na especificação. Use [TEMPLATE-TAREFA.md](../implementation/TEMPLATE-TAREFA.md) para registrar a execução.
