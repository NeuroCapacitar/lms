# ADR-0020 — Marca e UI: tokens em três camadas, experiência única Student/Staff e movimento sem `prefers-reduced-motion`

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q9, Q47, Q48 (Q60)
- **Substitui:** B10 em parte (Geist Mono, tema dark-only do legado)

## Contexto

O legado era dark-only e proibia `prefers-reduced-motion`; não havia tema claro testado (evidência: L4 §2.6). Num tema claro beige/terracota/laranja, laranja sobre areia tem 2,53:1, branco sobre laranja 3,07:1 e grafite sobre laranja 5,36:1; oliva e terracota também falham como texto (L4 §2.4). O carrossel de login pausava só em hover, o que conflita com WCAG 2.2.2 (nível A). Marca no legado: Lexend Deca apenas no manual, UI em Geist.

## Decisão

- Tokens em três camadas em OKLCH: marca, função, componente. Variantes escurecidas para texto e ação; botão laranja com texto escuro. Teste automatizado de contraste nos pares renderizados, claro e escuro. Temas light, dark e system.
- Tipografia Lexend Deca; sem Geist Mono. Ícones Phosphor.
- **Mesma experiência visual para Student e Staff.** O shell da Staff difere (sidebar ou gaveta) por necessidade funcional; tabelas densas com `size="sm"`. Risco de não ser ideal assumido para evitar complexidade.
- **Sem adaptação a `prefers-reduced-motion`** (decisão do responsável). Restrição: nada em movimento automático por mais de 5 s sem controle de pausa operável por teclado (WCAG 2.2.2), inclusive banners e mídia de login. Movimento discreto, sem `transition-all`.
- Meta WCAG 2.2 AA. Linguagem neutra ("Boas-vindas", "Pessoas inscritas"); público 18+ de saúde e educação (ver ADR-0014).

## Consequências

Ignorar `prefers-reduced-motion` não reprova AA (2.3.3 é AAA), mas é um risco para pessoas sensíveis a movimento; o corte de movimento automático mitiga. Dependências do cliente: PDF do manual para confirmar os hex e logo positivo (o legado só tem a versão negativa).

## Como validar

Teste de contraste calculado em CI para todos os pares de token. Auditoria WCAG 2.2 AA (foco, alvo mínimo, arrasto, autenticação acessível, Turnstile com caminho acessível). Revisão visual em claro e escuro no Staging.
