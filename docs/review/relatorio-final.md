# Relatório final — reabertura das decisões do NeuroCapacitar Hub vNext

**Data:** 2026-10-10 · **Método:** rodadas de questionamento por fronteira de dependências (grilling), com pesquisa em fontes oficiais, inspeção do legado e debate com o responsável do produto · **Registro de decisões:** [registro-do-debate.md](registro-do-debate.md) (61 decisões, Q1–Q61) · **Evidências:** [evidencias/](evidencias/)

> Este relatório descreve decisões e planos. **Nenhum código da vNext existe**, nenhum serviço foi provisionado, nenhum teste foi executado, e o repositório legado não foi alterado. O que depende de spike, de teste ou de terceiros está marcado `PENDENTE`.

## 1. Resumo executivo

- **Reescrever do zero (Q2), sem ponte OpenNext.** O legado é especificação de casos, não código. O domínio muda de qualquer forma, e portar o Next para Workers trocaria só o lugar onde o código roda (W5).
- **Big-bang mantido (Q3).** Nenhuma Production da vNext antes da v1 integral. Migração única (ETL) só ao final (Q4, Q56); o legado fica congelado, só com correções de segurança, legais e de bloqueio de venda (Q5).
- **Escala real é pequena:** ~20 alunos, 1 curso em Production, 1 venda real, 2 cursos novos planejados, equipe de 1 dev + IA, 1 Admin e 3 Suportes. Sem prazo definido; 4 h/dia (Q10).
- **Teto de infraestrutura US$ 10/mês (Q8, Q20):** só o Workers Paid (US$ 5) é custo certo; todo o resto fica em free tier, e upgrade pago exige nova decisão. Vídeo e Asaas são custos do cliente.
- **Simplificações aprovadas:** currículo vivo com rascunho e publicação atômica (Q32); âncora de drip única por pessoa e curso (Q33); 2 filas em vez de 5 (Q44); login por magic link para todos (Q52); mesma experiência visual para Student e Staff (Q48); pacote de documentação encolhido (Q59).
- **Escopo mantido pelo responsável, mesmo contra recomendação:** seis adapters de vídeo (Q36), PWA offline (Q14), editor visual de certificado (Q15), marketing/banners/mídia de login (Q16), YouTube em curso pago (Q41.1), ausência de `prefers-reduced-motion` (Q48), Staff sem segunda etapa (Q52).
- **Plano:** 11 marcos (M0–M10) com spikes no M0 para resolver incertezas técnicas antes de construir sobre elas (Q57, Q58).

## 2. Evidências e limites da pesquisa

Nove frentes de investigação (data de leitura 2026-10-09), arquivadas em [evidencias/](evidencias/): L1 arquitetura e operação do legado; L2 domínio de aprendizagem; L3 identidade, financeiro e comunicação; L4 produto, marca e pesquisas; W1 Cloudflare e Neon; W2 stack e ferramentas; W3 mercado, UX e jurídico; W4 pagamentos e vídeo; W5 reescrever vs portar.

**Limites declarados:** a cota de busca web da sessão esgotou durante a pesquisa. O W1, W2, W3, W4 e W5 listam itens "não confirmados" (por exemplo: limite do Access Free, localização dos consumers de Queue, aplicação de `Content-Length` em presigned PUT do R2, suporte do plugin de passkey, preço do Socket, CDC art. 49 e a data de 01/11/2026 do Emissor Nacional de NFS-e, cujas fontes eram secundárias). O planalto.gov.br recusou conexão e o Reclame Aqui devolveu 403. Latências citadas são estimativas, não medições. Nada disso foi testado em ambiente real.

## 3. Fatos do legado que moldaram as decisões

