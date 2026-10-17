# M9-05 — evidência do primeiro backup e do ensaio de restauração (2026-10-17)

Autorização: "tem autorizacao para todos eles, prossiga" (instalar o cliente PG18, criar bucket e token, gerar as chaves, definir a role, escolher o executor). Identidade conferida antes (`neon me`, `cf auth whoami`, perfil `neurocapacitar`). **Só Staging, dados sintéticos, nada em Production.**

## O que foi feito

| Passo | Resultado |
| --- | --- |
| Cliente PG18 | Baixado o zip oficial dos binários do PostgreSQL 18.6 (EDB, 384 MB) para `C:\Users\Junior\tools\pg18` (fora do repositório). `pg_dump` e `pg_restore` 18.6. O hash do zip NÃO foi conferido contra a página do fornecedor. |
| Chaves `age` | Par gerado em `C:\Users\Junior\.hub-backup\` (privada nunca impressa nem no repositório). |
| Bucket | `hub-staging-backups` criado no R2 (perfil `neurocapacitar`), vazio; os buckets de mídia e os legados não foram tocados. |
| Backup real | `bun run backup:db -- --kind daily` contra o Neon de Staging (conexão direta, role `neondb_owner` só para LER): `daily/2026-10-17/hub-20261017T174949Z.dump.age`, **221.019 bytes**, SHA-256 `8de3b4f711f7…`, **41 migrations**. Gravado só em disco local (sem upload: falta o token S3). |
| Ensaio de restauração | PG18 local descartável (`restore_rehearsal_20261017`): manifesto conferido ANTES de decifrar; **decifrar 0,1 s, restaurar 0,8 s, total 1,0 s**; idade do dump 0,1 h. As contagens restauradas (user 6, course 1, enrollment 6, purchase_order 0, payment 0, certificate 3, outbox_message 5) **são iguais às do banco de origem**, lidas em seguida. |
| Role somente leitura | Testada no PG18 local: `select` funciona, `delete` e `create table` são negados, `pg_dump` funciona. **Descoberta:** com `noinherit` (como a role de runtime) o `pg_read_all_data` não vale; e no PG16+ o `GRANT` guarda o `inherit` da hora da concessão, então é preciso `with inherit true`. |

## Incidente menor (meu)

Criei `hub_backup` com `neon roles create`; o Neon a fez membro de `neon_superuser` (CREATEDB, CREATEROLE, BYPASSRLS). O app negou o `GRANT` que a restringiria e eu **apaguei a role** (`neon roles delete`), então nenhuma role privilegiada ficou no Staging. Lição: nunca criar a role de backup pelo `neon roles create`; usar `bun run db:roles:backup`.

## Medições e o que elas NÃO provam

- RTO medido: **1 s** para um banco de **221 KB** (6 pessoas, 1 curso). **Não extrapola** para o banco real: o ensaio precisa ser repetido com volume parecido com o de produção e com a rede real (download do R2, Neon de Dev em vez de um PG local).
- RPO: o dump tinha 0,1 h; o RPO real depende de o backup diário rodar, e **não há agendamento**.
- O ensaio foi em PG18 **local**, não em projeto Neon de Dev; extensões e roles do Neon não foram exercitadas (`--no-owner --no-acl`).
- `--upload` e o download do R2 NÃO foram exercitados (sem token S3).
- Não testado ainda: dump antigo contra efeitos externos (pré-reembolso, pré-eliminação LGPD, revogação): é a reconciliação pós-restore, não feita.
