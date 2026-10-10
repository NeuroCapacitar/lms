# Registro corrido do debate de reabertura (vNext)

> Rascunho de trabalho, **não** é fonte canônica. Registra respostas do responsável do produto por rodada. O pacote `docs/planning/` só será reescrito após todas as decisões (relatório final). Legenda: DECIDIDO · DEFER · REJEITADO · CONDICIONAL · EM DEBATE.

Evidências: relatórios L1–L4 (legado) e W1–W5 (pesquisa), em 2026-10-09, mantidos no scratchpad da sessão.

## Rodada 1 — Fundamentos (respondida em 2026-10-09)

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q1 | Objetivo: sair da Vercel **e** reconstruir o domínio de forma mais simples e correta, com critérios mensuráveis: (1) custo recorrente sob controle individual; (2) release reproduzível sem bypass nem acoplamento à metadata do provedor; (3) domínio sem a complexidade acidental do legado (clones de publicação, `curriculum_key`, anti-seek, papel exclusivo); (4) conformidade mínima de consumidor/LGPD | DECIDIDO | Os critérios serão detalhados no relatório final |
| Q2 | Reescrever do zero; **sem** ponte OpenNext; o legado é especificação de casos, não código | DECIDIDO | vinext e TanStack Start fora por ora (W5) |
| Q3 | Manter **big-bang**: nenhuma Production da vNext antes da v1 integral | DECIDIDO | Tensão com Q5 (legado congelado por tempo indeterminado) e com o tamanho da v1; tratada em R2 pelo critério de corte e pelo prazo |
| Q4 | Migração única (ETL) do legado para a vNext, **somente ao final**, quando a vNext estiver comprovadamente pronta | DECIDIDO (momento) / CONDICIONAL (conteúdo exato) | Escopo do ETL (usuários, hashes de senha, concessões, conclusões, certificados com código/hash/URL) a fechar em R3/R4/R8; o modelo de dados da vNext deve poder recebê-lo |
| Q5 | Legado congelado: só correções de segurança, legais e de bloqueio de venda | DECIDIDO | Higiene de segurança do repositório público do legado fica como exceção; depende de autorização separada |
| Q6 | Processo enxuto e explícito | DECIDIDO | Detalhes (poucos docs vivos, sem testes sobre prosa/YAML, `STATUS.md` único, pacote `docs/planning/` reescrito e encolhido) a confirmar no relatório final |
| Q7 | 1 dev (júnior ou pleno) + agentes de IA; responsável do produto revisa e é dono de Production | DECIDIDO | Regra derivada: tecnologia "chata" e documentada vence a elegante; toda peça móvel nova justifica-se por dinheiro, acesso, privacidade ou durabilidade |
| Q8 | **Teto máximo de gastos do projeto: US$ 10/mês** (Workers Paid US$ 5 + US$ 5 de folga). Qualquer item pago acima do teto exige nova decisão explícita | DECIDIDO (valor) / EM DEBATE (o que conta no teto: vídeo JMV, domínio, taxas Asaas, contador/advogado) | Corrige a leitura anterior (US$ 5 total pré-aprovado). Consequência: free-tier-first (Neon Free, Resend Free, Sentry Free, GitHub Free) com gatilhos de upgrade a definir em R5/R7 |
| Q9 | Público declarado: profissionais adultos (18+) de saúde e educação, dito nos termos. Linguagem neutra na interface ("Boas-vindas", "Pessoas inscritas"). Aviso nas discussões proibindo dados identificáveis de pacientes | DECIDIDO | Copy detalhada em R6 |

## Rodada 2 — Escopo e jornadas (respondida em 2026-10-09)