| Fato | Fonte |
|---|---|
| ~133,6 mil linhas de código, ~100,8 mil de teste e ~6 MB de Markdown em 4 meses, por um único autor humano; ~60% dos PRs trataram de CI, release, backup e infra | L1 |
| Pipeline de deploy na Vercel: 18 sucessos e 57 falhas; houve bypass de backup e CI em 25–26/08 com venda real | L1 |
| Produção pequena: 1 curso (`protea-r`), 1 venda real (26/08/2026), backup cifrado de ~205 KB | L1, L4 |
| Não há documento explicando a saída da Vercel; indícios: custo de invocações (crons de 1 min → 30 min), release acoplado à Vercel, R2 já na Cloudflare | L1 |
| Currículo por clones de publicação → perda de progresso, `curriculum_key` e três ADRs de remendo | L2 |
| Anti-seek não protege nada (botão "Concluir aula" sempre disponível); só a JMVStream funciona como provedor | L2 |
| Sem quiz (decisão explícita do legado), sem PWA, sem matrícula manual pela interface | L2, L4 |
| Compra sem login (guest-first) gerou a parte mais complexa do financeiro; `externalReference` vem nulo no Checkout do Asaas | L3, W4 |
| Sem exclusão de conta, exportação de dados, termos de uso nem consentimento de marketing | L3, L4 |
| Repositório legado **público**, expondo identificadores de infraestrutura e caminhos pessoais | L1 |
| Boa herança conceitual: outbox/inbox com fencing, guards de migration, matriz de precedência financeira, trilha financeira append-only | L1, L3 |

## 4. Decisões

Legenda: **DECIDIDO** · **DEFER** (adiado deliberadamente) · **REJEITADO** · **CONDICIONAL** (depende de terceiro ou teste) · **EM DEBATE** (nenhum item ficou assim ao final). Detalhes e observações por decisão: [registro-do-debate.md](registro-do-debate.md); decisões duráveis em [../adr/](../adr/).

### 4.1 Fundamentos e processo

| Tema | Decisão | Status | Ref. |
|---|---|---|---|
| Objetivo | Sair da Vercel e reconstruir o domínio mais simples e correto, com critérios mensuráveis | DECIDIDO | Q1 |
| Estratégia | Reescrever; legado como especificação; sem OpenNext | DECIDIDO | Q2 |
| Lançamento | Big-bang; nada de Production antes da v1 integral | DECIDIDO | Q3 |
| Migração | ETL único ao final; legado congelado; legado desligado após o cutover | DECIDIDO (momento); conteúdo do ETL fechado em Q56 | Q4, Q5, Q56 |
| Processo | Enxuto e explícito; pacote de documentação encolhido | DECIDIDO | Q6, Q59 |
| Equipe | 1 dev + IA; responsável revisa e é dono de Production | DECIDIDO | Q7 |
| Custo | Teto US$ 10/mês de infraestrutura; free-tier-first | DECIDIDO | Q8, Q20 |
| Público | Adultos 18+, profissionais de saúde e educação; linguagem neutra; aviso contra dados de pacientes | DECIDIDO | Q9 |
| Regra de corte da v1 | Entra o que for obrigação legal/segurança, paridade com o legado, risco de dinheiro/acesso/privacidade, ou valor pedagógico claro a baixo custo; exceções deliberadas: PWA offline, editor visual, marketing | DECIDIDO | Q11, Q14–Q16 |
| Spikes e roadmap | Spikes no M0; ordem de risco; sem prazos inventados | DECIDIDO | Q57, Q58 |

### 4.2 Produto e domínio

| Tema | Decisão | Status | Ref. |
|---|---|---|---|
| Quiz | Entra, simples; obrigatório conta para conclusão e certificado; tentativas ilimitadas por padrão | DECIDIDO | Q12, Q24, Q61.4 |
| Discussões | Mínimas: um nível de resposta, moderação com grant, aviso, denúncia; notificação de resposta adiada | DECIDIDO / DEFER (notificação) | Q13 |
| Adições à v1 | Só a matrícula manual pela Staff | DECIDIDO | Q17 |
| Notas do aluno, legendas obrigatórias, troca de e-mail e exclusão self-service, desistência self-service | Fora da v1; desistência/exclusão/dados/troca de e-mail por pedido via e-mail ao suporte, com procedimento manual | DEFER | Q17, Q21 |
| Currículo | Vivo, com rascunho e publicação atômica, IDs estáveis; sem `CourseRelease` imutável | DECIDIDO (supersede B2) | Q22, Q32 |
| Catálogo | Course 1:N Offer; Offer com prazo em meses; CourseInterest com ciclos | DECIDIDO | Q23, Q61.2 |
| Acesso | Prazo por Offer, sem vitalício; âncora de drip única por pessoa e curso, nunca reiniciada; recompra continua o progresso; sem `EnrollmentEpisode` | DECIDIDO | Q31, Q33 |
| Conclusão | Vídeo 90% (seek permitido); texto com botão; sem exceção manual da Staff (reabrir se surgirem chamados) | DECIDIDO | Q24 |
| Jornadas | Student: descobrir → cadastrar → inscrever/comprar → assistir → concluir → certificado → suporte → conta e dados. Staff: criar/editar → publicar → ofertas → matricular → acompanhar → moderar → financeiro → certificados → convidar Staff | DECIDIDO (provisório) | Q19 |

