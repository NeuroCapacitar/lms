# ADR-0002 — Lançamento big-bang, ETL único ao final e legado congelado

- **Estado:** accepted-conditional (conteúdo exato do ETL a fechar na modelagem)
- **Data:** 2026-10-10
- **Origem:** Q3, Q4, Q5, Q56 (também Q55, Q39, Q61.5)
- **Substitui:** B15D (coexistência com legado e DNS em etapas); descarta o strangler por coorte sugerido em W5

## Contexto

W5 recomendava strangler por fluxo/coorte; o responsável manteve o big-bang. Riscos do corte (evidência: W5 §5): pagamentos em voo, acessos ativos, URLs públicas de certificado, identidade/sessões, links compartilhados. Tensão assumida: Q3 (sem Production antes da v1 integral) × Q5 (legado congelado por tempo indeterminado, sem data-limite).

## Decisão

- **Nenhuma Production da vNext** antes da v1 integral; antes disso só Dev e Staging.
- **Legado congelado:** apenas correções de segurança, legais e de bloqueio de venda. Higiene do repositório público do legado é exceção que exige autorização separada.
- **ETL único**, só ao final, com a vNext comprovadamente pronta: usuários, contas, acessos (com `expiresAt`), conclusões, certificados (mesmo código, hash e URL; PDFs para R2 privado) e âncora de drip. Financeiro histórico fica **somente leitura**.
- **Cutover** em janela curta, legado em manutenção; trocar webhook Asaas e DNS; desligar o legado. Preservar `/comprar/[slug]` e a validação de certificado. Sem e-mail em massa no cutover. Só há volta **antes da primeira operação nova**.
- Venda feita no legado: reembolso manual no painel Asaas + revogação manual.

## Consequências

- Custos da Vercel e manutenção mínima do legado correm por tempo indefinido.
- A v1 é grande (6 adapters de vídeo, PWA, editor de certificado) e só gera valor no corte.
- Dados de aceite do legado (termos, privacidade) não existem; Go-Live depende de textos jurídicos (cliente).

## Como validar

- Ensaios de ETL repetíveis em Staging com cópia anonimizada; reconciliação de contagens e hashes.
- Checklist Go/No-Go com backup fresco e ensaio de restauração.
- PENDENTE: compatibilidade de hashes de senha (menos relevante com [ADR-0007](0007-identidade-magic-link.md)).
