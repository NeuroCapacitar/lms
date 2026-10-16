# Gate M8-04 — roteiro de testes do offline (iPhone, Chromium e WebKit)

> Decide, com evidência, se o **offline do aluno** entra no release (ADR 0019). O código do M8 (M8-01, M8-02, M8-03, M8-05 e M8-06) está pronto e verificado em Chromium; **nada** dele foi provado em Safari/iPhone. **Nunca inferir iOS a partir de emulação.** Sem dados reais: conta sintética, curso demonstrativo, certificado sintético.

## 1. Quem faz o quê

| Quem | O quê |
| --- | --- |
| Agente | Publica o build no Staging e informa o SHA; prepara a conta de teste (inscrição no curso demonstrativo e um certificado sintético); confere o resultado no banco quando o roteiro pedir; registra a decisão no `STATUS.md`. |
| Pessoa com o iPhone (responsável/cliente) | Executa o roteiro abaixo, anota o resultado de cada item e entrega a **gravação de tela** e os **relatórios de `/diagnostico`**. |

Precisa de: um **iPhone físico** (modelo e versão do iOS anotados), um e-mail que a pessoa controle para o link de acesso (sugestão: um endereço com sufixo `+gate` da caixa do projeto; **não** use e-mail de aluno real) e um segundo e-mail para a "outra conta".

## 2. Antes de começar

**Contas de teste JÁ PREPARADAS no Staging (2026-10-16), com `scripts/gate-account.ts`** (só endereços com sufixo `+gate`; Production é recusada):

- **Conta A**: `neurocapacitar.projetos+gate-a@gmail.com`. Matriculada no curso demonstrativo com o drip aberto (todos os módulos), as 5 aulas obrigatórias concluídas, o curso concluído e um **certificado sintético** (nasce em fila; o PDF sai no próximo ciclo do Cron, até ~30 min depois da preparação). A aula opcional **"Leitura complementar" fica em aberto** de propósito: é a que o roteiro conclui sem rede.
- **Conta B**: `neurocapacitar.projetos+gate-b@gmail.com`. Só a matrícula (serve ao passo "outra conta").
- As duas entram pelo **link de acesso** (o e-mail chega na caixa `neurocapacitar.projetos@gmail.com`) e aceitam os termos na primeira vez. Para refazer o estado inicial depois de um teste, peça ao agente para rodar o script de novo (repetível; não duplica).

1. O agente informa: URL do Staging (`https://hub-staging.neurocapacitar-projetos.workers.dev`), **SHA do build** (também aparece no `/diagnostico`) e o e-mail da conta de teste já inscrita.
2. No iPhone: Ajustes → Safari → **Avançado → Dados de sites** (ou Limpar Histórico e Dados de Sites) e remova o que houver do domínio do Staging. Navegação privada **desligada**. Data e hora **automáticas** (ligadas).
3. Abra `…/diagnostico` no Safari e **copie o relatório** (botão "Copiar relatório"): é a linha de base. Esperado: `Bancos IndexedDB (0): nenhum`; `Caches (0): nenhum`.

### Como provar o que ficou no aparelho (sem Mac)

A tela **`/diagnostico`** do app mostra só **nomes e contagens** (nunca conteúdo, e-mail ou id): modo (aba ou app instalado), rede, Service Worker, armazenamento usado e se é persistente, **bancos IndexedDB** (com a contagem de cada tabela), **caches**, chaves de `localStorage`/`sessionStorage`. Use "Atualizar" depois de cada passo e "Copiar relatório" para a evidência. Leitura rápida:

- `hub-offline-index`: ponteiro de "quem usou por último".
- `hub-offline-<hash>`: o estudo da conta (`lessons`, `outlines`, `leases`, `certificates`, `certificatePdfs`).
- `hub-outbox-<hash>`: conclusões feitas offline ainda não enviadas (`ops`).
- No **app instalado** (sem barra de endereço), a tela abre pelo link **"Diagnóstico do aparelho"** no rodapé de qualquer página.
- `hub-pending-signout`: "sair" feito sem rede, ainda não revogado no servidor.
- Cache `workbox-precache-…`: o shell público do app (é o ÚNICO cache esperado depois de sair).

## 3. Roteiro

**C = item crítico** (falha aciona o §5). Anote para cada item: **OK / FALHOU / NÃO APLICÁVEL**, hora e observação.

### Parte A — iPhone, Safari e app instalado

