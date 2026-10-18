# Alertas, gatilhos de upgrade e custo de logs (M9-06)

> Estado: **taxonomia e limites escritos, alertas do Cron em código com teste; faltam o monitor sintético, a entrega por e-mail e o exercício com uma pessoa.** Sem plantão 24/7 ([segurança e operação §6](../spec/security-operations.md)). Os passos de cada alerta estão em [runbooks/](runbooks/README.md).

## Como os alertas funcionam hoje

O job `ops.alerts` do Cron (a cada 30 min) lê o estado, avalia `evaluateAlerts` (`src/features/ops/operations.ts`, pura e testada) e **registra um evento por alerta no log do Worker** (`ops_alert`, só `P?:codigo`, sem dado pessoal). A tela **Operação** da Staff (`/staff/operacao`) mostra os mesmos alertas e o estado. Enquanto o problema existir o alerta se repete a cada ciclo (de propósito: não há estado de "já avisei"). **Entrega ativa pelo Sentry** (M9-06, ADR 0033): com `SENTRY_DSN` configurado, o mesmo job envia ao Sentry **um evento por alerta ativo** (agrupado por código; `fingerprint = [código]`; só código, severidade e a mensagem fixa, passando pelo mesmo scrub dos erros) e **não repete** a notificação do mesmo alerta antes de **24 h** (P3: 7 dias). Alerta que some perde o estado, então se voltar notifica na hora; envio que falha é tentado no ciclo seguinte. O estado fica na tabela `alert_state` (migration 0042). **Quem recebe o e-mail é a regra de alerta do próprio Sentry** (a padrão avisa o dono da organização quando surge um problema novo): confira em Sentry > Alerts que ela está ativa para o projeto `hub-vnext-worker`.

## Taxonomia P0 a P3

Tempo de resposta esperado: **horário comercial** (dias úteis), sem plantão. Nos **primeiros 7 dias em produção** a pessoa responsável revê diariamente erros, custos, CU-h do Neon, filas e pendências; depois, rotina semanal.

| Sev. | Significado | Resposta esperada | Alertas de hoje (código) | Ainda sem alerta |
| --- | --- | --- | --- | --- |
| **P0** | site, checkout ou webhook inoperante; banco inacessível; dinheiro ou segurança em risco | no mesmo dia útil, assim que visto | (nenhum no Cron: **o Cron não roda se o banco ou o Worker caem**) | monitor sintético de `/api/health/ready`; pagamento sem reconciliar por dia; vazamento |
| **P1** | disponibilidade, auth ou dinheiro degradados | no mesmo dia útil | `backup_stale` (último backup há mais de 26 h; M9-05), `cron_silent` (Cron sem rodar há mais de 90 min), `queue_stuck:<fila>` (item aberto há mais de 3 h), `dead_letter:finance`, `email_quota_exhausted`, `finance_orders_stuck` (pedido pendente há mais de 2 h), `finance_review_open` com a mais antiga há mais de 24 h, `database_size_critical` (banco acima de 900 MB) | Hyperdrive perto de 100 mil consultas/dia |
| **P2** | degradação | até 2 dias úteis | `backup_never` (nenhum backup registrado), `cron_never_ran`, `job_failed:<job>`, `queue_slow:<fila>` (mais de 1 h), `dead_letter:general`, `queue_paused:<fila>`, `webhook_silent:resend`, `finance_review_open`, **`certificate_failed`** (M9-06) | erros novos no Sentry |
| **P3** | informativo | rotina semanal | `failed_items`, `email_quota_upgrade` (60% em 7 dias), `webhook_silent:asaas`, **`database_size_upgrade`** (banco acima de 600 MB, M9-06) | custo e CU-h do Neon |

Limites iniciais: `OPS_THRESHOLDS` em `src/features/ops/operations.ts`. **Não são SLO**: o que está lá é o que o desenho de recuperação já implica. **SLOs só depois de uma linha de base com tráfego real** (a spec). SLIs a medir então: disponibilidade, sucesso do link de acesso, registro de progresso, checkout, idade da operação financeira pendente e tempo de emissão do certificado.

## Gatilhos de upgrade (nova decisão do responsável, nunca automática)

