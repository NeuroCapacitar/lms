# Runbook: cota ou webhook do Resend

**Alertas:** `email_quota_exhausted` (P1), `email_quota_upgrade` (P3), `webhook_silent:resend` (P2).

## Fatos

- O Resend Free permite **100 e-mails por dia e 3.000 por mês**. O sistema reserva a cota **antes** de enviar (livro-razão em UTC); sem cota, o envio é **adiado** (não falha) até a meia-noite UTC.
- O **link de acesso** (magic link) também consome cota, mas **20 dos 100 e-mails do dia são reservados a ele** (`loginReserve`): e-mails de outros tipos param antes. Com a cota do dia esgotada, o pedido de link recebe `503 email_unavailable` (decisão do responsável) e a tela avisa a pessoa; a cota volta na meia-noite UTC (21:00 em Brasília).
- Gatilho de upgrade: uso dos últimos 7 dias acima de **60% do que o plano permite** (leitura a confirmar com o responsável).
- A conta do Resend é **compartilhada com o legado**: não apague chaves, domínios nem modelos que não sejam `vnext-*`/`vnext-hub-*`.

## Passos: cota esgotada (P1)

1. `/staff/operacao`: veja o uso do dia, do mês e dos 7 dias e a fila de e-mails adiados.
2. Pessoas que não receberam o link: **não** reenvie em massa. Oriente a tentar de novo depois das 21:00 (Brasília) ou, em emergência, o responsável concede o acesso por outro caminho aprovado.
3. Se o consumo é anormal, procure a causa: loop de reenfileiramento ([fila-e-dlq.md](fila-e-dlq.md)), robô pedindo link (o Turnstile e o limite por IP existem; veja `auth_throttle`).
4. Depois da meia-noite UTC os adiados saem sozinhos; confirme que `email_message` volta a `accepted`/`delivered`.

## Passos: upgrade (P3)

Abra a decisão com o responsável: o plano pago do Resend é um custo **fora** do teto de US$ 10/mês (ADR 0003); **nunca contratar sem decisão explícita**.

## Passos: webhook silencioso (P2)

1. Há e-mails `accepted` nas últimas 24 h mas nenhum evento chegou. Confira no painel do Resend se o **endpoint** do ambiente existe (`/api/webhooks/resend`) e está ativo, e se `RESEND_WEBHOOK_SECRET` do Worker é o do endpoint (Svix: assinatura inválida é recusada).
2. Sem o webhook, entregas, devoluções e reclamações **não** atualizam a supressão: corrija no mesmo dia útil.
3. Troca do segredo: [rotacao-de-segredos.md](rotacao-de-segredos.md).
