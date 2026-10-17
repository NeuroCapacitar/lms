# Matriz capacidade × tela × endpoint da Staff

> **M9-01, passo 1.** Fonte do dado: `src/features/identity/staff-matrix.ts`. O teste `test/pg/staff-matrix.pg.test.ts` (Postgres 18 real, **chamada direta de API**) confere que **toda** rota `/api/staff/*` registrada está aqui e que cada linha nega o que deve negar. Este documento é para leitura: o teste falha se uma linha do dado não aparecer abaixo. A interface só **mostra** conforme esta matriz; quem decide é o servidor (deny-by-default, lido do banco a cada requisição).

## Quem pode o quê

| Camada | Capacidades |
| --- | --- |
| **Só Admin** (nunca delegáveis) | `course.create`, `offer.manage`, `certificate.template`, `certificate.revoke`, `staff.manage`, `integration.credentials`, `system.maintenance` |
| **Delegáveis por grant** (o Admin concede ao Suporte, uma a uma) | `course.edit` (inclui publicar), `access.grant` (matricular e suspender), `enrollment.support_edit`, `refund.execute`, `finance.review`, `finance.view`, `certificate.reissue`, `discussion.moderate`, `help.edit`, `audit.view`, `ops.queue` |
| **Sem grant** (todo Suporte e todo Admin ativo) | `staff.read`: ver inscritos, cursos e a fila, prévia de aluno, ler pedidos de suporte |

Conta **suspensa** nega tudo, mesmo com papel e grants. Remover um grant vale na **próxima requisição** (nada é cacheado).

## Regras que o teste prova em cada linha

1. Sem sessão: `401`.
2. Pessoa sem papel de Staff: `403 forbidden` (exceto aceitar convite, que só pede sessão).
3. Conta suspensa: `403 account_suspended`.
4. Suporte **sem** grant: só passa onde basta `staff.read`; no resto, `403 forbidden`.
5. Quem tem a capacidade passa pelo portão; um grant de **outra** capacidade não abre a linha.
6. Ação sensível (coluna "Reauth"): o titular sem prova de reautenticação recente recebe `403 reauth_required`; quem não é titular recebe `forbidden` (o direito é checado antes).

## Reservadas e atalhos conhecidos

- `audit.view`: protege `GET /api/staff/audit` (leitura da auditoria, paginada por cursor, só IDs). A auditoria é gravada em `audit_log`, só de acréscimo.
- `certificate.template` e `certificate.revoke`: as rotas de emitente, signatário, modelo e revogação usam `staff.manage` como "só Admin" (mesmo efeito, pois nenhuma das três é delegável). Os nomes ficam reservados para quando houver diferença.
- `system.maintenance`: protege hoje só a **pausa de fila** por lane. Não existe um "modo de manutenção" do produto (decisão pendente).
- Menu: **"Certificados"** (emitente, signatário e modelo) aparece só para `staff.manage`; **"Certificados emitidos"** aparece para `certificate.reissue` ou `ops.queue` (e para o Admin), como a lista `GET /api/staff/certificates` aceita.

## Endpoints

