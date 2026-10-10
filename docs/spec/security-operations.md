# Segurança, qualidade, operação e custos

**Estado:** especificação vigente (2026-10-10); código não implementado.

Base: [registro do debate](../review/registro-do-debate.md) (autoridade) e [arquitetura](../architecture.md). Contrato de ambientes e release: [environment-and-release-safety.md](../operations/environment-and-release-safety.md). Números de preço e limites vêm de `docs/review/evidencias/` (W1, W2, W3) e devem ser revalidados antes de qualquer contratação. `PENDENTE (...)` = depende de spike do M0 ou de terceiro; nenhuma resposta foi presumida.

## 1. Superfície de segurança

**Princípio:** o navegador não é confiável. Em todo caso de uso: `autenticar → exigir capability → autorizar o recurso-alvo → validar estado/invariantes → transação`. Controle visual nunca é autorização.

- **Sessão e cookies.** Better Auth (versão exata), sessão em PostgreSQL, rolling 7 dias; cookie host-only, `HttpOnly`, `Secure`, `SameSite=Lax`; nenhum token em localStorage/IndexedDB. Cookie cache desligado (ou `maxAge` curto com bypass em operações sensíveis): revogação e suspensão têm de valer na próxima requisição. `trustedOrigins` só com origens reais (sem `localhost` em Production). Rate limit do Better Auth em `database` (não em memória), IP via `cf-connecting-ip`. Linking Google só com e-mail verificado; sem `trustedProviders`.
- **Magic link** (método base de todos; Staff só por ele). Página de confirmação antes de criar a sessão (anti-scanner de e-mail), uso único, expiração curta, resposta idêntica exista ou não a conta. Pedido protegido por **Turnstile** e limite por e-mail + IP; o contador crítico fica no PG (o binding de rate limit da Cloudflare é por localização e eventual, serve só de freio extra). Motivo adicional: o Resend Free tem 100 e-mails/dia, e links de login compartilham essa cota (ver §7). Risco residual aceito: acesso total da Staff por posse da caixa de e-mail (§11).
- **CSRF.** Middleware próprio para mutações JSON (`hono/csrf` só cobre content-types de formulário): exige `Content-Type: application/json`, valida `Origin` contra allowlist e `Sec-Fetch-Site`. Webhooks (Asaas, Resend) não usam CSRF de navegador; têm autenticação própria (token `asaas-access-token` em tempo constante; assinatura Svix sobre o corpo bruto).
- **Reautenticação recente.** Exigida para: reembolso, papéis/grants/convite de Staff, credenciais de integração e manutenção. Prova = novo magic link recente (`freshAge`), nunca "cookie ainda válido". Testar suspensão e revogação durante a janela.
- **CSP e headers.** `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `frame-src`/`connect-src`/`img-src` com as origens dos seis adapters de vídeo. Começar em Report-Only. **Assets estáticos e respostas Hono têm pilhas de headers separadas** (`run_worker_first: ["/api/*", ...]` e `_headers` para assets): testar as duas. HSTS só depois de validar HTTPS de todos os subdomínios. Meta tags injetadas por HTMLRewriter (curso, validação de certificado) são escapadas.
- **Uploads.** Presigned PUT; allowlist de MIME/extensão não basta: validar bytes reais, dimensões, tamanho e propósito; chave opaca; R2 público só para capas/banners. PDF de certificado renderizado de HTML/CSS controlado, sem rede arbitrária no render.
- **SSRF.** Nenhuma importação de URL arbitrária; chamadas de saída só a hosts fixos de providers. Sem iframe arbitrário.
- **Segredos de vídeo.** Credenciais de integração cifradas com AES-GCM: `key_version`, nonce único, chave-mestra por ambiente (secret do Worker), nunca devolvidas em claro na UI; rotação por versão.
- **PWA (Student).** Cache por usuário, limpeza no logout e na troca de conta, lease `min(entitlement, última verificação + 72 h)`, outbox offline allowlisted e idempotente. Criptografia local caseira não protege contra aparelho ou script comprometido: risco residual documentado. Gate de iPhone real antes de liberar o offline.
- **Entrada de terceiros.** Rich text Tiptap: JSON validado + render por allowlist. Texto de discussão nunca é HTML cru.
- **Threat model curto** (1 página por fluxo, no M0/antes de cada marco): auth/magic link, RBAC/grants, financeiro/webhook, arquivos/mídia, certificados, offline/PWA, CI/release. **OWASP ASVS** como lista de referência (sem alegar certificação). Testes adversariais em Staging antes do Go/No-Go: auth/RBAC (CSRF, XSS, sessão, acesso cruzado direto pela API); financeiro (evento duplicado/fora de ordem/preço alterado/reembolso concorrente/resultado incerto); PDF/R2 (autorização, integridade, escaping, SSRF); PWA (troca de usuário, logout, lease).

## 2. Repositório e CI

**Base:** GitHub Free, repositório **privado em conta pessoal**; migrar para organização Free se possível (transferência preserva o histórico). Sem Team (US$ 4/usuário) sem nova decisão.

**Limitações reais do Free privado** (evidência: W2 §8.1; todas lidas em 2026-10-09): sem branch protection/rulesets nem required reviewers; Environments e environment secrets ignorados; sem secret scanning/push protection; sem code scanning/CodeQL/upload de SARIF; sem dependency review; Dependabot sem security updates para Bun; secrets de organização inacessíveis a repositório privado. **CI verde não força merge seguro**; a barreira real é disciplina + processo manual de Production (§3).

**Controles compensatórios:** conta GitHub com MFA e escrita restrita; Gitleaks em CI e pre-commit; Renovate; push direto em `main` só pelo responsável; Production fora do GitHub (§3).

**Duas camadas de verificação:**

| Camada | Ferramentas | Efeito |
|---|---|---|
| Bloqueante | TypeScript (7.0.x), Oxlint + Oxfmt, Vitest unitário + PG18 real (`@cloudflare/vitest-plugin` para workerd), build real do Worker, Playwright de fumaça, **Gitleaks CLI** (sem `gitleaks-action`, que pede licença em organização), Knip, dependency-cruiser | falha impede merge por convenção |
| Consultiva | Semgrep CE (saída em console; SARIF não sobe em privado), actionlint e zizmor (`advanced-security: false`) ao mudar workflow, Renovate com espera de 7–14 dias | relatório; achado de alta confiança é triado, não ignorado |

**Retiradas:** Socket, Scorecard, Graphify, CodeRabbit, CodeQL, Harden-Runner. Renovate (Mend Community, gratuito em privado) é o gerenciador de dependências, com `bun.lock`; Dependabot só para alertas. Bun fixado (1.4.x, `packageManager`), Node 24 LTS para Wrangler e dependency-cruiser (extrator swc até o TS 7.1; `PENDENTE (spike M0-11)`). Tokens vazados são rotacionados, não só removidos. Backlog de risco: ver §11.

## 3. Fluxo de verificação e release

**PR comum:** `bun install --frozen-lockfile` → TypeScript, Oxlint/Oxfmt, `wrangler types --check`, dependency-cruiser, Knip → Vitest (unit, workerd, PG18 descartável) → Gitleaks → build do Worker → Playwright de fumaça.

**Release sensível** (financeiro, auth, migrations, certificados, PWA): suíte ampliada (adversarial, migrations em PG descartável com drift e locks, E2E) → deploy em Staging do SHA exato → smoke → preflight de Production.

**DoR:** ID/escopo, contratos, dependências, ambiente de teste, critérios de aceite. **DoD:** código + teste + estados de UX/acessibilidade + autorização no servidor + logs/auditoria + SQL revisado + doc só se o contrato mudou + diff relido. `implemented` ≠ `verified` ≠ `homologated` ≠ `released`.

**Staging:** deploy a partir de `staging` com token Cloudflare limitado. **Production é manual:** executada pelo responsável fora dos workflows comuns, com secrets de deploy/migration que não existem no GitHub. Sequência: confirmar SHA homologado em Staging → backup (`pg_dump` + `age`, §5) → preflight (bindings, secrets presentes, projeto Neon, domínios) → migration expand (conexão direta Neon, role de migration) → `vite build` com `CLOUDFLARE_ENV=production` → upload da versão → promoção → smoke → monitoramento. Contract migrations só em release seguinte. Rollback de Worker só se a versão antiga for compatível com schema e mensagens. Hotfix documentado, sem force push.

Regras técnicas fixas:
- `CLOUDFLARE_ENV` é escolhido **antes** do build do Vite Plugin; defini-lo em `wrangler deploy`/`vite preview` não tem efeito.
- **Workers Builds** (integração Git da Cloudflare), se usado, apenas com `wrangler versions upload`; nunca deploy automático para Production.
- Proibido `drizzle-kit push` em Staging/Production e DDL em HTTP/Cron. Migrations SQL revisadas à mão, forward-only.
- **Bot Fight Mode desligado** até testar webhooks Asaas (aplica-se ao domínio inteiro, sem escopo por path). WAF Free: 1 regra de rate limiting; usar com critério.

## 4. Ambientes

| Item | Development | Staging | Production |
|---|---|---|---|
| Runtime | Vite + workerd local | Worker dedicado | Worker dedicado |
| Banco | PG18 local ou projeto Neon Dev | projeto Neon Free próprio | projeto Neon Free próprio (São Paulo se o spike confirmar) |
| Acesso ao banco | direto | Hyperdrive (cache **desligado**, `pg` por requisição); migration por conexão direta | idem |
| R2 | recursos de teste | buckets e chaves próprios | buckets e chaves próprios |
| Queues | simuladas | `hub-finance` + `hub-general`, cada uma com DLQ | idem |
| Providers | fakes/sandbox | sandbox (Asaas, vídeo de teste) e destinatários controlados | live somente após Go/No-Go |
| Secrets | locais, nunca versionados | escopo Staging | fora do CI comum |
| Dados | sintéticos | sintéticos | reais; **nunca copiados para os outros** |

Workers Previews não substituem Staging (Cron, rotas e consumers de Queue não funcionam nelas); Version URLs e Previews são públicas por padrão e ficam protegidas. Sem branch Neon por PR. Nenhuma Production da vNext existe antes da v1 integral (big-bang). Possível regra da Neon de apagar projetos Free inativos (prazo e escopo **não confirmados** nas evidências; verificar na página de planos no provisionamento, spike M0-12): manter atividade periódica em Dev/Staging até confirmar.

## 5. Dados e recuperação

| Camada | Regra |
|---|---|
| Neon Free PITR | 6 h; recuperação recente, **não** é backup independente |
| `pg_dump -Fc` | diário e **antes de cada release**; cifrado com `age` antes do upload; manifesto com checksum |
| Armazenamento | bucket R2 privado exclusivo (conta contra os 10 GB do Free); retenção proposta: 14 diários + 4 semanais, a ajustar ao tamanho e a parecer jurídico |
| Cópia off-Cloudflare | semanal, cifrada; destino `PENDENTE (cliente)` |
| Ensaio de restauração | semestral **e** antes do Go-Live; baixar, decifrar, `pg_restore` e checar invariantes em ambiente temporário sem efeitos de provider |
| Metas | **RPO ≤ 24 h, RTO ≤ 8 h**: metas a demonstrar no ensaio, não garantias |

- A chave privada `age` fica fora do GitHub, do Worker e do R2, com custódia independente (≥ 2 cópias). Só a chave pública entra no automatismo.
- Execução: o dump diário exige agendamento. Se for GitHub Actions, usar **repositório administrativo isolado** (só se necessário) com secrets mínimos: role PG somente leitura, credencial R2 só de escrita no bucket de backup, chave `age` pública; sem DDL, sem deploy. Cron do GitHub atrasa (o legado viu 3h34–5h08): alerta se não houver backup íntegro há > 26 h.
- **Egress do Neon Free** (limite de 5 GB/projeto **não confirmado** nas evidências; verificar no provisionamento) pode limitar o dump diário: tamanho compactado × 31 + dumps de release não pode estourar. Medir no M0; é o terceiro gatilho prático de upgrade, junto com os do §7.
- **Pós-restore:** não liberar efeitos externos antes de reconciliar com Asaas (pagamentos/reembolsos), Resend (envios), revogações de acesso/certificado, pedidos de exclusão e caches/mídia. Não afirmar restauração atômica de Neon + R2 + providers.
- **Orçamento de acordar o Neon Free:** scale-to-zero de 5 min fixo; o Cron de reconciliação a cada 30 min acorda o banco ~48×/dia. Free tem 100 CU-h/projeto/mês; a conta (acordadas × tempo ativo × CU mínimo) é medida no `PENDENTE (spike M0-12)` e acompanhada em produção.
- **Gatilhos de upgrade do Neon** (qualquer um reabre a decisão de custo): banco > 600 MB (limite 1 GB); consumo > 70 CU-h/mês; **primeiro incidente de perda de dados**. Sem SLA no Free (§11).

## 6. Observabilidade

- **Logs:** um wide event estruturado por requisição HTTP/Queue/Cron via **evlog** (`PENDENTE (spike M0-18)`: maturidade; fallback = logger próprio equivalente). Workers Logs como base; Traces (beta) amostrados. Allowlist de atributos, rotas normalizadas; **sem payload, cookie, segredo, token de link ou PII** por padrão.
- **Cobrança por GB a partir de 2026-12-01** (W1 §I): Paid inclui 50 GB ingeridos + 10 GB-mês armazenados (logs e traces somados), excedente US$ 0,25/GB e US$ 0,10/GB-mês. Usar `head_sampling_rate`, desligar `invocation_logs` redundantes e acompanhar o consumo mensal; excedente é custo fora do teto e dispara decisão.
- **Erros:** Sentry Free ("Developer", 1 usuário; SDK 11, `@sentry/hono` em alpha: `PENDENTE (spike M0-18)`), source maps privados, scrubbing de PII, replay desligado ou mascarado. Só o responsável triaria; mais usuários = plano pago = nova decisão.
- **Web Analytics** da Cloudflare (LCP/INP/CLS), sem replay nem URL sensível.
- **Operations Center** (Staff, grant): inbox/outbox, idade de filas e DLQs, financeiro pendente, certificados, entregas de e-mail, retries, reconciliação, último backup. PG é a fonte da verdade; a DLQ apaga mensagens em 4 dias.
- **SLIs:** disponibilidade, sucesso de login/magic link, registro de progresso, checkout, idade de operação financeira pendente, tempo de emissão de certificado. SLOs só depois de baseline com tráfego real.
- **Alertas:** P0 dinheiro/segurança (pagamento sem reconciliar, webhook ausente, vazamento); P1 auth/disponibilidade/financeiro; P2 degradação (fila, e-mail, backup atrasado); P3 informativo. Health `live` superficial; `ready` protegido. **Sem plantão 24/7**: alertas por e-mail ao responsável; revisão diária de erros, custos, CU-h do Neon, filas e pendências **nos primeiros 7 dias**; depois, rotina semanal. Runbooks mínimos: Neon, Asaas, Resend, R2, Queue/DLQ, render de PDF, privacidade/incidente, deploy/rollback, restore.

## 7. Orçamento

**Teto de infraestrutura: US$ 10/mês** (Workers Paid US$ 5 + folga). Só o Workers Paid é custo certo; todo o resto fica em free tier. **Qualquer item pago exige nova decisão explícita**, nunca upgrade por padrão.

| Serviço | Plano na v1 | Gatilho / observação |
|---|---|---|
| Cloudflare Workers Paid | US$ 5/mês por conta (não por Worker) | inclui Queues, Hyperdrive, Browser Run (10 h), Logs; excedentes por consumo |
| Neon | Free × 3 projetos | §5: > 600 MB, > 70 CU-h/mês, incidente de perda, egress de backup |
| R2 | Free (10 GB) | somado: anexos, PDFs, imagens, backups |
| Images (transformações) | Free, 5.000 únicas/mês, fallback estático | Images Hosted: não contratar |
| Resend | Free (100/dia, 3.000/mês) | 60% da cota em 7 dias; Pro US$ 20 = decisão; verificar cota de broadcasts |
| Sentry | Developer (1 usuário) | mais pessoas: Team US$ 26 = decisão |
| GitHub | Free privado | Team (US$ 4/usuário) só se o risco de §2 for reavaliado |
| Renovate, Turnstile, Web Analytics | gratuitos | — |
| Observabilidade Cloudflare | incluída no Paid | GB excedente a partir de 2026-12-01 |

**Custo do cliente (fora do teto, decididos com ele):** provedores de vídeo (JMVStream, Panda, Cloudflare Stream, Mux; Vimeo/YouTube conforme conta), taxas do Asaas, registro de domínio, contador e advogado. O legado congelado mantém custos de Vercel até o desligamento (§11).

## 8. Jurídico e LGPD operacional

**Pré-requisitos de Go-Live (redigidos com o advogado do cliente; `PENDENTE (advogado)`):** termos de uso, política de privacidade, política de reembolso e canal do titular. O Hub implementa **aceite versionado** no cadastro (versão, data/hora, IP mínimo). Público declarado **18+**, profissionais de saúde e educação.

**Direitos do titular sem funcionalidade própria:** desistência (7 dias), exclusão, acesso/dados e troca de e-mail por **pedido por e-mail ao suporte**. Procedimento manual escrito para a Staff: verificar identidade pelo e-mail da conta, registrar pedido/decisão (auditoria), executar, responder. Referência de prazo (W3 §5.4): 15 dias para declaração simplificada e até 30 em dobro para agente de pequeno porte; **prazo interno `PENDENTE (advogado)`**. O procedimento precisa prever exportação dos dados (JSON/PDF) e eliminação executável pela Staff preservando o que o art. 16 da LGPD permite reter. Reembolso aprovado segue o fluxo financeiro (RefundRequest).

**Retenções** (propostas; todas `PENDENTE (advogado/contador)` antes do Go-Live):

| Dado | Regra proposta |
|---|---|
| PDF de certificado revogado | 90 dias, **CONDICIONAL** a parecer; o registro mínimo (código, status, hash, data, motivo) permanece para validação |
| Payload bruto de webhook | 30 dias, depois sanitizado |
| Logs de acesso/autenticação | Marco Civil art. 15 cita 6 meses (não relido, W3 §5.3): `PENDENTE (advogado)` |
| Dados fiscais/financeiros | referência de 5 anos; confirmar com contador |
| Logs de aplicação (Workers Logs) | 7 dias, sem PII (§6) |
| Registro de incidentes | ≥ 5 anos (Res. ANPD 15/2024, via fonte secundária) |

**Incidente:** comunicação à ANPD e aos titulares em até 3 dias úteis (6 para pequeno porte, mediante declaração) quando houver risco relevante (W3 §5.8, fonte secundária); runbook de privacidade define quem decide. **Transferência internacional** (Cloudflare, Neon, Resend, Sentry nos EUA; os DPAs lidos de Cloudflare e Resend não citam o Brasil): base e cláusulas `PENDENTE (advogado do cliente)`; minimizar dados enviados (Sentry com scrubbing, e-mail só nome/endereço). Discussões: aviso fixo proibindo dados identificáveis de pacientes, moderação e denúncia. Sem banner de cookies enquanto só houver cookies estritamente necessários e analytics sem cookies (confirmar; pixels de marketing ficam fora do Hub).

## 9. Domínio, DNS e cutover

Domínio: `app.neurocapacitar.com.br`; o responsável controla o registro. **Mover a zona DNS para a Cloudflare cedo (M0)**, copiando **todos** os registros (MX, SPF, DKIM, DMARC, verificações de provedores) antes de trocar nameservers; conferir e-mail funcionando depois da troca. Legado segue no ar apontando para a origem atual durante a transição.

**Cutover (M10), janela curta:** legado em manutenção → ETL único (usuários, contas, acessos com `expiresAt`, conclusões, certificados com mesmo código/hash/URL e PDFs para R2 privado, âncora de drip; financeiro histórico somente leitura) → verificação por amostragem → trocar webhook Asaas e DNS → desligar o legado. Preservar `/comprar/[slug]` e a validação de certificado. Sem e-mail em massa no cutover. **Só há volta antes da primeira operação nova** na vNext; depois, reverter DNS não é rollback seguro. Reembolso de venda do legado: manual no painel Asaas + revogação manual.

## 10. Go/No-Go e estabilização

**Bloqueadores (qualquer um = No-Go):** falha de auth/CSRF/RBAC; transição financeira indevida; restauração não ensaiada ou backup não íntegro; documento privado exposto; Queue/Cron/reconciliação sem capacidade comprovada; PWA vazando cache entre usuários (ou gate de iPhone real não passado); adapter de vídeo ativo sem teste de contrato; segredos de Production fora de ambiente confiável; `/comprar/[slug]` ou validação de certificado quebrados; alerta essencial desligado; termos, privacidade e reembolso não publicados; Bot Fight/WAF não validados com webhooks.

**Go:** SHA exato homologado em Staging; DNS/TLS/callbacks conferidos; contratos de providers e smoke seguro em Production; ensaio de restauração concluído com RPO/RTO medidos; ETL ensaiado em cópia; ADRs dos spikes M0 fechadas; riscos residuais (§11) assinados pelo responsável; contatos de terceiros definidos.

**Estabilização:** 7 dias com revisão diária (§6); congelar mudanças não corretivas; registrar custos e CU-h reais; só então encerrar o legado.

## 11. Riscos aceitos pelo responsável

1. **YouTube em curso pago** (violação possível da política da API; vídeo removido; proteção inferior). Aviso na UI da Staff; ciência do cliente recomendada.
2. **Magic link para a Staff**: acesso total por posse da caixa de e-mail; sem TOTP.
3. **Escopo big-bang**: seis adapters de vídeo, PWA offline, editor de certificado e marketing numa única v1.
4. **Sem adaptação a `prefers-reduced-motion`** (restrição mantida: nada em movimento automático > 5 s sem pausa).
5. **Neon Free sem SLA** e PITR de 6 h; dependência de backups próprios.
6. **Bun 1.4 (reescrita em Rust) no Windows**; mitigação: versão fixada, Node LTS, spike M0-11, Renovate.
7. **Legado congelado por tempo indeterminado** (só segurança, legal e bloqueio de venda; custos de Vercel continuam).
8. Sem branch protection garantida (§2) e sem plantão 24/7.

## 12. Pendências de terceiros

- **Contador:** NFS-e (a vNext não emite; Hub mostra dados à Staff), prazos fiscais.
- **Advogado do cliente:** termos, privacidade, reembolso; retenções (§8); transferência internacional; prazo interno do titular; Marco Civil.
- **Cliente:** provedores de vídeo e **contas de teste**; manual de marca PDF e logo positivo; **destino da cópia semanal off-Cloudflare**; ciência do risco do YouTube.
- **Responsável:** higiene (varredura de segredos e visibilidade) do repositório legado público, ação no legado com autorização própria.
- **Spikes M0:** M0-11 (toolchain), M0-12 (Neon/latência/orçamento de acordar), M0-18 (evlog, Sentry 11).
