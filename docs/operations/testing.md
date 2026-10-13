# Testes

**Estado:** vigente desde o M0-06 (2026-10-10). Decisões: [ADR 0021](../adr/0021-repositorio-github-free-ci-duas-camadas.md), [ADR 0026](../adr/0026-spike-m0-11-bun-vitest-dependency-cruiser.md). Gates de CI: [README](../../README.md#matriz-de-gates-do-ci-m0-05).

## Projetos Vitest (`vitest.config.ts`)

| Projeto | Onde roda | Arquivos | Comando |
|---|---|---|---|
| `unit` | Node | `scripts/**/*.test.ts`, `src/**/*.test.ts`, `test/unit/**/*.test.ts` | `bun run test:unit` |
| `workers` | **workerd** (`@cloudflare/vitest-plugin`), Worker **construído** (`dist/hub`), Hyperdrive local apontando ao Postgres de teste | `test/workers/**/*.test.ts` | `bun run test:workers` (faz `bun run build` antes) |
| `pg` | Node, **Postgres 18 real** | `test/pg/**/*.test.ts` | `bun run test:pg` |

`bun run test` roda os três (com `build` antes). Falha em um projeto não esconde os outros: o Vitest roda todos e o CI tem um passo por projeto. `bun run test:e2e` roda o smoke do Playwright (Chromium) contra o build servido pelo `vite preview` com o banco de teste.

## Contraste e acessibilidade (M0-07)

- `test/unit/contrast.test.ts` lê `src/web/styles/tokens.css`, resolve as camadas de tokens em cada tema e calcula a razão de contraste WCAG (`test/helpers/color.ts`, OKLCH → sRGB, sem dependência). **Para proteger um novo par de cores, acrescente-o à lista `PAIRS`**: texto ≥ 4,5:1; borda de controle, ícone e anel de foco ≥ 3:1.
- `e2e/accessibility.spec.ts` roda o axe (WCAG 2.0/2.1/2.2 A e AA) nas páginas públicas nos temas claro, escuro e do sistema, o fluxo só por teclado e as regras de tema sem script inline, mesma origem e ausência de animação automática (WCAG 2.2.2). O axe não substitui leitor de tela real nem Firefox/Safari, que ficam para verificação manual.
- Tela nova: acrescente a rota à lista `PAGES` do spec.

## Banco de teste (Postgres 18 que pode ser destruído)

- **CI:** serviço `postgres:18` do Actions, `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`.
- **Local:** projeto Neon Free `hub-test` (São Paulo), URL em `.env.test` (ignorado pelo Git; ver `.env.example`). Esta máquina não tem Docker.
- Os testes **recusam** `TEST_DATABASE_URL` que aponte para o host de Development, Staging ou Production (`test/helpers/pg-schema.ts`). Nunca usar esses bancos em testes.
- **Isolamento:** `createTestSchema()` cria um schema `t_<aleatório>` por arquivo de teste, aplica as migrations do projeto nele (journal no mesmo schema) e `drop()` o remove. Arquivos em paralelo não se enxergam.
- Testes de corrida de referência em `test/pg/race.pg.test.ts` (N inserções paralelas na mesma chave única: exatamente uma vence; duas transações com `FOR UPDATE` se serializam sem perder atualização). Servem de modelo para matrícula, pagamento e certificado.

## Por que o projeto `workers` testa o Worker construído

No workerd, o `pg` (CommonJS) falha ao carregar no pipeline de módulos do plugin (`pg-protocol` resolve para `esm/index.js`, um arquivo ESM dentro de pacote CommonJS). O Worker construído já traz o `pg` empacotado e é exatamente o que vai para produção; o arquivo de teste não importa código do projeto, só chama o `fetch` do Worker. Consequência: `dist/hub` precisa estar construído (o script `test:workers` e o CI garantem).

## Prova de que os testes do Worker usam o banco de teste

Com `TEST_DATABASE_URL` inválida, o teste `health/ready` do projeto `workers` **falha**; portanto o binding Hyperdrive local segue a variável de teste, e não o `.env` de desenvolvimento.

## Outros testes

`bun run test:db` (node:test, só Development): roles de migração e runtime no banco de dev (ver [banco e migrações](database-and-migrations.md)); precisa de credenciais e não roda no CI.

## Regras

Persistência sempre em PG18 real (mock não prova SQL nem concorrência); sem Neon de Production nem provedores reais nos PRs; sem teste sobre prosa de documentação ou YAML.

## Identidade (M1-01)

- `test/pg/auth.pg.test.ts` usa a **mesma** `authOptions` de produção com o plugin `testUtils` do Better Auth (`test/helpers/auth.ts`), sobre um schema isolado do Postgres 18, e chama as rotas reais por `authRoutes()` montadas em `/api`. Sessão criada sem passar por método de login.
- **Armadilha:** com `NODE_ENV=test` (que o Vitest define) ou a variável `TEST`, o Better Auth **desliga a checagem de origem**; por isso `authOptions` fixa `disableOriginCheck: false`. Nunca defina `TEST` ou `NODE_ENV=test` no Worker.
- `src/server/auth/schema.test.ts` confere o schema Drizzle contra `getAuthTables()` (com `validateSchema: false` nada o confere em execução). Ao atualizar o Better Auth, rode-o primeiro.
- `tsconfig.integration.json` tipa os testes que importam `src/` com resolução `bundler` e tipos do Node.

## Pedido e confirmação de link (M1-06)

- `test/pg/link.pg.test.ts` monta `authRoutes({ emailSender, isStaffEmail, turnstileFetch, limits })` com substitutos (e-mail falso, Staff simulada, Turnstile simulado, limites pequenos) sobre Postgres 18 real. Nunca chama a rede nem envia e-mail.
- `e2e/login.spec.ts` simula o widget do Turnstile (rota do script) e as respostas da API; o build do Playwright usa a chave de **teste** da Cloudflare (`playwright.config.ts`).
- Para ver o link no desenvolvimento local, rode `bun run dev` sem `RESEND_API_KEY`: o link aparece no terminal (`[dev] e-mail para …`). Em Staging e Production a falta da chave é erro.

## CSRF, cabeçalhos e reautenticação (M1-05)

- `test/helpers/api-app.ts` monta `/api` como no Worker (cabeçalhos de segurança, CSRF, rotas de identidade): os testes de rota usam `apiApp()`, e toda mutação deles envia `Origin` e `Content-Type: application/json`.
- `test/pg/reauth.pg.test.ts` cobre o desafio ligado à sessão, o guard `requireRecentAuth` e a diferença entre `forbidden` e `reauth_required`.
- `e2e/security.spec.ts` confere os cabeçalhos de `public/_headers` e **zero violações de CSP** (`securitypolicyviolation`) em cada tela; tela nova entra na lista. O Turnstile e o Sentry são simulados.
- Os testes negativos de CSRF no navegador não enviam corpo: o proxy do `vite preview` falha de forma intermitente quando a resposta chega antes de o corpo ser lido (só local).
- Resposta `no-store` cujo corpo a interface não lê deixa a requisição aberta no Chromium e trava `waitForLoadState('networkidle')`: leia ou cancele o corpo.

## Convite de Staff e bootstrap (M1-04)

- `test/pg/staff-invitation.pg.test.ts` usa `apiApp()` e monta o Admin com **prova de reautenticação inserida direto** em `reauth_proof` (o fluxo do link já tem teste próprio em `reauth.pg.test.ts`). Aceite de ponta a ponta exige um usuário com e-mail verificado e uma sessão do próprio convidado.
- Testes de corrida precisam de **conexões separadas** (`openDatabase` por chamada): `tools.db` é uma conexão só e serializaria as duas transações, escondendo a corrida.
- O Drizzle embrulha o erro do `pg`: o nome da constraint violada fica em `error.cause` (ver `expectViolation`).
- `e2e/convite.spec.ts` simula a API; o aceite real fica coberto pelos testes em Postgres.

## Suspensão e corrida com login (M1-08)

- `test/pg/suspension.pg.test.ts` prova a corrida **sem depender de sorte**: duas conexões brutas (`database.client()`), uma segurando a transação aberta, e a outra tentando o login (ou a suspensão); confere que a segunda ESPERA (`settled` falso após 300 ms) e depois o resultado. Há também 15 rodadas de corrida real em conexões separadas.
- Para provar o gatilho sem passar pelo Better Auth, insere-se a sessão direto com o Drizzle; o erro do `pg` vem em `error.cause` (`code` 23001, mensagem `account_suspended`).

## Senha e Google (M1-07)

- `test/pg/methods.pg.test.ts` simula o Google **só no endpoint de token** (`oauth2.googleapis.com/token`) com `vi.spyOn(globalThis, 'fetch')`; o `id_token` é um JWT sem assinatura (o Better Auth decodifica o que vem direto do Google). O ciclo completo (gerar o endereço, "voltar" com `state` e os cookies do início, ler o redirecionamento e as contas) roda contra as rotas reais.
- Toda falha de login deve ter a MESMA resposta: compare o corpo/redirecionamento da falha de Staff e suspensa com o de senha errada.
- Os testes que abrem sessão por `testUtils` usam `isStaffUser: async () => false` (não passam por método de login); o gancho "Staff só por link" é exercitado pelas rotas, que usam a consulta real.
- `e2e/seguranca.spec.ts` simula a API e o Turnstile; o fluxo real do Google só roda com as credenciais do cliente.

## Aceite de termos (M1-09)

- A migration `0008` semeia duas versões PROVISÓRIAS (Termos e Política). `createTestSchema()` as **remove por padrão**: sem versão vigente o portão `requireAcceptedTerms` abre, então os testes dos outros marcos não precisam registrar aceite. Os testes do M1-09 usam `createTestSchema({ keepLegalSeeds: true })`.
- Rota nova de área logada deve ficar sob `/me/*` ou `/staff/*` (o portão cobre os dois prefixos) ou receber `requireAcceptedTerms()`; acrescente a rota à matriz de `test/pg/legal.pg.test.ts`.
- O portão é o primeiro `getSession` da requisição e repassa os cookies renovados; um teste de cookie rolling falha se isso for removido.
- `e2e/termos.spec.ts` simula `/api/me/legal`; telas de área logada novas devem usar `<RequireTerms>`.

## Equipe e casca da Staff (M1-10)

- `test/pg/team.pg.test.ts` prova o servidor (lista, grants, saída do Suporte, reautenticação, auditoria). **O `audit_log` é append-only e não se limpa entre testes**: filtre sempre pelo alvo (`targetId`), senão uma linha de outro teste engana a asserção.
- `e2e/equipe.spec.ts` usa a API simulada **com estado** (convites, grants e suspensão mudam o que a tela recebe depois). Caixas de permissão só mudam depois da resposta do servidor: use `click()`, não `uncheck()`, e espere o resultado.
- Seletores por nome ficam ambíguos quando o mesmo e-mail aparece em rótulo e botões: use `exact: true` ou escopo por região.
- A casca da Staff substitui o layout público nas rotas `/staff/*` (`__root.tsx`); tela nova da Staff entra como filha de `staff.tsx` e ganha o item na navegação por capability.

## Catálogo (M2-01)

- `test/pg/catalog.pg.test.ts` prova duas camadas: **invariantes no banco** (CHECK e gatilhos, escritos direto com o Drizzle, que embrulha o erro do `pg`: a mensagem fica em `cause`) e **comandos pela API** (capability por rota). Toda regra comercial nova entra nas duas.
- O `audit_log` é append-only: filtre pelo `targetId` do curso ou da oferta.
- A mensagem de um gatilho (`slug_locked`, `offer_archived`...) é o contrato entre o banco e `catalog-store.ts`; mude os dois juntos.

## Currículo vivo (M2-02)

- `test/pg/curriculum.pg.test.ts` limpa com `TRUNCATE … CASCADE`: os gatilhos do publicado recusam `DELETE` (e a role de runtime não tem `TRUNCATE`). Não use `db.delete(lesson)` nem `db.delete(module)` em teste.
- **Falha injetada sem seam em produção:** crie, na conexão do schema de teste (`database.client()`), um gatilho `BEFORE INSERT` que estoure para um título marcado; ele derruba a publicação DEPOIS de módulos já aplicados. Remova gatilho e função no `finally`.
- **Leitura com a publicação presa:** um gatilho `BEFORE UPDATE` pede `pg_advisory_xact_lock_shared(N)` e o teste segura `pg_advisory_lock(N)` em outra conexão (só em teste; o produto não usa advisory lock). Confirme que a publicação está presa (`done` falso após ~600 ms) antes de ler.
- Cenários longos pela API ficam lentos contra o Neon remoto (cada chamada abre conexão): dê um timeout generoso ao teste; no CI (Postgres local) é rápido.

## Texto rico (M2-05)

- **Qualquer rota nova que grave conteúdo rico** valida com `richTextSchema` (a allowlist de `src/features/content/rich-text.ts`) e ganha casos maliciosos em `test/pg/rich-text.pg.test.ts` (400 e nada gravado). O componente de exibição valida de novo (`RichTextView`).
- **CSP e editor:** o Tiptap NÃO pode injetar `<style>` (`injectCSS: false`; CSS mínimo em `app.css`). `e2e/texto-rico.spec.ts` falha se a CSP for violada: rode-o ao atualizar o Tiptap.
- **Testes do editor:** depois de clicar num botão da barra, espere o foco voltar ao editor (`toBeFocused`) antes de digitar (o `focus()` do Tiptap é assíncrono) e espere a pré-visualização refletir antes de ler o JSON.
- Atualizar o Tiptap pode mudar os atributos que o `getJSON()` emite (ex.: o Link v3 grava `title: null`): o esquema é estrito de propósito; ajuste-o e o teste de ida e volta.
- Os testes de XSS em Playwright assertam que **nenhum diálogo** (`alert`) abre e que nenhum `script`, `img`, `svg` ou `iframe` é criado na pré-visualização.

## Course Builder (M2-03)

- `e2e/cursos.spec.ts` simula a API com `page.route` e um estado em memória (como `e2e/equipe.spec.ts`); a regra real está nos testes PG do M2-01 e M2-02. Ao mudar um contrato da API de cursos, atualize o simulador junto.
- Cada permissão tem seu cenário (Admin, só `course.edit`, só leitura): a tela esconde, mas **o servidor é quem decide**; teste a recusa pela API nos testes PG, não pelo botão ausente.
- Reordenar e mover são testados pelos botões e pelo `aria-live`; confirme que **nada vai ao servidor antes de "Salvar rascunho"** e que o `expectedRev` enviado é o lido.
- O resumo de publicação é calculado no servidor (`publish-preview`) sobre o rascunho salvo; mude `curriculum-diff.ts` com o teste puro e o caso "pré-publicação" do PG.

## Curso demonstrativo (M2-07)

- Teste que precisa de curso publicado com módulos em D+0, D+7 e D+14 usa `createDemoCourse(db)` (`test/helpers/demo-course.ts`) em vez de montar dados à mão: é o mesmo conteúdo do seed de Dev e Staging.
- `bun run seed:demo <dev|staging>` é ensaio; `--apply` grava. Exige `DATABASE_URL_MIGRATION` direta do ambiente e as migrations já aplicadas. Production é recusada (teste em `scripts/seed-demo-core.test.ts`).
- Conteúdo só sintético: não coloque texto, nome ou e-mail reais no curso demonstrativo.

## Catálogo do aluno (M2-04)

- Todo esquema Zod criado no **carregamento do módulo de uma rota** (`validateSearch`) depende de `src/web/zod-config.ts` ser o PRIMEIRO import de `main.tsx` (JIT desligado, senão há violação de CSP `script-src eval`). Toda tela nova entra na bateria de CSP de `e2e/security.spec.ts`; ela pegou este problema em 13 telas de uma vez.
- `test/pg/student-catalog.pg.test.ts` monta cursos pelas funções de domínio (autor nulo) e confere a resposta **como texto** contra uma lista de termos proibidos (título interno, autoria, estado, ids). Ao acrescentar campo ao `CatalogCourseDto`, atualize o teste de igualdade exata.
- A navegação pública tem ordem de Tab fixa em `e2e/accessibility.spec.ts`: novo link da navegação exige atualizar a lista.

## Página pública do curso (M2-06)

- O HTMLRewriter só existe no workerd: teste-o em `test/workers/` (com `injectMeta` ou pelo Worker construído) e deixe a LÓGICA de escolha (publicado, 404, Host forjado, falha de banco) em `test/pg/public-course.pg.test.ts`, onde `serveCoursePage` recebe `inject` de teste.
- **Não faça o teste do workerd nem o e2e consultarem o banco em volume**: as conexões seguidas ao Neon de teste, pelo Hyperdrive local do miniflare, podem derrubar o processo com `ECONNRESET` não tratado. Nos testes de tela use o documento da raiz (`route.fetch` da `/`), e mantenha poucas requisições reais a `/cursos/:slug`.
- A resposta 404 de curso inexistente, rascunho, arquivado e sem currículo tem de ser **byte a byte a mesma**: ao mudar a página, atualize o teste de igualdade.
- **Manual, após o deploy em Staging:** abrir a URL de um curso publicado nos validadores do LinkedIn (Post Inspector) e do Meta (Sharing Debugger), conferir título, descrição e imagem e anotar o resultado no `STATUS.md`. O cache deles guarda a prévia: use "Scrape Again"/"Inspect" ao mudar.

## Entitlement e Enrollment (M3-01)

- Concorrência de concessão se prova com **conexões separadas** (`openDatabase` por tentativa), não com uma conexão só: uma conexão serializa tudo e não prova a corrida. Os testes confirmam UMA matrícula, UMA âncora e a idempotência por `source_ref`.
- Toda decisão de acesso nos testes passa por `resolveAccess(db, pessoa, curso, agora)` com `agora` EXPLÍCITO; não use `Date.now()` nem tarefa agendada para "fazer expirar".
- Para testar uma violação de gatilho, use SQL direto (`tools.db.execute`) e confira a mensagem em `cause` (`anchor_locked`, `entitlement_immutable`, `revoked_is_final`...). A limpeza dos testes deve truncar `entitlement, enrollment` ANTES de `user` e `course` (as FKs são `restrict`).

## Inscrição gratuita (M3-02)

- **Concorrência com RELÓGIO DEFASADO:** além de várias conexões simultâneas, teste a decisão com relógios diferentes por pedido (`clock` injetável em `enrollInFreeOffer`). Um teste com conexões separadas e o mesmo relógio passou isolado e falhou sob carga: o bug só aparece quando o perdedor da fila está "no passado" em relação ao direito do vencedor.
- Todo teste que afirma "exatamente um direito" deve conferir também a CONTAGEM no banco, não só o código HTTP.
- O corpo de erro de oferta indisponível tem de ser **byte a byte o mesmo** para oferta pausada, arquivada, em rascunho, de outro curso e inexistente (sem vazamento do que existe).
- `returnTo`: qualquer mudança em `safeReturnTo` ganha caso malicioso na tabela de `return-to.test.ts`; o e2e confere que valor externo, `//host`, `/api/*` e `javascript:` nunca são guardados nem seguidos, e que o valor adulterado no `localStorage` é revalidado na leitura.
- A regra `acesso-nao-importa-pagamentos` é provada de verdade criando um import proibido temporário e rodando `bun run arch` (deve falhar); `scripts/arch-rules.test.ts` confere o contrato da regra.

## Estudo: drip e sequência (M3-03)

- **Relógio injetado, nunca espera:** as rotas de estudo recebem `clock` (`apiApp({ clock })`). Teste "daqui a N dias" mudando o relógio e confira a FRONTEIRA do dia civil de São Paulo (02:59:59.999Z bloqueia, 03:00:00.000Z abre). No Playwright use `page.clock.setFixedTime` (só afeta o rótulo; quem decide é o servidor).
- **Vazamento de conteúdo:** a resposta de aula bloqueada e o mapa são conferidos **como texto**: sem o campo `body`, sem o título da aula bloqueada e sem o texto das aulas. Ao acrescentar campo ao mapa, atualize essa lista.
- Para criar conclusões em teste, insira em `lesson_completion` direto (a rota de escrita é do M3-04); o banco exige matrícula e a aula do mesmo curso, e a linha é append-only: a limpeza deve `TRUNCATE` `lesson_completion` ANTES de `enrollment` e `lesson`.
- Espaços em texto formado por JSX: título e nota (`(libera em ...)`, `— motivo`) precisam de `{' '}` entre eles, senão o nome acessível sai colado ("Aprofundando(libera").

## Conclusão de aula e do curso (M3-04)

- Todo `POST` da API exige `content-type: application/json` (CSRF próprio), **mesmo sem corpo**: nos testes envie `{}`; sem isso a resposta é 415 e o teste "não grava nada" passa pelo motivo errado.
- Conclusão simultânea se prova com **a mesma aula várias vezes** (uma só `course_completion`, um só `courseJustCompleted`) e com **aulas diferentes** no curso livre (todas 201, uma só conclusão do curso). Confira sempre a CONTAGEM no banco.
- Staff sem matrícula não grava progresso: o teste dá o papel, **entra de novo** (dar papel encerra as sessões antigas) e espera 403 sem linha em `lesson_completion`, `enrollment` nem `course_completion`.
- A limpeza trunca `course_completion` e `lesson_completion` ANTES de `enrollment` e `lesson` (FKs `restrict`, linhas append-only).
- **E2E e banco real:** muitas requisições reais ao Neon de teste derrubam o preview local com `ECONNRESET` não tratado. Mantenha UMA requisição real (as meta tags do curso) e stube todo o resto.

## Matrícula manual e inscritos (M3-06)

- **Cada capability tem o seu teste de negação direto pela API:** anônimo 401, aluno 403, Suporte SEM grant 403 em TODAS as escritas e 200 na lista; `access.grant` não ajusta prazo e `enrollment.support_edit` não matricula. Esconder o botão na tela nunca é a barreira.
- Quem recebe papel ou grant **tem de entrar de novo** antes de chamar a API (dar papel encerra as sessões antigas): o helper `newStaff` do teste concede e só então faz o login.
- Os testes de auditoria **filtram por alvo** (`targetId`): o `audit_log` é append-only e não é truncado entre os testes.
- O "sem Order nem Payment" é conferido olhando o catálogo do banco (nenhuma tabela `order`, `payment` ou `checkout` existe neste marco).
- Qualquer layout novo da casca da Staff entra no teste de 375 px: o cabeçalho já estourou a largura por causa do seletor de tema.

## Prévia de aluno da Staff (M3-07)

- **Sem efeito colateral se prova no BANCO:** conte as linhas de `entitlement`, `enrollment`, `lesson_completion`, `course_completion` e `audit_log` antes e depois de percorrer o curso inteiro na prévia; têm de ser iguais (e zero para uma Staff sem matrícula).
- **"Mesmo formato" se prova comparando as chaves** da resposta da prévia com as da resposta real do aluno (mapa, módulo, aula e a aula inteira): a prévia acrescenta só `preview: true`. Ao acrescentar campo ao mapa ou à aula, o teste pega a divergência.
- **Só leitura:** teste POST, PUT, PATCH e DELETE em cada caminho da prévia (inclusive um `/complete` inventado): têm de dar 404, e a contagem de linhas não muda.
- No e2e, a tela da prévia não pode chamar nenhuma rota `/api/courses/*` nem `/api/lessons/*` (as do aluno) nem enviar pedido de escrita; o botão "Concluir aula" fica desabilitado com descrição acessível.
- As telas de estudo são UMA só (`src/web/study`, modo aluno ou prévia): mudança nelas roda os specs `estudo` e `previa` juntos.

## Jornada E2E gratuita (M3-05)

- **O que é:** `bun run test:journey` sobe `e2e-journey/server.ts` (a API REAL `createApp` + build da SPA + um schema novo e migrado no Postgres de teste) e roda `e2e-journey/jornada.spec.ts` em Chromium, em **uma sequência só** (`workers: 1`, sem retentativa: o limite de 3 pedidos de link por e-mail em 10 minutos faz parte do que se prova; o e-mail da aluna é aleatório por execução). Exige `TEST_DATABASE_URL`.
- **O que é falso:** só e-mail (caixa em memória lida por `/__test/link`), Turnstile (aprovado sem rede) e o relógio do servidor (`/__test/advance?days=N`). Os endpoints `/__test/*` **existem só em `e2e-journey/server.ts`**; nunca os leve para `src/`.
- **Executado em 2026-10-12 (ver o registro "Gate do M2 e do M3 no Staging" no STATUS).** Lições: o captcha real não passa no navegador embutido (o responsável pede o link no Chrome dele e cola o endereço; o painel só abre o link e clica em "Entrar"); a conta de teste nova **não tem papel de Staff** (Suporte só por convite), então as ações de Staff foram feitas pela conta Admin do projeto; o relógio do Staging é o real, então a conclusão do curso exige esperar o D+14.
- **Roteiro EM STAGING (passo assistido; só com autorização explícita para migrations, deploy e segredo):** (1) aplicar as migrations 0009 a 0014 e o seed (`bun run seed:demo staging --apply`) com o perfil `neurocapacitar`; (2) deploy do Worker pelo workflow `deploy-staging.yml`; (3) incluir um e-mail de TESTE na lista permitida do Staging (`EMAIL_ALLOWLIST`, Worker Secret); (4) percorrer à mão os 10 passos da jornada com essa caixa (o link chega ao e-mail de teste; é o passo assistido), uma conta de Suporte com grant e a aluna sintética; (5) medir a latência (o DevTools ou o log da requisição) e conferir nos Workers Logs que o `requestId` aparece e que não há e-mail nem token; (6) anotar no STATUS comandos, resultados e o SHA do deploy. Nunca use pessoa nem e-mail reais.
- **Quando a jornada falha:** abra `test-results/*/trace.zip` (`bun x playwright show-trace`). Rótulos de botão com o nome da pessoa não podem supor nome preenchido (quem entra por link pode ter nome vazio).
- **A jornada já achou 2 defeitos que os testes isolados não achavam** (id de correlação mascarado no log; ausência do botão de sair). Ao mudar login, sessão, termos ou logs, rode-a.

## Outbox e inbox (M4-01)

- `test/pg/outbox.pg.test.ts` roda em PG18 real: claim concorrente com DUAS conexões, lease expirado (o tempo é o `now()` do banco; o teste usa lease de 50 ms e espera 150 ms), fencing, backoff, esgotamento para `dead`, dedupe, rollback sem intenção órfã e retenção. Para provar a corrida de verdade, cada claim concorrente usa um cliente `pg` próprio (o mesmo cliente serializa as consultas).
- Ao criar um `kind` novo: registre-o em `src/features/async/intents.ts` com o payload **só de UUIDs** (`intentPayload`); o teste do contrato falha se o payload aceitar campo a mais.
- `enqueueIntent` só compila com o `tx` de `db.transaction`. Nunca contorne com `as never`: a execução também recusa.

## Consumidor da Queue (M4-02)

- `test/pg/consumer.pg.test.ts` testa o consumidor com mensagens FALSAS (`FakeMessage`) e o Postgres real: a Queue só carrega o id, então o comportamento que importa (claim, fencing, DLQ, kill switch) está no banco. Duplicata simultânea usa duas conexões e um handler que segura o lease.
- `test/workers/queue.test.ts` chama o `queue()` do Worker CONSTRUÍDO (`dist/hub/index.js`, importado no isolate do teste: `exports.default` serializa os argumentos e não aceita um lote). Só caminhos sem banco; rode `bun run build` antes (o `bun run test` já faz).
- Ao criar um `kind`: registre o handler em `src/server/async/handlers.ts` (o tipo obriga), lance `TransientError`/`PermanentError` e NUNCA chame provider dentro de transação PG.
- Ainda NÃO coberto: Queue real (retry com atraso, DLQ por `max_retries`, retenção). Roteiro no Staging, com autorização: criar as filas, aplicar a migration 0016, publicar uma intenção `system.demo`, derrubar o consumidor e ver o Cron (M4-03) concluir.

## Cron de reconciliação (M4-03)

- `test/pg/cron.pg.test.ts` roda os jobs contra o Postgres real com uma Queue FALSA (`send` que registra, falha ou espera um portão). Duas execuções simultâneas usam duas conexões e uma Queue lenta para segurar o lease do job. `handleScheduled` FECHA a conexão que abre: injete `openDb` que devolve uma conexão NOVA a cada ciclo.
- Ao registrar um job novo (M4-08, M5-07, M6-04): adicione-o a `CRON_JOBS` com uma `probe` barata (uma consulta `exists`) e teste: sem trabalho (pula), com trabalho (roda e grava `job_run`), lança (não derruba os outros) e sobreposição.
- O preflight recusa qualquer cron diferente de `*/30 * * * *`. Aumentar a frequência exige decisão (custo de CU-h do Neon Free), não um ajuste do `wrangler.jsonc`.
- Ainda NÃO medido: o consumo de CU-h do Neon pelo Cron. Roteiro no Staging, com autorização: aplicar as migrations 0015 a 0017, criar as filas, publicar o Worker, descartar a mensagem de uma intenção (ou deixar o publish falhar) e conferir que o Cron a conclui em até 2 ciclos e que `job_run` mostra a última execução; observar o painel Neon durante a soak.

## Fault matrix (M4-06)

- `test/pg/fault-matrix.pg.test.ts`: um teste por linha, nomeado `F01…F12`. Usa o código real contra o Postgres real; só a Queue (`SimQueue`) e o provider (`FakeProvider`) são simulados. A falha é injetada pelo `plan` do provider (`429`, `500`, `timeout`, `400`, `accept_then_lose_response`) ou por falha de publish.
- **Nova categoria (M5, M6, M7) = novas linhas aqui**, com o próximo número, e a linha no mapa de concorrência da spec. Não crie outra matriz.
- O handler demonstrativo RELÊ o provider antes de repetir: é o padrão que todo handler com efeito externo deve seguir (chave de idempotência = `idempotencyKey` do contexto).
- A matriz NÃO prova exactly-once nem a idempotência de um provider real: isso é teste de contrato com conta real.

## Roteiro do assíncrono no Staging (executado em 2026-10-13, cauda feliz)

1. `neon me --profile neurocapacitar` e `cf auth whoami --profile neurocapacitar`; `wrangler queues create <nome> --profile neurocapacitar` para as 4 filas `hub-staging-*`.
2. `DATABASE_URL_MIGRATION="$(neon connection-string --project-id dry-term-45495258 --pooled false --ssl require --role-name neondb_owner --profile neurocapacitar)" bun run db:migrate staging`.
3. Deploy manual (`gh workflow run deploy-staging.yml --ref main`) e `bun run smoke <url> <sha>`.
4. Intenção sintética: `insert into outbox_message (kind, queue, dedupe_key, payload, correlation_id, available_at)` com `system.demo`, `general`, payload `{"subjectId": "<uuid>"}` e `available_at = now() - interval '10 minutes'`; esperar o Cron (a cada 30 min, em :00 e :30 UTC) e conferir `state = 'delivered'` e `job_run`.
5. Faltam no roteiro: derrubar o consumidor no meio, forçar `max_retries`, ligar o kill switch (`system_flag`) e medir o ciclo ocioso e o CU-h.

## E-mail transacional (M4-04)

- `test/pg/email.pg.test.ts` usa um `ScriptedMailer` (resultado por chamada: aceito, 429, 5xx, timeout, 4xx) e o consumidor REAL; `src/server/email/mailer.test.ts` cobre o `fetch` do Resend por mock. Nenhum teste envia e-mail de verdade.
- Ao criar um template novo: acrescente-o a `EMAIL_TEMPLATES` (alias, variáveis estritas, classe, destinatário), crie e PUBLIQUE o modelo no Resend com o MESMO alias e as variáveis de `expectedVariableNames` (as do contrato mais `NAME`, se usa, e `APP_URL`), e rode `RESEND_API_KEY=<chave do ambiente> bun run email:verify-templates`. Link com token nunca é `queued`.
- Roteiro EM STAGING (com autorização e a chave do Resend do ambiente; só destinatários da `EMAIL_ALLOWLIST`): criar os modelos, aplicar a migration 0018, rodar o verificador, enfileirar um `access-granted` para uma conta de teste e conferir `email_message.state = 'accepted'` e o e-mail na caixa; depois repetir com um endereço fora da lista (deve ficar `blocked`) e conferir que nenhum log contém o endereço.

## Webhook do Resend e supressão (M4-07)

- `test/pg/resend-webhook.pg.test.ts` monta a rota real com o CSRF, assina os corpos com `test/helpers/svix.ts` e processa a inbox com o handler real; `test/workers/webhook.test.ts` cobre a rota no Worker construído. Os segredos de teste do workerd estão em `vitest.config.ts`.
- **Configuração de um ambiente (com autorização e só com o perfil `neurocapacitar`):** (1) no Resend, cadastrar o endpoint `https://<worker>/api/webhooks/resend` assinando SÓ `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` e `email.suppressed` (não assinar `sent`, `opened` nem `clicked`); (2) copiar o segredo do endpoint (`whsec_…`) para `RESEND_WEBHOOK_SECRET`; (3) gerar `EMAIL_HASH_KEY` (≥ 32 caracteres aleatórios; trocá-la invalida as supressões); (4) `wrangler secret put <NOME> --name hub-staging --profile neurocapacitar` para os dois; (5) aplicar a migration 0019. Sem os dois segredos a rota responde 500 e não aceita nada.
- Roteiro EM STAGING: enviar para `delivered@resend.dev` (deve ir a `delivered` no próximo ciclo do Cron) e para `bounced@resend.dev` (bounce permanente: deve criar uma linha em `email_recipient_state` e o próximo e-mail enfileirado para o mesmo endereço virar `suppressed`); conferir que a inbox e os logs não têm endereço.

## Cota do Resend Free (M4-08)

- `test/pg/quota.pg.test.ts` usa uma política PEQUENA (10 por dia, 30 por mês, reserva 2) para ser rápido no Neon remoto; a de produção é `FREE_PLAN_QUOTA` (100 e 3.000, reserva 20). A virada do dia é simulada deslocando o livro-razão e o `available_at` das linhas adiadas; o Cron (`republishJob`) faz o resto.
- Todo handler que fala com um provider com cota deve reservar ANTES, devolver a vaga se o provider não aceitou e lançar `DeferError` (não `TransientError`) quando o motivo é falta de folga: adiar não gasta tentativa, não gera alerta e não manda nada à DLQ.
- Roteiro EM STAGING (com autorização): aplicar a migration 0020, enfileirar uma rajada de `course-available` para contas de teste da allowlist, conferir que só saem as vagas do dia (`select * from email_send_ledger`), que o resto fica `pending` com `available_at` na próxima meia-noite UTC e que o Cron entrega no dia seguinte.

## Operations Center (M4-05)

- `test/pg/operations.pg.test.ts` (foto do estado, autorização de cada rota, auditoria, alertas do Cron e correlação) e `e2e/operacao.spec.ts` (a tela com rotas simuladas e axe). A auditoria é append-only: não dá para truncar; os testes olham só as linhas do próprio alvo (`targetId`).
- Toda ação nova da tela exige: capability conferida no servidor, `requireRecentAuth`, motivo obrigatório e `auditEvent` na MESMA transação da mudança. A tela nunca devolve payload, endereço nem nome: o teste varre o JSON e a página.
- Roteiro EM STAGING (com autorização, depois das migrations 0018 a 0020 e do deploy): (1) abrir `/staff/operacao` como Suporte e como Admin; (2) derrubar um handler (ex.: um `kind` que sempre falha) e ver o item chegar a `dead` e o alerta `dead_letter` no log do Cron; (3) reenfileirar com motivo e conferir a linha em `audit_log`; (4) pausar a fila, ver o alerta de pausa, retomar; (5) esperar o Cron e conferir `ops_alert` no Workers Logs.
