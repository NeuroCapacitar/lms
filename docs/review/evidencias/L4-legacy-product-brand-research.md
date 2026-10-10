# L4 — Pesquisa de produto, marca e histórico de decisões do legado NeuroCapacitar Hub

> **Tipo:** análise read-only do repositório legado `NeuroCapacitar/hub`, clonado em
> `scratchpad/legacy-hub` (HEAD `ed882138`, 982 commits, de 2026-06-05 “Initial commit from
> Create Next App” a 2026-10-06). Nenhum arquivo do legado foi alterado.
>
> **Natureza da fonte:** o legado é **fonte de exemplos e contexto, não fonte normativa da vNext**
> (AGENTS.md da vNext, §2). Este relatório descreve o que o legado decidiu e por quê; não decide
> nada pela vNext.
>
> **Convenções:** `arquivo:linha` é relativo à raiz do legado, salvo indicação. **[FATO]** = está
> escrito no documento/código citado. **[INFERÊNCIA]** = conclusão minha a partir das evidências.
> **[CALCULADO]** = valor que eu computei (ex.: contraste WCAG) e não consta do legado.

---

## Sumário

0. [Linha do tempo e natureza do legado](#0-linha-do-tempo-e-natureza-do-legado)
1. [Produto, público, cursos, modelo de negócio e glossário](#1-produto-público-cursos-modelo-de-negócio-e-glossário)
2. [Sistema de marca e design system](#2-sistema-de-marca-e-design-system)
3. [advisor-plans e design-plans](#3-advisor-plans-e-design-plans)
4. [research e docs/superpowers](#4-research-e-docssuperpowers)
5. [ADRs 0001–0018](#5-adrs-00010018)
6. [Telas públicas e autenticação](#6-telas-públicas-e-autenticação)
7. [Identidade institucional: NeuroCapacitar vs PROTEA-R](#7-identidade-institucional-neurocapacitar-vs-protea-r)
8. [Backlog: pedido/planejado e não implementado](#8-backlog-pedidoplanejado-e-não-implementado)
9. [Divergências legado × vNext que merecem atenção](#9-divergências-legado--vnext-que-merecem-atenção)
10. [Lições para a vNext](#10-lições-para-a-vnext)

---

## 0. Linha do tempo e natureza do legado

- **[FATO]** Primeiro commit em 2026-06-05 (“Initial commit from Create Next App”); o quinto commit
  é “feat: add initial roadmap and key changes for PROTEA-R Hub” (`git log --reverse`). O produto
  nasceu com o nome **PROTEA-R Hub**; `NeuroCapacitar Hub` aparece no código pela primeira vez em
  `fc956d79` (2026-09-07, “feat: refine NeuroCapacitar interface”) e a constante `PLATFORM_NAME`
  surge no mesmo commit.
- **[FATO]** Stack do legado: Next.js 16 App Router + React 19, Server Actions, Better Auth, Drizzle +
  `pg`, Neon, Vercel Pro (`gru1`), Cloudflare R2, JMVStream (vídeo), Resend (e-mail), Asaas
  (pagamentos; substituiu AbacatePay), Sentry só em Production (`docs/architecture.md:11`,
  `README.md:9-12`, `README.md:95-99`).
- **[FATO]** Production ativa em `https://app.neurocapacitar.com.br` (`README.md:95`). O corte
  comercial de Production (Asaas com credencial real) ocorreu em **2026-08-21**
  (`docs/domain/commerce-and-access.md:424-427`).
- **[FATO]** O próprio legado admite que **o racional histórico** para Next.js, Neon, Better Auth,
  JMVStream, R2, Resend e Vercel **não foi localizado** (`PRODUCT.md:127-130`,
  `docs/architecture.md:13`).
- **[FATO]** Em ~4 meses o repositório acumulou ~266 documentos (~80 mil linhas de Markdown) contra ~234 mil linhas de TS/TSX e 108 migrations; o GitHub tem 0 issues e 264 PRs (levantamento por `wc`/`gh`). Por pasta,
  há 47 advisor-plans, 15 design-plans, 25 research, 47 superpowers/plans,
  ~30 superpowers/specs, 16 plans, ~40 reviews, 18 ADRs e 20 decisões DEC-DISC. **[INFERÊNCIA]** Há documentos que
  validam relatórios que validam relatórios (ex.: `design-plans/neuro-brand-report-validation.md`
  valida um “Relatório Brand” externo; `docs/reviews/2026-09-15-brand-report-validation-research.md`
  valida a validação). O volume documental é, por si, um sinal de complexidade acidental de
  processo.

---

## 1. Produto, público, cursos, modelo de negócio e glossário

### 1.1 O que é

- **[FATO]** “Centralizar venda, entrega e operação de Cursos da NeuroCapacitar. O Hub permite que um
  Aluno compre ou receba acesso, percorra conteúdo em ordem, acompanhe progresso, interaja nas
  Aulas e obtenha Certificado. PROTEA-R é um dos Cursos entregues pelo produto.”
  (`PRODUCT.md:9-15`).
- **[FATO]** “Plataforma de cursos da NeuroCapacitar: catálogo e aprendizagem para Alunos, autoria e
  operação para Admin/Suporte, comércio Asaas, vídeo via JMVStream, mídia via Cloudflare R2, e-mail
  via Resend e Postgres/Neon. PROTEA-R é um Curso disponível na plataforma, não o nome do produto.”
  (`README.md:9-12`).
- **[FATO]** Não objetivos: marketplace, múltiplas especialistas, multi-tenancy/organizações de
  clientes; assinaturas recorrentes; coortes de conteúdo; parcelamento fora do agregado nativo do
  Asaas; app nativo; pipeline próprio de vídeo; CRM/reengajamento por analytics
  (`PRODUCT.md:116-125`).

### 1.2 Público e personas

**Papéis técnicos** — **[FATO]** só existem três: `student`, `support`, `admin`
(`CONTEXT.md:19`, `PRODUCT.md:91-95`). Não existe papel “Financeiro” nem “Staff”: Financeiro é uma
**área** com *views* protegidas e *grants* individuais delegados a Suporte (`docs/decisions.md:304-333`,
ADR-0017). “Staff” é vocabulário da vNext; o legado diz “equipe” / “Admin e Suporte”.

| Persona (legado) | Definição | Evidência |
|---|---|---|
| **Aluno** | Consome Cursos; “papel de negócio e não prova que tenha efetuado a compra”. Aprende, acompanha acesso/progresso, comenta, baixa materiais, consulta Certificados. | `CONTEXT.md:13-15`, `PRODUCT.md:19` |
| **Compradora** | Informa dados no checkout hospedado Asaas e assume a relação financeira. Na compra atual Compradora = Aluno; compra para terceiro fora do escopo. | `CONTEXT.md:21-22`, `PRODUCT.md:20-22` |
| **Especialista** | Define conteúdo, experiência pedagógica e decisões de produto. “Há uma única especialista, sem marketplace.” | `CONTEXT.md:32-33`, `PRODUCT.md:23` |
| **Suporte** | “Operadora com leituras administrativas aprovadas e subconjunto individualmente concedido de permissões de alteração; não é um Admin limitado por convenção.” | `CONTEXT.md:38-40`, `docs/decisions.md:304-337` |
| **Admin** | Todas as permissões administrativas; “descreve autorização, não propriedade comercial”. | `CONTEXT.md:35-36` |
| **Vendedora** | Termo usado para a NeuroCapacitar como parte que absorve taxas do Asaas. | `docs/decisions.md:155`, `PRODUCT.md:107-109` |

**Quem são os alunos** — o legado **não** possui documento de público/demografia. A única evidência
direta é o seed de catálogo:

- **[FATO]** `src/db/initial-catalog-seed.ts:145-148`: Curso `protea-r`, título “Sistema PROTEA-R”,
  descrição **“Curso para psicologas e neuropsicologas com progressao por modulos.”**
- **[FATO]** Módulos do seed (`src/db/initial-catalog-seed.ts:19-93`): “Fundamentos Teóricos”
  (Bases Científicas, **Critérios Diagnósticos DSM-5**, **Perfil Sensorial**), “Eixo 1 – Entrevista de
  **Anamnese**”, “Eixo 2 – Observação e **Protocolo Comportamental**” (Triangulação de Dados
  Clínicos, Escala de Intensidade Comportamental), “Codificação, Interpretação e Documento”,
  “**Devolutiva aos Responsáveis**” (Comunicação com a Família).
- **[INFERÊNCIA]** O público principal é de **profissionais de saúde mental — psicólogas e
  neuropsicólogas** —, majoritariamente mulheres (o glossário usa o feminino “Compradora”,
  “Vendedora”, “única especialista”). PROTEA-R parece ser um **protocolo de avaliação clínica**
  (provavelmente de neurodesenvolvimento/TEA, dado DSM-5, perfil sensorial e devolutiva aos pais),
  mas o legado não expande a sigla nem declara a condição avaliada. Não há evidência de público de
  educação (professores) no legado.
- **[FATO]** Fixtures de teste usam o emissor fictício “Instituto Protea Educação Profissional”
  (`src/app/(admin)/admin/cursos/[courseId]/page.test.tsx:401`). **[INFERÊNCIA]** É dado de teste,
  não razão social real; não usar como fato institucional.

### 1.3 Cursos

- **[FATO]** PROTEA-R é “um dos Cursos” (`PRODUCT.md:13`), o único nomeado em todo o repositório
  (56 arquivos citam `protea`). O seed cria 6 Módulos e 27 Aulas, 10–30 min cada
  (`src/db/initial-catalog-seed.ts:19-93`), preço 0 e acesso de 12 meses no seed
  (`:149-151`). **[CALCULADO]** Soma das durações do seed = 587 min ≈ 9,8 h → `workload_hours = 10`.
  O seed é um fixture; não prova catálogo real.
- **[FATO]** Curso “novo e refilmado é novo produto e nova compra/concessão” (`docs/decisions.md:81`).
- **[FATO]** Carga horária = soma das durações pedagógicas (vídeo + leitura a 260 palavras/min) ou
  override manual (`CONTEXT.md:189-191`; racional dos 260 ppm “não foi localizado”,
  `docs/domain/learning-content-and-progress.md:108`).

### 1.4 Volume esperado

- **[FATO]** Não há meta numérica de alunos, vendas ou horas de vídeo em nenhum documento canônico.
  Indícios: “Para a plataforma pequena atual” (`docs/decisions.md:131`); listagem administrativa com
  página padrão de 100 Alunos e “orçamento histórico de 250 Alunos” em teste
  (`docs/architecture.md:262`); Development com 8 Pedidos na medição de escala do Financeiro
  (`docs/operations/database-and-migrations.md:296`); auditoria de 2026-08-23 com “12 Pedidos
  pending, 2 cancelled e 0 paid” (`docs/reviews/2026-08-23-production-readiness-audit.md:449`);
  ausência de coorte “ratificada com vendas reais ativas” (`docs/decisions.md:424-426`).
- **[FATO]** “O Hub atende poucos alunos” (`docs/adr/0007-course-versioning-and-enrollment-curriculum.md:11`).
  “Em 2026-08-26, a operadora confirmou uma venda real pelo checkout público”
  (`docs/integrations/asaas.md:31-33`; `docs/reviews/2026-08-26-production-readiness-requalification.md:13-14`).
  O único slug observado em Production é `/comprar/protea-r`
  (`docs/reviews/2026-08-29-repository-health-audit.md:269`). A operadora, em 2026-09-08, declarou
  “No 1 mes de funcionamento” não ter precisado recuperar incidentes
  (`advisor-plans/admin-dashboard-review-2026-09-08.md:1108`).
- **[INFERÊNCIA]** Escala de dezenas a poucas centenas de alunos por Curso, um Curso principal,
  equipe de 1–3 operadoras. É coerente com a premissa da vNext (“centenas de alunos, Staff pequeno”,
  `docs/planning/02-arquitetura-consolidada.md:5` da vNext).

### 1.5 Modelo de negócio

| Aspecto | Legado | Evidência |
|---|---|---|
| Unidade vendável | O **Curso** é o produto (não há entidade Offer). Preço, oferta e duração vivem no Curso e são copiados como snapshot no Pedido. | `docs/decisions.md:157-167`, `CONTEXT.md:44-45` |
| Venda | **Avulsa**, pagamento único, checkout hospedado Asaas, item inline (sem produto remoto). | `docs/Plano de migracao.md:18-23`, `PRODUCT.md:34` |
| Métodos | Pix, cartão ou ambos, por Curso; cartão à vista ou parcelado; teto 1–12x; **padrão Pix + cartão até 3x**. | `docs/decisions.md:157-165` |
| Preço | **Único** entre métodos e parcelas; **taxas absorvidas pela Vendedora**; mínimo R$ 10 (1000 centavos) por limite do Asaas. | `docs/decisions.md:142-176`, `:429-431` |
| Acesso | Duração comercial em **meses** registrada no Pedido/Concessão; expira; pode ser estendida/ajustada por Admin/Suporte com motivo. | `CONTEXT.md:193-198`, `docs/domain/commerce-and-access.md:201-226` |
| Gratuito | Curso com preço 0 → autoinscrição (Concessão `free_enrollment`) sem Pedido/Asaas; reentrada após expiração permitida. | `docs/decisions.md:283-300`, ADR-0016 |
| Pré-venda | “Em breve”: interesse autenticado sem cobrança; um aviso na próxima abertura de vendas. | `CONTEXT.md:96-97`, ADR-0009 |
| Reembolso | Apenas **integral** (inclusive do parcelamento inteiro). | `docs/Plano de migracao.md:33`, `docs/decisions.md:178-181` |
| Fora | Assinatura, boleto, compra para terceiros, coortes/turmas, cupons (nenhuma menção), afiliados (nenhuma menção). | `PRODUCT.md:116-121`, `docs/Plano de migracao.md:23` |

- **[FATO]** A decisão de preço único foi ratificada em 2026-08-21, “reabrir somente com dados reais
  de venda que justifiquem acréscimo comercial por parcelamento” (`docs/decisions.md:429-431`).
  Antes disso, o produto queria “até 3x com juros” (`docs/Plano de migracao.md:35-40`), inviável no
  Asaas Checkout (`docs/decisions.md:169-176`).
- **[FATO]** “Não haverá coorte… Reabrir somente com calendário ou turma real”
  (`docs/decisions.md:83`, `:424-426`). A necessidade real virou **drip relativo D+N por Módulo**.

### 1.6 Canais

- **[FATO]** A aquisição pública vem de **landing page externa** que aponta para o link estável
  `/comprar/[slug]`, “copiável pela administração”; o handoff não tem formulário e cria a tentativa
  por `POST` para que robôs/previews não gerem Checkout (`PRODUCT.md:43-46`,
  `docs/decisions.md:113-117`). **[FATO]** O legado não documenta onde a landing é hospedada nem
  qual ferramenta a produz. **[INFERÊNCIA]** Landing fora do repositório (site institucional
  `neurocapacitar.com.br`, domínio do remetente Resend, `docs/decisions.md:275`).
- **[FATO]** Comunicação transacional por e-mail Resend com domínio `neurocapacitar.com.br`
  compartilhado entre ambientes (`docs/decisions.md:269-281`); dez templates hospedados
  (`docs/integrations/resend-templates.md:21`).
- **[FATO]** Suporte ao aluno: FAQ editorial + formulário de suporte enviado por outbox
  (`.impeccable/critique/2026-09-24T03-52-16Z__…perguntas-frequentes…md:20-23`). Não há chat,
  WhatsApp ou help desk integrado documentado.
- **[FATO]** Cadastro público fechado por padrão (`AUTH_PUBLIC_SIGNUP_ENABLED=false`); o canal
  normal de criação de Conta é a compra (Conta criada/vinculada pelo e-mail do pagador após pagamento)
  (`PRODUCT.md:34-41`, `:53-56`).

### 1.7 Jornadas (resumo)

- **Compra (guest-first):** visitante → `/comprar/[slug]` → Checkout Asaas → webhook em inbox →
  worker → vincula/cria Conta **não verificada** pelo e-mail do pagador → Concessão → Matrícula →
  e-mail único de confirmação (CTA “confirmar e-mail” ou “ir ao Curso”). Pagamento **não** verifica
  posse do e-mail (`PRODUCT.md:31-41`, `docs/decisions.md:97-117`).
- **Aprendizagem:** sequência por Aulas obrigatórias, drip D+N por Módulo, vídeo JMVStream com
  fronteira linear validada (conclusão automática só a 100% sem saltos), conclusão manual sempre
  disponível, comentários com uma camada de resposta, Certificado automático na primeira conclusão
  (`PRODUCT.md:58-65`, `docs/decisions.md:71-74`, ADR-0011/0012).
- **Conta:** Configurações por papel (`/app/configuracoes`, `/admin/configuracoes`), Google como
  método principal quando vinculado, senha opcional, troca de e-mail com dupla prova, avatar privado
  em R2 (`PRODUCT.md:67-79`).
- **Operação:** autoria em lote via `CoursePublication`, disponibilidade em 3 dimensões, ficha lateral
  de Aluno, Financeiro (Visão geral / Pedidos / Análises), Operação (filas), Auditoria, banners, FAQ,
  mídia da tela de acesso (`PRODUCT.md:81-89`, `:141-175`).

### 1.8 Glossário do domínio (legado)

Termos com definição estrita em `CONTEXT.md` (linhas indicadas):

| Termo | Definição curta | Linha |
|---|---|---|
| Conta | Identidade autenticável (e-mail + credenciais + sessões); papel técnico student/support/admin | 17-19 |
| Prova de e-mail | Confirmação de posse da caixa; não é login nem senha; link não cria sessão | 24-26 |
| Pedido | Intenção e resultado financeiro, com snapshots de preço/duração/identidade | 44-45 |
| Confirmação de compra | Notificação única por Pedido pago | 47-49 |
| Concessão de acesso | **Direito** de uma Conta a um Curso, com origem (`paid_order`, `manual`, `free_enrollment`) | 51-54 |
| Matrícula | **Projeção** consolidada do acesso atual; não é a origem do direito | 60-61 |
| Liberação programada | Modo que libera Módulos em D+N (N×24h desde a âncora do episódio) | 63-66 |
| Acesso integral | Modo que ignora atrasos; Admin concede uma vez com motivo | 68-69 |
| Bloqueio de matrícula / de plataforma | Revogação por Curso / suspensão da Conta inteira | 71-75 |
| Mídia da tela de acesso | Imagem decorativa administrável do login | 79-81 |
| Revisão financeira | Fila humana para evento ambíguo/conflitante | 83-84 |
| Estado de entrega / Visibilidade de catálogo / Estado de vendas | Três dimensões independentes do Curso | 86-94 |
| Interesse de venda | Pedido reversível de aviso único na abertura de vendas | 96-97 |
| Publicação de Curso (`CoursePublication`) | Revisão interna em lote; a vigente é o currículo vivo | 105-106 |
| Conclusão de Curso (`CourseCompletion`) | Primeira conclusão histórica; não é apagada | 108-109 |
| Identidade curricular (`curriculum_key`) | Chave estável da Aula entre publicações | 117-118 |
| Fronteira linear validada | Maior ponto alcançado sem saltos; base da conclusão automática | 132-133 |
| Tempo de reprodução | Tempo efetivamente reproduzido (analytics) | 135-136 |
| Evento / Preferência / Métrica agregada de aprendizagem | Analytics minimizado com opt-out | 153-160 |
| Provedor / Projeção de integração / Evento não reconciliado | Fronteira Hub × provider | 164-182 |
| Duração pedagógica / Carga horária / Duração comercial / Janela efetiva / Duração de upload | Cinco “durações” distintas | 186-201 |
| Implementado / Aprovado / Aguardando ratificação / Pendente | Estados documentais | 205-208 |

**[INFERÊNCIA]** O glossário é um dos ativos mais valiosos do legado: separa com rigor direito
(Concessão) de projeção (Matrícula), cinco tipos de duração e três dimensões de disponibilidade. A
vNext já herdou a maior parte (Entitlement/Enrollment), mas renomeou para inglês e introduziu Offer.

---

## 2. Sistema de marca e design system

### 2.1 Fonte da marca

- **[FATO]** Manual de identidade: `IDV NEURO.CAPACITAR.pdf` (arquivo fora do repositório, no
  Desktop do autor), página 8 com os anchors (`design-plans/neuro-brand-design-system-refactor.md:5-7`,
  `:53-61`). O manual **não está versionado**.
- **[FATO]** Anchors oficiais (hex do manual):

| Anchor | HEX (manual) | OKLCH no `globals.css` | Papel no legado |
|---|---|---|---|
| Petróleo | `#326C71` | `oklch(0.495 0.061 202.9)` | identidade, botão principal, sidebar primary |
| Areia | `#F1E8DA` | `oklch(0.934 0.021 79.1)` | `surface-warm`, `secondary-foreground` (uso raro) |
| Laranja queimado | `#D97B34` | `oklch(0.675 0.143 54)` | `primary`, `accent`, `link`, seleção, progresso ativo |
| Oliva | `#9EAD7C` | `oklch(0.723 0.07 122)` | `learning-complete`, `progress-complete` |
| Terracota | `#C56A4C` | `oklch(0.623 0.124 38.9)` | expressão editorial; `chart-4`; nunca erro |
| Creme (derivado, **não** é anchor do manual) | — | `oklch(0.944 0.019 90)` | `foreground`, `focus` |

Fontes: `design-plans/neuro-brand-design-system-refactor.md:55-61`; `src/app/globals.css:112-118`;
`DESIGN.md:309-314`.

- **[FATO]** O manual também usa **magenta, preto e composições orgânicas** em páginas editoriais;
  o legado decidiu tratá-los como linguagem editorial, não tokens de produto
  (`design-plans/neuro-brand-design-system-refactor.md:63-66`). O **grafite** do manual não entrou
  como base (`:105-106`).
- **[FATO]** Paleta de e-mail (Resend) usava valores próprios: fundo `#0f2224`, card `#162b2d`,
  teal `#326c71`, teal secundário `#234e52`, laranja `#d97b34`, texto claro `#e8f0f0`, muted
  `#7fa8aa`, canvas creme `#f7f3ef`, borda quente `#eadfd8`
  (`docs/superpowers/specs/2026-08-19-resend-neurocapacitar-brand-refresh-design.md:22-33`).

### 2.2 Tokens funcionais reais (`src/app/globals.css:112-182`)

| Token | Valor | Uso autorizado (`DESIGN.md:281-307`) |
|---|---|---|
| `--background` | `oklch(0.237 0.025 204.4)` | fundo contínuo (petróleo muito escuro) |
| `--foreground` | `var(--brand-cream)` | texto principal |
| `--card` / `--popover` | `oklch(0.272 0.027 203.5)` | agrupamento real |
| `--sidebar` | `oklch(0.221 0.023 205.4)` | navegação autenticada |
| `--button-primary` | `var(--brand-petroleum)` | botão principal (petróleo + texto creme) |
| `--primary` / `--accent` / `--link` | `var(--brand-orange)` | ênfase, seleção, progresso, links |
| `--text-selection` / `--control-selected` | `oklch(0.675 0.143 54)` | seleção de texto e controles |
| `--focus` / `--ring` | `var(--brand-cream)` | anel de foco creme em duas camadas |
| `--muted` | `oklch(0.309 0.033 204.9)` | apoio |
| `--support-foreground` / `--muted-foreground` | `oklch(0.76 0.035 178)` | texto auxiliar “teal-sage” |
| `--secondary` | `oklch(0.395 0.048 203.5)` | ação secundária |
| `--progress-active` | laranja | andamento |
| `--learning-complete` / `--progress-complete` | oliva | conclusão de aprendizagem |
| `--surface-warm` | areia | superfície institucional rara (Auth/checkout/callout) |
| `--destructive` | `oklch(0.726 0.122 20.5)` | erro/bloqueio |
| `--success` | `oklch(0.704 0.12 160)` | sucesso técnico (≠ oliva) |
| `--warning` | `oklch(0.769 0.13 78)` | atenção |
| `--info` | `oklch(0.68 0.1 245)` | informação |
| `--border` / `--input` | `oklch(0.495 0.035 202.9 / 0.24)` / `/ 0.3` | estrutura |
| `--chart-1..5` | teal `oklch(0.64 0.12 203)`, laranja, oliva, terracota, `oklch(0.82 0.03 80)` | séries de dados |
| `--radius` | `0.5rem` (8px) | baseline |

**Arquitetura de tokens em 3 camadas** — **[FATO]** `brand/base → functional/semantic →
component/state`; componentes **nunca** consomem `--brand-*` diretamente; testes de contrato
impedem isso (`design-plans/neuro-brand-design-system-refactor.md:90-142`, `DESIGN.md:309-314`).
Referências: Fluent 2, Primer, Atlassian, Geist Colors, MDN OKLCH, WCAG 2.2 (`:75-88`).

### 2.3 Regras de uso por cor (o que o legado aprendeu)

- **[FATO]** “petróleo constrói o ambiente; areia aquece conteúdo e texto quando houver contraste
  comprovado; laranja orienta ação e atenção; oliva marca avanço de aprendizagem; terracota oferece
  expressão editorial pontual, sem representar erro; `success`, `warning`, `info` e `destructive`
  continuam semânticos e independentes da decoração de marca”
  (`design-plans/neuro-brand-design-system-refactor.md:16-25`).
- **[FATO]** Oliva **não** é `success`: conclusão pedagógica e sucesso técnico são papéis distintos
  (`design-plans/neuro-brand-report-validation.md:91-94`, `:253-255`).
- **[FATO]** Uma primeira tentativa de rebrand empurrou superfícies para o terracota e foi
  revertida: “Cards, muted, borders, secondary e sidebar retornaram à escala teal anterior; a mudança
  de marca não empurra mais todas as superfícies para o terracota” e o botão principal “voltou ao
  petróleo” (`design-plans/neuro-brand-impeccable-review.md:11-17`). Pedido explícito “de não tornar o
  sistema terroso” (`design-plans/neuro-brand-report-validation.md:115-117`).
- **[FATO]** Laranja como CTA (`Button variant="accent"`) foi criado mas **nunca aplicado em
  produção**: “adiado: o Checkout atual não possui uma ação comercial explícita”
  (`design-plans/neuro-brand-design-system-refactor.md:458-460`).
- **[FATO]** Financeiro, Auditoria e Operação não recebem branding; “valores financeiros não devem
  virar decoração laranja, oliva ou terracota” (`design-plans/neuro-brand-report-validation.md:257-262`).

### 2.4 Contraste — valores medidos

- **[FATO]** Pesquisa do legado: branco sobre `#D97B34` = **3,07:1**; fundo escuro sobre laranja =
  5,36:1; petróleo `#326C71` × laranja = **1,94:1**; oliva × petróleo ≈ **2,48:1**
  (`docs/reviews/2026-09-14-neuro-brand-report-research.md:19`).
- **[CALCULADO]** (fórmula WCAG 2.x de luminância relativa, sobre os hex do manual) — relevante
  porque a vNext terá tema **claro** sobre areia/bege:

| Par | Razão | AA texto normal (4,5) | AA texto grande/UI (3,0) |
|---|---|---|---|
| branco sobre petróleo | 5,97:1 | passa | passa |
| petróleo sobre areia | 4,91:1 | passa (justo) | passa |
| laranja sobre areia | **2,53:1** | falha | **falha** |
| branco sobre laranja | **3,07:1** | falha | passa |
| terracota sobre areia | **3,12:1** | falha | passa (justo) |
| branco sobre terracota | 3,79:1 | falha | passa |
| oliva sobre areia | **1,98:1** | falha | **falha** |
| grafite `#1F1F1F` sobre laranja | 5,36:1 | passa | passa |
| grafite sobre oliva | 6,85:1 | passa | passa |
| grafite sobre terracota | 4,35:1 | falha (justo) | passa |

**[INFERÊNCIA]** Num tema claro beige/terracota/laranja, as cores de marca **não podem** ser usadas
como cor de texto sobre areia, e botões laranja/terracota precisam de texto escuro (grafite), não
branco, para atingir AA em texto normal; ou usar variantes escurecidas (OKLCH com L menor) como
token funcional.

### 2.5 Tipografia

- **[FATO]** A UI do legado usa **Geist Sans + Geist Mono** via `next/font/google`
  (`src/app/layout.tsx:2-16`, `src/app/globals.css:47-48`, `DESIGN.md:202`, `:418-422`).
  “Geist permanece a tipografia da UI do Hub; Lexend não será introduzida na aplicação sem uma
  decisão específica” (`design-plans/neuro-brand-design-system-refactor.md:32-33`).
- **[FATO]** **Lexend Deca é a tipografia da marca** segundo a spec de e-mail: “Tipografia do Hub:
  Lexend Deca; nos emails será usado `Arial, Helvetica, sans-serif`”
  (`docs/superpowers/specs/2026-08-19-resend-neurocapacitar-brand-refresh-design.md:34-35`); “não
  carregar Lexend remotamente em email” (`docs/integrations/resend-templates.md:48`).
- **[INFERÊNCIA]** Lexend Deca vem do manual de identidade; o legado nunca a adotou na UI. A vNext
  (B10) corrige isso adotando Lexend Deca + Geist Mono técnico.
- **[FATO]** Escala tipográfica por papel (`src/app/globals.css:283-334`, `DESIGN.md:427-436`):
  page-title `clamp(1.75rem, 1.6rem + 0.65vw, 2rem)`/650/1.1/-0.03em; section-title 1.125rem/600;
  card-title 0.9375rem/600; body 1rem/1.6; body-sm 0.875rem/1.5; label 0.8125rem/500; meta
  0.75rem/1.4; code Mono 0.75rem tabular.
- **[FATO]** Regras de copy: sentence case, sem eyebrows/overlines/caixa alta, reticências `…` em
  estados de processamento, **sem travessão longo**, português com acentuação, 60–75 caracteres por
  linha, `tabular-nums` em números (`DESIGN.md:446-460`).
- **[FATO]** Certificados PDF/PNG usam **Inter** Regular/Bold empacotadas
  (`public/fonts/certificates/*`, `src/app/globals.css:6-20`, `docs/adr/0006-certificate-lifecycle.md:19-25`).

### 2.6 Tema (dark-only) e movimento

- **[FATO]** “O produto é dark-only neste escopo e não possui seletor visual de tema”
  (`DESIGN.md:49`, `:339-341`); `html { color-scheme: dark }` (`src/app/globals.css:109`); blocos
  `:root` e `.dark` idênticos (`:112-259`).
- **[FATO]** “não adicionar `prefers-reduced-motion` neste projeto” (`DESIGN.md:50`, `:661`, `:744`);
  ADR-0015 reforça: “as transições não consultam preferências de movimento do sistema”
  (`docs/adr/0015-authentication-screen-media.md:25`).
- **[FATO]** Movimento padrão é “quietude”: sem marquee, parallax, bounce, pulso de status, reveal
  on scroll; transições só de propriedades específicas, sem `transition-all`; easing
  `cubic-bezier(0.23, 1, 0.32, 1)` e `(0.77, 0, 0.175, 1)` (`DESIGN.md:646-671`,
  `src/app/globals.css:97-98`).
- **[FATO]** Carrosséis com autoplay de 6 s: banners do dashboard e mídia da tela de acesso; pausa
  “exclusivamente enquanto o ponteiro está sobre a imagem”, “sem botão visual de play/pausa”
  (`DESIGN.md:51-55`, `:663-667`). **Contradição interna:** ADR-0015 fala em “pausa/retomada
  acessível e pausa em foco/hover” (`docs/adr/0015-authentication-screen-media.md:21-22`).
- **[INFERÊNCIA]** Autoplay > 5 s sem mecanismo de pausa operável por teclado conflita com WCAG
  2.2.2 *Pause, Stop, Hide* (nível **A**); ignorar `prefers-reduced-motion` conflita com boas
  práticas (2.3.3 é AAA). São anti-padrões a **não** herdar.

### 2.7 Student × Admin (contraste de registro)

- **[FATO]** Dois registros: **Operação** (Admin/Suporte; densa, estados críticos com texto e ação
  de recuperação) e **Aprendizagem** (Aluno; próxima Aula, progresso, conteúdo sem competir com
  controles) (`DESIGN.md:111-117`).
- **[FATO]** “Student mais branded que Admin — aprovada e confirmada. O Student usa calor em hover,
  progresso e aprendizagem; o Admin preserva densidade e neutralidade”
  (`design-plans/neuro-brand-report-validation.md:87-89`). Diferença “apenas de composição e
  frequência” dos mesmos tokens, não um segundo tema
  (`design-plans/neuro-brand-design-system-refactor.md:310-313`, `:367`).
- **[FATO]** Aula: “mídia é protagonista; não espalhar as cinco cores”
  (`design-plans/neuro-brand-design-system-refactor.md:151`); “Aula pouco branded — aprovada”
  (`design-plans/neuro-brand-report-validation.md:250-251`).

### 2.8 Densidade, tabelas, grid e radius

- **[FATO]** Densidade global **confortável**; Admin/Financeiro/Auditoria/Operação podem usar
  `size="sm"` localmente “sem criar uma aparência operacional separada”; sem segunda API global de
  densidade (`DESIGN.md:347-350`, `:389-391`, `:408-411`). O advisor-plan
  `2026-09-22-comfortable-admin-tables-plan.md` levou as tabelas do Admin para o padrão confortável
  (detalhes na seção 3).
- **[FATO]** Ritmo vertical do Admin: `gap-16` entre blocos, `gap-12` entre sessões irmãs, `gap-6`
  título→conteúdo; `PageContainer` máx. **1344px** (`DESIGN.md:206`, `:462-477`).
- **[FATO]** Tabelas: `<caption>` obrigatório, `th scope`, texto à esquerda e números à direita,
  `tabular-nums`, rolagem horizontal local, estado vazio dentro do `<table>`, filtros/busca/página na
  URL quando server-side, mostrar faixa e total (`DESIGN.md:571-623`).
- **[FATO]** Radius: base `--radius: 0.5rem` (8px); papéis `detail` 6px (×0.75), `control` 8px,
  `card` 10px (×1.25), `surface` 12px (×1.5), `media` 16px (×2) (`src/app/globals.css:168-173`,
  `DESIGN.md:393-406`).
- **[FATO]** ReUI `data-grid` avaliado e **rejeitado** (exigia TanStack v9, `@base-ui/react`,
  virtualização, DnD; o Hub usava TanStack 8.21.3 e Radix) (`DESIGN.md:227-233`).

### 2.9 Componentes e ícones

- **[FATO]** shadcn local estilo `radix-luma` sobre primitives **Radix**, Tailwind v4, **Hugeicons**
  como único kit de ícones (`DESIGN.md:197-204`, `:700-701`; `components.json`). Shell:
  `PanelLayout` (sidebar, header, skip link), `PageContainer`, `PageHeader` (h1 visível, ações da
  página), `PanelBreadcrumb` só com ancestrais (`DESIGN.md:203-221`).
- **[FATO]** Contratos de interação: `Button` (default petróleo, accent, outline, secondary, ghost,
  destructive, link; prop `loading` com `aria-busy`); `FormSubmitButton`/`AdminMutationForm`; `Field*`;
  `Empty*`; `Skeleton` acompanha estrutura final; toast vs `role=alert` com papéis distintos; erro de
  Server Action inline, nunca só em toast (`DESIGN.md:481-569`).
- **[FATO]** Uploads: percentual somente com bytes mensuráveis; preparação/confirmação
  indeterminadas; cancelamento aborta; erro fica no item com Retry/Descartar; limites em `MiB`
  (`DESIGN.md:543-551`).
- **[FATO]** Fixture interna de design system em `/admin/configuracoes/design-system`
  (`src/components/design-system-preview.tsx`) em vez de Storybook
  (`design-plans/neuro-brand-design-system-refactor.md:203-229`, `DESIGN.md:413-414`).

### 2.10 Imagens — contratos de proporção

| Mídia | Contrato | Evidência |
|---|---|---|
| Capa de Curso / LessonCard | 16:9, WebP 1280×720 | `DESIGN.md:680-682` |
| Banner do dashboard | 4:1, 1680×420, máx. 5 MiB | `docs/adr/0002-r2-buckets-and-publication.md:22` |
| Mídia da tela de acesso | 8:7, WebP 1200×1050, até 5 slides, não carregada em mobile | `docs/adr/0015-authentication-screen-media.md:17-26` |
| Preview de Certificado | PNG A4 1200×848 | `docs/adr/0006-certificate-lifecycle.md:36` |
| Arte de Certificado | A4 horizontal 2376×1680 | `.impeccable/critique/2026-09-24T06-03-56Z__…cover-upload-field-tsx.md:43` |

- **[FATO]** “não usar imagem stock, ilustração gerada ou screenshot falso para preencher espaço”
  (`DESIGN.md:693-694`); exceção para gradientes/blur em capas e mídia de Aula (`DESIGN.md:57-61`).

### 2.11 Acessibilidade (regras do legado)

**[FATO]** `DESIGN.md:707-723`: landmarks, um `main`, `h1` descritivo, skip link para
`#main-content`, HTML nativo antes de ARIA, foco visível não coberto por header sticky, não depender
só de cor, `min-w-0`/reflow antes de reduzir texto, **WCAG AA** como piso de contraste. Ícones ao lado
de texto `aria-hidden`; ícone isolado com nome acessível (`:700-705`). Auth: erros associados por
`aria-invalid`/`aria-describedby`, revelar senha acessível, `100dvh`
(`design-plans/neuro-brand-impeccable-review.md:63-72`).

### 2.12 Avaliações Impeccable (`.impeccable/`) — o que foi bom e o que foi problema

| Alvo | Score | Bom | Problemas | Evidência |
|---|---|---|---|---|
| `/entrar` (3 rodadas, 14/set) | 29 → 30 → **31/40** | marca específica (logo real, mídia institucional, petróleo/creme/laranja seletivo); Admin sem virar marketing; recuperação de senha e erros associados | “Help and documentation 2/4”: sem ajuda contextual no login; bloqueio de conta só em toast (corrigido) | `.impeccable/critique/2026-09-14T11-17-55Z__localhost-entrar.md:3`, `:50-62`; `design-plans/neuro-brand-impeccable-review.md:25-49`, `:126-135` |
| Sidebar da Aula (23/set) | 28/40 | resumo de progresso acima do índice; `aria-current`; Aulas bloqueadas não são links | marcador igual para Aula atual e disponível; percentual sem denominador (“4 de 9 obrigatórias”); 0% ambíguo sem obrigatórias; módulo concluído deveria ser derivado no servidor | `.impeccable/critique/2026-09-23T20-32-27Z__…aulas-lessonid-page-tsx.md:29-74` |
| Aviso do player (24/set) | 28/40 | — | parágrafo persistente duplicava o botão “Concluir aula”; copy “volte ao início” errada (deve ser “volte ao começo do trecho pulado”) | `.impeccable/critique/2026-09-24T01-09-36Z__…lesson-video-player-tsx.md:58-64` |
| FAQ/Suporte (24/set) | 28/40 | CTAs contextuais de suporte em Curso/certificado/checkout/vídeo | **duas entradas** (“Suporte” e “Perguntas frequentes”) para a mesma necessidade; formulário duplicado com limites divergentes; CTA de contato no fim de FAQ longa → recomendação: página única **“Ajuda”** em `/app/ajuda` | `.impeccable/critique/2026-09-24T03-52-16Z__…perguntas-frequentes…md:59-66` |
| Upload de capa/anexos (24/set) | **25/40** (pior) | retry em anexos | anexo perdido ao trocar de aba (sem `forceMount`); status de upload ausente na edição; banner ativo apontando para chave não publicada (ordem publish→pointer errada); imagem de 150 MiB decodificada antes da validação; refetch de URLs assinadas de 5 min | `.impeccable/critique/2026-09-24T06-03-56Z__…cover-upload-field-tsx.md:31-45` |

- **[FATO]** Surface brief de Configurações (`.impeccable/surfaces/student-settings-account-section.md:13-20`):
  Student sem abas, coluna `max-w-4xl`; Admin/Suporte com abas `Perfil`, `Certificados`,
  `Plataforma`; Google em “Métodos de entrada”; sem rota `/conta`; e-mail confirmado com ícone e
  tooltip “Confirmado”.
- **[INFERÊNCIA]** Os scores ficaram em 25–31/40 (“bom, com refinamentos”) — o legado nunca chegou a
  “excelente”. Os problemas recorrentes não são de paleta, e sim de **arquitetura de informação**
  (duplicação de entradas/estados), **semântica de progresso** (denominador, marcadores) e
  **robustez de upload**. Também: os relatórios Impeccable eram **source-based**, sem inspeção
  renderizada (“Provisional, source-based score; not a rendered UI inspection”,
  `…aulas-lessonid-page-tsx.md:31`) — a validação visual humana ficou repetidamente pendente
  (`design-plans/neuro-brand-design-system-refactor.md:476-477`).

---


## 3. advisor-plans e design-plans

### 3.1 `advisor-plans/` (README + 47 documentos, 2026-09-08 a 2026-09-28)

**[FATO]** “Cada plano é somente uma proposta até que uma pessoa responsável autorize sua execução”
(`advisor-plans/README.md:9-11`); tabela de status em `README.md:15-31`. Há três tipos: pesquisas
externas, planos executados em worktrees `codex/*`, e uma série de “análises individuais” (#39–#59)
que respondem item a item a um relatório de UX externo
(`advisor-plans/2026-09-22-report-reconciliation.md:4-5`).

#### 3.1.1 Pesquisas de mercado/UX em destaque

**Dashboard Admin (3 documentos, 2026-09-08)**

- `admin-dashboard-external-research-2026-09-08.md` (research) — **[FATO]** referências: Asaas
  (logs de webhook, fila penalizada após 15 falhas, retenção de 14 dias, `:113-114`), JMVStream API,
  **Thinkific Analytics**, **Shopify Admin/Analytics**, **Kajabi dashboard**, Standard Webhooks,
  comunidade Canvas (`:206-241`). Recomenda: home = **triagem**, analytics = análise/exportação,
  settings = configuração (`:97-108`); remover da home a lista duplicada de webhooks (só contagem,
  severidade, link, `:85-95`); manter no Hub a inbox Asaas e replay com motivo; extrato como
  evidência exportável, não clone do portal (`:123-148`).
- `admin-dashboard-review-2026-09-08.md` (review, 62 KB) — **[FATO]** diagnóstico: o painel
  misturava operar o produto, recuperar exceções e observar sistemas (`:11-25`). KPIs existentes:
  Cursos, Alunas, Acessos, Pedidos pagos; receita, pendentes, webhooks com falha, prontidão do
  catálogo (`:175-197`); Alunas: total, acesso ativo, sem matrícula, **expirando em 30 dias**
  (`:484-487`); Financeiro: receita, ticket médio, pendente, conversão (`:557-558`). Bugs de
  semântica: “webhooks com falha” contava só os 8 últimos eventos; KPIs financeiros calculados sobre
  a página de 20 pedidos; limites invisíveis de 40 revisões/50 dead letters (`:242-251`,
  `:598-611`, `:815-819`). **Respostas da dona do produto** (`:1105-1119`, verificadas): não
  resolveu incidentes “No 1 mes de funcionamento”; usa o portal Asaas para vendas e erros de
  webhook; quer manter o upload JMVStream, priorizando a anexação do vídeo à Aula; sobre o relatório
  de Aprendizagem: “Pra falar a verdade nem sei pra que serve”; “último acesso” e “expirando” são
  necessários; “Suporte precisa ver tudo relacionado a valores financeiros”. IA alvo
  (`:1172-1183`): `/admin` triagem; Cursos autoria; Alunos acesso/suporte; Financeiro decisão
  monetária; Auditoria recuperação; Aprendizagem relatório avançado; Configurações emissor e
  editorial; portais externos para telemetria nativa. A 2ª revisão devolveu à home “Últimas compras”
  e “Últimos certificados emitidos” (`:1246-1255`).
- `admin-dashboard-implementation-plan-2026-09-08.md` (implemented) — fases A–E: projeção agregada,
  KPIs globais, Auditoria como fila, JMVStream read-only (`:41-206`); ficou de fora a troca de
  polling por webhook JMVStream (`:260-262`).

**Nome da plataforma** — `platform-brand-name-source-of-truth-research-2026-09-25.md` (research):
ver seção 7.

**Curso gratuito** — `free-course-enrollment-analysis-2026-09-15.md` (proposed → base da ADR-0016):
curso gratuito = `price_in_cents = 0` + Concessão `free_enrollment`, sem Pedido de R$ 0, sem Asaas,
sem `course_offers` (`:11-44`); cita uso como **“lead magnet”** (`:291`); não fazer na V1: Offer,
cupons, trial, assinatura, waitlist, coorte (`:312-323`); esforço real L, não S (`:376-381`).
`free-course-enrollment-2026-09-15.md` (implemented, etapas 0–13): 0 Orders na jornada gratuita
(`:107-112`); e-mail de boas-vindas futuro exigiria tópico de outbox próprio (`:1365-1367`).

**Financeiro (3 documentos)**

- `open-checkout-vs-receivable-kpi-research-2026-09-26.md` — separar **Cobranças pendentes**
  (objeto real no Asaas), **Checkouts ativos** (potencial nominal) e encerrados/falhas (`:13-17`);
  o Hub não observa “preencheu e não pagou” — eventos de Checkout Asaas são só CREATED, CANCELED,
  EXPIRED, PAID (`:19`, `:52`); referências Stripe/Shopify e CPC 47 (`:30`, `:95-105`).
- `finance-system-metrics-review-2026-09-26.md` (implemented) — “compra avulsa, não SaaS: MRR, ARR e
  churn não se aplicam” (`:18`, `:29`, `:134`); “taxa de reembolso” é razão de fluxos, não de coorte
  (`:82-87`); métricas recomendadas: vendas confirmadas, reembolsos, líquido estimado, fila de ação,
  quebra por Curso/método (`:123-132`).
- `financial-final-ui-audit-2026-09-09.md` (implemented) — 3 abas (Visão geral, Pedidos, Análises),
  sem 4ª aba nem gráficos (`:41-59`); Revisões primeiro; “Tudo em ordem” só com zero pendências
  (`:63-110`); IDs técnicos em seção recolhida; reembolso em duas etapas (`:156-210`); Development
  tinha **8 Pedidos** (`:344`).

**Permissões de Suporte** — `admin-support-granular-permissions-research-2026-09-17.md`: papéis
globais só `admin`, `support`, `student`; “Financeiro” é superfície, “Equipe” é a tela Admin-only
(`:168`, `:245`, `:307`); RBAC simples com grants por usuário, sem ABAC/Zanzibar (`:49-53`); dados
não autorizados ficam **fora da resposta**, não usar `0` como máscara (`:141-147`, `:331-361`);
fontes OWASP ASVS V8, NIST 800-53/162, AWS IAM (`:406-420`). O plano v1 com 7 grants foi
**superseded** em um dia pelo refinamento com 13 grants + 4 views
(`admin-support-granular-permissions-implementation-plan-2026-09-16.md:2`,
`admin-support-permission-refinement-plan-2026-09-17.md:126-191`).

**Provider × Hub** — `provider-vs-hub-operational-responsibility-research-2026-09-13.md`: modelo
híbrido “Hub orientador, provedor executor”; Resend é at-least-once sem ordem garantida (`:24-99`);
defeito real: alerta de dead letter contava a tabela errada (`:110-115`). Plano associado
`in-progress`, sprints de retry/replay e Staging/Production **não executados**
(`provider-vs-hub-operational-alignment-plan-2026-09-13.md:54-59`).

**Prova de e-mail e checkout com Google**

- `email-verification-purchase-proof-2026-09-27.md` — pagamento confirmado **não** prova controle do
  e-mail; `email_verified=true` só após link (`:9-19`); fontes Asaas, NIST SP 800-63A/B, Teachable,
  Hotmart (`:21-44`).
- `google-oauth-checkout-ux-review-2026-09-27.md` — **[FATO, verificado]** “manter a compra
  guest-first. Não exigir login, cadastro, senha nem OAuth antes de iniciar ou concluir o checkout”
  (`:15-21`). Referências: Teachable (paga e depois cadastra), Hotmart (conta criada na compra;
  outro Google pode “perder” a compra), Thinkific (checkout em 2 etapas deixava contas sem
  matrícula), Shopify (login obrigatório suprime checkout acelerado), Stripe guest customers
  (`:30-36`). Descartados: login antes do checkout, Google obrigatório no checkout (`:111-134`).
  Admite não saber “Qual padrão tem melhor conversão para o público NeuroCapacitar” (`:183-184`).
  Métricas de funil propostas e não implementadas (`:136-151`).

**Signatário de certificado** — `certificate-signatory-scope-research-2026-09-24.md`: emissor
(razão social, marca, CNPJ) é global; signatário (nome, cargo, imagem) pertence ao Curso; sem
fallback campo a campo (`:11-22`, `:71-89`); fontes Teachable, Moodle customcert, Thinkific,
Open edX, Open Badges 3.0 (`:58-65`). Adotado como DEC-DISC-019 (`docs/decisions.md:339-354`).

**Sistema visual (valores concretos)**

| Documento | Decisão / valores | Status |
|---|---|---|
| `2026-09-21-table-density-analysis.md` | `TableHead` 40px, células `py-2 px-3`, `tabular-nums`, rolagem local; confortável entre seções, denso dentro de tabelas; sem variante `compact` global (`:17-26`, `:56-70`) | encerrado sem mudança |
| `2026-09-22-comfortable-admin-tables-plan.md` | tabela sem `Card` externo, só wrapper com borda/overflow; stacks `gap-8`, seção `gap-4/5`, grids `gap-5` (`:47-63`, `:113-124`) | proposto; aparentemente aplicado |
| `2026-09-22-radius-final-analysis.md` | detail 6px, control 8px, card 10px, surface 12px, media 16px; `--radius: 0.5rem`; exceções por componente (`:9-13`, `:63-81`); refs Atlassian e Fluent | implementado (`globals.css:168-173`) |
| `2026-09-21-motion-refinement-analysis.md` | hover de imagem 1.02–1.03, play 1.04–1.05; imagens 300–350 ms, controles 150–220 ms; press 0.96; sem `transition-all`; sem `prefers-reduced-motion` por contrato (`:39-75`) | válida p/ implementação |
| `2026-09-22-surface-warm-auth-analysis.md` | `surface-warm` fica raro (só preview de Certificado); moldura institucional do Auth descartada; formulário `max-w-[30rem]` (`:10-44`, `:72-91`) | pulada por decisão do produto |
| `2026-09-21-image-system-analysis.md` | imagem alta em auth/banner/checkout/conclusão/certificados, zero em Financeiro/Operação/Auditoria; proíbe stock (`:12-35`) | atendido |
| `2026-09-22-course-cover-16-9-and-cards-plan.md` | capa de 960×1000 (24:25) → **1280×720 WebP 16:9**, upload até 4 MB; card horizontal mídia à esquerda; LessonCard 16:9; capas antigas perdem ~46% da altura no crop (`:25-60`, `:272-277`) | implemented (sem commit) |

**Meta de estudo e learning analytics**

- `2026-09-21-student-study-goal-analysis.md` — meta “15/30/45 min” como **experimento pequeno**, não
  feature; sem lembretes, streak ou ranking (`:73-103`); fonte Springer: efeito positivo em só 46%
  dos estudos (`:37-49`). Não implementado.
- `learning-analytics-*` (5 documentos) — `started` e `completed` não formam coorte: proibido chamar
  de “taxa de conclusão”, “conversão” ou “drop-off” (`…next-stage-analysis.md:34-52`); renomeado
  “Atividade registrada por Aula”, barras inline sem biblioteca de gráficos (`:224-247`); mediana
  “até próxima Aula” com piso de 3 observações (`…next-suggestion-analysis.md:76-105`); insight
  “muito início, pouca conclusão” adiado (`…start-completion-analysis.md:15-22`); KPI “Aulas com
  erro” já existia (`…content-error-analysis.md:16-37`).

#### 3.1.2 Demais advisor-plans (1–2 linhas cada)

| Arquivo | Tema → conclusão | Status |
|---|---|---|
| `2026-09-21-finance-stage-analysis.md` | refino do Financeiro já atendido; sparklines adiadas sem série temporal confiável (`:15`, `:33-38`) | implementado / sparklines pendentes |
| `2026-09-21-admin-metric-highlight-analysis.md` | variante `highlight` do AdminMetricCard: não implementar até haver métrica com ação inequívoca (`:63-74`) | adiado |
| `2026-09-21-operation-severity-tint-analysis.md` | tinta leve por severidade em Operação (`bg-destructive/5`, `bg-warning/5`), badge mantido (`:31-53`) | recomendado |
| `2026-09-21-student-settings-analysis.md` | Configurações do Aluno já atendidas; sem hero (`:45-61`) | atendido |
| `2026-09-21-faq-support-block-analysis.md` | callout “Não encontrou sua resposta?” (`:44-66`) | superado |
| `2026-09-21-faq-student-reading-analysis.md` | FAQ do Aluno como lista aberta + callout; busca/categorias futuras (`:6-46`) | implementado |
| `2026-09-22-lesson-card-next-badge-analysis.md` | badge “Próxima” passa a variante `progress` (`:38-61`) | implementado |
| `2026-09-22-course-card-polish-analysis.md` | CTA maior (44×44) e barra de 6px no CourseCard (`:29-44`) | **rejeitado** pelo produto (`:3`, `:65-81`) |
| `2026-09-22-course-header-analysis.md` | header de Curso compacto (`:69-93`) | **descartado** (`:118-120`) |
| `2026-09-22-report-reconciliation.md` | reconcilia relatório de UX externo; metas, aulas salvas, novidades, streaks, ranking, XP **não adotados**; blobs/glow/comparação entre alunos rejeitados (`:16-81`) | registro |
| `admin-surface-standardization-2026-09-09.md` | cada tela responde uma pergunta; métrica declara população/período/denominador/fonte; PROTEA-R fora do shell (`:24-64`, `:97-133`) | complete |
| `admin-support-granular-permissions-implementation-plan-2026-09-16.md` | v1 de grants (7) em `text[]` (`:51-91`) | superseded |
| `admin-support-permission-refinement-plan-2026-09-17.md` | catálogo final 13 grants + 4 views (`:126-191`) | complete |
| `sentry-production-only-observability-2026-09-11.md` | Sentry só em Production, sem Session Replay/profiling por dados educacionais e financeiros (`:73-102`, `:469-471`) | in-progress |
| `graphify-source-validation-2026-09-27.md` | grafo de código como ferramenta local opcional; falhou no fluxo de pagamento (`:47-80`); repo com 1.505 arquivos, 208 MD (`:35`) | piloto concluído |
| `google-oauth-best-practices-2026-09-27.md` | `disableImplicitSignUp`, signup só em `/cadastro`, índice único `(provider_id, account_id)`, tokens cifrados (`:7-45`) | pesquisa |
| `google-oauth-plan-second-review-2026-09-27.md` | e-mail é âncora inicial, `sub` é identidade durável; ambiguidade falha fechado (`:71-131`) | revisado |
| `google-login-implementation-plan-2026-09-27.md` | `/entrar` só login, `/cadastro` signup sob flag (`:84-134`) | in-progress; smoke OAuth real pendente (`:31-69`) |
| `google-oauth-post-login-redirect-review-2026-09-28.md` | usuário preso em `/oauth/callback`; tabela de diagnóstico (`:5-49`) | causa raiz não confirmada |

### 3.2 `design-plans/` (15 documentos)

#### 3.2.1 Pesquisas de UX em destaque

**Sidebar da Aula** — `design-plans/2026-09-23-student-lesson-sidebar-research.md` (pesquisa):
tratar “Obrigatória/Opcional”, “Pendente/Concluída”, “Em andamento” e “Bloqueada” como dimensões
independentes (`:26`); denominador explícito “4 de 9 obrigatórias”, conclusão histórica separada do
percentual corrente (`:28`); progresso de Módulo é resumo, não regra de liberação; bloqueio mostra
causa e próximo passo, distinguindo liberação futura de pré-requisito (`:30-32`); `aria-current`
só na Aula aberta + sinal visível além da cor (`:34`); “Continuar” para a primeira pendente sem
bloquear navegação permitida (`:36`). Referências: Canvas (in progress/locked/complete), Moodle
(critérios + “To do”), Teachable (“Start next lecture”), WCAG 1.4.1, WAI-ARIA; Coursera sem
documentação oficial (`:9-18`, `:40`).

**Status transitório e vídeo** — `design-plans/2026-09-23-transient-status-and-linear-video-progress-research.md`:
regra de conclusão inline e persistente perto do player, não toast (`:33`); feedback de seek com
`role="status"` polite sem roubar foco (`:37`); toast só para confirmações curtas, mínimo 5 s
(Carbon/Android/Spectrum, `:15`, `:39`). A premissa de fronteira linear é a que a vNext descarta; a
parte de acessibilidade é reaproveitável.

**Central de Ajuda** — `design-plans/2026-09-24-help-center-self-service-contact-research.md`:
centralizar a **entrada** sem condicionar o contato à leitura da FAQ (`:11-13`); entrada persistente
“Ajuda” na navegação global (`:42`); busca e “Falar com suporte” no primeiro bloco (`:44`); FAQ
pequena dispensa busca (Carbon) (`:46`); “Não encontrou? Fale com suporte” repetido (`:48`);
**contato sem login** para quem não consegue entrar (`:50`); chatbot nunca como único caminho
(`:52`). Referências: Teachable, Thinkific (formulário sem login), Moodle “Contact site support”,
Canvas Help por papel, Zendesk, Intercom (evitar “busque antes de falar”), WCAG 3.2.6 *Consistent
Help* (`:19-36`). Ressalva: nenhuma fonte mede redução de chamados (`:59`).
Complemento `2026-09-24-help-flow-refinements-research.md`: contato no fim de FAQ longa “existe,
mas não é encontrável” (`:11`); respostas curtas visíveis, disclosure só para longas (GOV.UK
Details) (`:15-17`); pré-preencher e-mail e Curso/Aula de origem, no máximo 3 campos obrigatórios
(`:33-35`); sem teste com alunos (`:3`, `:39`). Refinamentos não implementados.

**Saudação do dashboard** — `design-plans/2026-09-24-student-dashboard-greeting-research.md`:
viável (precedente: Canvas mobile “Hello [Student Name]”), sem prova de efeito em engajamento
(`:10`); recomendação: “Bom dia/Boa tarde/Boa noite, [primeiro nome].” calculado no servidor com
`America/Sao_Paulo`, sem frases aleatórias nem “O que vamos estudar hoje?” (`:71-80`). **Decisão do
produto:** a saudação substitui o breadcrumb no header; no mobile vira título; preview de
Admin/Suporte não cumprimenta (`:84-86`). Riscos: `users.name` também é o “Nome no certificado”,
não há nome preferido nem fuso por aluno (`:19-20`, `:49`). Referências: Canvas, Coursera (2019),
Duolingo (2022), LinkedIn Learning, Udemy “My learning”, Moodle (`:29-35`).

**Preview de Certificado** — `design-plans/certificate-preview-market-research.md` (em inglês):
nenhum padrão (W3C VC, Open Badges) exige perfil de emissor completo para editar/pré-visualizar
(`:9`, `:46`); usar dados reais do Curso/emissor e **aluno sintético claramente marcado** (`:10`,
`:47`); **um único preview**, variando fixture curta/longa (`:12`, `:48`); validar layout **no mesmo
renderer do PDF final** (`:49`). Auditoria: o canvas era DOM e o PDF outro pipeline (`:59`); emissor
e CNPJ hardcoded no preview (`:56`). Referências: Thinkific, Sertifier (shrink-to-fit), Credly,
LearnWorlds, Teachable (Liquid), Moodle Workplace, Canvas Catalog, issue Documenso #2669
(divergência preview×PDF) (`:20-42`).

**Oferta antes da compra** — `design-plans/course-offer-preview-dialog.md`: modal compartilhado para
grátis e pago com ações em adaptadores separados (`:16`); hero com capa; Aulas/Módulos só se > 0;
carga horária só no pago; “12 meses de acesso” sem data inventada; certificado só se o fluxo
permitir; preço e condições Pix/parcelamento só no pago; CTA pago leva a `/comprar/[slug]`; o modal
não cria Pedido (`:12-59`). Antes, só o gratuito tinha modal (`:8`). Implementado
(`src/features/courses/course-offer-dialog.tsx`, citado em
`research/2026-09-21-neuro-brand-ux-report-validation.md:119-122`).

**Sucesso do checkout** — `design-plans/checkout-success-course-summary.md`: a página é de
**status**, não uma terceira cópia do resumo (`:18`); fluxo “Catálogo/modal decide → Handoff prepara
→ Sucesso confirma acesso → Curso consome” (`:22-27`); status neutro “Acesso em confirmação”, título
“Estamos liberando seu acesso”, linha compacta do curso sem preço (`:29-39`); **nunca “Pagamento
aprovado” antes do acesso server-side** (`:14`, `:95`); estados redirect, espera, timeout após 30
tentativas, sem `courseId` (`:45-50`); bug de polling sobreposto (`:54`). Referências: Shopify Order
status page, Stripe Fulfillment (confirmação por webhook), Udemy, NN/g (`:58-61`).

**Upload de imagem** — `design-plans/2026-09-24-image-upload-research-sources.md`: `fetch` não
expõe progresso de upload, `XMLHttpRequest.upload` sim (`:14`); percentual só no PUT, demais fases
indeterminadas (“Preparando”, “Enviando”, “Confirmando imagem”, “Salvando”) (`:18`); CORS do R2 deve
expor `ETag` (`:22`); presigned R2 é bearer, usa domínio S3, validade 1 s–7 dias (`:24`); cache:
usar URL versionada, não `key` do React (`:28-34`); cache de borda do R2 exige custom domain
(`:32`). **[INFERÊNCIA]** Altamente aplicável à vNext (presigned PUT + confirmação, R2 canônico).

**Latência do callback Google** — `design-plans/2026-09-28-google-oauth-callback-latency-review.md`:
resolver o destino por papel no servidor e redirecionar antes de renderizar (`:17-23`). Proposta.

#### 3.2.2 Documentos `neuro-brand-*` (marca; detalhados na seção 2)

| Documento | Resumo |
|---|---|
| `neuro-brand-design-system-refactor.md` | Plano “implemented” em fases 0–7 (anchors, matriz de consumidores, fixture, primitives, shell/Auth, Student, Admin); pendências: Badge default, contraste renderizado, CTA laranja, vetor oficial, inspeção humana (`:446-477`) |
| `neuro-brand-impeccable-review.md` | Score 31/40; botão volta a petróleo; superfícies voltam ao teal (`:11-39`) |
| `neuro-brand-report-validation.md` | Valida 48 pontos de um “Relatório Brand” externo; aprova transição gradual e contenção; rejeita afirmações desatualizadas (`:21-33`); nenhuma pesquisa com usuários prova “os usuários não perceberão” (`:322-325`) |
| `neuro-brand-system-implementation-report.md` | Implementado em `ef34238`, “ainda não integrada ou publicada” (`:218`); corrigiu testes que codificavam “o antigo logo PROTEA-R global” (`:111`, `:134`) |
| `neuro-brand-token-consumer-matrix.md` | Inventário de consumidores de `primary`/`accent`/`brand-*`; todo novo uso deve ser classificado (`:3`, `:16-18`) |

**[INFERÊNCIA] Padrões recorrentes nos design-plans:** (1) toda pesquisa conclui com “não há
evidência com usuários reais” — o legado nunca entrevistou nem testou com alunos; (2) os acertos
mais portáveis são sobre **estados** (sucesso de checkout como status, sidebar com estados
independentes, ajuda com contato sem login), não sobre visual.

---

## 4. research e docs/superpowers

### 4.1 `research/` (25 documentos)

| Documento | Tema → conclusão (evidência) | Mercado citado | Status |
|---|---|---|---|
| `2026-07-22-learning-analytics-lgpd.md` | Progresso essencial usa **execução de contrato** (LGPD art. 7, V), não consentimento (`:15-26`); analytics individual opcional exigiria consentimento ou legítimo interesse documentado (`:35-49`); não usar analytics para negar acesso/classificar (art. 20) (`:55-57`); na época o limiar automático era **98%** (`:68`) | LGPD, guias ANPD | pesquisa; depois virou opt-out (ADR-0008) |
| `2026-08-07-certificate-production-best-practices.md` (747 linhas) | Registro autoritativo, `certificate_status` separado de `render_status`, emissão idempotente, artefato imutável, código CSPRNG não enumerável, revogação observável (`:13`, `:37-84`); página pública deve mostrar as alegações para detectar PDF adulterado, “nunca só ‘válido’” (`:684`); Open Badges/VC/PAdES/PDF-A só como P2 (`:672-690`); gate P0 inclui política jurídica de retenção (`:658`) | Moodle Workplace, Moodle customcert (CVE IDOR), Open edX, Canvas Credentials, OWASP, ANPD, ITI | critérios |
| `2026-08-08-certificate-editor-ui-research.md` | O editor tinha **13 campos × 8 controles** em acordeões (4 sliders de geometria, tamanho, cor, alinhamento, fonte) (`:9`); recomenda canvas + lista + inspector de um campo (`:11-17`) | Figma, Spectrum, Material, Radix, HIG, APG | executado parcialmente |
| `2026-08-08-certificate-editor-direct-manipulation.md` | Arquitetura híbrida DOM-first com handles; spec em % de A4; **PDFKit continua autoridade de overflow**; “um elemento que parece caber no browser ainda pode falhar” (`:9-27`); escopo com snap, guias, zoom/pan, undo/redo (`:227-402`) | Figma, Canva, Framer, draw.io; interact.js, Moveable, Konva, Fabric | aprovado e implementado em parte |
| `2026-08-08-certificate-editor-premium-ui.md` | App frame em 3 áreas, inputs X/Y/L/A com passo 0,1%, multi-seleção/grupos só com aprovação (`:10-299`) | Figma, Spectrum, Material, Canva, Slides | aprovado |
| `2026-08-17-course-availability-market-practices.md` | Pausar vendas não altera acesso; “Em breve” capta interesse sem cobrar (`:8-11`); três dimensões + presets (`:24-26`); pré-venda paga e captura pública de e-mail fora (`:27`) | Podia, LearnWorlds, Teachable, Thinkific, **Kajabi (Product/Offer/Store)** (`:15-19`) | decisão aplicada |
| `2026-08-18-certificate-student-ux-market-practices.md` | Dois caminhos: ação contextual no Curso + arquivo global (`:11-15`); estados incompleto/preparando/disponível/falho (`:38-40`); se o PDF for público, o código vira bearer link (`:46-55`) | Thinkific, LearnWorlds, Udemy, Teachable, LinkedIn Learning | implementado |
| `2026-08-18-public-certificate-verification-ux-market-practices.md` | Página de propósito único: status inequívoco, documento dominante, “Baixar PDF” e “Copiar link”, só o código abaixo (`:9-17`); mesmos estados com a mesma estrutura (`:76-81`); nada de e-mail/CPF/compra, `noindex` (`:101`) | Thinkific, LinkedIn Learning, **Credly**, **Accredible**, Udemy | implementado; conflita com o P0 de “mostrar alegações” |
| `2026-08-19-email-auth-system-consolidated-audit.md` | Snapshot histórico não canônico; templates **React Email** na época (`:49`); ativação de conta após compra (`:90-110`); não havia verificação de e-mail (`:224-230`); sprints 0–5 (`:378-421`) | — | histórico |
| `2026-08-19-neon-ci-branch-cleanup-practices.md` | Branches efêmeras: delete em `always()` + `expires_at` + janitor com allowlist; projeto Neon dedicado à CI (`:9-17`, `:93-105`) | Neon API/actions, GitHub Actions | **diretamente aproveitável na vNext** |
| `2026-09-12-video-watch-coverage-research.md` | `max_position_seconds` não prova cobertura (salto 30→950) (`:22-26`); separar retomada, tempo reproduzido e cobertura (`:14-26`); `watched_percent` é o nome “mais perigoso” (`:359-361`); recomendação A: manter posição máxima, preservar conclusão manual (`:427-450`); retomar pelo último checkpoint confiável (`:82-89`) | YouTube IFrame, Vimeo player.js, **Mux** (Watch vs Playing time), Wistia, JMVStream, WHATWG | pesquisa; o legado depois foi para fronteira linear 100% |
| `2026-09-15-free-course-external-research.md` | Gratuito = autoinscrição → Concessão → Matrícula; não chamar Asaas (`:90-94`, `:214-220`); piso R$ 10 é regra do domínio (`:95-98`); **“não justifica criar `course_offers` agora”** (só com vários preços, campanhas, cupons, trilhas) (`:202-205`) | Asaas Checkout, Thinkific, Teachable, Moodle, Open edX, Kajabi Offers | pesquisa → ADR-0016 |
| `2026-09-19-comment-discussion-versioning.md` | Discussão pertence a Curso + identidade pedagógica, não à publicação física; não copiar comentários (`:12-35`); alternativa C (`lesson_discussions`) como longo prazo (`:339-375`) | Moodle Forum, Canvas, **Open edX Course Reruns**, GitHub Discussions, Discourse | pesquisa → ADR-0018 |
| `2026-09-19-admin-latest-comments.md` | Feed “Últimos comentários” (5 itens), não inbox — chamar de inbox seria “enganoso” (`:12`, `:162-183`); PII mínima (`:288-300`); produto decidiu: sem inbox, Admin e Suporte com as mesmas permissões sobre comentários (`:465-474`) | GitHub/Primer, **Linear Inbox**, Slack, **Intercom Inbox**, Moodle, Open edX | implementado |
| `2026-09-19-system-states-recovery.md` | Linguagem comum para estados: o que aconteceu, se precisa agir, ação segura, quando entra o suporte (`:32-34`); `RecoveryShell` com uma ação primária e ID de correlação secundário (`:119-141`); 404 neutro sem revelar permissão (`:155-172`); manutenção com escopo, 503 + `Retry-After`, sem countdown inventado (`:198-209`) | Next.js, Vercel, RFC 9110, Stripe Request IDs, Sentry, Statuspage | pesquisa; `system-state-shell.tsx` existe |
| `2026-09-21-admin-dashboard-surface-hierarchy-ux-research.md` | “Não implementar a reorganização ampla sugerida pelo relatório do estagiário” (`:123-124`); ordem: resumo do dia → pendências → conteúdo/certificados → contexto → atividade recente → suporte (`:9-16`) | GOV.UK, Shopify, Carbon, Atlassian, Fluent, Material | polimento |
| `2026-09-21-certificate-archive-warmth-refinement.md` | PNG de preview como miniatura só para `valid+ready`; sem métricas, ranking ou social (`:7-30`, `:209-226`) | Thinkific, LinkedIn Learning, Credly, Udemy | proposta |
| `2026-09-21-certificate-student-ux-research.md` | Três superfícies (Curso, `/app/certificados`, `/certificados/[code]`) (`:9-18`); conquista factual, sem gamificação; **não sugerir certificação profissional** (`:109-115`); certificado como “ferramenta de continuidade profissional” (`:234-235`) | Thinkific, LinkedIn Learning, Credly, Udemy, OB3/VC | implementado |
| `2026-09-21-course-header-refinement-ux-research.md` | Metadados em `<dl>`, capa compacta, sem CTA duplicado (`:44-78`) | Fluent, Atlassian, Open edX, Moodle | descartado |
| `2026-09-21-course-overview-hero-ux-research.md` | Três entradas concorrentes (header, “Continuar assistindo”, trilha); propõe um “hero de reentrada” (`:50-80`) | — | pulado no sprint |
| `2026-09-21-neuro-brand-ux-report-validation.md` | Personalidade por composição, não cor/efeitos (`:23-27`); dashboard orientado ao próximo passo (`_nextCourse` calculado e não usado, `:29-35`); rejeita blobs/glow, KPIs/streaks/XP, header de 68–72 px, tabelas Admin em cards (`:90-115`); alvo de toque WCAG é 24 px, não 44 (`:60-86`) | Fluent, Atlassian, Material 3, WCAG 2.5.8/2.4.13, NN/g | validação |
| `2026-09-21-student-next-step-ux-research.md` | Bloco de continuidade só com exatamente um curso ativo (`:57-65`); “Iniciar” em 0% (`:69-70`); sem streak/culpa (`:71`); não existe `lastAccessedAt` (`:14-19`, `:79-86`) | LinkedIn Learning, Moodle, estudos de learning analytics | pesquisa |
| `2026-09-21-visual-foundation-density-investigation.md` | Densidade base confortável global, redução local por `size="sm"` (`:11-14`, `:145-151`); radius anterior era **0.25rem** com 112 `rounded-lg`, 79 `rounded-xl`, ~233 `<Card>` (`:32-58`); “reduzir superfícies antes de aumentar o radius” (`:155-159`); light mode fora de escopo (`:185-192`) | Fluent 2, Atlassian, Material Cards | decisão parcial |
| `2026-10-01-auth-review-remediation-research.md` | Reset de senha com resposta e tempo uniformes; rate limit por IP e hash do e-mail; o limitador do Better Auth roda dentro do handler (`:7-21`) | Better Auth, OWASP | pesquisa |
| `2026-10-01-unpushed-identity-code-review.md` | **“Não recomendar promoção para Production”** (`:7`): candidato com 180 arquivos e +56.362 linhas, “grande parte” snapshots de migration Drizzle (`:14`), 4 P1 e 12 P2 (`:251`) — reset antigo válido após troca de e-mail, índice canônico de e-mail quebrando a compra pública, Staff só com Google sem conseguir autorizar reembolso (exige senha), suspensão fora das APIs nativas do Better Auth (`:23-159`); 3.654–3.715 testes, migrations até 0103 (`:177`, `:233-246`) | — | remediação local sem deploy |

**[INFERÊNCIA]** Os documentos mais valiosos para a vNext, independentes de stack: estados de
recuperação (system-states), ajuda/contato, sucesso de checkout como status, três superfícies de
certificado sem gamificação, base legal LGPD para progresso × analytics, práticas de CI com Neon e
a pesquisa de cobertura de vídeo (útil para justificar o threshold de 90% sem anti-seek). O mais
alarmante é o `unpushed-identity-code-review`: o ciclo de identidade (Google + convites + perfil)
acumulou um candidato de 180 arquivos (+56 mil linhas, muitas delas snapshots gerados de migration) com 4 achados P1 de segurança/finanças e não promovível — sinal de complexidade acidental e de lotes grandes demais.
### 4.2 `docs/superpowers/` (47 planos + 30 specs)

Abreviações: `SP/P` = `docs/superpowers/plans/`, `SP/S` = `docs/superpowers/specs/`.

**Distribuição por tema** (contagem do subagente de leitura):

| Tema | Planos | Specs | Total | Linhas aprox. |
|---|---:|---:|---:|---:|
| Certificados e editor | 13 | 9 | **22** | 3.518 (só o editor: 13 docs em 8 dias) |
| Release, infra e prontidão (Coolify, Vercel, Staging, hardening) | 14 | 7 | **21** | 9.204 |
| Cursos, conteúdo, drip por Módulo, autoria | 9 | 7 | **16** | ~4.900 só o drip |
| Pagamentos e Asaas | 4 | 4 | **8** | ~3.600 |
| E-mail e Resend | 4 | 1 | **5** | 2.760 |
| Identidade e UX de autenticação | 3 | 2 | **5** | ~1.600 |

**Certificados/editor (22)** — `2026-07-22-certificate-hardening-design` (PDF imutável PDFKit);
`2026-08-07-certificate-editor-ux-ui`; `2026-08-08-…direct-manipulation` (a spec diz que **substitui o
não-objetivo anterior que excluía drag-and-drop**, SP/S `:9-10`); `2026-08-08-…premium-refinement`
(override de carga horária no certificado); `2026-08-08-…ux-corrections` (correções no mesmo dia);
`2026-08-14-certificate-editor-and-course-workload` (**move o override para o Curso seis dias depois**);
`2026-08-14-…preview-toolbar-density` (toolbar no cabeçalho do preview) e
`2026-08-14-…toolbar-alignment-density` (**no mesmo dia** reverte: “Keep the preview header to the
title only”, SP/S `:13-14`); `2026-08-17-certificate-production-hardening` (corridas
conclusão/outbox/certificado); `2026-08-18-…public-page-refinement`; `2026-09-04-optional-certificate-title-and-issuer`;
`2026-09-05-certificate-preview-font-parity` (PDF em Helvetica vs PNG via Sharp/librsvg → Inter
embarcada); `2026-09-25-certificate-code-base64url-migration` (`PRT-`+32 hex → Base64URL 22 chars).

**Release/infra (21)** — `2026-07-25-coolify-release-readiness` (abandonado ~2 dias depois);
`2026-07-25-vercel-first-migration` (Vercel Pro primário); `2026-07-27-shared-development-environment`;
`2026-07-27-simplified-release-and-development-migrations` (fluxo pensado para “dev júnior”);
`2026-08-01-staging-*` (Staging persistente, manutenção total); `2026-08-06-timezone-policy` (UTC na
persistência, `America/Sao_Paulo` na apresentação); `2026-08-19-seven-sprint-hardening` (fora de
escopo explícito: **CourseOffering/coortes, avaliações, assignments, subscriptions, SCORM,
multitenancy**, SP/S `:30-32`); `2026-08-23-production-readiness-remediation` (plano mestre de **2.582
linhas**, nascido do NO-GO de 23/08; tarefas TOTP/MFA **superseded**); `2026-08-29-production-no-emergency-bypass`
(remove bypass criado 4 dias antes); `2026-08-31-release-flow-hardening`; `2026-09-03-readiness-remediation`;
`2026-09-03-repository-cleanup-sprints`.

**Cursos/conteúdo (16)** — `2026-07-22-default-learning-analytics-preference` (opt-out e remoção do
reengajamento individual); `2026-08-16-course-management-tabs-refactor` (abas Visão geral, Conteúdo,
Certificado); `2026-08-16-course-price-confirmation` (AlertDialog ao alterar preço);
`2026-08-16-course-settings-layout`; `2026-08-17-course-availability-and-interest-design`;
`2026-08-31-lesson-authoring-validation-errors`; `2026-09-04-module-content-release` (plano de **2.546
linhas**; D+N sem cron, sem regra por Aula, sem coorte); `2026-09-06-module-content-release-final-remediation-sprints`
(1.077 linhas); `2026-09-06-refine-locked-content-ui` + `2026-09-06-locked-content-ui-polish` (duas
rodadas no mesmo dia); `2026-09-06-remove-purchase-schedule-handoff` (**remove o cronograma visual que
o drip havia colocado em `/comprar`**).

**Pagamentos (8)** — `2026-07-29-asaas-production-cutover-cleanup` (havia 5 Pedidos AbacatePay de
teste em Production); `2026-07-30-public-course-purchase-handoff` (link estável usado por landing pages
“em outro repositório”, identidade resolvida após o pagamento); `2026-08-03-payments-module-hardening`.

**E-mail (5)** — `2026-08-19-resend-hosted-email-templates-migration` (1.799 linhas; HTML sai do
runtime para Resend Hosted Templates); `2026-08-19-resend-neurocapacitar-brand-refresh`;
`2026-08-23-email-auth-resend-completion-sprints` (**substituído no mesmo dia, “Não executar”**);
`2026-08-29-resend-webhook-body-limit` (256 KiB).

**Identidade (5)** — `2026-07-25-public-signup-ci-r2-recovery` (cadastro público por flag);
`2026-09-03-action-outcome-and-password-recovery-ux`; `2026-09-29-identity-onboarding-profile`
(confirmation-first, Google com prova local, convites, perfil; **etapa 6 de rollout em andamento**,
`:19`; MFA fora, `:33`).

**[INFERÊNCIA] Acidental × essencial:**

- **Acidental:** editor de certificado (13 docs em 8 dias, reversões no mesmo dia, três renderizadores
  — DOM, PDFKit, SVG/Sharp); release/infra (troca Coolify→Vercel em 48 h, 4 requalificações de
  prontidão, bypass criado e removido, ~33 PRs só para diagnosticar backup `pg_dump`, 17 PRs de
  Sentry); meta-trabalho com agentes (8 auditorias de skills/AGENTS em `docs/reviews/2026-09-06-*`,
  ~3,7 mil linhas, 1.521 SKILL.md inventariados); polish incremental (locked content 2×, cronograma de
  compra adicionado e removido).
- **Essencial:** precedência financeira Asaas, handoff público, drip D+N, ciclo do certificado — temas
  que também consumiram muitos documentos, mas trataram riscos reais de dinheiro, acesso e prova.

### 4.3 `plans/` (README + 000–014 + 2 extras)

- **[FATO]** `plans/README.md` (auditoria contra CourseLit, LearnHouse, Frappe LMS) conclui que o Hub
  “não precisa se transformar em um LMS horizontal” (`:13-16`). **Decisões humanas registradas**
  (verificadas): D2 — “Não deve haver prova, o certificado é comprovante de conclusão de visualização
  de aulas.” (`:404`); D4 — **“Sem avaliações.”** (`:423`); D5 — “Manter comentários por aula, nao
  teremos comunidade.” (`:433`); D6 — 2FA obrigatório para Admin/Suporte (`:442`), depois revertido
  (`docs/decisions.md:218-220`). Rejeitados: subscriptions, bundles, múltiplos gateways, SCORM, IA,
  comunidade (`:444-473`). A tabela de roadmap (`:328-342`) ficou desatualizada (001–012 “TODO”, embora
  vários tenham sido executados).

| Plano | Tema → proposta | Desfecho |
|---|---|---|
| 000 staged-access-evidence | política de disponibilidade temporal separada de direito; não condiciona arrependimento (`:17-41`) | virou drip D+N |
| 001 database evolution | journal não reproduzia o schema (`:21-24`) | executado (108 migrations) |
| 002 certificate concurrency | `ON CONFLICT` anunciava código inexistente | executado |
| 003 CI & testes | 28 de 73 testes verificavam string do código | executado (11 workflows) |
| 004 segurança | 2FA, rate limit distribuído, CSP | parcial; MFA removido |
| 005 outbox/audit | outbox e auditoria transacional | executado |
| 006 observabilidade | health, SLO, restore testado | em grande parte; SLO pendente |
| 007 jornadas admin cert/privacidade | fechar jornadas só de backend | certificado feito; privacidade removida |
| 008 architecture deepening | arquivos > 1.300 linhas | sem evidência |
| **009** learner UX & a11y | estados, foco, teclado, landmarks, retomada, notas privadas “somente após validação” (`:28-56`), notificação de resposta/menção (`:118-123`) | parcial; sem axe, notas ou notificações |
| **010** policy, versions, **cohorts** | `CourseVersion` + `Cohort` **só com calendário real** (`:38-68`) | resolvido por decisão: **sem coorte**, currículo vivo (`docs/decisions.md:81-83`, `:424-426`) |
| **012** analytics & reengagement | funil, drop-off, lista de inativas, reengajamento manual (`:109-128`) | **rejeitado em parte**: só agregados (`docs/decisions.md:131-135`) |
| 013 admin latest comments | feed sem inbox/lido/atribuição (`:35-44`) | DONE |
| 014 stable discussion fields | discussão por `(course_id, curriculum_key)` | DONE (desenho que a vNext proíbe) |
| `2026-07-25-coolify-predeploy-checklist` | 37/37 itens | obsoleto (Vercel) |
| `2026-08-07-certificate-production-readiness-audit` | NO-GO; GOV-001 (política jurídica/LGPD dos certificados) pendente (`:13-24`, `:181-200`) | parcial |

### 4.4 `docs/reviews/` (principais)

- Prontidão: `2026-08-23-production-readiness-audit` **NO-GO** (Suporte atravessava RBAC, backup sem
  cópia independente); `2026-08-26-…requalification`: “Production está no ar e o checkout real já
  registrou uma venda” (`:13-14`); `2026-09-03-…requalification`: **GO**.
- `2026-09-07-design-document-comparison.md` — compara o design.md da Vercel com o DESIGN.md; mantém
  dark-only, Geist, Hugeicons; decide não adicionar `prefers-reduced-motion` (`:24-26`, `:101-124`).
- `2026-09-14-neuro-brand-report-research.md` e `2026-09-15-brand-report-validation-research.md` —
  validações dos relatórios de rebrand (contrastes na seção 2.4; Focus Appearance é AAA; separar
  `focus`, `text-selection`, `control-selected`; `Button accent` opt-in).
- `2026-09-30-account-settings-ux-review.md` (accepted) — senha **removida das Configurações** (só
  recuperação por e-mail) (`:11-16`); Student em coluna única, Admin/Suporte com abas Perfil,
  Certificados, Plataforma (`:18-24`); avatar: foto personalizada → Google → iniciais (`:136-138`);
  Google “Conectar/Conectado”, **sem desconexão** (`:144`).
- `2026-10-03-course-pricing-mode-ux-research.md` (proposed) — `fieldset` com radios **Gratuito/Pago**
  sem pré-seleção; sem boolean/enum, `price_in_cents` como fonte única (`:18-33`); benchmarks Hotmart,
  **Kiwify** (mínimo R$ 5), Udemy, Teachable, Thinkific (`:68-133`).
- `2026-08-03-asaas-installment-interest-research.md` — **parcelamento com juros pausado**; preço
  único com taxas absorvidas (`:9-14`); Asaas não tem `interestPayer`, `interest` é juros de mora
  (`:31-44`); taxas Sandbox p/ R$ 100: 1x 2,99% + R$ 0,49; 2–6x 3,49% + R$ 0,49; 12x 3,99% + R$ 0,49
  (`:164-169`); PR #26 fechado sem merge.
- `2026-08-06-timezone-policy-research.md` — UTC persistido, apresentação em `America/Sao_Paulo` com
  `timeZone` explícito; não usar região do servidor nem offset fixo; fuso por pessoa só com
  preferência IANA explícita (`:11-112`).
- `2026-10-03-cloudflare-rate-limit-research.md` / `rate-limits-project-audit.md` (proposed) — rate
  limit em memória não é compartilhado entre instâncias; WAF Rate Limiting na borda como camada
  incremental. **[INFERÊNCIA]** relevante para a vNext em Workers.
- `2026-09-25-certificate-*` (4 pesquisas): código Base64URL de 22 chars (128 bits); paridade preview×PDF;
  restaurar versão antiga de template como novo rascunho (UI nunca implementou).

- **[FATO]** GitHub: o repositório tem **0 issues** e 264 PRs (≈230 manuais); o backlog viveu só em
  documentos. `docs/` tem 161 .md (~55 mil linhas); somando planos e pesquisas, ~266 documentos e ~80
  mil linhas, contra ~234 mil linhas de TS/TSX e 108 migrations; `grep TODO|FIXME src` = 0
  (levantamento do subagente via `gh` e `wc`).

---

## 5. ADRs 0001–0018

**[FATO]** Todas as 18 ADRs têm `status: accepted` no frontmatter (linha 2 de cada arquivo). Nenhuma
está marcada como `superseded`; mudanças foram feitas por **emendas** internas (ex.: ADR-0006
emenda de 2026-09-25, `docs/adr/0006-certificate-lifecycle.md:114-138`) ou por decisões DEC-DISC que
emendam outras (DEC-DISC-018 emenda DEC-DISC-014, `docs/decisions.md:302-337`). O índice
`docs/README.md:82-83` lista a ADR-0017 duas vezes com títulos diferentes.

Classificação: **E** = complexidade essencial (problema real do domínio); **A** = acidental
(consequência de escolhas de implementação/stack ou de requisitos que a vNext já descartou);
**M** = misto.

| ADR | Decisão (1 linha) | Status | Classe | Comentário |
|---|---|---|---|---|
| 0001 RBAC próprio | Papéis em `profiles.role` + capacidades em `auth-policy.ts`; sem Admin/Organization Plugin do Better Auth (`0001-custom-rbac.md:13-15`) | accepted | **E** | Simples e testável; vNext mantém RBAC próprio com grants normalizados. |
| 0002 Buckets R2 | Bucket privado + público, `publishR2Object` copia privado→público, LQIP, banner 4:1 1680×420, referências temporárias reconciliadas após 24 h (`0002-r2-buckets-and-publication.md:13-25`) | accepted | **M** | Separação privado/público é essencial; cópia explícita entre buckets e reconciliação de órfãos é custo operacional (a crítica Impeccable achou banner ativo apontando para chave não publicada por ordem errada publish→ponteiro). |
| 0003 JMVStream multipart | Navegador envia partes direto ao storage da JMVStream; servidor inicia/complete; partes 64 MiB, concorrência 4 (`0003-jmvstream-direct-multipart-upload.md:13-17`) | accepted | **M** | Upload direto é essencial; acoplamento a um único provider é acidental (vNext: 6 adapters por `VideoAsset`). |
| 0004 Concessão × Matrícula | Concessão é ledger/fonte por origem (`paid_order`, `manual`, `free_enrollment`); Matrícula é projeção recomputada (`0004-access-grants-and-enrollment-projection.md:13-22`) | accepted | **E** | Herdado pela vNext (Entitlement/Enrollment). Um dos melhores acertos do legado. |
| 0005 Precedência financeira | `CHECKOUT_PAID` não libera; Pix em `PAYMENT_RECEIVED`; cartão em `PAYMENT_CONFIRMED` sem risco pendente; tolerância zero de valor; adversos prevalecem; revisões tipadas (`0005-financial-precedence-and-manual-review.md:13-60`) | accepted | **E** | Regra financeira real e testada em Sandbox; vNext herda. |
| 0006 Ciclo de Certificados | Snapshot imutável, PDF PDFKit no R2 privado, preview PNG via Sharp/librsvg/Fontconfig, template A4 com campos posicionados manualmente, `rendererVersion`, revogação/reemissão, purge em 60 dias + tombstone (`0006-certificate-lifecycle.md:13-40`, `:114-138`) | accepted (com emendas) | **M** | Ciclo (snapshot, revogação, reemissão, validação pública mínima) é essencial. Editor de posicionamento livre, paridade PDF×PNG×DOM, renderer v1/v2 e fontes empacotadas são acidentais (≈15 documentos de editor/preview; ver seção 4). vNext troca por HTML/CSS controlado + Browser Run. |
| 0007 Versionamento curricular | `CoursePublication` draft/published/retired; criar rascunho **copia** a vigente; publicar troca atomicamente; Matrícula lê sempre a vigente (`0007-course-versioning-and-enrollment-curriculum.md:13-26`) | accepted | **M → A** | “Currículo vivo” é essencial; o mecanismo de **clonar** Módulos/Aulas por publicação gerou 0014 e 0018. vNext proíbe reintroduzir clones (AGENTS.md vNext §4). |
| 0008 Analytics opcional | Eventos minimizados por padrão, opt-out em Configurações, só agregados por Aula/Publicação, retenção 12/13 meses, sem CRM (`0008-optional-learning-analytics.md:15-29`) | accepted (ratificado juridicamente em 2026-08-21, `docs/decisions.md:135`) | **E/M** | Política LGPD é essencial; o KPI de “visualização média” baseado em fronteira linear é acidental (depende de 0012). |
| 0009 Disponibilidade | Três dimensões (entrega, vitrine, vendas) mapeadas em 5 estados de UI (Rascunho, Em breve, Disponível, Vendas pausadas, Arquivado); fechar vendas cancela Checkouts; **rejeitou entidade Oferta como prematura** (`0009-course-availability-and-sale-interest.md:15-35`) | accepted | **E** | Separar acesso adquirido de vitrine/vendas é essencial. A vNext reverteu a rejeição de Offer (Course 1:N Offer). |
| 0010 Drip D+N por Módulo | D+N = N×24 h UTC desde a âncora do episódio; matrículas antigas com acesso integral; publicação não pode **aumentar** atraso efetivo; snapshot+digest do cronograma no Pedido (`0010-relative-module-content-release.md:16-36`) | accepted | **E/M** | D+N por Módulo é essencial e herdado. Regra monotônica, digest do cronograma no checkout e override “uma vez por episódio” são complexidade defensiva possivelmente excessiva para o volume. |
| 0011 Aulas opcionais | Só obrigatórias anteriores bloqueiam; opcionais não contam no denominador; recomendação segue para frente (`0011-optional-lesson-progression.md:13-21`) | accepted | **E** | Herdado pela vNext. |
| 0012 Progresso linear validado | Salto para frente não avança a “fronteira validada”; conclusão automática só a **100%** de reprodução linear; sessão de vídeo com token, última sessão vence (`0012-linear-validated-video-progress.md:11-23`) | accepted | **A** | Anti-seek com sessão emitida pelo servidor, tracking v0/v1, posição máxima vs retomada — a vNext descarta explicitamente (threshold 90%, sem anti-seek). Gerou crítica de copy confusa no player (seção 2.12). |
| 0013 Ownership Hub × provider | Hub decide negócio/idempotência; provider decide execução técnica; Hub guarda só projeção mínima e aponta para o portal do provider (`0013-provider-and-hub-operational-ownership.md:15-26`) | accepted | **E** | Princípio barato e útil; evita replicar dashboards de Resend/JMVStream. |
| 0014 Identidade de Aula entre publicações | Matriz de qual estado segue `curriculum_key`, qual fica na Aula física, transferência de watch só com mesmo `video_external_id` (`0014-lesson-identity-and-state-across-publications.md:14-29`) | accepted | **A** | Consequência direta dos clones de 0007. vNext usa IDs pedagógicos estáveis + revisões imutáveis. |
| 0015 Mídia da tela de acesso | Até 5 slides 8:7 WebP 1200×1050, autoplay 6 s, sem setas, não carrega em mobile, sem `prefers-reduced-motion` (`0015-authentication-screen-media.md:15-28`) | accepted | **A** | Carrossel administrável decorativo no login; custo de upload/validação/autorização para baixo valor, e com problemas de acessibilidade (seção 2.6). |
| 0016 Autoinscrição gratuita | Preço 0 → Concessão `free_enrollment` transacional, sem Pedido/Asaas; reentrada após expiração (`0016-free-course-self-enrollment.md:13-27`) | accepted | **E** | Herdado pela vNext (oferta gratuita sem Order/Payment). |
| 0017 Permissões granulares de Suporte | Painel/leituras compartilhados; 13 grants + 4 views em arrays `text[]` em `profiles`; Admin-only para equipe/segurança/moderação (`0017-support-granular-permissions.md:13-96`) | accepted | **E/M** | A necessidade (Suporte com subconjunto de poderes) é essencial; a evolução DEC-DISC-014 → DEC-DISC-018 em 3 semanas mostra que a matriz fixa foi errada. vNext normaliza grants em tabela. |
| 0018 Persistência estável de discussões | `lesson_comments` ganha `course_id + curriculum_key` para a discussão sobreviver a publicações (`0018-stable-lesson-discussion-persistence.md:21-35`) | accepted | **A** | Outra consequência dos clones de 0007. |

**[INFERÊNCIA] Balanço:** das 18 ADRs, ~8 são essenciais e já foram absorvidas pela vNext
(0001, 0004, 0005, 0009, 0011, 0013, 0016 e o núcleo de 0006/0010/0017). As acidentais formam um
cluster claro: **clones de publicação (0007) → identidade de Aula (0014) → discussões (0018)** e
**anti-seek de vídeo (0012) → KPIs de 0008 → copy confusa no player**, além do carrossel de login
(0015) e da renderização dupla de certificados (0006).

---

## 6. Telas públicas e autenticação

Todas as citações desta seção são de código do legado (HEAD `ed882138`); copy reproduzida entre aspas
é texto de interface do próprio produto. **[FATO]** salvo marcação.

### 6.0 Visão geral

- **Não existe home pública/marketing.** `/` exige sessão e redireciona Aluno para `/app` e equipe
  para `/admin`; sem sessão vai para `/entrar` (`src/app/page.tsx:7-11`).
- Metadata global: `title.default = "NeuroCapacitar Hub"`, template `"%s | NeuroCapacitar Hub"`,
  descrição “Plataforma de cursos da NeuroCapacitar para Alunos e equipe.”; **sem OpenGraph/Twitter**;
  `colorScheme: "dark"`, `themeColor oklch(0.237 0.025 204.4)`; `lang="pt-BR"`; Toaster sonner no topo
  direito; noindex só em Staging (`src/app/layout.tsx:23-81`).

### 6.1 `/comprar/[slug]` — handoff de compra

- **Origem:** o Admin copia o “Link público” do Curso (`src/app/(admin)/admin/cursos/[courseId]/course-purchase-link.tsx:82-90`,
  gerado em `src/features/payments/course-purchase-link.ts:49-50`); o catálogo do Aluno usa a mesma
  rota. Nenhum query param é lido. Com vendas fechadas e `launch_landing_url` configurada, a página
  **redireciona para a landing externa** (`src/app/comprar/[slug]/page.tsx:269-271`,
  `src/features/payments/purchase-handoff.ts:315-331`).
- **Login:** o **checkout pago não exige login** — sessão nula vira `buyer: { kind: "provider_pending" }`
  (`src/features/payments/public-checkout.ts:155`); rate limit HMAC(IP+Curso) de 5 tentativas/10 min
  (`:14-15`). A **inscrição gratuita exige Conta Student** (CTAs “Criar conta para se inscrever” /
  “Entrar” com `returnTo`) (`src/app/comprar/[slug]/page.tsx:124-190`).
- **Máquina de estados** (`purchase-handoff.ts:272-342`): indisponível → conta de equipe → conta
  bloqueada → matrícula revogada → já tem acesso → “Em breve” (ou redirect externo) → vendas fechadas
  (ou redirect externo) → vendas abertas (gratuito / abaixo do mínimo / checkout desabilitado /
  checkout).
- **Copy por estado** (`page.tsx:30-58`, `:104-107`, `:136-247`): “Conta de equipe — Uma Conta de equipe
  não pode comprar Cursos. Fale com o suporte.”; “Sua Matrícula já está ativa.” + “Acessar curso”;
  “Inscreva-se sem custo e comece a aprender no seu ritmo.”; “Em breve — Este Curso ainda está em
  preparação. Nenhuma compra ou Matrícula será criada antes da abertura das inscrições.”;
  “Inscrições fechadas. Quem já possui Matrícula continua com acesso normal durante o período
  contratado.”; interesse: “Quero ser avisada” / “Aviso ativado. Você será avisada quando as
  inscrições abrirem.” (`src/features/courses/course-interest-button.tsx:42-71`).
- **Checkout pago no cliente** (`purchase-handoff-client.tsx`): POST automático na montagem (sem
  formulário nem segundo clique) (`:479-494`); `checkoutAttemptId` em local/sessionStorage com TTL 1 h
  para idempotência entre abas (`:46-104`); polling com backoff 1/2/4/8/16 s e depois checagem manual
  (`:50`, `:344-362`); redirect só para `https://` em domínios Asaas (`checkout-navigation.ts:1-45`).
  Estados: “Preparando seu checkout…”; “Ainda estamos preparando seu checkout. Não inicie outra
  tentativa.” + “Referência do pedido” + “Verificar novamente”; “Não foi possível preparar o
  checkout.” + “Tentar novamente” (`:242-303`). Abaixo, “Resumo da compra” com preço e “Aceita Pix ou
  cartão em até Nx” (`:533-552`, `src/features/courses/course-offer-facts.ts:117-139`).
- **Layout:** coluna única `max-w-2xl`, logo acima, cards `rounded-2xl`, hero com capa e fatos
  (Conteúdo, Carga horária, Acesso em meses, “Certificado: Ao concluir”) com ícones Hugeicons
  (`src/features/courses/course-offer-page.tsx:7-60`, `course-offer-facts.ts:18-74`).

### 6.2 `/checkout/*` — retorno do Asaas

- `/checkout/sucesso` (público) **não consulta Pedido nem concede acesso**: badge “Pagamento em
  confirmação”, H1 “Seu acesso está sendo preparado”, “Assim que o pagamento for confirmado,
  enviaremos as instruções de acesso para o e-mail usado na compra…”; CTAs “Ir para login” e
  “Reenviar acesso” (→ `/recuperar-senha`) (`src/app/checkout/sucesso/page.tsx:8-32`).
- `/checkout/cancelado` e `/checkout/expirado`: resolvem `attemptId` para oferecer “Tentar novamente”
  em `/comprar/<slug>`; copy “Checkout cancelado — Nenhuma confirmação de pagamento foi recebida…” e
  “Checkout expirado — O prazo desta tentativa terminou sem confirmação…” (`cancelado/page.tsx:23-33`,
  `expirado/page.tsx:23-33`).
- `/app/checkout/sucesso` (autenticado): redireciona ao Curso se o acesso já existe; senão “Seu acesso
  está sendo liberado — Recebemos o retorno do checkout e estamos confirmando sua matrícula. Não é
  necessário iniciar outra compra.” e polling de `/api/enrollments/access` a cada 2,5 s até 30 vezes
  (`src/app/(student)/app/checkout/sucesso/page.tsx:36-72`, `checkout-access-waiter.tsx:16-165`).
- **[INFERÊNCIA]** Boa prática portável: a tela de retorno é **status**, nunca autoridade; acesso vem
  só do webhook processado (alinhado à vNext).

### 6.3 `/certificados/[code]` — validação pública

- Código opaco de 16 bytes em base64url (~22 caracteres), banco guarda hash SHA-256
  (`src/features/certificates/certificate-code.ts:5-16`); rate limit 20/min com resposta `notFound()`
  (`public-rate-limit.ts:7-8`); `noindex, nofollow`.
- **Expõe publicamente:** nome do aluno, título do Curso, código, prévia PNG e botões **“Baixar PDF”**
  e “Copiar link” sem login (`src/app/certificados/[code]/page.tsx:76-156`,
  `certificate-public-actions.tsx:47-59`); o PDF é verificado por SHA-256 e entregue por URL assinada
  curta (`pdf/route.ts:36-70`). Header “Verificação de certificado — NeuroCapacitar · Credencial
  digital” (`page.tsx:86`).
- Status: “Certificado válido”, “em preparação”, “indisponível” (orienta Suporte), “revogado”
  (`certificate-public-status.tsx:34-57`). Após purge: “Este certificado foi revogado… O documento e os
  dados associados foram removidos após 60 dias” (`page.tsx:111-178`).
- PDF gerado com **pdfkit** + Inter + QR code (`src/features/certificates/pdf-document.ts`,
  `font-assets.ts:6-16`, `rendering.ts:49`).
- **[INFERÊNCIA]** A vNext restringe o PDF público (“validação pública mínima não oferece PDF
  irrestrito”); o legado tomou a decisão oposta de forma documentada
  (`research/2026-08-18-certificate-student-ux-market-practices.md:46-55`).

### 6.4 `/manutencao`

- Ativada por `APPLICATION_MAINTENANCE_MODE=full`; o proxy reescreve páginas para `/manutencao` com
  503, APIs/escritas recebem JSON 503 + `Retry-After: 3600`; health e crons passam
  (`src/proxy.ts:12-34`, `src/lib/maintenance-mode.ts:7-36`).
- Copy: “Manutenção em andamento — Ambiente em manutenção — Estamos realizando uma manutenção
  temporária para preparar a plataforma. Tente novamente em alguns minutos.” + “Tentar novamente”
  (`src/app/manutencao/page.tsx:10-17`, `src/components/system-state-shell.tsx:17-53`).

### 6.5 `/politica-de-privacidade`

- Título “Aviso de privacidade”, **57 linhas**, duas seções: “Dados de aprendizagem” (acesso,
  progresso, conclusão, posição de vídeo para entrega; analytics opcional sem IP/user agent/replay) e
  “Controle e retenção” (opt-out em Configurações; brutos 12 meses, agregados 13; suporte 90 dias;
  certificado revogado removido após 60 dias com hash mantido, “não tratado como dado anonimizado”;
  direitos “pelo canal de suporte informado pela NeuroCapacitar”) (`src/app/politica-de-privacidade/page.tsx:13-52`).
- **Não traz** controlador (razão social/CNPJ), Encarregado/DPO, menção à LGPD, bases legais nem
  terceiros (Asaas, Resend, JMVStream, Vercel, Sentry, Neon, R2, Google). Não há Termos de Uso. Link
  só a partir de `/app/configuracoes` (`src/app/(student)/app/configuracoes/page.tsx:99`), não no
  login nem no checkout.
- **[INFERÊNCIA]** É um aviso de escopo restrito ao analytics, não uma política de privacidade
  completa; a ratificação jurídica de DEC-DISC-009 cobriu só esse escopo (`docs/decisions.md:135`).
  A vNext precisa de política e termos completos (gap real, não herdável).

### 6.6 `(auth)` — rotas e UX

Rotas: `entrar`, `cadastro`, `confirmar-email`, `confirmar-troca-email`,
`convites/equipe/aceitar`, `oauth/callback`, `recuperar-senha`, `redefinir-senha`. **Não há
onboarding.**

- **Layout split (`AuthShell`):** grid `lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]`,
  formulário `max-w-[30rem]` com logo, coluna de mídia `hidden lg:flex` (`src/components/auth-shell.tsx:14-51`).
  Mídia = `AuthMediaCarousel` com slides do banco, fallback `/brand/login-capa.webp`, autoplay 6 s,
  `stopOnMouseEnter: true`, `stopOnFocusIn: false`, indicadores com ativo alongado, `alt=""`, não
  renderiza abaixo de 1024 px (`src/features/auth-media/auth-media-carousel.tsx:17-194`).
  **[INFERÊNCIA]** Diverge da ADR-0015 (“pausa/retomada acessível e pausa em foco/hover”): não há
  controle de pausa e o foco não pausa.
- **`/entrar`:** H1 **“Bem-vinda de volta”** (`src/app/(auth)/entrar/page.tsx:137`); “Acesse sua conta
  para continuar seus estudos.”; “Entrar com Google” + “ou continue com e-mail”; placeholder
  “aluno@exemplo.com”; “Esqueci minha senha”; erros “E-mail ou senha incorretos.”, “Confirme seu e-mail
  para continuar.” + reenvio; Aluno suspenso vê “Acesso à plataforma suspenso” + `mailto:` de suporte
  (`page.tsx:46-175`, `sign-in-form.tsx:87-268`). `returnTo` só aceita `/comprar/<slug>`
  (`src/lib/auth-return-to.ts:17-42`). **Não há link para `/cadastro` no login.**
- **`/cadastro`:** **sem senha** — só nome completo e e-mail, envia link de confirmação (“o link expira
  em uma hora”); “Criar conta com Google”; com a flag desligada: “Cadastro indisponível… Se você já tem
  uma conta ou comprou um curso, entre para continuar.” (`src/app/(auth)/cadastro/page.tsx:52-93`,
  `sign-up-form.tsx:71-126`).
- **`/confirmar-email`:** token no fragmento `#token=` removido com `history.replaceState`; exige clique
  explícito; “A confirmação não inicia uma sessão nem define uma senha.”
  (`email-challenge-confirmation.tsx:26-124`).
- **`/recuperar-senha` / `/redefinir-senha`:** resposta neutra anti-enumeração; senha mínima de 8
  caracteres; token válido por 1 h; reset revoga sessões (`request-password-reset-form.tsx:17-108`,
  `src/lib/password-policy.ts:1-9`).
- **`/oauth/callback`:** “Concluindo seu acesso…”; erro “Não foi possível entrar com Google — Confira se
  você usou o e-mail da sua conta…” com reenvio de confirmação inline (`oauth-callback-client.tsx:154-273`).
- **`/convites/equipe/aceitar`:** aceitar **converte o Aluno em equipe** e remove o acesso à área de
  aprendizagem (`invitation-acceptance.tsx`, ~`:340-355`). Papéis exclusivos — oposto da vNext (papéis
  não exclusivos).
- **Estados de sistema:** `not-found` (“Não encontramos essa página”), `error` (“Não foi possível
  carregar esta página.” + código de suporte copiável + referência técnica recolhida),
  `global-error` (“O Hub encontrou um problema.”) (`src/app/not-found.tsx:10-18`,
  `src/app/error.tsx:39-46`, `src/app/global-error.tsx:42-48`, `src/components/system-state-shell.tsx:72-123`).

**[INFERÊNCIA] Avaliação de UX das telas públicas:** (1) linguagem clara, sóbria e honesta sobre
estados assíncronos (“Não inicie outra tentativa”, “Acesso em confirmação”) — bom modelo; (2) copy
padrão no **feminino** (“Bem-vinda”, “Quero ser avisada”) mas placeholder masculino
(“aluno@exemplo.com”) — inconsistente; (3) ausência de home pública, OpenGraph, termos e política
completa — o legado dependia inteiramente da landing externa para descoberta e confiança;
(4) login sem caminho para cadastro faz sentido no modelo guest-first, mas não no modelo da vNext
(identidade antes do checkout).

---

## 7. Identidade institucional: NeuroCapacitar vs PROTEA-R

### 7.1 Histórico do nome

- **[FATO]** O produto nasceu como **“PROTEA-R Hub”**: quinto commit “feat: add initial roadmap and key
  changes for PROTEA-R Hub” (2026-06); serviço de health ainda responde `service: "protea-r-hub"`
  (`src/app/api/health/route.ts:8`, `src/app/api/health/ready/route.ts:64`); scripts usam
  `application_name: "protea-r-*"` (`scripts/migrate-production.ts:20` e outros); bootstrap cria
  “Admin PROTEA-R” (`scripts/bootstrap-admin.ts:22`).
- **[FATO]** Até agosto, o próprio DESIGN.md tratava “PROTEA-R Hub” como o produto: a comparação com
  a referência Vercel (2026-09-07) diz “`DESIGN.md` é um contrato visual do produto PROTEA-R Hub” e
  fala em “paleta escura PROTEA-R” (`docs/reviews/2026-09-07-design-document-comparison.md:12`, `:89`).
  A spec de e-mail de 2026-08-19 descreve a família visual “coerente com o PROTEA-R Hub e com a marca
  proprietária Neuro Capacitar”, logo com `alt="PROTEA-R"` e rodapé “Neuro Capacitar · PROTEA-R Hub”
  (`docs/superpowers/specs/2026-08-19-resend-neurocapacitar-brand-refresh-design.md:11-13`, `:37-39`, `:58`).
- **[FATO]** A virada ocorreu em 2026-09-07/09: commit `fc956d79` (“feat: refine NeuroCapacitar
  interface”) introduz `PLATFORM_NAME`; `advisor-plans/admin-surface-standardization-2026-09-09.md:63-64`:
  “`PROTEA-R` é identidade de Curso e não deve continuar nomeando o shell global”; execução em
  `:844-845`. O relatório de implementação da marca corrigiu testes que codificavam “o antigo logo
  PROTEA-R global” (`design-plans/neuro-brand-system-implementation-report.md:111`, `:134`).
- **[FATO]** Regra canônica final: “`NeuroCapacitar` é a marca da plataforma. `NeuroCapacitar Hub` é o
  nome da aplicação… `PROTEA-R` é um Curso e uma identidade de conteúdo dentro da plataforma… não deve
  nomear o shell global” (`DESIGN.md:63-83`). Identificadores técnicos com `PROTEA-R` só mudam junto
  com o contrato correspondente (`DESIGN.md:73-76`).

### 7.2 Fonte de verdade do nome (`platform-brand-name-source-of-truth-research-2026-09-25.md`)

- **[FATO]** Constantes em `src/lib/brand.ts:1-6`: `PLATFORM_BRAND = "NeuroCapacitar"`,
  `PLATFORM_NAME = "NeuroCapacitar Hub"`, `PLATFORM_LOGO_SRC = "/brand/logo-negativo.svg"`,
  `PLATFORM_LOGIN_IMAGE_SRC = "/brand/login-capa.webp"`, `DEFAULT_EMAIL_SENDER`.
- **[FATO]** Cinco identidades que **não devem ser colapsadas** (`:28-34`): (1) marca da plataforma;
  (2) nome da aplicação; (3) emissor legal/de certificado (razão social, CNPJ, “Marca exibida”);
  (4) identidade de envio de e-mail (`From`, `Reply-To`, `SUPPORT_EMAIL`); (5) assets/templates
  hospedados no Resend.
- **[FATO]** Decisão: manter o nome no código, controlado por release; não reutilizar a “Marca
  exibida” do perfil emissor; criar um setting “Nome público da plataforma” só se surgir necessidade
  de renomear sem deploy (`:13-15`, `:64-66`). Justificativa: marca única, sem white-label nem
  multi-tenant (`:46`). Um rebrand hipotético “NeuroCapacitar → Neuro” exigiria mudar constantes,
  e-mails, remetente, logo, política de privacidade e emissor (`:68`).
- **[FATO]** Ainda há literais fora da constante: “NeuroCapacitar · Credencial digital”
  (`src/app/certificados/[code]/page.tsx:86`), “Equipe NeuroCapacitar”
  (`src/features/admin/staff-invitations.ts:313`), “…informado pela NeuroCapacitar”
  (`src/app/politica-de-privacidade/page.tsx:51`).
- **[FATO]** Grafias encontradas: “NeuroCapacitar” (UI/código), “Neuro Capacitar” (spec de e-mail e
  remetente de teste `Neuro Capacitar <notificacoes@neurocapacitar.com.br>`,
  `src/features/email/server.test.ts:266`), “NEURO.CAPACITAR” (nome do arquivo do manual,
  `design-plans/neuro-brand-design-system-refactor.md:7`). **[INFERÊNCIA]** O wordmark do logo
  compõe “Neuro” e “Capacitar” em duas linhas com um ponto laranja — o que explica as três grafias. A
  vNext deve fixar uma grafia textual (recomendo “NeuroCapacitar”, que é a do legado canônico) e
  confirmar com a dona da marca.

### 7.3 Assets

| Asset | Fato | Evidência |
|---|---|---|
| `public/brand/logo-negativo.svg` | 12.667 bytes, `viewBox 0 0 1042 334`, **vetorial** (18 paths + 1 rect em `rgb(241,232,218)` = `#F1E8DA` areia, 1 path em `rgb(217,123,52)` = `#D97B34` laranja), exportado do Affinity, sem `<text>` | contagem de cores via grep no arquivo; agente de telas públicas |
| (interpretação) | **[INFERÊNCIA]** símbolo à esquerda + wordmark “Neuro” / “Capacitar” em duas linhas, ponto laranja após “Neuro”; versão **negativa** (para fundo escuro). Não há versão positiva (para fundo claro) no repositório | geometria dos paths |
| `public/brand/login-capa.webp` | **567.236 bytes**, 2160×1215 (16:9) — não segue o contrato 8:7 da ADR-0015 | `ls -la public/brand`; agente |
| `public/favicon/favicon.svg` | 5.227 bytes, quadrado arredondado com fundo `#F1E8DA` e 4 paths `#326C71`; sem variante `prefers-color-scheme` | grep de cores no arquivo |
| `public/favicon/favicon.ico`, `favicon-96x96.png` | 15.086 B e 4.308 B; apple-touch usa o PNG de 96 px | `src/app/layout.tsx:30-55` |
| `public/fonts/certificates/` | `Inter-Regular.ttf`, `Inter-Bold.ttf`, `OFL.txt` (SIL OFL 1.1), `fonts.conf` — só para PDF/preview de certificado | `src/app/globals.css:6-20` |
| Manual de identidade | `IDV NEURO.CAPACITAR.pdf` — **fora do repositório** | `design-plans/neuro-brand-design-system-refactor.md:7` |

- **[FATO]** Uma validação anterior registrou que um SVG de logo “contém uma imagem base64 e não paths
  vetoriais” e pediu o asset vetorial oficial (`design-plans/neuro-brand-report-validation.md:221-223`);
  o arquivo atual em `main` já é vetorial. A pendência de “asset vetorial oficial dedicado” para
  favicon/mark continua aberta (`design-plans/neuro-brand-design-system-refactor.md:464-466`).
- **[INFERÊNCIA]** Para a vNext com tema claro, falta um **logo positivo** (petróleo/grafite sobre
  areia). Usar o negativo (areia `#F1E8DA`) sobre fundo claro é ilegível. É dependência de design a
  pedir à dona da marca antes do M0 visual.

### 7.4 Domínios e e-mail

- **[FATO]** Production `https://app.neurocapacitar.com.br` (`README.md:95`); Staging
  `https://preview.neurocapacitar.com.br` (`src/lib/staging-environment.ts:8-14`); domínio Resend
  verificado `neurocapacitar.com.br` compartilhado entre ambientes (`docs/decisions.md:275`); DMARC em
  observação (`README.md:106-108`).
- **[FATO]** Assuntos de e-mail usam `PLATFORM_NAME` (ex.: “Acesso liberado no …”, “Seu certificado …
  foi emitido”) (`src/features/email/server.ts:189-691`). Os 10 templates Resend Hosted usam paleta
  própria em hex e Arial (seção 2.1).

---

## 8. Backlog: pedido/planejado e não implementado

Consolidado das leituras (o repositório tem **0 issues** no GitHub; o backlog existe só nos
documentos). **F** = fato documentado; **I** = inferência. Agrupado por natureza.

### 8.1 Rejeitado ou fora de escopo por decisão explícita (não é dívida; é escolha)

| Item | Fonte | Observação para a vNext |
|---|---|---|
| Avaliações/quiz/provas | `plans/README.md:423` (“Sem avaliações.”), `:404`; `SP/S 2026-08-19-seven-sprint-hardening-design.md:30-32` | **A vNext reintroduz quiz** — reverte decisão ratificada do legado; registrar o porquê |
| Coortes/turmas | `docs/decisions.md:83`, `:424-426`; `plans/010…:64-68` | reabrir só com calendário/turma real |
| Assinatura/recorrência, boleto, bundles, múltiplos gateways, SCORM, IA | `PRODUCT.md:116-121`; `docs/Plano de migracao.md:23`; `plans/README.md:444-473` | coerente com a vNext |
| Compra para terceiros / transferência | `docs/decisions.md:111` | — |
| Reembolso parcial | `docs/Plano de migracao.md:604` | — |
| Comunidade, feed, DM | `plans/README.md:433` | coerente (discussão por Aula) |
| Reengajamento, lista de inativas, CRM analítico | `docs/decisions.md:133`; `plans/012…:123-128` | — |
| Inbox de comentários (lido/atribuição/SLA) | `plans/013…:35-37`; `research/2026-09-19-admin-latest-comments.md:465-466` | — |
| Gamificação (streak, ranking, XP), metas, “aulas salvas”, novidades | `advisor-plans/2026-09-22-report-reconciliation.md:29`, `:71-81` | — |
| `course_offers` / entidade Oferta | `docs/adr/0009-…:31-34`; `research/2026-09-15-free-course-external-research.md:202-205` | **A vNext adota Offer** — registrar o gatilho |
| App nativo / offline | `PRODUCT.md:121`; `plans/009…:52` | **A vNext adiciona PWA offline** |
| Workflow LGPD de pedidos de titular/anonimização | `docs/decisions.md:124` (removido) | exige política jurídica antes |
| MFA administrativo | `docs/decisions.md:218-220` (implementado e removido em 2026-09-01) | vNext: passkeys opcionais |
| Desconectar Google da Conta | `docs/reviews/2026-09-30-account-settings-ux-review.md:144` | — |
| `prefers-reduced-motion`, tema claro | `DESIGN.md:49-50`; `docs/reviews/2026-09-07-design-document-comparison.md:24-26` | a vNext deve ter ambos |

### 8.2 Pedido/planejado, não implementado (dívida ou ideia aberta)

| Item | Fonte | Status |
|---|---|---|
| Repasse de juros do parcelamento ao comprador | `docs/reviews/2026-08-03-asaas-installment-interest-research.md:9-14`; `docs/decisions.md:429-431` | F: pausado até haver dados reais de venda |
| Seletor Gratuito/Pago com radios na autoria | `docs/reviews/2026-10-03-course-pricing-mode-ux-research.md:18-33` | F: proposto |
| Cobranças pendentes reais do Asaas, saldo/repasse, comparação com período anterior, KPI “em caixa” | `advisor-plans/finance-system-metrics-review-2026-09-26.md:144`; `financial-final-ui-audit-2026-09-09.md:362-366` | F: fora do patch |
| Métricas de funil pós-compra (checkout→pagamento, ativação 24 h/7 d, contas duplicadas) | `advisor-plans/google-oauth-checkout-ux-review-2026-09-27.md:136-151` | F: proposto |
| Telemetria de uso do Admin | `advisor-plans/admin-dashboard-review-2026-09-08.md:1038-1052`, `:1297-1302` | F: proposto |
| Central de Ajuda refinada (contato no topo, **contato sem login**, pré-preenchimento) | `design-plans/2026-09-24-help-center-self-service-contact-research.md:42-54`; `…help-flow-refinements-research.md` | F: recomendação |
| Busca/categorias na FAQ | `advisor-plans/2026-09-21-faq-student-reading-analysis.md:41-46` | F: futuro |
| Nome preferido (“Como prefere ser chamado(a)?”) separado do nome do certificado | `design-plans/2026-09-24-student-dashboard-greeting-research.md:49` | F: decisão separada |
| Fuso horário por pessoa | `docs/reviews/2026-08-06-timezone-policy-research.md:109-112` | F: inexistente |
| `lastAccessedAt` por curso / “continuar de onde parou” | `research/2026-09-21-student-next-step-ux-research.md:79-86`; `plans/009…:110-116` | F: inexistente |
| Hero de reentrada na página do Curso | `research/2026-09-21-course-overview-hero-ux-research.md:61-80` | F: pulado |
| Notas privadas/highlights | `plans/009…:46` | F: inexistente |
| Notificação de resposta/menção em comentários | `plans/009…:118-123` | F: nenhum tópico na outbox |
| Meta de estudo (experimento 15/30/45 min) | `advisor-plans/2026-09-21-student-study-goal-analysis.md:73-94` | F: não implementado |
| Relatório de coorte/drop-off por Aula | `advisor-plans/2026-09-21-learning-analytics-start-completion-analysis.md:110-125` | F: adiado |
| Cobertura real de vídeo por intervalos | `research/2026-09-12-video-watch-coverage-research.md:43-48` | F: pendente |
| Progresso de bytes no upload (XHR) e fases explícitas | `design-plans/2026-09-24-image-upload-research-sources.md:18` | F: recomendação |
| Página de sucesso do checkout com estados waiting/checking/timeout sem polling sobreposto | `design-plans/checkout-success-course-summary.md:54`, `:76-79` | F: plano |
| Restaurar versão anterior do template de certificado | `docs/reviews/2026-09-25-certificate-template-and-course-versioning-research.md:13-21` | F: UI só lista |
| Open Badges 3.0 / VC / PDF-A / PAdES | `research/2026-08-07-certificate-production-best-practices.md:672-690` | F: P2 |
| Visibilidade do link público por certificado; rota autenticada para PNG | `research/2026-09-21-certificate-student-ux-research.md:211-225`; `…archive-warmth-refinement.md:24-26` | F: limite registrado |
| Gate de prontidão no preview do certificado | `design-plans/certificate-preview-market-research.md:61` | F: condicional |
| Copy editorial por slide da mídia de login | `advisor-plans/2026-09-21-image-system-analysis.md:68-84` | F: lacuna |
| Logo/mark vetorial oficial dedicado; CTA laranja; Badge default; contraste renderizado; inspeção humana | `design-plans/neuro-brand-design-system-refactor.md:446-477` | F: pendente |
| Sparklines / AdminMetricCard highlight | `advisor-plans/2026-09-21-finance-stage-analysis.md:33-38`; `…admin-metric-highlight-analysis.md:63-74` | F: adiado |
| Webhooks JMVStream (em vez de polling) | `advisor-plans/admin-dashboard-implementation-plan-2026-09-08.md:260-262` | F: fora |
| Retry/replay local Resend; rollout Staging/Production do alinhamento provider×Hub | `advisor-plans/provider-vs-hub-operational-alignment-plan-2026-09-13.md:54-59` | F: não executado |
| Sentry: dashboard, uptime, alertas de métrica | `advisor-plans/sentry-production-only-observability-2026-09-11.md:41-50` | F: pendente |
| Rate limit distribuído/na borda (Cloudflare WAF) | `docs/reviews/2026-10-03-*` | F: proposto |
| DMARC além de observação | `README.md:106-108` | F: adiado |
| Smoke OAuth Google real (etapa 6) e rollout de identidade (migration 0098, template Hosted) | `advisor-plans/google-login-implementation-plan-2026-09-27.md:31-69`; `docs/decisions.md:359-360`, `:409-412` | F: pendente |
| Exceção de vínculo Google para Gmail/Workspace | `docs/decisions.md:368-372` | F: adiada (sem hook no Better Auth) |
| Copy jurídica do drip antes da primeira venda com drip | `docs/operations/content-release-rollout.md:53` | F: pendente |
| Política jurídica/LGPD dos certificados (GOV-001) e da retenção | `plans/2026-08-07-certificate-production-readiness-audit.md:181-200`; `docs/adr/0006-…:134-138` | F: pendente |
| Compra pública com e-mail de Admin/Suporte; SLO/incidentes | `docs/decisions.md:416-420` | F: aguardando ratificação |
| Ciclo de vida de grants (expiração, aprovação) | `docs/decisions.md:336-337` | F: exige decisão |
| E-mail de boas-vindas para curso gratuito | `advisor-plans/free-course-enrollment-2026-09-15.md:1365-1367` | F: futuro |

**[INFERÊNCIA]** O backlog real é curto e operacional (funil, ajuda, último acesso, nome preferido,
métricas financeiras corretas). A maior parte do “backlog” do legado são ideias explicitamente
rejeitadas — e algumas delas (quiz, Offer, offline) são exatamente as que a vNext adiciona. Isso não
é um erro, mas exige que cada reversão tenha racional registrado em `09-registro-de-decisoes.md` da
vNext.

---

## 9. Divergências legado × vNext que merecem atenção

Comparação entre o legado (fato) e os contratos vigentes da vNext (`AGENTS.md`,
`docs/planning/*` da vNext). Não é recomendação de mudar a vNext: é a lista de pontos onde a vNext
decidiu diferente e deve fazê-lo **conscientemente**.

| Tema | Legado (fato) | vNext (contrato) | Observação |
|---|---|---|---|
| Tema visual | **dark-only**, `color-scheme: dark` (`DESIGN.md:49`, `:339-341`) | light/dark/system, default system (vNext `02-arquitetura-consolidada.md:58`) | Tokens do legado só existem para fundo petróleo escuro; o tema claro em areia não tem precedente testado. Ver contraste calculado (2.4). |
| Cor dominante | Petróleo como ambiente estrutural; botão principal petróleo; laranja só ênfase (`design-plans/neuro-brand-design-system-refactor.md:16-25`) | “areia/bege, terracota, laranja, oliva e **uso dosado de petróleo**” (vNext `02-…:58`) | O legado tentou aquecer superfícies com terracota e **reverteu** por ficar “terroso” (`design-plans/neuro-brand-impeccable-review.md:15-17`). Risco real de repetir. |
| Tipografia | Geist na UI; Lexend Deca só citada como fonte da marca (`design-plans/neuro-brand-design-system-refactor.md:32-33`; spec Resend `:34`) | Lexend Deca principal + Geist Mono técnico (B10) | A vNext alinha a UI ao manual; o legado nunca testou Lexend em tabelas densas/números. |
| Ícones | Hugeicons (`DESIGN.md:700`) | Phosphor (B10) | — |
| Primitives | Radix (`radix-luma`) | shadcn Luma / **Base UI** | O legado rejeitou ReUI justamente por exigir Base UI (`DESIGN.md:227-233`). |
| Reduced motion | **Proibido** adicionar `prefers-reduced-motion` (`DESIGN.md:50`, `:661`) | WCAG 2.2 AA, motion baixo | Não herdar a proibição. |
| Unidade vendável | Curso = produto; entidade Oferta rejeitada como prematura (`docs/adr/0009-…:31-34`) | Course 1:N Offer | Decisão nova consciente da vNext. |
| Checkout | **guest-first**: visitante paga sem Conta; Conta criada/vinculada pelo e-mail do pagador após o pagamento (`docs/decisions.md:97-117`, `:409-411`) | Asaas Hosted Checkout **apenas com identidade autenticada/verificada** | Mudança grande de funil: a landing externa → `/comprar/[slug]` precisará de login/cadastro antes do pagamento. O legado tinha pesquisa UX específica sobre OAuth no checkout (seção 3). |
| Versionamento curricular | `CoursePublication` com clones e `curriculum_key` (ADR-0007/0014/0018) | `CourseRelease` referenciando revisões imutáveis; proibido reintroduzir clones/`curriculum_key` | Ver seção 5. |
| Conclusão por vídeo | 100% de reprodução linear validada, anti-seek (ADR-0012) | threshold 90%, sem anti-seek, autoavanço só em `ended` confiável | — |
| Retenção de certificado revogado | Emenda 2026-09-25: PDF + dados por **60 dias**, depois purge + tombstone (SHA-256 do código + `revoked_at`); substituiu a política anterior de 90 dias (`docs/adr/0006-certificate-lifecycle.md:114-138`) | **90 dias** pendente de validação jurídica (vNext `03-modelo-de-dominio-e-dados.md:84`, `04-…:80`) | A vNext usa o prazo **anterior** do legado. Vale confirmar com produto qual prazo é o vigente desejado. |
| Renderização de certificado | PDFKit + PNG Sharp/librsvg + editor de posicionamento livre (ADR-0006) | HTML/CSS controlado + Browser Run | Simplificação consciente. |
| Quiz | **Rejeitado** pelo produto: “Sem avaliações.”; “Não deve haver prova, o certificado é comprovante de conclusão de visualização de aulas.” (`plans/README.md:404`, `:423`) | Single/multiple choice com tentativas e aprovação | Reverte decisão humana explícita do legado; confirmar com a dona do produto e registrar. |
| Papéis | Exclusivos: aceitar convite de equipe remove a área de aprendizagem (`invitation-acceptance.tsx`; `docs/decisions.md:388-392`) | Papéis não exclusivos + grants | — |
| Certificado público | Página pública mostra nome, Curso, PNG e “Baixar PDF” sem login (`src/app/certificados/[code]/certificate-public-actions.tsx:47-59`) | Validação mínima, sem PDF irrestrito | Decisão oposta, ambas documentadas. |
| Linguagem | Feminino padrão (“Bem-vinda de volta”, “Quero ser avisada”, `/admin/alunas`) sem decisão registrada | Não definido | Decidir e registrar. |
| PWA/offline | Inexistente | Offline seletivo Student | Nova. |
| MFA administrativo | Implementado e **removido** por decisão de produto em 2026-09-01 (`docs/decisions.md:218-220`) | Passkeys opcionais | — |
| Signup | Fechado por padrão por flag; cadastro por e-mail exige prova antes de criar Conta (`docs/decisions.md:378-386`) | Google + senha, linking só por e-mail verificado | Política semelhante no linking. |

---

## 10. Lições para a vNext

Todas são **[INFERÊNCIA]** fundamentada nas evidências acima. Não alteram decisões B1–B16; onde há
conflito com a vNext, a lição é “decidir conscientemente e registrar”, não “mudar”.

### 10.1 Produto e público

1. **Confirmar o público com a dona do produto antes de fixar vocabulário e tom.** A única evidência
   é o seed: “Curso para psicologas e neuropsicologas” e conteúdo clínico (DSM-5, anamnese, perfil
   sensorial, devolutiva aos responsáveis). O legado usa feminino por padrão (“Bem-vinda de volta”,
   “Quero ser avisada”, `/admin/alunas`) sem decisão registrada. Decidir: linguagem neutra, feminina
   ou flexionada por preferência; registrar no `CONTEXT.md` da vNext.
2. **Não existe pesquisa com usuários reais no legado.** ~180 documentos de pesquisa são de mercado e
   normas; vários admitem “sem teste com alunos”. Na vNext, planejar ao menos sessões curtas com 3–5
   alunas e com a operadora antes de M-UI, e instrumentar o funil (checkout → pagamento → primeiro
   acesso em 24 h/7 dias), que o legado propôs e nunca implementou.
3. **Volume pequeno é real e deve guiar o escopo.** Um Curso nomeado, catálogo pequeno, 8 Pedidos em
   Development, operadora que “no 1º mês” não precisou recuperar incidentes e que não sabe para que
   serve o relatório de Aprendizagem. Cortar telas analíticas avançadas até haver demanda; priorizar
   o que a operadora disse usar: **último acesso, expirando em breve, últimas compras, últimos
   certificados, valores financeiros para Suporte**.
4. **O modelo de negócio é venda avulsa com acesso por meses**, Pix/cartão, parcelamento até 12x
   (padrão 3x) com taxas absorvidas, preço único, mínimo R$ 10, gratuito como “lead magnet” e “Em
   breve” com interesse. MRR/churn não se aplicam. A introdução de **Offer** na vNext é uma mudança
   consciente; o legado considerou prematura “para uma oferta por Curso” e indicou os gatilhos que a
   justificariam (múltiplos preços, campanhas, cupons, trilhas). Registrar qual gatilho motivou B-x.
5. **Checkout autenticado × guest-first precisa de registro explícito de trade-off.** O legado pesquisou
   (Teachable, Hotmart, Thinkific, Shopify, Stripe) e decidiu guest-first para conversão; a vNext exige
   identidade verificada antes do Asaas. Consequências a planejar: a landing externa → `/comprar/[slug]`
   passa a ter um passo de login/cadastro; o cadastro precisa ser rápido (Google + e-mail), com
   `returnTo` seguro e preservação do contexto de compra; medir abandono nesse passo desde o dia 1.

### 10.2 Marca e design

6. **Pedir à dona da marca o manual (`IDV NEURO.CAPACITAR.pdf`) e versioná-lo** (ou extrato com
   anchors) no repositório da vNext; pedir também **logo positivo** e mark para favicon claro/escuro.
   Hoje só existe o logo negativo (areia + laranja) — ilegível em tema claro.
7. **Os hex do manual são a fonte:** petróleo `#326C71`, areia `#F1E8DA`, laranja `#D97B34`, oliva
   `#9EAD7C`, terracota `#C56A4C`. Manter a arquitetura em 3 camadas do legado (anchor → funcional →
   componente; componentes nunca consomem anchors) — foi a decisão mais sólida da marca.
8. **Contraste em tema claro é o risco nº 1.** Sobre areia, laranja (2,53:1), oliva (1,98:1) e terracota
   (3,12:1) falham AA para texto normal; branco sobre laranja (3,07:1) e sobre terracota (3,79:1)
   também. Derivar tokens funcionais escurecidos em OKLCH para texto/link/ação, usar texto escuro sobre
   botões laranja/oliva, e validar pares renderizados com teste automatizado (o legado deixou isso
   pendente por meses).
9. **Evitar o erro “terroso”.** O legado tentou aquecer superfícies com terracota e reverteu. Com
   areia/bege como base, reservar terracota para expressão editorial pontual e manter laranja para
   ação/atenção, oliva para conclusão pedagógica (≠ `success` técnico), e **nunca** usar marca como
   semântica financeira/operacional.
10. **Student mais caloroso que Staff por composição, não por segundo tema.** Mesmos tokens; Staff com
    densidade local (`size="sm"`), Student com hero, progresso e mídia. Aula com cor mínima.
11. **Reaproveitar valores que funcionaram:** radius por papel (6/8/10/12/16 px a partir de 8 px),
    escala tipográfica por papel (page-title clamp 28–32 px, body 16 px/1.6, label 13 px, meta 12 px),
    `TableHead` 40 px, células `py-2 px-3`, `tabular-nums`, ritmo `gap-16/12/6`, `PageContainer` 1344 px,
    imagens 16:9 1280×720 WebP, motion 150–220 ms em controles e 300–350 ms em imagens, hover de imagem
    1.02–1.03. Revalidar com Lexend Deca (métricas diferentes de Geist).
12. **Não herdar os anti-padrões de acessibilidade:** proibição de `prefers-reduced-motion`, carrosséis
    com autoplay sem pausa operável por teclado (WCAG 2.2.2, nível A), toast como único portador de
    erro. Na vNext: respeitar reduced motion, evitar carrossel no login (ou dar pausa visível), erros
    inline associados.
13. **Regras de copy do legado são boas e baratas:** sentence case, sem eyebrows/caixa alta, `…` em
    processamento, sem travessão longo, termos do glossário, nunca prometer o que o estado não
    comprova (“Pagamento aprovado” só depois do acesso server-side).

### 10.3 UX que vale portar (independente de stack)

14. **Página pós-checkout como status, não como resumo** (“Acesso em confirmação / Estamos liberando
    seu acesso”), com estados espera/timeout/verificar novamente e sem polling sobreposto.
15. **Sidebar da Aula com estados independentes** (obrigatória/opcional, concluída, atual, bloqueada
    com causa) e **denominador explícito** (“4 de 9 obrigatórias”).
16. **Ajuda única** (“Ajuda” na navegação, contato no primeiro bloco e repetido, **contato sem login**,
    pré-preencher Curso/Aula de origem) em vez de “Suporte” + “FAQ” separados.
17. **Estados de sistema com linguagem comum** (o que aconteceu, se precisa agir, ação segura, código
    de suporte copiável; 404 neutro; manutenção 503 + `Retry-After` sem countdown).
18. **Certificado em três superfícies** (contextual no Curso, arquivo do Aluno, verificação pública),
    conquista factual sem gamificação, sem insinuar certificação profissional. A vNext já restringe o
    PDF público — manter a página pública com status, data e dados mínimos.
19. **Saudação simples** (“Bom dia, [primeiro nome].” no servidor com `America/Sao_Paulo`) e campo de
    nome preferido separado do nome do certificado — o legado misturava os dois em `users.name`.
20. **KPIs com semântica honesta:** toda métrica declara população, período e denominador; checkout
    ativo ≠ recebível; `started`/`completed` não formam coorte; nunca mascarar dado não autorizado com
    `0`; KPIs nunca calculados sobre a página visível.

### 10.4 Complexidade acidental a não repetir

21. **Clones de publicação** (ADR-0007 → 0014 → 0018) — a vNext já resolve com `CourseRelease` +
    revisões imutáveis e IDs estáveis; discussões ancoradas no ID pedagógico estável.
22. **Anti-seek e fronteira linear 100%** (ADR-0012) — a vNext já usa threshold 90% e autoavanço só em
    `ended` confiável. A pesquisa de cobertura de vídeo do legado sustenta essa simplificação.
23. **Editor de certificado de posicionamento livre** (13 campos × 8 controles, snap/zoom/undo, dois
    renderers) — preferir poucos layouts HTML/CSS com slots e preview do **mesmo HTML** do PDF.
24. **Carrossel administrável no login** (ADR-0015) — baixo valor, custo de upload/validação e
    problemas de acessibilidade; uma imagem estática versionada basta.
25. **Processo documental:** relatórios que validam relatórios, 47 planos superpowers, ~40 reviews,
    6 iterações sobre o mesmo editor. Na vNext: um documento por decisão, `STATUS.md` com evidência,
    sem cadeias de validação de validação.
26. **Lotes grandes:** o ciclo de identidade gerou um candidato de 180 arquivos com 4 achados P1 e não
    promovível. Fatiar identidade (login Google, cadastro, convites, troca de e-mail, avatar) em
    entregas pequenas e verificáveis.
27. **Permissões:** a matriz fixa de Suporte foi trocada em três semanas por grants individuais.
    Começar pelos grants normalizados (como a vNext prevê) e por uma lista curta, ampliando por
    demanda real.

### 10.5 Pendências que a vNext herda como perguntas abertas

28. Retenção do certificado revogado: legado **emendou para 60 dias + tombstone** (2026-09-25); vNext
    registra **90 dias**. Confirmar com produto/jurídico qual prazo vale.
29. Política de privacidade e Termos completos (controlador, Encarregado, bases legais, terceiros) —
    o legado só tinha aviso de analytics.
30. Tratamento de compra cujo e-mail pertence a Admin/Suporte (pendente no legado,
    `docs/decisions.md:418`) — na vNext, com papéis não exclusivos, a pergunta muda de forma mas não
    desaparece.
31. Critérios de incidente/SLO (pendente no legado, `docs/decisions.md:419`).
32. Racional dos 260 palavras/minuto para duração de leitura (não localizado no legado).
