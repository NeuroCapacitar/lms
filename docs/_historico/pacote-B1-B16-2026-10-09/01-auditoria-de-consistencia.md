# 01 — Auditoria de consistência transversal B1–B16

**Data:** 2026-10-09 · **Escopo:** decisões de produto e arquitetura do Hub vNext, não auditoria de código vNext nem comprovação de ambiente Production. **Resultado:** decisões fundamentais coerentes após a aplicação das substituições abaixo; há riscos técnicos e comerciais que dependem de provas de implementação.

## A. Substituições com precedência inequívoca

| Anterior / referência antiga | Decisão vigente | Impacto de implementação |
|---|---|---|
| `CoursePublication` materializada por clones + `curriculum_key` legada | **`CourseRelease` com revisões imutáveis de Module/Lesson e identidades estáveis** | O nome antigo aparece ocasionalmente em resumos B16; não criar o modelo clonado anterior. Usar `CourseRelease` como terminologia de domínio e documentar eventual nome físico escolhido. |
| Cloudflare **Images Hosted**, Direct Creator Upload | **R2 canônico**, presigned PUT, confirmação/validação, master editado, Images Transformations Free para variante pública com fallback estático | Reescrever B5/B12/B15 nas especificações; preservar limites público/privado, lifecycle e backup. `IMG-R1..R6` prevalecem. |
| GitHub Pro recomendado antes de Production | **GitHub Free privado pessoal** durante toda v1 | CI útil, porém sem enforcement nativo de required checks/branch protection nem Environment Secrets de privado; Production usa publicação administrativa controlada fora de workflows comuns e segredos separados. |
| Workers Free até teste; Images Hosted Paid | **Workers Paid US$ 5/mês de base; Images Hosted US$ 0** | Paid é escolha de lançamento, não limite absoluto de despesa. R2, Queues, Neon, Browser Run, Resend, Sentry, vídeo mantêm planos/cotas próprios. |
| CodeQL em repo público; StepSecurity audit-only, CodeRabbit PR review | **Semgrep CE + Gitleaks + Socket + Renovate + Dependabot Alerts + zizmor + actionlint + Knip; CodeQL/Harden-Runner/CodeRabbit privados não contratados** | Política viável para repo privado e orçamento; sem fingir paridade entre ferramentas. |
| Biome + Ultracite | **Ultracite com Oxlint + Oxfmt** | Verificar compatibilidade e comportamento do formatter; não instalar Biome em paralelo. |
| TS6 (ou TS5) | **TypeScript 7 estável** | Verificação principal nativa; TS6 apenas se alguma ferramenta comprovar dependência da API programática antiga. |
| `@cloudflare/vitest-pool-workers` | **`@cloudflare/vitest-plugin`** | Usar Vitest 4.1+ e plugin oficial para runtime `workerd`. |
| React Email como fonte editorial | **Resend Hosted Templates** editáveis no dashboard | Contrato tipado de variables/alias no Hub, sem cópias editoriais concorrentes nem editor próprio. |
| Interesse de curso removido / leads no Hub | **`CourseInterest` interno autenticado v1**, reaberturas idempotentes; leads externos exclusivos Resend | Nenhum `CourseInterestLead`/formulário de landing externa no Hub. |
| Analytics `LearningEvent` genérico e opt-out do legado | **Métricas derivadas de fatos duráveis do domínio; sem firehose/toggle opt-out operacional** | Analytics de aprendizagem não é clickstream. Cloudflare Web Analytics e Sentry separados. |
| Vídeo conclusão em ~100%, fronteira linear e anti-seek | **Threshold Course default 90%; sem anti-seek; autoavanço apenas `ended` + opt-in** | É incorreto copiar a regra do legado; não confundir conclusão com navegação. |
| Next/Vercel com Server Actions | **React SPA + Vite + Hono num Worker, sem SSR/RSC/Server Actions** | Libera produção independente do legado; sem migração de código Next. |
| Ícones Hugeicons/Lucide, fontes Manrope/Geist | **Phosphor + Lexend Deca**, Geist Mono técnico | UI própria sobre shadcn Luma/Base UI; light/dark/system. |
| Graphify como gate de arquitetura; dependency-cruiser deferido | **dependency-cruiser como gate; Graphify exploratório opcional** | Regras devem verificar imports reais, sem CI de geração de grafos obrigatório. |