| # | Passo | Esperado | C |
| --- | --- | --- | --- |
| A1 | Safari → o site → Compartilhar → **Adicionar à Tela de Início** | Ícone na tela inicial; ao abrir, sem barra do Safari (modo app). O `/diagnostico` diz `Modo: app instalado (tela inicial)`. | |
| A2 | **Entrar** por link de acesso (veja a nota logo abaixo) | A pessoa fica logada onde vai testar. | C |
| A3 | Abrir o curso demonstrativo → abrir a aula "Boas-vindas" (online) → voltar ao mapa → abrir "Como estudar aqui" → voltar ao mapa → abrir **"Leitura complementar"** (a aula opcional, que a conta A deixa em aberto de propósito) | `/diagnostico` mostra `hub-offline-<hash>` com `lessons≥1`, `outlines≥1`, `leases=1` e `hub-offline-index`. | C |
| A4 | Ligar o **modo avião**; fechar o app no seletor de apps; **abrir de novo** | O app abre (o shell vem do Service Worker). `/diagnostico`: `Rede: offline`, `Service Worker … controla esta página`. | C |
| A5 | Abrir o curso → **"Leitura complementar"** (guardada) | Faixa "Você está sem conexão. Esta é a cópia guardada em… vale até…"; texto da aula visível. Uma aula **não** visitada mostra "não foi guardada para estudo offline". Vídeo e quiz mostram que precisam de internet. | C |
| A6 | Ainda offline: **Concluir aula** em "Leitura complementar" | "Conclusão guardada neste aparelho…"; faixa "1 conclusão de aula aguardando envio"; no mapa, "conclusão aguardando envio". `/diagnostico`: `hub-outbox-<hash>: ops=1`. | C |
| A7 | **Desligar o modo avião**; abrir/voltar ao app | Em até ~1 min a faixa some; o mapa mostra "Leitura complementar" como **concluída** (o progresso das obrigatórias continua 100%, porque a aula é opcional). O agente confere no banco: **exatamente 1** conclusão a mais (de 5 para 6). `/diagnostico`: `ops=0` (ou sem o banco do outbox). Repetir "Enviar agora" não duplica. | C |
| A8 | **Lease**: modo avião; Ajustes → Geral → Data e Hora → desligar "Automático" e **avançar 4 dias**; abrir "Leitura complementar" (ou qualquer aula guardada) no app | Mensagem: o prazo do estudo offline deste curso terminou (e a aula **não** aparece). | C |
| A9 | Ainda no modo avião: **voltar a data para 1 dia depois da data real** (ou seja, ainda à frente do real, porém atrás do que o app já viu) e abrir a aula | Mensagem de relógio atrás do horário já visto (o app bloqueia até verificar online). | C |
| A10 | Data e hora **automáticas** de novo; desligar o modo avião; abrir o app | O app volta a funcionar normalmente e renova o lease (a aula guardada abre de novo sem rede depois de renovar). | C |
| A11 | **Certificado** (conta com certificado sintético; o agente prepara): Minha conta → "Guardar para ler offline" → modo avião → "Baixar a cópia guardada" | O arquivo é baixado e **abre** no visualizador de PDF do iOS com o nome `certificado-<código>.pdf`. Sem rede a lista mostra "Emitido · verificado em…" e o aviso de que não dá para confirmar a validade. | |
| A12 | **Sair da conta** online (Minha conta → Sair da conta). Abrir `/diagnostico` | `Bancos IndexedDB (0): nenhum`; `Caches`: só `workbox-precache-…`; `localStorage` sem chaves além do tema. | C |
| A13 | Entrar de novo, abrir uma aula (para guardar); **modo avião**; **Sair da conta** (se houver conclusão pendente, o app pergunta: escolha "Sair e descartar") | Mensagem "Você saiu da conta neste aparelho…". `/diagnostico`: só `hub-pending-signout`. Desligar o modo avião e abrir o app: o banco `hub-pending-signout` **some** em ~1 min (a sessão foi revogada). | C |
| A14 | **Outra conta**: com dados da conta A guardados (A3), entrar como a conta B (sem sair antes, ou saindo e entrando: repita os dois jeitos) | Nada de A aparece para B: a aula de A, offline, diz "não foi guardada"; `/diagnostico` não tem o banco de A (só o de B). | C |
| A15 | **Atualização segura**: o agente publica um build novo; abrir o app (com o antigo instalado) | Aparece o aviso "Há uma nova versão do app disponível". Com uma aula de **vídeo tocando**, um **quiz** aberto ou um **formulário alterado** o botão fica desabilitado e diz o que terminar. "Atualizar agora" recarrega; `/diagnostico` mostra o SHA novo. | C |
| A16 | **Dias sem uso** (informativo): com dados guardados, não abrir o app por **8 dias**; depois abrir **em modo avião** | Anotar o que sobrou (`/diagnostico`) ou o que o iOS apagou. Define a política (o lease já tolera perda total do cache). | |
| A17 | **Persistência** (informativo): `/diagnostico` → "Pedir armazenamento persistente" | Anotar o resultado. | |