### 4.3 Identidade e permissões

| Tema | Decisão | Status | Ref. |
|---|---|---|---|
| Login | **Magic link para todos, inclusive a Staff (só por link)**; aluno pode usar Google e senha opcionais; passkeys adiadas; sem TOTP | DECIDIDO | Q26, Q40, Q52, Q61.1 |
| Anti-abuso | Confirmação antes da sessão, uso único, expiração curta, limite por e-mail+IP, Turnstile; reautenticação recente por novo link nas ações sensíveis | DECIDIDO (requisito derivado) | Q52 |
| Papéis | student, support, admin, não exclusivos + grants granulares; ≥1 Admin ativo; sem impersonation; prévia de aluno | DECIDIDO | Q25, Q34, Q42 |
| Só Admin | Criar curso, oferta/preço/disponibilidade, template e emitente, revogar certificado, convidar Staff e gerir grants, credenciais, manutenção | DECIDIDO | Q34, Q42 |
| Delegáveis | Editar curso (inclui publicar), matricular/suspender, editar matrícula, reembolso, revisão financeira, ver finanças, reemitir certificado, moderar, FAQ/Ajuda, auditoria, fila operacional | DECIDIDO | Q34, Q42 |

### 4.4 Comércio, fiscal e jurídico

| Tema | Decisão | Status | Ref. |
|---|---|---|---|
| Compra | Login obrigatório; Asaas Hosted Checkout; Pix e cartão até 12x sem juros; sem boleto | DECIDIDO | Q27, Q28 |
| Reembolso | Integral; 7 dias garantidos; depois exceção do Admin; revoga acesso; certificado permanece | DECIDIDO | Q30 |
| Venda do legado | Histórico somente leitura; reembolso manual no painel Asaas + revogação manual | DECIDIDO | Q56, Q61.5 |
| NFS-e | Fora da v1; Hub guarda e mostra à Staff os dados necessários | DECIDIDO / CONDICIONAL (resposta do contador; pode voltar à v1) | Q29 |
| Termos e privacidade | Pré-requisito de Go-Live, redigidos com advogado do cliente; aceite versionado no cadastro | DECIDIDO | Q38 |
| Boleto, cupons, bundles, guest checkout, assinatura | Fora | REJEITADO / DEFER | Q27, Q28 |

### 4.5 Plataforma e engenharia

