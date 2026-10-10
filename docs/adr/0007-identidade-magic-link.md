# ADR-0007 — Identidade: magic link como método base; Staff somente por link

- **Estado:** accepted-conditional (spike M0-10 e riscos aceitos abaixo)
- **Data:** 2026-10-10
- **Origem:** Q26, Q40, Q52, Q61.1; B3
- **Substitui:** de B3, "Google+senha como base" e "passkeys opcionais"; também as decisões intermediárias Q26 (Staff com Google) e Q40 (Staff com senha + TOTP)

## Contexto

A Staff (4 pessoas) não tem conta Google, e o Hub não verifica a 2ª etapa do Google (Q35). O responsável escolheu magic link para todos, sem TOTP (Q52). O legado removeu MFA em 2026-09-01, sem motivo documentado (evidência: L3 §1.3). Better Auth tem regressões em patches (ex.: #11651, travamento de auth no isolate com `validateSchema`) (evidência: W2 §3.2). Scanners de e-mail consomem links de uso único em GET/HEAD (W3 §7.2). Resend Free: 100 e-mails/dia.

## Decisão

- **Better Auth** (versão exata fixada; `validateSchema: false` se necessário), sessão PG rolling de 7 dias, cookie cache desligado ou curto.
- **Magic link é o método base para todos.** A **Staff entra somente por magic link** (sem senha, Google, TOTP ou passkey). Aluno pode, opcionalmente, usar Google e senha. Passkeys adiadas.
- Link: página de confirmação (POST, anti-scanner), uso único, expiração curta, rate limit por e-mail+IP, **Turnstile no pedido**.
- Ações sensíveis exigem **reautenticação recente por novo link**.
- Linking Google só com e-mail verificado; sem `trustedProviders` nem `allowDifferentEmails`.
- ≥1 Admin ativo; sem impersonation; `StaffInvitation`; prévia de aluno sem gravar progresso ([ADR-0008](0008-autorizacao-papeis-e-grants.md)).

## Consequências

- **Risco aceito:** acesso total da Staff por posse da caixa de e-mail (1 fator, não equivale a senha + TOTP).
- Pedidos de link competem pela cota do Resend Free; sem Turnstile e limites, travam todos os e-mails.
- Entrega de e-mail vira ponto único de falha do login.

## Como validar

- spike M0-10: Better Auth + magic link + Hono + Hyperdrive + `pg` + Drizzle no workerd; medir CPU do scrypt.
- Testes: reuso de link, scanner (GET/HEAD sem efeito), enumeração, rate limit, reauth, linking Google e acesso cruzado.