| Endpoint | Exige | Reauth | Tela |
| --- | --- | --- | --- |
| `GET /api/staff/invitations` | `staff.manage` | não | `/staff/equipe` |
| `POST /api/staff/invitations` | `staff.manage` | sim | `/staff/equipe` |
| `POST /api/staff/invitations/:id/resend` | `staff.manage` | sim | `/staff/equipe` |
| `POST /api/staff/invitations/:id/revoke` | `staff.manage` | sim | `/staff/equipe` |
| `POST /api/staff/users/:id/suspend` | `staff.manage` | sim | `/staff/equipe` |
| `POST /api/staff/users/:id/reactivate` | `staff.manage` | sim | `/staff/equipe` |
| `GET /api/staff/team` | `staff.manage` | não | `/staff/equipe` |
| `POST /api/staff/users/:id/grants` | `staff.manage` | sim | `/staff/equipe` |
| `POST /api/staff/users/:id/grants/revoke` | `staff.manage` | sim | `/staff/equipe` |
| `POST /api/staff/users/:id/support/revoke` | `staff.manage` | sim | `/staff/equipe` |
| `POST /api/staff/invitations/accept` | só sessão (o e-mail do convite é conferido no caso de uso) | não | `/convite` |
| `GET /api/staff/preview/courses/:id/outline` | `staff.read` | não | `/staff/previa/$courseId` |
| `GET /api/staff/preview/courses/:id/lessons/:lessonId` | `staff.read` | não | `/staff/previa/$courseId/aulas/$lessonId` |
| `GET /api/staff/courses/:courseId/enrollments` | `staff.read` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/enrollments` | `access.grant` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/courses/:courseId/enrollments/:userId/suspend` | `access.grant` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/courses/:courseId/enrollments/:userId/reinstate` | `access.grant` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/entitlements/:id/adjust` | `enrollment.support_edit` | não | `/staff/cursos/$courseId` |
| `GET /api/staff/courses` | `staff.read` | não | `/staff/cursos` |
| `POST /api/staff/courses` | `course.create` | não | `/staff/cursos` |
| `GET /api/staff/courses/:id` | `staff.read` | não | `/staff/cursos/$courseId` |
| `PATCH /api/staff/courses/:id` | `course.edit` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/courses/:id/status` | `course.edit` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/courses/:id/offers` | `offer.manage` | não | `/staff/cursos/$courseId` |
| `PATCH /api/staff/courses/:id/offers/:offerId` | `offer.manage` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/courses/:id/offers/:offerId/status` | `offer.manage` | não | `/staff/cursos/$courseId` |
| `GET /api/staff/courses/:id/draft` | `staff.read` | não | `/staff/cursos/$courseId` |
| `PUT /api/staff/courses/:id/draft` | `course.edit` | não | `/staff/cursos/$courseId` |
| `POST /api/staff/courses/:id/publish` | `course.edit` | não | `/staff/cursos/$courseId` |
| `GET /api/staff/courses/:id/publish-preview` | `staff.read` | não | `/staff/cursos/$courseId` |
| `GET /api/staff/courses/:id/interests` | `staff.read` | não | `/staff/cursos/$courseId` |
| `GET /api/staff/panel` | `staff.read` (pedidos só com `finance.view`; denúncias só com `discussion.moderate`) | não | `/staff` |
| `GET /api/staff/queue` | `staff.read` (cada tipo só a quem pode vê-lo; a ação só a quem tem o grant) | não | `/staff/fila` |
| `GET /api/staff/audit` | `audit.view` | não | `/staff/auditoria` |
| `GET /api/staff/operations` | `staff.read` | não | `/staff/operacao` |
| `POST /api/staff/operations/outbox/:id/requeue` | `ops.queue` | sim | `/staff/operacao` |
| `POST /api/staff/operations/queues/:lane/pause` | `system.maintenance` | sim | `/staff/operacao` |
| `GET /api/staff/video/connections` | `integration.credentials` | não | `/staff/videos` |
| `GET /api/staff/video/providers` | `integration.credentials` | não | `/staff/videos` |
| `POST /api/staff/video/connections` | `integration.credentials` | sim | `/staff/videos` |
| `PUT /api/staff/video/connections/:id/secret` | `integration.credentials` | sim | `/staff/videos` |
| `POST /api/staff/video/connections/:id/disable` | `integration.credentials` | sim | `/staff/videos` |
| `POST /api/staff/video/connections/:id/enable` | `integration.credentials` | sim | `/staff/videos` |
| `POST /api/staff/video/rekey` | `integration.credentials` | sim | `/staff/videos` |
| `GET /api/staff/finance/reviews` | `finance.review` | não | `/staff/financeiro` |
| `POST /api/staff/finance/reviews/:id/resolve` | `finance.review` | não | `/staff/financeiro` |
| `POST /api/staff/finance/orders/:id/refund` | `refund.execute` | sim | `/staff/financeiro` |
| `GET /api/staff/finance/orders` | `finance.view` | não | `/staff/financeiro` |
| `POST /api/staff/finance/payments/:id/reveal-document` | `finance.view` | sim | `/staff/financeiro` |
| `GET /api/staff/finance/refunds` | `refund.execute` | não | `/staff/financeiro` |
| `GET /api/staff/help/faq` | `help.edit` | não | `/staff/ajuda` |
| `POST /api/staff/help/faq` | `help.edit` | não | `/staff/ajuda` |
| `PUT /api/staff/help/faq/:id` | `help.edit` | não | `/staff/ajuda` |
| `POST /api/staff/help/faq/:id/state` | `help.edit` | não | `/staff/ajuda` |
| `POST /api/staff/help/faq/:id/move` | `help.edit` | não | `/staff/ajuda` |
| `POST /api/staff/help/faq/:id/delete` | `help.edit` | não | `/staff/ajuda` |
| `GET /api/staff/help/requests` | `staff.read` | não | `/staff/ajuda` |
| `GET /api/staff/banners` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/panel` | `staff.manage` | não | `/staff/banners` |
| `PUT /api/staff/banners/panel/:id` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/panel/:id/state` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/panel/:id/move` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/panel/:id/delete` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/login` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/login/:id/state` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/login/:id/move` | `staff.manage` | não | `/staff/banners` |
| `POST /api/staff/banners/login/:id/delete` | `staff.manage` | não | `/staff/banners` |
| `GET /api/staff/certificate/issuer` | `staff.manage` | não | `/staff/certificados` |
| `PUT /api/staff/certificate/issuer` | `staff.manage` | não | `/staff/certificados` |
| `GET /api/staff/courses/:courseId/certificate/signatory` | `staff.manage` | não | `/staff/certificados/$courseId` |
| `PUT /api/staff/courses/:courseId/certificate/signatory` | `staff.manage` | não | `/staff/certificados/$courseId` |
| `GET /api/staff/courses/:courseId/certificate/template` | `staff.manage` | não | `/staff/certificados/$courseId` |
| `PUT /api/staff/courses/:courseId/certificate/template` | `staff.manage` | não | `/staff/certificados/$courseId` |
| `POST /api/staff/courses/:courseId/certificate/template/publish` | `staff.manage` | não | `/staff/certificados/$courseId` |
| `POST /api/staff/courses/:courseId/certificate/template/discard` | `staff.manage` | não | `/staff/certificados/$courseId` |
| `GET /api/staff/certificates` | qualquer de `staff.manage`, `certificate.reissue`, `ops.queue` | não | `/staff/certificados/emitidos` |
| `POST /api/staff/certificates/:id/revoke` | `staff.manage` | sim | `/staff/certificados/emitidos` |
| `POST /api/staff/certificates/:id/reissue` | `certificate.reissue` | não | `/staff/certificados/emitidos` |
| `POST /api/staff/certificates/:id/retry` | `ops.queue` | não | `/staff/certificados/emitidos` |
| `GET /api/staff/discussions` | `discussion.moderate` | não | `/staff/discussoes` |
| `POST /api/staff/discussions/posts/:id/reply` | `discussion.moderate` | não | `/staff/discussoes` |
| `POST /api/staff/discussions/posts/:id/moderate` | `discussion.moderate` | não | `/staff/discussoes` |
| `POST /api/staff/discussions/posts/:id/dismiss` | `discussion.moderate` | não | `/staff/discussoes` |


Nenhum endpoint da Staff aceita campos arbitrários: cada PATCH e PUT usa schema estrito por ação (`strictObject`), e as ações de estado têm rota própria com motivo.
