# Pedidos de privacidade por e-mail (M9-10)

> **Estado:** procedimento e script prontos e testados em Postgres real; **ainda não foi executado por uma pessoa da Staff em Staging** e **a política de eliminação NÃO está aprovada** pelo advogado nem pelo contador (itens "pendente" abaixo). Em Production o script só faz ensaio até a aprovação.

Desistência, exclusão, acesso aos dados e troca de e-mail **não têm botão no produto** (decisão Q21): a pessoa escreve para o suporte e a Staff executa este procedimento. O script é `bun run privacy:request` (`scripts/privacy/privacy-request.ts`). **Sem `--execute` ele só ensaia** (não grava nada) e **nunca imprime nome, e-mail ou texto de pessoa**.

## Regras para toda a Staff

1. **Confirmar o recebimento no mesmo dia** (modelo abaixo) e registrar o pedido com um **número de chamado** (`CH-123`): ele vai na opção `--request-ref` e na auditoria. O número não pode ter espaço nem arroba.
2. **Validar a identidade antes de qualquer ação:** o pedido só vale se vier do **e-mail da conta**, ou se a pessoa confirmar por um link enviado a esse e-mail. Em dúvida, **não execute**. Nunca aceite pedido de terceiro sem prova.
3. **Prazo interno de resposta: PENDENTE (advogado).** O Decreto 7.962 cita resposta em até 5 dias para o comércio eletrônico; o advogado define o prazo do Hub.
4. **Sempre ensaiar antes** (sem `--execute`), conferir as contagens e só então executar. Um comando por pedido.
5. **Nunca** SQL avulso em Production, nem copiar dado pessoal para chat, issue, planilha ou e-mail aberto.
6. Ambiente: `DATABASE_URL_MIGRATION` com a role dona do banco, conexão direta, **só na sua máquina** (ver [database-and-migrations.md](database-and-migrations.md) e [cli-profiles.md](cli-profiles.md)).

## Caso A: desistência e reembolso (até 7 dias da compra)

1. Confirme a identidade e o pedido (a pessoa informa o e-mail da conta; localize o pedido na tela **Financeiro**).
2. Dentro de **7 dias desde a compra** (contados por dia de São Paulo) quem tem o grant `refund.execute` abre o **reembolso integral** (`RefundRequest`, pela tela Financeiro). Depois de 7 dias, só o **Admin**, como exceção. O reembolso revoga o acesso (M6-05) e roda no Asaas por fila durável.
3. Responda com o modelo "reembolso". **Reembolso de venda do legado é manual no Asaas** (M10-09).
4. Se a pessoa também pedir a exclusão, siga o caso B **depois** que o reembolso estiver concluído (o pedido e o pagamento ficam retidos).

## Caso B: exclusão de dados

```bash
bun run privacy:request staging erase --email <endereço-da-conta> --request-ref CH-123
```

O ensaio mostra as **contagens** do que seria tocado. Conferidas, executar com o registro **fora do banco**:

```bash
bun run privacy:request staging erase --email <endereço-da-conta> --request-ref CH-123 --log-dir <pasta-fora-do-repositório> --execute
```

- **`--log-dir` é obrigatório para executar.** O script grava ali um arquivo por exclusão (`erasure-….json`) com **só o identificador interno, a política e contagens**: sem nome nem e-mail. Guarde a pasta com os backups (ela precisa sobreviver a uma restauração). Com `--log-s3` o registro também vai ao bucket de backup, prefixo `erasure-log/`, **sem regra de expiração** (usa `BACKUP_S3_ENDPOINT` e `BACKUP_S3_BUCKET`).
- **Conta da Staff NÃO é excluída por aqui** (o script recusa): é procedimento do Admin.
- **Idempotente:** repetir diz "já excluído" e não muda nada.
- **Depois de restaurar um backup** feito antes de uma exclusão, a pessoa "volta". Reaplique: `bun run privacy:request <ambiente> reapply --log-dir <pasta> --execute` (primeiro sem `--execute`). Quem não existe na cópia restaurada é só contado. Faça isso **antes** de reabrir o sistema ([backup-and-restore.md](backup-and-restore.md)).
- **Remover o contato do Resend** (se a pessoa estiver em lista de marketing: o consentimento de marketing e os contatos entram no M9-03; até lá não há contato). Conferir no painel do Resend e remover à mão.
- **Aparelho da pessoa:** o app instalado guarda dados offline; oriente a pessoa a **sair da conta** (a saída limpa o aparelho, M8-05).

### O que se elimina, anonimiza ou retém (política `2026-10-19.1`)

A fonte é `src/features/privacy/erasure-policy.ts`; um teste garante que esta lista cita todas as tabelas dela. **"Pendente" = depende de confirmação do advogado ou do contador.**

