# M1 — Identidade e Staff mínimo

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega e gate.** Qualquer pessoa entra por **magic link** (base para todos); a Staff entra **somente** por link; o aluno pode, opcionalmente, também usar Google e senha. Sessão em Postgres de 7 dias rolling; papéis não exclusivos (student implícito, support, admin) com grants granulares; pelo menos um Admin ativo sempre; convite de Staff; suspensão auditada; reautenticação recente por novo link; CSRF próprio e headers de segurança. **Gate de aceite:** em Staging, com e-mail real: Student cria conta e entra por link; Staff convidada entra só por link e é recusada com senha/Google; sessão expira em 7 dias sem uso; acesso cruzado e escalada de papel pela API direta são negados; o último Admin não pode ser removido nem em concorrência. **Pré-requisito:** M0-08 concluída e ADR "passou" do M0-10 (Better Auth). Sem passkeys, sem TOTP, sem impersonation.

## Ordem recomendada

M1-01 → M1-06 (magic link) → M1-02 → M1-03 → M1-05 → M1-04 → M1-07 → M1-08 → M1-09 → M1-10. O número da tarefa identifica a tarefa, não a ordem.

## Regras para todas as tarefas

- Autorização sempre no servidor: **deny-by-default** por capability, recurso e estado; controle visual nunca é barreira.
- Resposta de login não revela se um e-mail existe ou é de Staff. Nada de token, e-mail ou cookie em logs.
- Valores numéricos marcados "(proposto)" são sugestões a confirmar com o responsável antes de fixar.
- Teste persistência e concorrência em Postgres 18 real (padrão do M0-06). Nenhum envio real de e-mail nos testes automáticos.

---

### M1-01 — Integrar Better Auth, schema e sessão
**Dependências:** M0-04, M0-08, M0-10 · **Estado:** `verified` (CI; ver STATUS)
**Objetivo:** a aplicação tem usuários e sessões em Postgres, com cookie `HttpOnly` e sessão rolling de 7 dias, sem sessão acessível ao JavaScript.
**Passos:**
1. Better Auth na versão exata do ADR M0-10, montado em `/api/auth/*`; instância, `pg` e Drizzle por requisição; `validateSchema: false` com checagem de schema no CI.
2. Gerar o schema do Better Auth com a CLI, incorporar a **migration SQL revisada à mão** no journal único (arquivo gerado não é editado).
3. `expiresIn` 7 dias com renovação em `updateAge`; cookie cache desligado; `trustedOrigins` exatas por ambiente (sem `localhost` em Staging/Production); sem `trustedProviders`.
4. Endpoint `GET /api/me` (DTO mínimo) e logout que apaga a sessão no banco.
**Testes:** sessão criada, renovada após `updateAge`, expirada após 7 dias (relógio controlado); logout invalida a sessão no banco; cookie com `Secure`, `HttpOnly`, `SameSite=Lax` em Staging; origem não confiável é rejeitada.
**Aceite:** com sessão válida `/api/me` responde; sem ela, 401.
**Fora do escopo / cuidados:** sem Google, senha ou passkey aqui; sem plugin admin do Better Auth (nem impersonation); sem "Better Auth Infrastructure".

### M1-02 — Perfil e preferências
**Dependências:** M1-01 · **Estado:** `verified` no CI (ver STATUS)
**Objetivo:** cada pessoa tem um Profile 1:1 com nome de exibição, preferências (tema = sistema, autoavanço = **desligado**) e o campo do futuro nome de certificado.
**Passos:**
1. Tabela `profile` (1:1 com `user`), criada junto do usuário na mesma transação; `display_name`, `certificate_name` (nulo; confirmação antes da 1ª emissão é **PENDENTE (modelagem)**), `theme` (`system|light|dark`), `auto_advance` (default `false`).
2. `GET/PATCH /api/me/profile` com DTO Zod explícito: só campos editáveis; nunca expõe campos internos de autenticação.
3. Tela de perfil/preferências na área do aluno (React Hook Form + Zod; estados de carregando, erro e salvo).
**Testes:** usuário só altera o próprio perfil; campo extra no corpo (`role`, `email`) é ignorado/rejeitado; valores inválidos rejeitados; default de autoavanço é `false`; alterar o nome não muda dados históricos (nada os referencia ainda).
**Aceite:** preferências persistem entre sessões e o tema "sistema" é o padrão.
**Fora do escopo / cuidados:** sem `PATCH` genérico de User; sem avatar (M5); sem troca de e-mail pela interface (pedido por e-mail ao suporte, procedimento manual a documentar — **PENDENTE (advogado/cliente)**).

