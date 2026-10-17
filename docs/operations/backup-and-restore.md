# Backup e restauração (M9-05)

> Estado: **backup real e ensaio de restauração executados em 2026-10-17 (Staging → PG18 local descartável), com o bucket `hub-staging-backups` criado; falta o token S3, a role somente leitura, o agendamento e a reconciliação pós-restore.** Evidência: `docs/review/evidencias/m9-05/README.md`. Pendências em "Pendências".

Metas a demonstrar no ensaio (não garantias): **RPO ≤ 24 h, RTO ≤ 8 h**. O PITR de 6 h do Neon Free **não** é backup independente.

## O que existe

| Peça | Onde | O que faz |
| --- | --- | --- |
| Núcleo puro | `scripts/backup/backup-core.ts` | manifesto (SHA-256, tamanho, nº de migrations, versão do PG), nome dos objetos, **retenção** (14 diários + 4 semanais; `release/` nunca é apagado), **frescor** (alerta se o último backup íntegro tem mais de 26 h) |
| Travas | `scripts/backup/backup-guards.ts` | só chave **pública** do `age`; dump só por conexão **direta** (nunca pooler nem Hyperdrive); restauração só em banco cujo nome começa por `restore_rehearsal` |
| Backup | `bun run backup:db -- --kind daily\|release --out <pasta> [--upload]` | `pg_dump -Fc` (cliente PG18), cifra com `age`, grava objeto + manifesto; com `--upload` envia ao bucket S3-compatível (objeto primeiro, manifesto depois) |
| Ensaio | `bun run backup:rehearsal -- --dump … --manifest … --identity …` | confere o SHA-256 **antes** de decifrar, decifra, `pg_restore` no banco descartável, confere migrations e contagens, mede tempo e idade do dump |
| Role | `scripts/db/setup-backup-role.ts` (`bun run db:roles:backup <ambiente>`) | cria `hub_backup` SOMENTE LEITURA (`pg_read_all_data` com `inherit true`), sem `neon_superuser`, `BYPASSRLS`, DDL nem DML, e FALHA se sobrar algum privilégio; testada no PG18 local (lê, não escreve, não cria, `pg_dump` funciona) |
| Testes | `test/unit/backup-core.test.ts`, `test/unit/backup-guards.test.ts` | manifesto, dump corrompido/truncado/trocado, frescor (limite 26 h), retenção, travas, `age` de verdade (ida e volta, chave errada não decifra) |

Variáveis do backup: `BACKUP_DATABASE_URL` (conexão **direta**, role **somente leitura**), `BACKUP_AGE_RECIPIENT` (`age1…`), e para o upload `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (token do R2 com escopo só no bucket de backup, só escrita). Ensaio: `RESTORE_DATABASE_URL`. **Nada disso vai para o repositório, para o Worker nem para o R2 de mídia.**

## Regras

1. **A chave privada do `age` nunca fica no GitHub, no Worker, no R2 nem no CI**; custódia independente em pelo menos 2 cópias. Só a pública entra no automatismo.
2. Backup contém dado pessoal: o bucket é **separado da mídia**, privado, e a retenção final depende do parecer jurídico (M9-09).
3. Dump **antes de cada release** (`--kind release`); a retenção nunca os apaga.
4. **Nunca restaurar direto em Production.** O ensaio só roda em banco descartável (a trava pelo nome impede o engano).
5. Cron do GitHub atrasa (de 3 h a 5 h no legado): por isso o alerta de frescor é 26 h, não 24 h.

## Ensaio de restauração (semestral e antes do Go-Live)

1. Criar um banco descartável `restore_rehearsal_<data>` (PG18 local ou projeto Neon de Dev; **nunca** o de Production).
2. Baixar o objeto e o manifesto do bucket (ou usar os da pasta local).
3. `RESTORE_DATABASE_URL=… bun run backup:rehearsal -- --dump … --manifest … --identity <arquivo-da-chave-privada>`.
4. Registrar em `docs/review/evidencias/m9-05/`: data, duração (decifrar, restaurar, total), idade do dump, contagens, falhas. **Sem esse registro o ensaio não conta.**
5. Apagar o banco descartável e o arquivo decifrado.

## Depois de uma restauração REAL (reconciliação; ainda sem script)

Não afirmar restauração atômica de Neon + R2 + providers. Antes de reabrir qualquer efeito externo:

1. **Quarentena:** ligar o kill switch (`system_flag`, M4-02) para o outbox não enviar nada.
2. **Asaas:** conferir pagamentos e reembolsos desde a data do dump (o reconciliador do M6-04 lê o provedor; reembolso que já saiu **não** pode sair de novo).
3. **Revogações:** reaplicar revogações de acesso e de certificado feitas depois do dump.
4. **Eliminações LGPD:** reexecutar as do registro **fora do banco** (`purge-log/` do M7-05 e o log do M9-10).
5. **E-mail e mídia:** conferir o Resend (o que já foi enviado não reenvia) e o R2 (objetos × linhas).
6. Só então desligar a quarentena.

## Pendências (com dono)

- **Token S3 do R2 (você):** o app NEGOU a criação do token pela CLI. Criar no painel (R2 > Gerenciar tokens de API): permissão **Object Read & Write**, escopo **só o bucket `hub-staging-backups`**, sem TTL curto. Guardar Access Key ID e Secret como segredos do executor (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), mais `BACKUP_S3_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`) e `BACKUP_S3_BUCKET`. Nunca no repositório.
- **Role somente leitura (você):** o app NEGOU o `GRANT`. Rodar no seu terminal: `HUB_BACKUP_PASSWORD="$(openssl rand -hex 32)"` (guarde), `DATABASE_URL_MIGRATION` da role `neondb_owner` por conexão direta e `bun run db:roles:backup staging`. O script confere no fim que a role só lê. **Não use `neon roles create`** (dá `neon_superuser`); a role que criei assim foi apagada.
- **Chave `age`:** o par foi gerado em `C:\Users\Junior\.hub-backup\` (`age-key.txt` = PRIVADA, `age-recipient.txt` = pública). **Copie a privada para pelo menos 2 lugares seus (gerenciador de senhas e um disco offline) e apague-a do repositório de trabalho se quiser**; o ensaio usou essa chave. A pública (`BACKUP_AGE_RECIPIENT`) pode ir como variável do executor.
- **Executor do agendamento:** a decidir (GitHub Actions em repositório administrativo isolado, ou outro). Sem ele não há backup diário nem alerta de frescor.
- **Retenção e lifecycle/bucket lock:** valores propostos (14 diários + 4 semanais; `release/` sem prazo) precisam da sua aprovação e do parecer jurídico (M9-09); lifecycle e lock do bucket ainda NÃO aplicados.
- **Cópia semanal fora da Cloudflare:** destino pendente (cliente).
- **Código ainda não feito:** alerta de backup velho no Operations Center (o Worker precisa saber o último backup: tabela `backup_run` por migration, ou leitura do manifesto; decisão de desenho), script de reconciliação pós-restore e seus testes (pré-reembolso não reenvia; pré-eliminação reexecuta; revogado volta revogado; nenhum e-mail reenviado), limpeza por retenção no bucket, workflow agendado, medição de egress do Neon, o `--upload` (nenhum credencial S3 de escopo mínimo existe ainda).