Fatos informados pelo responsável: equipe = 1 dev (o responsável) + agente de IA; 1 admin quando o Hub estiver funcional; 3 pessoas de suporte. ~20 alunos inscritos hoje; 2 cursos novos planejados nos próximos meses; consumo no painel JMV "irrisório", plano fixo. 4 h/dia de trabalho; **sem data-limite de lançamento**. Empresa dona geralmente ME, com contador.

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q10 | Fatos acima | DECIDIDO (premissas) | Escala muito pequena e sem prazo: dimensiona custo, filas e vídeo nas próximas rodadas |
| Q11 | Regra de corte: entra na v1 só o que for (a) obrigação legal/segurança, (b) paridade com o legado, (c) risco de incidente de dinheiro/acesso/privacidade ou (d) valor pedagógico claro a baixo custo | DECIDIDO | Q14, Q15 e Q16 foram mantidos pelo responsável como **exceções deliberadas** à regra |
| Q12 | Quiz entra na v1 como descrito nos documentos (simples) | DECIDIDO | Efeito na conclusão/certificado a fechar em R3 |
| Q13 | Discussões mínimas na v1 | DECIDIDO | Aviso contra dados de pacientes (Q9); moderação, denúncia e notificação a detalhar em R3 |
| Q14 | PWA offline seletivo mantido como nos documentos | DECIDIDO (exceção à Q11) | Gate P-15 (Safari/iOS real) permanece bloqueador do release offline |
| Q15 | Editor visual de certificado mantido como nos documentos | DECIDIDO (exceção à Q11) | Gate P-18 (paridade snapshot↔PDF) permanece |
| Q16 | Marketing (preferência, Contacts, segments), banners e mídia de login mantidos como nos documentos | DECIDIDO (exceção à Q11) | Verificar limites do Resend Free dentro do teto de US$ 10 (R4) |
| Q17 | Das adições entra **apenas o item 1 (matrícula manual pela Staff)** | DECIDIDO | Itens 2 (desistência de 7 dias pelo aluno), 3, 4 (legendas), 5 (troca de e-mail), 6 (exclusão/exportação) e 8 (NFS-e) **não entram como funcionalidade**; os que são obrigação legal (2 e 6) precisam de procedimento manual → CONDICIONAL, em R3. Item 7 (sequência livre/guiada) já está nos documentos e permanece |
| Q18 | Painel da Staff e analytics como nos documentos | DECIDIDO | |
| Q19 | Jornadas essenciais Student e Staff conforme propostas | DECIDIDO (provisório: "acho que concordo") | |


## Fatos levantados fora do debate (pendentes de ação do responsável)

- Repositório legado `NeuroCapacitar/hub` é **público** e expõe identificadores de infraestrutura e caminhos pessoais; recomendada varredura de segredos no histórico (ação no legado, exige autorização própria).
- Possível obrigatoriedade do Emissor Nacional de NFS-e para ME/EPP do Simples a partir de 01/11/2026 (fonte secundária): confirmar com o contador; independe da vNext.

## Rodada 3 — Domínio, identidade e comércio (respondida em 2026-10-10)