### M1-03 — Papéis, grants e auditoria mínima
**Dependências:** M1-01 · **Estado:** `implemented` localmente (CI em verificação; ver STATUS)
**Objetivo:** o servidor decide acesso por papéis não exclusivos e grants granulares, e garante pelo menos um Admin ativo.
**Passos:**
1. Tabelas `user_role` (`support`, `admin`; student é implícito), `staff_grant` (capability, concedido por/quando, revogado em) e `audit_log` append-only (quem, ação, alvo, quando, sem PII desnecessária).
2. Catálogo tipado de capabilities (nomes sugeridos). **Só Admin (não delegáveis):** `course.create`, `offer.manage` (oferta, preço, disponibilidade), `certificate.template`, `certificate.revoke`, `staff.manage` (convidar, papéis, grants), `integration.credentials`, `system.maintenance`. **Delegáveis por grant ao Suporte:** `course.edit` (detalhes, módulos, aulas, quizzes, recursos e **publicar**), `enrollment.manage` (matricular manualmente e suspender acesso), `enrollment.support_edit`, `refund.execute`, `finance.review`, `finance.view`, `certificate.reissue`, `discussion.moderate`, `help.edit`, `audit.view`, `ops.queue`. **Sem grant:** ver inscritos, cursos e fila; prévia de aluno; responder pedidos de suporte.
3. Middleware Hono `requireCapability(cap)` + função de caso de uso que recebe o contexto (usuário ativo, papéis, grants); Admin tem todas as capabilities; o banco rejeita grant de capability só-Admin.
4. Garantir ≥1 Admin ativo: remoção/suspensão de Admin em transação que trava as linhas de Admin (`FOR UPDATE`) e conta os restantes.
**Testes:** matriz student/support sem grant/support com grant/admin contra cada rota por requisição direta (nunca pela UI); conceder capability só-Admin é recusado; duas remoções simultâneas dos dois últimos Admins — exatamente uma passa; revogação de grant vale na requisição seguinte; mudanças geram linha em `audit_log`.
**Aceite:** nenhuma rota protegida responde sem a capability correspondente; invariante do Admin sustenta concorrência.
**Fora do escopo / cuidados:** sem papel exclusivo, sem permissão "curinga", sem endpoint genérico de update de usuário.

### M1-04 — Bootstrap do Admin e convite de Staff
**Dependências:** M1-03, M1-05, M1-06 · **Estado:** `not_started`
**Objetivo:** o primeiro Admin nasce sem senha embutida e o Admin convida pessoas da Staff por e-mail; o convite é de uso único e expira.
**Passos:**
1. Script `admin:bootstrap -- --email <endereço>` (execução manual; recusa se já existir Admin; sem senha); o Admin entra depois por magic link. Rodar só em Dev/Staging neste marco.
2. Tabela `staff_invitation` (e-mail, papel, grants iniciais, token com hash, expira em 7 dias (proposto), uso único, status, quem convidou).
3. `POST /api/staff/invitations` (`staff.manage` + reautenticação recente do M1-05); o convite abre a página de confirmação; ao aceitar com o mesmo e-mail (já aluno ou novo), a pessoa ganha o papel `support` e os grants iniciais; reenvio e revogação.
**Testes:** segundo uso do mesmo convite falha; convite expirado ou revogado falha; e-mail diferente do convidado falha; Suporte não convida nem se concede grant; aceitar convite não cria sessão sem passar pelo magic link; auditoria registra convite, aceite e revogação.
**Aceite:** Admin inicial existe sem credencial no código; Staff convidada entra e só enxerga o que seus grants permitem.
**Fora do escopo / cuidados:** não executar em Production; sem plugin admin; a equipe prevista é 1 Admin + 3 Suportes, sem multi-organização.

