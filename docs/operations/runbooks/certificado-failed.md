# Runbook: certificado em `failed`

**Alerta:** `certificate_failed` (P2). A pessoa concluiu o curso, mas a emissão do PDF esgotou as tentativas e ela **ainda não recebeu o certificado**. Resolva em até 2 dias úteis.

## Fatos

- O certificado nasce com a conclusão e o PDF é gerado **de forma assíncrona** (Browser Run, R2 privado, SHA-256, snapshot imutável). O primeiro PDF real em Staging esperou ~16 min pelo Cron: **`queued`/`rendering` por algumas dezenas de minutos é normal**.
- `failed` guarda um **código de falha** (`failure_code`), sem dado pessoal. A emissão **não** apaga nem altera o snapshot.

## Passos

1. `/staff/certificados/emitidos`: localize o certificado em `failed` e leia o código de falha.
2. Causa por código: Browser Run fora do ar ou no limite (plano gratuito: horas por dia; ver a documentação atual antes de culpar o código), R2 recusando gravação, timeout de renderização, dado ausente no snapshot (por exemplo emitente ou signatário). **Corrija a causa primeiro.**
3. **Reenfileirar** (`POST /api/staff/certificates/:id/retry`, na tela "Tentar de novo"; grant `ops.queue`): só funciona se o estado for `failed` (outro estado devolve 409). A tentativa nova gera um PDF e o SHA-256; nada é duplicado.
4. Conferir: o certificado vai a `ready`, a pessoa recebe o e-mail (outbox) e `GET /api/public/certificates/<código>` responde `valid`.
5. Se falhar de novo pelo mesmo código, **pare** e abra issue com o id e o código; não reenfileire em loop (cada tentativa consome Browser Run).

## Não faça

- Editar `certificate` no banco (o gatilho `certificate_guard` bloqueia por desenho) ou emitir "à mão" um PDF fora do sistema: o PDF é evidência com hash.
- Revogar para "limpar" o alerta: revogação é só Admin com reautenticação e muda a validação pública.
