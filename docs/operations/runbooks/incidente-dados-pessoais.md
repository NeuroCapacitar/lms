# Runbook: incidente com dados pessoais

> **Prazos e enquadramento legal abaixo vêm de fonte secundária e PRECISAM ser confirmados pelo advogado do cliente.** Este runbook organiza o que fazer e **quem decide**; não é parecer jurídico. A decisão de comunicar à ANPD e aos titulares **não é do agente nem da Staff**: é do responsável, com o advogado.

**Quando abrir:** qualquer suspeita de acesso, divulgação, perda ou alteração indevida de dado pessoal: segredo vazado, resposta de API com dado de outra pessoa, log ou captura com PII, e-mail enviado à pessoa errada, backup exposto, conta da Staff comprometida, discussão com dado identificável de paciente.

## 1. Conter (primeiras horas)

1. **Pare o vazamento**: pause a fila afetada (Admin), troque o segredo exposto ([rotacao-de-segredos.md](rotacao-de-segredos.md)), suspenda a conta comprometida (Staff: suspensão, reautenticação, motivo), retire o conteúdo (moderação de discussão) ou reverta o release ([rollback-de-release.md](rollback-de-release.md)).
2. **Preserve evidência sem aumentar a exposição**: id de correlação, horário, rota, o que foi visto. **Não copie dado pessoal para chat, issue ou planilha.** Auditoria da Staff (`/staff/auditoria`) é append-only e não guarda o texto de conteúdo.
3. Anote a linha do tempo: quando começou (estimativa), quando foi visto, por quem, o que foi feito.

## 2. Avaliar (mesmo dia útil)

Responda por escrito, no registro do incidente:

- **Quais dados** (nome, e-mail, CPF/CNPJ do pagador cifrado, progresso, certificado, discussão com possível dado de saúde)?
- **De quantas pessoas**? A **consulta que lista os titulares afetados** é feita no banco pelo responsável (lista de ids; não exportar para fora).
- **Houve acesso por terceiro?** Os dados estavam cifrados (CPF do pagador sim; e-mail e nome não)?
- **Risco relevante** aos titulares? Esta avaliação é do **responsável com o advogado**.

## 3. Comunicar (decisão do responsável com o advogado)

- Referência a confirmar com o advogado: comunicação à ANPD e aos titulares **em até 3 dias úteis** quando houver risco relevante (6 dias úteis para agente de tratamento de pequeno porte, mediante declaração).
- O texto para as pessoas e para a ANPD **não é escrito pelo agente**.

## 4. Registrar e corrigir

- **Todo incidente é registrado, também os que não foram comunicados**, e o registro é guardado por **pelo menos 5 anos** (referência a confirmar com o advogado). **Onde:** a tela **Incidentes** da Staff (`/staff/incidentes`, só o Admin, escrever pede reautenticação; tabela `privacy_incident`, ADR 0033). O registro guarda o que houve, o tipo, os tipos de dado atingidos, a estimativa de pessoas, o risco avaliado e **a decisão sobre comunicar** (comunicado com data, ou "comunicação não exigida"); **encerrar exige essas duas decisões** e encerrado não muda mais. **Nada se apaga** (gatilho no banco). A API **recusa** e-mail, CPF, CNPJ, telefone e link de acesso no texto: descreva sem identificar ninguém.
- Causa raiz, correção, teste de regressão e, se couber, atualização deste runbook e do `docs/spec/security-operations.md`.

## Não faça

- Notificar titulares por conta própria, apagar logs ou auditoria "para limpar" e discutir o incidente em canal aberto.
- Colar dado pessoal de afetados em issue, PR, chat ou prompt.