### M1-05 — CSRF próprio, headers de segurança e reautenticação recente
**Dependências:** M1-01, M1-03, M1-06 · **Estado:** `not_started`
**Objetivo:** mutações HTTP resistem a CSRF, as respostas levam headers de segurança e ações sensíveis exigem prova recente de posse do e-mail.
**Passos:**
1. Middleware CSRF próprio para JSON (o `hono/csrf` só cobre formulários): mutação exige `Content-Type: application/json` e `Origin` (ou `Sec-Fetch-Site: same-origin`) válido; ausência de ambos é recusada; GET jamais altera estado. Webhooks (token próprio) ficam fora, explicitamente.
2. Headers: CSP restrita (`script-src 'self'`, Turnstile permitido, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` em `/api/*`. **Assets estáticos não passam pelo Worker**: aplicá-los também em `public/_headers`.
3. Reautenticação: pedir um novo magic link com `purpose=reauth` vinculado à sessão atual; ao confirmar, grava `reauth_proof(session_id, verified_at)`. Guard `requireRecentAuth(maxMinutes)` (10 min, proposto) — "sessão recente" não equivale a reautenticação.
4. Aplicar o guard a: convidar Staff, conceder/revogar grants e papéis, suspender/reativar (M1-08).
**Testes:** `fetch` entre origens com `text/plain`, formulário cruzado, `Origin: null` e sem `Origin` → recusados; mutação legítima passa; ação sensível sem prova recente → 403 com código próprio; prova expirada falha; prova de uma sessão não vale em outra; CSP sem violação nas telas existentes (Playwright).
**Aceite:** o guard é reutilizável (reembolso do M6 o usará) e os testes negativos passam.
**Fora do escopo / cuidados:** sem TOTP, sem passkey; não confundir `freshAge` do Better Auth com reautenticação.

### M1-06 — Magic link: pedido, confirmação e proteções
**Dependências:** M1-01, M0-10 · **Estado:** `homologated` em Staging com e-mail real (ver STATUS)
**Objetivo:** pedir um link por e-mail e entrar com um clique de confirmação, sem que scanner de e-mail consuma o link, e sem esgotar a cota de e-mails.
**Passos:**
1. Interface `EmailSender` com implementação falsa (Dev/testes) e Resend (Staging com allowlist). Template de magic link **hospedado** no Resend. DKIM/SPF do domínio dependem do M0-09 (**PENDENTE (responsável)**); até lá, remetente de teste do Resend.
2. `POST /api/auth/link/request`: valida e-mail (normalizado) e **Turnstile**; resposta sempre genérica ("se o e-mail puder entrar, enviamos um link"); rate limit por e-mail + IP e **teto diário global** de links (proposto: reservar parte dos 100 e-mails/dia do Resend Free aos transacionais).
3. Link leva a `/entrar/confirmar`; a página só consome o token em `POST` por um botão "Entrar"; token de uso único, expiração curta (15 min, proposto), armazenado com hash; removido da URL com `replaceState`; `Referrer-Policy: no-referrer`.
4. Quem não existe e não é e-mail de Staff vira aluno novo; e-mail com papel Staff só entra se já existir e estiver ativo. Telas `/entrar` e `/entrar/confirmar` com estados de erro/expirado.
**Testes:** `GET` no link não cria sessão; segundo `POST` falha; link expirado falha; 6 pedidos seguidos do mesmo e-mail/IP são limitados; teto global bloqueia sem derrubar transacionais; Turnstile inválido recusa (usar chaves de teste da Cloudflare); resposta idêntica para e-mail existente e inexistente (conteúdo e tempo aproximado).
**Aceite:** fluxo completo em Staging com e-mail real; nenhum token em log.
**Fora do escopo / cuidados:** sem outbox/Queue (M4 pode migrar o envio); não enviar marketing por aqui.

### M1-07 — Google e senha opcionais para o aluno
**Dependências:** M1-01, M1-06 · **Estado:** `not_started`
**Objetivo:** o aluno pode, depois de entrar, adicionar login com Google e/ou senha; a Staff continua só por link.
**Passos:**
1. Provedor Google e `emailAndPassword` habilitados; linking apenas por e-mail **verificado**; `disableImplicitLinking` ou equivalente validado; sem `trustedProviders`/`allowDifferentEmails`.
2. Tela "Segurança da conta" (adicionar/remover Google, definir senha) com reautenticação recente quando mudar método.
3. Regra no servidor: se o usuário tem papel `support` ou `admin`, login por senha/Google é **recusado** e sessões abertas por esses métodos são revogadas ao conceder o papel; credenciais ficam inativas, não apagadas.
4. Rate limit e verificação de senha medidos (CPU do scrypt, dado do M0-10).
**Testes:** Google com e-mail não verificado não liga contas; e-mail de Google diferente não assume conta existente; Staff com senha/Google recebe a mesma resposta genérica; remover o último método do aluno ainda deixa o magic link; callback OAuth funciona atrás de `run_worker_first`.
**Aceite:** aluno entra por qualquer método habilitado; Staff só por link, comprovado por API direta.
**Fora do escopo / cuidados:** sem passkeys (adiadas), sem TOTP; credenciais OAuth do Google criadas por quem tem a conta Cloud do cliente (**PENDENTE (responsável/cliente)**).

### M1-08 — Suspensão auditada
**Dependências:** M1-03, M1-05 · **Estado:** `not_started`
**Objetivo:** o Admin suspende e reativa contas; a suspensão encerra todas as sessões e impede novo login.
**Passos:**
1. Estado `suspended_at`/motivo em `user`; `POST /api/staff/users/:id/suspend` e `/reactivate` (`staff.manage` + reautenticação recente).
2. Na mesma transação: marcar suspensa, apagar todas as sessões, escrever `audit_log`. Magic link, Google e senha recusam usuário suspenso com resposta genérica.
3. Não permite suspender o último Admin ativo (reutiliza o invariante do M1-03).
**Testes:** suspensão concorrente com login em andamento: nenhuma sessão sobrevive; suspender o último Admin falha; auditoria completa; usuário suspenso não volta com link já emitido.
**Aceite:** efeito imediato na requisição seguinte.
**Fora do escopo / cuidados:** sem exclusão de conta nem anonimização (pedido por e-mail ao suporte, procedimento manual); suspensão de **acesso a curso** é do M3-06.

### M1-09 — Aceite versionado de termos e declaração 18+
**Dependências:** M1-06 · **Estado:** `not_started`
**Objetivo:** ninguém usa a área logada sem ter aceitado a versão vigente dos Termos e da Política de Privacidade e declarado ter 18 anos ou mais.
**Passos:**
1. Tabelas `legal_document_version` (tipo, versão, vigente a partir de) e `terms_acceptance` (usuário, versão, quando); sem armazenar IP, salvo orientação do advogado (**PENDENTE (advogado do cliente)**).
2. Depois do login, se não há aceite da versão vigente, o servidor responde com um bloqueio específico e a SPA mostra a tela de aceite (inclui a declaração 18+); texto jurídico **PENDENTE (advogado)**: usar texto provisório sinalizado.
3. Publicar nova versão exige novo aceite no próximo acesso.
**Testes:** rota protegida sem aceite → bloqueio; aceite grava a versão correta; nova versão volta a bloquear; aceite duplicado é idempotente.
**Aceite:** nenhum endpoint de aluno responde dados antes do aceite (exceto os de aceite e logout).
**Fora do escopo / cuidados:** Hub só implementa o mecanismo; os textos e a política de reembolso são do advogado do cliente.

### M1-10 — Shell mínimo da Staff e tela de equipe
**Dependências:** M1-04, M1-08, M0-07 · **Estado:** `not_started`
**Objetivo:** a Staff tem navegação própria (sidebar/gaveta) e o Admin gere equipe: convites, papéis, grants e suspensão.
**Passos:**
1. `StaffShell` com sidebar (gaveta no celular), mesma linguagem visual do aluno; itens aparecem só com a capability (apenas conveniência).
2. Tela "Equipe": lista de pessoas da Staff, convidar, editar grants (checkbox por capability), suspender; ações sensíveis pedem a reautenticação do M1-05.
3. Estados de carregando/erro/vazio; acessibilidade por teclado.
**Testes:** Playwright do Admin convidando e retirando um grant; Suporte vê o shell sem a tela de equipe e recebe 403 ao chamar a API direto; axe sem violações.
**Aceite:** gestão de equipe concluída só pela interface, com auditoria.
**Fora do escopo / cuidados:** sem outras telas de Staff (vêm nos marcos seguintes); nenhuma impersonation.

---

**Notas de migração.** M1-01 foi reduzida à base de Better Auth/sessão; Google e senha saíram para M1-07 e o magic link virou M1-06 (decisão Q52/Q61). Passkeys foram removidas (adiadas) e a reautenticação do antigo M1-05 passou a usar novo magic link. Novos: M1-06..M1-10 (aceite de termos: Q38).
