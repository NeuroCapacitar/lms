# Backup e restauração (M9-05)

> Estado: **backup real e ensaio de restauração executados em 2026-10-17 (Staging → PG18 local descartável), com o bucket `hub-staging-backups` criado; falta o token S3, a role somente leitura, o agendamento e a reconciliação pós-restore.** Evidência: `docs/review/evidencias/m9-05/README.md`. Pendências em "Pendências".

Metas a demonstrar no ensaio (não garantias): **RPO ≤ 24 h, RTO ≤ 8 h**. O PITR de 6 h do Neon Free **não** é backup independente.

## O que existe

| Peça | Onde | O que faz |
| --- | --- | --- |
| Núcleo puro | `scripts/backup/backup-core.ts` | manifesto (SHA-256, tamanho, nº de migrations, versão do PG), nome dos objetos, **retenção** (14 diários + 4 semanais; `release/` nunca é apagado), **frescor** (alerta se o último backup íntegro tem mais de 26 h) |
| Travas | `scripts/backup/backup-guards.ts` | só chave **pública** do `age`; dump só por conexão **direta** (nunca pooler nem Hyperdrive); restauração só em banco cujo nome começa por `restore_rehearsal` |
| Backup | `bun run backup:db -- --kind daily\|release --out <pasta> [--upload [--record]]` | `pg_dump -Fc` (cliente PG18), cifra com `age`, grava objeto + manifesto; com `--upload` envia ao bucket S3-compatível (objeto primeiro, manifesto depois) |
| Ensaio | `bun run backup:rehearsal -- --dump … --manifest … --identity …` | confere o SHA-256 **antes** de decifrar, decifra, `pg_restore` no banco descartável, confere migrations e contagens, mede tempo e idade do dump |
| Role | `scripts/db/setup-backup-role.ts` (`bun run db:roles:backup <ambiente>`) | cria `hub_backup`: lê tudo (`pg_read_all_data` com `inherit true`) e só tem INSERT em `backup_run`; sem `neon_superuser`, `BYPASSRLS`, DDL nem outro DML, e FALHA se sobrar algum privilégio; testada no PG18 local (lê, não escreve, não cria, `pg_dump` funciona) |
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

## Decisões do responsável (2026-10-18, [ADR 0033](../adr/0033-m9-05-m9-06-backup-agendado-alertas-e-registro-de-incidentes.md))

- **Executor:** workflow no **mesmo repositório** (`.github/workflows/backup-staging.yml`, diário às 03:17 UTC e manual; só Staging). **Production não usa este modelo** (a spec proíbe credencial de Production no GitHub comum): o executor de Production é decisão do M10.
- **Retenção por ciclo de vida do R2** (aplicada em `hub-staging-backups`): `daily/` 14 dias, `weekly/` 35 dias (cópia de domingo), `release/` 90 dias. Sem script de limpeza.
- **Sem bucket lock** e **sem cópia fora da Cloudflare** no início (risco aceito: a Cloudflare é ponto único de falha).
- **`backup_run`**: o executor registra cada backup enviado; o Worker alerta `backup_never` (P2) e `backup_stale` (P1, mais de 26 h).

## Passos que dependem de você (nesta ordem)

1. **Migration 0041 no Staging** (eu aplico depois do merge do PR; sem ela o passo 3 falha).
2. **Token S3 do R2** (o app NEGOU a criação pela CLI): painel da Cloudflare, R2, *Gerenciar tokens de API*, permissão **Object Read & Write**, escopo **só o bucket `hub-staging-backups`**. Guarde o *Access Key ID* e o *Secret*.
3. **Role `hub_backup`** (o app NEGOU o `GRANT`). Gere uma senha NOVA e guarde (PowerShell, gerador criptográfico):

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

   Depois, no mesmo terminal (a senha entra na variável, nunca no chat):

```powershell
$env:HUB_BACKUP_PASSWORD = "<a senha gerada>"; $env:DATABASE_URL_MIGRATION = (neon connection-string --project-id dry-term-45495258 --pooled false --ssl require --role-name neondb_owner --profile neurocapacitar); bun run db:roles:backup staging
```

   O script confere no fim que a role só lê e só insere em `backup_run`. **Não use `neon roles create`** (dá `neon_superuser`). **A senha colada no chat em 2026-10-18 deve ser descartada.**
4. **Segredos e variáveis do GitHub** (Settings > Secrets and variables > Actions; os nomes estão no cabeçalho do workflow): secrets `STAGING_BACKUP_DATABASE_URL` (`postgresql://hub_backup:<senha>@<host direto do Neon>/neondb?sslmode=require`, o mesmo host da URL de migração), `STAGING_BACKUP_S3_ACCESS_KEY_ID`, `STAGING_BACKUP_S3_SECRET_ACCESS_KEY`; variables `STAGING_BACKUP_S3_ENDPOINT` (`https://<id da conta>.r2.cloudflarestorage.com`), `STAGING_BACKUP_S3_BUCKET` (`hub-staging-backups`) e `BACKUP_AGE_RECIPIENT` (o conteúdo de `age-recipient.txt`, chave PÚBLICA).
5. **Disparar** o workflow `Backup Staging` à mão (Actions > Run workflow, branch `main`) e conferir: objeto no bucket, linha em `backup_run`, alerta `backup_never` sumindo no próximo ciclo do Cron.
6. **Chave privada do `age`**: copie `C:\Users\Junior\.hub-backup\age-key.txt` para pelo menos **2 lugares seus** (gerenciador de senhas e um disco offline). Sem ela os backups não abrem.

## Pendências

- **Primeiro ensaio com o R2 de verdade** (download do bucket, decifrar, restaurar): depois do passo 5.
- **Production:** executor do backup (M10), segredos fora do GitHub comum.
- **Parecer jurídico** sobre a retenção (14, 35 e 90 dias) e sobre dado pessoal em backup (M9-09).
- **Código ainda não feito:** script de reconciliação pós-restore e seus testes (pré-reembolso não reenvia; pré-eliminação reexecuta; revogado volta revogado; nenhum e-mail reenviado), medição de egress do Neon.