> **Nota crítica sobre o login no app instalado (A2).** No iOS, o app da tela inicial tem **armazenamento próprio**, separado do Safari, e o link do e-mail abre no **Safari**, não no app. É possível que a sessão criada ao tocar no link fique no Safari e o app instalado continue sem login. Faça **os dois** e anote: (a) pedir o link **dentro do app instalado** e tocar nele; (b) fazer **todo o roteiro numa aba do Safari** (sem instalar). Se (a) não logar o app instalado, isso é um **achado do gate**: o app instalado precisa de outro jeito de entrar (decisão do responsável; fora deste roteiro). Os itens A3 a A15 valem para **onde a pessoa conseguir ficar logada**; registre qual.

### Parte B — Chromium e WebKit automatizados e dispositivos Chromium reais

| # | Passo | Esperado | C |
| --- | --- | --- | --- |
| B1 | Playwright em Chromium: `bun run test:e2e` e `bun run test:journey` | Verdes (já são, em CI). | C |
| B2 | Playwright em **WebKit**: os specs `offline*.spec.ts`, `pwa.spec.ts`, `diagnostico.spec.ts` | Verdes em WebKit (WebKit do Playwright **não** substitui o iPhone; só pega regressões de motor). **Feito em 2026-10-16:** `bun run test:e2e:webkit` (WebKit 27.2, build 2370 do Playwright) passou 58/58 com 1 pulado ("formulário sujo", por limite do WebKit do Playwright com Service Worker; o iPhone cobre no A15); evidência no `STATUS.md`. | C |
| B3 | Chrome e Edge desktop reais: instalar, A3 a A8 e A12 | Mesmo resultado do Chromium automatizado. | |
| B4 | Android real (Chrome): instalar pelo menu, A3 a A8, A12, A15 | Mesmo resultado. | |

## 4. Evidência (preencher e anexar ao `STATUS.md`)

- Aparelho: modelo ____ · iOS ____ · Safari/app instalado ____ · Data do teste ____
- SHA do build: ____ · URL: Staging
- Quem executou: ____
- Gravação de tela: link/arquivo ____ (sem e-mail ou dado pessoal visível)
- Relatórios do `/diagnostico` colados (linha de base, A3, A6, A12, A13)

| Item | Resultado | Hora | Observação |
| --- | --- | --- | --- |
| A1 … A17, B1 … B4 | | | |

## 5. Decisão

- **Aceite:** 100% dos itens **críticos** da Parte A no iPhone real (no ambiente em que a pessoa conseguiu ficar logada), mais B1 e B2. Então o offline entra no release e o `STATUS.md` registra a evidência.
- **Falha em item crítico** (isolamento entre contas, purga no logout, lease, outbox idempotente, atualização segura, abrir o app sem rede): **acionar o kill switch**, liberar a v1 **sem offline** e registrar a decisão em `STATUS.md` (item, passo, evidência). Kill switch: publicar um build com `PWA_KILL=1` (o `sw.js` vira um de desativação que apaga os caches e se desregistra; o app continua instalável como página comum): `PWA_KILL=1 bun run deploy:staging` no Staging e, depois do Go/No-Go, o equivalente em Production. Ligar e desligar exige um build/deploy.
- Falha só em item **não crítico** (A11, A16, A17): registrar e decidir caso a caso; não bloqueia.
- **Repetir o roteiro** (ao menos A2 a A15) depois de qualquer mudança no Service Worker (`src/sw.ts`), no esquema do IndexedDB ou na purga.

## 6. Limites que o roteiro não resolve

- O Safari pode apagar dados de sites sem uso (A16 mede, não impede). O lease tolera a perda total do cache; o que fica no aparelho nunca é a fonte da verdade.
- Background Sync não existe no Safari: a sincronização é por reconexão, abertura do app e aba visível.
- Offline não é DRM nem controle forte: o relógio do aparelho é da pessoa (A8 e A9 provam só o que o app consegue fazer).
- Revogação de certificado não é imediata para uma cópia já baixada (a tela diz isso).