Contexto novo: existe um **cliente/dono do negócio** que decide custos operacionais de fornecedores (vídeo, Asaas etc.); o responsável pelo desenvolvimento decide a infraestrutura de desenvolvimento.

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q20 | O teto de US$ 10/mês refere-se à **infraestrutura de desenvolvimento**: único custo certo é o Workers Paid (US$ 5); todo o resto fica em free tier, e upgrade pago só entra em discussão se necessário. Vídeo (JMV, Mux etc.), Asaas e afins são custos operacionais escolhidos pelo cliente e decididos com ele | DECIDIDO | Remove a dúvida da R2: nada de Neon/Resend/Sentry pagos sem nova decisão |
| Q21 | Desistência, exclusão, dados e afins: **sem funcionalidade própria**; a pessoa solicita por **e-mail ao suporte** | DECIDIDO | Procedimento escrito para a Staff, prazo interno de resposta e validação jurídica/contador pendentes; troca de e-mail tratada pelo mesmo canal (a confirmar) |
| Q22 | Currículo conforme os documentos (`CourseRelease` + revisões imutáveis). O responsável entendeu que isso equivale à opção B | CONDICIONAL | **Não são equivalentes**: documentos = opção A (revisões imutáveis de Module/Lesson); B = currículo vivo com rascunho/publicação, sem revisões imutáveis. Confirmar A |
| Q23 | Offer separada de Course, como nos documentos (Course 1:N Offer; Offer 1 Course; Order com snapshot) | DECIDIDO | |
| Q24 | Regras de conclusão como nos documentos (vídeo 90% sem anti-seek; quiz como Lesson; só obrigatórias contam) | DECIDIDO | Exceção de conclusão manual pela Staff (proposta) **não adotada**; reabrir se surgirem chamados "assisti e não concluiu" |
| Q25 | Papéis com **permissões granulares** para cada suporte (grants), só o Admin cria/edita cursos, Staff usa a mesma conta na área de aluno com **visualização de prévia** (como no legado, sem gravar progresso) | DECIDIDO | Mantém o modelo dos documentos (papéis não exclusivos + grants normalizados, ≥1 Admin). Catálogo de grants a fechar |
| Q26 | Google + senha para todos; **passkeys adiadas**; **Staff obrigada a entrar com Google** | DECIDIDO | Ressalva: o Hub não consegue verificar que a conta Google tem 2 etapas ativada; exigir por procedimento no onboarding da Staff |
| Q27 | Login obrigatório antes de comprar | DECIDIDO | |
| Q28 | Pix e cartão, até 12x, sem juros, sem boleto | DECIDIDO | |
| Q29 | Nota fiscal fora da v1 como funcionalidade | DECIDIDO / CONDICIONAL | Respostas do contador (como a nota da venda de 26/08 foi emitida; regra a partir de 01/11/2026; lista manual mensal) ainda pendentes |
| Q30 | Reembolso: 7 dias garantidos a partir da compra; depois, exceção do Admin; reembolso revoga acesso; certificado emitido permanece com registro do reembolso | DECIDIDO | |
| Q31 | Não há "temporário ou vitalício" como oferta. **Se a matrícula expirar e a pessoa recomprar meses depois, o progresso continua; não reinicia** | DECIDIDO (progresso) / EM DEBATE (duração e drip) | Altera o contrato dos documentos (`EnrollmentEpisode`: interrupção total cria episódio novo). Falta definir duração do acesso e efeito no drip |

## Rodada 3 (fechamento) e Rodada 4 (respondidas em 2026-10-10)

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q32 | **Opção B**: currículo vivo com rascunho e publicação atômica, IDs estáveis de módulo e aula, **sem revisões imutáveis por publicação** | DECIDIDO | Substitui parcialmente B2 (`CourseRelease` com `ModuleRevision`/`LessonRevision` imutáveis). Nomes físicos e modelo a definir. Registrar como decisão `superseded` no relatório final |
| Q33 | Acesso **expira**, com prazo definido **por Offer**; **âncora de drip única por pessoa e curso**, definida no primeiro acesso e nunca reiniciada; recompra continua o progresso | DECIDIDO | Remove `EnrollmentEpisode`. Premissas a confirmar: toda Offer (inclusive gratuita) tem prazo em meses; não há vitalício |
| Q34 | Catálogo de grants aceito, com ajuste: **criar curso = só Admin; editar curso = delegável ao Suporte** | DECIDIDO (parte) / EM DEBATE (alcance de "editar") | Falta definir se "editar" inclui publicar, e se oferta/preço/disponibilidade continuam só Admin |
| Q35 | As 4 pessoas da Staff **não têm conta Google**. Checklist de 2 etapas: "como preferir, reduzir carga cognitiva" | EM DEBATE | Reabre Q26 para a Staff (a premissa "Google exige 2ª etapa" era incorreta: não é verificável) |
| Q36 | **Seis adapters de vídeo na v1** (JMVStream, Panda, Cloudflare Stream, Mux, YouTube, Vimeo) | DECIDIDO | Recomendação anterior (2 adapters) rejeitada. Pendentes: YouTube em curso pago (política da API) e contas de teste de cada provedor |
| Q37 | Página pública e nome do certificado como nos documentos | DECIDIDO | Lacuna a fechar na modelagem: se a página pública exibe o nome e quando a pessoa confirma o nome |
| Q38 | Termos de uso, privacidade, política de reembolso e canal do titular são pré-requisito de Go-Live (redigidos com advogado do cliente); Hub implementa aceite versionado no cadastro | DECIDIDO | |
| Q39 | Resend Free mantido; outbox adia excedente; gatilho de upgrade 60% da cota em 7 dias; sem e-mail em massa no cutover | DECIDIDO | |