| Tema | Decisão | Status | Ref. |
|---|---|---|---|
| Frontend | SPA React + Vite + Hono num Worker, sem SSR; HTMLRewriter só em curso e validação; páginas públicas mínimas | DECIDIDO | Q46 |
| Banco | Neon Free ×3 projetos via Hyperdrive (`pg`, cache desligado), Drizzle 0.45 fixado, SQL revisado, sem advisory locks | DECIDIDO (gatilhos de upgrade definidos) | Q43, Q45 |
| Assíncrono | Postgres outbox/inbox + 2 filas (`hub-finance`, `hub-general`) + DLQs; cron de 30 min | DECIDIDO (supersede 5 filas de B12) | Q44 |
| Vídeo | Seis adapters por capabilities; YouTube permitido em curso pago (risco aceito); ativação só após teste de contrato com conta real (contas do cliente) | DECIDIDO / CONDICIONAL (contas) | Q36, Q41 |
| Mídia | R2 canônico, público só capas/banners, master editado, presigned PUT + validação de bytes, Images Free com fallback | DECIDIDO (mantido) | Q60 |
| Certificados | Snapshot imutável, PDF via Browser Run, R2 privado, editor visual, página pública mínima; retenção do PDF revogado 90 dias | DECIDIDO / CONDICIONAL (parecer jurídico) | Q15, Q37 |
| E-mail | Resend Free, templates hospedados, outbox, marketing com consentimento; gatilho de upgrade 60% da cota em 7 dias | DECIDIDO | Q16, Q39 |
| PWA | Offline Student mantido, com gate de iPhone real | DECIDIDO (exceção à regra de corte) | Q14 |
| Marca/UI | Tokens OKLCH em 3 camadas; mesma experiência para Student e Staff; sem `prefers-reduced-motion`; nada em movimento automático >5 s sem pausa | DECIDIDO | Q47, Q48 |
| Repositório e CI | GitHub Free privado em conta pessoal (migrar para organização se possível); CI em duas camadas; sem Socket, Scorecard, Graphify, CodeRabbit, CodeQL | DECIDIDO / CONDICIONAL (organização) | Q49, Q50 |
| Toolchain | Bun (fixado) e TypeScript estável mais recente; RHF+Zod, Tiptap JSON, vite-plugin-pwa `injectManifest`, Phosphor, TanStack Table 9, Recharts só Staff | DECIDIDO | Q51 e delegadas |
| Observabilidade | evlog + Workers Logs/Traces + Sentry Free + Web Analytics + Operations Center; alertas P0–P3; sem plantão 24/7 | DECIDIDO | Q54 |
| Backup | pg_dump diário e antes de release, `age` + R2; cópia semanal off-Cloudflare; ensaio semestral; RPO ≤24 h, RTO ≤8 h (metas) | DECIDIDO / CONDICIONAL (destino off-cloud do cliente) | Q53 |
| Domínio | `app.neurocapacitar.com.br`; zona DNS para a Cloudflare cedo; cutover com janela curta e ETL | DECIDIDO | Q55, Q56 |

### 4.6 Alternativas avaliadas e não adotadas

| Alternativa | Status | Motivo |
|---|---|---|
| Portar Next com OpenNext | REJEITADO | Quebrou em atualizações do Next, bug aberto de redirect, troca obrigatória de `sharp`/PDFKit/`pg`; não muda o domínio (W5) |
| vinext 1.0 | DEFER | Imaturo (auditoria com 24 vulnerabilidades, ~280 issues); reavaliar em 6–12 meses |
| TanStack Start | DEFER | Ainda em Release Candidate; reabrir só se SSR de corpo de página virar requisito |
| D1 como banco principal | REJEITADO | Sem transações interativas nem região na América do Sul (W1) |
| Workflows da Cloudflare | DEFER | Não substitui outbox; sem necessidade |
| Neon pago (Launch) | DEFER | Só com os gatilhos de upgrade: >600 MB, >70 CU-h/mês, primeiro incidente de perda de dados |
| GitHub Team (US$ 4/mês) | DEFER | Cabe no teto; não adotado agora (Q49) |
| Passkeys, TOTP | DEFER / REJEITADO | Bugs abertos do plugin; magic link escolhido (Q52) |
| Cloudflare Email Sending | DEFER | Beta, sem templates (W2) |
| Vídeo: Bunny, VdoCipher | DEFER | Fora dos seis adapters aprovados |

## 5. Decisões antigas substituídas (`superseded`)

| Decisão do pacote B1–B16 | Substituída por |
|---|---|
| B2: `CourseRelease` + `ModuleRevision`/`LessonRevision` imutáveis; `EnrollmentEpisode` | Currículo vivo com publicação atômica (Q32); âncora de drip única (Q33) |
| B3: passkeys opcionais; Google + senha como base | Magic link como base (Q52); Google e senha opcionais; passkeys adiadas |
| B12: cinco Queues + cinco DLQs | Duas filas + DLQs (Q44) |
| B11/B16: Bun pinado como única opção avaliada; "TS 7" fixo | Bun mantido (Q51) com mitigações; TypeScript estável mais recente |
| B15C: `pg_dump` a cada 6 h; ensaio trimestral; Neon Free "6 h de PITR" como camada | Backup diário e antes de release; ensaio semestral; RPO ≤24 h (Q43, Q53) |
| B10: shells Student/Staff visualmente distintos | Mesma experiência visual; só a navegação da Staff difere (Q48) |
| B4 e B16: GitHub "privado de conta pessoal" sem alternativa | Base mantida; migração para organização condicional (Q49) |
| "Nenhuma migração obrigatória; coexistência temporária" (B15D) | ETL único ao final; sem coexistência operacional (Q4, Q56) |

