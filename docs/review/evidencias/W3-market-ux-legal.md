# W3 — Mercado, UX do aluno e obrigações legais para a LMS vNext (NeuroCapacitar Hub)

- **Data da pesquisa:** 2026-10-09 (todas as leituras de URL abaixo foram feitas nesta data, salvo indicação).
- **Natureza:** pesquisa de produto/mercado e levantamento jurídico **não constitui parecer jurídico ou contábil**. Pontos legais marcados como relevantes devem ser validados por advogado/contador antes de virar regra.
- **Escopo:** subsídio para decidir o que manter, retirar ou adicionar na vNext (single-tenant, centenas de alunos, poucos cursos, venda avulsa via Asaas, certificados próprios). Este documento **não altera** decisões B1–B16; quando um achado conflita com uma decisão vigente, ele aparece como "ponto para decisão".

## Legenda de confiabilidade

| Marca | Significado |
|---|---|
| **[O]** | Fonte oficial/primária lida (texto legal, site/help center/pricing do fornecedor, W3C, artigo científico) |
| **[S]** | Fonte secundária lida (escritório de advocacia, imprensa especializada, blog de contabilidade, agregador) |
| **[NC]** | Não confirmado: fonte não acessível nesta data, divergência entre fontes, ou afirmação baseada em conhecimento prévio não relido |

## Limitações de coleta (ler antes)

1. O portal **planalto.gov.br** recusou conexão (ECONNRESET) durante toda a sessão. Textos legais foram lidos nas cópias oficiais da **Câmara dos Deputados** (www2.camara.leg.br) quando possível; quando nem isso foi possível, o fato está marcado [NC] ou [S].
2. O **Reclame Aqui** bloqueia leitura direta (HTTP 403); dados vieram de páginas indexadas ou de relatório da própria empresa.
3. O orçamento de buscas web da sessão esgotou no fim da coleta; alguns pontos finais (guia de cookies da ANPD, Marco Civil art. 15, LC 116/2003) ficaram sem releitura e estão marcados [NC].
4. Preços e recursos de SaaS mudam com frequência; números de preço/taxa valem para a data de leitura.

---

## Sumário executivo

1. **Mercado BR (§1):** as plataformas de infoproduto competem no **comercial** (Pix/boleto/cartão 12x a 3,49% a.m., order bump, upsell, afiliados, assinatura; taxas de ~3% a 9,9% + R$ 1–2,50 por venda). Na área de membros o padrão é drip, comentários, quiz e certificado automático. **Validação pública de certificado por QR é diferencial real** (só Hotmart, Memberkit e Cademí documentam). **Nenhuma plataforma emite NF ao comprador**; o produtor emite via eNotas/Notazz. Memberkit e Cademí já integram Asaas.
2. **Mercado internacional (§2):** padrão 2026 = resume/progresso, quiz, comentários por aula, certificado com ID + página pública + LinkedIn, **legendas/transcrição automáticas**, analytics de vídeo e app. Diferenciais = notas do aluno, busca na fala do vídeo, tutor de IA (pago à parte), offline com sync, live nativo e **acessibilidade WCAG comprovada** (rara nos SaaS para criadores). O limiar de 90% da vNext coincide com Teachable e Kajabi.
3. **Evidências (§3):** o que move a conclusão é **desenho pedagógico**: vídeos curtos (mediana assistida ≤ ~6 min), quizzes intercalados, discussão por aula, ritmo/turma e ativação na 1ª semana. Nudges e gamificação têm efeito pequeno ou nulo em escala. As reclamações BR giram em torno de **acesso/e-mail, prazo de acesso ("vitalício"), reembolso e certificado** (atraso, nome errado), mais do que de player.
4. **Direito (§4):** o arrependimento de 7 dias deve ser honrado de forma integral; o Decreto 7.962 exige informações no site, sumário do contrato, confirmação imediata, atendimento com resposta em ≤ 5 dias e **desistência pelo mesmo meio da contratação**. **NFS-e:** municípios no padrão nacional desde 01/01/2026; **ME/EPP do Simples obrigadas ao Emissor Nacional a partir de 01/11/2026** (Res. CGSN 191/2026, fonte secundária); IBS/CBS no Simples a partir de 2027; cursos livres provavelmente fora da redução de 60% da educação. Certificado de curso livre não exige MEC nem ICP-Brasil; hash + verificação pública bastam.
5. **LGPD (§5):** a base principal é a execução de contrato; marketing por consentimento. Há **risco de dados sensíveis de terceiros (pacientes/crianças) em discussões**. Marco Civil: logs de acesso por 6 meses. Os direitos do titular têm prazo de 15 dias (em dobro para pequeno porte). O agente de pequeno porte é dispensado de encarregado, mas não de canal. **Cloudflare e Resend não oferecem as cláusulas-padrão da ANPD** (prazo de adequação encerrado em 23/08/2025): decisão jurídica pendente. Incidentes: 3 dias úteis (6 para pequeno porte) e registro por 5 anos. ECA Digital vigente desde 17/03/2026; mitiga-se declarando público adulto.
6. **Acessibilidade (§6):** a LBI art. 63 obriga empresas privadas; **legendas são WCAG nível A**.
7. **Build vs buy (§7):** o risco dominante é manutenção, não infraestrutura. As armadilhas são progresso de vídeo por intervalos, abas em background, links de e-mail consumidos por scanners e acentos no PDF.

---

## 1. Plataformas brasileiras de área de membros e infoprodutos

> Todas as URLs lidas em 2026-10-09. A Central de Ajuda da Hotmart não renderiza via fetch; os fatos marcados "(snippet)" vieram do trecho exibido pelo buscador para a URL oficial [S]. Preços e taxas podem mudar.

### 1.1 Tabela comparativa

| Plataforma | Drip | Quiz | Certificado + validação | Comentários / comunidade | Gamificação | App / offline | Proteção de vídeo | Pix / boleto / cartão / parcelamento | Assinatura | Cupom / order bump / upsell | Afiliados | NF ao comprador | Preço / taxa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Hotmart (Club)** | D+N, data fixa, por nota de quiz; expiração | Sim ("Drill" com nota mínima e intervalo; "Perfil") | Ao atingir 100% do consumo; **QR de autenticidade**; nome não editável após 1ª emissão | Sim / comunidades | Ranking, pontos | App Hotmart; **offline com validade de 14 dias renovável** | Marca d'água com ID do comprador, DRM, bloqueio de plugins, domínios permitidos | Sim/sim/sim; 3,49% a.m.; "Parcelado Hotmart" | Sim | Cupom [NC] / OB sim / upsell [NC] | Sim | Produtor emite; eNotas (adquirida) integra | **9,9% + R$ 2,49** (até 8,9% + R$ 2,49 na faixa de 6 dígitos); D+30 |
| **Kiwify** | Imediato, D+N, data | Múltipla escolha | Automático ao concluir; validação [NC] | Comentários com moderação / comunidade [NC] | [NC] | App para alunos (sem detalhes) / offline [NC] | [NC] | Sim/sim/sim; até 12x, 3,49% a.m. pago pelo comprador; 2 cartões | Sim | Cupom 1–95% / até 5 OB / upsell 1-clique | Sim | eNotas e Notazz (lote diário); Kiwify não emite | **8,99% + R$ 2,49**; Pix D+0 a D+2; cartão D+15 |
| **Eduzz (Membros/Nutror)** | Por curso, módulo ou aula, com data | Conteúdo tipo "prova" | % mínimo de aulas; validação [NC] | Públicos/privados, moderados | [NC] | App Nutror iOS/Android **com offline** | SafeVideo ("Imprint"; mecanismo [NC]) | Sim/sim/sim; encargo 3,49%; dividir em mais de um cartão | Sim | Até 10 cupons / OB / upsell 1-clique | Sim | Produtor emite; Central de Documentos Fiscais; Smart Notas | **4,9% / 6,9% / 4,59% + R$ 2,49**; saque R$ 1,99; D+30 (Unity D+15) |
| **Memberkit** | **9 regras**: data, D+N, pontos, conclusão de aula/módulo/curso, oculto, bloqueado | Múltipla escolha, nota mínima | Automático a 100%, enviado por e-mail; **QR → página oficial de validação + página de auditoria** | Sim / comunidades | Pontos, top 10, desbloqueio por pontos | [NC] (sem artigo de app) | Vídeo externo (Panda, Vimeo, YouTube, Smart Player); **bloqueia logins simultâneos** | **Não processa** (integra Hotmart, Kiwify, **Asaas**, Pagar.me etc.) | Via gateway | — | — | — | SaaS **R$ 197 / 497 / 697 por mês** (1k / 5k / 15k membros); IA com créditos à parte |
| **Cademí** | D+N, data, "em breve", oculto, aprovação em prova | Provas | Por tempo, %, prova ou sempre; **QR**; numeração sequencial | "Comentários e perguntas" | Ranking/pontos [S] | **Só PWA** (sem lojas) | Hospedagem externa (Panda, Videofront "DRM social", VdoCipher) | Não processa (50+ gateways, inclui **Asaas**) | Via gateway | Ofertas/funis (PopSell) | — | — | Sob consulta |
| **Curseduca → WAID** | [NC] | [NC] | "15 certificados MEC/ano" no PRO; validação [NC] | Comunidade e feed | Pontos, níveis, desafios | **App white-label nas lojas**; offline com sync | Player próprio (CPlayer); proteção [NC] | Não processa | — | — | — | — | 12x R$ 997 (Evolution) / 12x R$ 1.997 (PRO) no anual; sem comissão |
| **Astron Members** | [NC] | "Provas ilimitadas" | Emissão sim; validação [NC] | Comunidades privadas | [S] pontos/conquistas/ranking | App iOS/Android a partir do Professional | Hospedagem própria + DRM | Checkout próprio cartão/Pix/boleto; 50+ gateways | [NC] | Upsell sim | [NC] | [NC] | Grátis (10 membros); R$ 147 / 297 / 587 / 1.197 por mês; sem taxa por venda |
| **Greenn (Club 2.0)** | Por turma, com data | Questionário | **Conflito**: página do Club diz automático; Central de Ajuda diz que não há ferramenta nativa | [NC] | [NC] | App com push; download de vídeo só no app | Marca d'água em arquivos; limite de usuários simultâneos | Sim/sim (boleto parcelado 12x)/sim até 12x; 2 cartões; PayPal | Sim | OB / upsell 1-clique | Sim | [NC] | **4,99% + R$ 1** (com afiliado 8,99% + R$ 1); saque R$ 4,99; cartão D+30 |
| **Ticto (Mozart)** | Liberação progressiva; turmas | Com critério de aprovação, pode ser pré-requisito | Ao passar por todos os módulos; "Certificado do MEC" (comercial); validação [NC] | Comentários e avaliações | [NC] | [NC] | "DRM social" | Sim/boleto parcelado/sim; 3,49% a.m. | Sim | Funil com bump, upsell, downsell | Sim | Automática via integrações (produtor responsável) | **6,99% + R$ 2,49**; área de membros grátis |
| **The Members** | [NC] | [NC] | Por faculdade parceira (livre, extensão, pós) | Comunidade com canais | [NC] | **App white-label nas lojas**; offline | Player com antipirataria | **Pix 0%**, cartão/boleto 2,99%; até 18x | Sim | OB / upsell 1-clique / downsell | [NC] | [NC] | + R$ 2,50 por transação; recebimento em 2 dias |
| **HeroSpark** | [NC] | [NC] | Com % definido pelo produtor; validação [NC] | Comentários no app | [NC] | App HeroSpark com offline | Hospedagem própria + "proteção contra pirataria" | Sim/sim/sim; 3,49% a.m.; parcelamento inteligente | Sim | Cupom via URL / OB / upsell | Sim | NF só sobre as próprias taxas | **3,9% + R$ 1** (boleto + R$ 3); saque R$ 4,73; cartão D+30 |