## B. Tensões e integrações que exigem cuidado

**B01 — Publicação curricular.** A nomenclatura `CoursePublication` reapareceu em resumos B16. O detalhamento do B2 aprovou `CourseRelease` em vez de clones de CoursePublication; consolidamos a semântica mais específica, sem inventar uma migração. Verificar no momento da modelagem os nomes SQL definitivos e suas FKs; não tratar alias como nova aprovação.

**B02 — Certificado público versus documento privado.** A vNext tem página pública de verificação mínima por código opaco/QR e preview autorizado pelos dados permitidos. **PDF definitivo em R2 privado**, acesso por autorização. Não copiar a política do legado de download público assinado se ela contrariar a especificação vNext. A PWA pode oferecer PDF previamente obtido por usuário elegível, mas o arquivo externo salvo por ele não é revogável remotamente.

**B03 — Imagens R2 public/private.** Mudança IMG-R elimina Hosted e a premissa B5 de 'sem R2 público'. Capas/banners publicados exigem origem pública e CDN controlada; assinatura institucional e arte privada de certificados continuam em bucket privado. Imagens privadas não podem depender de URL pública de transformação nem de cache compartilhado com dados de acesso.

**B04 — Privacidade offline.** Lease `min(entitlement.endsAt, lastVerifiedAt+72h)` restringe experiência do app em cliente honesto, mas não é DRM e não permite apagar cópias pessoais já obtidas. Revogações na conexão, cache por User, purge em logout e idempotência no sync.

**B05 — Compra não equivale a pagamento.** Checkout hospedado Asaas não confirma direito de acesso. `Order`, `CheckoutSession` e `Payment` distintos; concessão apenas com evidência financeira segura. Webhook recebido ≠ efeito concluído; inbox/outbox + Queue + reconciliação. Retry de provider com resultado ambíguo é perigoso.

**B06 — Sem transação distribuída.** DB + R2 + Resend + Asaas + vídeo não participam de uma única transação. DB é autoridade para intenção e estado; I/O externo após commit; verificação e compensações/reconciliação quando resultado desconhecido.

**B07 — Worker + PWA antigos coexistindo.** Contract adjacente no HTTP, payloads de Queue e schema. Queue TTL não define horizonte de compatibilidade: outbox Postgres e PWA podem durar mais.

**B08 — GitHub Free e segurança real.** Sem enforcement de PR em repo privado. Não confiar apenas em workflow dentro de branch que pode ser modificada. Identidade de release homologada, preflight local, credenciais privilegiadas separadas e auditoria são compensações, não controles de segurança equivalentes.

**B09 — Backups versus exclusões.** PITR e `pg_dump` restauram banco, não R2 nem providers. Restore pode recuperar certificado revogado ou reativar intenção já enviada. Executar reconciliação de revogações/exclusões/financeiro antes de retomar jobs. Retenção de 90 dias do PDF revogado e políticas LGPD precisam de validação jurídica.

**B10 — Resend/marketing.** CourseInterest interno não exige opt-in de marketing genérico para notificação funcional solicitada pelo aluno. `MarketingPreference` separado; contacts/segments externos apenas com opt-in, com tratamento de unsubscribe. Não reativar opt-out via reconciliação.

**B11 — Consentimento e analytics.** Progress/Order/QuizAttempt não podem ser eliminados por desligar telemetria; não criar toggle para fatos necessários de domínio. Eventos opcionais futuros precisam de política própria.

**B12 — WCAG versus motion.** Alvo WCAG 2.2 AA permanece; microtransições de baixo impacto sem adaptação automática a `prefers-reduced-motion` foram aprovadas, mas isso não suspende os critérios AA aplicáveis. Testar o produto real e corrigir eventuais violações AA.

**B13 — Recent reauth.** Originalmente centrada em refund e alterações de Admin/roles, depois detalhada para credenciais de integração; explicitar lista de ações protegidas por prova recente, não generalizar para cada operação de suporte.

