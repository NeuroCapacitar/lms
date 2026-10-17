# Backup e restauração (M9-05)

> Estado: **código local pronto e testado; nada rodou contra um banco real e nenhum recurso remoto foi criado.** O que falta e depende de autorização ou de decisão do responsável está em "Pendências".

Metas a demonstrar no ensaio (não garantias): **RPO ≤ 24 h, RTO ≤ 8 h**. O PITR de 6 h do Neon Free **não** é backup independente.

## O que existe

| Peça | Onde | O que faz |
| --- | --- | --- |
| Núcleo puro | `scripts/backup/backup-core.ts` | manifesto (SHA-256, tamanho, nº de migrations, versão do PG), nome dos objetos, **retenção** (14 diários + 4 semanais; `release/` nunca é apagado), **frescor** (alerta se o último backup íntegro tem mais de 26 h) |
| Travas | `scripts/backup/backup-guards.ts` | só chave **pública** do `age`; dump só por conexão **direta** (nunca pooler nem Hyperdrive); restauração só em banco cujo nome começa por `restore_rehearsal` |
| Backup | `bun run backup:db -- --kind daily\|release --out <pasta> [--upload]` | `pg_dump -Fc` (cliente PG18), cifra com `age`, grava objeto + manifesto; com `--upload` envia ao bucket S3-compatível (objeto primeiro, manifesto depois) |
| Ensaio | `bun run backup:rehearsal -- --dump … --manifest … --identity …` | confere o SHA-256 **antes** de decifrar, decifra, `pg_restore` no banco descartável, confere migrations e contagens, mede tempo e idade do dump |
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

- **Responsável / autorização:** criar o bucket de backup separado e o token S3 de escopo mínimo no R2; gerar o par de chaves `age` (a privada fica com o responsável); definir a role Postgres somente leitura para o dump; escolher o executor do agendamento (GitHub Actions em repositório administrativo isolado, ou outro); aprovar retenção e lifecycle/bucket lock; destino da cópia semanal fora da Cloudflare.
- **Ambiente:** instalar o cliente PG18 (`pg_dump`, `pg_restore`) onde o backup e o ensaio rodarem (não está instalado nesta máquina; instalar é um download).
- **Código ainda não feito:** alerta de backup velho no Operations Center (precisa o Worker saber o último backup: tabela `backup_run` por migration ou leitura do manifesto; decisão de desenho), script de reconciliação pós-restore e seus testes (pré-reembolso não reenvia; pré-eliminação reexecuta; revogado volta revogado; nenhum e-mail reenviado), limpeza por retenção no bucket, workflow agendado, medição de egress do Neon.
