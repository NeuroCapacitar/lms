# Como contribuir

Repositório privado. Só colaboradores autorizados pelo responsável do produto. Leia antes de qualquer mudança: [`AGENTS.md`](AGENTS.md), [`docs/implementation/STATUS.md`](docs/implementation/STATUS.md) e a tarefa em [`docs/tasks/`](docs/tasks/README.md).

## Fluxo

1. Trabalhe só na tarefa autorizada (um ID por vez), em uma branch de feature (`feat/...`, `fix/...`). Não faça commit direto em `main` nem em `staging`.
2. Antes de abrir o PR, rode `bun run verify:quick` e confira o diff (nenhum segredo, dado pessoal real ou arquivo alheio).
3. Abra o PR com o [modelo](.github/PULL_REQUEST_TEMPLATE.md): ID da tarefa, comandos executados e resultados reais, riscos e o que **não** foi testado.
4. O GitHub Free privado **não** impõe revisão nem checks obrigatórios: a revisão humana é parte do processo.

## Regras

- Segredos só em `.dev.vars` (ignorado pelo Git) ou nos segredos do ambiente. Nunca em código, testes, logs ou prompts.
- Production nunca é publicada por commit ou CI; é manual, com preflight e autorização explícita.
- Pré-requisitos: Bun 1.4.2 e Node 24.21.0 (ver `.node-version`).