O pacote antigo está arquivado em [../_historico/pacote-B1-B16-2026-10-09/](../_historico/pacote-B1-B16-2026-10-09/). Nada nele foi alterado.

## 6. Riscos aceitos e residuais

**Aceitos explicitamente pelo responsável:**
1. **YouTube em curso pago** (Q41.1): a política da API lida no W4 diz que conteúdo embutido não pode ser cobrado. Risco: violação de termos, vídeo indisponível, proteção inferior. Recomendado dar ciência ao cliente.
2. **Staff por magic link, sem segunda etapa** (Q52): invasão de uma caixa de e-mail equivale a invasão do Hub com os poderes daquela pessoa.
3. **Escopo grande em big-bang** (Q36, Q14–Q16): seis adapters de vídeo, PWA offline, editor visual de certificado e marketing, com legado congelado por tempo indeterminado e custos da Vercel correndo.
4. **Sem `prefers-reduced-motion`** (Q48): mantida a restrição de 5 s sem pausa (WCAG 2.2.2, nível A).
5. **Neon Free em Production** (Q43): sem SLA, restauração curta, cold start; RPO real de até 24 h.

**Residuais a monitorar:**
- Resend Free (100/dia, 3.000/mês) compartilhado por magic links, transacionais e marketing; falta confirmar a cota dos broadcasts. Mitigação: Turnstile e limites no pedido de link; outbox que adia o excedente; gatilho de upgrade.
- Bun 1.4 (reescrito em Rust em agosto/2026, lockfile v2) no Windows; Dependabot não faz atualizações de segurança para Bun (usar Renovate).
- Better Auth: regressões em versões de correção e issues abertas (ver W2); versão exata fixada e spike obrigatório.
- Drizzle fixado na 0.45 (a v1 permanece em RC); Hono 5 em RC; TypeScript 7 sem API programática até a 7.1 (dependency-cruiser pelo extrator swc).
- Sem branch protection garantida no GitHub Free privado; agentes de IA com acesso de escrita.
- Observabilidade passa a ser cobrada por GB a partir de 2026-12-01 (50 GB incluídos no Paid).
- Safari/iOS: sem Background Sync, armazenamento best-effort; offline só sai se o gate passar em iPhone real.
- R2 não tem região na América do Sul: transferência internacional de dados (LGPD) para validar com advogado.

## 7. Pendências que dependem de terceiros

| Item | Com quem | Bloqueia |
|---|---|---|
| Regra de NFS-e (Emissor Nacional a partir de 01/11/2026?) e como foi emitida a nota da venda de 26/08 | Contador | Q29 pode voltar à v1 |
| Termos de uso, privacidade, política de reembolso, retenções e transferência internacional | Advogado do cliente | Go-Live |
| Provedores de vídeo e contas de teste de cada adapter | Cliente | Ativação dos adapters |
| Manual de marca em PDF e logo positivo | Cliente | Tokens finais |
| Destino da cópia semanal fora da Cloudflare | Cliente | Backup |
| Ciência do risco do YouTube em curso pago | Cliente | — |
| Varredura de segredos no histórico e visibilidade do repositório legado público | Responsável (ação no legado, exige autorização própria) | Higiene |

## 8. Roadmap revisado (M0–M10)

Sem prazos inventados: a velocidade é medida em M0–M2 e só então se estima. Detalhe em [../roadmap.md](../roadmap.md) e [../tasks/](../tasks/).

