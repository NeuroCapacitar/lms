# ADR-0014 — Fiscal e jurídico: NFS-e fora da v1, pedidos do titular por e-mail e aceite versionado

- **Estado:** accepted-conditional
- **Data:** 2026-10-10
- **Origem:** Q21, Q29, Q38 (e Q17, Q9)
- **Substitui:** —

## Contexto

O legado nunca teve NFS-e, exclusão de conta, exportação de dados nem termos de uso com aceite; um pedido real era tratado como incidente manual (evidência: L3 §3, §5.4). O mercado trata a NF como obrigação do produtor, fora da plataforma (W3 §1.3). ME/EPP do Simples podem ser obrigadas ao Emissor Nacional a partir de 01/11/2026 (fonte secundária; W3 §4.2). Escala atual: cerca de 20 alunos.

## Decisão

- **NFS-e fora da v1** como funcionalidade. O Hub guarda e mostra à Staff nome, CPF/CNPJ informado, valor, data e forma de pagamento. CONDICIONAL à resposta do contador (PENDENTE: contador).
- **Desistência, exclusão, dados e troca de e-mail** sem funcionalidade própria: a pessoa pede por e-mail ao suporte; procedimento manual escrito para a Staff, com prazo interno de resposta e confirmação de recebimento.
- **Termos de uso, Privacidade, política de reembolso e canal do titular** são pré-requisito de Go-Live, redigidos com o advogado do cliente (PENDENTE: advogado). O Hub registra aceite versionado (versão e data/hora) no cadastro.
- Público declarado: profissionais adultos (18+) de saúde e educação, dito nos termos, com aceite de maioridade.

## Consequências

Menos código, mas risco jurídico assumido: o Decreto 7.962 pede desistência pela mesma ferramenta da contratação e resposta em até 5 dias (W3 §4.1); os direitos LGPD têm prazo de 15 dias (30 para pequeno porte; W3 §5.4). A Staff precisa de procedimento e prazo monitorado manualmente. Retenções e transferência internacional dependem de parecer jurídico.

## Como validar

Revisão do procedimento e dos termos pelo advogado antes do Go-Live; resposta do contador sobre NFS-e e prazo de 01/11/2026. Teste de aceite versionado no cadastro. Se surgirem pedidos recorrentes, reabrir por ADR.