## Rodada 4 (fechamento) e Rodada 5 (respondidas em 2026-10-10)

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q40 | Staff entra com **senha + autenticador TOTP obrigatório**, por convite; aluno mantém Google ou senha | DECIDIDO | Substitui a regra "Staff obrigada a entrar com Google" (Q26, parte Staff). Passkeys seguem adiadas. O legado removeu MFA em 2026-09-01 (motivo não documentado) |
| Q41.1 | YouTube **não** pode ficar em aula de curso pago em violação dos termos. Resposta do responsável: "deixa a plataforma em violação de termos" (rejeita a opção de apenas avisar) | DECIDIDO (interpretação) | Registrado como: YouTube só em curso gratuito; bloqueio técnico em curso com Offer paga. Confirmar a interpretação |
| Q41.2 | Contas de teste dos provedores: **sem resposta** | CONDICIONAL | Premissa: o cliente fornece as contas; adapter só é ativado na interface depois de passar nos testes de contrato |
| Q42 | "Editar curso" delegável ao Suporte, incluindo publicar; criar curso, oferta, preço, disponibilidade, template e emitente do certificado ficam só com o Admin | DECIDIDO | |
| Q43 | Neon Free em Production | DECIDIDO | Com as regras propostas: região São Paulo se o Free permitir; cron de reconciliação a cada 30 min; backup lógico diário e antes de cada release (RPO real até 24 h); 3 projetos Neon sem branch por PR; gatilhos de upgrade (>600 MB, >70 CU-h/mês, primeiro incidente de perda de dados) |
| Q44 | Delegado ao desenvolvimento ("como for melhor pro projeto") | DECIDIDO (por delegação) | **2 filas por ambiente** (`hub-finance` e `hub-general`), cada uma com sua DLQ; Postgres segue como fonte da verdade (outbox/inbox); fencing por lease em linha (`FOR UPDATE SKIP LOCKED`), sem advisory locks. Substitui as 5 filas de B12. Revisável se o custo operacional pesar |
| Q45 | Delegado ao desenvolvimento | DECIDIDO (por delegação) | Drizzle 0.45 fixado, migrations SQL revisadas à mão forward-only, sem API relacional; SQL cru só para locks/leases/constraints em funções nomeadas e testadas em PG real; Hyperdrive com `pg` por requisição e cache desligado |

Ressalvas técnicas incorporadas sem objeção: CSRF próprio para JSON; `run_worker_first` para `/api/*`; webhook Asaas sempre 200 e correlação pela sessão de checkout; Better Auth com versão exata e `validateSchema: false`; Workers Builds só com `versions upload`; Bot Fight Mode desligado até testar webhooks; spikes antes do M1.

