# Runbook: rotação de segredos

Quando: rotina (semestral), suspeita de vazamento, saída de alguém com acesso. **Mudança de segredo exige autorização explícita do responsável** e, em Production, o processo manual. Nunca escreva o valor em chat, log, issue, commit ou captura de tela. Lista de nomes e donos: [environment-and-release-safety.md](../environment-and-release-safety.md#catálogo-de-variáveis-e-segredos-somente-nomes-e-responsável).

## Receita geral

1. Confirme a identidade (`cf auth whoami --profile neurocapacitar`; nunca `wrangler whoami`).
2. Gere o valor novo **fora** do terminal compartilhado (por exemplo `openssl rand -base64 32` no seu terminal; guarde no gerenciador de senhas).
3. Grave no Worker do ambiente certo: `bunx wrangler secret put NOME --name hub-<ambiente> --profile neurocapacitar` (o valor é pedido de forma interativa, não vai na linha de comando).
4. Rode o smoke (`bun run smoke <url> <sha-completo>`) e o fluxo que usa o segredo.
5. Registre no STATUS: nome, ambiente, data, **sem valor**.

## Particularidades (leia antes de trocar)

| Segredo | Efeito e cuidado |
| --- | --- |
| `BETTER_AUTH_SECRET` | assina as sessões: trocar **encerra as sessões** e exige novo login de todos (avise antes; o app instalado pede login de novo) |
| `EMAIL_HASH_KEY` | identifica o destinatário na supressão: **trocar invalida as supressões já registradas** (devoluções e reclamações voltam a poder receber) |
| `VIDEO_SECRETS_MASTER_KEY`, `FINANCE_SECRETS_MASTER_KEY` | **versionadas** (`1:<base64>,2:<base64>`): a mais alta cifra, as outras só abrem. **Acrescente a nova mantendo a antiga**, use "Recifrar com a chave atual" (tela Vídeo; no financeiro, conforme o procedimento do M6-08) e só então retire a antiga. **Perdida a chave, o que ela cifrou não abre** (CPF do pagador, credenciais de vídeo): guarde uma cópia fora da Cloudflare |
| `ASAAS_WEBHOOK_TOKEN` | troque **no painel do Asaas e no segredo ao mesmo tempo**: token diferente = 200 sem gravar (webhook "silencioso"); o reconciliador cobre a janela, mas confira ([asaas-webhook.md](asaas-webhook.md)) |
| `ASAAS_API_KEY`, `RESEND_API_KEY` | gere a nova no provedor, grave no Worker, só então revogue a antiga. **Resend: a conta é compartilhada com o legado; revogue só a chave `vnext-hub-*`** |
| `RESEND_WEBHOOK_SECRET` | o segredo nasce no endpoint do Resend: recrie ou rotacione o endpoint e grave o novo valor juntos |
| `TURNSTILE_SECRET_KEY` | trocar o par (chave do site e segredo) exige **novo build** (a chave do site é variável de build, `VITE_TURNSTILE_SITE_KEY`) |
| `SENTRY_DSN` | ausente = Sentry desligado; DSN é público por desenho, rotacione só se o projeto mudar |
| `DATABASE_URL_MIGRATION`, senha da role `hub_runtime` e do Hyperdrive | trocar a senha da role no Neon **e** a configuração do Hyperdrive juntas; a role de migração fica fora do Worker |
| Token S3 do backup, chave privada do `age` | [backup-and-restore.md](../backup-and-restore.md); a privada do `age` **nunca** vai ao GitHub nem ao Worker |

## Vazamento

Troque primeiro (receita acima), investigue depois. Se o segredo protegia **dados pessoais**, abra também [incidente-dados-pessoais.md](incidente-dados-pessoais.md). Segredo que apareceu em commit: considere-o **queimado** mesmo depois de apagar o commit (o Gitleaks do CI varre o histórico).
