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

## Depois de uma restauração REAL (reconciliação, `bun run restore:reconcile`)

Não afirmar restauração atômica de Neon + R2 + providers. **Nunca restaure direto em Production sem revisão.** O banco restaurado está atrasado em relação ao mundo; antes de reabrir qualquer efeito externo, na ordem (sem `--execute` o script só mostra o que faria; `status` é sempre só leitura):

```bash
bun run restore:reconcile <ambiente> status
```

1. **Quarentena** das duas filas (`finance` e `general`), com o motivo na auditoria:

```bash
bun run restore:reconcile <ambiente> quarantine --execute --reason "restauração de AAAA-MM-DD"
```

2. **Pagamentos no Asaas** (precisa de `ASAAS_API_KEY` e `ASAAS_API_BASE_URL` no ambiente): relê cada pagamento de pedido aberto ou concluído e aplica a evidência pelo caminho normal. Um **reembolso feito depois do backup** revoga o acesso e fecha o pedido; um pagamento confirmado depois concede o acesso. O executor de reembolso **não reenvia** um estorno que já existe no Asaas (testado). Falha ou 429 do Asaas **interrompe** e diz quantos faltam: repita antes de seguir.

```bash
bun run restore:reconcile <ambiente> resync-payments --execute
```

3. **E-mails que estavam pendentes** no backup saem da fila (podem já ter sido enviados; reabrir a fila os mandaria de novo ou mandaria um link de acesso vencido). O resumo diz quantos por modelo: o que for importante (certificado pronto, acesso liberado) a Staff reenvia à mão.

```bash
bun run restore:reconcile <ambiente> supersede-emails --execute
```

4. **Eliminações LGPD** (pessoas que pediram exclusão depois do backup "voltaram"): reaplicar pelo registro fora do banco, primeiro em ensaio:

```bash
bun run privacy:request <ambiente> reapply --log-dir <pasta-dos-registros> --execute
```

5. **Revogações e suspensões** feitas depois do backup (certificados, direitos, matrículas e contas): reaplicar pelo **registro fora do banco** ([ADR 0034](../adr/0034-registro-das-revogacoes-fora-do-banco.md)). Baixe o `revocation-log/` do bucket de mídia **privada** do ambiente (`aws s3 sync s3://hub-<ambiente>-media-private/revocation-log <pasta> --endpoint-url https://<id da conta>.r2.cloudflarestorage.com`, com um token do R2 de **leitura** desse bucket, que ainda NÃO existe) e reaplique, primeiro em ensaio:

```bash
bun run restore:reconcile <ambiente> reapply-revocations --log-dir <pasta> --execute
```

   Vale o **último** evento de cada conta e matrícula (suspensão levantada não volta a bloquear); revogar certificado e direito é definitivo. O resumo diz quantos foram aplicados, já estavam e **não existem na cópia restaurada** (nasceram depois do backup).
6. **Conferir à mão o que o script NÃO enxerga** (abaixo) e só então **liberar**:

```bash
bun run restore:reconcile <ambiente> release --execute --reason "reconciliação concluída"
```

### O que a reconciliação NÃO recupera (lacunas conhecidas)

- **Pedidos e pagamentos criados DEPOIS do backup** não existem no banco restaurado e o leitor do Asaas não lista por data: conferir no **painel do Asaas** (pagamentos desde a data do backup) e, para cada um, criar a matrícula pela tela de matrícula manual ou pela revisão financeira.
- **Revogações feitas nos últimos 30 min antes da restauração** (ou com o R2 fora do ar) podem não ter chegado ao registro: o alerta `revocation_export_stuck` avisa do atraso; confira a auditoria do ambiente de origem, se ainda existir, e reaplique à mão o que faltar.
- **E-mails** já enviados e retirados da fila não são reenviados (de propósito); **Resend**: conferir no painel o que saiu depois do backup.
- **Mídia no R2:** objetos enviados depois do backup ficam sem linha (órfãos, a limpeza do M5-07 os trata em 24 h); linhas sem objeto aparecem como erro ao abrir: comparar objetos e linhas.
- **Certificados:** o PDF e o hash estão no R2; certificado emitido depois do backup não tem linha (a pessoa pede de novo ao concluir; o código é novo).
- **Sessões e links de acesso:** as sessões restauradas continuam valendo; se o backup for de antes de uma troca de segredo ou de uma suspensão, repita a suspensão.

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
- **Reconciliação pós-restore:** script e testes prontos (quarentena, releitura no Asaas, e-mails retirados, reaplicação das exclusões); **faltam** o registro das revogações fora do banco (decisão) e o ensaio completo com um banco restaurado de verdade (depende dos passos acima). Medição de egress do Neon também pendente.
