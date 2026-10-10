# DNS: inventário e plano de troca de nameservers (M0-09)

**Estado:** rascunho com dados **públicos** coletados em 2026-10-10 (somente consultas DNS e RDAP). **Não houve** criação de zona na Cloudflare nem troca de nameservers. O inventário só fica completo com a exportação da zona feita no painel do provedor atual (seção "O que falta"). Tarefa: [M0-09](../tasks/M0-fundacao.md). Regra: `app.neurocapacitar.com.br` **continua apontando para o legado**; nenhum registro da vNext é criado para `app.` neste marco.

## Fatos verificados (RDAP do Registro.br e DNS público)

| Item | Valor |
|---|---|
| Domínio | `neurocapacitar.com.br`, ativo; registrado em 2026-05-21, expira em 2029-05-21 |
| Registro | Registro.br (`.br`); registrante e contato técnico por identificadores no RDAP (sem nome público); agente de registro `p127` |
| Nameservers atuais | `athena.dns-parking.com` e `apollo.dns-parking.com` (provavelmente o DNS da hospedagem do domínio; TTL da delegação 86400 s) |
| DNSSEC | **desligado** (`delegationSigned: false`): a troca de nameservers não exige mexer em DS |
| SOA (TTL) | 3600 s |

## Registros observados nos servidores atuais

Consultados diretamente nos dois nameservers (respostas idênticas entre eles). Valores de verificação e a chave pública do DKIM foram omitidos de propósito (o repositório não guarda tokens de verificação).

| Nome | Tipo | TTL | Valor | Uso provável |
|---|---|---|---|---|
| `@` | A | 14400 | `76.76.21.21` | Vercel (site/legado) |
| `@` | A | 14400 | `2.57.91.91` | **a confirmar**: segundo IP no apex, de origem desconhecida (hospedagem/construtor de sites?) |
| `@` | MX | 600 | `1 mx1.larksuite.com`, `5 mx2.larksuite.com`, `10 mx3.larksuite.com` | e-mail da equipe (Lark Suite) |
| `@` | TXT | 600 | `v=spf1 +include:spf.onlarksuite.com -all` | SPF do e-mail da equipe |
| `@` | TXT | 600 | `verification-code-site-App_lark=…` (omitido) | verificação de domínio do Lark |
| `@` | NS | 86400 | `apollo.` e `athena.dns-parking.com` | delegação |
| `www` | CNAME | 14400 | `cname.vercel-dns.com` | Vercel |
| `app` | CNAME | 14400 | `d26adff7a43c843e.vercel-dns-016.com` | **legado em produção** (Vercel) |
| `send` | MX | 3600 | `10 feedback-smtp.sa-east-1.amazonses.com` | retorno de e-mails enviados (Resend, via Amazon SES) |
| `send` | TXT | 3600 | `v=spf1 include:amazonses.com ~all` | SPF do envio transacional |
| `resend._domainkey` | TXT | 14400 | `p=…` (chave pública omitida) | DKIM do Resend |
| `_dmarc` | TXT | 3600 | `v=DMARC1; p=none; pct=100; rua=mailto:suporte@neurocapacitar.com.br; adkim=r; aspf=r; ri=86400` | DMARC (só monitoramento; relatórios para o suporte) |

Não encontrei: AAAA, CAA, nem DKIM do Lark nos nomes testados (o seletor do Lark é desconhecido). Isso **não prova que não existem**: DNS não permite listar uma zona, só consultar nomes que já se conhece.

## Observações e riscos

1. **Dois IPs no apex** (`76.76.21.21` é da Vercel; `2.57.91.91` não identifiquei): parte do tráfego do domínio raiz pode estar indo para outro servidor. Confirmar o que é antes de copiar.
2. **O Resend já está configurado** no domínio (`send.` e `resend._domainkey`), usado pelo legado. O Hub vNext vai reaproveitar o domínio de envio: não alterar esses três registros.
3. **O e-mail da equipe depende de MX, SPF e DKIM do Lark**; um erro na cópia derruba o e-mail da empresa. SPF `-all` é restritivo: qualquer remetente novo precisa entrar no SPF.
4. **DMARC `p=none`** não bloqueia nada; subir a `quarantine` é decisão posterior, fora do M0.
5. A Cloudflare só aceita este domínio por **troca de nameservers** no plano Free (a configuração parcial por CNAME é de planos pagos). Todos os registros serão copiados em modo **somente DNS** (sem proxy), para a troca não mudar o comportamento. O proxy só entra no M10, no hostname novo.
6. O CNAME no apex não existe (são A), então não há dependência de "CNAME flattening".

## O que falta (precisa do responsável)

1. **Exportar a zona completa** no painel do provedor de DNS atual (o que serve `dns-parking.com`): lista de todos os registros, inclusive os que eu não conheço (DKIM do Lark, verificações de Google/Meta, `autodiscover`, etc.). Pode ser o arquivo de zona, uma captura de tela ou a lista copiada. Sem tokens de verificação em texto no repositório: manter fora do Git.
2. Dizer **onde se altera a delegação** (nameservers) do domínio: no próprio Registro.br ou no painel do provedor que é o agente de registro (`p127`), e quem tem o acesso.
3. Confirmar o que é `2.57.91.91` e se o segundo IP do apex é intencional.
4. Autorizar a **criação da zona na Cloudflare** (estado "pendente", sem efeito até a troca) para obter os nameservers atribuídos e rodar a comparação. A troca em si é uma etapa **autorizada à parte**.

## Plano de troca (a executar só com o inventário aprovado)

1. **Antes (1 a 2 dias):** reduzir o TTL dos registros críticos (`@` A, `www`, `app`, MX) para 300 s no provedor atual; conferir o TTL da delegação (86400 s: a troca de nameservers pode levar até 24 h para propagar, e o TTL não se reduz do lado do Registro.br).
2. **Criar a zona** na Cloudflare (Free), importar os registros e **desligar o proxy em todos** (somente DNS).
3. **Paridade:** `bun scripts/dns-parity.ts athena.dns-parking.com <ns1 atribuído pela Cloudflare>` (e o segundo NS). Sem `FALTA` nem `SOBRA`, para todos os nomes do inventário (`scripts/dns-names.json`, que precisa incluir **todos** os nomes exportados). O script compara A, AAAA, CNAME, MX, TXT, NS, CAA e SRV; TTL diferente é só informativo.
4. **Janela e execução:** em horário de baixo uso, trocar os nameservers no Registro.br. DNSSEC já está desligado, então não há DS a remover.
5. **Depois:** repetir a paridade contra os servidores novos; conferir `dig`/resolução de `app.` idêntica à anterior (continua no legado); **enviar e receber um e-mail** pelo Lark e um e-mail de teste pelo Resend e ver SPF, DKIM e DMARC passando no cabeçalho.
6. **Rollback:** restaurar os nameservers antigos (`athena.` e `apollo.dns-parking.com`) no Registro.br; como a zona antiga nunca é apagada até a estabilização, o efeito volta com o TTL da delegação. Manter a zona antiga intacta por pelo menos 7 dias após a troca.

## Ferramenta

`scripts/dns-parity.ts` compara os dois servidores de nomes registro a registro (só consultas, somente leitura). Testado em 2026-10-10 entre `athena.` e `apollo.dns-parking.com` (15 registros em cada, paridade total) e por testes unitários do núcleo (`scripts/dns-parity.test.ts`). **Limite:** só confere os nomes listados em `scripts/dns-names.json`.
