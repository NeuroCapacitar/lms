# ADR-0012 — Progresso e conclusão: vídeo a 90% sem anti-seek, quiz como Lesson, discussões mínimas

- **Estado:** accepted
- **Data:** 2026-10-10
- **Origem:** Q12, Q13, Q24 (e Q61.4); B2
- **Substitui:** fronteira linear validada / anti-seek e limiar de 100% do legado

## Contexto

O legado passou por ranges, posição máxima e fronteira linear anti-seek (limiar 95/98/100%), mas o botão "Concluir aula" estava sempre disponível e o mecanismo **nunca foi validado com o player real** (evidência: L2 §4.3). Não havia quiz (L2 §5). O limiar de 90% coincide com Teachable e Kajabi; risco: vídeos longos geram chamados "assisti e não concluiu" (evidência: W3 §2.3, §8.5).

## Decisão

- **Vídeo:** conclui com **90%** (maior posição ÷ duração do provider; limiar padrão do Course, configurável). Seek permitido; sem anti-seek e sem botão manual. Duração vem do provider, não do formulário.
- **Autoavanço** só em `ended` confiável, opt-in default OFF, cancelável; sem autoplay.
- **Aula de texto:** botão Concluir.
- **Quiz** como Lesson: escolha única/múltipla, nota mínima, tentativas ilimitadas por padrão (máximo configurável); submissão online. **Quiz obrigatório conta** para conclusão e certificado.
- **Opcionais** não bloqueiam nem contam. Sequência `guided|free` por curso.
- **Discussões por aula:** um nível de resposta; moderação por Staff com grant; botão denunciar; aviso proibindo dados identificáveis de pacientes; notificação por e-mail adiada.
- **Sem exceção de conclusão manual pela Staff.**

## Consequências

- Certificado passa de "comprovante de visualização" para conclusão com avaliação (L2 §5).
- Sem anti-seek, conclusão por 90% é honesta, não antifraude.
- Reabrir a exceção manual se surgirem chamados "assisti e não concluiu".

## Como validar

- spike M0-13 (player JMVStream real: `ended`, duração, restrição de domínio) e contrato dos adapters.
- Testes: eventos fora de ordem, heartbeat 15–30 s, conclusão idempotente; quiz com tentativas; denúncia e moderação.