| Ação | Tabelas | O que acontece | Pendente |
| --- | --- | --- | --- |
| **Anonimiza** | `user` | nome vira "[removido]", e-mail vira `removido+<id>@removido.invalid`, foto some, e-mail deixa de ser verificado | |
| **Elimina** | `session`, `account`, `reauth_challenge`, `reauth_proof`, `verification` | sessões, contas de entrada (senha e Google), reautenticação e links de acesso pendentes | |
| **Elimina** | `profile` | nome de exibição, nome do certificado e preferências | |
| **Anonimiza** | `discussion_post`, `discussion_report` | o texto vira "[removido]"; a conversa continua | |
| **Anonimiza** | `support_request` | o texto vira "[removido]"; categoria e curso ficam | advogado |
| **Elimina** | `course_interest`, `course_interest_notification`, `offline_operation` | interesse em cursos e fila técnica offline | |
| **Retém** | `user_role`, `staff_grant`, `user_suspension` | só ids; quem tem papel ativo não é excluído por aqui | advogado |
| **Retém** | `terms_acceptance` | prova do aceite e da declaração 18+ | advogado |
| **Retém** | `purchase_order`, `checkout_session`, `payment`, `refund_request`, `financial_review` | pedidos e pagamentos, **inclusive o nome do pagador e o documento cifrado** | contador |
| **Retém** | `certificate` | o certificado fica (nome no snapshot e no PDF); o revogado segue a purga do M7-05 | advogado |
| **Retém** | `enrollment`, `entitlement`, `course_completion`, `lesson_completion`, `quiz_attempt`, `video_progress` | matrículas, acessos e progresso, ligados só ao identificador interno | advogado |
| **Retém** | `email_message`, `email_recipient_state` | histórico de envios e supressão por hash (sem o endereço em claro) | advogado |
| **Retém** | `inbox_event`, `outbox_message` | eventos de provedores e fila; **conferir** se o payload do pagamento guarda dado do pagador | contador |
| **Retém** | `audit_log` | auditoria append-only, só ids e códigos | |
| **Retém** | `course`, `offer`, `media_asset`, `certificate_issuer`, `certificate_signatory`, `certificate_template`, `video_provider_connection`, `staff_invitation`, `privacy_incident` | colunas "criado por": só o id | |

## Caso C: acesso e portabilidade (exportar os dados)

```bash
bun run privacy:request staging export --email <endereço-da-conta> --out <pasta-fora-do-repositório>/CH-123.json
```

O ensaio lista só as **seções e contagens**. Com `--execute` o arquivo é gravado com **permissão restrita** e **o script recusa uma pasta dentro do repositório**. O arquivo traz perfil, matrículas, acessos, aulas concluídas, tentativas de quiz, certificados, pedidos e pagamentos (com o documento **mascarado**), mensagens em discussões, pedidos de suporte, aceites e e-mails enviados. **Nunca** inclui senha, token, sessão nem o documento do pagador em claro ou cifrado. Envie por canal seguro (link com senha enviada à parte) e **apague o arquivo** depois.

## Caso D: troca de e-mail

1. A Staff confirma os **dois endereços**: o antigo (a pessoa responde de lá ou confirma por link) e o novo (a pessoa confirma que recebe e-mail lá).
2. Ensaio e execução (**só o Admin**, a confirmar com o advogado):

```bash
bun run privacy:request staging change-email --user <id> --new-email <novo> --request-ref CH-123 --confirmed-old --confirmed-new --execute
```

O script recusa e-mail inválido, igual ao atual, **já usado por outra conta** (sem diferenciar maiúsculas), conta da Staff e conta excluída. Ele encerra as sessões e os links pendentes do endereço antigo, marca o novo como verificado e audita **só o fato**, sem os endereços. A pessoa entra de novo pelo link no endereço novo. **Contas com Google:** o vínculo continua, mas peça que entre pelo link do e-mail novo.

## Modelos de resposta (PENDENTE: revisão do advogado)

**Confirmação de recebimento** (imediata): "Recebemos o seu pedido (chamado CH-123). Para a sua segurança, vamos confirmar que ele vem do titular da conta. Responda a este e-mail a partir do endereço cadastrado. Retornaremos em até [prazo definido pelo advogado]."

**Concluído, exclusão:** "Concluímos o seu pedido (CH-123). Removemos o seu nome, e-mail, credenciais de acesso e textos escritos na plataforma. Mantemos, por obrigação legal, [lista aprovada pelo advogado]. Ao sair da conta no seu aparelho, os dados guardados nele também são apagados."

**Concluído, exportação:** "Enviamos o arquivo com os dados que guardamos sobre você (CH-123) por [canal]. A senha de abertura segue em mensagem separada."

**Concluído, troca de e-mail:** "O e-mail da sua conta foi alterado (CH-123). Entre pelo link de acesso enviado ao novo endereço."

**Não foi possível validar a identidade:** "Não conseguimos confirmar que o pedido vem do titular da conta. Por segurança, nada foi alterado. Responda a partir do e-mail cadastrado."

## Pendências (com dono)

- **Advogado:** aprovar a política (itens "pendente"), o prazo de resposta, os modelos acima, o conteúdo do aviso ao titular, e se a troca de e-mail é só do Admin. **Contador:** o prazo de guarda fiscal dos pedidos e pagamentos e do nome e documento do pagador. **Aprovar a política = um PR que muda `ERASURE_POLICY_APPROVED` com o parecer anexado**; sem isso o script não executa exclusão em Production.
- **Ensaio com os 3 Suportes** (Staging, dados sintéticos): cada caso executado por quem não escreveu este documento, com o tempo medido. **Não foi feito**; é o aceite da tarefa.
- **Conferir** se o `payload` de `inbox_event` do Asaas carrega nome ou documento do pagador (item da política).
- **Registro das eliminações em Production:** definir onde fica a pasta de registros e quem a guarda (recomendado: junto dos backups, no bucket de backup com `--log-s3`).
- **Certificado de pessoa excluída:** o nome fica no certificado válido; a decisão (revogar e purgar ou manter) é do advogado.