### 1.2 Fontes principais por plataforma (lidas em 2026-10-09)

- **Hotmart:** taxas — https://hotmart.com/pt-br/taxa-hotmart [O] (a página ainda mostra "R$ 1" em outra seção; mudança para R$ 2,49 datada de 21/09/2026 por fonte secundária: https://tactus.com.br/taxas-da-hotmart-para-produtor/); checkout — https://hotmart.com/pt-br/checkout [O]; Club (blog 18/08/2026: trilhas, quiz, certificado, comunidades, gamificação, app, legendas/tradução automática, "continuar de onde parou", anotações, **Hotmart Tutor (IA)**, "Acesso Plus" para até 3 pessoas) — https://hotmart.com/pt-br/blog/hotmart-club [O]; player (marca d'água, DRM, legendas em 70+ idiomas) — https://hotmart.com/pt-br/player [O]; certificado/QR — https://help.hotmart.com/pt-br/article/como-configurar-o-certificado-no-hotmart-club-/115003666771 (snippet); offline 14 dias — https://help.hotmart.com/pt-br/article/10203471099917/como-acesso-e-utilizo-o-aplicativo-da-hotmart- (snippet); termos (reembolso remete a prazos legais; obrigação fiscal do produtor) — https://hotmart.com/pt-br/legal/termos-de-uso [O].
- **Kiwify:** https://kiwify.com.br/ ; parcelamento — https://ajuda.kiwify.com.br/pt-br/article/como-funciona-o-parcelamento-no-checkout-1um5p52/ ; cupons — https://ajuda.kiwify.com.br/pt-br/article/cupons-de-desconto-l808xv/ ; certificado — https://help.kiwify.com/en/article/how-to-configure-a-certificate-17hmpx5/ ; NF — https://ajuda.kiwify.com.br/pt-br/article/como-integrar-com-o-enotas-kof01x/ ; reembolso 7 dias — https://ajuda.kiwify.com.br/pt-br/article/reembolsos-nk5bdq/ [O]
- **Eduzz:** taxas — https://www.eduzz.com/taxas ; Nutror — https://www.eduzz.com/produtos/nutror ; garantia 7–30 dias — https://ajuda.eduzz.com/hc/pt-br/articles/34175176026523 ; NF (produtor emite com nome/CPF fornecidos; 18/08/2026) — https://ajuda.eduzz.com/hc/pt-br/articles/4402651955739-Como-funciona-a-Central-de-Documentos-Fiscais [O]
- **Memberkit:** https://memberkit.com.br/ ; drip — https://ajuda.memberkit.com.br/como-funciona/agendamento-de-conteudo.md ; certificados — https://ajuda.memberkit.com.br/como-funciona/certificados.md ; gamificação — https://ajuda.memberkit.com.br/como-funciona/gamificacao.md [O]
- **Cademí:** https://cademi.com.br/ ; liberação — https://ajuda.cademi.com.br/vitrines/liberacao.md ; certificados — https://ajuda.cademi.com.br/vitrines/emitindo-certificados.md ; app PWA — https://ajuda.cademi.com.br/configuracoes/aplicativo.md [O]
- **Curseduca/WAID:** https://curseduca.com/ (anuncia rebranding para WAID); https://waid.io/ ; https://waid.io/app-white-label/ ; https://waid.io/area-de-membros/ [O]
- **Astron:** https://astronmembers.com.br/planos.html [O]
- **Greenn:** taxas (atualizada 29/09/2026) — https://greenn.com.br/taxas/ ; Club — https://greenn.com.br/club/ ; help — https://ajuda.greenn.com.br/pt-br/category/greennclub-20-23r7te/ [O]
- **Ticto:** taxas — https://help.ticto.com.br/sou-produtor/saques-minha-carteira/taxas.md ; NF — https://help.ticto.com.br/sou-produtor/tictools-integracoes/notas-fiscais.md ; reembolso 7 dias — https://help.ticto.com.br/comprei-pela-ticto/reembolsos-e-suporte/solicitar-reembolso-prazo-e-regras-do-termo-geral-de-compra.md [O]
- **The Members:** https://themembers.com.br/ ; https://themembers.com.br/w [O]
- **HeroSpark:** tarifas (28/01/2026) — https://ajuda.herospark.com/hc/pt-br/articles/1744833490-quais-sao-as-tarifas-de-venda ; NF só sobre taxas — https://ajuda.herospark.com/hc/pt-br/articles/1744833530-nota-fiscal-sobre-as-taxas-da-plataforma [O]

### 1.3 Observações transversais (mercado BR)

**Padrão:**
- Pix, boleto e cartão em todas as que processam pagamento; **parcelamento até 12x a 3,49% a.m.** é praticamente tabela (Hotmart, Kiwify, Eduzz, Ticto, HeroSpark); 2 cartões e boleto parcelado são comuns.
- Order bump, upsell 1-clique, assinaturas, afiliados e coprodução são o **núcleo comercial** dos gateways de infoproduto.
- **Reembolso de 7 dias** é universal; Eduzz aceita garantia até 30 dias.
- **Nota fiscal: quem emite é sempre o produtor.** As plataformas fornecem dados do comprador e integrações (eNotas, Notazz, Smart Notas); **nenhuma emite NF nativamente ao comprador**.
- Área de membros: drip D+N/data, módulos, comentários moderados, certificado automático (a 100% ou % configurável).
- Plataformas SaaS de membros sem checkout (Memberkit, Cademí) **já integram Asaas** — o modelo "área de membros + gateway externo" é comum.

