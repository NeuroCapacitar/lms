# Checklist de acessibilidade — WCAG 2.2 AA (M9-08)

> Evidência POR CRITÉRIO. "Verificado" = há teste ou código que prova, com o arquivo. "Pendente" = depende de pessoa, de Staging ou de decisão, com dono. **Nada aqui afirma conformidade total**: a declaração pública (`/acessibilidade`) diz o mesmo. Atualizado em 2026-10-17.

## Evidência automática (roda no CI)

| Critério | Como é provado | Onde |
| --- | --- | --- |
| 1.4.3 e 1.4.11 contraste de texto (4,5:1) e de componentes e foco (3:1), tema claro e escuro | Calculado sobre os tokens OKLCH; falha quebra o CI. Inclui o botão laranja com texto escuro | `test/unit/contrast.test.ts` |
| 1.4.3 estado **hover** dos botões | `hover:brightness-95` escurece texto e fundo a 95% por canal; o teste recalcula o contraste assim (≥ 4,5:1; borda ≥ 3:1) | `test/unit/contrast.test.ts` ("estado hover") |
| 1.4.3 estado **desabilitado** | Dispensado pela própria norma (componente inativo); o botão usa `opacity-60` e não é o único meio de saber a ação | `src/web/components/ui/button.tsx` |
| axe (WCAG 2.0, 2.1 e 2.2 AA) nas telas públicas, claro e escuro, e nas telas da Staff novas | Playwright + axe | `e2e/accessibility.spec.ts` e os `e2e/staff-*.spec.ts` |
| 2.1.1 e 2.4.7 teclado e foco visível | Fluxo só com teclado e indicador de foco com espessura e cor próprias | `e2e/accessibility.spec.ts` |
| 1.4.10 reflow: de 360 a 1440 px sem rolagem horizontal da página | 6 telas públicas em 360, 768 e 1440 px; as telas da Staff novas em 375 px | `e2e/acessibilidade-wcag22.spec.ts`, `e2e/staff-*.spec.ts` |
| 2.5.8 tamanho do alvo (mínimo 24 × 24 px; o produto usa 44 px) | Mede cada botão, campo, resumo e link fora de frase nas 6 telas, 3 larguras (caixa de seleção e rádio: o rótulo inteiro) | `e2e/acessibilidade-wcag22.spec.ts` |
| 2.4.11 foco não encoberto | Percorre até 40 Tab em cada tela e confere que o elemento focado está visível e acessível no ponto central | `e2e/acessibilidade-wcag22.spec.ts` |
| 2.2.2 pausar, parar, ocultar | Nenhuma animação infinita, `marquee`/`blink` nem mídia automática nas 6 telas. Por código: destaques só mudam por botões (`src/web/components/panel-banners.tsx`), a mídia do login não gira (`src/web/components/login-media.tsx`), o autoavanço é opt-in, começa desligado e tem contagem com "Cancelar" (`src/web/video/video-player.tsx`) | `e2e/acessibilidade-wcag22.spec.ts` e o código citado |
| Linguagem neutra ("Boas-vindas", "Pessoas inscritas", "Sua inscrição está ativa") | Varre os textos visíveis de `src/web` e `src/features` e falha se achar aluno, inscrito ou bem-vindo no masculino genérico; o guarda tem teste próprio | `test/unit/neutral-language.test.ts` |

## Critérios da WCAG 2.2 pedidos na tarefa

| Critério | Situação | Evidência ou o que falta |
| --- | --- | --- |
| **2.4.11** foco não encoberto | Verificado nas telas públicas. A faixa fixa da prévia da Staff (`sticky top-0`) ganhou `scroll-padding-top: 5rem` em `src/web/styles/app.css` | **Pendente:** teste de Tab na prévia da Staff (não coberto pelo teste das telas públicas). Dono: agente, no próximo ciclo da M9-08 |
| **2.5.7** alternativa a arrastar | Verificado por código | Editor de certificado: mover e redimensionar também por setas do teclado (`src/web/certificate/canvas.tsx`, `nudge`); reordenar módulos, aulas e itens de quiz por botões "Subir" e "Descer" (`src/web/course-builder/curriculum-tab.tsx`, `quiz-editor.tsx`); destaques por "Anterior" e "Próximo" |
| **2.5.8** tamanho do alvo | Verificado | e2e acima |
| **3.2.6** ajuda consistente | Verificado por construção nas telas públicas e da pessoa inscrita | "Ajuda" fica no mesmo lugar do menu principal em toda tela pública (`src/web/layouts/public-layout.tsx`, fonte única). A área da Staff não repete um mecanismo de ajuda |
| **3.3.7** entrada redundante | **Pendente** | Falta revisar à mão os fluxos de várias etapas: compra (checkout hospedado pelo Asaas, fora do produto), nome do certificado (perfil e confirmação na primeira emissão). Dono: agente, com o responsável no checkout |
| **3.3.8** autenticação acessível | Verificado no que é do produto | Entrar por link (padrão), com campo "Cole o link" que aceita colar; Google opcional; senha opcional com `autocomplete` (gerenciador de senhas funciona). Nenhuma etapa pede memorizar, transcrever ou resolver quebra-cabeça. **Pendente:** o widget do Cloudflare Turnstile é serviço externo; conferir no Staging, com leitor de tela, que o modo usado não exige quebra-cabeça. Dono: responsável + agente |
| **2.2.2** | Verificado | acima |
| **1.2.2** legendas (nível A) | **Lacuna conhecida, não conforme** | A plataforma não gera legendas (decisão Q17). Está na declaração pública; a tela de vídeos da Staff orienta a publicar com legenda. Dono: responsável (política de publicação dos vídeos) |

## Pendências com dono

| Pendência | Dono |
| --- | --- |
| Leitor de tela manual (NVDA e VoiceOver) em: link de login, compra, aula, quiz, certificado e principais telas da Staff | Responsável (precisa de pessoa e aparelho); o agente prepara o roteiro |
| Revisão da declaração `/acessibilidade` e do símbolo de acessibilidade (LBI, art. 63) | Responsável com o advogado |
| Confirmar que o endereço de suporte (variável de ambiente que alimenta `SupportAddress`) está definido em Staging e Production | Responsável |
| Teste de Tab na prévia da Staff (2.4.11) e revisão do 3.3.7 | Agente |
| Turnstile real com leitor de tela (3.3.8) | Responsável + agente |
| Revisão de conformidade por pessoa especialista fora da equipe | Responsável |
