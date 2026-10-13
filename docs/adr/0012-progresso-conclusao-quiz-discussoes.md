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

## Emenda (2026-10-13): tentativas do quiz depois de aprovado e quando esgotam

- **Decisão (responsável delegou ao agente, "decida o melhor para o projeto"):** a aprovação é DEFINITIVA. Depois de aprovada, a pessoa não faz novas tentativas (409 `quiz_already_passed`): a conclusão da aula é append-only e a nota não entra no certificado, então refazer só criaria histórico sem efeito.
- **Tentativas esgotadas:** não há "reset por pessoa" nem correção manual (continua valendo "sem exceção de conclusão manual pela Staff"). A Staff reabre aumentando o máximo (ou deixando-o em branco = ilimitadas) no próprio quiz e publicando: o limite é comparado com as tentativas já feitas, então vale na hora e para todas as pessoas. O padrão do produto continua sendo ilimitadas, então o caso é raro.
- **Quando reabrir esta decisão:** se surgirem pedidos de "quero melhorar minha nota" ou o certificado passar a exibir nota. Aí entram nota máxima por aula e novas tentativas pós-aprovação, numa nova emenda.

## Como validar

- spike M0-13 (player JMVStream real: `ended`, duração, restrição de domínio) e contrato dos adapters.
- Testes: eventos fora de ordem, heartbeat 15–30 s, conclusão idempotente; quiz com tentativas; denúncia e moderação.