## Rodadas 6 e 7 (respondidas em 2026-10-10)

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q40 | Responsável propõe **magic link** no lugar de senha/Google + TOTP, e como opção para os demais usuários | EM DEBATE | Análise entregue: magic link é 1 fator (a caixa de e-mail), não equivale a senha + TOTP; TOTP é gerado no aparelho, não enviado por e-mail |
| Q41.1 | **YouTube pode ser provider de curso pago**, assumindo o risco dos termos | DECIDIDO (risco aceito pelo responsável) | Anula a recomendação anterior. Riscos a registrar: violação da política da API do YouTube (conteúdo embutido não pode ser cobrado), vídeo indisponível/removido, proteção inferior. Aviso na interface da Staff ao anexar YouTube a curso com Offer paga; ciência do cliente recomendada |
| Q46 | Delegado: páginas públicas = página por curso, validação de certificado, login/cadastro, Termos/Privacidade/Ajuda; previews de compartilhamento via HTMLRewriter só em curso e validação; sem vitrine pública em lista | DECIDIDO (por delegação) | |
| Q47 | Tokens em 3 camadas (marca → função → componente) em OKLCH; variantes escurecidas para texto e ação; botão laranja com texto escuro; teste calculado de contraste claro/escuro; tema escuro desenhado | DECIDIDO | Pendente do cliente: PDF do manual (confirmar hex) e logo positivo |
| Q48 | **Mesma experiência visual para Student e Staff** (acolhedora, confortável); Staff reaproveita a linguagem do aluno; risco de não ser ideal assumido para evitar complexidade. **Movimento: como nos documentos, sem adaptação a `prefers-reduced-motion`** | DECIDIDO | Navegação (shell) da Staff continua estrutural (sidebar/gaveta) por necessidade funcional; densidade das tabelas via `size="sm"`. Restrição técnica mantida: nenhum conteúdo em movimento automático por mais de 5 s sem controle de pausa (WCAG 2.2.2, nível A), inclusive mídia de login |
| Q49 | Base **A** (repositório privado em conta pessoal, GitHub Free, controles compensatórios); migrar para **B** (organização Free) se possível | DECIDIDO (A) / CONDICIONAL (B) | O motivo original da preferência por conta pessoal não está documentado; nenhuma limitação técnica encontrada. Transferência posterior preserva o histórico. Opção C (Team) não adotada |
| Q50 | Duas camadas de CI: bloqueantes (TypeScript, Oxlint/Oxfmt, Vitest unitário + PG18 real, build do Worker, Playwright de fumaça, Gitleaks CLI, Knip, dependency-cruiser) e consultivas (Semgrep CE, actionlint/zizmor ao mudar workflow, Renovate com espera 7–14 dias); retiradas: Socket, Scorecard, Graphify, CodeRabbit, CodeQL | DECIDIDO | |
| Q51 | **Manter Bun** (como nos documentos); **TypeScript = versão estável mais atual** (hoje 7.0.2) | DECIDIDO | Mitigações: Bun fixado, lockfile v2, Renovate (Dependabot não faz security updates para Bun), spike no Windows no M0, Node LTS instalado para o Wrangler; dependency-cruiser pelo extrator swc até o TS 7.1 |
| Delegadas | React Hook Form + Zod; reordenação por botões acessíveis (Pragmatic DnD se compensar); `vite-plugin-pwa` em `injectManifest` com caches por usuário; Tiptap JSON com renderização por allowlist; Phosphor + Lexend Deca; sem Geist Mono; TanStack Table 9 e Recharts só na Staff | DECIDIDO (por delegação) | |

## Rodada 8 (respondida em 2026-10-10)

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q52 | **Opção B: tudo por magic link, inclusive a Staff, sem TOTP** | DECIDIDO | Substitui Q40 (senha/Google + TOTP) e a regra "Staff com Google" (Q26). Risco residual aceito: acesso total da Staff por posse da caixa de e-mail. Requisitos derivados: página de confirmação antes de criar a sessão (anti-scanner de e-mail), expiração curta, uso único, limite por e-mail e IP e **Turnstile no pedido de link** (o Resend Free tem 100 e-mails/dia: sem isso, o envio de links pode esgotar a cota e travar todos os e-mails), reautenticação para ações sensíveis por novo link recente, ≥1 Admin ativo. A confirmar: se aluno mantém Google e/ou senha opcional; Staff só por link |
| Q53 | Delegado | DECIDIDO (por delegação) | `pg_dump` diário e antes de cada release, cifrado com `age`, no R2; cópia semanal cifrada fora da Cloudflare (destino a combinar com o cliente); ensaio de restauração semestral e antes do lançamento; metas RPO até 24 h e RTO até 8 h a demonstrar; repositório administrativo isolado só se necessário (Free) |
| Q54 | Manter o que está nos documentos: evlog + Workers Logs/Traces + Sentry + Web Analytics, Operations Center, SLOs, alertas P0–P3 e runbooks; sem plantão 24/7 | DECIDIDO | Dentro do free tier (Q20): Sentry Free (1 usuário). `evlog` não foi pesquisado: validar maturidade no spike do M0 |
| Q55 | Domínio atual do Hub: `app.neurocapacitar.com.br`; o responsável controla o registro; demais registros da zona podem ser realocados; mover a zona DNS para a Cloudflare cedo, copiando todos os registros | DECIDIDO | Copiar MX/SPF/DKIM/DMARC e demais registros antes de trocar nameservers |
| Q56 | Cutover com janela curta e ETL (usuários, contas, acessos, conclusões, certificados com mesmo código/hash/URL, âncora de drip; financeiro histórico somente leitura; webhook e DNS trocados; legado desligado); só há volta antes da primeira operação nova | DECIDIDO | Depende do spike de compatibilidade de hashes de senha (menos relevante com magic link) e de preservar `/comprar/[slug]` e validação de certificado |

