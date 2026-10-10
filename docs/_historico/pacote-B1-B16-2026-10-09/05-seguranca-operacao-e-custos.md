# 05 — Segurança, qualidade, deploy, backup, observabilidade e orçamento

## 1. Superfície de segurança e responsabilidades

**Browser não confiável.** Sessões Better Auth PG 7d rolling em cookies host-only/HttpOnly/Secure/SameSite=Lax; token nunca em localStorage/IndexedDB. Fluxo de OAuth com origem/callback explícitos. CSRF nas mutações Hono usando Origin/Fetch Metadata/Content-Type; webhooks provider não usam CSRF de browser, mas autenticação própria. No backend: `authenticate → require capability → authorize target resource → enforce state/invariants → transaction`.

**Recent reauth:** refund, papéis/capabilities/elevação Admin e troca de credenciais sensíveis de integração, conforme escopo aprovado. Prova recente real por método da conta; testar Google/passkey sem senha e suspensão/revogação durante janela curta; não aceitar 'cookie ainda válido' como prova.

**CSP/headers:** `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, origens dos providers estritamente controladas; `script-src`, `connect-src`, `img-src` e `frame-src` conforme adapters e componentes. Validar em Report-Only e depois aplicar. Headers dos **assets estáticos** não são automaticamente equivalentes a respostas **Hono**; testar os dois. HSTS somente após validar HTTPS de todos os subdomínios. Escape de rich text, links, HTML de PDF e iframe allowlist. Proteção anti-SSRF; nenhuma importação genérica de URL arbitrária.

**Upload:** MIME/extension allowlist não bastam; confirmar conteúdo real, dimensões, tamanho, propósito, ACL, chave opaca e referências. R2 público somente para assets realmente públicos. Render PDF sem rede arbitrária. Segredos de vídeo AES-GCM com key version, nonce único e master key por ambiente, sem retornar valor plaintext na UI.

**PWA:** minimizar IndexedDB, isolar User, limpeza de logout/troca de conta, lease limitado, sync idempotente. Criptografia local caseira não é solução para script comprometido nem dispositivo comprometido; documentar risco residual.

**Threat modeling:** documento curto por fluxo Auth, RBAC, financeiro, arquivos, certificados, offline e CI. Checklist OWASP ASVS como referência relevante, sem alegar certificação; testes adversariais em staging antes do Go/No-Go.

## 2. GitHub Free privado e cadeia de ferramentas

| Ferramenta | Papel | Condição |
|---|---|---|
| GitHub Actions | CI normal e Staging | GitHub Free, sem enforcement obrigatório de protected branches em repo privado |
| Semgrep CE | SAST | Regras curadas, baseline, bloquear alertas de alta confiança |
| Gitleaks | Secret scan | Histórico inicial, PR/commits e periódico; tokens vazados são rotacionados |
| Socket Free | Supply-chain | Alertas de malware/comportamento, permissões limitadas e franquia validada |
| Dependabot Alerts | Advisories | Manter; não gerar version updates duplicados |
| Renovate | Atualizações | Agrupar patch/minor, majors separados, automerge excepcional |
| Knip | Código/dependências mortos | Modes normal/production e entrypoints do Worker/Router explícitos |
| dependency-cruiser | Limites arquiteturais | Regras bloqueantes de imports/ciclos |
| actionlint/zizmor | Segurança YAML Actions | SHA pinning, permissões mínimas, PRs sem secrets privilegiados |
| Scorecard CLI | Saúde semanal | Informativo e sem code scanning pago |
| CodeQL/Harden-Runner/CodeRabbit | Fora do baseline privado | Não contratar na v1; revisão humana e testes prevalecem |
| Blacksmith / Graphify | Exploração futura/local | Só adotar mediante ganho demonstrado; Graphify sem upload de código por padrão |

**Limitação incontornável:** GitHub Free privado não oferece branch protection/rulesets com enforcement; Environment Secrets de repositórios privados e deployment approvals dependem de outras condições/planos. CI verde sozinho não força merge seguro. Publication de Production acontece em executor administrativo confiável, com identidade de revisão e secrets privilegiados **fora dos workflows comuns**. Conta GitHub com MFA/passkey e escrita restrita. O responsável confirma previamente a revisão homologada. Backups agendados usam exceção controlada: repositório **administrativo isolado**, secret somente leitura PG + R2 write limitado, sem DDL/deploy/chave `age` privada.

## 3. Fluxo de verificação

### PR comum

1. `bun install --frozen-lockfile` e versions pinadas da toolchain.
2. TypeScript 7, Oxlint/Oxfmt, types Wrangler sync, dependency-cruiser e Knip.
3. Testes Vitest Node, Worker workerd e PG18 descartável.
4. Semgrep + Gitleaks + audit/Socket relevantes.
5. Playwright smoke (jornada curta); relatório privado com retenção curta.
6. Hono/Cloudflare build, gerados sincronizados e `docs:check`.

### Release sensível

Executar suíte ampliada (financeiro/adversarial, migrations, segurança e E2E); verificar revision tree/artefato correto; fazer smoke Staging e preflight Production. Produção não é publicada automaticamente por `push` em `main`. Chaves privilegiadas não ficam no workflow comum. Rollback Worker somente quando versão antiga continua compatível com schema + mensagens.

### DoR e DoD

**DoR:** decisão e escopo, contratos, dependências, ambiente de testes, capacidade/ownership, testes e critérios de aceite claros. **DoD:** comportamento implementado, typing, tests, CSRF/RBAC quando aplicável, estados UX, acessibilidade, logs/audit, SQL revisado, docs quando contrato muda, CI verificado, evidência do aceite. `implemented` ≠ `verified` ≠ `homologated` ≠ `production_ready`.

## 4. Ambientes e release

- **Development:** local Vite/workerd + PG18 ou Neon projeto dev; fake provider por default, secrets locais apenas para dev.
- **Staging:** Worker, Hyperdrive, Neon projeto, R2 buckets, 5 Queues/DLQs, OAuth/sandbox, recipientes e secrets segregados, seed sintético. PR Previews opcionais sem consumers/Cron completos, jamais substitutos de Staging.
- **Production:** Worker próprio, Neon projeto próprio, recursos isolados; segredo runtime separado de DDL; migrações com conexão Neon direta. `CLOUDFLARE_ENV` resolvido no momento de `vite build`; preflight verifica bindings, secrets presentes, projeto/branch PG e dominios.
- Workflow release: `select approved revision → confirm staging → schema/preflight/backup → migration expand → build/upload production version → promote → smoke tests → monitor`. Contract migrations somente em release futura. Hotfix documentado, reconciliação `main`/`staging`, sem `force push`.
- **Legado:** permanecer em origem própria durante DNS/cutover; se nameservers mudarem, executar operação separada preservando registros. Webhooks financeiros, sessions, certificates e PWA legada não são automaticamente migrados. Após primeiras operações vNext, voltar DNS ao legado **não é rollback seguro**.

## 5. Dados e recuperação B15C

| Camada | Estratégia aprovada |
|---|---|
| Neon Free PITR | Janela curta (6h conforme plano verificado); recuperação recente, não backup independente |
| `pg_dump -Fc` | Backup lógico PG18 completo, cada 6h como cadência inicial |
| R2 | Backups `age` cifrados antes do upload; bucket exclusivo e manifesto verificável |
| Retenção escalonada | 48h frequentes, 14d diários, 4 semanas semanais; validar juridicamente |
| Imagens/artefatos | Inventário/cópia seletiva de masters R2 e PDF definitivo; vídeos conforme provider, sem duplicar tudo |
| Independência | Cópia fria semanal criptografada fora da Cloudflare |
| Restore drill | Trimestral em ambiente temporário isolado e sem efeitos de provider |
| RPO/RTO | RPO nominal ~6h; contingência inicial até 24h; RTO alvo 8h; **metas a demonstrar**, não garantias |
| Proteção pós-restore | Conciliação Asaas/Resend, revogações, exclusões LGPD, caches e media; bloquear effects até consistência |

A integridade do backup requer download + decriptação + `pg_restore` real e invariantes verificadas. Não basta ver um arquivo no bucket. `age` private key permanece fora de GitHub/Worker/R2, com cópias de custódia independentes. Para garantir que backups não 'ressuscitem' revogações e excluídos, manter evidências mínimas externas ao snapshot restaurado e processos de reconciliação; não afirmar restore atômico de Neon+R2+providers.

## 6. Observabilidade B13

- Wide event estruturado por HTTP/Queue/Cron (evlog), com poucos complementos; Workers Logs primário, Cloudflare Traces amostrados.
- Sentry erros significativos e releases/source maps privados; não duplicar expected errors ou logs inteiros. Cloudflare Web Analytics com coleta de performance LCP/INP/CLS, sem session replay ou URL sensível.
- Allowlist de atributos, paths normalizados, sem payloads/cookies/segredos/PII por default.
- PostgreSQL primeiro para métricas de negócio/analytics sem firehose. Operations Center Staff simples: inbox/outbox, Queue/DLQ age, financeiro, certificado, delivery, retries e reconciliação.
- SLI/SLO: saúde plataforma, sucesso técnico login, progresso, checkout, idade de operações financeiras, tempo de emissão de certificado. Baseline antes de prometer percentuais para tráfego pequeno.
- Alertas P0 financeiro/security, P1 auth/disponibilidade/finance, P2 degradação, P3 informativo. Health live superficial e readiness protegido. Runbooks Neon, Asaas, Resend, R2, Queue, render, privacidade e deploy.

## 7. Orçamento e critérios de upgrade

| Serviço | Planejamento | Risco e monitoração |
|---|---|---|
| **Workers Paid** | **US$ 5/mês base por conta** | Não é teto. CPU, requests e extras faturados conforme consumo. |
| **Images Hosted** | **US$ 0, não contratar** | R2 + transforms Free limitadas a 5.000 únicas/mês e fallback estático. |
| **R2 Standard** | Franquia de 10 GB-mês e operações no Free | Storage somado de anexos, PDF, imagens e backups, ops e lifecycle |
| **Neon Free** | 3 projetos separados; cada projeto com limite próprio | 100 CUh/projeto e 1 GB conforme oferta Out/2026; autosuspend/cron impactam |
| **GitHub Free** | Privado, minutos incluídos | Sem branch protections obrigatórias em privado; minutos excedentes |
| **Resend** | Tier compatível com volume atual | Envio, contacts/broadcast, quotas de marketing e entregabilidade |
| **Browser Run** | Verificar limites/custos do render `/pdf` | Picos de certificados, quotas e qualidade |
| **Sentry** | Começar no Free se volume permitir | Eventos/traces, sampling, fontes/PII |
| **Video providers** | Contas e custos próprios | Custo por vídeo, armazenamento, playback, API e features |

Fonte oficial: https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/images/pricing/ ; https://developers.cloudflare.com/r2/pricing/ ; https://neon.com/blog/neon-free-plan-1-gb-per-project . Revalidar antes de escolher planos. A cobrança base de Workers Paid é por conta e inclui Workers com múltiplos ambientes quando dentro dos limites, não US$ 5 por Worker.

## 8. Go/No-Go e primeiros 7 dias

**Bloqueadores:** Auth/OAuth/CSRF/RBAC inseguros; transição financeira indevida; migração schema divergente; falha de restore; documentos privados expostos; Queues/cron/reconciliação sem capacidade real; PWA vazando cache entre usuários; credenciais Prod em ambiente não confiável; links históricos críticos quebrados; alerta essencial desativado.

**Go:** deployment Staging da revisão exata aprovado; DNS/TLS/callbacks; contratos/providers e smoke Production seguros; backup íntegro e restore drill; documentos/ADRs/risco residual assinados pelo responsável. Durante 7 dias revisar diariamente erros, custos, Neon CPU, filas e operações pendentes, sem pressupor plantão 24/7.