**B14 — Backup isolado no GitHub Free.** B15-Q28 aprovou exceção controlada para repositório administrativo separado com credencial de **leitura** do PG e permissão limitada para gravar backup criptografado. Não transferir secrets de deploy/DDL/chave privada `age` a essa automação. Monitorar atraso/falha do agendamento.

## C. Status do checklist de auditoria

| Dimensão | Resultado documental | Gate ainda necessário |
|---|---|---|
| B1–B3 modelo do produto/Auth | Coerente após CourseRelease e CourseInterest | Testes de invariantes RBAC e linking |
| B4 financeiro | Coerente; risco alto | Sandbox Asaas + race/failure/reconcile matrix |
| B5/IMG mídias | Coerente após R2 | Prova de CDN, transformações gratuitas, upload seguro e autorização |
| B6 certificados | Coerente com PDF privado e snapshot | PoC Browser Run `/pdf`, paridade do editor, SHA e restore |
| B7 PWA | Contratos definidos | Safari iOS real, sincronização e lifecycle SW |
| B8 Resend | Domínios marketing/transacional separados | API hosted templates, webhook, supressão e quotas |
| B9/B13 analytics/observabilidade | Separação correta fatos/logs/RUM | Medir cardinalidade, retenção, PII e custo |
| B10 UI | Stack e meta AA claras | Avaliação visual com branding real, auditoria a11y |
| B11 stack | Definida; licenças e plugins voláteis | Spike React/Vite/TS7/Oxfmt/BetterAuth/workerd |
| B12 async | Resiliência coerente com DB durável | Fault injection, limites das 5 Queues/DLQ |
| B14 segurança/CI | Coerente para GitHub Free privado | Regras de scanner e verificação independente de release |
| B15 deploy/backup | Estruturado | Restore drill e cutover simulado |
| B16 DX/execução | Aprovado | Aplicar DoR/DoD em tarefas concretas |

## D. Lacunas que NÃO são licença para modificar o escopo

- **Identificadores físicos exatos e DDL:** este pacote define semântica, não assume FKs/indexes definitivos sem modelagem e testes. Nomes de arquivos, tabelas e rotas de exemplo não são decisões de negócio.
- **Preços, limites, elegibilidade:** revisar no momento de provisionar, pois planos externos podem mudar sem aviso. Base Workers Paid de US$5 não inclui outros produtos; custo total ainda não está medido.
- **Browser Run PDF:** validar Quick Action, compat date, requisitos de modo remoto, render estável e custo de geração. Sem fallback Gotenberg automático contratado.
- **Reauth Google/passkey:** fechar implementação que consiga provar autenticação recente para conta sem senha, sem aceitar mera renovação de sessão.
- **Bancos, backups e providers:** RPO e RTO são objetivos provisórios, não garantias. O teste trimestral real confirma recuperabilidade.
- **Direitos LGPD:** retenção de certificados revogados, backups, e-mails e auditorias necessita revisão jurídica antes de Production.
- **Cron/Queues/Neon:** confirmar limites de plano vigentes, throughput de reconciliação e impacto de wake-ups na franquia Neon.
- **DNS cutover:** registrar zona existente, subdomínios, roteamento do legado, callbacks OAuth/webhooks, certificados públicos, service workers e responsabilidades.
- **Dependências externas:** validar disponibilidade real de SDKs/adapters e mecanismos de sandbox para todos os seis providers; não declarar suporte a capability sem evidência.

## E. Provas documentais e limites da revisão

- Esta auditoria reconcilia **decisões aprovadas**, não linhas de código vNext. O repositório `NeuroCapacitar/hub` inspecionado é legado e não substitui uma revisão do futuro repositório novo.
- Handoff B1–B11 é reconstrução estruturada; a conversa subsequente aprovou B12–B16 e IMG-R. Não usar o campo 'pendente B12–B16' contido no handoff de 08/10 como estado atual.
- Fontes oficiais verificadas em 09/10/2026: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Images pricing](https://developers.cloudflare.com/images/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Neon Free atualização 2026-10-02](https://neon.com/blog/neon-free-plan-1-gb-per-project), [TS 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [Vitest Workers plugin](https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/), [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