## Rodada 9 (respondida em 2026-10-10)

| ID | Decisão | Status | Observações |
|---|---|---|---|
| Q57 | Spikes no M0 (delegado): Better Auth + magic link + Hono + Hyperdrive + `pg` + Drizzle; Bun 1.4 no Windows + plugin de testes Cloudflare + dependency-cruiser sob TS 7; latência Neon São Paulo e orçamento de acordar o banco; player JMVStream real; webhook Asaas em sandbox; Browser Run (PDF com Lexend Deca); transformação de imagens com fallback; HTMLRewriter com validadores de preview; `evlog` e Sentry 11 | DECIDIDO | Cada spike vira ADR curta (passou / reabrir decisão) |
| Q58 | Roadmap M0–M10 com ajustes (spikes e DNS no M0; magic link no M1; currículo vivo no M2; 2 filas no M4; ETL e redirecionamentos no M10). Ordem de risco: núcleo cedo em Staging; adapters extras, PWA offline e editor de certificado no fim. Sem prazos inventados | DECIDIDO | |
| Q59 | Pacote de documentação encolhido: `AGENTS.md` ~5 KB; PRODUCT/CONTEXT/DESIGN reais e curtos; architecture de 1 página; spec de domínio e contratos reescritos; ADRs curtas (~20); STATUS único; roadmap e tarefas reescritos. Saem 01, 02, 06, 08, 09 e o pacote B1–B16 vira histórico (`superseded`) | DECIDIDO | Reescrita só após autorização própria (depois do relatório final) |
| Q60 | Itens não reabertos mantidos como nos documentos, com os ajustes citados (mídia, discussões, interesse, Ajuda/FAQ/suporte, e-mails transacionais, segurança transversal, PWA, analytics, retenções, acessibilidade) | DECIDIDO | Retenções pendentes de parecer jurídico |
| Q61 | Confirmadas: (1) aluno com magic link + Google e senha opcionais; Staff só por link; (2) toda Offer tem prazo em meses, sem vitalício; (3) cliente fornece contas de teste de vídeo e adapter só é ativado após os testes; (4) quiz obrigatório conta para conclusão e certificado, tentativas ilimitadas por padrão; (5) reembolso de venda do legado manual no Asaas | DECIDIDO | |

## Estado ao final das rodadas

Fronteira de decisões vazia. Pendências de terceiros (não bloqueiam o plano): NFS-e e contador (Q29); textos jurídicos, retenções e transferência internacional (advogado do cliente); provedores de vídeo e contas de teste (cliente); manual de marca PDF e logo positivo (cliente); destino da cópia semanal fora da Cloudflare (cliente); ciência do risco do YouTube em curso pago (cliente); varredura de segredos e visibilidade do repositório legado público (responsável, ação no legado).

Riscos a levar ao relatório final: Resend Free (100/dia) compartilhado por links de login, transacionais e marketing; verificar se broadcasts têm cota própria; legado congelado por tempo indefinido (custos da Vercel continuam); Neon Free sem SLA/PITR longo; Staff com acesso por posse de e-mail; seis adapters de vídeo em big-bang; Bun 1.4 no Windows.

## Pós-rodadas (2026-10-10)

- Q49: repositório vNext criado na organização, `NeuroCapacitar/lms` (privado, GitHub Free) — opção B realizada. Código ainda não existe; só documentação foi sincronizada.