**Diferenciais:**
- **Validação pública de certificado por QR** documentada só em Hotmart, Memberkit (com página de auditoria) e Cademí — é diferencial real no BR.
- Certificado "MEC"/faculdade parceira como argumento comercial (Ticto, The Members, WAID) — não se aplica a curso livre próprio (§4.3).
- **Offline em app** é comum nos apps das plataformas; só a Hotmart documenta **lease** (14 dias, renovado com reconexão).
- **IA tutor treinada no curso** virou tendência em 2026 (Hotmart Tutor, Greenn Mentor.ai, Memberkit, WAID, The Members).
- Proteção de vídeo mais completa documentada: Hotmart Player (marca d'água com ID, DRM, bloqueio de plugins).
- Gamificação bem documentada só em Memberkit, Hotmart e WAID.

**Modelos de preço:** gateway com área de membros grátis cobra de ~3% a 9,9% + R$ 1 a R$ 2,50 por venda; SaaS de membros cobra R$ 147 a ~R$ 2 mil/mês por faixa de membros.

**Pontos não confirmados:** cupom/upsell e máximo de parcelas da Hotmart; gamificação, offline e validação de certificado na Kiwify; certificado nativo da Greenn; preços de Cademí e The Members.

---


## 2. Plataformas internacionais: o que é padrão em 2026

> Legenda: ✅ confirmado em fonte oficial; ◐ parcial/condicional/plano superior; ❌ fonte oficial diz que não existe; ? não confirmado. G2/Capterra devolveram 403. URLs lidas em 2026-10-09.

### 2.1 Tabela comparativa

| Plataforma | Resume / progresso | Notas do aluno | Legenda / transcrição auto | Busca no conteúdo | IA | App / offline | Comunidade | Cohort / live | Assignments | Certificado (verificação / LinkedIn / Open Badges) | Analytics | Acessibilidade declarada | Preço de entrada |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Teachable | ✅ "Start next lecture" + barra | ✅ notas na linha do tempo do vídeo | ◐ legendas/traduções por IA (Growth) | ? | ◐ só criador | ✅ iOS/Android com offline | ✅ comentários por aula; Community (Builder+) | ❌ live nativo | ◐ respostas abertas/formulários | ✅ automático + serial / ? / ✅ LinkedIn / ? | ✅ video stats, heatmap por aluno, **Course Compliance 90%** | ◐ "partially conformant" WCAG 2.1 AA (2021) | US$ 39/mês + 7,5% |
| Thinkific | ◐ progresso ✅ | ? | ✅ AI captions | ? | ✅ tutor "Thinker" (Plus) + gerador de quiz | ◐ app; branded +US$ 199/mês; sem offline de conteúdo | ✅ | ✅ Zoom, live cohorts | ✅ assignments, exams, banco randomizado | ✅ ID + página pública / ✅ LinkedIn / ◐ via apps | ✅ drop-off/rewatch por vídeo | ◐ "working toward" WCAG 2.1 AA | US$ 54/mês |
| Kajabi | ◐ progresso (vídeo conta a 90%) | ? | ✅ transcrição, tradução, dublagem por IA | ◐ busca nas legendas | ✅ Teaching Assistant com citações (pago por agente) | ◐ app + branded; offline ? | ✅ + comentários por aula | ✅ Cohort Courses + live nativo (até 200) | ✅ resposta curta/upload com correção manual | ✅ serial + expiração / ? / ◐ Accredible | ✅ heatmap | ? | US$ 179/mês |
| LearnWorlds | ✅ | ◐ notas em ebook | ✅ transcrição interativa | ✅ transcrição pesquisável | ✅ criador + AI Feedback para aluno | ◐ branded +US$ 149/mês; offline só vídeo, sem sync de progresso | ✅ | ✅ Zoom/Webex | ✅ Review Center | ✅ verificação por ID + LinkedIn / ◐ Accredible/Credly | ✅ heatmap segundo a segundo | ? (overlay accessiBe) | US$ 29/mês + US$ 5/matrícula |
| Podia | ✅ | ? | ◐ | ? | ◐ só criador | ❌ sem app | ✅ | ✅ eventos/webinars | ? | ✅ automático | ◐ | ? | US$ 42/mês + 5% |
| Circle | ◐ % conclusão | ? | ✅ (Business+) | ✅ busca por fala | ✅ AI agents (Scale+) | ✅ app grátis; branded no Plus | ✅ (núcleo) | ✅ live nativo | ? | ❌ sem certificado nativo | ◐ | ? | US$ 89/mês + 2% |
| Skool | ◐ | ? | ✅ só inglês | ◐ via transcrição | ? | ◐ app | ✅ (núcleo) | ✅ Skool Call + calendário | ? | ? | ? (gamificação ✅ níveis) | ? | US$ 9/mês + 10% |
| Maven | ? | ? | ? | ? | ? | ? | ✅ | ✅ cohort ao vivo é o núcleo | ◐ projects | ✅ após reflexão final; página pública; LinkedIn | ? | ? | 10% por matrícula |
| Moodle 5.0–5.3 | ✅; 5.3 navegação linear Prev/Next | ◐ ("Notes" são sobre usuários) | ❌/? não nativo | ✅ Global search | ✅ AI placements (resumir/explicar), desligados por padrão | ✅ app com offline e sync | ✅ fóruns | ? | ✅ assign + banco de questões | ◐ plugin customcert (código, QR, verificação) / ✅ OB 2.0/2.1 nativo; 3.0 pendente | ◐ | ✅ WCAG 2.1 AA acreditado; VPAT out/2025 | open source |
| Open edX | ✅ resume no app | ✅ Notes com tags e busca | ◐ transcrições suportadas | ◐ | ✅ assistente de IA por unidade (Verawood, jun/2026) | ✅ app; offline ? | ✅ | ? | ✅ ORA (pares/auto) | ✅ URL de verificação + "Add to profile" LinkedIn / ◐ Credly/Accredible | ◐ | ? | open source |
| Canvas | ◐ | ? | ✅ legendas automáticas editáveis (Studio) | ✅ course search | ✅ IgniteAI | ✅ app; offline ? | ✅ | ? | ✅ SpeedGrader | ◐ Parchment/Badgr | ✅ Studio Insights | ✅ VPATs | sob cotação |
| Tutor LMS | ? | ✅ realces/notas | ? | ? | ◐ só criador (chave OpenAI) | ? | ◐ Q&A | ✅ Zoom/Meet | ✅ | ✅ ID + **QR** | ✅ | ? | US$ 199/ano |
| LearnDash | ◐ video progression | ✅ (Pro) | ? | ? | ◐ criador | ? | ◐ bbPress | ? | ✅ | ✅ builder | ✅ ProPanel | ? | US$ 259/ano |

### 2.2 Fontes principais (lidas em 2026-10-09)

- Teachable: https://www.teachable.com/pricing ; https://www.teachable.com/blog/2025-rewind ; notas/resume — https://support.teachable.com/hc/en-us/articles/360004258771-Navigate-and-View-Course-Content ; certificados — https://support.teachable.com/en/articles/11682466-certificates-of-completion ; LinkedIn — https://changelog.teachable.com/share-course-certificates-on-linkedin-333401 ; acessibilidade — https://teachable.com/accessibility ; Course Compliance 90% — https://support.teachable.com/en/articles/11682570-course-reporting-tools (snippet)
- Thinkific: https://www.thinkific.com/pricing/ ; https://www.thinkific.com/product-updates/ (Thinker 24/02/2026; streaks 30/07/2026; Learning Paths 28/08/2026) ; https://www.thinkific.com/accessibility/ ; certificados/LinkedIn — https://support.thinkific.com/hc/en-us/articles/360049252673-Sharing-Thinkific-Certificates (snippet); métrica de fornecedor (observacional) com IA: 32,7% vs 16,1% de conclusão — https://support.thinkific.com/hc/en-us/articles/16342787791511-AI-at-Thinkific (snippet)
- Kajabi: https://kajabi.com/pricing ; Teaching Assistant — https://help.kajabi.com/articles/products/products-overview/set-up-a-teaching-assistant ; cursos — https://help.kajabi.com/en/articles/17174490-courses-overview ; live — https://help.kajabi.com/en/articles/17174399-kajabi-built-in-live-video-faqs
- LearnWorlds: https://www.learnworlds.com/pricing/ ; app/offline — https://www.learnworlds.com/product/features/mobile-app/ ; limites do offline — https://support.learnworlds.com/support/solutions/articles/12000089188 (snippet)
- Podia: https://www.podia.com/pricing ; https://www.podia.com/online-courses
- Circle: https://circle.so/pricing ; sem certificado nativo — https://circle.so/compare/vs-thinkific
- Skool: https://www.skool.com/pricing ; https://help.skool.com/article/58-video
- Maven: https://help.maven.com/en/articles/12240853-maven-instructor-policy-guidebook ; https://help.maven.com/en/articles/6804811-course-certificates
- Moodle: https://moodledev.io/general/releases ; https://moodledev.io/general/releases/5.3 ; https://docs.moodle.org/502/en/AI_placements ; OB — https://moodledev.io/docs/5.2/apis/subsystems/badges (snippet) ; VPAT — https://moodle.com/accessibility/lms-vpat/ (snippet)
- Open edX: https://docs.openedx.org/en/latest/community/release_notes/verawood/verawood_marketing_notes.html ; Notes — https://docs.openedx.org/en/latest/learners/SFD_notes.html
- Canvas: https://www.instructure.com/products/canvas-tiers ; https://www.instructure.com/canvas/studio ; https://www.instructure.com/accessibility
- Tutor LMS: https://tutorlms.com/certificate-builder/ ; LearnDash: https://www.liquidweb.com/software/learndash/
- Artigos de "must-have" (fornecedores, com viés): Thinkific (26/09/2025) — https://www.thinkific.com/blog/lms-tools-and-features-what-to-look-for-in-a-modern-platform/ ; Thinkific "AI-powered LMS 2026" (01/10/2026) — https://www.thinkific.com/blog/ai-lms/ ; Circle "Best online course platforms 2026" (10/07/2026) — https://circle.so/blog/best-online-course-platforms

### 2.3 Síntese: padrão vs diferencial vs nicho (2026)

**Padrão de mercado:**
- Progresso e "continuar de onde parou"; drip/bloqueio sequencial.
- Quiz autocorrigido com nota mínima; comentários por aula.
- Certificado automático com **ID/serial e página pública**; **"Add to LinkedIn"** comum (Teachable, Thinkific, LearnWorlds, Maven, Open edX).
- **Legenda/transcrição automática por IA** nos SaaS (geralmente em plano superior ou com créditos).
- IA para o **criador** (outline, quiz, tradução).
- Analytics de vídeo (drop-off/heatmap) e relatório por aluno.
- App mobile e comunidade integrada (Podia é exceção sem app).
- **Limiar de 90%** de vídeo assistido aparece em Teachable (Course Compliance) e Kajabi — coerente com a decisão B2.

**Diferencial:**
- Tutor de IA para o **aluno**, ancorado no conteúdo com citações (Thinkific Plus, Kajabi pago por agente, Circle Scale+, Open edX Verawood, Moodle, Canvas Next) — depende de transcrições e costuma ser cobrado à parte.
- Busca que inclui a fala do vídeo (Kajabi, LearnWorlds, Circle, Skool).
- **Notas do aluno** (Teachable na linha do tempo do vídeo; Open edX com tags e busca; Tutor LMS; LearnDash Pro).
- Offline em app **com sincronização de progresso** (Teachable, Moodle); LearnWorlds não sincroniza; aulas travadas por drip não baixam (Teachable).
- Live nativo (Kajabi, Circle, Skool); outros integram Zoom.
- **Acessibilidade comprovada (VPAT, WCAG 2.1/2.2 AA)** só em Moodle e Instructure; nos SaaS para criadores é fraca (Teachable parcial desde 2021, Thinkific "working toward"). **WCAG 2.2 AA real seria diferencial.**

**Nicho:** Open Badges/VC (Moodle OB 2.x nativo, 3.0 pendente; Canvas via Parchment; Open edX/LearnWorlds via Credly/Accredible); QR no certificado (Tutor LMS, plugin Moodle); SCORM/xAPI; vídeo interativo com quiz dentro do vídeo; peer review; modelo cohort com taxa.

---


## 3. Evidências: o que aumenta conclusão/engajamento e do que os alunos reclamam

### 3.1 Conclusão e engajamento (estudos)

| Estudo | Achado | Magnitude | Limitações | Fonte (lida em 2026-10-09) |
|---|---|---|---|---|
| Reich & Ruipérez-Valiente (2019), *Science* 363:130 — "The MOOC Pivot" | Conclusão baixa e caindo em MOOCs; quem paga trilha verificada conclui muito mais | 565 cursos MITx/HarvardX, 12,67 mi matrículas; conclusão geral 4,96% → 3,13%; intenção declarada de concluir 11,5–17,7%; pagantes "verified" 44–56%; **52% nunca entram no conteúdo** | MOOC gratuito ≠ curso pago pequeno; seleção (quem paga já é mais motivado) | [O] https://webs.um.es/jruiperez/papers/journals/2019_Science_MOOCPivot_postprint.pdf |
| Guo, Kim & Rubin (2014), L@S | Duração do vídeo domina o engajamento | 6,9 mi sessões; **mediana assistida ≤ ~6 min** independentemente da duração; vídeos > 9 min: aluno costuma ver < metade; 0–3 min: 75% das sessões passam de 3/4 | Retrospectivo; exatas; 2012 | [O] https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf |
| Kizilcec et al. (2020), *PNAS* 117:14900 | Nudges/planejamento/implementation intentions em escala **não melhoram conclusão** | ~250 mil alunos, 247 cursos; efeito na semana 1 some na 2; conclusão: plan-making +0,19 a −0,23 p.p.; accountability social +0,89 p.p. (n.s.). Estudo menor anterior: 14% → 18% | Efeito cai ~1 ordem de grandeza ao escalar | [O] https://pmc.ncbi.nlm.nih.gov/articles/PMC7334459 |
| Sailer & Homner (2020), *Educ. Psychol. Rev.* — meta-análise de gamificação | Efeitos pequenos | g cognitivo 0,49; motivacional 0,36; comportamental 0,25; só o cognitivo robusto em estudos rigorosos | Alta heterogeneidade | [O] https://link.springer.com/article/10.1007/s10648-019-09498-w (números via resumo) |
| Adesope et al. (2017) RER; Szpunar et al. (2013) PNAS | **Prática de recuperação (quizzes)** supera reestudo; quizzes intercalados em videoaula reduzem divagação e melhoram retenção | Faixa g ≈ 0,50–0,61 entre meta-análises [NC quanto ao g global] | Szpunar: laboratório, 1 aula | [O] https://journals.sagepub.com/doi/10.3102/0034654316689306 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC3631699/ |
| Reich (2014) EDUCAUSE; Littenberg-Tobias et al. (2020) IRRODL | Intenção e certificado correlacionam com conclusão, mas **pagamento não é o único motor** | Quem pretendia concluir: 22% vs 6% dos "navegadores" | Seleção, não causalidade | [O] https://er.educause.edu/articles/2014/12/mooc-completion-and-retention-in-the-context-of-student-intent |
| Ruzuku (estudo de fornecedor, out/2026, dados até 01/09/2026) | Coorte, discussão por aula e quizzes associados a mais conclusão | 27.156 cursos/1,3 mi matrículas: coorte agendada **53,4%**, drip 42,9%, self-paced 41,9%; discussão por aula habilitada 50,9% vs 37,3% (≥15 comentários/aula: 67,4%); **com quiz 59,1% vs 42,4%**; ativo nos dias 0–7: 78,2% vs 17,2% | Observacional, de fornecedor, forte viés de seleção | [S] https://www.ruzuku.com/learn/articles/cohort-vs-self-paced-completion-study |

- Números populares de Maven/altMBA ("75%+", "90–97%") **não têm metodologia pública** [NC]. Não foram encontrados relatórios 2024–2026 de Thinkific/Teachable/Kajabi/LearnWorlds/Hotmart com taxa de conclusão e metodologia [NC].

**Síntese das evidências:** o que tem efeito plausível é **desenho pedagógico** — vídeos curtos (≤ 6–9 min), **quizzes intercalados**, **discussão ativa por aula**, ritmo/turma e **ativação na primeira semana**. Lembretes e gamificação têm efeito pequeno ou nulo em escala: valem só no básico (e-mail de retomada, progresso visível).

### 3.2 Reclamações de alunos sobre áreas de membros

**Quantitativo disponível (escasso):**
- **Hotmart — Relatório de Ouvidoria 2º sem/2025:** Reclame Aqui "+5,4 mil reclamações" no semestre, solução 89%, voltariam a fazer negócio 82%, nota 7,7; Consumidor.gov 441 reclamações, nota 3,0/5; **sem divisão por categoria**. [O] https://cdn-hotsites.contatoseguro.com.br/hotsites/ouvidoriahotmart/variables/relatorio252.pdf
- **Kiwify (RA, fev–jul/2026):** nota 8,1; 3.267 reclamações; 82,8% resolvidas; ~12 dias de resposta; "estorno do valor pago" ~38,9%. [NC — snippet indexado] https://www.reclameaqui.com.br/empresa/kiwify/
- **Cademí (RA, jan–jun/2026):** 230 reclamações, 95,8% resolvidas, maioria sobre reembolso/cancelamento. [NC — snippet] https://www.reclameaqui.com.br/empresa/cademi/lista-reclamacoes/
- Não foi obtida distribuição quantitativa por categoria (player, login, certificado) para nenhuma plataforma BR.

**Padrões qualitativos (casos individuais, unilaterais) [S — páginas RA indexadas]:**
1. **Acesso/login/e-mail errado:** typo no e-mail do checkout, conta ligada a outro e-mail, links de acesso errados enviados pelo suporte, acesso liberado só após reclamação pública; e-mail de acesso no spam. Ex.: https://www.reclameaqui.com.br/comunidade-beliebe-psicologo-felipe-maronesi/cliente-nao-tem-acesso-ao-curso-pago-apesar-de-ter-contatado-o-suporte-e-recebido-links-incorretos_YRIhXEnq41CnK9EF/ ; ajuda Hotmart sobre troca de e-mail: https://help.hotmart.com/pt-br/article/9370387188877/
2. **Acesso que expira / "vitalício" contestado** — padrão mais recorrente depois de reembolso: prazo de 12/24 meses não percebido, conteúdo que some após migração de plataforma, "vitalício" sem atualizações. Ex.: https://www.reclameaqui.com.br/eduzz/nao-recebo-atualizacoes-do-curso-vitalicio-comprado_YVRkxtrh8sldij8c/ ; https://www.reclameaqui.com.br/keymaster-instituto-mestre/acesso-ao-curso-mestre-das-teclas-bloqueado-apos-um-ano-propaganda-enganosa-de-acesso-vitalicio_TGSFWSHJWwbS7A4m/
3. **Reembolso/estorno** dentro dos 7 dias; prazos de estorno em cartão de 30–60 dias.
4. **Certificado:** não emitido 49 dias após conclusão; **nome incorreto**; certificado com dados de outra conta. Ex.: https://www.reclameaqui.com.br/curso-professor-marcos-salomao/solicitacao-urgente-de-entrega-do-certificado-do-curso-de-direito-imobiliario-extrajudicial_A3rhxjTMA-tqOTK8/ ; https://www.reclameaqui.com.br/instituto-dan-valle-de-desenvolvimento-humano/curso-de-bandagem-auricular-incompleto-e-certificado-com-nome-incorreto_RiWon8cfpGpD32oR/
5. **Suporte lento/automatizado**; **drip prometido não cumprido** (7 dias virou 12+). https://www.reclameaqui.com.br/overall-company-marketing-digital/reclamacao-sobre-curso-salario-sem-fronteiras-conteudo-bloqueado-e-suporte-insatisfatorio-na-plataforma-kiwify_jWIGvcu99-g-CD7x/
6. **Player/vídeo:** volume baixo no RA via busca [NC]; Hotmart documenta vídeo "em processamento" aparentando travamento: https://help.hotmart.com/pt-br/article/217150538
7. Outros: propaganda indesejada na área do aluno; golpes com links falsos de pagamento.

**Fora do Brasil (Trustpilot dominado por criadores, não alunos) [S]:** Teachable 3,3/5 (suporte lento, bugs) — https://www.trustpilot.com/review/teachable.com ; Thinkific 1,8/5 (cobrança após cancelamento) — https://www.trustpilot.com/review/thinkific.com ; Kajabi 3,4/5 (suporte por IA, entregabilidade de e-mail) — https://www.trustpilot.com/review/kajabi.com ; Capterra (Teachable): aluno sem acesso a curso comprado por uma semana — https://capterra.com/p/147019/Teachable/reviews/?page=2

**Síntese:** no Brasil, a reputação de uma área de membros gira em torno de **acesso (e-mail/login), prazo de acesso, reembolso e certificado** — mais do que de player.

## 4. Brasil — Direito do consumidor, fiscal e certificados

### 4.1 Direito de arrependimento (CDC art. 49) e Decreto 7.962/2013

**Texto normativo**

- CDC art. 49: o consumidor pode desistir em **7 dias** a contar da assinatura ou do recebimento, quando a contratação ocorre fora do estabelecimento comercial; o parágrafo único manda devolver os valores pagos "a qualquer título", monetariamente atualizados. [NC — texto conhecido; planalto.gov.br indisponível nesta data: https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm]
- **Decreto 7.962/2013** (comércio eletrônico), lido na cópia da Câmara [O] — https://www2.camara.leg.br/legin/fed/decret/2013/decreto-7962-15-marco-2013-775557-publicacaooriginal-139266-pe.html (lido em 2026-10-09):
  - **Art. 2º** — o site deve exibir em local de destaque: nome empresarial e CNPJ; endereço físico e eletrônico; características essenciais do produto/serviço (incluindo riscos); discriminação de despesas adicionais; condições integrais da oferta (modalidades de pagamento, disponibilidade, forma e prazo de execução do serviço) e **restrições à fruição da oferta**.
  - **Art. 4º** — "atendimento facilitado": apresentar **sumário do contrato antes da contratação** com cláusulas que limitem direitos; ferramentas para **identificar e corrigir erros** antes de finalizar; **confirmar imediatamente** o recebimento da aceitação; disponibilizar o **contrato em meio que permita guarda e reprodução**; manter **serviço de atendimento em meio eletrônico** (informação, dúvida, reclamação, suspensão ou cancelamento); confirmar imediatamente o recebimento das demandas; usar mecanismos de segurança para pagamento e dados. **Parágrafo único: resposta às demandas em até 5 dias.**
  - **Art. 5º** — informar de forma clara e ostensiva os meios para exercer o arrependimento; **o consumidor pode se arrepender pela mesma ferramenta usada na contratação** (§1º); o arrependimento rescinde contratos acessórios (§2º); o fornecedor deve **comunicar imediatamente a instituição financeira/administradora do cartão** para não lançar ou estornar (§3º); **confirmação imediata** do recebimento do pedido de arrependimento (§4º).
  - **Art. 7º** — descumprimento sujeita às sanções do art. 56 do CDC. Não há registro de revogação na base da Câmara (S, via busca).

**Aplicabilidade a cursos online / conteúdo digital (entendimento atual)**

- Não localizei acórdão do **STJ** específico sobre arrependimento em curso online; o precedente mais citado do STJ sobre art. 49 (REsp 1.340.604-RJ, 2013) trata de outro tema (custo de devolução). [S — busca, 2026-10-09]
- Doutrina recente defende aplicação integral a bens digitais: art. 49 não distingue bens materiais e digitais (Leonardo M. Acosta, Meu Site Jurídico/JusPodivm, 21/07/2026) [S] — https://meusitejuridico.editorajuspodivm.com.br/2026/07/21/o-direito-de-arrependimento-previsto-no-cdc-tambem-se-aplica-aos-bens-digitais/
- ConJur (Mariane Galbine, 25/05/2025): cursos online contratados eletronicamente estão abrangidos; exceção defendida quando o aluno **acessa integralmente** o conteúdo e foi **previamente alertado** de forma clara e destacada; cita a Diretiva 2011/83/UE como referência comparada; **não cita julgados específicos** [S] — https://conjur.com.br/2025-mai-25/direito-de-arrependimento-em-servicos-digitais-posso-cancelar-streaming-curso-online-ou-app/
- Tribunais estaduais divergem: há julgados que contam o prazo **a partir da liberação efetiva do acesso** e julgados que validam recusa após **acesso imediato e integral** ao conteúdo [S — ementas via Jusbrasil/agregadores; números de processo não confirmados] — https://www.jusbrasil.com.br/artigos/o-direito-ao-arrependimento-e-os-cursos-online/1240297747
- **PL 3.514/2015** (atualização do CDC para comércio eletrônico; arrependimento de 7 dias prorrogável a 14 se faltar informação) — sem confirmação de aprovação até 2026-10-09 [NC].
- **Prática de mercado:** as plataformas BR de infoprodutos adotam garantia mínima de 7 dias como padrão (ver §1). A categoria "estorno do valor pago" é a principal no Reclame Aqui da Kiwify (~38,9%, fev–jul/2026, via snippet indexado) [NC] — https://www.reclameaqui.com.br/empresa/kiwify/

**Leitura prática para a vNext:** a postura de menor risco é **honrar reembolso integral em até 7 dias da liberação do acesso, sem condicionar a consumo**, e oferecer ao aluno **um meio de pedir o arrependimento dentro do próprio Hub** (mesma ferramenta da contratação, art. 5º §1º do Decreto), com confirmação imediata. Restringir o direito por "consumo integral" é tese defensiva, não regra pacífica; se adotada, exige aviso prévio destacado e prova de consumo.

### 4.2 Nota fiscal para cursos livres: NFS-e, padrão nacional e reforma tributária

- **Natureza do serviço:** curso livre é serviço sujeito ao **ISS** (lista anexa da LC 116/2003, item 8 — "8.02 Instrução, treinamento, orientação pedagógica e educacional, avaliação de conhecimentos de qualquer natureza") → documento fiscal é a **NFS-e**. [NC — texto da LC 116 não relido nesta data; confirmar código de serviço e NBS com contador]
- **LC 214/2025** (regulamenta IBS/CBS): art. 62 §1º obrigou **todos os municípios a adotarem a NFS-e de padrão nacional até 01/01/2026**; quem não aderir sofre suspensão de transferências voluntárias. [S] — https://www.contabeis.com.br/noticias/71679/nfs-e-nacional-sera-obrigatoria-para-municipios-a-partir-de-2026/ ; texto da LC: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm [NC — não acessível]
- **Simples Nacional:** a **Resolução CGSN nº 191, de 04/08/2026**, revogou a Res. 189/2026 (que previa 01/09/2026) e fixou a **obrigatoriedade de emissão pelo Emissor Nacional da NFS-e (web ou API) para ME/EPP a partir de 01/11/2026**; sistemas municipais deixam de ser aceitos para isso. [S] COAD, 19/08/2026 — https://coad.com.br/home/noticias-detalhe/139271/nfs-e-nacional-sera-obrigatoria-para-optantes-do-simples-nacional-a-partir-de-1-11-2026 ; Conta Azul, 14/08/2026 — https://contaazul.com/blog/nfse-padrao-nacional/ (texto no DOU não lido → [NC] quanto à redação exata).
- **MEI:** NFS-e nacional obrigatória desde 01/09/2023 para serviços a PJ (Res. CGSN 169/2022); facultativa para PF. [S] Conta Azul (link acima).
- **Lucro Presumido/Real:** sem data federal única; depende da migração do município. [S] Conta Azul.
- **IBS/CBS em 2026:** ano-teste com destaque informativo de **CBS 0,9% e IBS 0,1%** nos documentos dos regimes regulares; **para optantes do Simples, as obrigações de IBS/CBS começam em 01/01/2027**. [S] — https://coad.com.br/home/noticias-detalhe/139271/... ; https://emiteclick.com/blog/reforma-tributaria-cbs-ibs-nota-fiscal-2026/
- **Redução de 60% para educação (LC 214, art. 129, Anexo II):** o Anexo II lista ensino infantil, fundamental, médio, técnico de nível médio, EJA, superior (graduação, pós, extensão, sequenciais), Libras/escrita tátil, línguas nativas e educação especial; serviços fora da lista **não têm a redução**. **Cursos livres não aparecem** nos itens citados — inferência: provavelmente alíquota cheia quando o regime estiver plenamente vigente. [S] Migalhas, Rosa Freitas, 03/12/2025 — https://www.migalhas.com.br/depeso/442311/reforma-tributaria-53-a-educacao-na-lc-214-25 ; [NC] quanto ao enquadramento final (depende da NBS do serviço).

**Leitura prática para a vNext:** a NF não precisa ser *gerada* pelo LMS, mas o LMS precisa **produzir os dados** e o **gatilho**: por Order paga, tomador (nome, CPF/CNPJ, e-mail, endereço quando exigido), descrição, valor em centavos, data de competência, e cancelamento/estorno vinculado ao `RefundRequest`. Opções: (a) emissão pelo Asaas (o Asaas oferece emissão de NFS-e integrada às cobranças — [NC] não verificado nesta pesquisa quanto ao suporte ao Emissor Nacional/API), (b) emissor terceirizado (eNotas, NFE.io etc.), (c) contador emitindo manualmente a partir de relatório. Para centenas de vendas/mês, (a) ou (b) tendem a ser preferíveis. **Nenhuma das três exige construir emissor fiscal próprio.** Prazo crítico: **01/11/2026** se a NeuroCapacitar for ME/EPP do Simples.

### 4.3 Certificados de cursos livres

- **Base legal:** LDB (Lei 9.394/96) art. 39 §2º I — a educação profissional e tecnológica abrange cursos "de formação inicial e continuada ou qualificação profissional"; art. 42 — instituições de educação profissional oferecerão "cursos especiais, abertos à comunidade, condicionada a matrícula à capacidade de aproveitamento e não necessariamente ao nível de escolaridade". [O] Câmara — https://www2.camara.leg.br/legin/fed/lei/1996/lei-9394-20-dezembro-1996-362578-normaatualizada-pl.html
- **Decreto 5.154/2004** (redação do Decreto 8.268/2014): cursos de formação inicial e continuada; quem conclui com aproveitamento faz jus a certificado de formação inicial ou continuada para o trabalho (art. 3º §2º). [S] via busca; texto em https://www2.camara.leg.br/legin/fed/decret/2004/decreto-5154-23-julho-2004-533121-normaatualizada-pe.html [NC — não relido integralmente]
- **Sem autorização do MEC:** cursos livres não dependem de ato autorizativo nem reconhecimento; **não podem emitir diploma** nem certificado de pós-graduação; o certificado comprova participação/qualificação e **não habilita profissão regulamentada**. Não se deve anunciar "reconhecido pelo MEC". [S] — https://noticiamarajo.com.br/educacao/regulacao-e-supervisao-do-mec-nao-se-aplicam-a-cursos-livres/ ; https://nfe.io/blog/financeiro/legislacao-cursos-livres/ (02/05/2022). Não localizei página oficial do MEC afirmando isso nesta data [NC quanto à fonte oficial].
- **Conteúdo do certificado:** **não há norma federal que fixe campos obrigatórios** para curso livre [S — NFE.io afirma não haver carga horária ou conteúdo obrigatórios]. Prática de mercado e o que órgãos/empregadores costumam aceitar: nome completo do aluno, **identificador (CPF parcial ou código)**, nome do curso, **carga horária**, período/data de conclusão, conteúdo programático (verso ou link), nome e **CNPJ** da instituição, assinatura do responsável, **código/QR de verificação**. [NC — prática, não norma]
- **Reclamações recorrentes** (RA): certificado não emitido semanas após conclusão, **nome incorreto**, certificado com dados de outra conta (ver §3.2).
- **Nota sobre profissões de saúde:** conselhos profissionais (ex.: COREN) podem ter regras próprias para que cursos contem como capacitação/registro; não pesquisado em profundidade [NC].

### 4.4 Assinatura do certificado: ICP-Brasil vs assinatura eletrônica

- **Lei 14.063/2020**, art. 4º: três níveis — **simples** (identifica o signatário/associa dados), **avançada** (certificado não ICP ou outro meio de comprovação de autoria e integridade **admitido pelas partes ou aceito por quem o documento for oposto**, vinculada univocamente ao signatário e com detecção de alteração) e **qualificada** (certificado ICP-Brasil, MP 2.200-2/2001 art. 10 §1º). O âmbito principal da lei é a interação com entes públicos, atos de pessoas jurídicas e saúde. [S] — https://www2.camara.leg.br/legin/fed/lei/2020/lei-14063-23-setembro-2020-790659-publicacaooriginal-161547-pl.html (índice) ; https://barbieriadvogados.com/assinatura-eletronica-validade-juridica/
- **MP 2.200-2/2001, art. 10 §2º:** permite outros meios de comprovação de autoria e integridade não ICP, se admitidos pelas partes; o STJ (REsp 2.159.442/PR) afirmou que a ausência de credenciamento ICP não afasta, por si, a presunção de veracidade de assinatura eletrônica certificada por entidade privada. [S] — https://www.conjur.com.br/2020-ago-12/tj-sp-reconhece-validade-assinaturas-eletronicas-nao-certificadas/ ; https://www.legjur.com/jurisprudencia/eme/174.1258.6893.0682
- **Implicação:** para certificado de curso livre (documento particular, sem exigência legal de forma), **ICP-Brasil não é exigida**. O que dá confiança prática é: PDF imutável + **hash SHA-256 registrado** + **página pública de verificação por código opaco/QR** que confirma emissor, titular (nome), curso, carga horária, data e status (válido/revogado). Isso já está alinhado à decisão B6. Assinar o PDF com certificado ICP-Brasil (e-CNPJ A1) é **opcional** e de custo baixo, mas adiciona gestão de chave/renovação; benefício marginal para o público-alvo. [inferência]

### 4.5 Open Badges 3.0, W3C Verifiable Credentials e LinkedIn

- **W3C Verifiable Credentials Data Model 2.0** é **W3C Recommendation desde 15/05/2025**. [O] — https://www.w3.org/TR/vc-data-model-2.0/ (versão datada https://www.w3.org/TR/2025/REC-vc-data-model-2.0-20250515/)
- **Open Badges 3.0** (1EdTech) aprovado como especificação final em jun/2024, alinhado a VC. Pesquisa da 1EdTech (meados de 2025): **40% dos provedores de badges** emitiam ao menos parte em OB 3.0 (~2,69 milhões de credenciais 3.0); muitos continuam em 2.0. [S/O — survey 1EdTech] — https://content.1edtech.org/badge-count-2025/results ; artigo de mar/2026 afirma que a maioria das plataformas ainda usa 2.0 — https://virtualbadge.io/blog-articles/open-badges-3-0-what-is-the-status-in-2026 [S]
- Adoção pontual por grandes LMS/fornecedores: Anthology/Blackboard Milestone suportando OB 3.0 desde 30/07/2025 (EUA) — https://community.anthology.com/public/blogs/a-new-era-for-digital-credentials-open-badges-30-is-here-2025-08-04 [S]
- **LinkedIn "Add to Profile" para certificações [O]** — https://www.linkedin.com/help/linkedin/answer/a528030 (lido em 2026-10-09): botão gratuito, sem aprovação, exige **Página do LinkedIn da instituição**; usa **URL estática** (não personalizada por certificado); **o usuário preenche manualmente** os campos (não há mais pré-preenchimento automático). Na prática, o certificado precisa exibir **Credential ID** e **Credential URL** (página de verificação) para o aluno copiar.
- **Leitura:** no Brasil e no público da NeuroCapacitar, OB 3.0/VC é **diferencial de nicho**; o padrão que importa é **página de verificação + QR + ID copiável + botão LinkedIn**. Um export OB 3.0 pode ser adicionado depois sobre o mesmo registro de emissão, sem mudar o modelo.

---

## 5. LGPD aplicada ao LMS

### 5.1 Bases legais (LGPD, Lei 13.709/2018) [O — cópia Câmara: https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html]

| Tratamento no LMS | Base legal provável | Observação |
|---|---|---|
| Conta, perfil, matrícula, progresso, quiz, certificado | **Art. 7º V** — execução de contrato | Núcleo do serviço; não pedir consentimento para isso |
| Dados fiscais/financeiros (Order, Payment, NF) | **Art. 7º II** — obrigação legal/regulatória; V — contrato | Guarda fiscal |
| Logs de acesso/segurança, antifraude, rate limit | **Art. 7º II** (Marco Civil, ver §5.3) e **IX** — legítimo interesse | Registrar avaliação de legítimo interesse (LIA) simples |
| Evidências para disputa/chargeback/reembolso | **Art. 7º VI** — exercício regular de direitos | Fundamenta retenção após fim da relação |
| E-mail marketing / CourseInterest para campanhas | **Art. 7º I** — consentimento (opt-in) ou IX com opt-out claro | Decisão B8 já prevê consentimento independente para marketing |
| Métricas operacionais first-party | **Art. 7º IX** — legítimo interesse | Coerente com B9 (sem CDP/firehose) |
| Dados sensíveis eventuais (ver 5.2) | **Art. 11** — consentimento específico ou hipóteses do inciso II | Evitar coletar |

### 5.2 Dados sensíveis em cursos de saúde/neurodesenvolvimento

- Art. 11 restringe o tratamento de dado sensível (saúde, entre outros) a consentimento específico e destacado ou às hipóteses do inciso II (obrigação legal, exercício regular de direitos, proteção da vida, prevenção à fraude etc.). [O]
- **Risco concreto:** em discussões por aula e campos livres, alunos (profissionais de saúde, educadores, famílias) tendem a relatar **casos clínicos de terceiros** (crianças, pacientes) ou **diagnóstico próprio/do filho**. Isso cria tratamento de **dado sensível de terceiros e de crianças** sem base clara, e aumenta a gravidade de qualquer incidente (Res. CD/ANPD 15/2024 lista dado sensível e de criança como critérios de risco relevante — §5.8).
- **Mitigações de produto (inferência):** aviso fixo no editor de discussão ("não publique dados que identifiquem pacientes/crianças"); diretrizes da comunidade; moderação com remoção/ocultação auditada; **sem upload de anexos em discussões na v1** ou com revisão; não coletar dado de saúde no cadastro (ex.: "tem filho com TEA?") — se marketing precisar de segmentação, usar consentimento específico e campo opcional.
- **Pequeno porte:** a Res. CD/ANPD 2/2022 exclui do regime simplificado o tratamento de **alto risco** = pelo menos um critério geral (**larga escala** ou impacto significativo) **e** um específico (incluindo **dados sensíveis ou de crianças**). Com centenas de alunos, "larga escala" é improvável, mas dado sensível tratado de forma sistemática pode puxar o critério de impacto significativo [inferência; NC]. — https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022 [O]

### 5.3 Retenção e eliminação

- **Princípio:** eliminar após o término do tratamento, salvo art. 16: I — cumprimento de obrigação legal/regulatória; II — pesquisa; III — transferência a terceiro; IV — uso exclusivo do controlador, anonimizado. [O — LGPD, cópia Câmara]
- **Marco Civil da Internet (Lei 12.965/2014), art. 15:** provedor de aplicações constituído como pessoa jurídica com fins econômicos deve manter **registros de acesso a aplicações (data/hora + IP) por 6 meses**, sob sigilo. [NC — texto conhecido; não relido nesta data: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm]. **Isto é obrigação para o Hub** (login/acesso) e deve virar requisito de retenção mínima de log de autenticação.
- **Fiscal:** documentos fiscais e registros de pagamento — prazo decadencial/prescricional tributário de 5 anos (CTN arts. 173/174) é a referência usual [NC — confirmar com contador].
- **Consumo:** pretensão de reparação por fato do serviço prescreve em 5 anos (CDC art. 27) [NC — texto não relido]; serve de referência para guardar evidência de contratação, aceite de termos e entrega (acesso concedido, progresso).
- **Incidentes:** registro de incidentes por **no mínimo 5 anos** (Res. CD/ANPD 15/2024) [S — ver §5.8].
- **Certificados revogados (retenção do PDF por 90 dias, decisão B6, pendência P-12):**
  - Base legal plausível para reter o **registro mínimo** da revogação (código, titular, data, motivo, hash) por prazo longo: **art. 7º VI / art. 16 I** (exercício regular de direitos; responder a quem apresentar o certificado antigo; prova em disputa) e **art. 7º IX** (legítimo interesse em prevenir fraude documental). A página de verificação precisa continuar respondendo "revogado" para o código antigo — isso exige manter ao menos o código e o status.
  - Reter **o PDF revogado em si** por 90 dias tem justificativa mais fraca (o hash já prova o conteúdo); 90 dias parece proporcional como janela operacional para contestação/reemissão, mas **não há prazo legal específico** localizado. [inferência; NC — validar juridicamente, como já previsto em P-12]
- **Certificados válidos:** emitidos sob execução de contrato; manter enquanto o titular puder precisar comprovar (prática: indefinido, com possibilidade de eliminação a pedido, exceto o registro mínimo para verificação) [inferência].

### 5.4 Direitos do titular e prazos

- Art. 18: confirmação, acesso, correção, anonimização/bloqueio/eliminação de desnecessários, **portabilidade**, eliminação de dados tratados com consentimento (exceto art. 16), informação sobre compartilhamento, informação sobre não consentir, revogação de consentimento; exercício mediante requerimento expresso, **sem custos** (§§3º, 5º). [O]
- Art. 19: confirmação/acesso **imediatamente em formato simplificado** ou por **declaração clara e completa em até 15 dias** do requerimento. [O — inciso II lido parcialmente; prazo de 15 dias é o texto conhecido]
- **Agentes de pequeno porte: prazos em dobro** (art. 14 da Res. 2/2022) — inclusive a declaração completa (→ 30 dias); declaração simplificada em até 15 dias (art. 15). [O]
- **Regulamento específico de direitos do titular:** está na agenda da ANPD desde 2023–2024; previsão de conclusão em 2025 não confirmada; o Mapa de Temas Prioritários 2026–2027 coloca **direitos dos titulares como Eixo 1 de fiscalização**. [S] — https://teletime.com.br/28/01/2025/anpd-quer-concluir-regulamento-de-direitos-do-titular-de-dados-em-2025/ ; https://www.trenchrossi.com/en/legal-alerts/anpd-publishes-map-of-priority-issues-2026-2027-biennium-and-update-of-the-regulatory-agenda-2025-2026-biennium
- **Implicação:** a decisão de deixar **autoexclusão self-service fora da v1** é compatível com a LGPD **desde que** exista canal efetivo, fila Staff com prazo monitorado (15/30 dias), **export de dados do titular** (acesso/portabilidade em formato legível, ex.: JSON/PDF) e eliminação executável por Staff preservando o que o art. 16 permite reter.

### 5.5 Encarregado (DPO) e agentes de pequeno porte

- LGPD art. 41: controlador deve indicar encarregado; a ANPD pode dispensar. [O]
- **Res. CD/ANPD 2/2022, art. 11:** agentes de pequeno porte (ME/EPP/startup, sem tratamento de alto risco e dentro do limite de receita) **não são obrigados a indicar encarregado**, mas **devem manter canal de comunicação com o titular**; indicar voluntariamente é boa prática. Também podem manter **registro simplificado de operações** (art. 9º) e **política simplificada de segurança** (arts. 12–13). [O] (link em 5.2)
- A **Res. CD/ANPD 18/2024** regulamenta atuação do encarregado (divulgação de identidade e contato no site etc.) [NC — DOU indisponível nesta data].
- **ANPD virou agência reguladora** ("Agência Nacional de Proteção de Dados") pela **Lei 15.352/2026**, sancionada em 25/02/2026. [S] — https://teletime.com.br/26/02/2026/lei-que-torna-anpd-agencia-e-fixa-vigencia-do-eca-digital-e-sancionada/

### 5.6 Cookies e consentimento

- A ANPD publicou o **Guia Orientativo "Cookies e proteção de dados pessoais"** (criado em 18/10/2022, página atualizada em 23/01/2025) [O — metadados] — https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf . O conteúdo não pôde ser extraído nesta sessão. Pelo que se conhece do guia [NC — não relido]: cookies **estritamente necessários** podem se apoiar em legítimo interesse/execução de contrato sem banner de consentimento; cookies **não necessários** (analytics de terceiros, publicidade) exigem consentimento livre e granular, com opção de **rejeitar tão fácil quanto aceitar**, sem caixas pré-marcadas.
- **Implicação:** a arquitetura vNext (cookie de sessão Better Auth, CSRF, preferência de tema, **Cloudflare Web Analytics** que se apresenta como sem cookies — [NC] verificar) permite **não ter banner de consentimento**, apenas aviso/política de cookies — desde que não se adicionem pixels de marketing (Meta/Google Ads) dentro do Hub. Se a landing/marketing usar pixels, o banner fica lá, não no Hub.

### 5.7 Transferência internacional (fornecedores nos EUA)

- LGPD art. 33: rol taxativo — inclui **II** (garantias: cláusulas-padrão, cláusulas específicas, normas corporativas globais), **VIII** (consentimento específico e destacado) e **IX** (quando necessário para atender art. 7º II, **V** e VI — obrigação legal, **execução de contrato** com o titular, exercício de direitos). [O]
- **Res. CD/ANPD 19/2024** (23/08/2024): aprovou o regulamento e as **cláusulas-padrão contratuais (CPCs) brasileiras** (Anexo II), que devem ser adotadas **sem alteração**; prazo de 12 meses para incorporar aos contratos existentes **encerrado em 23/08/2025**; após isso, cláusulas contratuais só valem se forem as CPCs da ANPD ou cláusulas específicas aprovadas. A ANPD **não reconheceu as SCCs da UE como equivalentes**. [S] — https://lefosse.com/noticias/transferencia-internacional-de-dados-prazo-para-adocao-das-clausulas-padrao-da-anpd-se-encerra-em-23-de-agosto/ ; https://www.mayerbrown.com/en/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data
- **Fornecedores verificados:**
  - **Cloudflare DPA** v6.4 (vigente desde 03/04/2026): **não menciona Brasil, LGPD ou CPCs da ANPD**; usa EU SCCs, UK Addendum, regras suíças, DPF e Global CBPR. [O] — https://www.cloudflare.com/cloudflare-customer-dpa/
  - **Resend DPA** (atualizado 31/12/2025): **não menciona Brasil/LGPD**; processamento primário nos EUA; usa EU SCCs. [O] — https://resend.com/legal/dpa
  - Neon, Sentry, Asaas (BR), Google (login): **não verificados** nesta pesquisa [NC].
- **Implicação (risco real para empresa pequena):** fornecedores grandes raramente assinam CPCs da ANPD com cliente pequeno. Caminhos: (1) apoiar as transferências **estritamente necessárias à execução do contrato com o aluno** no **art. 33 IX c/c art. 7º V** (hospedagem, e-mail transacional), documentando necessidade; (2) solicitar aos fornecedores adendo com as CPCs da ANPD (Cloudflare/Neon podem ter processo enterprise) [NC]; (3) minimizar dados enviados a fornecedores não essenciais (Sentry: **scrubbing de PII**; e-mail: apenas nome/e-mail). A escolha entre (1) e (2) é **decisão jurídica** — registrar em P-12.

### 5.8 Incidentes de segurança (Res. CD/ANPD 15/2024)

- Comunicar à ANPD e aos titulares quando o incidente puder acarretar **risco ou dano relevante** = afetar significativamente direitos **e** envolver ao menos um: **dados sensíveis**, de **crianças/adolescentes/idosos**, **financeiros**, **de autenticação**, protegidos por sigilo, ou em larga escala. [S] Cescon Barrieu — https://cesconbarrieu.com.br/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca/
- **Prazo: 3 dias úteis** a partir do conhecimento de que o incidente afetou dados pessoais; **em dobro (6 dias úteis) para agente de pequeno porte** mediante declaração; complementação em até 20 dias úteis; comunicação aos titulares individual quando identificáveis, ou por meios amplos por ≥ 3 meses. [S] (mesma fonte)
- **Registro de todos os incidentes** (inclusive não comunicados) por **≥ 5 anos**. [S]
- **Implicação:** o LMS trata **dados de autenticação** (hashes, sessões, passkeys) e **financeiros** — um vazamento quase certamente é "relevante". Requisitos: inventário de dados por tabela, trilha de auditoria, runbook de incidente com modelo de comunicação, capacidade de listar titulares afetados por consulta.

### 5.9 Menores de idade — ECA Digital (Lei 15.211/2025)

- **Vigência: 17/03/2026** (fixada pela Lei 15.352/2026). [S] Teletime (link em 5.5); Lefosse, 10/03/2026 — https://lefosse.com/noticias/alerta/eca-digital-entra-em-vigor-em-17-de-marco-como-se-preparar/
- **Âmbito:** produtos/serviços de TI **direcionados a crianças e adolescentes ou de acesso provável** por eles; plataformas generalistas podem ser enquadradas se houver uso relevante por menores. Obrigações giram em torno de design, **verificação de idade**, supervisão parental, monetização e proteção de dados; fiscalização pela ANPD; multa de até 10% do faturamento no Brasil ou até R$ 50 milhões por infração. [S] Lefosse.
- O alerta não trata de plataformas educacionais específicas nem de serviços voltados a adultos [S].
- **Leitura para a NeuroCapacitar:** cursos para **profissionais e famílias** (adultos) → acesso por menores é **improvável**, o que reduz o enquadramento. Mitigação simples e defensável: **declarar público adulto (18+) nos termos**, exigir aceite de maioridade no cadastro/checkout (o checkout Asaas já exige CPF do comprador) e **não** criar contas de menores. Se um dia houver cursos para adolescentes, reavaliar (LGPD art. 14 + ECA Digital). [inferência]

---

## 6. Acessibilidade

- **LBI (Lei 13.146/2015), art. 63** [O — cópia Câmara: https://www2.camara.leg.br/legin/fed/lei/2015/lei-13146-6-julho-2015-781174-publicacaooriginal-147468-pl.html]: "É obrigatória a acessibilidade nos sítios da internet mantidos por empresas com sede ou representação comercial no País ou por órgãos de governo, para uso da pessoa com deficiência", "conforme as melhores práticas e diretrizes de acessibilidade adotadas internacionalmente"; §1º — os sítios devem exibir o **símbolo de acessibilidade em destaque**. → **Aplica-se a empresa privada** como a NeuroCapacitar; a referência técnica "internacional" é, na prática, a WCAG.
- **eMAG 3.1** (abr/2014): obrigatório para sítios do governo federal (Portaria SLTI nº 3/2007, âmbito SISP); **não é obrigatório para empresas privadas**, mas é referência nacional baseada em WCAG 2.0. [O] — https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/acessibilidade-digital/modelo-de-acessibilidade
- **WCAG 2.2** é W3C Recommendation (versão vigente de **12/12/2024**). Novos critérios 2.2 em nível A/AA: **2.4.11 Focus Not Obscured (AA)**, **2.5.7 Dragging Movements (AA)**, **2.5.8 Target Size Minimum (AA)**, **3.2.6 Consistent Help (A)**, **3.3.7 Redundant Entry (A)**, **3.3.8 Accessible Authentication Minimum (AA)**. Mídia: **1.2.2 Captions (Prerecorded) — nível A**; 1.2.3 Audiodescrição ou alternativa — A; **1.2.5 Audiodescrição (Prerecorded) — AA**. [O] — https://www.w3.org/TR/WCAG22/
- **Precedente internacional:** NAD v. Harvard/MIT (EUA) levou a acordos que exigem legendas inclusive em cursos online abertos. [S] — https://dredf.org/national-association-deaf-et-al-v-massachusetts-institute-technology/
- **Obrigações práticas para a vNext:**
  1. **Legendas em todas as videoaulas** são exigência de WCAG nível A (1.2.2), portanto dentro do alvo WCAG 2.2 AA já aprovado (B10). A decisão "legenda própria de vídeo fora da v1" é compatível **se** as legendas forem servidas pelo provider (Panda, Stream, Mux, YouTube, Vimeo suportam faixas de legenda — [NC] confirmar por adapter, especialmente JMVStream) e houver **requisito de conteúdo**: nenhuma aula publicada sem legenda revisada (ou exceção registrada).
  2. **Transcrição** textual por aula (1.2.3 alternativa) atende também busca e revisão; pode ser derivada da legenda.
  3. **Audiodescrição (1.2.5 AA)**: para aulas em que informação visual não é narrada (slides com dados não lidos), alternativa textual/material de apoio. Orientação editorial ao autor ("narre o que está no slide") é a mitigação mais barata.
  4. **3.3.8 Accessible Authentication**: login sem teste cognitivo — Google, passkeys e colar senha/gerenciador permitidos; Turnstile seletivo precisa ter caminho acessível.
  5. **2.5.8 Target Size** e **2.4.11 Focus Not Obscured**: atenção a player, bottom nav mobile e barras fixas.
  6. **Símbolo de acessibilidade** no site (LBI art. 63 §1º) e página de declaração de acessibilidade com canal de contato.
  7. Player do provider precisa ser operável por teclado e com legendas ativáveis — critério de aceite por adapter.

---

## 7. LMS próprio vs comprar: discussões de devs (2024–2026) e armadilhas

### 7.1 Relatos de quem construiu

- **Code With Andrea — "How I Built a Modern Course Platform in 2024"** (23/02/2024): 15 meses de construção, > US$ 50 mil terceirizados + 256 h do dono; operação ~US$ 214/mês (Cloudflare Stream ~US$ 50, Vercel 40, Supabase 35, certificados 16 etc.). **Armadilha:** links de login por e-mail "consumidos" por scanners (Microsoft Defender) antes do clique → corrigido com etapa intermediária com botão. [O-blog] https://codewithandrea.com/articles/how-i-built-a-modern-course-platform-in-2024/
- **Miguel Grinberg** (15/02/2026): saiu do Teachable (renovação ~4x mais cara) e construiu em Flask; dor principal foi **migração** — alunos antigos precisam se cadastrar com o mesmo e-mail para casar compras. [O-blog] https://blog.miguelgrinberg.com/post/my-courses-site-is-moving-to-a-new-home
- **Hacker News:** "o código de LMS é simples; os requisitos é que são um pesadelo" (compatibilidade, formatos, dispositivos, SCORM frágil; compliance exige anti-skip) — https://news.ycombinator.com/item?id=48063980 (08/05/2026); SCORM é empacotamento, "never meant for assessment" — https://news.ycombinator.com/item?id=49094277 (29/07/2026); ceticismo sobre gamificação — https://news.ycombinator.com/item?id=41151844 (2024). [S]
- **RaftLabs (agência, promocional, 12/07/2026):** vídeo "deixado para depois" custou 8 semanas/US$ 65 mil para migrar para Mux; certificado especificado tarde forçou mudar o modelo de conclusão. [S — números não verificados] https://www.raftlabs.com/blog/how-to-build-app-like-teachable
- Fóruns de L&D tendem a "comprar" porque manter vira "full-time job" [S] https://www.chieflearningofficer.com/?p=23034

### 7.2 Armadilhas técnicas documentadas

| Tema | Armadilha | Mitigação documentada/recomendada | Fonte |
|---|---|---|---|
| Progresso de vídeo | Somar tempo decorrido infla com seek e duplica com rewind; `timeupdate` varia por navegador | Registrar **intervalos efetivamente reproduzidos** (TimeRanges/`played` ou ranges próprios), merge no servidor, dividir pela duração | [S] https://community.bitmovin.com/t/determine-video-watch-time-for-scheduling-ad/2373 |
| Abas em segundo plano | Chrome limita timers JS a 1 wake-up/min em abas ocultas > 5 min → heartbeat por `setInterval` atrasa | Flush em eventos de mídia e em `visibilitychange`/`pagehide` (sendBeacon) | [O] https://blog.chromium.org/2020/11/tab-throttling-and-more-performance.html |
| Links de e-mail de uso único | Outlook Safe Links/Mimecast/Proofpoint fazem GET/HEAD e consomem o token | Página de confirmação com POST/botão, ou código OTP; HEAD sem efeito | [S] https://forum.ghost.org/t/magic-links-don-t-work-when-outlook-safe-links-are-enabled/18033 |
| E-mails no spam | Reset/confirmação que "nunca chega" é ticket recorrente | SPF/DKIM/DMARC, reenvio self-service, instrução de spam | [S] https://community.canvaslms.com/t5/Canvas-Question-Forum/Student-not-receiving-password-reset-email/td-p/634210 |
| PDF de certificado | Acentos perdidos (subsetting de fonte, encoding do banco) | Fonte Unicode embutida, normalização NFC, testes com nomes acentuados/longos | [S] https://moodle.org/mod/forum/discuss.php?d=230356 |
| Pirataria | DRM não impede gravação de tela; bloqueio rígido de sessões gera tickets | Para curso pequeno: URL assinada curta, marca d'água por usuário quando o provider oferecer, heurística de sessões em vez de bloqueio rígido | [S] https://kinescope.com/blog/how-to-protect-online-course-videos-from-piracy ; Hotmart bloqueia por IPs/redes diferentes: https://help.hotmart.com/pt-br/article/208278538/ |
| Custo de vídeo | Subestimado | Cloudflare Stream: US$ 5/1.000 min armazenados/mês + US$ 1/1.000 min entregues; ingest/encoding grátis | [O] https://developers.cloudflare.com/stream/pricing/ |

**Ordem de grandeza ilustrativa (inferência):** 600 min de conteúdo ≈ US$ 3/mês de armazenamento no Stream; 300 alunos assistindo tudo ≈ 180 mil min ≈ US$ 180 no total. O custo dominante de um LMS próprio pequeno é **tempo de engenharia e manutenção** (auth, e-mail, migração, suporte, observabilidade), não infraestrutura.

---

## 8. Implicações para a vNext

> Classificação: **[Manter]** já previsto nas decisões vigentes e confirmado pelo mercado; **[Adicionar]** lacuna compatível com o escopo; **[Decisão]** conflita com item deferido/decidido e exige aprovação explícita (não aplicar silenciosamente); **[Não fazer]** custo > benefício para o porte.

### 8.1 Funções que o mercado considera básicas (um LMS próprio pequeno deve ter)

| # | Função | Situação no plano vNext | Evidência |
|---|---|---|---|
| B-1 | Login confiável (Google + senha), reset robusto, **links de e-mail resistentes a scanners** (botão/POST ou OTP; HEAD sem efeito), **reenvio self-service** do e-mail de acesso | **[Manter]** Better Auth/Google; **[Adicionar]** critérios de aceite anti-scanner e reenvio | §3.2 (acesso/e-mail é a 1ª queixa operacional), §7.2 |
| B-2 | **Troca de e-mail da conta** com verificação do novo e-mail (inclui correção de e-mail digitado errado no checkout) | Plano marca "e-mail change" como **fora da v1** → **[Decisão]**: recomenda-se ao menos fluxo Staff auditado na v1 | §3.2 item 1; §1 (plataformas BR têm fluxo de troca) |
| B-3 | "Continuar de onde parou" e progresso visível por aula/módulo/curso | **[Manter]** | §1, §2 (universal) |
| B-4 | Drip com **data de liberação visível** ao aluno | **[Manter]** D+N; **[Adicionar]** data/contador por módulo | §3.2 item 5 |
| B-5 | Quizzes com feedback | **[Manter]** | §3.1 (prática de recuperação é a intervenção mais sólida) |
| B-6 | Comentários/discussão por aula | **[Manter]**; **[Adicionar]** aviso de dados sensíveis e moderação | §3.1, §5.2 |
| B-7 | Certificado **automático e imediato**, com **nome confirmado pelo aluno antes da emissão**, carga horária, CNPJ, código/QR de verificação, **Credential ID/URL copiáveis + botão LinkedIn** | **[Manter]** B6 (`certificateName`, verificação pública); **[Adicionar]** confirmação explícita do nome, ID/URL e botão LinkedIn | §3.2 item 4, §4.3, §4.5, §2 |
| B-8 | **Prazo de acesso explícito** (vitalício ou data) no checkout, recibo e painel | **[Adicionar]** requisito de UI/e-mail sobre Entitlement | §3.2 item 2 |
| B-9 | Legendas em todas as videoaulas (via provider) + transcrição | **[Decisão parcial]** "legenda própria" fora da v1 é aceitável **se** captions do provider forem requisito de publicação | §6 (WCAG 1.2.2 nível A; LBI art. 63) |
| B-10 | Mobile-first/PWA; player com velocidade de reprodução e retomada no ponto | **[Manter]** PWA; velocidade/retomada dependem do adapter | §1, §2 |
| B-11 | Pix + cartão parcelado (+ boleto opcional); recibo por e-mail | **[Manter]** Asaas | §1 (padrão BR) |
| B-12 | **Arrependimento em 7 dias iniciado pelo aluno no próprio Hub**, com confirmação imediata e reembolso integral | **[Adicionar]** botão/form que cria solicitação durável ligada a `RefundRequest` | §4.1 (Decreto 7.962 art. 5º §§1º e 4º); §1 (garantia 7 dias é padrão) |
| B-13 | Canal de suporte com confirmação imediata e resposta ≤ 5 dias | **[Manter]** Lark Mail; **[Adicionar]** SLA e autoresposta | §4.1 (Decreto art. 4º par. único) |
| B-14 | Materiais complementares por aula (PDF) | **[Manter]** mídia privada R2 | §1, §2 |

### 8.2 Funções que são diferenciais (valem se o custo for baixo)

- **Notas pessoais por aula** (texto simples, privadas, sincronizáveis offline): baixo custo, valor alto em cursos densos para profissionais de saúde/educação; presente em parte das plataformas internacionais e raro nas BR (§1–§2).
- **Transcrição navegável/pesquisável** derivada da legenda (clicar no trecho → pular no vídeo) e **busca** dentro do curso.
- **Página de verificação rica** (status válido/revogado, carga horária, conteúdo programático) e, futuramente, **export Open Badges 3.0** sobre o mesmo registro de emissão.
- **Quizzes intercalados** (checkpoint após vídeo) e vídeos curtos — diretriz editorial mais do que feature.
- **Turmas/coortes com datas** (lives, prazos coletivos): maior associação com conclusão nos dados disponíveis (§3.1), mas está **fora da v1** → **[Decisão]** futura; pode ser aproximada com drip + discussões + e-mail.
- **E-mail de retomada** ("você parou na aula X"): efeito pequeno, custo baixo dado o outbox Resend.
- **Analytics de conclusão e abandono por aula** para Staff (já em B9, sem CSV).

### 8.3 Funções que provavelmente não valem o custo (centenas de alunos, poucos cursos, venda avulsa)

- **Afiliados, order bump/upsell, cupons, assinaturas, coprodução:** núcleo comercial das plataformas BR (§1), mas exigem antifraude, comissões, split e conciliação; para venda avulsa de poucos cursos o custo de construir não se paga. Se necessário, usar recursos do Asaas ou plataforma terceira. Coerente com o deferimento atual.
- **App nativo e download offline de vídeo:** alto custo (lojas, DRM, sync); PWA atende e o vídeo continua online (B7). **[Não fazer]**
- **DRM próprio / anti-pirataria pesada:** DRM não impede gravação de tela; URL assinada + marca d'água do provider bastam. **[Não fazer]** (já deferido)
- **Gamificação** (pontos, rankings, badges internos): efeito pequeno (§3.1). **[Não fazer]** na v1.
- **IA tutor/resumos:** tendência internacional (§2), mas custo variável, risco de erro em conteúdo de saúde e transferência de dados a fornecedor de LLM. **[Não fazer]** na v1 (já deferido).
- **SCORM/xAPI, multi-tenant, marketplace:** sem cliente corporativo, não se justifica.
- **Comunidade estilo rede social** (feed, DMs, chat em tempo real): moderação cara e risco de dado sensível; discussões por aula bastam.
- **Assinatura ICP-Brasil no PDF:** não exigida para curso livre (§4.4).
- **Emissor fiscal próprio:** usar emissão do gateway ou emissor terceirizado (§4.2).

### 8.4 Obrigações legais a refletir em requisitos

| ID sugerido | Requisito | Base | Prioridade |
|---|---|---|---|
| LEG-01 | Oferta/checkout exibe razão social, **CNPJ**, endereço físico e eletrônico, características do curso (carga horária, formato, **prazo de acesso**, pré-requisitos, restrições), preço total, formas de pagamento, política de reembolso | Decreto 7.962 art. 2º | Alta |
| LEG-02 | **Sumário do contrato/termos antes da compra**; aceite registrado (versão + timestamp); termos disponíveis para guarda | Decreto 7.962 art. 4º I, IV | Alta |
| LEG-03 | Confirmação imediata da compra por e-mail (com recibo e link dos termos) | Decreto 7.962 art. 4º III | Alta |
| LEG-04 | **Arrependimento em 7 dias pelo próprio Hub**, confirmação imediata, reembolso integral, estorno comunicado ao meio de pagamento | CDC art. 49; Decreto art. 5º | Alta |
| LEG-05 | Atendimento eletrônico com confirmação de recebimento e resposta ≤ 5 dias | Decreto art. 4º V e par. único | Alta |
| LEG-06 | Dados e gatilho para **NFS-e** por venda (e cancelamento no reembolso), integrados a emissor compatível com o **Emissor Nacional** (ME/EPP do Simples: a partir de **01/11/2026**) | LC 214/2025; Res. CGSN 191/2026 [S] | Alta (prazo) |
| LEG-07 | Certificado identifica "curso livre", sem "reconhecido pelo MEC"; campos: nome confirmado, carga horária, período, conteúdo, CNPJ, responsável, código/QR | LDB arts. 39/42; Decreto 5.154/2004; prática | Média |
| LEG-08 | **Registros de acesso (IP + data/hora) por ≥ 6 meses**, sob sigilo e acesso restrito | Marco Civil art. 15 [NC] | Alta |
| LEG-09 | Política de privacidade com finalidades e bases legais, operadores/fornecedores e países, retenção por categoria, canal do titular (e encarregado, se indicado) | LGPD arts. 6º, 9º, 18, 41; Res. 2/2022 art. 11 | Alta |
| LEG-10 | Fila de **direitos do titular** (confirmação/acesso, correção, export/portabilidade, eliminação) com prazo monitorado (15 dias; 30 se pequeno porte enquadrado) e eliminação que preserva o que o art. 16 permite | LGPD arts. 18–19; Res. 2/2022 art. 14 | Alta |
| LEG-11 | Consentimento de marketing separado, granular, revogável e registrado | LGPD arts. 7º I e 8º | Alta (já em B8) |
| LEG-12 | Sem banner de cookies no Hub **enquanto** só houver cookies necessários e analytics sem cookie; proibir pixels de terceiros no Hub | Guia ANPD de cookies [NC] | Média |
| LEG-13 | Decisão jurídica sobre transferência internacional: art. 33 IX c/c 7º V (necessidade contratual) vs CPCs da ANPD; minimizar PII em Sentry/e-mail | LGPD art. 33; Res. 19/2024 | Alta (P-12) |
| LEG-14 | Runbook de incidente: avaliação de risco relevante, comunicação em **3 dias úteis (6 se pequeno porte)**, registro de todos os incidentes por **≥ 5 anos**, consulta que liste titulares afetados | LGPD art. 48; Res. 15/2024 | Alta |
| LEG-15 | Discussões: aviso contra dados de pacientes/crianças, moderação auditada, sem anexos na v1 (ou com revisão) | LGPD arts. 11 e 14 | Média |
| LEG-16 | Público 18+ declarado nos termos e aceite de maioridade; reavaliar se houver curso para adolescentes | ECA Digital (vigente desde 17/03/2026); LGPD art. 14 | Média |
| LEG-17 | WCAG 2.2 AA (B10) + **legenda obrigatória por aula** + declaração de acessibilidade + símbolo de acessibilidade | LBI art. 63; WCAG 1.2.2 | Alta |
| LEG-18 | Reter registro mínimo de certificado revogado (código, status, hash) por prazo longo; PDF revogado por 90 dias **somente após parecer** | LGPD arts. 7º VI/IX e 16 I; P-12 | Média |
| LEG-19 | Retenção fiscal/financeira (referência 5 anos) separada da eliminação de conta | CTN [NC]; LGPD art. 16 I | Alta |

### 8.5 Pontos para decisão (conflitos com o plano vigente — não aplicados)

1. **Troca de e-mail fora da v1** vs principal fonte de reclamação de acesso → proposta: fluxo Staff auditado com verificação do novo e-mail na v1 (mínimo).
2. **Arrependimento iniciado pelo aluno:** o plano trata refund como ação Staff com reauth recente; o Decreto 7.962 pede que o consumidor possa desistir pela mesma ferramenta → proposta: botão do aluno cria solicitação durável; a execução financeira segue o fluxo `RefundRequest` existente (com política de aprovação automática dentro de 7 dias a decidir).
3. **Threshold 90% com vídeos longos:** a mediana assistida é ≤ ~6 min (Guo 2014); se as aulas forem longas, 90% gera tickets "assisti e não concluiu" → diretriz editorial de segmentar aulas e/ou ajustar threshold por curso (já configurável).
4. **NFS-e ausente do planejamento** → definir responsável (Asaas vs emissor vs contador) antes do marco financeiro; prazo 01/11/2026 se Simples.
5. **Transferência internacional** (Cloudflare e Resend sem CPCs da ANPD) → incluir em P-12 junto com a retenção de 90 dias.
6. **Legendas:** converter "legenda própria fora da v1" em "legenda via provider obrigatória para publicar" e verificar suporte a captions em cada um dos seis adapters (especialmente JMVStream e Panda).