| Recurso | Gatilho | Quem mede | Alerta |
| --- | --- | --- | --- |
| Neon: tamanho | banco acima de **600 MB** (limite do Free: 1 GB; confirmar o limite atual no provisionamento) | o próprio Cron (`pg_database_size`) | `database_size_upgrade` (P3) e `database_size_critical` (P1, 900 MB) |
| Neon: computação | consumo acima de **70 CU-h/mês** (Free: 100); o Cron de 30 min sozinho ≈ 32 CU-h/mês; regra de saída da ADR 0032: **55 CU-h/mês projetados** | **manual** (console ou `neon` CLI, `active_time_seconds`); o Worker não enxerga | sem alerta |
| Neon: perda de dados | **primeiro incidente** de perda | quem detecta | sem alerta; abre o runbook de restauração |
| Resend | uso dos últimos 7 dias acima de **60% da cota mensal** (M4-08; leitura a confirmar com o responsável) | Cron | `email_quota_upgrade` (P3) |
| Workers (CPU e requisições) | Error 1102 (10 ms de CPU, plano gratuito) ou 100 mil requisições/dia | log e painel | decisão já tomada: **Workers Paid no fim do desenvolvimento** (ADR 0003 e 0032) |
| Hyperdrive | **100.000 consultas/dia** no plano gratuito (acima disso o banco fica inacessível até 00:00 UTC; ocorreu em 2026-10-17) | painel da Cloudflare | sem alerta; ver o runbook do Neon |
| R2 | 10 GB no Free, somados mídia, PDFs, imagens e backups | painel | sem alerta |

## Custo de logs (passo 5)

Fatos da documentação oficial atual (consultada em 2026-10-18): **Workers Logs no plano gratuito: 200.000 eventos por dia e 3 dias de retenção; no pago: 20 milhões por mês incluídos, depois US$ 0,60 por milhão e 7 dias**; a partir de **1 de dezembro de 2026** passa a valer o preço de Cloudflare Observability (**não consultei esse preço: conferir em `developers.cloudflare.com/observability/pricing` antes dessa data**).

Estado do projeto: `observability.enabled` com `invocation_logs: false` (um log por evento que o código emite, não um por requisição); sem `head_sampling_rate` (padrão 100%). **Decisão (minha, aberta a correção): manter 100% por ora.** Com cerca de 20 pessoas o volume é muito menor que 200 mil por dia, e a amostragem por cabeça descartaria também os logs de erro da requisição. Reabrir se o volume medido passar de ~50% da franquia diária ou se a cobrança de dezembro mudar a conta. Regras que continuam valendo: **sem payload e sem PII nos logs** (o `evlog` e o `beforeSend` do Sentry já filtram).

## Pendências (com dono)

- **Monitor de "site fora":** decidido usar o **Sentry** (Uptime Monitor e/ou Cron Monitor; [ADR 0033](../adr/0033-m9-05-m9-06-backup-agendado-alertas-e-registro-de-incidentes.md)), **sujeito ao que o plano gratuito inclui** (a conferir no faturamento do Sentry; monitor a mais custa por monitor). **Monitorar `/api/health/live`**, não `ready` a cada poucos minutos (mantém o Neon acordado o mês todo).
- **Entrega ativa dos alertas:** pronta no código (Sentry, no máximo um evento por código a cada 24 h); **só passa a valer depois da migration 0042 e de um deploy** do Worker no ambiente, e depende de a regra de alerta do Sentry estar ativa.
- **Alerta de backup velho:** pronto (`backup_stale` e `backup_never`, tabela `backup_run`); só passa a ter dado quando o workflow de backup rodar (ver o runbook de backup).
- **Exercícios de falha em Staging com uma pessoa** (reconhecer o alerta e executar o passo): ainda não feitos; os runbooks nunca foram seguidos por quem não os escreveu. Sem isso o aceite do M9-06 não está cumprido.
- **Registro de incidentes:** pronto (tela `/staff/incidentes`, tabela `privacy_incident`, migration 0043; ADR 0033); **só passa a valer depois da migration e de um deploy**.
- **Texto de privacidade e prazo de comunicação à ANPD** nos runbooks vêm de fonte secundária: o advogado precisa confirmar.
