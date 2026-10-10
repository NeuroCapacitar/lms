# Sistema visual — Hub vNext

**Estado:** diretrizes decididas (ADR 0020); **tokens finais pendentes** do manual de marca em PDF e do logo positivo (cliente). Nada aqui está implementado.

## Direção

Identidade **NeuroCapacitar** (não a de um curso): areia/bege como base, terracota e laranja como destaque, oliva como apoio e petróleo dosado. **Mesma experiência para aluno e Staff:** acolhedora, confortável e segura; a Staff difere só na navegação (sidebar no desktop, gaveta no celular) e na densidade das tabelas (`size="sm"`). Tema claro, escuro e sistema (padrão: sistema). Tipografia **Lexend Deca**; ícones **Phosphor**; sem Geist Mono (usar o monoespaçado do sistema). Stack: Tailwind 4 + shadcn/Base UI.

## Tokens (3 camadas, em OKLCH)

1. **Marca (âncoras):** as cores do manual. Componentes nunca as consomem diretamente.
2. **Função:** fundo, superfície, texto, borda, ação, foco, erro, sucesso, aviso.
3. **Componente:** botão, campo, tabela, cartão.

Valores do manual segundo o legado (**confirmar no PDF; não tratar como oficiais**): petróleo `#326C71`, areia `#F1E8DA`, laranja `#D97B34`, oliva `#9EAD7C`, terracota `#C56A4C`.

## Contraste (calculado no relatório L4, tema claro)

| Par | Razão | Texto normal AA (4,5:1) |
|---|---|---|
| laranja sobre areia | 2,53:1 | reprova |
| oliva sobre areia | 1,98:1 | reprova |
| terracota sobre areia | 3,12:1 | reprova |
| branco sobre laranja | 3,07:1 | reprova |

**Regra:** texto e ação usam **variantes escurecidas** derivadas das âncoras (≥ 4,5:1); botão laranja leva texto escuro. Um **teste calculado** valida cada par de token, claro e escuro (M0-07). O tema escuro é desenhado, não invertido. Valores das variantes: **PENDENTE (M0-07)**.

## Regras de uso

- Meta **WCAG 2.2 AA**. Foco visível, alvos de toque adequados, labels, estados de loading, erro, vazio e desabilitado.
- **Movimento:** microtransições curtas (150–220 ms em controles; 300–350 ms em imagens). Sem adaptação a `prefers-reduced-motion` (decisão do responsável). **Nada em movimento automático por mais de 5 s sem controle de pausa**, inclusive a mídia de login.
- Raio de borda: 6/8/10/12/16 px, partindo de 8 px. Capas de curso 16:9 em 1280×720 WebP.
- Linguagem neutra na interface ("Boas-vindas", "Pessoas inscritas"). Evitar superfícies grandes em terracota (o legado reverteu por ficar "terroso").
- Logo: só existe a versão negativa (areia e laranja); a versão positiva para fundo claro é **PENDENTE (cliente)**.

Ver [ADR 0020](docs/adr/0020-marca-ui-tokens-experiencia-unica.md) e [segurança e operação](docs/spec/security-operations.md).
