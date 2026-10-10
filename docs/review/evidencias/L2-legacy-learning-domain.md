# L2 — Domínio de aprendizagem do legado NeuroCapacitar Hub

**Objeto:** repositório legado `NeuroCapacitar/hub`, clonado read-only em `scratchpad/legacy-hub`.
**HEAD inspecionado:** `ed882138` (merge PR #263, 2026-10-06). Histórico: 2026-06-05 → 2026-10-06, 982 commits, 264 PRs, 0 issues no GitHub.
**Método:** leitura de ADRs, docs de domínio/integração, reviews, planos e pesquisas; leitura de schema, código e testes; `git log` por pasta; `gh pr list/view` (somente leitura). Nenhum script de aplicação, rede (além de `gh` read-only) ou banco foi executado.

**Legenda:** **[F]** fato verificado no repositório (arquivo:linha, migration, teste, PR). **[I]** inferência minha a partir dos fatos. Caminhos relativos à raiz do legado.

---

## Sumário executivo

1. **[F]** O currículo usa `CoursePublication` com **clonagem física** de todos os Módulos e Aulas a cada revisão (`src/features/admin/authoring.ts:1091-1307`), mas desde 2026-07-22 a semântica é **currículo vivo** (toda Matrícula lê a publicação vigente, ADR-0007). O modelo físico nasceu para "versão fixada por Matrícula" (ADR-0007 original em `78f6f103`, revertido no dia seguinte em `bf273f80`, migration `0035` renomeou `course_versions`→`course_publications` e removeu `enrollments.course_version_id`). **[I]** A clonagem sobreviveu à decisão que a justificava e gerou a cadeia `curriculum_key` → projeção de watch entre publicações (ADR-0014) → identidade de discussão (ADR-0018) → joins laterais por `curriculum_key` em toda leitura de progresso.
2. **[F]** O progresso de vídeo evoluiu de *ranges* (`0009`) → posição máxima (`0010`) → **fronteira linear validada anti-seek** (`0076`, ADR-0012), com limiar que passou por 95% (runtime) / 98% (contrato) até **100%** (`c6ac5679`). **[F]** Mesmo assim, o botão **"Concluir aula" está sempre disponível sem mínimo de visualização** (`src/app/(student)/app/aulas/[lessonId]/page.tsx:1166-1212`; DEC-DISC-004). **[I]** Toda a maquinaria anti-seek não protege conclusão nem certificado; só controla a conclusão *automática*. **[F]** Nunca foi verificada contra o player JMVStream real (`docs/reviews/2026-09-12-audit-validation-and-remediation.md:160`).
3. **[F]** Só existe um provider de vídeo funcional: **JMVStream** (iframe `player.jmvstream.com` + `postMessage`). `panda` e `external` existem no enum mas não têm adapter (`src/db/schema.ts:79-83`; autoria só grava `"jmvstream"|null`, `authoring.ts:1437`). Sem DRM/token/watermark comprovados.
4. **[F]** **Não há quiz/avaliação** — decisão explícita de produto "Sem avaliações" e "certificado é comprovante de conclusão de visualização" (`plans/README.md:404,423`). A vNext (B2) aprova quiz: é uma **reversão consciente** que precisa definir se quiz entra no critério de conclusão/certificado.
5. **[F]** Discussões: um nível de resposta, 2000 caracteres, moderação (ocultar/restaurar) só Admin, **sem notificação** ao aluno e sem paginação; feed "Últimos comentários" no dashboard Admin.
6. **[F]** Certificados são o subsistema mais caro: ~17k linhas (features + editor), **39 documentos** de plano/pesquisa/review sobre certificado, editor posicional por coordenadas, PDFKit + Sharp/librsvg + fontes Inter empacotadas, preview PNG persistido, purge de revogados em 60 dias com tombstone de hash.
7. **[F]** Drip D+N por Módulo (ADR-0010) custou ~49k linhas de diff (PRs #205 e #207) e ~4,7k linhas de documentação para uma regra calculada por requisição; motivação declarada: **reduzir exposição durante o prazo de arrependimento** (PR #205).
8. **[F]** **Não existe PWA/offline** (sem manifest, sem service worker). **[F]** Não existe UI para staff **matricular manualmente** um aluno em Production (só script local `db:seed:student`, `docs/domain/commerce-and-access.md:171-172`).
9. **[I]** Para a vNext: manter as regras de negócio (opcionais não bloqueiam, conclusão histórica, certificado por snapshot, D+N, autoinscrição gratuita sem Order), retirar clonagem/`curriculum_key`/anti-seek, simplificar certificado e storage, e adicionar o que o legado não tem (matrícula manual por staff, notificações de discussão, múltiplos providers verificáveis, ciclo de interesse rearmável, quiz, PWA).

---

## 0. Panorama quantitativo (contexto de custo)

| Métrica | Valor | Evidência |
|---|---|---|
| Idade do repo | ~4 meses (2026-06-05 → 2026-10-06) | `git log` |
| Commits / PRs | 982 / 264 (0 issues) | `git log`, `gh pr list` |
| Migrations | 107 (`0000`–`0106`); ~40 tocam aprendizagem/mídia/certificado | `src/db/migrations/` |
| Código não-teste TS/TSX | ~133k linhas | `wc -l` |
| Testes | 551 arquivos, ~101k linhas | `find src -name "*.test.ts*"` |
| Markdown (docs, plans, pesquisas) | ~78k linhas | `wc -l` em `docs advisor-plans design-plans plans research` |
| Arquivos-"deus" | `features/admin/server.ts` 4369; `features/courses/server.ts` 3285; `features/admin/authoring.ts` 2980; `features/admin/actions.ts` 2216; página da aula 1493 | `wc -l` |
| SQL cru vs Drizzle runtime | ~998 chamadas `.query(` vs 10 `getDb()` | `grep` |
| Churn por pasta (commits não-merge) | `(admin)` 236, `components` 228, `(student)` 167, `features/admin` 146, `features/courses` 121, `certificates` 47, `storage` 41 | `git log -- <pasta>` |
| Escala de conteúdo | Development: 53 Módulos, 82 Aulas; "poucos alunos", "público pequeno e íntimo" | `docs/reviews/2026-09-12-audit-validation-and-remediation.md:147-148`; ADR-0007:11; ADR-0008:11 |

**[I]** A proporção documentação+testes/código é muito alta para um produto com poucos alunos; o custo de cada feature de aprendizagem foi dominado por endurecimento de concorrência, rollout e auditoria, não por UX.

---

## 1. Catálogo, oferta, disponibilidade, interesse, gratuito, capas

### 1.1 Modelo
- **[F]** `courses` concentra identidade comercial **e** oferta: `price_in_cents`, `payment_allow_pix`, `payment_allow_credit_card`, `payment_max_installment_count`, `access_duration_months` (default 12), `cover_image_json`, flags de certificado e signatário (`src/db/schema.ts:482-520`).
- **[F]** Constraints de banco: preço `0` ou `>= 1000` centavos (R$ 10,00); pelo menos um meio de pagamento; parcelas 1–12; parcelamento exige cartão (`schema.ts:534-549`).
- **[F]** **Não há entidade `Offer`**: ADR-0009 rejeitou "entidade Oferta: mais extensível, mas prematura para uma oferta por Curso" (`docs/adr/0009-course-availability-and-sale-interest.md:35`). DEC-DISC-011 mantém um preço por Curso. **[I]** A vNext (B1: Course 1:N Offers) diverge deliberadamente.
- **[F]** Não há catálogo público no Hub: `/` exige sessão e redireciona por papel (`src/app/page.tsx:7-12`); a venda entra por landing externa → handoff `/comprar/[slug]` (DEC-DISC-007; `src/app/comprar/[slug]/page.tsx:261-270`). O aluno vê o catálogo dentro de `/app` ("Disponíveis agora", "Em breve") (`src/app/(student)/app/(dashboard)/page.tsx:223-253`).

### 1.2 Disponibilidade (ADR-0009)
- **[F]** Três dimensões independentes: `status` (entrega `draft|active|archived`), `catalog_visibility` (`listed|hidden`), `sales_status` (`open|closed`), com CHECK de combinações válidas (`schema.ts:61-73, 550-564`). A UI expõe presets Rascunho / Em breve / Disponível / Vendas pausadas + ação Arquivar (`src/features/courses/availability.ts:36-41`).
- **[F]** Regras em `src/features/courses/availability-server.ts:211-245`: Curso com histórico comercial não volta a Rascunho/Em breve; "Disponível"/"Vendas pausadas" exige publicação publicada; abrir vendas exige oferta válida e cronograma D+N que caiba na duração de acesso.
- **[F]** Matrícula efetiva consulta só entrega, nunca vitrine/vendas; fechar vendas cancela checkouts Asaas via outbox (ADR-0009:28-30). Arquivar bloqueia entrega (ADR-0009:39-41).
- **[F]** "Em breve" aceita `launch_date` e `launch_landing_url` só nesse estado (CHECK `schema.ts:569-582`).

### 1.3 Interesse de venda
- **[F]** `course_sale_interests` (curso, usuário) único; só Student autenticado (`schema.ts:586-609`; `src/app/(student)/app/actions.ts:260-279`).
- **[F]** Abrir vendas enfileira `email.course-sales-opened` para interesses ativos, payload só com IDs (ADR-0009:29-30; `availability-server.ts:350-384`).
- **[F] Limitação:** após notificado, o interesse **não pode ser rearmado**: `insert ... on conflict do nothing` e a remoção só apaga linhas com `notification_enqueued_at is null` (`availability-server.ts:512-541`). **[I]** Se as vendas abrirem, pausarem e reabrirem, quem já foi avisado não é avisado de novo nem consegue se reinscrever. A vNext ("CourseInterest com ciclos") corrige isso.

### 1.4 Curso gratuito (ADR-0016)
- **[F]** Gratuito = ativo, listado, vendas abertas, publicação publicada, cronograma compatível e `price_in_cents = 0`. `enrollFreeCourseAction` deriva identidade da sessão; caso de uso relê o Curso sob lock Conta+Curso e cria/reativa Concessão `free_enrollment` + evento + projeção, **sem Pedido/Checkout/Asaas** (ADR-0016:15-21; `src/app/(student)/app/actions.ts:81-116`).
- **[F]** Unicidade parcial `enrollment_grants (user, course) where source_type='free_enrollment'` (`schema.ts:900-902`). Reativação de gratuita expirada reutiliza a linha; revogada/bloqueada não reativa (ADR-0016:23-27).
- **[F]** Cobertura: `src/features/enrollments/free-enrollment.integration.test.ts:418-823` (concorrência, retry, reativação, revogação, bloqueio manual, preço alterado para pago antes da leitura final, cursos fechados/arquivados/sem publicação).

### 1.5 Capas e mídia de curso
- **[F]** Capa nova: WebP `1280×720` 16:9, variante única `card`, origem e recorte ≤ 4 MiB, Sharp qualidade 82, `blurDataUrl` (LQIP 10 px, q20) persistido (`docs/integrations/r2.md:204-260`; `src/features/storage/course-cover-upload.ts:80-103`). Crop no navegador com `react-easy-crop` (`src/features/courses/course-cover-crop-dialog.tsx`).
- **[F]** Capa só fica pública após `publishCourseCover` copiar privado→público, fora de transação, dentro do fluxo de publicação (`r2.md:247-256`; `authoring.ts:1077`).
- **[F]** Carga horária exibida: soma de vídeo + leitura estimada a **260 palavras/min** (`src/features/courses/lesson-duration.ts:3`), arredondada, com `workload_hours_override` opcional (REG-LEA-004A, `docs/domain/learning-content-and-progress.md:53-66`). O próprio doc admite: "o racional histórico de 260 palavras/minuto para leitura não foi localizado" (linha 108).

---

## 2. Currículo e versionamento

### 2.1 Linha do tempo da decisão
| Data | Evento | Evidência |
|---|---|---|
| 2026-07-20 | Plano 010 descreve "Curso → Módulo → Aula, sem versão; conclusão 98%" | `plans/010-...md` |
| 2026-07-20 | Decisão D1: "aplicar a nova aula apenas se pertencer à versão/coorte delas" → "Seguir a recomendação" | `plans/README.md:387-395` |
| 2026-07-21 | ADR-0007 v1: `CourseVersion`, **Matrícula aponta para uma Versão**, conteúdo vivo rejeitado; conclusão automática a 98% | `git show 78f6f103:docs/adr/0007-...md` |
| 2026-07-22 | ADR-0007 v2: `CoursePublication`, **Matrícula não guarda publicação**, toda Matrícula ativa lê a vigente ("O Hub atende poucos alunos") | `bf273f80`; ADR-0007:11-26 |
| 2026-07-22 | Migration `0035`: renomeia `course_versions`→`course_publications`, remove `enrollments.course_version_id` | `src/db/migrations/0035_...sql:1-25` |
| 2026-07-22 | Sprint review: 8 achados P1/P2, incl. "**Progresso perdido em nova publicação**" porque a clonagem gerava IDs novos | `docs/reviews/2026-07-22-course-publications-sprint-review.md:15-22` |
| 2026-07-22 | Correção: coluna `lessons.curriculum_key` (migration `0036`) | idem:26 |
| 2026-09 | ADR-0014 (identidade de Aula entre publicações) e ADR-0018 (discussão por `course_id + curriculum_key`, migrations `0087`/`0088`) | ADRs |

**[I]** A reversão de "fixado por Matrícula" para "vivo" ocorreu em ~24 h, mas a estrutura física (clonar tudo por publicação) foi mantida por renomeação. Os ADRs posteriores existem para remendar efeitos colaterais da clonagem.

### 2.2 Como funciona hoje
- **[F]** `course_publications` com `draft|published|retired`, número sequencial, `title_snapshot`, `workload_hours_snapshot`; índices únicos parciais "um published" e "um draft" por Curso (`schema.ts:611-653`).
- **[F]** `modules` e `lessons` pertencem a uma publicação, com FKs compostas que impedem divergência Curso/Publicação/Módulo (`schema.ts:655-758`; migrations `0078`, `0079`). `lessons.curriculum_key` UUID estável (`schema.ts:702`).
- **[F]** "Preparar alterações" = `createCoursePublicationDraft` **clona todos os Módulos e Aulas** da publicada (INSERT linha a linha) preservando `curriculum_key` (`authoring.ts:1091-1307`; UI `course-publication-action.tsx:31-38`).
- **[F]** "Publicar alterações" = duas transações com o mesmo lock (`lockLessonResourceLifecycle` global, `lockJmvstreamVideoLifecycle` global, `lockCourseContentRelease` por Curso), cópia de capa e materiais R2 **fora** da transação, revalidação do snapshot inteiro e troca atômica published→retired / draft→published, com auditoria (`authoring.ts:770-1089`).
- **[F]** Validações de publicação: vídeo JMVStream sem player, com exclusão pendente ou sem duração bloqueia (`authoring.ts:651-723`); regressão de atraso D+N bloqueia após histórico agendado (`authoring.ts:900-911`); Aula obrigatória que ficaria indisponível durante toda uma Matrícula agendada bloqueia (`authoring.ts:913-949`); publicar atrasos > 0 exige flag `CONTENT_RELEASE_DELAYED_PUBLISHING_ENABLED` (`authoring.ts:882-889`).
- **[F]** Não há edição direta de conteúdo publicado; correção de digitação exige clonar, editar e republicar (ADR-0007:22; REG-LEA-001).
- **[F]** Progresso de Aula é persistido por `lesson_id` físico (`schema.ts:996-1017`), e **toda leitura** reconcilia conclusões por `curriculum_key` via `left join lateral` (`src/features/courses/server.ts:357-369`).
- **[F]** Watch de vídeo só é "herdado" entre publicações se Curso + `curriculum_key` + provider `jmvstream` + `video_external_id` não vazio coincidirem (ADR-0014:22-36; `courses/server.ts:2708-2747`).
- **[F]** Não há UI para gerar um novo `curriculum_key` ("mudança pedagógica grande cria novo curriculum_key", ADR-0014:18) — `curriculum_key` só é lido/copiado em `authoring.ts` (grep). **[I]** Na prática, nova identidade só surge apagando e recriando a Aula; o conceito é invisível para a autora.
- **[F]** Não há restauração de publicação aposentada (`docs/reviews/2026-09-25-certificate-template-and-course-versioning-research.md:31`).
- **[F]** Status redundantes na Aula: status da publicação + `lessons.status (draft|active|archived)` + `lessons.is_published` (`schema.ts:723-725`). `is_published` não é lido no gating do aluno (grep: só em clonagem/auditoria/seed). **[I]** Coluna vestigial e modelo mental confuso ("rascunho dentro do rascunho").

### 2.3 Dores registradas
- **[F]** Sprint review 2026-07-22 (8 achados): seed E2E quebrado pela migration; SQL inválido no analytics; **progresso perdido na publicação**; vídeo removível fora do rascunho; emissão manual contornando reemissão; carga horária somando todas as publicações; rascunho concorrente sem invariante; certificados duplicados na migration (`2026-07-22-course-publications-sprint-review.md:15-22`).
- **[F]** PR #16 "restore access to published course lessons": autorização de comentários misturava aulas de todas as versões; a primeira aula publicada era tratada como bloqueada e derrubava o Server Component.
- **[F]** Auditoria 2026-09-12: A01 denominadores diferentes entre dashboard/overview/módulo; A06 rascunho vazando carga horária; A08/A09 Módulo/Aula podendo divergir entre Curso e Publicação; A12 corrida na alocação de slug (`audit-validation-and-remediation.md:140-151`).
- **[I]** A complexidade é real: quase toda query de aluno faz `join course_publications ... status='published'` + lateral por `curriculum_key`; cada nova feature (comentários, analytics, watch, materiais R2, drip) precisou de regra própria "entre publicações".

---

## 3. Liberação de conteúdo, sequência e opcionais

### 3.1 Drip relativo por Módulo (ADR-0010)
- **[F]** `modules.release_delay_days` (D+N; `schema.ts:668`); `enrollments.content_release_mode (full_access|scheduled)` + `content_release_started_at` com CHECK de forma (`schema.ts:846-868`).
- **[F]** D+N = N × 24 h desde a âncora (`src/features/courses/module-content-release.ts:1-2`); margem comercial: maior atraso < `access_duration_months × 28 dias` (linha 4 e `assertMaxReleaseDelayFitsAccessDuration`).
- **[F]** Âncora = instante em que o Hub aplica a Concessão, não `paid_at` do provider (ADR-0010:35-39). Renovação preserva âncora; recompra após perda total reinicia (ADR-0010:18-20).
- **[F]** Regra monotônica: após a primeira Matrícula agendada, publicação só pode reduzir atrasos (`course-publication-release-policy.test.ts:22-83`). Matrículas anteriores ao rollout ficam `full_access`.
- **[F]** Admin pode "Liberar conteúdo integral" por Matrícula, com motivo e auditoria, sem reversão no episódio (`grantEnrollmentFullContentAccessAction`, `features/admin/actions.ts:890`; `student-content-release-controls.tsx`).
- **[F]** Cada Pedido guarda snapshot do cronograma + digest SHA-256; checkout é recusado se o cronograma mudou entre apresentação e confirmação (ADR-0010:30-33; `content-release.integration.test.ts:462-537`).
- **[F]** Enforcement único em workspace, overview, conclusão, watch, comentários, download/preview de materiais; Aula bloqueada aparece como card estático sem link/foco (REG-LEA-001 em `learning-content-and-progress.md:39`; `content-release.integration.test.ts:65-140`).
- **[F]** Motivação: "reduzir exposição durante arrependimento" (corpo do PR #205). DRM/watermark explicitamente fora (`docs/superpowers/specs/2026-09-04-module-content-release-design.md:424`).
- **[F]** Custo: PR #205 (+18.999/−2.803, 146 arquivos) e PR #207 (+30.414/−1.039, 119 arquivos); docs: spec 565 + plano 2.546 + remediação 1.077 + review 414 + runbook 90 linhas. Review de prontidão listou 8 P1, incl. "Rollback de código pode liberar conteúdo futuro" → rollout em duas fases com feature flag (`2026-09-06-module-content-release-production-readiness-review.md:151-167`).
- **[F] Drift documental:** `learning-content-and-progress.md:106` ainda diz "não há coortes ou drip".

### 3.2 Sequência e opcionais (ADR-0011)
- **[F]** `isLessonAvailable`: Aula concluída sempre acessível; senão, bloqueada só se houver **obrigatória anterior** pendente — opcionais anteriores não bloqueiam (`src/features/progress/rules.ts:107-134`). Bug anterior: opcional bloqueava a próxima (auditoria A02).
- **[F]** Precedência: bloqueio temporal (D+N) antes do sequencial; Aula concluída atravessa ambos (`module-content-release.test.ts:115-144`).
- **[F]** Próxima Aula após conclusão: procura à frente; só reinicia do início quando a Aula concluída é a última do currículo (`rules.ts:79-105`; ADR-0011:15).
- **[F]** Progresso = obrigatórias concluídas / obrigatórias ativas da publicação vigente, `Math.round` (`rules.ts:34-50`). Curso sem obrigatórias nunca conclui nem emite certificado (`src/features/certificates/rules.ts:20-26`; ADR-0011:17).
- **[F]** Sequência é sempre "guiada" (não há modo livre por Curso). **[I]** A vNext (`guided|free`) adiciona configuração inexistente no legado.

---

## 4. Vídeo: progresso, providers, JMVStream

### 4.1 Providers
- **[F]** Enum `video_provider ('panda','jmvstream','external')` desde `0000` (`schema.ts:79-83`), mas só JMVStream tem cliente, upload, tracking e sanitização (`src/features/videos/jmvstream.ts`, `src/features/jmvstream/*`). Autoria grava só `"jmvstream" | null` (`authoring.ts:1437`). `external` aparece apenas como "embed inalterado" em `resolveLessonVideoEmbedUrl` (`videos/jmvstream.ts:73-89`); não há tracking para não-JMVStream (`courses/server.ts:3194-3205`).
- **[F]** `jmvstream_folder_type` tem `module`, mas o código só cria pasta de Curso (grep sem uso de `'module'` em `features/jmvstream`). Vestigial.

### 4.2 O que é a JMVStream e como é integrada
- **[F]** Provedor brasileiro de hospedagem/streaming. API pública `https://api.jmvstream.com` (`/v2/authenticate`, `/v2/upload/multipart/s3`, `/v2/upload/multipart/complete`, `/v1/folders`, `/v1/videos/{hash}`, `/v1/videos/job-status/{hash}`, `deleteVideo/{hash}/{planId}`, `moveVideo`) (`src/features/jmvstream/client.ts:318-474`; `docs/integrations/jmvstream.md:15-24`).
- **[F]** Preço: o repo **não registra preço contratado**. Há menção ao FAQ comercial: rate limit de API 60 req/min (Starter), 600 (Professional), 6.000 (Full), Enterprise por contrato (`docs/reviews/2026-10-03-rate-limits-project-audit.md:157`). Plano Production `OD-20912` é **compartilhado por Development e Staging** sem isolamento técnico (`docs/decisions.md:272`; `jmvstream.md:26-40`).
- **[F]** Upload: multipart direto do navegador às URLs assinadas da JMVStream; servidor inicia/completa; partes de 16 MiB (≤1 GiB) ou 64 MiB, concorrência 4, até 10.000 partes / 5 TiB (`src/features/jmvstream/upload-config.ts:1-35`; ADR-0003). **[F] Drift:** ADR-0003:17 cita só 64 MiB.
- **[F]** Cron `/api/cron/jmvstream` (`15,45 * * * *` em `vercel.json`) sincroniza player/thumbnail pendentes; doc diz "a cada trinta minutos" (`jmvstream.md:84`) e `release-state.md:86,129` diz 15 min e 5 min. **[I]** Documentação operacional contraditória.
- **[F]** Contradição de contrato `gallery` no complete nunca resolvida (`jmvstream.md:69-80`).
- **[F]** Embed: `<iframe allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin">` com URL sanitizada para a origem exata `https://player.jmvstream.com` (`src/components/lesson-video-player.tsx:419-428`; `videos/jmvstream.ts:29-57`; PR #146).
- **[F]** Proteção/DRM: "O repositório não prova que token por sessão, whitelist de domínio, DRM ou watermark estejam ativos em Production" (`plans/000-lms-staged-access-evidence.md:316-319, 529-533`). A URL do player é entregue ao navegador após autorização; a segurança pós-entrega depende do provider.
- **[F]** Duração autoritativa: vem do campo `durationSeconds` do **formulário Admin** (`authoring.ts:2567-2572`), pré-preenchido por um detector de iframe no navegador da autora (`src/components/jmvstream-duration-detector.tsx`; `shouldApplyDetectedDuration` em `videos/jmvstream.ts:166-178`), não da API do provider. **[I]** "Autoridade server-side da duração" depende de um valor digitado/detectado no browser da equipe.

### 4.3 Medição de progresso (ADR-0012)
- **[F]** Evolução do schema: `0009` criou `watched_ranges jsonb`; `0010` **removeu ranges** e criou `max_position_seconds`; `0076` adicionou `resume_position_seconds`, `validated_position_seconds`, `playing_time_seconds`, `tracking_session_id`, `last_event_sequence`, `awaiting_playback_after_seek`, `linear_progress_blocked`, `tracking_version`, `completion_source` (`src/db/migrations/0009_*.sql`, `0010_*.sql`, `0076_*.sql`; `schema.ts:1019-1098`).
- **[F]** Limiar: contrato 98% vs runtime 95% (drift, auditoria A04), `end` ignorava limiar (A05); corrigido para **100%** e `Math.floor` em 2026-09-12 (`c6ac5679`; `videos/jmvstream.ts:6, 180-189`).
- **[F]** Cliente: envia `jmvplayer-sync` ao iframe a cada **1,5 s**; persiste no servidor a cada **10 s**, ou a cada **5 p.p.**, ou em pause/skip/end, e em `visibilitychange=hidden`/`pagehide` (`lesson-video-player.tsx:29-33, 182-191, 324-351`).
- **[F]** Cada "heartbeat" é uma Server Action que abre transação, adquire lock da Matrícula (`lockEnrollmentAggregate`), recarrega todo o workspace da Aula e então calcula (`courses/server.ts:3148-3285`).
- **[F]** Regras puras (`rules.ts:136-269`): salto > **30 s** é tratado como seek; tolerância de fronteira **1 s**; `skip` nunca avança a fronteira; reprodução após skip conta em `playing_time` (analytics) mas não valida; voltar ao ponto validado desbloqueia.
- **[F]** Sessão: `startLessonWatchSession` emite token UUID; a última sessão aberta vence; eventos de sessão antiga → `inactive_session`, sequência repetida → `stale_event` (`courses/server.ts:2623-2648, 2759-2921`).
- **[F]** Retomada: após o primeiro evento do player, envia `jmvplayer-jump` com a posição de retomada; o primeiro evento pós-salto é descartado (`lesson-video-player.tsx:131-151, 395-399`; `jmvstream.md:167-178`).
- **[F]** Duração ausente → "concluir manualmente" (`lesson-video-player.tsx:443-448`).
- **[F]** UX do bloqueio: toast de 7 s "volte ao começo do trecho pulado" (`lesson-video-player.tsx:33-43`), apesar de a pesquisa da própria equipe recomendar mensagem **inline persistente** e não depender de toast (`design-plans/2026-09-23-transient-status-and-linear-video-progress-research.md:33-39`). Teste fixa o toast: "shows a toast instead of a persistent notice" (`lesson-video-player.test.tsx:198`).
- **[F]** Conclusão manual sem requisito de vídeo, sempre disponível (DEC-DISC-004; botão `page.tsx:1166-1212`).
- **[F]** Nunca validado com player real: "player JMVStream real e concorrência PostgreSQL permanecem não verificados" (`audit-validation-and-remediation.md:160`; `docs/reviews/2026-09-12-master-plan-with-implementation-report.md:1080,1132,1550,1579`). A doc oficial de eventos do player é marcada pelo próprio provedor como "referência antiga" (`jmvstream.md:205`).

### 4.4 Autoavanço e autoplay
- **[F]** **Autoavanço sem opt-in e sem contagem regressiva**: ao receber `jmvplayerout-end` com conclusão, `router.replace` para a próxima Aula (ou para o Curso) (`lesson-video-player.tsx:241-251`). A conclusão manual também redireciona imediatamente para a próxima Aula (`src/app/(student)/app/actions.ts:118-151`).
- **[F]** Não há parâmetro de autoplay na URL nem `play()` programático; o iframe apenas *permite* autoplay (`allow="...autoplay..."`). **[I]** Se o player JMVStream estiver configurado no portal para autoplay, a próxima Aula toca sozinha — não controlado pelo Hub.
- **[F]** Vídeo em processamento: polling da página a cada 15 s (`src/components/lesson-video-processing.tsx:8`).

---

## 5. Quiz / avaliações

- **[F]** Não existe. Nenhuma tabela, rota ou componente (`grep -i "quiz|assessment|avaliação"` em `src` vazio; schema sem tabelas correspondentes).
- **[F]** Decisões de produto registradas: D2 "Não deve haver prova, o certificado é comprovante de conclusão de visualização de aulas" (`plans/README.md:404`); D4 "Sem avaliações" (`plans/README.md:423`). Recomendação técnica anterior era "quiz objetivo de baixo risco, com tentativas append-only e regra de aprovação configurável" (`plans/README.md:417-418`).
- **[I]** A vNext aprova quiz (B2). Implicações: (a) não há legado a portar; (b) é preciso decidir se aprovação no quiz entra em "Aula concluída"/"Curso concluído"/certificado — isso muda a semântica do certificado de "comprovante de visualização" para "comprovante de conclusão de percurso com avaliação".

---

## 6. Discussões / comentários

- **[F]** `lesson_comments` com identidade de thread `course_id + curriculum_key`; `source_lesson_id` anulável (`set null`) como origem física (`schema.ts:1196-1239`; ADR-0018; migrations `0087`, `0088`).
- **[F]** Regras: corpo ≤ **2000** caracteres, trim, não vazio; **um único nível** de resposta (`src/features/comments/rules.ts:3, 46-60, 83-85`). Sem edição/exclusão pelo autor (ações só create/hide/restore: `src/features/comments/actions.ts:17,54,77`).
- **[F]** Aluno só comenta/lê se tiver acesso à Aula (sequência, drip, matrícula, revogação), revalidado sob lock (`comments/server.ts:58-133`; `content-release.integration.test.ts:314-411`).
- **[F]** Admin e Suporte participam (responder); **ocultar/restaurar só Admin** (`isLessonCommentManager = role === "admin"`, `rules.ts:7-11`; ADR-0017). **[F] Contradição:** o plano 013 decidiu "Admin e Suporte possuem a mesma liberdade de gerenciamento: ... ocultar e restaurar" (`plans/013-admin-latest-comments-feed.md:24-26`), superado por ADR-0017.
- **[F]** Ocultar comentário pai oculta respostas para o aluno; texto oculto nunca sai no modelo de apresentação (`comments/server.ts:172-185`; `rules.ts:88-103`).
- **[F]** Sem paginação: carrega toda a thread (`comments/server.ts:154-196`).
- **[F]** Sem notificação: nenhum tópico de e-mail para comentário/resposta (`emailDeliveryTopicEnum`, `schema.ts:200-213`). Staff descobre por feed "Últimos comentários" no Dashboard Admin (`src/app/(admin)/admin/(dashboard)/page.tsx:1365-1380`; plano 013 proibiu inbox/unread/atribuição).
- **[F]** Auditoria registra identidade/contexto, nunca o corpo (ADR-0018:41).
- **[F]** Decisão D5: "Manter comentários por aula, não teremos comunidade" (`plans/README.md:433`).

---

## 7. Certificados

### 7.1 Ciclo de vida (ADR-0006, `docs/domain/certificates-and-data-rights.md`)
- **[F]** Emissão automática **somente** pela transação que insere a primeira `CourseCompletion` (Aluno+Curso único) (`schema.ts:2063-2098`; REG-DAT-001). Lock transacional por Conta+Curso compartilhado por conclusão, emissão manual e reemissão (`lockCourseCertificateLifecycleInTransaction`; `certificates/server.ts:625`).
- **[F]** Bug histórico corrigido (plano 002, P0): `completeLesson` declarava `certificateIssued = true` sem saber se o INSERT venceu o conflito → dois e-mails e código inexistente (`plans/002-certificate-issuance-concurrency.md:20-25`). Hoje: `INSERT ... ON CONFLICT DO NOTHING RETURNING code` (REG-DAT-001).
- **[F]** Renderização assíncrona via outbox `certificate.render`, claim com lease de 10 min, fencing por token, PUT condicional `If-None-Match: *` no R2, SHA-256 em coluna e em metadata do objeto; e-mail só após `ready` (`certificates/rules.ts:17`; REG-DAT-001A; `r2.md:307-318`). Testes: `certificate-issuance.integration.test.ts:380-1150` (lease, crash após upload, revogação durante IO, token antigo).
- **[F]** Revogação com categoria padronizada (7 valores, CHECK em `schema.ts:1994-1997`) + detalhe interno; reemissão cria novo código e preserva predecessor; Support só reemite o mais recente (DEC-DISC-006/014).
- **[F]** Retenção: preview PNG removido logo após revogar; PDF e registro detalhado purgados após **60 dias**; fica `certificate_revocation_tombstones (sha256(code), revoked_at)` + `course_completions.certificate_ever_issued` (`schema.ts:2005-2017, 2077-2080`; ADR-0006:114-138; `rules.ts:18`). **[I]** A vNext registra "purge 90d" (B6) — divergência a resolver juridicamente.
- **[F]** Reconciliação histórica (Admin, lotes de 100) para conclusões sem certificado; sem backfill silencioso (ADR-0006:53-55).
- **[F]** Nova publicação pode reduzir progresso de quem já é certificado; certificado continua válido e não é reemitido (ADR-0007:26-30).

### 7.2 Código, QR e página pública
- **[F]** Código novo: 16 bytes CSPRNG em Base64URL sem padding (22 chars), sem prefixo; legados `PRT-...` preservados (`src/features/certificates/certificate-code.ts:5-16`; ADR-0006:102-112; reviews `2026-09-25-certificate-code-base64url-migration-research.md`, `2026-09-25-certificate-validation-code-research.md`).
- **[F]** QR via `qrcode` apontando para `/certificados/{code}` (`certificates/rendering.ts:45-49`; `rules.ts:28-29`).
- **[F]** `/certificados/[code]` pública, `noindex`, rate limit **20 req/min por IP** (HMAC do IP) em tabela Postgres (`src/features/certificates/public-rate-limit.ts:7-8`). Mostra estado, data e categoria legível de revogação; após purge, só "revogado + data".
- **[F]** `/certificados/[code]/preview` gera/reutiliza PNG 1200×848 **persistido no R2** com `preview_sha256`; `/certificados/[code]/pdf` público para `valid+ready`, verifica SHA-256 e redireciona para URL assinada curta (ADR-0006:15; REG-DAT-004). **[I]** A vNext (B6) proíbe PNG persistido e download público indiscriminado — mudança de contrato.
- **[F]** Aluno: `/app/certificados` (arquivo global, pending com refresh automático, histórico em sheet) e painel contextual na página do Curso; rota autenticada `/app/certificados/[code]/pdf`.

### 7.3 Template, editor, signatários, renderer
- **[F]** Template por Curso versionado `draft|published|superseded`, um publicado e um rascunho por Curso (`schema.ts:2030-2060`); arte A4 horizontal (fundo ≤10 MiB, assinatura ≤2 MiB, normalizados para WebP) e **12 campos posicionados por coordenadas** (`studentName, courseTitle, workloadHours, completedAt, issuedAt, issuerName, issuerCnpj, signerName, signerRole, signatureImage, validationCode, qrCode`) com x/y/largura/altura/fonte/cor/alinhamento (`src/features/certificates/template-rules.ts:1-45`).
- **[F]** Sem HTML/CSS livre; sem autoajuste; texto que excede o retângulo é recortado; editor avisa overflow/sobreposição (ADR-0006:15-17; certificates-and-data-rights.md:62-75, 92-96).
- **[F]** Renderer: **PDFKit** + **Sharp/librsvg** + Fontconfig empacotado + Inter TTF; aliases `Helvetica`→Inter; `rendererVersion: 2` para paridade PDF/PNG (ADR-0006:19-41; PRs #206, `7d096bee`). Pesquisas: `2026-09-25-certificate-preview-renderer-parity-research.md` (247 linhas).
- **[F]** Signatário: emenda 2026-09-24 moveu nome/cargo do global (`app_settings`) para o Curso, sem fallback; colunas legadas mantidas para rollback (`schema.ts:2041-2044, 2453-2462`; ADR-0006:80-100; `advisor-plans/certificate-signatory-scope-research-2026-09-24.md`). Perfil emissor global com razão social, marca e CNPJ validado (dígitos verificadores) (certificates-and-data-rights.md:52-60).
- **[F]** Histórico de template lista só "Versão N" e estado; sem visualizar/restaurar (`2026-09-25-certificate-template-and-course-versioning-research.md:16`).
- **[F]** Custo: features/certificates 10.446 linhas (58 arquivos) + editor admin 6.588 linhas (teste do editor sozinho 2.236); **39** documentos de plano/pesquisa/review com "certif" no nome; 8 planos/specs só de UI do editor em 2026-08-07→08-18 (`docs/superpowers/plans|specs/2026-08-0*-certificate-editor-*`).

---

## 8. Learning analytics (ADR-0008, DEC-DISC-009)

- **[F]** Eventos: `lesson_started`, `watch_checkpoint` (a cada **10%** da fronteira validada), `watch_progress` (segundos reproduzidos), `lesson_completed` (com origem manual/vídeo), `resource_open_failed`, `player_error` (`src/features/learning-analytics/rules.ts:3-24`; `schema.ts:248-262, 1114-1161`). Idempotência por chave textual (`courses/server.ts:2414-2432, 3095-3137`).
- **[F]** `player_error` **nunca é emitido** pelo código (grep: só enum e agregação em `learning-analytics/server.ts:212`); `resource_open_failed` só no download de material (`src/app/api/lessons/[lessonId]/resources/[resourceId]/download/route.ts:109`).
- **[F]** Agregação diária sem identificadores (`learning_analytics_daily_metrics`, `schema.ts:1163-1194`) pelo cron de manutenção; retenção 12 meses (brutos) / 13 meses (agregados) (ADR-0008:23).
- **[F]** **Para quem:** staff (Admin e Suporte por padrão têm `viewLearningAnalytics` e `exportLearningAnalytics`, `src/lib/auth-policy.ts:93-109`). Tela `/admin/aprendizagem`: Curso + período 1/3/6/12 meses; KPIs "Aulas no Curso", "Aulas com erro", "Aulas sem início", "Visualização média do Curso"; tabela por Aula (Inícios, Conclusões, Erros, tempo reproduzido); sheet com versões históricas; **CSV** com neutralização de fórmulas (`src/app/(admin)/admin/aprendizagem/*`; `learning-content-and-progress.md:90-96`).
- **[F]** Aluno não tem dashboard analítico; vê progresso do Curso/Módulo. Staff vê "Progresso obrigatório: X de Y" na ficha do aluno (`src/components/admin/student-management-sheet.tsx:47-55`).
- **[F]** Opt-out em Configurações; ao desligar, apaga eventos brutos do aluno e exclui das consultas (ADR-0008:17-19). "Ratificação jurídica" concedida "pelo responsável de produto" (DEC-DISC-009, `docs/decisions.md:135`).
- **[F] Inconsistência de copy de privacidade:** a tela do aluno diz "Permite coletar métricas **anônimas** de uso" (`src/app/(student)/app/configuracoes/page.tsx:110`), mas o ADR fala em "eventos brutos **identificáveis**" (ADR-0008:19).
- **[F]** Sem reengajamento, sem lista nominal de inatividade (ADR-0008:21). Ideias avaliadas e não implementadas: "objetivo pessoal de estudo" (`advisor-plans/2026-09-21-student-study-goal-analysis.md:71-77`).

---

## 9. Banners, ajuda/FAQ/suporte, manutenção, configurações, dashboard

- **[F] Banners do dashboard:** `dashboard_banners` (imagem, link, texto do botão, ativo, ordem, blur) (`schema.ts:2464-2473`); 4:1, 1680×420, JPEG/PNG/WebP ≤ 5 MiB, crop no navegador, publicação privado→público, reconciliação de órfãos após 24 h (ADR-0002:22; `r2.md:262-286`); carrossel Embla com autoplay 6 s (`student-banners-carousel.tsx:44`). Admin em Configurações > Plataforma.
- **[F] Mídia da tela de login (ADR-0015):** até 5 slides 8:7 WebP 1200×1050, autoplay 6 s com pausa, não renderizada em mobile, fallback local (`schema.ts:2475-2500`; ADR-0015:17-28).
- **[F] FAQ:** `faq_items` global (pergunta, resposta, ordem, publicado), sem vínculo a Curso (`schema.ts:2146-2157`); CRUD + reordenação em Configurações (`features/admin/actions.ts:992-1155`).
- **[F] Ajuda:** `/app/ajuda` = FAQ + diálogo "Falar com suporte" (`src/app/(student)/app/ajuda/page.tsx`); rota antiga `/app/perguntas-frequentes` redireciona (`next.config.ts:112-116`; `loading.tsx` órfão permanece).
- **[F] Suporte:** `support_requests` (assunto ≤160, mensagem ≤1800, curso opcional), **3 por 10 min** por usuário sob advisory lock, outbox `email.support-request` para a equipe (`src/features/support/server.ts:6-90`); retenção 90 dias (DEC-DISC-008). Não há inbox/atendimento no Hub. Pesquisa de central de ajuda: `design-plans/2026-09-24-help-center-self-service-contact-research.md`.
- **[F] Manutenção:** env `APPLICATION_MAINTENANCE_MODE=full|off`; proxy reescreve GET/HEAD para `/manutencao` (503) e responde JSON 503 com `Retry-After: 3600` para mutações/`/api/*`, exceto health e `/api/cron/*` (`src/lib/maintenance-mode.ts:7-37`; `src/proxy.ts:12-34`). **[I]** Webhooks (Asaas/Resend) recebem 503 durante manutenção e dependem do retry do provider.
- **[F] Configurações do aluno:** perfil/conta + switch de analytics (`configuracoes/page.tsx:26-120`). Sem meta de estudo, sem preferências de reprodução (autoavanço/legenda/velocidade).
- **[F] Dashboard do aluno:** saudação contextual (`getStudentDashboardGreeting`), card "Continue aprendendo", carrossel de banners, seções "Cursos concluídos", "Acesso requer suporte", catálogo "Disponíveis agora"/"Em breve" com interesse, diálogos de compra e de inscrição gratuita (`src/app/(student)/app/(dashboard)/page.tsx:63-253`).
- **[F] E-mails ligados à aprendizagem:** `access-released`, `access-expiry-warning` (7 d e 1 d antes; `schema.ts:854-855`), `certificate-issued`, `course-sales-opened` (`schema.ts:200-226`).

---

## 10. Rotas e telas

### 10.1 Aluno (`src/app/(student)/app`)
| Rota | Função |
|---|---|
| `/app` | Dashboard (continuar, banners, meus cursos, concluídos, acesso que requer suporte, catálogo, interesse, compra/inscrição gratuita) |
| `/app/cursos/[courseId]` | Overview: progresso, módulos com estado (concluído/bloqueado por sequência/data), painel de certificado; `?preview=aluno` para Admin; `?certificate=issued` |
| `/app/aulas/[lessonId]` | Workspace da Aula: player JMVStream (ou "Vídeo em configuração"/processando), texto TipTap renderizado, materiais (download/preview assinados), "Concluir aula", próxima/anterior, outline lateral e navegação móvel, modo foco, comentários |
| `/app/certificados` | Arquivo de certificados (preparando/pronto/falhou/revogado, histórico) |
| `/app/certificados/[code]/pdf` | Download autenticado |
| `/app/ajuda` | FAQ + suporte |
| `/app/configuracoes` | Conta + privacidade (analytics) |
| `/app/checkout/sucesso` | Espera de liberação de acesso pós-pagamento |
| Públicas | `/certificados/[code]` (+ `/preview`, `/pdf`), `/comprar/[slug]`, `/checkout/{sucesso,cancelado,expirado}`, `/manutencao`, `/politica-de-privacidade` |

### 10.2 Admin/Suporte (`src/app/(admin)/admin`) — menu filtrado por permissão (`admin-sidebar-nav.tsx:26-40`)
| Rota | Função |
|---|---|
| `/admin` | Painel (métricas, filas, falhas de vídeo, últimos comentários) |
| `/admin/aprendizagem` | Analytics por Curso/Aula/período, versões, CSV |
| `/admin/cursos` | Lista e criação de Curso (título, preço, etc.) |
| `/admin/cursos/[courseId]` | Abas **Visão geral / Conteúdo / Alunos / Configurações / Certificado** (`course-management-tabs.tsx:29-33`): course builder com drag-and-drop de Módulos/Aulas, D+N por Módulo, obrigatória/opcional, Preparar/Publicar/Descartar alterações, disponibilidade e link `/comprar/<slug>`, preço/pagamento/duração, carga horária override, capa, signatário, editor de certificado |
| `/admin/cursos/[courseId]/aulas/[lessonId]` | Editor de Aula: título, descrição, vídeo (upload multipart JMVStream ou link/iframe colado, detector de duração), editor TipTap (StarterKit h1–h3, Link, Placeholder, Typography — `src/features/courses/rich-text-extensions.ts`), anexos R2 (até 15, 150 MiB cada, 750 MiB por Aula), comentários da Aula; read-only fora do rascunho |
| `/admin/alunos` (`/admin/alunas` redireciona) | Lista paginada; ficha (sheet) com matrículas, estender/definir/ajustar expiração, bloquear/restaurar acesso ao Curso, liberar conteúdo integral, bloquear plataforma, emitir/revogar/reemitir certificado |
| `/admin/operacao`, `/admin/operacao/cursos/[courseId]/alunas` | Saúde JMVStream (uploads/exclusões/pastas), DLQ outbox, webhooks; diagnóstico de alunos por Curso (Suporte) |
| `/admin/equipe`, `/admin/financeiro`, `/admin/auditoria`, `/admin/configuracoes` (perfil, certificados/emissor, plataforma: mídia de login, banners, FAQ), `/admin/configuracoes/design-system` | Demais áreas |

### 10.3 Fluxos de staff e lacunas
- **[F]** Autoria só em rascunho; salvar Aula bloqueado enquanto há anexo enviando (`r2.md:172-173`).
- **[F]** **Preview do aluno** só para Admin (`isPreviewRole`, `src/features/courses/preview.ts:9`), mostra o rascunho primeiro (`courses/server.ts:1585-1586`), não grava progresso ("Preview sem progresso", `page.tsx:1177-1190`).
- **[F]** **Sem matrícula manual por UI**: `createManualAccessGrant` (`src/features/enrollments/server.ts:537-591`) só é chamado por scripts (`scripts/bootstrap-student.ts:19`, seeds E2E); doc: "`manual` ... usada pelo bootstrap local" (`commerce-and-access.md:171-172`). O script tem senha default hardcoded para uso local (`scripts/bootstrap-student.ts:27`).
- **[F]** A persona "Especialista" (PRODUCT.md:23) não tem papel; autoria é Admin ou Suporte com grant `manageCourseContent` (`schema.ts:416-430`; `auth-policy.ts:58-139`).

---

## 11. R2 / storage e pipeline de imagens

- **[F]** Dois buckets: privado (origem, materiais, uploads, PDFs) e público (cópias publicadas de capa/banner/mídia de login) com `publishR2Object` copiando privado→público (ADR-0002:15-25). Staging reutiliza buckets de Development com prefixo `staging/` (`r2.md:37-47`).
- **[F]** Imagens administrativas: PUT assinado de 10 min direto ao privado, referência temporária ligada a Admin+finalidade (`staged_admin_image_uploads`, `schema.ts:2352-2390`), confirmação por HEAD, normalização server-side com **Sharp**, limpeza após 24 h (`r2.md:79-113`).
- **[F]** Materiais de Aula: sessão persistida (`staged_lesson_resource_uploads`, `schema.ts:2392-2451`), PUT com `If-None-Match: *`, retry com reemissão de URL, fallback server-side só ≤ 4 MiB, cópia para `resources/published/` na publicação com `CopySourceIfMatch`, tombstones para impedir ressurreição de chaves (`r2.md:115-202`; migration `0105`). Tipos: csv, doc(x), jpg/png/webp, pdf, ppt(x), txt, xls(x), zip; preview WebP 320×180 ≤ 180 KB (`src/features/storage/r2-objects.ts:1-31`). Download por GET assinado de 5 min.
- **[F]** Crop no navegador com `react-easy-crop` em **5 diálogos distintos** (avatar, mídia de login, banner, template de certificado, capa) (`grep react-easy-crop`).
- **[F]** Cache: privado `private, max-age=240`; público `public, max-age=3600, immutable` com chaves versionadas (`r2.md:95-100`).
- **[F]** Dores: série de ~10 PRs em 2 dias para upload de materiais (#158–#174: resiliência, corpo "replayable", CSP, `Content-Type` fora da assinatura, aula só com anexo) e PR #85 (fallback quando PUT direto falha); PR #248 (+24k) para proteger propriedade de assets e ciclo de publicação.
- **[I]** Sharp/librsvg/PDFKit são dependências Node nativas — não rodam em Workers. Toda normalização/blur/PNG/PDF precisa de outro caminho na vNext (browser crop + validação de bytes no Worker, Images Transformations, Browser Run).

---

## 12. PWA / offline

- **[F]** **Não existe**: nenhum `manifest`/`*.webmanifest`, service worker, `navigator.serviceWorker`, `next-pwa`/Serwist/Workbox (busca em `src`, `public`, `next.config.ts`, `package.json`). Só favicons, `apple` icon 96×96 e `themeColor` (`src/app/layout.tsx:30-62`). Nenhum documento menciona PWA/offline como requisito.
- **[I]** O PWA offline da vNext (B7) é capacidade **nova, sem dado de uso ou demanda registrada no legado**; deve ser tratado como aposta de produto e entregue por último/atrás de flag.

---

## 13. Regras de negócio implícitas (código > ADR) e edge cases cobertos

### 13.1 Regras implícitas relevantes
| # | Regra | Evidência |
|---|---|---|
| 1 | Conclusão exige Matrícula `active`, `starts_at <= now`, `expires_at >= now`, Curso `active`, publicação `published`, Módulo e Aula `active` | `courses/server.ts:2303-2318` |
| 2 | Aula concluída fica acessível mesmo se D+N/sequência mudarem; a busca da próxima Aula avança e só reinicia no fim | `rules.ts:79-134` |
| 3 | Percentual do Curso arredondado (`Math.round`); percentual de vídeo truncado (`Math.floor`) para nunca mostrar 100% antes do fim | `rules.ts:47-48, 284-287` |
| 4 | Salto > 30 s sem evento `skip` também é tratado como seek | `rules.ts:213-229` |
| 5 | Vídeo identificado só publica com duração > 0; link manual publica sem duração e fica só com conclusão manual | `authoring.ts:651-709`; `jmvstream.md:199-203` |
| 6 | Hash JMVStream não pode ser associado a duas Aulas ativas; exclusão protege hashes/players referenciados por publicação `published`/`retired`, inclusive de outro Curso | `schema.ts:824-829`; `jmvstream.md:89-121` |
| 7 | D+N máximo < meses de acesso × 28 dias; verificado ao publicar com vendas abertas e ao abrir vendas | `module-content-release.ts:4, 82-111`; `availability-server.ts:239-244` |
| 8 | Curso com histórico comercial não volta a Rascunho/Em breve | `availability-server.ts:211-220` |
| 9 | Preço 0 ou ≥ R$ 10,00 (piso comercial do Hub, não do Asaas) | `schema.ts:534-537`; `docs/reviews/2026-10-03-course-pricing-mode-ux-research.md` |
| 10 | Interesse notificado não rearma | `availability-server.ts:512-541` |
| 11 | Comentário: 2000 chars, resposta só a comentário raiz, mesma discussão | `comments/rules.ts:3, 62-86` |
| 12 | Suporte: 3 pedidos/10 min, 160/1800 chars | `support/server.ts:6-9` |
| 13 | Consulta pública de certificado: 20/min/IP | `public-rate-limit.ts:7-8` |
| 14 | Carga horária = vídeo + texto a 260 ppm, override inteiro ≥ 0 | `lesson-duration.ts:3`; `workload.ts:8-38` |
| 15 | Anexos: 15/Aula, 150 MiB cada, 750 MiB total; tipos allowlist | `r2-objects.ts:1-31` |
| 16 | Avisos de expiração 7 d e 1 d antes, uma vez cada | `schema.ts:854-855`; `features/enrollments/maintenance.ts:176-189` |
| 17 | Admin preview lê o rascunho e não grava nada | `preview.ts:56`; `courses/server.ts:1585-1586` |
| 18 | Analytics nunca altera acesso/progresso/certificado; falha de coleta é engolida (`.catch(() => undefined)`) | `courses/server.ts:2392-2398, 3106-3136` |

### 13.2 Testes relevantes (edge cases)
- Progresso/sequência/vídeo: `src/features/progress/rules.test.ts:15-362` (opcionais antes/entre/depois, frontier, skip, legado, retomada); `src/features/videos/jmvstream.test.ts:15-209`; `src/components/lesson-video-player.test.tsx:143-277`.
- Publicações: `src/features/courses/publication-continuity.integration.test.ts:39` (watch compatível e sessão antiga rejeitada); `src/features/admin/course-publication-release-policy.test.ts:22-83`; `src/features/admin/authoring.integration.test.ts:48` (corrida na criação de Módulo); `src/db/course-publication-migration.test.ts`.
- Drip: `src/features/courses/module-content-release.test.ts:18-280`; `src/features/courses/content-release.integration.test.ts:65-587` (fail-closed em workspace/comentários/watch/conclusão; revogação concorrente; digest de checkout); `src/features/enrollments/content-release.integration.test.ts`.
- Certificados: `src/features/courses/certificate-issuance.integration.test.ts:380-1150`; `src/features/certificates/*.test.ts` (templates, rendering, código, rate limit, reconciliação de artefatos).
- Discussão: `src/features/comments/discussion-continuity.integration.test.ts:35`; `src/features/comments/rules.test.ts:28-120`.
- Gratuito: `src/features/enrollments/free-enrollment.integration.test.ts:418-823`.
- Analytics: `src/features/learning-analytics/server.test.ts:23-212`.
- E2E: `tests/e2e/critical-journeys.spec.ts:667-1516` (aula com grant, módulos agendados, sequência, conclusão avança, última aula emite/renderiza/entrega/valida certificado, certificados públicos válido/revogado, PDF só valid+ready, ficha admin) + `accessibility.spec.ts` (axe) + `keyboard-accessibility.spec.ts`.
- **[F]** Fragilidade: 14 testes `*source*.test.ts` e ~80 arquivos de teste com `readFile`, parte inspecionando texto-fonte (`plans/README.md:84` já apontava "28 dos 73 arquivos de teste inspecionam texto-fonte"; review de drip P2 "cobertura SQL acoplada ao texto-fonte").

---

## 14. Dores, bugs, retrabalho; sobreengenharia vs essencial

### 14.1 Retrabalho documentado
- **Versionamento:** fixado→vivo em 24 h; 8 achados na sprint; `curriculum_key` como remendo; ADR-0014 e ADR-0018 como remendos de segunda ordem (§2).
- **Vídeo:** ranges→máximo→fronteira linear; limiar 95/98/100; `end` sem limiar; toast vs recomendação inline; nunca testado no player real (§4).
- **Tipos de Aula:** `lesson_type` (com `presentation`, `bonus`) → `content_json` → Aula dinâmica sem tipo (migrations `0015`, `0016`, `0018`).
- **Signatário:** global com fallback por campo → por Curso sem fallback, colunas legadas mantidas (§7.3).
- **Código do certificado:** `PRT-...` → Base64URL (§7.2).
- **Uploads de materiais:** ~10 PRs em 2 dias (§11).
- **Drip:** 2 PRs gigantes + remediação + rollout em 2 fases (§3.1).
- **Termos:** "Alunas" → "Alunos" com redirects (`/admin/alunas`, PR #217).

### 14.2 Sobreengenharia (alto custo, baixo valor para "poucos alunos")
- **[I]** Clonagem física de publicação + `curriculum_key` + projeção de watch + identidade de discussão denormalizada, para um produto que decidiu currículo vivo.
- **[I]** Fronteira linear anti-seek com sessão/sequência/token e transferência entre publicações, enquanto a conclusão manual sem mínimo está sempre disponível (§4.3).
- **[I]** Editor de certificado por coordenadas com paridade de renderer PDF/PNG, fontes empacotadas, overflow/overlap, 39 documentos (§7).
- **[I]** Locks globais (`jmvstream-video-lifecycle`, `lesson-resource-lifecycle`) serializando todo ciclo de vida de mídia de todos os Cursos (`src/features/jmvstream/asset-lifecycle.ts:13`; `src/features/storage/lesson-resource-lifecycle.ts:15`).
- **[I]** Volume de processo: PRs de +18k a +68k linhas, ~78k linhas de markdown, auditorias e "requalificações" sucessivas.
- **[I]** Arquivos de 3–4k linhas com ~1000 SQLs crus apesar do Drizzle — difícil revisar e testar isoladamente (o próprio review de drip registrou "server.ts de Cursos cresceu demais").

### 14.3 Essencial (provou valor ou protege dinheiro/direito)
- **[I]** Separação Concessão (direito) × Matrícula (projeção); autoinscrição gratuita sem Pedido.
- **[I]** Opcionais não bloqueiam e não entram no denominador; Aula concluída sempre revisável.
- **[I]** `CourseCompletion` histórica única e certificado por snapshot imutável; emissão só pelo vencedor da inserção; revogação/reemissão auditadas; validação pública mínima por código opaco.
- **[I]** D+N simples calculado por requisição, sem cron; regra monotônica após matrículas agendadas; override integral auditado.
- **[I]** Disponibilidade em dimensões (entrega ≠ vitrine ≠ vendas) — acesso adquirido sobrevive a pausas.
- **[I]** Upload direto (presigned) com confirmação HEAD; buckets privado/público; LQIP.
- **[I]** Server-side authority: validar evento de vídeo, origem do `postMessage`, duração persistida.

### 14.4 Contradições/drifts encontrados (útil para não herdar)
- `learning-content-and-progress.md:106` "não há drip" vs ADR-0010 implementado.
- ADR-0003 (64 MiB) vs `upload-config.ts` (16 MiB até 1 GiB).
- Cron JMVStream: 30 min (`jmvstream.md:84`) vs 15 min (`release-state.md:86`) vs 5 min (`release-state.md:129`) vs `vercel.json` `15,45`.
- Plano 013 (Suporte modera) vs ADR-0017 (só Admin).
- Copy "métricas anônimas" vs "eventos brutos identificáveis".
- Decisão D1 (versão por coorte) vs ADR-0007 v2 (vivo).

---

## 15. Lições para a vNext

Alinhado às decisões já aprovadas da vNext (B1, B2, B5, B6, B7, B9 em `docs/planning/09-registro-de-decisoes.md`), com o que o legado ensina.

### MANTER (regras com evidência de valor)
1. **Opcionais não bloqueiam nem compõem conclusão**; obrigatória anterior pendente bloqueia; Aula concluída sempre revisável; "próxima Aula" procura à frente e só reinicia no fim (`rules.ts:79-134`). Portar os casos de `rules.test.ts:43-160` como testes de contrato.
2. **`CourseCompletion` histórica única por Aluno+Curso**, emissão de certificado **só pela transação que insere a conclusão** (`INSERT ... ON CONFLICT DO NOTHING RETURNING`), lock por Conta+Curso; regressão do plano 002 como teste obrigatório.
3. **Certificado por snapshot imutável** + SHA-256 + objeto privado + código opaco 16 bytes Base64URL + rate limit na validação pública + revogação com categoria padronizada e detalhe interno + reemissão que cria novo código.
4. **D+N por Módulo calculado por requisição** (sem cron de desbloqueio), âncora = aplicação da Concessão, regra monotônica após primeira matrícula agendada, override integral auditado, snapshot+digest do cronograma no checkout.
5. **Disponibilidade em dimensões** (entrega ≠ vitrine ≠ vendas); acesso adquirido sobrevive a pausa; arquivar bloqueia entrega.
6. **Gratuito sem Order/Checkout/provider**, idempotente, com reativação explícita de expirado e sem reativar revogado/bloqueado (portar `free-enrollment.integration.test.ts`).
7. **Fronteira de confiança do player**: aceitar só eventos de origem/janela exatas, validar faixa, usar duração persistida como autoridade, idempotência por sessão/sequência simples.
8. **Upload direto presigned** com confirmação HEAD de tipo/tamanho, PUT condicional `If-None-Match: *`, privado por padrão, cópia/publicação explícita para público, LQIP.
9. **Discussão por identidade pedagógica estável** (Lesson estável na vNext resolve sem `curriculum_key`), moderação auditada sem guardar corpo na auditoria, ocultar pai oculta respostas para aluno.
10. **Preview do aluno para staff sem gravar progresso.**

### RETIRAR
1. **Clonagem física de Módulos/Aulas por publicação**, `curriculum_key`, lateral joins de conclusão por chave e projeção de watch entre publicações (já vetado na vNext). Usar Lesson/Module com IDs estáveis + revisões imutáveis referenciadas pelo `CourseRelease`.
2. **Fronteira linear anti-seek**, tokens de sessão de watch, `awaiting_playback_after_seek`, `linear_progress_blocked`, `tracking_version`, ranges. O legado provou que não protege nada enquanto houver conclusão manual livre, nunca foi verificado no player real e gerou UX de toast confusa.
3. **Colunas e enums vestigiais**: `lessons.is_published` + status duplicado; `video_provider` sem adapter; `jmvstream_folder_type='module'`; `player_error` nunca emitido; colunas de signatário em `app_settings`/templates.
4. **Locks globais** de ciclo de vida de mídia; preferir lock por agregado (Curso/asset) e constraints.
5. **PNG de preview de certificado persistido** e **download público do PDF** (vNext B6 já decide).
6. **CSV de analytics** e opt-out de fatos operacionais (vNext B9 já decide) — e não repetir copy "anônimas" para dados identificáveis.
7. **Dependências Node nativas no caminho crítico** (Sharp, librsvg, PDFKit, Fontconfig): incompatíveis com Workers.
8. **Autoavanço imediato sem opt-in** (legado `router.replace` no `end`): vNext já define opt-in default OFF e só em `ended` confiável.

### SIMPLIFICAR
1. **Publicação de conteúdo:** permitir editar a revisão em rascunho de uma Aula sem clonar o curso inteiro; publicar = apontar `CourseRelease` para revisões. Oferecer "restaurar como novo rascunho" (lacuna do legado). Correção de digitação não deve exigir ciclo completo.
2. **Progresso de vídeo:** um único número monotônico por (User, Lesson) — maior posição/segundos assistidos aceitos com cap de delta por heartbeat — + posição de retomada; conclusão no threshold do Course (90%). Heartbeat **leve** (sem recarregar o workspace inteiro nem lock da matrícula a cada 10 s; o legado faz isso em `courses/server.ts:3176-3187`). Decidir explicitamente se existe conclusão manual em Aula com vídeo — se existir, qualquer anti-seek é teatro.
3. **Duração do vídeo:** obter do provider (API/webhook/capability), não do formulário da autora; detector no browser apenas como fallback declarado.
4. **Certificado:** template HTML/CSS controlado com poucos slots e preview pelo mesmo renderer (Browser Run) elimina paridade PDF/PNG, fontes, overflow por coordenadas e boa parte dos 17k linhas/39 documentos. Manter "editor visual contido" (B6) no menor escopo possível.
5. **Crop de imagem:** um componente de crop parametrizado por preset (proporção/dimensão/limite) em vez de 5 diálogos.
6. **Storage pipeline:** browser gera master recortado + validação de bytes (magic number, dimensão, tamanho) no Worker; variantes via Images Transformations; reconciliação de órfãos única e genérica por prefixo.
7. **Status de Aula/Módulo:** um único eixo (presente na revisão publicada ou não).
8. **Docs/processo:** documentos curtos por decisão; evitar planos de 2,5k linhas por feature; testes comportamentais em vez de inspeção de texto-fonte.

### ADICIONAR (lacunas reais do legado)
1. **Matrícula/concessão manual por staff na UI** (cortesia, bolsa, correção), com motivo e auditoria — o legado só tem script local.
2. **Adapters de vídeo com capabilities verificáveis** (vNext: JMVStream, Panda, Stream, Mux, YouTube, Vimeo): duração, eventos `ended`/tempo, thumbnail, proteção (token/domínio). Antes de portar JMVStream, **testar o player real** (eventos, `jump`, `ended`) — o legado nunca fez isso. Registrar preço/limites do plano contratado.
3. **CourseInterest com ciclos** (rearmar após notificação; reabrir vendas avisa de novo).
4. **Notificação de resposta em discussão** (e-mail/in-app) para o aluno e fila mínima para staff; paginação da thread; edição/remoção pelo autor com janela curta.
5. **Quiz** (novo; legado decidiu "sem avaliações"): definir já se aprovação compõe conclusão/certificado e atualizar a promessa do certificado ("comprovante de conclusão" vs "de aprovação"). Tentativas append-only como recomendado em `plans/README.md:417-418`.
6. **Sequência `guided|free` por curso** (não existia; sempre guiada).
7. **PWA offline Student** (não existia): tratar como capacidade nova de maior risco, entregar por último, com testes de troca de usuário/logout/lease.
8. **Preferências de reprodução do aluno** (autoavanço opt-in) e copy persistente/inline de regras de conclusão (não só toast), conforme a pesquisa do próprio legado.
9. **Duração/carga horária com racional documentado** (o legado usa 260 ppm sem fonte).
10. **Verificação jurídica** de retenção de certificado revogado (legado 60 d com purge total; vNext 90 d) e da base de dados de progresso, com responsável jurídico — no legado a "ratificação" foi feita pelo responsável de produto.

---

## Anexo — comandos e limites

**Executados (read-only):** `git log`/`git show` (histórico de ADR-0007, `c6ac5679`, `0035`), `grep`/`wc`/`find`/`sed` no clone, `gh pr list --state all --limit 300`, `gh pr view` dos PRs #16, #146, #159, #172, #174, #205, #207, #209, #217, #233, #236, #237, #248, `gh issue list` (vazio).

**Não executado:** aplicação, testes, migrations, banco, chamadas a JMVStream/R2/Asaas/Resend. Portanto: não verifiquei comportamento em runtime, contrato real do player JMVStream, configuração de DRM/token no portal, nem dados de Production (número real de alunos/cursos). Afirmações sobre esses pontos vêm de documentação do próprio repositório e estão marcadas como tal.