| Marco | Entrega | Gate de aceite |
|---|---|---|
| M0 Fundação e spikes | Repo, Worker+SPA, Neon Free ×3, CI, base visual, DNS planejado, 9 spikes | Staging publicado; spikes com ADR "passou/reabrir" |
| M1 Identidade e Staff | Magic link, perfil, grants, convite, suspensão, CSRF/headers | Login, linking, último Admin, acesso cruzado pela API |
| M2 Catálogo e autoria | Course/Offer, currículo vivo e publicação atômica, catálogo, página pública | Curso publicado atomicamente; rascunho não vaza |
| M3 Jornada gratuita | Entitlement/Enrollment, drip, matrícula gratuita e manual, conclusão | Aluno entra, se inscreve, conclui; sem Asaas/Order |
| M4 Assíncrono e e-mail | Outbox/inbox, 2 filas, cron, Resend, Operations Center inicial | Duplicata, crash, lease e DLQ tolerados |
| M5 Aprendizagem completa | Seis adapters, quiz, discussões, interesse, mídia R2, Ajuda | Testes de contrato por provider; 89%/90% |
| M6 Comércio | Order/Checkout/Payment, webhook, reconciliação, reembolso | Sandbox + corridas em PG real; nunca acesso indevido |
| M7 Certificados | Emissão, editor visual, PDF, validação pública, revogação | PDF imutável com SHA; paridade prévia↔PDF |
| M8 PWA | Offline Student, lease, sync, update seguro | Chrome + WebKit + iPhone real |
| M9 Operação e refinamento | Staff completo, marketing, hardening, backup, alertas, legal | Restauração ensaiada; WCAG 2.2 AA; textos jurídicos |
| M10 Migração e lançamento | ETL ensaiado, cutover, Go/No-Go, 7 dias de estabilização | Go/No-Go assinado |

**Ordem de risco:** o núcleo (login, curso, matrícula gratuita, aula, conclusão) é levado a Staging o quanto antes, para homologar com a Staff real. Os adapters além do primeiro, o PWA offline e o editor visual ficam no fim.

## 9. Plano executável para um desenvolvedor júnior

1. **Leitura inicial (nesta ordem):** `AGENTS.md` → `docs/implementation/STATUS.md` → `docs/roadmap.md` → a tarefa em `docs/tasks/` → as ADRs e a especificação citadas por ela.
2. **Uma tarefa por vez, com autorização explícita para aquele ID.** Cada tarefa tem passos, testes, aceite e fora de escopo. Ao terminar, atualizar `STATUS.md` somente com evidência (comandos reais, resultados, SHA).
3. **Primeiras tarefas recomendadas (não executadas):** M0-01 (repositório e governança), depois os spikes de Bun/Windows e de Better Auth + Hyperdrive, antes de M1.
4. **Regras de segurança do trabalho:** nada de commit, push, deploy, migração remota, DNS ou segredos sem autorização; nunca dados reais ou credenciais em código, testes, logs ou prompts; Production sempre manual.
5. **Quando um spike falhar:** parar, registrar a evidência, reabrir a decisão correspondente com o responsável. Não contornar.

## 10. O que foi feito no repositório

Com autorização explícita do responsável (Q59), o pacote de documentação foi reescrito:
- pacote B1–B16 arquivado em `docs/_historico/` (nada apagado);
- novos documentos: `docs/spec/` (domínio, contratos, segurança e operação), `docs/roadmap.md`, `docs/tasks/` (por marco), `docs/adr/` (24 ADRs) e `docs/architecture.md`;
- `AGENTS.md` reduzido, `PRODUCT.md`, `CONTEXT.md`, `DESIGN.md` reais e curtos, `docs/decisions.md` como índice;
- backup completo do estado anterior em local temporário fora do projeto durante a reescrita.

**Tamanho (medido em bytes, 2026-10-10):** o conjunto canônico novo (raiz + `docs/` sem `review/` e `_historico/`) tem ~390 KB, contra ~137 KB do pacote antigo de planejamento + `AGENTS.md`. Ou seja, **no total ficou maior, não menor**: a especificação (domínio, contratos, segurança e operação) tem ~67 KB (antes ~33 KB) e o backlog por marco ~205 KB em ~100 tarefas (antes 35 KB em 52). O que encolheu foi o que um agente carrega sempre: `AGENTS.md` de ~15,5 KB para ~10 KB, mais `STATUS.md`, e cada tarefa é lida isoladamente (um arquivo por marco, 10–27 KB). Se o responsável quiser o conjunto menor, a poda mais barata é enxugar o backlog (passos e testes) e remover redundância entre `spec/` e as ADRs; isso fica como decisão dele.

**Não foi feito:** nenhum código, nenhum provisionamento, nenhum commit, nenhuma ação no repositório legado.
